/**
 * Habit Engine V2 — completion semantics.  (task 1-W1, IMPLEMENTATION_V2.md §8)
 *
 * Pure domain logic. No I/O, no `supabase` import, no network. This module is
 * the part of Phase 1 that is not blocked by the Supabase outage: it defines
 * how a single log's numbers turn into a ratio, a percent and a state, and it
 * is deliberately independent of persistence.
 *
 * ## Why a V2 tracking-type union when the DB only has two values
 *
 * `lib/supabase.ts`'s `Habit.tracking_type` is `'boolean' | 'numeric'` and
 * **must not change** — that would be a migration, and migrations are
 * blocked. §8 of the plan calls for FOUR tracking types
 * (`binary | numeric | duration | abstinence`). `adaptTrackingType` below is
 * the seam: it maps today's two persisted values onto the V2 union so this
 * engine already works against real data, and is ready the moment the
 * migration lands without anyone having to touch its call sites.
 */
import type { Habit } from './supabase';

/** V2 tracking type (§8). Not persisted as-is — see `adaptTrackingType`. */
export type TrackingType = 'binary' | 'numeric' | 'duration' | 'abstinence';

/** V2 log state (§8.5). `skip` must never be treated as a failure by a caller. */
export type HabitLogState = 'done' | 'partial' | 'miss' | 'skip';

/**
 * Derives the V2 `TrackingType` from what is actually persisted today.
 *
 * Mapping:
 *  - `behavior_type === 'negative'` → `'abstinence'`. A negative/avoidance
 *    habit ("sigara içme") is, conceptually, always abstinence-tracked —
 *    regardless of what `tracking_type` happens to hold — because the thing
 *    being measured is "did I abstain today", not a quantity. Checking
 *    `behavior_type` first (rather than `tracking_type`) keeps this mapping
 *    correct even though today's UI only ever writes `'boolean'` for
 *    negative habits.
 *  - otherwise `tracking_type === 'numeric'` → `'numeric'`.
 *  - otherwise (`'boolean'`, or anything unrecognised) → `'binary'`. Falling
 *    back to `'binary'` for an unrecognised value is the conservative choice:
 *    a binary habit can only ever be marked done/not-done, so an unknown
 *    input can never be silently over-credited the way a numeric guess could.
 *
 * `'duration'` is **never** produced by this adapter. Today's schema has no
 * field that distinguishes "numeric with a duration unit" from any other
 * numeric habit (`habits.unit` is free text — `'dakika'` and `'sayfa'` look
 * identical to the type system). `'duration'` exists in the V2 union so the
 * rest of this engine (and its tests) can express the plan's duration case
 * precisely; a habit can only actually acquire it once the blocked migration
 * adds a dedicated column, at which point this adapter gets a third branch.
 */
export function adaptTrackingType(habit: Pick<Habit, 'tracking_type' | 'behavior_type'>): TrackingType {
  if (habit.behavior_type === 'negative') return 'abstinence';
  return habit.tracking_type === 'numeric' ? 'numeric' : 'binary';
}

export type CompletionRatioInput = {
  trackingType: TrackingType;
  /** The already-decided outcome for this log, when one exists. */
  state: HabitLogState;
  value?: number | null;
  target?: number | null;
};

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
  const { trackingType, state, value, target } = input;

  if (state === 'skip') return 0; // bkz. yukarıdaki not — 0 burada "ceza" değil, dışlanması gereken bir sinyalin yer tutucusudur.

  switch (trackingType) {
    case 'binary':
    case 'abstinence':
      return state === 'done' ? 1 : 0;

    case 'numeric':
    case 'duration': {
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
  const { trackingType, value, target } = input;

  if (trackingType === 'binary' || trackingType === 'abstinence') {
    return value != null && value > 0 ? 'done' : 'miss';
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
