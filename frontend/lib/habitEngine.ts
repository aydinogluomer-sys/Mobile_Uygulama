/**
 * Habit Engine V2 — completion semantics.  (task 1-W1, IMPLEMENTATION_V2.md §8)
 *
 * Pure domain logic. No I/O, no `supabase` import, no network. This module is
 * the part of Phase 1 that is not blocked by the Supabase outage: it defines
 * how a single log's numbers turn into a ratio, a percent and a state, and it
 * is deliberately independent of persistence.
 *
 * ## The persisted vocabulary and the domain vocabulary
 *
 * The DB persists `'boolean' | 'numeric' | 'duration' | 'abstinence'`; this
 * module speaks `'binary' | 'numeric' | 'duration' | 'abstinence'`. The only
 * difference is `boolean`/`binary`, and `adaptTrackingType` below is the
 * single seam that translates. It is no longer a stopgap: the migration that
 * widened the CHECK constraint landed on 2026-08-30, so all four values are
 * writable and the persisted value is authoritative.
 */
import type { Habit } from './supabase';

/** V2 tracking type (§8). Not persisted as-is — see `adaptTrackingType`. */
export type TrackingType = 'binary' | 'numeric' | 'duration' | 'abstinence';

/** V2 log state (§8.5). `skip` must never be treated as a failure by a caller. */
export type HabitLogState = 'done' | 'partial' | 'miss' | 'skip';

/**
 * Does this tracking type carry a NUMERIC target?
 *
 * The single answer to "should this habit show a value input / a percentage
 * instead of a done-flag". Call sites must not hand-roll
 * `tracking_type === 'numeric'`: every one of those comparisons silently
 * answers *no* for a duration habit, which would render a 20-minute
 * meditation as a bare Evet/Hayır tick and throw its logged minutes away.
 *
 * Accepts both vocabularies — the persisted `Habit['tracking_type']`
 * (`boolean`) and this module's `TrackingType` (`binary`) — because callers
 * legitimately hold either.
 */
export function isMeasurableTracking(t: Habit['tracking_type'] | TrackingType): boolean {
  return t === 'numeric' || t === 'duration';
}

/**
 * The fixed unit of a duration habit.
 *
 * Duration is identified by `tracking_type === 'duration'`, **never** by
 * sniffing `habits.unit`: that column is free text, so `'dakika'`, `'dk'`,
 * `'minutes'` and a typo are indistinguishable, and a habit measured in
 * `'sayfa'` would be one string away from being scored as time.
 */
export const DURATION_UNIT = 'dakika';

/**
 * Derives the V2 `TrackingType` from what is persisted.
 *
 * The DB's `habits_tracking_type_check` now accepts all four values
 * (widened by `005_phase1_core_engine.sql`, applied 2026-08-30), so the
 * persisted value is authoritative and this adapter simply honours it:
 *
 *  - `'numeric'` → `'numeric'`
 *  - `'duration'` → `'duration'`
 *  - `'abstinence'` → `'abstinence'`
 *  - `'boolean'` → `'binary'`, **unless** the row is a legacy negative habit
 *    (see below).
 *
 * ## Why `behavior_type` no longer overrides `tracking_type`
 *
 * This adapter used to return `'abstinence'` for ANY habit with
 * `behavior_type === 'negative'`, whatever its tracking type. That collapsed
 * two orthogonal concepts — *what kind of habit is this* (build vs. quit) and
 * *how is it measured* — into one, and made a whole class of real habit
 * inexpressible: "at most 2 cigarettes a day" is negative AND numeric, and
 * under the old rule its count was thrown away and it was scored as a plain
 * did-I-abstain flag.
 *
 * The override survives in exactly one place, as a **read-compatibility rule
 * for existing rows**: before `'abstinence'` was persistable, the UI wrote
 * `'boolean'` for negative habits and carried the abstinence meaning in
 * `behavior_type` alone. Those rows are still in the database, so
 * `'boolean' + negative` continues to read back as `'abstinence'`. New rows
 * persist `'abstinence'` explicitly and do not rely on this.
 *
 * Anything unrecognised falls back to `'binary'`: a binary habit can only be
 * marked done/not-done, so an unknown input can never be silently
 * over-credited the way a numeric guess could.
 */
