/**
 * Atomic single-RTT Today screen bootstrap + SQLite SWR offline hydration.
 *
 * 1. Calls `fetchTodayBootstrap(today)` (`public.get_today_bootstrap`).
 * 2. When the RPC succeeds, hydrates `habitStore`, `logStore`, `taskStore`,
 *    `willpowerStore` and `recoveryStore` in a single pass while preserving
 *    any unsent local outbox overlays (`taskStore.outbox`, `coreOutbox`, and
 *    `logStore` optimistic `pending-*` rows), and writes the snapshot into
 *    `localReadCache` (`expo-sqlite`).
 * 3. When offline and a cached SQLite snapshot exists for the current user,
 *    hydrates from the cached snapshot immediately.
 * 4. When the RPC is not yet deployed (`missingRpc`) or stubbed in unit tests,
 *    returns `{ ok: false }` so `TodayScreen` executes its parallel store
 *    fallback cleanly.
 */
import { accountEpoch, registerAccountScoped } from '../lib/accountScope';
import type { ChecklistCheck, ChecklistItem } from '../lib/habitChecklist';
import { attachTimeOff, type GoalVersion, type PauseInterval } from '../lib/habitPauses';
import {
  getCachedSnapshot,
  getLatestSnapshot,
  pruneReadCache,
  setCachedSnapshot,
} from '../lib/localReadCache';
import { overlay } from '../lib/outbox';
import { currentUser } from '../lib/session';
import type { Habit, HabitLog, RecoveryPlan, WillpowerState } from '../lib/supabase';
import type { ReviewLogRow } from '../repositories/habitLogRepository';
import { DEFAULT_PAGE_SIZE, type Cursor } from '../repositories/shared';
import {
  fetchTodayBootstrap,
  type TodayBootstrapPayload,
} from '../repositories/todayBootstrapRepository';
import { habitMutationEpoch, useHabitStore } from '../store/habitStore';
import { useLogStore } from '../store/logStore';
import { useRecoveryStore } from '../store/recoveryStore';
import type { Task } from '../lib/taskTypes';
import { useTaskStore } from '../store/taskStore';
import { useWillpowerStore } from '../store/willpowerStore';
import { coreOutbox } from './coreOutbox';

export type BootstrapOutcome =
  | { ok: true; mode: 'rpc' | 'cache'; periodLogs: ReviewLogRow[] }
  | { ok: false };

export const BOOTSTRAP_MISSING_RPC_TTL_MS = 6 * 3_600_000;

const CACHE_SCOPE_PREFIX = 'today_bootstrap:v1:';
let rpcMissingUntil = 0;
let prunedForUser: string | null = null;

export function parseBootstrapPayload(raw: unknown): TodayBootstrapPayload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.userId !== 'string' || typeof p.today !== 'string') return null;
  const rows = <T extends { id: string }>(v: unknown): T[] =>
    Array.isArray(v)
      ? (v.filter((r) => r && typeof r === 'object' && typeof (r as { id?: unknown }).id === 'string') as T[])
      : [];
  return {
    userId: p.userId,
    today: p.today,
    habits: rows<Habit>(p.habits),
    today_logs: rows<HabitLog>(p.today_logs),
    period_logs: Array.isArray(p.period_logs) ? (p.period_logs as ReviewLogRow[]) : [],
    tasks: rows<Task>(p.tasks),
    willpower: p.willpower && typeof p.willpower === 'object' ? (p.willpower as WillpowerState) : null,
    recovery_plans: rows<RecoveryPlan>(p.recovery_plans),
    time_off_available: Boolean(p.time_off_available),
    pauses: Array.isArray(p.pauses) ? (p.pauses as PauseInterval[]) : [],
    goal_versions: Array.isArray(p.goal_versions) ? (p.goal_versions as GoalVersion[]) : [],
    checklist_available: Boolean(p.checklist_available),
    checklist_items: Array.isArray(p.checklist_items) ? (p.checklist_items as ChecklistItem[]) : [],
    checklist_checks: Array.isArray(p.checklist_checks) ? (p.checklist_checks as ChecklistCheck[]) : [],
  };
}

function pruneOnce(userId: string): void {
  if (prunedForUser === userId) return;
  prunedForUser = userId;
  void pruneReadCache(userId, {
    maxAgeMs: 30 * 86_400_000,
    keepLatestPerPrefix: { [CACHE_SCOPE_PREFIX]: 3 },
  }).catch(() => undefined);
}

