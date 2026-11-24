import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import type { RecoveryPlan, RecoveryStrategy, HabitLog } from '../lib/supabase';
import { scheduleRecoveryReminder, cancelRecoveryReminder } from '../lib/notifications';
import {
  completePlan as svcCompletePlan,
  createPlan as insertRecoveryPlan,
  listPlannedPlans as fetchPlannedRecoveryPlans,
  removePlan as deleteRecoveryPlan,
  skipPlan as svcSkipPlan,
} from '../services/recoveryService';
import {
  deficitFor,
  recoveryOptions,
  type TrackingTypeV2,
  type RecoveryOption,
} from '../lib/recovery';
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';
import { coreOutbox } from '../services/coreOutbox';

/**
 * §22 analytics emission seam (task Phase-4 CODER-O) -- see the identical
 * wrapper in `store/habitStore.ts` for the full rationale. In short: run the
 * payload through `buildEvent` (which drops free text by shape, here, at the
 * call site), hand the result to `lib/analytics.ts`'s sink funnel, and never
 * let `buildEvent`'s deliberate throw escape into the user action.
 */
function emitAnalytics(name: AnalyticsEventName, props: Record<string, unknown>): void {
  try {
    emitEvent(buildEvent(name, props));
  } catch {
    /* §22: an analytics failure is never a product failure. */
  }
}

/**
 * R02.03 — §22 events follow the SERVER, not the tap: a plan is created and
 * completed on the device first (core outbox) and reported when delivery
 * applies it -- now if online, later if not. A refused write is never
 * reported. User prose (habit name, note) is never part of an event.
 */
const completionMeta = new Map<string, { habit_id: string | null; strategy: string | null; target_date: string | null }>();
coreOutbox.onApplied((cmd) => {
  if (cmd.entity !== 'recovery_plan') return;
  const p = cmd.payload as Record<string, unknown>;
  if (cmd.kind === 'create') {
    emitAnalytics('recovery_created', {
      plan_id: cmd.entityId,
      habit_id: p.habit_id ?? null,
      strategy: p.strategy ?? null,
      source_date: p.source_date ?? null,
      target_date: p.target_date ?? null,
      has_reminder: !!p.reminder_time,
    });
  } else if (cmd.kind === 'update' && p.status === 'completed') {
    const meta = completionMeta.get(cmd.entityId);
    completionMeta.delete(cmd.entityId);
    emitAnalytics('recovery_completed', {
      plan_id: cmd.entityId,
      habit_id: meta?.habit_id ?? null,
      strategy: meta?.strategy ?? null,
      target_date: meta?.target_date ?? null,
    });
  }
});

type AddPlanInput = {
  habitId: string;
  habitName: string;
  sourceDate: string;   // 'yyyy-MM-dd'
  targetDate: string;   // 'yyyy-MM-dd'
  strategy: RecoveryStrategy;
  note?: string | null;
  reminderTime?: string | null; // 'HH:mm'
  /**
   * Ne kadar borçlanıldı ve nasıl dağıtılacak.
   *
   * `recoveryOptionsFor` bunları zaten hesaplıyordu; adaptör kaldırılana
   * kadar hiçbiri veritabanına ulaşmıyordu, dolayısıyla bir plan geri
   * okunduğunda hangi eksiğe karşılık üretildiği bilinmiyordu.
   */
  sourceLogId?: string | null;
  deficitType?: 'numeric' | 'binary' | null;
  deficitValue?: number | null;
  distributedDays?: { date: string; value: number }[] | null;
};

type RecoveryStore = {
  plans: RecoveryPlan[];
  loading: boolean;
  fetchPlans: () => Promise<void>;
  addPlan: (input: AddPlanInput) => Promise<RecoveryPlan | null>;
  completePlan: (id: string) => Promise<boolean>;
  skipPlan: (id: string) => Promise<void>;
  deletePlan: (id: string) => Promise<void>;
  planForHabit: (habitId: string) => RecoveryPlan | undefined;
  /**
   * W3 (task 1-D, Phase 1 wiring): a pure, additive read that hands a caller
   * the plan's four recovery strategies (Plan §9) computed via
   * `lib/recovery.ts`'s `deficitFor` + `recoveryOptions`, instead of a
   * screen re-deriving them ad-hoc. New action -- does not change or
   * replace any of the six actions above, and does no I/O.
   */
  recoveryOptionsFor: (input: {
    trackingType: TrackingTypeV2;
    target?: number | null;
    value?: number | null;
    state?: HabitLog['state'] | null;
    direction?: 'at_least' | 'at_most' | null;
    fromDate: string;
  }) => RecoveryOption[];
};


