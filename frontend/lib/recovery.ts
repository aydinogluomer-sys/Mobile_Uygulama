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
 * alongside this file (`supabase/migrations/20260825_phase1_core_engine.sql`)
 * adds them, but it is NOT applied (Supabase is unreachable this phase).
 *
 * `RecoveryPlanV2` below is that richer shape. `toLegacyRecoveryPlan` /
 * `fromLegacyRecoveryPlan` are the documented adapter between the two,
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
 * `Habit['tracking_type']` vocabulary since `20260825_phase1_core_engine.sql`
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
export type RecoveryStrategyV2 = 'complete_today' | 'push_tomorrow' | 'split_two_days' | 'skip';

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
// RecoveryPlanV2 + legacy adapter
// ---------------------------------------------------------------------------

export type RecoveryStatusV2 = 'planned' | 'completed' | 'expired' | 'cancelled';

/**
 * The plan's full field list for a recovery plan. A strict superset of
 * today's `RecoveryPlan` (`lib/supabase.ts`) -- every field that type has,
 * plus the ones the plan requires that the live table does not persist yet:
 * `source_log_id`, `deficit_type`, `deficit_value`, `distributed_days`,
 * `completed_at`. Those five are typed nullable here specifically because
 * `fromLegacyRecoveryPlan` cannot populate them from today's row shape --
 * see that function's doc.
 */
export type RecoveryPlanV2 = {
  id: string;
  user_id: string;
  habit_id: string;
  /** `habit_logs.id` this recovery responds to. Not persisted today. */
  source_log_id: string | null;
  source_date: Ymd;
  /** Primary/first scheduled date -- kept for shape-compatibility with
   *  today's single `target_date` column. See `scheduled_for` for the full
   *  set (relevant for `split_two_days`). */
  target_date: Ymd;
  /** Not persisted today. */
  deficit_type: DeficitType | null;
  /** Not persisted today. */
  deficit_value: number | null;
  strategy: RecoveryStrategyV2;
  scheduled_for: Ymd[];
  /** Not persisted today. */
  distributed_days: DistributedDay[] | null;
  note: string | null;
  reminder_time: string | null;
  status: RecoveryStatusV2;
  /** Not persisted today. */
  completed_at: string | null;
  created_at: string;
};

/**
 * v2 -> today's `RecoveryStrategy` ('full'|'half'|'mini'|'reschedule').
 *
 * Both v2 and legacy have exactly four values, and this adapter is a
 * BIJECTION between them: `complete_today <-> full`, `push_tomorrow <->
 * reschedule`, `split_two_days <-> half`, and `skip <-> mini`. Every value
 * round-trips to itself in both directions -- see `strategyFromLegacy` for
 * why `'mini'` (not some other value) is `'skip'`'s legacy counterpart, and
 * why that pairing is a re-interpretation of `'mini'`'s original meaning
 * rather than a perfect match.
 *
 * FINDING A-03 history: earlier, `strategyFromLegacy('mini')` returned
 * `'complete_today'` while `strategyToLegacy('skip')` returned `'mini'`.
 * That was not just lossy, it INVERTED meaning on a round-trip: a user who
 * explicitly declined to recover ("Telafi etme", `'skip'`) would come back
 * out of a `'mini'` row reading as `'complete_today'` -- "I completed the
 * recovery" for a user who chose not to. Fixed by making `'mini'` map back
 * to `'skip'` instead, so the pairing is stable and non-inverting in both
 * directions (see `strategyFromLegacy`).
 */
function strategyToLegacy(s: RecoveryStrategyV2): RecoveryStrategy {
  switch (s) {
    case 'complete_today':
      return 'full';
    case 'push_tomorrow':
      return 'reschedule';
    case 'split_two_days':
      return 'half';
    case 'skip':
      return 'mini'; // bijection with strategyFromLegacy -- see doc above
  }
}

/**
 * Legacy `RecoveryStrategy` -> v2. The exact inverse of `strategyToLegacy`
 * (FINDING A-03 fix) -- every legacy value maps back to the v2 value that
 * produced it: `full -> complete_today`, `reschedule -> push_tomorrow`,
 * `half -> split_two_days`, `mini -> skip`.
 *
 * `mini -> skip` is still an honest RE-INTERPRETATION, not a perfect
 * translation: legacy `'mini'` originally meant "a reduced-size make-up
 * attempt, done same-day" -- a partial-scope commitment that v2's four
 * strategies have no equivalent for (v2 only has "declined to recover" at
 * all, `'skip'`, or one of three full-scope timing choices). Reading a
 * legacy `'mini'` row as v2 `'skip'` is therefore imperfect -- it loses the
 * "it was reduced in scope, not declined outright" nuance -- but it is
 * STABLE and NON-INVERTING: it no longer turns an explicit decline into a
 * claimed completion, which is the property that actually matters for
 * recovery analytics and for what the user is told. The real fix is
 * widening the persisted `recovery_plans.strategy` CHECK constraint to carry
 * all four v2 values (and drop this adapter entirely) -- authored in
 * `supabase/migrations/20260825_phase1_core_engine.sql`, which deliberately
 * did NOT widen that constraint (only the `status` vocabulary was in scope
 * for that migration) and is blocked from applying while the Supabase
 * project is paused.
 */
