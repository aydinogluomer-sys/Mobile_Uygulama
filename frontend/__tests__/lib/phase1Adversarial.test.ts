/**
 * PHASE 1 QA — adversarial probes against the Coders' own test suites.
 *
 * This file does NOT re-test what habitEngine.test.ts / habitStrength.test.ts /
 * habitSchedule.test.ts / capacity.test.ts / recovery.test.ts already cover
 * (target null/0/negative, value negative/>target, skip-for-every-type, bucket
 * re-normalisation, the Gym 3x/week headline case, weekly_count/every_n_days/
 * date_range streakBroken, band boundaries, 5-easy/3-heavy canActivate, mastery
 * age boundary, deficitFor over-achievement, split even/odd, expirePlans day-
 * after boundary — all of that is already exercised there and independently
 * re-verified during this QA pass without needing a new assertion).
 *
 * Every `it` below is a case the existing suites do NOT cover. Each records
 * the ACTUAL behaviour observed against commit ec87457 — some are clean
 * passes (documented as such), some are genuine findings (see the QA report).
 */
import { completionRatio, completionPercent, deriveState } from '../../lib/habitEngine';
import { habitStrength, type StrengthLog } from '../../lib/habitStrength';
import { streakBroken, windowFor, isWindowSatisfied } from '../../lib/habitSchedule';
import { bandFor, dailyLoad, canActivate, habitLoad, type HabitLoadInput } from '../../lib/capacity';
import { planFromRow, type RecoveryStrategyV2 } from '../../lib/recovery';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

import { addDaysLocal, ymd } from '../../lib/date';
import type { Habit, HabitLog, RecoveryPlan, RecoveryStrategy } from '../../lib/supabase';

/** A persisted row, for the assertions below. */
const recoveryRow = (over: Partial<RecoveryPlan> = {}) => ({
  id: 'p1', user_id: 'u1', habit_id: 'h1', source_log_id: null,
  source_date: '2026-08-04', target_date: '2026-08-05',
  deficit_type: null, deficit_value: null,
  strategy: 'complete_today' as RecoveryStrategy, distributed_days: null,
  note: null, reminder_time: null, status: 'planned' as const,
  completed_at: null, created_at: '2026-08-04T10:00:00.000Z',
  ...over,
});

// ===========================================================================
// habitEngine — inputs the Coders' own suite did not try
// ===========================================================================

describe('completionRatio / completionPercent — NaN and Infinity inputs', () => {
  // FINDING A-01 (MAJOR): a NaN `value` or `target` is not clamped like a
  // negative value is — it falls through the `value < 0` guard (NaN < 0 is
  // ALWAYS false in JS) and poisons the division. completionPercent's own doc
  // promises "a percent function that could return -5 or 140 ... would be a
  // worse failure mode" and clamps defensively for exactly that reason — but
  // NaN slips past both clamps (`value == null || value < 0` is false for
  // NaN; `Math.max(0, Math.min(100, NaN))` is NaN, not 0 or 100).
  it('value: NaN now produces a clamped ratio of 0, not NaN (FINDING A-01 fixed)', () => {
    const ratio = completionRatio({ trackingType: 'numeric', state: 'partial', value: NaN, target: 10 });
    expect(Number.isNaN(ratio)).toBe(false);
    expect(ratio).toBe(0); // NaN value is now clamped the same way a negative value already was.
  });

  it('target: NaN also now produces a clamped ratio, not NaN (FINDING A-01 fixed, same root cause)', () => {
    const ratio = completionRatio({ trackingType: 'numeric', state: 'partial', value: 5, target: NaN });
    expect(Number.isNaN(ratio)).toBe(false);
    expect(ratio).toBe(0); // state 'partial' is not 'done', so the no-valid-target fallback yields 0.
  });

  it('the NaN ratio no longer propagates through completionPercent — "NaN%" no longer reaches the UI layer (FINDING A-01 fixed)', () => {
    const ratio = completionRatio({ trackingType: 'numeric', state: 'partial', value: NaN, target: 10 });
    const pct = completionPercent(ratio);
    expect(Number.isNaN(pct)).toBe(false);
    expect(pct).toBe(0); // clamped integer, per the function's own doc intent.
  });

  it('by contrast, deriveState degrades NaN safely to "miss" — the two functions are inconsistent on the same bad input', () => {
    // Not a bug in deriveState — its if/else cascade happens to fall through
    // to the final branch because every NaN comparison is false — but it
    // means completionRatio and deriveState react differently to identical
    // malformed input, which is worth knowing about.
    expect(deriveState({ trackingType: 'numeric', value: NaN, target: 10 })).toBe('miss');
    expect(deriveState({ trackingType: 'numeric', value: 5, target: NaN })).toBe('miss');
  });

  it('value: Infinity is handled correctly — clamps to ratio 1 via Math.min (clean)', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'partial', value: Infinity, target: 10 })).toBe(1);
  });

  it('target: Infinity is handled correctly — any finite value / Infinity -> ratio 0 (clean, mathematically sound)', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'partial', value: 5, target: Infinity })).toBe(0);
  });

  it('value: Number.MAX_SAFE_INTEGER over a normal target clamps to 1, no overflow (clean)', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'partial', value: Number.MAX_SAFE_INTEGER, target: 10 })).toBe(1);
  });
});

