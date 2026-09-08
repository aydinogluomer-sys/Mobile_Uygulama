/**
 * Recovery Engine V1 -- "Telafi" (Plan §9).  (Phase 1, CODER-B)
 *
 * Pure domain logic. No I/O, no Supabase client, no store, no UI.
 *
 * Today's persisted shape is `RecoveryPlan` in `lib/supabase.ts`
 * (`strategy: 'full'|'half'|'mini'|'reschedule'`,
 * `status: 'planned'|'done'|'skipped'`). The plan specifies a richer model
 * (`source_log_id`, `deficit_type`, `deficit_value`, `distributed_days`,
 * `completed_at`, `status: planned|completed|expired|cancelled`) that the
 * live table does not have columns for yet -- the migration authored
 * alongside this file (`supabase/migrations/005_phase1_core_engine.sql`)
 * adds them, but it is NOT applied (Supabase is unreachable this phase).
 *
 * `RecoveryPlanV2` below is the persisted row plus one DERIVED field.
 * The adapter that used to translate two vocabularies is gone (see that
 * type's doc and migration 013_recovery_vocabulary),
 * usable the moment `recoveryStore.ts` is rewired -- itself a follow-up,
 * not done here (see the constraints on this task).
 */

import type { HabitLog, RecoveryPlan, RecoveryStatus, RecoveryStrategy } from './supabase';
import { type Ymd, ymd, addDaysLocal, parseLocalDate, daysBetweenLocal } from './date';

// ---------------------------------------------------------------------------
// deficit
// ---------------------------------------------------------------------------

/**
 * Tracking types this module reasons about — identical to the persisted
 * `Habit['tracking_type']` vocabulary since `005_phase1_core_engine.sql`
 * widened `habits_tracking_type_check` (applied to the canonical project on
 * 2026-08-30). All four values are live.
 */
export type TrackingTypeV2 = 'boolean' | 'numeric' | 'duration' | 'abstinence';

/**
 * A deficit is either a QUANTITY short of a numeric/duration target
 * (`'numeric'`), or a whole unit either missed or not (`'binary'`) -- there
 * is no partial credit for a yes/no habit or an abstinence day.
 */
export type DeficitType = 'numeric' | 'binary';

export type Deficit = { type: DeficitType; value: number };

/**
 * `deficitFor` -- the plan's worked example: target 10000, actual 8000 ->
 * `{ type: 'numeric', value: 2000 }`.
 *
 * Binary/abstinence handling: `'boolean'` (a positive yes/no habit) and
 * `'abstinence'` (a negative habit whose "success" is NOT doing something)
 * both collapse to a single unit -- the day either went as intended or it
 * did not, there is no meaningful 60%-of-a-day deficit. `state` is read
 * from the `HabitLog` vocabulary (`'done'|'partial'|'skip'|'miss'`):
 *   - `'done'`              -> deficit 0 (nothing to recover)
 *   - `'skip'` / `'miss'`   -> deficit 1 (the whole unit is owed)
 *   - `'partial'`           -> treated as a miss for binary types, because
 *                              a binary habit has no partial state to
 *                              credit; a numeric/duration habit should be
 *                              passed through the `target`/`value` branch
 *                              instead, where partial credit is exact.
 *   - missing/unknown state -> treated as a miss (fail closed: recovery
 *                              should be offered rather than silently
 *                              assumed complete).
 */
export function deficitFor({
  trackingType,
  target,
  value,
  state,
}: {
  trackingType: TrackingTypeV2;
  target?: number | null;
  value?: number | null;
  state?: HabitLog['state'] | null;
}): Deficit {
  if (trackingType === 'numeric' || trackingType === 'duration') {
    const t = target ?? 0;
    const v = value ?? 0;
    return { type: 'numeric', value: Math.max(0, t - v) };
  }
  const succeeded = state === 'done';
  return { type: 'binary', value: succeeded ? 0 : 1 };
}

// ---------------------------------------------------------------------------
// recovery options -- the four strategies
// ---------------------------------------------------------------------------