// The round trip that used to live here is gone.
//
// It widened a row to the v2 model and narrowed it back on every read, which
// was described as "a no-op on the data". It was not: the narrowing dropped
// `source_log_id`, `deficit_type`, `deficit_value`, `distributed_days` and
// `completed_at`, on the stated grounds that the table had no columns for
// them. It had — migration `005_phase1_core_engine` added all five. So the
// store was erasing
// five real fields from every row it handed out, and the deficit the plan was
// built from was never visible to anything that read a plan back.
//
// The table now speaks the same vocabulary as the domain
// (013_recovery_vocabulary), so a row IS a plan and there is nothing to
// translate.

export const useRecoveryStore = create<RecoveryStore>((set, get) => ({
  plans: [],
  loading: false,

  fetchPlans: async () => {
    set({ loading: true });
    const res = await fetchPlannedRecoveryPlans();
    if (res.ok) set({ plans: res.data });
    set({ loading: false });
  },

  addPlan: async (input) => {
    const res = await insertRecoveryPlan({
      habitId: input.habitId,
      sourceDate: input.sourceDate,
      targetDate: input.targetDate,
      strategy: input.strategy,
      note: input.note ?? null,
      reminderTime: input.reminderTime ?? null,
      sourceLogId: input.sourceLogId ?? null,
      deficitType: input.deficitType ?? null,
      deficitValue: input.deficitValue ?? null,
      distributedDays: input.distributedDays ?? null,
    });
    if (!res.ok) return null;
    const plan = res.data;
    set((s) => ({ plans: [...s.plans, plan].sort((a, b) => a.target_date.localeCompare(b.target_date)) }));
    if (plan.reminder_time) {
      scheduleRecoveryReminder(plan.id, input.habitName, plan.target_date, plan.reminder_time);
    }
    // §22 `recovery_created` is emitted when the server applies the plan
    // (`coreOutbox.onApplied` above), so only a row that really exists is reported.
    return plan;
  },

  completePlan: async (id) => {
    // Read the plan BEFORE the local state drops it -- the event's habit_id
    // and strategy come from here, never from a caller-supplied argument.
    const plan = get().plans.find((p) => p.id === id);
    completionMeta.set(id, { habit_id: plan?.habit_id ?? null, strategy: plan?.strategy ?? null, target_date: plan?.target_date ?? null });
    const res = await svcCompletePlan(id);
    if (!res.ok) {
      completionMeta.delete(id);
      return false;
    }
    cancelRecoveryReminder(id);
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }));
    // §22 `recovery_completed` is emitted when the server applies the
    // completion (`coreOutbox.onApplied`), never for a refused one.
    return true;
  },

  skipPlan: async (id) => {
    const res = await svcSkipPlan(id);
    // A failed write leaves the plan in place rather than clearing it from
    // the list and cancelling its reminder for a change that did not happen.
    if (!res.ok) return;
    cancelRecoveryReminder(id);
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }));
  },

  deletePlan: async (id) => {
    const res = await deleteRecoveryPlan(id);
    if (!res.ok) return;
    cancelRecoveryReminder(id);
    set((s) => ({ plans: s.plans.filter((p) => p.id !== id) }));
  },

  planForHabit: (habitId) => get().plans.find((p) => p.habit_id === habitId && p.status === 'planned'),

  recoveryOptionsFor: ({ trackingType, target, value, state, direction, fromDate }) => {
    const deficit = deficitFor({ trackingType, target, value, state, direction });
    return recoveryOptions(deficit, { fromDate });
  },
}));

// F04 (STO-20): the store and the completion metadata of the account's plans.
registerAccountScoped({ name: 'recovery', store: useRecoveryStore, onReset: () => completionMeta.clear() });