export function adaptTrackingType(habit: Pick<Habit, 'tracking_type' | 'behavior_type'>): TrackingType {
  switch (habit.tracking_type) {
    case 'numeric': return 'numeric';
    case 'duration': return 'duration';
    case 'abstinence': return 'abstinence';
    case 'boolean':
    default:
      // Legacy rows only — see the note above.
      return habit.behavior_type === 'negative' ? 'abstinence' : 'binary';
  }
}

/**
 * Which side of the target counts as success.
 *
 * `at_least` — a floor. "8000 steps" succeeds by reaching or passing it.
 * `at_most`  — a CEILING. "at most 2 cigarettes" succeeds by staying at or
 *              under it, and zero is the best possible day.
 *
 * Scoring a ceiling with a floor's arithmetic inverts the reward: under
 * `min(value / target, 1)`, smoking 0 of a 2-cigarette limit scores 0% and is
 * classified `miss`, while smoking 2 scores 100%. The better the behaviour,
 * the worse the number. That was unreachable while `behavior_type` forced
 * every negative habit to `abstinence`; making negative+numeric expressible
 * is what exposed it.
 */
export type TargetDirection = 'at_least' | 'at_most';

export type CompletionRatioInput = {
  trackingType: TrackingType;
  /** The already-decided outcome for this log, when one exists. */
  state: HabitLogState;
  value?: number | null;
  target?: number | null;
  /** Defaults to `at_least`, which is what an unset column has always meant. */
  direction?: TargetDirection | null;
};

/**
 * Ratio for a measured habit against a CEILING.
 *
 * Contract, stated rather than implied:
 *
 *   value <= target              -> 1    (success, including value = 0)
 *   target = 0, value > 0        -> 0    (zero tolerance, exceeded)
 *   value > target               -> 1 - (value - target) / target,
 *                                   clamped to [0, 1] — so the score decays
 *                                   with the overshoot and reaches 0 at
 *                                   twice the limit.
 *
 * `value == null` returns `null`, meaning "no answer": nothing was recorded,
 * and an absent number is NOT evidence of having stayed under a limit. The
 * caller falls back to the logged state rather than crediting a perfect day
 * to a user who simply did not log.
 */
function ceilingRatio(value: number | null | undefined, target: number): number | null {
  if (value == null || Number.isNaN(value)) return null;
  const v = value < 0 ? 0 : value;
  if (v <= target) return 1;
  if (target === 0) return 0;
  const r = 1 - (v - target) / target;
  return Number.isFinite(r) ? Math.min(Math.max(r, 0), 1) : 0;
}

/** A target usable by `at_most`. Unlike `at_least`, zero is meaningful here. */
const ceilingTargetOk = (t: number | null | undefined): t is number =>
  t != null && Number.isFinite(t) && t >= 0;