function strategyFromLegacy(s: RecoveryStrategy): RecoveryStrategyV2 {
  switch (s) {
    case 'full':
      return 'complete_today';
    case 'reschedule':
      return 'push_tomorrow';
    case 'half':
      return 'split_two_days';
    case 'mini':
      return 'skip'; // FINDING A-03 fix -- was 'complete_today' (an inversion); see doc above
  }
}

/**
 * v2 `status` -> legacy `status`. `'completed'` -> `'done'`, `'cancelled'`
 * -> `'skipped'`. `'expired'` has no legacy equivalent (the live vocabulary
 * predates the idea of a plan lapsing on its own) and is mapped to
 * `'skipped'` as the closest approximation -- functionally, an expired
 * recovery "did not happen" just like a skipped one, though the DISTINCTION
 * between "the user declined" and "the window silently closed" is lost
 * until the migration lands.
 */
function statusToLegacy(s: RecoveryStatusV2): RecoveryStatus {
  switch (s) {
    case 'planned':
      return 'planned';
    case 'completed':
      return 'done';
    case 'expired':
      return 'skipped'; // lossy -- see doc above
    case 'cancelled':
      return 'skipped';
  }
}

/** Legacy `status` -> v2 `status`. Total and lossless (legacy never writes
 *  `'expired'`, so the reverse direction never needs to invent it). */
function statusFromLegacy(s: RecoveryStatus): RecoveryStatusV2 {
  switch (s) {
    case 'planned':
      return 'planned';
    case 'done':
      return 'completed';
    case 'skipped':
      return 'cancelled';
  }
}

/**
 * `RecoveryPlanV2` -> the shape `recoveryStore.addPlan` can insert today
 * (i.e. today's `RecoveryPlan` row minus `id`/`created_at`, which the DB
 * assigns). `source_log_id`, `deficit_type`, `deficit_value`,
 * `distributed_days` and `completed_at` are DROPPED here -- there is no
 * column to put them in until the authored migration is reviewed and
 * applied. Callers that need those fields to survive a save must wait for
 * that migration; this adapter exists so the REST of a `RecoveryPlanV2`
 * (strategy, dates, note, reminder, status) can be persisted today without
 * blocking on it.
 */
export function toLegacyRecoveryPlan(
  plan: RecoveryPlanV2
): Pick<RecoveryPlan, 'user_id' | 'habit_id' | 'source_date' | 'target_date' | 'strategy' | 'note' | 'reminder_time' | 'status'> {
  return {
    user_id: plan.user_id,
    habit_id: plan.habit_id,
    source_date: plan.source_date,
    target_date: plan.target_date,
    strategy: strategyToLegacy(plan.strategy),
    note: plan.note,
    reminder_time: plan.reminder_time,
    status: statusToLegacy(plan.status),
  };
}

/**
 * Today's persisted `RecoveryPlan` -> `RecoveryPlanV2`. The five fields the
 * live row cannot carry are filled with `null` (NOT guessed) --
 * `deficit_type`/`deficit_value` in particular are typed nullable in
 * `RecoveryPlanV2` specifically so this function can be honest that it does
 * not know them, rather than fabricating a value.
 */
export function fromLegacyRecoveryPlan(row: RecoveryPlan): RecoveryPlanV2 {
  return {
    id: row.id,
    user_id: row.user_id,
    habit_id: row.habit_id,
    source_log_id: null,
    source_date: row.source_date,
    target_date: row.target_date,
    deficit_type: null,
    deficit_value: null,
    strategy: strategyFromLegacy(row.strategy),
    scheduled_for: [row.target_date],
    distributed_days: null,
    note: row.note,
    reminder_time: row.reminder_time,
    status: statusFromLegacy(row.status),
    completed_at: null,
    created_at: row.created_at,
  };
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
 * `fromLegacyRecoveryPlan`). The scheduled day itself still counts as a
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
