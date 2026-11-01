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
import { attachTimeOff } from '../lib/habitPauses';
import { getCachedSnapshot, setCachedSnapshot } from '../lib/localReadCache';
import { overlay } from '../lib/outbox';
import { currentUser } from '../lib/session';
import type { ReviewLogRow } from '../repositories/habitLogRepository';
import { DEFAULT_PAGE_SIZE, type Cursor } from '../repositories/shared';
import {
  fetchTodayBootstrap,
  type TodayBootstrapPayload,
} from '../repositories/todayBootstrapRepository';
import { useHabitStore } from '../store/habitStore';
import { useLogStore } from '../store/logStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { useTaskStore } from '../store/taskStore';
import { useWillpowerStore } from '../store/willpowerStore';
import { coreOutbox } from './coreOutbox';

export type BootstrapOutcome =
  | { ok: true; mode: 'rpc' | 'cache'; periodLogs: ReviewLogRow[] }
  | { ok: false };

const CACHE_SCOPE_PREFIX = 'today_bootstrap:v1:';

async function applyBootstrapPayload(payload: TodayBootstrapPayload): Promise<void> {
  if (typeof useHabitStore.setState === 'function') {
    useHabitStore.setState({
      pauses: payload.pauses,
      goalVersions: payload.goal_versions,
      timeOffAvailable: payload.time_off_available,
      checklistItems: payload.checklist_items,
      checklistChecks: payload.checklist_checks,
      checklistAvailable: payload.checklist_available,
      habits: attachTimeOff(payload.habits, payload.pauses, payload.goal_versions),
      loading: false,
    });
  }

  if (typeof useLogStore.setState === 'function') {
    const existingLogs = useLogStore.getState()?.logs ?? [];
    const pendingOptimistic = existingLogs.filter((l) => l.id.startsWith('pending-'));
    const pendingKeys = new Set(pendingOptimistic.map((l) => `${l.habit_id}|${l.completed_at}`));
    const mergedLogs = [
      ...payload.today_logs.filter((l) => !pendingKeys.has(`${l.habit_id}|${l.completed_at}`)),
      ...pendingOptimistic,
    ];
    useLogStore.setState({ logs: mergedLogs, loading: false });
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
    useRecoveryStore.setState({
      plans: coreBox ? overlay(coreBox, 'recovery_plan', payload.recovery_plans) : payload.recovery_plans,
      loading: false,
    });
  }
}

export async function bootstrapTodayScreen(today: string): Promise<BootstrapOutcome> {
  const res = await fetchTodayBootstrap(today);
  if (res.ok) {
    await applyBootstrapPayload(res.data);
    await setCachedSnapshot(res.data.userId, `${CACHE_SCOPE_PREFIX}${today}`, res.data);
    return { ok: true, mode: 'rpc', periodLogs: res.data.period_logs };
  }

  if (res.offline) {
    const user = await currentUser();
    if (user?.id) {
      const cached = await getCachedSnapshot<TodayBootstrapPayload>(
        user.id,
        `${CACHE_SCOPE_PREFIX}${today}`,
      );
      if (cached?.data) {
        await applyBootstrapPayload(cached.data);
        return { ok: true, mode: 'cache', periodLogs: cached.data.period_logs };
      }
    }
  }

  return { ok: false };
}