/**
 * Converts a single log into a completion ratio in `[0, 1]` (§8.6).
 *
 *   binary / abstinence : done → 1, everything else → 0
 *   numeric / duration   : min(value / target, 1), clamped for bad input
 *
 * `state` is the outcome the caller already knows (a user explicitly tapped
 * "done", "skip", etc., or a previous `deriveState` call already classified
 * the log). It is the SOLE source of truth for `binary`/`abstinence`, and it
 * is the FALLBACK for `numeric`/`duration` when the quantities are unusable
 * (see below) — it is never consulted for `numeric`/`duration` when a valid
 * target is present, because §8.6 defines that ratio purely as
 * `value / target`, independent of whatever `state` a caller happened to
 * pass alongside it.
 *
 * Edge cases, decided and documented (per W1's explicit requirement — no
 * silent guessing):
 *  - `skip` → 0, for ANY tracking type. This is not a "failure" score; it is
 *    a neutral non-signal. Callers that aggregate ratios into a streak or a
 *    strength score (see `habitStrength.ts`) must check `state === 'skip'`
 *    themselves and exclude the day entirely rather than reading this 0 as a
 *    miss — `completionRatio` has no way to signal "excluded" through a
 *    number alone, so the exclusion is deliberately left to the caller who
 *    has the context to do it (matches `habitSchedule.ts`'s own convention
 *    of favouring an honest "not this function's job" over a guess).
 *  - `target == null`, `target === 0`, or `target < 0` (numeric/duration):
 *    a ratio cannot be computed by division. Falls back to `state`:
 *    `done` → 1, else → 0. A goal-less numeric log with no way to judge
 *    "how much" still has a caller-supplied verdict, and that verdict is
 *    trusted over guessing at a denominator that doesn't exist.
 *  - `value == null` or `value < 0` (numeric/duration, valid target):
 *    treated as `0` progress. A negative value cannot mean "more than
 *    nothing was done", so it is clamped up to zero rather than passed
 *    through (which would otherwise make the ratio negative).
 *  - `value > target` (numeric/duration): clamped to `1`. §8.6 says so
 *    explicitly ("min(actual/target, 1)") — overshooting a goal is still
 *    exactly 100% complete, not more.
 *  - `target` is `NaN`/`Infinity`/`-Infinity` (numeric/duration): treated the
 *    same as `target == null` (FINDING A-01 fix) — falls back to `state`.
 *    `Number.isFinite` catches all three in one check (and, per its own
 *    semantics, `null`/`undefined` too — the explicit `target == null` stays
 *    for readability). An infinite/NaN target has no meaningful "how much of
 *    this was done" answer via division, exactly like a missing one.
 *  - `value` is `NaN` (numeric/duration, valid target): clamped to `0`, same
 *    treatment as `value < 0` (FINDING A-01 fix) — `NaN < 0` and
 *    `NaN == null` are both `false` in JS, so the pre-fix guard let a `NaN`
 *    value fall straight through into the division, poisoning the ratio.
 *    Deliberately narrower than `!Number.isFinite(value)`: `value: Infinity`
 *    is NOT clamped here — it is already handled correctly by the
 *    `Math.min(v / target, 1)` below (overshoot-clamps to `1`, same as any
 *    other value bigger than `target`), so rejecting it too would throw away
 *    already-correct behaviour to "fix" something that was never broken.
 *  - belt-and-suspenders: the final `v / target` is re-checked with
 *    `Number.isFinite` before being returned. With the two guards above,
 *    `target` is always finite and `> 0` and `value` is never `NaN` by the
 *    time division happens, so this should be unreachable — the one
 *    theoretical gap it still closes is `value: Infinity` divided by a
 *    `target` that is *also* infinite, which the `target` guard above now
 *    excludes anyway (`Infinity` is not finite) — but per this file's own
 *    "worse failure mode" reasoning for `completionPercent`, a ratio-level
 *    function that could still leak a raw `NaN` for some future combination
 *    is worse than one more defensive check.
 *  - `state === 'partial'` passed for `binary`/`abstinence`: these two types
 *    have no fractional notion by definition (an avoidance day either
 *    happened or it didn't; there is no "half done" checkbox). This is a
 *    genuinely undefined combination — it can only arise from stale/foreign
 *    data, e.g. a habit whose type changed after logs existed under the old
 *    type. Rather than fabricate a 0.5 "half credit" for it, this falls into
 *    the same bucket as `miss`: only an explicit `'done'` counts as success.
 *    This mirrors `habitSchedule.ts`'s stated preference for the
 *    conservative reading when a combination isn't really specified
 *    ("aşırı sayım yerine eksik sayım tercih edilir").
 *
 * ## Abstinence semantics — read this before wiring a negative habit
 *
 * For a negative/avoidance habit, the thing that gets LOGGED each day is the
 * act of abstaining, not the negative behaviour itself. `state: 'done'`
 * therefore means "I successfully abstained today" (the target was met —
 * ratio 1), and `state: 'miss'` means "I did not abstain / I relapsed"
 * (ratio 0). This is the same convention `Habit.behavior_type: 'negative'`
 * already uses at the storage layer today — a good day is still logged as
 * `done`, never inverted — so `completionRatio` does not invert anything
 * here either; it simply treats `abstinence` exactly like `binary` for the
 * purpose of the ratio. The inversion (if any product surface wants to say
 * "0 cigarettes" instead of "done") is display-layer copy, not domain logic,
 * and stays out of this module.
 */