async function applyBootstrapPayload(
  payload: TodayBootstrapPayload,
  opts: { skipHabits: boolean; epoch: number },
): Promise<void> {
  if (!opts.skipHabits && typeof useHabitStore.setState === 'function') {
    useHabitStore.setState({
      pauses: payload.pauses,
      goalVersions: payload.goal_versions,
      timeOffAvailable: payload.time_off_available,
      checklistItems: payload.checklist_items,
      checklistChecks: payload.checklist_checks,
      checklistAvailable: payload.checklist_available,
      habits: attachTimeOff(payload.habits, payload.pauses, payload.goal_versions),
      loading: false,
      error: null,
      hasLoaded: true,
    });
  }

  const logState = useLogStore.getState?.();
  if (logState && typeof logState.applyFetchedDay === 'function') {
    logState.applyFetchedDay(payload.today, payload.today_logs);
  }

  if (typeof useTaskStore.setState === 'function') {
    const hasMore = payload.tasks.length > DEFAULT_PAGE_SIZE;
    const pageRows = hasMore ? payload.tasks.slice(0, DEFAULT_PAGE_SIZE) : payload.tasks;
    const last = pageRows[pageRows.length - 1];
    const nextCursor: Cursor | null =
      hasMore && last ? { key: String(last.created_at), id: last.id } : null;
    const taskBox = useTaskStore.getState()?.outbox ?? null;
    useTaskStore.setState({
      tasks: taskBox ? overlay(taskBox, 'task', pageRows) : pageRows,
      cursor: nextCursor,
      hasMore,
      loading: false,
      error: null,
    });
  }

  if (payload.willpower && typeof useWillpowerStore.setState === 'function') {
    useWillpowerStore.setState({ state: payload.willpower, loading: false });
  }

  if (typeof useRecoveryStore.setState === 'function') {
    const coreBox = await coreOutbox.ensure();
    if (opts.epoch !== accountEpoch()) return;
    useRecoveryStore.setState({
      plans: coreBox ? overlay(coreBox, 'recovery_plan', payload.recovery_plans) : payload.recovery_plans,
      loading: false,
    });
  }
}

async function fromCache(today: string, habitSeq: number, epoch: number): Promise<BootstrapOutcome> {
  const user = await currentUser();
  if (!user?.id || epoch !== accountEpoch()) return { ok: false };

  const exact = await getCachedSnapshot<unknown>(user.id, `${CACHE_SCOPE_PREFIX}${today}`);
  if (epoch !== accountEpoch()) return { ok: false };
  let payload = exact ? parseBootstrapPayload(exact.data) : null;

  if (!payload) {
    const latest = await getLatestSnapshot<unknown>(user.id, CACHE_SCOPE_PREFIX);
    if (epoch !== accountEpoch()) return { ok: false };
    payload = latest ? parseBootstrapPayload(latest.data) : null;
  }

  if (!payload) return { ok: false };
  await applyBootstrapPayload(payload, {
    skipHabits: habitSeq !== habitMutationEpoch(),
    epoch,
  });
  if (epoch !== accountEpoch()) return { ok: false };
  return { ok: true, mode: 'cache', periodLogs: payload.period_logs };
}

export async function bootstrapTodayScreen(today: string): Promise<BootstrapOutcome> {
  const epoch = accountEpoch();
  const habitSeq = habitMutationEpoch();
  if (Date.now() >= rpcMissingUntil) {
    const res = await fetchTodayBootstrap(today);
    if (epoch !== accountEpoch()) return { ok: false };
    if (res.ok) {
      const payload = parseBootstrapPayload(res.data);
      if (payload) {
        await applyBootstrapPayload(payload, {
          skipHabits: habitSeq !== habitMutationEpoch(),
          epoch,
        });
        if (epoch !== accountEpoch()) return { ok: false };
        // Kritik yolda BEKLENMEZ: önbellek yazımı en iyi çabadır.
        void setCachedSnapshot(payload.userId, `${CACHE_SCOPE_PREFIX}${today}`, payload).catch(() => undefined);
        pruneOnce(payload.userId);
        return { ok: true, mode: 'rpc', periodLogs: payload.period_logs };
      }
      rpcMissingUntil = Date.now() + BOOTSTRAP_MISSING_RPC_TTL_MS;
    } else if (res.missingRpc) {
      rpcMissingUntil = Date.now() + BOOTSTRAP_MISSING_RPC_TTL_MS;
    } else if (res.offline) {
      return await fromCache(today, habitSeq, epoch);
    }
    return { ok: false };
  }
  return { ok: false };
}

registerAccountScoped({
  name: 'todayBootstrap',
  onReset: () => {
    rpcMissingUntil = 0;
    prunedForUser = null;
  },
});
