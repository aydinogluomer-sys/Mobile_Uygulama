import { useEffect, useState } from 'react';
import { nextReadyAt, type OutboxCommand, type OutboxSummary } from '../lib/outbox';
import type { Flusher } from '../lib/syncCoordinator';
import { useLogStore } from '../store/logStore';
import { useTaskStore } from '../store/taskStore';
import { useHabitStore } from '../store/habitStore';
import { coreOutbox } from './coreOutbox';

/**
 * Unified Offline Outbox Coordinator.
 *
 * Bridges Aderyth's three persisted offline mutation engines under a single
 * observable summary and single-call flush coordinator:
 *  1. `useLogStore`   — habit completions, skips, partial logs (`syncQueue`)
 *  2. `useTaskStore`  — tasks, subtasks, completions (`outbox:task`)
 *  3. `coreOutbox`    — notes, journal entries, recovery plans, focus sessions,
 *                       goals, projects, reading list, OKRs, life area check-ins
 */

export type UnifiedFlushChannel = 'habitLogs' | 'tasks' | 'core';

export type UnifiedOutboxSummary = OutboxSummary & {
  channels: {
    habitLogs: { pending: number; dead: number };
    tasks: OutboxSummary;
    core: OutboxSummary;
  };
  errors?: Partial<Record<UnifiedFlushChannel, string>>;
};

export function getUnifiedOutboxSummary(): UnifiedOutboxSummary {
  const logState = useLogStore.getState();
  const habitPending = logState?.pendingSyncCount ?? 0;
  const habitDead = logState?.deadSyncCount ?? 0;

  const taskState = useTaskStore.getState();
  const taskSummary: OutboxSummary = taskState?.sync ?? {
    pending: 0,
    dead: 0,
    conflict: 0,
    authBlocked: false,
  };

  const coreSummary = coreOutbox.sync();

  return {
    pending: habitPending + taskSummary.pending + coreSummary.pending,
    dead: habitDead + taskSummary.dead + coreSummary.dead,
    conflict: taskSummary.conflict + coreSummary.conflict,
    authBlocked: Boolean(taskSummary.authBlocked || coreSummary.authBlocked),
    channels: {
      habitLogs: { pending: habitPending, dead: habitDead },
      tasks: taskSummary,
      core: coreSummary,
    },
  };
}

export function subscribeUnifiedOutbox(listener: () => void): () => void {
  const unsubCore = coreOutbox.subscribe(listener);
  const unsubLogs =
    typeof useLogStore.subscribe === 'function' ? useLogStore.subscribe(() => listener()) : () => undefined;
  const unsubTasks =
    typeof useTaskStore.subscribe === 'function' ? useTaskStore.subscribe(() => listener()) : () => undefined;
  return () => {
    unsubCore();
    unsubLogs();
    unsubTasks();
  };
}

export async function flushAllOutboxes(): Promise<UnifiedOutboxSummary> {
  const logFlush = useLogStore.getState()?.flushPendingSync;
  const taskFlush = useTaskStore.getState()?.flush;
  const jobs: [UnifiedFlushChannel, Promise<unknown>][] = [
    ['habitLogs', Promise.resolve().then(() => (typeof logFlush === 'function' ? logFlush() : undefined))],
    ['tasks', Promise.resolve().then(() => (typeof taskFlush === 'function' ? taskFlush() : undefined))],
    ['core', Promise.resolve().then(() => coreOutbox.flush())],
  ];
  const settled = await Promise.allSettled(jobs.map(([, job]) => job));
  const errors: Partial<Record<UnifiedFlushChannel, string>> = {};
  settled.forEach((r, i) => {
    if (r.status === 'rejected') {
      errors[jobs[i][0]] = r.reason instanceof Error ? r.reason.message : 'Bilinmeyen hata';
    }
  });
  const summary = getUnifiedOutboxSummary();
  return Object.keys(errors).length > 0 ? { ...summary, errors } : summary;
}

export function useUnifiedOutboxSync(): UnifiedOutboxSummary {
  const [summary, setSummary] = useState<UnifiedOutboxSummary>(() => getUnifiedOutboxSummary());

  useEffect(() => {
    return subscribeUnifiedOutbox(() => {
      setSummary(getUnifiedOutboxSummary());
    });
  }, []);

  return summary;
}

// ---------------------------------------------------------------------------
// F05 (SYN-03, SYN-15, SYN-16) — what could not be sent, a way out for each,
// an honest flush message, and the coordinator's view of the three channels
// ---------------------------------------------------------------------------

export type OutboxIssue = {
  channel: 'habit' | 'task' | 'core';
  id: string;
  label: string;
  reason: string;
  status: 'dead' | 'conflict';
};

/** What each core outbox entity is called on screen. */
export const CORE_ENTITY_LABELS: Record<string, string> = {
  journal_entry: 'Günlük',
  note: 'Not',
  recovery_plan: 'Telafi planı',
  focus_session: 'Odak seansı',
  goal: 'Hedef',
  project: 'Proje',
  reading_item: 'Okuma öğesi',
  okr_objective: 'OKR hedefi',
  key_result: 'Anahtar sonuç',
  life_area_log: 'Yaşam alanı',
};