describe('completionRatio / completionPercent — floating-point sweep (clean)', () => {
  // Brute-forced every integer target 1..200 and every value 0..target through
  // completionRatio -> completionPercent, comparing against Math.round((value
  // / target) * 100) computed independently. Zero mismatches. Repeated here
  // with a decimal sweep (0.1-step targets/values, the classic 0.1+0.2 trap
  // territory) — also zero mismatches. completionRatio does not introduce any
  // rounding error beyond what plain `value/target` already has, and
  // Math.round absorbs ordinary fp noise at this scale without an off-by-one.
  it('no integer target/value pair (1..200) produces a percent different from a direct value/target*100 computation', () => {
    let mismatches = 0;
    for (let target = 1; target <= 200; target++) {
      for (let value = 0; value <= target; value++) {
        const pct = completionPercent(completionRatio({ trackingType: 'numeric', state: 'partial', value, target }));
        const expected = Math.round((value / target) * 100);
        if (pct !== expected) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('decimal-step target/value pairs (the 0.1+0.2 territory) also produce zero mismatches', () => {
    let mismatches = 0;
    for (let t = 1; t <= 50; t++) {
      const target = t * 0.1;
      for (let v = 0; v <= t; v++) {
        const value = v * 0.1;
        const pct = completionPercent(completionRatio({ trackingType: 'numeric', state: 'partial', value, target }));
        const expected = Math.round((value / target) * 100);
        if (pct !== expected) mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('the plan\'s own worked example (0.7 / 0.1) does not misround despite the classic binary fp artifact (0.7/0.1 === 6.999999999999999 in raw JS)', () => {
    // target > value here so the raw ratio is well inside [0,1]; picks a pair
    // whose naive division is known to carry fp noise (7/10 vs 1/10 -> 0.1/0.7).
    const ratio = completionRatio({ trackingType: 'numeric', state: 'partial', value: 0.1, target: 0.7 });
    expect(completionPercent(ratio)).toBe(14); // 0.1/0.7 = 0.142857... -> 14
  });
});

describe('completionRatio — skip vs miss are numerically INDISTINGUISHABLE at this layer (documented caveat, confirmed)', () => {
  // The module doc is explicit that this is deliberate and that callers who
  // aggregate ratios must check `state==='skip'` themselves. This test proves
  // the caveat is real: nothing in the returned NUMBER lets a downstream
  // consumer tell a sick day from a genuine failure — confirming the risk the
  // task asked to check for is real, and that it is exactly as documented
  // (not a hidden extra bug — habitStrength.ts is shown below to do the
  // required exclusion correctly).
  it('binary/abstinence: skip and miss are literally the same ratio (0) — state carries no extra signal here', () => {
    for (const trackingType of ['binary', 'abstinence'] as const) {
      const skipRatio = completionRatio({ trackingType, state: 'skip' });
      const missRatio = completionRatio({ trackingType, state: 'miss' });
      expect(skipRatio).toBe(0);
      expect(missRatio).toBe(0);
      expect(skipRatio).toBe(missRatio);
    }
  });

  it('numeric/duration: skip ALWAYS forces ratio 0 regardless of value — even a miss with partial progress (value>0) scores higher than a skip', () => {
    // completionRatio short-circuits on state==='skip' BEFORE looking at value/target
    // at all, so a habit that got 9/10 done but was then marked 'skip' loses that
    // partial credit entirely, whereas the identical value/target under 'miss' does
    // NOT discard it. This is the one place skip is numerically WORSE than a miss,
    // the opposite of the "skip must never be treated as a failure" intent — it is
    // simply out of `completionRatio`'s scope by design (its doc says the caller
    // must exclude skip days from aggregation itself; this proves why that
    // exclusion is load-bearing and not optional).
    for (const trackingType of ['numeric', 'duration'] as const) {
      const skipRatio = completionRatio({ trackingType, state: 'skip', value: 9, target: 10 });
      const missRatio = completionRatio({ trackingType, state: 'miss', value: 9, target: 10 });
      expect(skipRatio).toBe(0);
      expect(missRatio).toBe(0.9); // the miss keeps its partial value; skip does not
      expect(skipRatio).toBeLessThan(missRatio);
    }
    // Only when the miss ALSO has zero progress do the two collapse to the same number.
    for (const trackingType of ['numeric', 'duration'] as const) {
      const skipRatio = completionRatio({ trackingType, state: 'skip', value: 0, target: 10 });
      const zeroMissRatio = completionRatio({ trackingType, state: 'miss', value: 0, target: 10 });
      expect(skipRatio).toBe(zeroMissRatio);
    }
  });
});

// ===========================================================================
// habitStrength — inputs the Coders' own suite did not try
// ===========================================================================

const ASOF = new Date(2026, 7, 25); // 2026-08-25, a Tuesday
function daysAgo(n: number): string {
  return ymd(addDaysLocal(ASOF, -n));
}
function slog(daysBack: number, state: StrengthLog['state'], ratio?: number): StrengthLog {
  return { completed_at: daysAgo(daysBack), state, ...(ratio != null ? { ratio } : {}) };
}

describe('habitStrength — all-skip logs (division-by-zero risk, clean)', () => {
  it('7 days, every log a skip: no NaN, no crash, returns 0 (every bucket has zero expected days once skips are excluded)', () => {
    const since = addDaysLocal(ASOF, -6);
    const logs = [0, 1, 2, 3, 4, 5, 6].map((d) => slog(d, 'skip'));
    const result = habitStrength(logs, { asOf: ASOF, since });
    expect(Number.isNaN(result)).toBe(false);
    expect(result).toBe(0);
  });
});

describe('habitStrength — future-dated logs relative to asOf', () => {
  it('a log dated entirely in the future, with no other logs, is never visited by the day-offset loop -> 0, not a crash', () => {
    const future = slog(-5, 'done'); // 5 days AFTER asOf
    const result = habitStrength([future], { asOf: ASOF });
    expect(result).toBe(0);
  });

  it('a future-dated log mixed with valid recent logs is silently ignored — it never contributes credit either way', () => {
    const since = addDaysLocal(ASOF, -6);
    const future = slog(-5, 'done');
    const logs = [slog(0, 'done'), slog(1, 'done'), future];
    // days 2-6 have no log at all -> real misses (0 credit each, counted in denominator).
    // credit = 2, expected = 7 (the future log is never reached by the day-offset loop
    // since it only walks asOf-0 .. asOf-89, i.e. past/present days).
    expect(habitStrength(logs, { asOf: ASOF, since })).toBe(Math.round((2 / 7) * 100));
  });
});

describe('habitStrength — bucket boundary is exactly 30/31 days, not off-by-one (clean)', () => {
  it('a single done log 29 days back lands in the `mid` bucket (0.35 weight / 23-day denominator)', () => {
    const since = addDaysLocal(ASOF, -89);
    const result = habitStrength([slog(29, 'done')], { asOf: ASOF, since });
    // 0.35 weight * (1/23 rate) blended against the other two buckets' full-weight
    // 0-rate: matches a `mid`-bucket credit, not `long`.
    expect(result).toBe(Math.round((0.35 * (1 / 23) / 1.0) * 100));
  });

  it('a single done log 30 days back lands in the `long` bucket (0.15 weight / 60-day denominator) — one day over the line changes the bucket', () => {
    const since = addDaysLocal(ASOF, -89);
    const result = habitStrength([slog(30, 'done')], { asOf: ASOF, since });
    expect(result).toBe(Math.round((0.15 * (1 / 60) / 1.0) * 100));
  });
});

describe('habitStrength — logs older than 90 days are ignored, not bucketed (clean)', () => {
  it('a log 500 days back never enters any bucket; only the in-range logs are scored', () => {
    const since = addDaysLocal(ASOF, -6);
    const recentAllMiss = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ completed_at: daysAgo(d), state: 'miss' as const }));
    const veryOld = slog(500, 'done');
    const result = habitStrength([...recentAllMiss, veryOld], { asOf: ASOF, since });
    expect(result).toBe(0); // if the 500-day-old 'done' were somehow counted this would not be 0
  });
});

describe('habitStrength — duplicate logs for the same calendar day (FINDING A-02 fixed — now documented, behaviour intentionally unchanged)', () => {
  // habitStrength builds `logByDate` with `Map#set` in array order, so a
  // second log for a day already seen SILENTLY OVERWRITES the first — no
  // merge, no "latest wins by timestamp", no warning. Whichever entry is
  // LAST in the input array wins, regardless of which one is actually
  // correct/current. Unlike every other edge case in this file (skip
  // exclusion, re-normalisation, missing `since`), this specific behaviour
  // used NOT to be mentioned in the module's own extensive doc comments —
  // it now is, precisely at the dedup site in `habitStrength.ts` (see the
  // comment above the `logByDate` loop there). The behaviour itself was
  // judged correct as-is and left unchanged: `StrengthLog` carries no
  // `created_at`/timestamp to determine true recency, and a "best state
  // wins" rule would silently discard a legitimate correction (e.g. a
  // mistaken `'done'` fixed to `'miss'`) — see that file's doc for the full
  // reasoning.
  // Low real-world likelihood (the log store is expected to enforce one log
  // per habit per day), but this function has no defence if that invariant
  // is ever violated upstream, and the result becomes ordering-dependent.
  it('done-then-miss for the same day: the LATER array entry (miss) wins, silently', () => {
    const since = addDaysLocal(ASOF, -6);
    const logs = [0, 1, 2, 3, 4, 5, 6].map((d) => slog(d, 'done'));
    logs.push(slog(0, 'miss')); // second entry for day 0, appended later
    // If it were merged/summed or "first wins", this would be 100. It is not.
    expect(habitStrength(logs, { asOf: ASOF, since })).toBe(Math.round((6 / 7) * 100));
  });

  it('miss-then-done for the same day: the LATER array entry (done) wins — proves it is pure array order, not "worst wins" or "best wins"', () => {
    const since = addDaysLocal(ASOF, -6);
    const logs = [1, 2, 3, 4, 5, 6].map((d) => slog(d, 'done'));
    logs.push(slog(0, 'miss'));
    logs.push(slog(0, 'done')); // last entry for day 0
    expect(habitStrength(logs, { asOf: ASOF, since })).toBe(100);
  });
});

// ===========================================================================
// streakBroken — cases the headline Gym-3x/week suite did not try
// ===========================================================================

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1', user_id: 'u1', name: 'test', behavior_type: 'positive',
    frequency_config: { kind: 'daily' }, created_at: '2020-01-01T00:00:00Z',
    end_condition: null, target_direction: null, ...over,
  } as Habit;
}
function mkLog(habit_id: string, date: Date, state: HabitLog['state']): Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'> {
  return { habit_id, completed_at: ymd(date), state };
}

const MON = new Date(2026, 7, 3), TUE = new Date(2026, 7, 4), WED = new Date(2026, 7, 5);
const THU = new Date(2026, 7, 6), FRI = new Date(2026, 7, 7), SAT = new Date(2026, 7, 8), SUN = new Date(2026, 7, 9);

describe('streakBroken — front-loaded 3x/week (target met EARLY in the week, clean)', () => {
  it('Mon+Tue+Wed all done (3/3 by Wednesday): the streak stays unbroken for the REST of the week, every remaining day', () => {
    const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    const logs = [mkLog('h1', MON, 'done'), mkLog('h1', TUE, 'done'), mkLog('h1', WED, 'done')];
    for (const d of [THU, FRI, SAT, SUN]) {
      expect(streakBroken(h, logs, d)).toBe(false);
    }
  });
});

describe('streakBroken — week-start correctness on Sunday vs Monday (clean)', () => {
  it('Sunday: 2/3 done, 1 day left in the window (today) -> still mathematically reachable, not broken', () => {
    const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    const logs = [mkLog('h1', MON, 'done'), mkLog('h1', WED, 'done')];
    expect(streakBroken(h, logs, SUN)).toBe(false);
  });

  it('Monday of a FRESH week, 0 done anywhere: never broken on the first day of a new window', () => {
    const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    expect(streakBroken(h, [], MON)).toBe(false);
  });

  it('windowFor on a Sunday still resolves to THAT week\'s Mon..Sun (not the following week) — repo week starts Monday', () => {
    const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    const win = windowFor(h, SUN)!;
    expect(ymd(win.start)).toBe(ymd(MON));
    expect(ymd(win.end)).toBe(ymd(SUN));
  });

  it('windowFor on the Monday itself resolves to the SAME Mon..Sun window (not the prior week)', () => {
    const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    const win = windowFor(h, MON)!;
    expect(ymd(win.start)).toBe(ymd(MON));
    expect(ymd(win.end)).toBe(ymd(SUN));
  });
});

describe('streakBroken — monthly_count across a month boundary and a 28-day February (clean)', () => {
  const h = habit({ frequency_config: { kind: 'monthly', count: 8 } });

  it('windowFor resolves a non-leap February to exactly 28 days (Feb 1..Feb 28)', () => {
    const win = windowFor(h, new Date(2026, 1, 15))!;
    expect(ymd(win.start)).toBe('2026-02-01');
    expect(ymd(win.end)).toBe('2026-02-28');
  });

  it('8/8 met by the last day of February: not broken', () => {
    const logs = Array.from({ length: 8 }, (_, i) => mkLog('h1', new Date(2026, 1, i + 1), 'done'));
    expect(streakBroken(h, logs, new Date(2026, 1, 28))).toBe(false);
  });

  it('7/8 on Feb 28 itself (the last day): still NOT broken — 1 day remains (today) and exactly 1 is owed, still reachable', () => {
    const logs = Array.from({ length: 7 }, (_, i) => mkLog('h1', new Date(2026, 1, i + 1), 'done'));
    expect(streakBroken(h, logs, new Date(2026, 1, 28))).toBe(false);
  });

  it('6/8 on Feb 28 itself: genuinely broken — deficit 2 exceeds the 1 remaining day', () => {
    const logs = Array.from({ length: 6 }, (_, i) => mkLog('h1', new Date(2026, 1, i + 1), 'done'));
    expect(streakBroken(h, logs, new Date(2026, 1, 28))).toBe(true);
  });

  it('Feb 27 (2nd-to-last day), 0 done, 8 needed, only 2 days remain: mathematically impossible -> broken', () => {
    expect(streakBroken(h, [], new Date(2026, 1, 27))).toBe(true);
  });

  it('March 1st is a FRESH window: 0 done is not broken (new month resets the count)', () => {
    expect(streakBroken(h, [], new Date(2026, 2, 1))).toBe(false);
  });

  it('February\'s completions do NOT leak into March\'s window — evaluating March 1st against only Feb logs is still 0 done, still not broken', () => {
    const febLogs = Array.from({ length: 8 }, (_, i) => mkLog('h1', new Date(2026, 1, i + 1), 'done'));
    expect(streakBroken(h, febLogs, new Date(2026, 2, 1))).toBe(false);
    expect(isWindowSatisfied(h, febLogs, new Date(2026, 2, 1))).toBe(false); // proves it's "not broken because 0 needed yet", not "still counts as satisfied"
  });
});

// ===========================================================================
// capacity — bandFor/dailyLoad/canActivate edge inputs
// ===========================================================================

describe('bandFor — exact boundaries and out-of-range input (clean)', () => {
  it.each([[0, 'dusuk'], [40, 'dusuk'], [41, 'dengeli'], [70, 'dengeli'], [71, 'yuksek'], [85, 'yuksek'], [86, 'asiri'], [100, 'asiri']] as const)(
    'bandFor(%i) -> %s',
    (input, expected) => expect(bandFor(input)).toBe(expected)
  );

  it('negative input clamps to 0 -> dusuk, does not throw or return an invalid band', () => {
    expect(bandFor(-1)).toBe('dusuk');
    expect(bandFor(-1000)).toBe('dusuk');
  });

  it('input over 100 clamps to 100 -> asiri', () => {
    expect(bandFor(101)).toBe('asiri');
    expect(bandFor(1e9)).toBe('asiri');
  });

  it('NaN input returns the calm defensive floor ("dusuk") after F14 INT-18, not a crash or false overload ("asiri")', () => {
    expect(bandFor(NaN)).toBe('dusuk');
  });
});

describe('dailyLoad — zero habits and extreme overload (clean, no overflow)', () => {
  it('zero habits/tasks/focus/overdue normalises to 0, band dusuk', () => {
    expect(dailyLoad({ habits: [] })).toEqual({ raw: 0, normalised: 0, band: 'dusuk' });
  });

  it('20 maximally-heavy daily habits + heavy focus/overdue produces a large raw value but a CLAMPED normalised of exactly 100, not Infinity/overflow', () => {
    const heavy: HabitLoadInput = { difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' }, impact_level: 'critical' };
    const result = dailyLoad({ habits: Array.from({ length: 20 }, () => heavy), focusMinutes: 500, overdueCount: 50 });
    expect(result.raw).toBeGreaterThan(100); // raw is deliberately unclamped per the type's own doc
    expect(Number.isFinite(result.raw)).toBe(true);
    expect(result.normalised).toBe(100);
    expect(result.band).toBe('asiri');
  });
});

describe('canActivate — 5 easy vs 3 heavy holds from a REALISTIC non-zero baseline, not just from 0 (clean)', () => {
  // The existing capacity.test.ts suite already proves this from currentLoad:
  // 0 (a hand-picked empty-day baseline). This reproduces it starting from a
  // load actually PRODUCED by dailyLoad() for a plausible day — 2 medium
  // habits already active, 2 tasks, 90 minutes of focus logged, 1 overdue
  // item — to confirm the claim is not an artifact of starting at zero.
  const medium: HabitLoadInput = { difficulty: 3, estimated_minutes: 30, frequency_config: { kind: 'daily' }, impact_level: 'medium' };
  const easy: HabitLoadInput = { difficulty: 1, estimated_minutes: 10, frequency_config: { kind: 'daily' }, impact_level: 'low' };
  const heavy: HabitLoadInput = { difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' }, impact_level: 'critical' };

  const baseline = dailyLoad({
    habits: [medium, medium],
    tasks: [{ estimated_minutes: 20 }, { estimated_minutes: 45 }],
    focusMinutes: 90,
    overdueCount: 1,
  }).normalised;

  it('the realistic baseline itself is a plausible mid-range day, not 0 and not already maxed out', () => {
    expect(baseline).toBeGreaterThan(0);
    expect(baseline).toBeLessThan(85);
  });

  it('5 easy habits stacked one after another from this baseline are ALL allowed', () => {
    let load = baseline;
    for (let i = 0; i < 5; i++) {
      expect(canActivate({ currentLoad: load, habit: easy })).toBe(true);
      load += habitLoad(easy) * 18;
    }
  });

  it('the 3rd heavy habit stacked from the SAME baseline is refused, even though the 1st and 2nd are allowed', () => {
    let load = baseline;
    expect(canActivate({ currentLoad: load, habit: heavy })).toBe(true);
    load += habitLoad(heavy) * 18;
    expect(canActivate({ currentLoad: load, habit: heavy })).toBe(true);
    load += habitLoad(heavy) * 18;
    expect(canActivate({ currentLoad: load, habit: heavy })).toBe(false); // the plan's requirement, from a non-zero start
  });
});

// ===========================================================================
// recovery — the legacy adapter round-trip
// ===========================================================================


describe('completionRatio / completionPercent — full non-finite sweep (new coverage, FINDING A-01 fixed)', () => {
  const NON_FINITE = [NaN, Infinity, -Infinity] as const;

  it('every non-finite value, against a normal target, produces a finite ratio in [0,1]', () => {
    for (const value of NON_FINITE) {
      const ratio = completionRatio({ trackingType: 'numeric', state: 'partial', value, target: 10 });
      expect(Number.isFinite(ratio)).toBe(true);
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    }
  });

  it('every non-finite target, against a normal value, produces a finite ratio in [0,1]', () => {
    for (const target of NON_FINITE) {
      const ratio = completionRatio({ trackingType: 'numeric', state: 'partial', value: 5, target });
      expect(Number.isFinite(ratio)).toBe(true);
      expect(ratio).toBeGreaterThanOrEqual(0);
      expect(ratio).toBeLessThanOrEqual(1);
    }
  });

  it('every non-finite value x non-finite target x state combination produces a finite completionPercent, never NaN', () => {
    for (const value of NON_FINITE) {
      for (const target of NON_FINITE) {
        for (const state of ['done', 'partial', 'miss', 'skip'] as const) {
          const pct = completionPercent(completionRatio({ trackingType: 'numeric', state, value, target }));
          expect(Number.isNaN(pct)).toBe(false);
          expect(pct).toBeGreaterThanOrEqual(0);
          expect(pct).toBeLessThanOrEqual(100);
        }
      }
    }
  });

  it('completionPercent itself never returns NaN for a directly non-finite ratio, independent of completionRatio', () => {
    for (const ratio of NON_FINITE) {
      const pct = completionPercent(ratio);
      expect(Number.isNaN(pct)).toBe(false);
      expect(pct).toBe(0);
    }
  });

  it('previously-clean Infinity behaviour is still intact after the fix: value:Infinity still clamps to ratio 1, target:Infinity still yields ratio 0 for a non-done state', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'partial', value: Infinity, target: 10 })).toBe(1);
    expect(completionRatio({ trackingType: 'numeric', state: 'partial', value: 5, target: Infinity })).toBe(0);
  });
});

