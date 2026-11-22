import { registerAccountScoped } from '../lib/accountScope';
import { createLatest } from '../lib/latestOnly';
import { create } from 'zustand';
import {
  listTasks as fetchTasksPage,
  completionPatch,
  newTaskRow,
  deliverTaskCommand,
} from '../services/taskService';
import type { Cursor } from '../repositories/shared';
import { todayLocal } from '../lib/date';
// R02 / F46 — local-first writes through the shared outbox channel factory.
import {
  emptyOutbox,
  newOperationId,
  overlay,
  summary,
  type EnqueueInput,
  type OutboxCommand,
  type OutboxState,
  type OutboxSummary,
} from '../lib/outbox';
import { ENTITY_POLICIES, outboxEngine } from '../lib/outboxEngine';
import { asyncStorageOutbox, outboxKey, type OutboxStorage } from '../lib/outboxStorage';
import { currentUser } from '../lib/session';
import type { Task, ListType, QuadrantType } from '../lib/taskTypes';
import { createOutboxChannel } from '../services/outboxChannel';
export type { TaskStatus, TaskPriority, ListType, QuadrantType, Task } from '../lib/taskTypes';

type TaskStore = {
  tasks: Task[];
  /** R02 — this account's unsent task changes; null until loaded. */
  outbox: OutboxState | null;
  sync: OutboxSummary;
  /** Send what is waiting (also called after every local change). */
  flush: () => Promise<void>;
  /** A conflicted/dead change: try again over the server's current version, or give it up. */
  retryChange: (operationId: string) => Promise<void>;
  discardChange: (operationId: string) => Promise<void>;
  clearTombstones: (ids: readonly string[]) => Promise<void>;
  /** Credentials were refreshed: an outbox paused on `auth` may run again. */
  authRefreshed: () => Promise<void>;
  /** Signed out / switched account: drop this account's tasks from memory (its outbox stays saved under its key). */
  resetForAccount: () => void;
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  error: string | null;
  cursor: Cursor | null;
  fetchTasks: () => Promise<void>;
  loadMore: () => Promise<void>;
  addTask: (t: Partial<Task>) => Promise<Task | null>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  removeTask: (id: string) => Promise<void>;
  toggleDone: (id: string) => Promise<void>;
  moveToList: (id: string, list: ListType) => Promise<void>;
  archiveTask: (id: string) => Promise<void>;
  updateQuadrant: (id: string, quadrant: QuadrantType) => Promise<void>;
  // Selectors
  byList: (list: ListType) => Task[];
  overdue: () => Task[];
  dueToday: () => Task[];
};

const swappable: { current: OutboxStorage } = { current: asyncStorageOutbox };
const swappableStorage: OutboxStorage = {
  load: (userId) => swappable.current.load(userId),
  save: (state) => swappable.current.save(state),
};

const listLatest = createLatest();
let appliedCount = 0;

async function deliverWithVersionEcho(cmd: OutboxCommand) {
  const o = await deliverTaskCommand(cmd);
  if (o.kind === 'applied') appliedCount += 1;
  if (o.kind === 'applied' && o.version) {
    const v = o.version;
    useTaskStore.setState((st) => ({
      tasks: st.tasks.map((t) => (t.id === cmd.entityId ? { ...t, updated_at: v } : t)),
    }));
  }
  return o;
}

const taskChannel = createOutboxChannel({
  storage: swappableStorage,
  transports: { task: deliverWithVersionEcho },
  currentUserId: async () => (await currentUser())?.id ?? null,
  policies: ENTITY_POLICIES,
  registerStorage: {
    name: 'task',
    keysFor: (uid) => [outboxKey(uid)],
  },
});

/** Tests and fixtures swap the persistence underneath; the app never does. */
export function setTaskOutboxStorage(next: OutboxStorage): void {
  swappable.current = next;
  taskChannel.reset();
}