export function completionRatio(input: CompletionRatioInput): number {
  const { trackingType, state, value, target, direction } = input;

  if (state === 'skip') return 0; // bkz. yukarıdaki not — 0 burada "ceza" değil, dışlanması gereken bir sinyalin yer tutucusudur.

  switch (trackingType) {
    case 'binary':
    case 'abstinence':
      return state === 'done' ? 1 : 0;

    case 'numeric':
    case 'duration': {
      if (direction === 'at_most') {
        if (!ceilingTargetOk(target)) return state === 'done' ? 1 : 0;
        const r = ceilingRatio(value, target);
        return r ?? (state === 'done' ? 1 : 0);
      }
      if (target == null || !Number.isFinite(target) || target <= 0) {
        return state === 'done' ? 1 : 0;
      }
      const v = value == null || Number.isNaN(value) || value < 0 ? 0 : value;
      const ratio = Math.min(v / target, 1);
      return Number.isFinite(ratio) ? ratio : 0; // defensive backstop -- see doc above
    }

    default:
      // Exhaustive by TrackingType — kept as an explicit, documented fallback
      // rather than an unreachable `never` throw, in case a future tracking
      // type is added to the union before this function is updated for it.
      return 0;
  }
}

export type DeriveStateInput = {
  trackingType: TrackingType;
  value?: number | null;
  target?: number | null;
  /** Defaults to `at_least`. See `TargetDirection`. */
  direction?: TargetDirection | null;
};

/**
 * Classifies a raw value/target pair into a `HabitLogState` (§8.6/§8.5).
 *
 * Unlike `completionRatio`, this function has no `state` to fall back on —
 * producing the state IS its job. Two consequences of that:
 *
 *  - `'skip'` is **never** returned here. Skipping is a deliberate user
 *    action ("atla" button), not something derivable from a value/target
 *    pair — there is no quantity that means "the user chose to skip today".
 *    Callers construct `state: 'skip'` directly when that action happens;
 *    this function only ever returns `'done' | 'partial' | 'miss'`.
 *  - For `binary`/`abstinence`, there is no target to divide by. `value` is
 *    read as a truthy flag: `> 0` → `'done'`, otherwise → `'miss'`. There is
 *    no `'partial'` outcome for these two types (see `completionRatio`'s
 *    doc), so this branch can only ever return one of the other two.
 *  - For `numeric`/`duration`, the ratio threshold from §8.6 applies
 *    directly: `ratio >= 1` → `'done'`, `0 < ratio < 1` → `'partial'`,
 *    otherwise → `'miss'`. When `target` is missing/zero/negative (no
 *    denominator to judge against), the fallback here is `value > 0` →
 *    `'done'`, else `'miss'` — deliberately mirroring the binary branch
 *    rather than `completionRatio`'s `state`-based fallback, because there
 *    is no `state` available to fall back to in this function.
 *
 * ## Non-finite input (FINDING A-01) -- deliberately NOT symmetric with `completionRatio`
 *
 * `value: NaN` is clamped to `0` here too (mirrors the `completionRatio`
 * fix), which is output-neutral: it already fell through every `>=`/`>`
 * comparison as `false` and landed on `'miss'` before this change, exactly
 * as it does now -- this is a readability/defence-in-depth change only.
 *
 * `target: NaN`/`Infinity`/`-Infinity`, however, is INTENTIONALLY left out of
 * the `target == null || target <= 0` guard below, unlike the equivalent
 * guard in `completionRatio`. This function has no `state` to fall back on
 * for a "no denominator" case -- the fallback here is `value > 0 ? 'done' :
 * 'miss'` -- and a non-finite `target` is not the same situation as a
 * missing one: routing it through that fallback would mean a merely
 * malformed `target` (e.g. `NaN`) starts CREDITING a positive `value` as
 * `'done'` (e.g. `{ value: 5, target: NaN }` would become `'done'`), which is
 * a strictly worse, over-counting failure mode than what already happens
 * today -- the division `v / target` evaluates to `NaN`, every comparison
 * against it is `false`, and the cascade already safely lands on `'miss'`
 * (this codebase's documented general preference for under-counting over
 * over-counting on an underspecified combination -- see `habitSchedule.ts`).
 * So the existing accidental-but-correct fallthrough is kept as the
 * mechanism, deliberately, rather than replaced with an explicit branch that
 * would change the answer.
 */
