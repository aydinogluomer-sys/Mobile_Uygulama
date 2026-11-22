import { useEffect, useState } from 'react';
import type { OutboxSummary } from '../lib/outbox';
import {
  ENTITY_LABELS_TR,
  outboxEngine,
  parseHabitLogEntityId,
  type ChannelId,
} from '../lib/outboxEngine';
import type { Flusher } from '../lib/syncCoordinator';
import { useHabitStore } from '../store/habitStore';

/**
 * F46 — Unified Offline Outbox Read Facade over `lib/outboxEngine`.
 *
 * All four durable channels (`habit`, `task`, `core`, `effect`) register on
 * `outboxEngine`; this module maps engine summaries, flush outcomes, issues,
 * and coordinator flushers to the UI-facing shapes.
 */

export type UnifiedFlushChannel = 'habitLogs' | 'tasks' | 'core' | 'effects';

export type UnifiedOutboxSummary = OutboxSummary & {
  channels: {
    habitLogs: { pending: number; dead: number };
    tasks: OutboxSummary;
    core: OutboxSummary;
    effects?: OutboxSummary;
  };
  errors?: Partial<Record<UnifiedFlushChannel, string>>;
};

const CHANNEL_TO_SUMMARY_KEY: Record<ChannelId, UnifiedFlushChannel> = {
  habit: 'habitLogs',
  task: 'tasks',
  core: 'core',
  effect: 'effects',
};

export function getUnifiedOutboxSummary(): UnifiedOutboxSummary {
  const all = outboxEngine.summaryAll();
  return {
    pending: all.pending,
    dead: all.dead,
    conflict: all.conflict,
    authBlocked: all.authBlocked,
    channels: {
      habitLogs: {
        pending: all.channels.habit.pending,
        dead: all.channels.habit.dead,
      },
      tasks: all.channels.task,
      core: all.channels.core,
      effects: all.channels.effect,
    },
  };
}

export function subscribeUnifiedOutbox(listener: () => void): () => void {
  return outboxEngine.subscribeAll(listener);
}

export async function flushAllOutboxes(): Promise<UnifiedOutboxSummary> {
  const { errors: engineErrors } = await outboxEngine.flushAll();
  const errors: Partial<Record<UnifiedFlushChannel, string>> = {};
  for (const [id, msg] of Object.entries(engineErrors)) {
    if (msg !== undefined) {
      errors[CHANNEL_TO_SUMMARY_KEY[id as ChannelId]] = msg;
    }
  }
  const current = getUnifiedOutboxSummary();
  return Object.keys(errors).length > 0 ? { ...current, errors } : current;
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

export type OutboxIssue = {
  channel: ChannelId;
  id: string;
  label: string;
  reason: string;
  status: 'dead' | 'conflict';
};

/** What each core outbox entity is called on screen. */
export const CORE_ENTITY_LABELS: Record<string, string> = {
  journal_entry: ENTITY_LABELS_TR.journal_entry,
  note: ENTITY_LABELS_TR.note,
  recovery_plan: ENTITY_LABELS_TR.recovery_plan,
  focus_session: ENTITY_LABELS_TR.focus_session,
  goal: ENTITY_LABELS_TR.goal,
  project: ENTITY_LABELS_TR.project,
  reading_item: ENTITY_LABELS_TR.reading_item,
  okr_objective: ENTITY_LABELS_TR.okr_objective,
  key_result: ENTITY_LABELS_TR.key_result,
  life_area_log: ENTITY_LABELS_TR.life_area_log,
};

export function listOutboxIssues(): OutboxIssue[] {
  const habits = useHabitStore.getState()?.habits ?? [];
  return outboxEngine.listIssues().map((issue): OutboxIssue => {
    let label = issue.label;
    if (issue.channel === 'habit') {
      const parsed = parseHabitLogEntityId(issue.entityId);
      if (parsed) {
        const name = habits.find((h) => h.id === parsed.habitId)?.name ?? 'Alışkanlık';
        label = `${name} · ${parsed.date}`;
      }
    }
    return {
      channel: issue.channel,
      id: issue.operationId,
      label,
      reason: issue.reason,
      status: issue.status,
    };
  });
}

export async function retryOutboxIssue(issue: OutboxIssue): Promise<void> {
  if (issue.channel === 'core' && issue.status === 'conflict') return;
  await outboxEngine.channel(issue.channel)?.retry(issue.id, null);
}

export async function discardOutboxIssue(issue: OutboxIssue): Promise<void> {
  await outboxEngine.channel(issue.channel)?.discard(issue.id);
}

export type FlushOutcome = { tone: 'success' | 'waiting' | 'attention' | 'auth'; message: string };

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

export function syncFlushers(): Flusher[] {
  return outboxEngine.flushers();
}