export const useTaskStore = create<TaskStore>((set, get) => {
  async function ensureOutbox(): Promise<OutboxState | null> {
    // If a test simulated a cold restart by clearing `outbox` to `null` directly on the store,
    // reset channel memory first so `ensure()` reloads from storage.
    if (get().outbox === null && taskChannel.state() !== null) {
      taskChannel.reset();
    }
    return taskChannel.ensure();
  }

  async function apply(input: Omit<EnqueueInput, 'operationId'>, local: (tasks: Task[]) => Task[]): Promise<boolean> {
    if (get().outbox === null && taskChannel.state() !== null) {
      taskChannel.reset();
    }
    const res = await taskChannel.write(input, {
      onEnqueued: (nextState) => {
        set((st) => ({
          outbox: nextState,
          sync: summary(nextState),
          tasks: local(st.tasks),
          error: null,
        }));
      },
    });
    if (!res.ok) {
      set({ error: res.error });
      return false;
    }
    if (!res.savedOnDevice) {
      set({ error: 'Değişiklik cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.' });
    }
    return true;
  }

  return {
    tasks: [],
    outbox: null,
    sync: summary(emptyOutbox('')),
    loading: false,
    loadingMore: false,
    hasMore: false,
    error: null,
    cursor: null,

    fetchTasks: async () => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const run = listLatest.begin();
        const appliedAtStart = appliedCount;
        set({ loading: true, error: null });
        try {
          const box = await ensureOutbox();
          if (!run.isCurrent()) return;
          const res = await fetchTasksPage(null);
          if (!run.isCurrent()) return;
          if (!res.ok) {
            set({ loading: false, error: res.error });
            return;
          }
          if (attempt === 0 && appliedCount !== appliedAtStart) continue;
          const live = get().outbox ?? box;
          set({
            tasks: live ? overlay(live, 'task', res.data.rows) : res.data.rows,
            cursor: res.data.nextCursor,
            hasMore: res.data.hasMore,
            loading: false,
            loadingMore: false,
          });
          void get().flush();
          return;
        } finally {
          run.done();
          if (listLatest.pending() === 0 && get().loading) set({ loading: false });
        }
      }
    },

    loadMore: async () => {
      const { cursor, hasMore, loadingMore, loading } = get();
      if (!hasMore || !cursor || loadingMore || loading) return;
      const run = listLatest.begin();
      set({ loadingMore: true });
      try {
        const res = await fetchTasksPage(cursor);
        if (!run.isCurrent()) return;
        if (!res.ok) {
          set({ loadingMore: false, error: res.error });
          return;
        }
        set((s) => {
          const seen = new Set(s.tasks.map((t) => t.id));
          const fresh = res.data.rows.filter((t) => !seen.has(t.id));
          return {
            tasks: [...s.tasks, ...fresh],
            cursor: res.data.nextCursor,
            hasMore: res.data.hasMore,
            loadingMore: false,
          };
        });
      } finally {
        run.done();
      }
    },

    flush: async () => {
      if (get().outbox === null && taskChannel.state() !== null) {
        taskChannel.reset();
      }
      await taskChannel.flush();
    },

    retryChange: async (operationId) => {
      const box = taskChannel.state() ?? get().outbox;
      if (!box) return;
      const cmd = box.commands.find((c) => c.operationId === operationId);
      const base = cmd ? (get().tasks.find((t) => t.id === cmd.entityId)?.updated_at ?? null) : null;
      await taskChannel.retry(operationId, base);
    },

    discardChange: async (operationId) => {
      await taskChannel.discard(operationId);
      await get().fetchTasks();
    },

    clearTombstones: async (ids) => {
      if (get().outbox === null && taskChannel.state() !== null) {
        taskChannel.reset();
      }
      await taskChannel.clearTombstones('task', ids);
    },

    authRefreshed: async () => {
      await taskChannel.authRefreshed();
    },

    resetForAccount: () => {
      taskChannel.reset();
      set({ tasks: [], outbox: null, sync: summary(emptyOutbox('')), cursor: null, hasMore: false, error: null });
    },

    addTask: async (t) => {
      const id = newOperationId();
      const row = newTaskRow(id, t);
      const box = await ensureOutbox();
      if (!box) {
        set({ error: 'Oturum bulunamadı.' });
        return null;
      }
      const local = { ...(row as Task), user_id: box.userId };
      const ok = await apply(
        { entity: 'task', entityId: id, kind: 'create', payload: row as Record<string, unknown> },
        (ts) => [local, ...ts],
      );
      return ok ? local : null;
    },

    updateTask: async (id, patch) => {
      const task = get().tasks.find((t) => t.id === id);
      if (!task) return;
      await apply(
        { entity: 'task', entityId: id, kind: 'update', payload: patch as Record<string, unknown>, baseVersion: task.updated_at ?? null },
        (ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    },

    removeTask: async (id) => {
      const children = get().tasks.filter((t) => t.parent_task_id === id);
      const childOpIds: string[] = [];
      for (const child of children) {
        await apply({ entity: 'task', entityId: child.id, kind: 'delete' }, (ts) => ts.filter((t) => t.id !== child.id));
        const queued = (taskChannel.state() ?? get().outbox)?.commands.find(
          (c) => c.entity === 'task' && c.entityId === child.id && c.kind === 'delete',
        );
        if (queued) childOpIds.push(queued.operationId);
      }
      await apply(
        { entity: 'task', entityId: id, kind: 'delete', ...(childOpIds.length > 0 ? { dependsOn: childOpIds } : {}) },
        (ts) => ts.filter((t) => t.id !== id),
      );
    },

    toggleDone: async (id) => {
      const task = get().tasks.find((t) => t.id === id);
      if (!task) return;
      const patch = completionPatch(!task.completed);
      await apply(
        { entity: 'task', entityId: id, kind: 'update', payload: patch as Record<string, unknown>, baseVersion: task.updated_at ?? null },
        (ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    },

    moveToList: async (id, list) => {
      await get().updateTask(id, { list_type: list });
    },

    archiveTask: async (id) => {
      await get().updateTask(id, { status: 'cancelled' });
      set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    },

    updateQuadrant: async (id, quadrant) => {
      await get().updateTask(id, { quadrant });
    },

    byList: (list) => {
      return get().tasks.filter(
        (t) => t.list_type === list && t.status !== 'cancelled' && !t.completed,
      );
    },

    overdue: () => {
      const today = todayLocal();
      return get().tasks.filter(
        (t) => t.due_date && t.due_date < today && !t.completed && t.status !== 'cancelled',
      );
    },

    dueToday: () => {
      const today = todayLocal();
      return get().tasks.filter(
        (t) => t.due_date === today && !t.completed && t.status !== 'cancelled',
      );
    },
  };
});

taskChannel.subscribe((next) => {
  useTaskStore.setState({
    outbox: next,
    sync: summary(next ?? emptyOutbox('')),
  });
});

outboxEngine.register('task', {
  ...taskChannel,
  flush: () => useTaskStore.getState().flush(),
  retry: (operationId) => useTaskStore.getState().retryChange(operationId),
  discard: (operationId) => useTaskStore.getState().discardChange(operationId),
});

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'task', store: useTaskStore });
