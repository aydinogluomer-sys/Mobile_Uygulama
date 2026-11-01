import { useEffect, useState } from 'react';
import type { OutboxSummary } from '../lib/outbox';
import { useLogStore } from '../store/logStore';
import { useTaskStore } from '../store/taskStore';
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

export type UnifiedOutboxSummary = OutboxSummary & {
  channels: {
    habitLogs: { pending: number; dead: number };
    tasks: OutboxSummary;
    core: OutboxSummary;
  };
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

  await Promise.all([
    typeof logFlush === 'function' ? logFlush() : Promise.resolve(),
    typeof taskFlush === 'function' ? taskFlush() : Promise.resolve(),
    coreOutbox.flush(),
  ]);

  return getUnifiedOutboxSummary();
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

