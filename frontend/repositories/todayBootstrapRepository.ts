/**
 * Single-RTT Today Bootstrap RPC data access (`public.get_today_bootstrap`).
 *
 * Defined in `supabase/migrations/037_today_bootstrap_rpc.sql` (`SECURITY INVOKER`).
 * While migration `037` is `WRITTEN, NOT APPLIED` on a frozen live database, or
 * in unit tests that stub `supabase` without `.rpc`, `fetchTodayBootstrap`
 * returns `{ ok: false, missingRpc: true }` so `todayBootstrapService` can
 * transparently fall back to parallel domain loaders without losing data.
 */
import type { ChecklistCheck, ChecklistItem } from '../lib/habitChecklist';
import type { GoalVersion, PauseInterval } from '../lib/habitPauses';
import { supabase, type Habit, type HabitLog, type RecoveryPlan, type WillpowerState } from '../lib/supabase';
import type { Task } from '../lib/taskTypes';
import type { ReviewLogRow } from './habitLogRepository';
import { currentUserId, isTransportFailure } from './shared';

export const TODAY_BOOTSTRAP_KEYS = [
  'today',
  'habits',
  'today_logs',
  'period_logs',
  'tasks',
  'willpower',
  'recovery_plans',
  'time_off_available',
  'pauses',
  'goal_versions',
  'checklist_available',
  'checklist_items',
  'checklist_checks',
] as const;

export type TodayBootstrapKey = (typeof TODAY_BOOTSTRAP_KEYS)[number];

export type TodayBootstrapPayload = {
  userId: string;
  today: string;
  habits: Habit[];
  today_logs: HabitLog[];
  period_logs: ReviewLogRow[];
  tasks: Task[];
  willpower: WillpowerState | null;
  recovery_plans: RecoveryPlan[];
  time_off_available: boolean;
  pauses: PauseInterval[];
  goal_versions: GoalVersion[];
  checklist_available: boolean;
  checklist_items: ChecklistItem[];
  checklist_checks: ChecklistCheck[];
};

export type TodayBootstrapResult =
  | { ok: true; data: TodayBootstrapPayload }
  | { ok: false; error: string; offline?: boolean; missingRpc?: boolean };

function isMissingRpcError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  if (error.code === 'PGRST202' || error.code === '42883') return true;
  const msg = String(error.message ?? '');
  return /get_today_bootstrap/i.test(msg) && /(not found|does not exist|schema cache|could not find)/i.test(msg);
}

function asArray<T>(val: unknown): T[] {
  return Array.isArray(val) ? (val as T[]) : [];
}

export async function fetchTodayBootstrap(today: string): Promise<TodayBootstrapResult> {
  if (
    typeof supabase?.rpc !== 'function' ||
    typeof supabase?.auth?.getSession !== 'function'
  ) {
    return { ok: false, error: 'Bootstrap RPC kullanılamıyor.', missingRpc: true };
  }

  const u = await currentUserId();
  if (!u.ok) return u;

  const { data, error, status } = await supabase.rpc('get_today_bootstrap', { p_today: today });
  if (isMissingRpcError(error)) {
    return { ok: false, error: error?.message ?? 'RPC bulunamadı.', missingRpc: true };
  }
  if (error) {
    return { ok: false, error: error.message, offline: isTransportFailure(status, error) };
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'Geçersiz bootstrap yanıtı.', missingRpc: true };
  }

  const raw = data as Record<string, unknown>;
  const willpowerRaw =
    raw.willpower && typeof raw.willpower === 'object' && !Array.isArray(raw.willpower)
      ? (raw.willpower as unknown as WillpowerState)
      : null;

  return {
    ok: true,
    data: {
      userId: u.userId,
      today: typeof raw.today === 'string' ? raw.today : today,
      habits: asArray<Habit>(raw.habits),
      today_logs: asArray<HabitLog>(raw.today_logs),
      period_logs: asArray<ReviewLogRow>(raw.period_logs),
      tasks: asArray<Task>(raw.tasks),
      willpower: willpowerRaw,
      recovery_plans: asArray<RecoveryPlan>(raw.recovery_plans),
      time_off_available: Boolean(raw.time_off_available),
      pauses: asArray<PauseInterval>(raw.pauses),
      goal_versions: asArray<GoalVersion>(raw.goal_versions),
      checklist_available: Boolean(raw.checklist_available),
      checklist_items: asArray<ChecklistItem>(raw.checklist_items),
      checklist_checks: asArray<ChecklistCheck>(raw.checklist_checks),
    },
  };
}