/**
 * The plan's four offered strategies, in the exact order it lists them:
 * `Bugün tamamla · Yarına aktar · 2 güne böl · Telafi etme`.
 */
/** Kept as a name; the row type now spells the same four words. */
export type RecoveryStrategyV2 = RecoveryStrategy;

export type DistributedDay = { date: Ymd; value: number };

export type RecoveryOption = {
  strategy: RecoveryStrategyV2;
  /** Turkish, user-facing -- exact plan wording. */
  label: string;
  /** The date(s) this option schedules the recovery for. Empty for `skip`. */
  scheduled_for: Ymd[];
  /**
   * Per-day split for `split_two_days`; `null` for the other three
   * strategies (there is nothing to distribute).
   */
  distributed_days: DistributedDay[] | null;
};

/**
 * Splits an integer-ish deficit across 2 days. The FIRST day gets the
 * larger half (`ceil`), the second gets the remainder (`floor`) -- e.g.
 * 2000 -> [1000, 1000]; the plan's own odd-number case, 2001 -> [1001,
 * 1000]. Front-loading the larger share onto the earlier day gets the user
 * back on track sooner and avoids a fractional final day, which would read
 * oddly in a step-count or minutes unit. Ties (even deficits) split
 * exactly evenly, so this rule only ever matters for odd values.
 *
 * Days with a resulting value of 0 are OMITTED from the result -- a
 * zero-value day is not a day the user owes anything, so it should not be
 * represented as a distributed day at all. This is what makes a binary
 * deficit (value 1) degrade gracefully: split(1, ...) below computes
 * [1, 0], and the 0 entry is dropped, leaving a single day worth 1 -- the
 * same effective schedule as `push_tomorrow`, which is the closest thing a
 * binary deficit HAS to "split over two days".
 */
function splitAcrossDays(value: number, dates: [Ymd, Ymd]): DistributedDay[] {
  const first = Math.ceil(value / 2);
  const second = value - first;
  const days: DistributedDay[] = [];
  if (first > 0) days.push({ date: dates[0], value: first });
  if (second > 0) days.push({ date: dates[1], value: second });
  return days;
}

/**
 * The four recovery options for a deficit first observed on `fromDate`
 * (the missed/short day, i.e. `source_date`).
 *
 *   - `complete_today`  -> scheduled for `fromDate` itself (catch up before
 *                          the day that produced the deficit is over).
 *   - `push_tomorrow`   -> scheduled for `fromDate + 1`.
 *   - `split_two_days`  -> scheduled for `fromDate + 1` and `fromDate + 2`,
 *                          via `splitAcrossDays`.
 *   - `skip`            -> "Telafi etme": no date, deficit is accepted.
 *
 * All four are always returned -- filtering which ones make sense for a
 * given deficit (e.g. a UI may choose not to offer `split_two_days` for a
 * binary deficit) is a presentation decision left to the caller.
 */
export function recoveryOptions(deficit: Deficit, { fromDate }: { fromDate: Ymd }): RecoveryOption[] {
  const base = parseLocalDate(fromDate);
  if (!base) throw new Error(`recoveryOptions: invalid fromDate "${fromDate}"`);
  const tomorrow = ymd(addDaysLocal(base, 1));
  const dayAfter = ymd(addDaysLocal(base, 2));
  const distributed = splitAcrossDays(deficit.value, [tomorrow, dayAfter]);

  return [
    { strategy: 'complete_today', label: 'Bugün tamamla', scheduled_for: [fromDate], distributed_days: null },
    { strategy: 'push_tomorrow', label: 'Yarına aktar', scheduled_for: [tomorrow], distributed_days: null },
    {
      strategy: 'split_two_days',
      label: '2 güne böl',
      scheduled_for: distributed.map((d) => d.date),
      distributed_days: distributed,
    },
    { strategy: 'skip', label: 'Telafi etme', scheduled_for: [], distributed_days: null },
  ];
}