const REFUSED = 'Sunucu kabul etmedi.';
const CONFLICTED = 'Başka bir yerde değiştirilmiş.';

function commandIssue(channel: 'task' | 'core', c: OutboxCommand, label: string): OutboxIssue {
  const status = c.status === 'conflict' ? 'conflict' : 'dead';
  return {
    channel,
    id: c.operationId,
    label,
    reason: status === 'conflict' ? CONFLICTED : (c.lastError ?? REFUSED),
    status,
  };
}

/** Every change that will not go by itself: habit `dead` ops, task and core `dead`/`conflict` commands. */
export function listOutboxIssues(): OutboxIssue[] {
  const issues: OutboxIssue[] = [];

  const habits = useHabitStore.getState()?.habits ?? [];
  const deadOps = useLogStore.getState()?.deadSyncOps?.() ?? [];
  for (const op of deadOps) {
    const name = habits.find((h) => h.id === op.habitId)?.name ?? 'Alışkanlık';
    issues.push({ channel: 'habit', id: op.id, label: `${name} · ${op.date}`, reason: op.lastError ?? REFUSED, status: 'dead' });
  }

  const taskState = useTaskStore.getState();
  for (const c of taskState?.outbox?.commands ?? []) {
    if (c.status === 'pending') continue;
    const title = taskState.tasks?.find((t) => t.id === c.entityId)?.title;
    issues.push(commandIssue('task', c, title ? `Görev: ${title}` : 'Görev'));
  }

  for (const c of coreOutbox.state()?.commands ?? []) {
    if (c.status === 'pending') continue;
    issues.push(commandIssue('core', c, CORE_ENTITY_LABELS[c.entity] ?? 'Değişiklik'));
  }
  return issues;
}

/**
 * "Yeniden dene". A core conflict is NOT retried from here: it is resolved on its own screen, where
 * the two versions can be compared (nothing is called).
 */
export async function retryOutboxIssue(issue: OutboxIssue): Promise<void> {
  if (issue.channel === 'habit') return useLogStore.getState().reviveSyncOp(issue.id);
  if (issue.channel === 'task') return useTaskStore.getState().retryChange(issue.id);
  if (issue.status === 'conflict') return;
  return coreOutbox.retry(issue.id, null);
}

/** "Bu değişikliği bırak": the change is given up and the screen goes back to the server's version. */
export async function discardOutboxIssue(issue: OutboxIssue): Promise<void> {
  if (issue.channel === 'habit') return useLogStore.getState().dropSyncOp(issue.id);
  if (issue.channel === 'task') return useTaskStore.getState().discardChange(issue.id);
  return coreOutbox.discard(issue.id);
}

export type FlushOutcome = { tone: 'success' | 'waiting' | 'attention' | 'auth'; message: string };

/**
 * The message after "Şimdi Senkronize Et", made from what is LEFT, not from the fact that the call
 * returned (SYN-16: offline with 7 waiting, it used to say everything was delivered).
 */
export function describeFlushOutcome(after: UnifiedOutboxSummary): FlushOutcome {
  const stuck = after.dead + after.conflict;
  if (after.authBlocked) {
    return { tone: 'auth', message: 'Oturumun yenilenmesi gerekiyor; yenilenince otomatik denenecek.' };
  }
  if (stuck > 0) {
    return { tone: 'attention', message: `${stuck} değişiklik gönderilemedi. Aşağıdan yeniden deneyebilir ya da bırakabilirsin.` };
  }
  if (after.pending > 0) {
    return { tone: 'waiting', message: `${after.pending} değişiklik bekliyor. Bağlantı gelince kendiliğinden gönderilecek.` };
  }
  return { tone: 'success', message: 'Her şey eşitlendi.' };
}

/**
 * The three channels as lib/syncCoordinator sees them. Every call reads the stores afresh (nothing
 * is captured when the coordinator starts), so the counts are the current ones on every round.
 */
export function syncFlushers(): Flusher[] {
  return [
    {
      name: 'habitLogs',
      pending: () => useLogStore.getState()?.pendingSyncCount ?? 0,
      nextReadyAt: () => useLogStore.getState()?.nextSyncReadyAt?.() ?? null,
      flush: () => useLogStore.getState().flushPendingSync(),
    },
    {
      name: 'tasks',
      pending: () => useTaskStore.getState()?.sync?.pending ?? 0,
      nextReadyAt: () => {
        const box = useTaskStore.getState()?.outbox;
        return box ? nextReadyAt(box) : null;
      },
      flush: () => useTaskStore.getState().flush(),
    },
    {
      name: 'core',
      pending: () => coreOutbox.sync().pending,
      nextReadyAt: () => {
        const box = coreOutbox.state();
        return box ? nextReadyAt(box) : null;
      },
      flush: () => coreOutbox.flush(),
    },
  ];
}
