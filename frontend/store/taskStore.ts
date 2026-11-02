import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import {
  listTasks as fetchTasksPage,
  completionPatch,
  newTaskRow,
  deliverTaskCommand,
} from '../services/taskService';
import type { Cursor } from '../repositories/shared';
import { todayLocal } from '../lib/date';
// R02 — local-first writes through the durable, per-account outbox.
import {
  emptyOutbox, enqueue, overlay, summary, newOperationId, retry as retryCommand, discard as discardCommand, clearAuthBlock,
  type EnqueueInput, type OutboxState, type OutboxSummary,
} from '../lib/outbox';
import { asyncStorageOutbox, type OutboxStorage } from '../lib/outboxStorage';
import { flushOutbox } from '../services/outboxRunner';
import { currentUser } from '../lib/session';

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type TaskPriority = 'high' | 'medium' | 'low' | 'none';
export type ListType = 'inbox' | 'this_week' | 'someday';

export type QuadrantType = 'UI' | 'NI' | 'UN' | 'NN' | null;

export type Task = {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date?: string | null;
  project_id?: string | null;
  list_type: ListType;
  notes_text?: string | null;
  completed: boolean;
  completed_at?: string | null;
  quadrant?: QuadrantType;
  created_at: string;
  updated_at?: string | null;
};

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

let storage: OutboxStorage = asyncStorageOutbox;
/** The flush in progress, if any. A second call waits for it, then runs again. */
let inFlight: Promise<void> | null = null;
/** Tests and fixtures swap the persistence underneath; the app never does. */
export function setTaskOutboxStorage(next: OutboxStorage): void { storage = next; }