// ---------------------------------------------------------------------------
// RecoveryPlanV2
// ---------------------------------------------------------------------------

export type RecoveryStatusV2 = RecoveryStatus;

/**
 * A recovery plan.
 *
 * This used to be a strict SUPERSET of the persisted row, with five fields
 * marked "not persisted today" and an adapter pair translating between two
 * vocabularies on every read and write. Both halves of that arrangement were
 * wrong by the time anyone looked:
 *
 *  - the five columns — `source_log_id`, `deficit_type`, `deficit_value`,
 *    `distributed_days`, `completed_at` — were added by migration
 *    `005_phase1_core_engine` and had existed ever since, so the adapter was silently discarding real
 *    data on every save. A plan could not be reconstructed from what was
 *    stored: `deficitFor` computes how much is owed, and the number was
 *    thrown away on the way to the database;
 *  - the strategy vocabulary was translated `complete_today <-> full`,
 *    `skip <-> mini` and so on, where `mini` never meant `skip` — it meant a
 *    reduced-scope same-day attempt, a concept v2 has no word for.
 *
 * Migration 013_recovery_vocabulary made the table speak v2 and the
 * adapter is gone. What remains is `scheduled_for`, which is DERIVED rather
 * than stored — see `planFromRow`.
 */
export type RecoveryPlanV2 = RecoveryPlan & {
  /**
   * Every day this plan puts work on.
   *
   * Derived, not a column: for `split_two_days` it is the dates in
   * `distributed_days`, otherwise it is just `target_date`. Storing it would
   * be a second copy of facts already in the row, and the two would drift.
   */
  scheduled_for: Ymd[];
};

/**
 * A persisted row as the domain sees it.
 *
 * The only work left is deriving `scheduled_for`. Everything else is the row
 * itself — which is the point of retiring the adapter: there is no longer a
 * translation step that can lose a field or re-interpret a word.
 */
export function planFromRow(row: RecoveryPlan): RecoveryPlanV2 {
  const days = row.distributed_days ?? null;
  const scheduled: Ymd[] =
    days && days.length > 0
      ? days.map((d) => d.date as Ymd)
      : [row.target_date as Ymd];
  return { ...row, scheduled_for: scheduled };
}

// ---------------------------------------------------------------------------
// expiry
// ---------------------------------------------------------------------------

function lastScheduledDate(plan: RecoveryPlanV2): Ymd | null {
  if (plan.scheduled_for.length === 0) return plan.target_date || null;
  return plan.scheduled_for.reduce((latest, d) => (d > latest ? d : latest));
}

/**
 * Which `planned` plans in `plans` are now expired as of `today`.
 *
 * Expiry rule: a plan expires the day AFTER its last scheduled date has
 * passed -- i.e. `today` is strictly later than `max(scheduled_for)` (or
 * `target_date` when `scheduled_for` is empty, e.g. a plan rehydrated via
 * `planFromRow`). The scheduled day itself still counts as a
 * live opportunity to act, so it is not yet expired; only once that day has
 * fully elapsed does the plan lapse.
 *
 * Justification: telafi is inherently time-boxed -- "complete today"
 * three days after the fact no longer means anything close to what it
 * meant when offered. Auto-expiring stale `planned` rows keeps a recovery
 * queue honest (nothing lingers forever claiming to still be actionable)
 * without requiring the user to explicitly dismiss it. Only `planned` plans
 * are considered; `completed`/`cancelled`/already-`expired` plans are left
 * alone.
 */
export function expirePlans(plans: RecoveryPlanV2[], today: Ymd): RecoveryPlanV2[] {
  const todayDate = parseLocalDate(today);
  if (!todayDate) throw new Error(`expirePlans: invalid today "${today}"`);
  return plans.filter((p) => {
    if (p.status !== 'planned') return false;
    const last = lastScheduledDate(p);
    if (!last) return false;
    const lastDate = parseLocalDate(last);
    if (!lastDate) return false;
    return daysBetweenLocal(lastDate, todayDate) > 0;
  });
}