describe('recovery — FINDING A-03 is now structurally impossible (the adapter is gone)', () => {
  /**
   * A-03 was a semantic INVERSION: `strategyFromLegacy('mini')` returned
   * `'complete_today'` while `strategyToLegacy('skip')` returned `'mini'`, so
   * a user who explicitly declined to recover came back out of the database
   * reading as "I completed the recovery". It was fixed by making the pairing
   * a bijection, and the tests that used to live here exercised that
   * bijection in both directions.
   *
   * The bijection no longer exists, because the translation no longer exists.
   * `013_recovery_vocabulary` made `recovery_plans.strategy` accept the
   * domain's own four words, so there is nothing to map and no direction to
   * get backwards.
   *
   * A test of a deleted function would be noise. What is worth keeping is the
   * PROPERTY A-03 violated — that a stored strategy means what it says — and
   * the only way to break it now is to reintroduce a mapping. So that is what
   * these assert.
   */
  it('the persisted vocabulary IS the domain vocabulary', () => {
    // `RecoveryStrategy` (the row) and `RecoveryStrategyV2` (the domain) are
    // the same type. If someone reintroduces a second spelling, this file
    // stops compiling rather than silently translating again.
    const domain: RecoveryStrategyV2[] = ['complete_today', 'push_tomorrow', 'split_two_days', 'skip'];
    const row: RecoveryStrategy[] = domain;
    expect(row).toEqual(domain);
  });

  it('lib/recovery.ts contains no strategy or status translation', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'lib', 'recovery.ts'), 'utf8');
    for (const gone of ['strategyToLegacy', 'strategyFromLegacy', 'statusToLegacy', 'statusFromLegacy',
                        'toLegacyRecoveryPlan', 'fromLegacyRecoveryPlan']) {
      expect(src).not.toContain(gone);
    }
  });

  it('no legacy strategy word survives anywhere in the recovery path', () => {
    // The words themselves are the tell. `'mini'` in particular meant a size
    // v2 has no concept of, so any reappearance is a translation coming back.
    for (const rel of [['lib', 'recovery.ts'], ['services', 'recoveryService.ts'],
                       ['repositories', 'recoveryRepository.ts'], ['store', 'recoveryStore.ts']]) {
      const src = stripComments(readFileSync(join(__dirname, '..', '..', ...rel), 'utf8'));
      for (const legacy of ["'full'", "'half'", "'mini'", "'reschedule'"]) {
        expect({ file: rel.join('/'), legacy, found: src.includes(legacy) })
          .toEqual({ file: rel.join('/'), legacy, found: false });
      }
    }
  });

  it('a plan keeps the strategy it was given, with no round trip to lose it', () => {
    for (const strategy of ['complete_today', 'push_tomorrow', 'split_two_days', 'skip'] as const) {
      expect(planFromRow(recoveryRow({ strategy })).strategy).toBe(strategy);
    }
  });

  it('"skip" cannot become "complete_today"', () => {
    // The exact inversion A-03 was, asserted against the path that exists now.
    expect(planFromRow(recoveryRow({ strategy: 'skip' })).strategy).toBe('skip');
  });
});