export const useTaskStore = create<TaskStore>((set, get) => {
  /**
   * The one way a task changes locally: the command is written to the outbox
   * (one atomic save -- the outbox IS the local copy, see lib/outboxStorage),
   * the screen shows it at once, then delivery is attempted. A change that
   * cannot be saved locally is reported and not shown.
   */
  async function apply(input: Omit<EnqueueInput, 'operationId'>, local: (tasks: Task[]) => Task[]): Promise<boolean> {
    if (!(await ensureOutbox())) { set({ error: 'Oturum bulunamadı.' }); return false; }
    // Enqueue on the LIVE outbox and publish it before anything is awaited: a
    // delivery in flight reads and writes the same state, and a result
    // computed before an await would overwrite its progress.
    const live = get().outbox!;
    const res = enqueue(live, { ...input, operationId: newOperationId() }, live.userId, Date.now());
    if (!res.ok) { set({ error: 'Değişiklik kaydedilemedi.' }); return false; }
    set((st) => ({ outbox: res.state, sync: summary(res.state), tasks: local(st.tasks), error: null }));
    try {
      // Saves the whole current outbox -- including this change.
      await storage.save(get().outbox ?? res.state);
    } catch {
      // Kept in memory and written by the next successful save; said out loud
      // because until then an app kill would lose it.
      set({ error: 'Değişiklik cihaza kaydedilemedi; uygulama kapanırsa kaybolabilir.' });
    }
    void get().flush();
    return true;
  }

  async function runFlush(): Promise<void> {
    const box = await ensureOutbox();
    if (!box || box.commands.length === 0) return;
    await flushOutbox({
      // Always the live outbox: edits made while a request is out are kept.
      get: () => get().outbox ?? box,
      set: async (next) => {
        // R02.06 — reset (sign-out / account deleted) while this delivery was
        // out: never publish or save the old account's outbox back.
        const cur = get().outbox;
        if (!cur || cur.userId !== next.userId) return;
        set({ outbox: next, sync: summary(next) });
        try { await storage.save(get().outbox ?? next); } catch { /* kept in memory; saved on the next change */ }
      },
    }, {
      task: async (cmd) => {
        const o = await deliverTaskCommand(cmd);
        // The version our own delivery produced becomes the row's, so the
        // next local edit is not reported as a conflict with ourselves.
        if (o.kind === 'applied' && o.version) {
          const v = o.version;
          set((st) => ({ tasks: st.tasks.map((t) => (t.id === cmd.entityId ? { ...t, updated_at: v } : t)) }));
        }
        return o;
      },
    }, { currentUserId: async () => (await currentUser())?.id ?? null, now: () => Date.now() });
  }

  async function ensureOutbox(): Promise<OutboxState | null> {
    const user = await currentUser();
    if (!user) return null;
    const cur = get().outbox;
    // Another account's outbox is never used -- it stays saved under its own key.
    if (cur && cur.userId === user.id) return cur;
    const loaded = await storage.load(user.id);
    // Someone else may have loaded (and changed) it while this was reading.
    const now = get().outbox;
    if (now && now.userId === user.id) return now;
    set({ outbox: loaded, sync: summary(loaded) });
    return loaded;
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
    set({ loading: true, error: null });
    const box = await ensureOutbox();
    const res = await fetchTasksPage(null);
    if (!res.ok) return set({ loading: false, error: res.error });
    set({
      // Unsent changes stay visible over a refetch until they are delivered.
      tasks: box ? overlay(box, 'task', res.data.rows) : res.data.rows,
      cursor: res.data.nextCursor,
      hasMore: res.data.hasMore,
      loading: false,
    });
    void get().flush();
  },

  loadMore: async () => {
    const { cursor, hasMore, loadingMore, loading } = get();
    if (!hasMore || !cursor || loadingMore || loading) return;
    set({ loadingMore: true });
    const res = await fetchTasksPage(cursor);
    if (!res.ok) return set({ loadingMore: false, error: res.error });
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
  },

  flush: async () => {
    // A caller that asks to send now must not return before what is waiting
    // was attempted: wait for the flush in progress, then run once more for
    // anything enqueued meanwhile.
    while (inFlight) await inFlight;
    inFlight = runFlush();
    try { await inFlight; } finally { inFlight = null; }
  },

  retryChange: async (operationId) => {
    const box = get().outbox;
    if (!box) return;
    const cmd = box.commands.find((c) => c.operationId === operationId);
    // Over the version the screen last saw from the server.
    const base = cmd ? (get().tasks.find((t) => t.id === cmd.entityId)?.updated_at ?? null) : null;
    const next = retryCommand(box, operationId, base);
    await storage.save(next);
    set({ outbox: next, sync: summary(next) });
    void get().flush();
  },

  discardChange: async (operationId) => {
    const box = get().outbox;
    if (!box) return;
    const next = discardCommand(box, operationId);
    await storage.save(next);
    set({ outbox: next, sync: summary(next) });
    await get().fetchTasks();
  },

  authRefreshed: async () => {
    const box = get().outbox;
    if (box?.authBlocked) {
      const next = clearAuthBlock(box);
      try { await storage.save(next); } catch { /* in memory is enough to run now */ }
      set({ outbox: next, sync: summary(next) });
    }
    void get().flush();
  },

  resetForAccount: () => {
    set({ tasks: [], outbox: null, sync: summary(emptyOutbox('')), cursor: null, hasMore: false, error: null });
  },

  addTask: async (t) => {
    const id = newOperationId();
    const row = newTaskRow(id, t);
    const box = await ensureOutbox();
    if (!box) { set({ error: 'Oturum bulunamadı.' }); return null; }
    const local = { ...(row as Task), user_id: box.userId };
    const ok = await apply({ entity: 'task', entityId: id, kind: 'create', payload: row as Record<string, unknown> }, (ts) => [local, ...ts]);
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
    await apply({ entity: 'task', entityId: id, kind: 'delete' }, (ts) => ts.filter((t) => t.id !== id));
  },

  toggleDone: async (id) => {
    const task = get().tasks.find((t) => t.id === id);
    if (!task) return;
    // `completed`, `status` and `completed_at` describe one fact across three
    // columns; the service owns keeping them consistent (`completionPatch`).
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
      (t) => t.list_type === list && t.status !== 'cancelled' && !t.completed
    );
  },

  overdue: () => {
    const today = todayLocal();
    return get().tasks.filter(
      (t) => t.due_date && t.due_date < today && !t.completed && t.status !== 'cancelled'
    );
  },

  dueToday: () => {
    const today = todayLocal();
    return get().tasks.filter(
      (t) => t.due_date === today && !t.completed && t.status !== 'cancelled'
    );
  },
};
});

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'task', store: useTaskStore });