export function deriveState(input: DeriveStateInput): 'done' | 'partial' | 'miss' {
  const { trackingType, value, target, direction } = input;

  if (trackingType === 'binary' || trackingType === 'abstinence') {
    return value != null && value > 0 ? 'done' : 'miss';
  }

  // A ceiling: staying at or under the limit is a completed day, and 0 is the
  // best one. The at_least branch below would call that same day a `miss`.
  if (direction === 'at_most') {
    if (!ceilingTargetOk(target)) return value != null && value > 0 ? 'done' : 'miss';
    const r = ceilingRatio(value, target);
    // Nothing recorded is not evidence of having stayed under the limit.
    if (r == null) return 'miss';
    if (r >= 1) return 'done';
    return r > 0 ? 'partial' : 'miss';
  }

  // numeric / duration
  // `target` is deliberately NOT checked for non-finiteness here -- see the
  // doc comment above ("deliberately NOT symmetric with completionRatio").
  if (target == null || target <= 0) {
    return value != null && value > 0 ? 'done' : 'miss';
  }
  const v = value == null || Number.isNaN(value) || value < 0 ? 0 : value;
  const ratio = Math.min(v / target, 1);
  if (ratio >= 1) return 'done';
  if (ratio > 0) return 'partial';
  return 'miss';
}

/** True for a ratio strictly between 0 and 1 exclusive (§8.6's `partial` threshold). */
export function isPartial(ratio: number): boolean {
  return ratio > 0 && ratio < 1;
}

/**
 * Integer percent for UI display, from an already-computed ratio.
 *
 * Kept as a thin `ratio -> percent` step (rather than re-deriving the ratio
 * from `{trackingType,value,target}` itself) so it composes with either
 * `completionRatio` or any other ratio source (e.g. `habitStrength.ts`'s
 * per-log credit) without duplicating the branching above.
 *
 * Clamped to `[0, 100]` defensively — every producer of `ratio` in this file
 * already clamps to `[0, 1]`, so this should never actually trigger, but a
 * percent function that could return -5 or 140 for a malformed caller input
 * would be a worse failure mode than a silently-clamped display value.
 *
 * That same promise did NOT originally hold for a non-finite `ratio`
 * (FINDING A-01): `Math.max`/`Math.min` do not filter `NaN` out at all
 * (`Math.min(100, NaN)` is `NaN`, not `100`), so a `NaN` ratio used to leak
 * straight through as `NaN`, not a clamped integer. `completionRatio` no
 * longer produces `NaN` (see its own doc), but this function is guarded
 * independently here too, so the "never returns NaN" promise holds even for
 * a `ratio` that arrived from anywhere else.
 */
export function completionPercent(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0; // NaN/Infinity/-Infinity in -> 0 out, never NaN out.
  return Math.max(0, Math.min(100, Math.round(ratio * 100)));
}
