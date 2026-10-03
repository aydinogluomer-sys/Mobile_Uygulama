/**
 * Behavior Intelligence Engine tests.  (Phase 2, CODER-G, plan §11 / Gate C)
 *
 * Pure domain tests -- no I/O, no Supabase, no store.
 *
 * TZ is pinned globally to Europe/Istanbul (jest.setup.js), matching every
 * other lib test in this suite. `asOf` is always pinned explicitly so a
 * result never depends on when the suite happens to run.
 *
 * GATE C ("Analytics values raw database samples ile karşılaştırılacaktır ...
 * AI kullanılmadan doğru çalışmalıdır") requires exact reproducibility by
 * hand from raw log rows. The three `describe('Gate C ...')` blocks below
 * each carry the hand-worked arithmetic in a comment immediately above the
 * assertion it backs, and assert exact equality -- never `toBeCloseTo`
 * unless the true mathematical answer is itself not exactly representable
 * in binary floating point (documented inline where that applies).
 */
import {
  weekdayBreakdown,
  bestWeekday,
  worstWeekday,
  habitCompletionRate,
  currentStreak,
  longestStreak,
  streakStability,
  habitFragility,
  mostFragileHabit,
  strongestHabit,
  completionTrend,
  mostRecoveredHabit,
  recoverySuccessRate,
  morningEveningDifference,
  MIN_WEEKDAY_SAMPLES,
  MIN_WEEKS_FOR_FRAGILITY,
  type BIHabit,
  type BILog,
  type BIRecoveryPlan,
} from '../../lib/behaviorIntelligence';
import { ymd, addDaysLocal } from '../../lib/date';

// ---------------------------------------------------------------------------
// fixture helpers
// ---------------------------------------------------------------------------

/** Minimal daily habit, due every calendar day from `createdAt` onward. */
function dailyHabit(id: string, createdAt: string): BIHabit {
  return {
    id,
    name: `daily-${id}`,
    behavior_type: 'positive',
    created_at: `${createdAt}T00:00:00.000Z`,
    end_condition: null,
    frequency_config: { kind: 'daily' },
  };
}

/** Weekly habit due on specific weekdays (0=Pzt ... 6=Paz). */
function weeklyDaysHabit(id: string, createdAt: string, days: number[]): BIHabit {
  return {
    id,
    name: `weekly-${id}`,
    behavior_type: 'positive',
    created_at: `${createdAt}T00:00:00.000Z`,
    end_condition: null,
    frequency_config: { kind: 'weekly', days },
  };
}

function log(habit_id: string, completed_at: string, state: BILog['state']): BILog {
  return { habit_id, completed_at, state };
}

// ===========================================================================
// GATE C -- completion rate exact
// ===========================================================================

describe('Gate C -- habitCompletionRate is exactly reproducible by hand', () => {
  it('a 3x/week habit (Pzt/Çar/Cum) over one calendar week scores exactly 2/3, not 2/7', () => {
    // 2026-08-03 is a Monday (Pzt). Range = the full week 08-03..08-09.
    const habit = weeklyDaysHabit('h1', '2026-07-01', [0, 2, 4]); // Pzt, Çar, Cum
    // Due days in range: 08-03 (Pzt), 08-05 (Çar), 08-07 (Cum) -- exactly 3.
    const logs: BILog[] = [
      log('h1', '2026-08-03', 'done'),
      // 08-05: no log at all -> a real miss.
      log('h1', '2026-08-07', 'partial'),
    ];
    // BY HAND: scheduled = 3 (08-03, 08-05, 08-07). completed (done|partial) =
    // 2 (08-03 done, 08-07 partial); 08-05 has no log so it does not count.
    // rate = 2 / 3.
    const result = habitCompletionRate(habit, logs, { start: '2026-08-03', end: '2026-08-09' });
    expect(result).toEqual({ ok: true, value: 2 / 3 });
    // Proves the denominator is SCHEDULED days, not the 7 calendar days in
    // range -- against 7 the same numerator would read 2/7 (~0.286), a
    // completely different (and wrong) number.
    expect(result.ok && result.value).not.toBeCloseTo(2 / 7, 2);
  });

  it('skip is excluded from BOTH numerator and denominator, not just the numerator', () => {
    const habit = dailyHabit('h2', '2026-08-01');
    const logs: BILog[] = [
      log('h2', '2026-08-01', 'done'),
      log('h2', '2026-08-02', 'skip'),
      // 08-03: no log -> a real miss.
    ];
    // BY HAND: due days = 08-01, 08-02, 08-03 (3 calendar days, daily habit).
    // 08-02 is `skip` -> removed from BOTH sides entirely, so it is as if
    // that day never existed for this habit. Remaining scheduled = 2
    // (08-01, 08-03); completed = 1 (08-01). rate = 1 / 2.
    // A wrong implementation that only strips skip from the numerator would
    // compute 1/3 instead -- a different, distinguishable number.
    const result = habitCompletionRate(habit, logs, { start: '2026-08-01', end: '2026-08-03' });
    expect(result).toEqual({ ok: true, value: 1 / 2 });
  });

  it('returns the explicit insufficient-data signal, never a fabricated 0, when nothing was ever scheduled', () => {
    // Habit created AFTER the queried range -- zero due days exist in range.
    const habit = dailyHabit('h3', '2026-09-01');
    const result = habitCompletionRate(habit, [], { start: '2026-08-01', end: '2026-08-07' });
    expect(result.ok).toBe(false);
    expect(result).not.toEqual({ ok: true, value: 0 });
  });
});

// ===========================================================================
// GATE C -- streak exact
// ===========================================================================

describe('Gate C -- currentStreak is exactly reproducible by hand', () => {
  it('walks back from asOf, skips are transparent, and a due-but-unmet day stops the count', () => {
    const asOf = new Date(2026, 7, 6); // 2026-08-06, Thursday
    const habit = dailyHabit('h4', '2026-07-01');
    const logs: BILog[] = [
      log('h4', '2026-08-06', 'done'),    // asOf itself
      log('h4', '2026-08-05', 'done'),
      log('h4', '2026-08-04', 'skip'),    // transparent -- neither breaks nor counts
      log('h4', '2026-08-03', 'done'),
      log('h4', '2026-08-02', 'partial'),
      // 2026-08-01: no log at all -> due, unmet -> streak stops BEFORE this day
    ];
    // BY HAND, walking backward from 08-06:
    //  08-06 done    -> count=1
    //  08-05 done    -> count=2
    //  08-04 skip    -> excluded, count stays 2
    //  08-03 done    -> count=3
    //  08-02 partial -> count=4
    //  08-01 no log  -> due & unmet -> STOP. Final streak = 4.
    expect(currentStreak(habit, logs, asOf)).toBe(4);
  });

  it('a due, unmet day at asOf itself yields a streak of exactly 0 (no grace period)', () => {
    const asOf = new Date(2026, 7, 10);
    const habit = dailyHabit('h5', '2026-08-01');
    const logs: BILog[] = [log('h5', '2026-08-09', 'done')]; // yesterday was fine, today has no log
    expect(currentStreak(habit, logs, asOf)).toBe(0);
  });

  it('longestStreak resets on a due miss and reports the peak run, not the final one', () => {
    const asOf = new Date(2026, 7, 10);
    const habit = dailyHabit('h6', '2026-08-01');
    // due days 08-01..08-10 (10 days). Pattern: done x4, miss, done x2, miss, done x1, (asOf=08-10 done)
    const states: [string, BILog['state']][] = [
      ['2026-08-01', 'done'], ['2026-08-02', 'done'], ['2026-08-03', 'done'], ['2026-08-04', 'done'],
      // 08-05: no log -> miss, breaks the run of 4
      ['2026-08-06', 'done'], ['2026-08-07', 'done'],
      // 08-08: no log -> miss, breaks the run of 2
      ['2026-08-09', 'done'], ['2026-08-10', 'done'],
    ];
    const logs = states.map(([d, s]) => log('h6', d, s));
    // BY HAND: runs are [4] (08-01..04), [2] (08-06..07), [2] (08-09..10).
    // Longest = 4. Current (walking back from asOf=08-10) = 2.
    expect(longestStreak(habit, logs, { asOf })).toBe(4);
    expect(currentStreak(habit, logs, asOf)).toBe(2);
  });
});

// ===========================================================================
// GATE C -- recovery rate exact
// ===========================================================================

describe('Gate C -- recoverySuccessRate is exactly reproducible by hand', () => {
  it('5 plans (2 completed, 1 expired, 1 cancelled, 1 still planned) -> exactly 0.5', () => {
    const plans: BIRecoveryPlan[] = [
      { habit_id: 'a', status: 'completed' },
      { habit_id: 'a', status: 'completed' },
      { habit_id: 'b', status: 'expired' },
      { habit_id: 'b', status: 'cancelled' },
      { habit_id: 'c', status: 'planned' }, // still open -- outcome unknown, excluded
    ];
    // BY HAND: resolved plans (status !== 'planned') = 4 (2 completed, 1
    // expired, 1 cancelled). completed = 2. rate = 2 / 4 = 0.5 exactly.
    const result = recoverySuccessRate(plans);
    expect(result).toEqual({ ok: true, value: 0.5 });
  });

  it('returns the insufficient-data signal, not 0, when every plan is still planned', () => {
    const plans: BIRecoveryPlan[] = [{ habit_id: 'a', status: 'planned' }];
    const result = recoverySuccessRate(plans);
    expect(result.ok).toBe(false);
    expect(result).not.toEqual({ ok: true, value: 0 });
  });

  it('returns the insufficient-data signal for an empty plan list', () => {
    expect(recoverySuccessRate([]).ok).toBe(false);
  });

  it('mostRecoveredHabit ranks by actually-completed recoveries, not merely offered/declined ones', () => {
    const plans: BIRecoveryPlan[] = [
      { habit_id: 'x', status: 'completed' },
      { habit_id: 'x', status: 'completed' },
      { habit_id: 'y', status: 'completed' },
      { habit_id: 'y', status: 'cancelled' }, // declined -- not a completed recovery
      { habit_id: 'y', status: 'cancelled' },
    ];
    // x has 2 completed recoveries, y has only 1 -- x wins even though y has
    // more total rows, because "en sık telafi edilen" means actually
    // recovered, not merely offered a recovery plan.
    expect(mostRecoveredHabit(plans)).toEqual({ ok: true, value: { habitId: 'x', count: 2 } });
  });

  it('mostRecoveredHabit returns insufficient data when nothing was ever completed', () => {
    const plans: BIRecoveryPlan[] = [{ habit_id: 'x', status: 'cancelled' }];
    expect(mostRecoveredHabit(plans).ok).toBe(false);
  });
});

// ===========================================================================
// weekday breakdown -- scheduled-day aware, min-sample gated
// ===========================================================================

describe('weekdayBreakdown / bestWeekday / worstWeekday', () => {
  it('finds Monday as best and Tuesday as worst across a 3-week range, each with >= min sample', () => {
    const habit = dailyHabit('w1', '2026-08-01');
    const logs: BILog[] = [];
    // Range: 2026-08-03 (Mon) .. 2026-08-23 (Sun) -- exactly 3 of each weekday.
    for (let i = 0; i < 21; i++) {
      const d = ymd(addDaysLocal(new Date(2026, 7, 3), i));
      const dow = new Date(2026, 7, 3 + i).getDay(); // 1=Mon ... 0=Sun (JS)
      if (dow === 1) logs.push(log('w1', d, 'done'));       // Monday: always done -> rate 1
      else if (dow === 2) { /* Tuesday: never logged -> rate 0 */ }
      else logs.push(log('w1', d, i % 2 === 0 ? 'done' : 'miss')); // strictly between 0 and 1
    }
    const stats = weekdayBreakdown([habit], logs, { start: '2026-08-03', end: '2026-08-23' });
    expect(stats).toHaveLength(7);
    stats.forEach((s) => expect(s.scheduled).toBeGreaterThanOrEqual(MIN_WEEKDAY_SAMPLES));

    const best = bestWeekday(stats);
    const worst = worstWeekday(stats);
    expect(best).toEqual({ ok: true, value: expect.objectContaining({ weekday: 0, rate: 1 }) }); // Pzt = index 0
    expect(worst).toEqual({ ok: true, value: expect.objectContaining({ weekday: 1, rate: 0 }) }); // Sal = index 1
  });

  it('returns insufficient data when no weekday has reached the minimum sample size', () => {
    const habit = weeklyDaysHabit('w2', '2026-08-01', [0]); // due Monday only
    const logs: BILog[] = [log('w2', '2026-08-03', 'done')];
    // Only 1 Monday in range -- below MIN_WEEKDAY_SAMPLES (3).
    const stats = weekdayBreakdown([habit], logs, { start: '2026-08-03', end: '2026-08-09' });
    expect(bestWeekday(stats).ok).toBe(false);
    expect(worstWeekday(stats).ok).toBe(false);
  });
});

// ===========================================================================
// fragility -- variance-based, NOT a plain low-completion-rate check
// ===========================================================================

describe('habitFragility / mostFragileHabit -- volatility, not just a low rate', () => {
  const asOf = new Date(2026, 7, 30); // Sunday 2026-08-30

  it('a habit oscillating 100/0/100/0 across 4 weeks is judged MORE fragile than one steady at 60%, even though the steady one is NOT higher on average by definition here', () => {
    // Volatile habit: due Monday only, one due day per week.
    const volatile = weeklyDaysHabit('v', '2026-07-01', [0]);
    const volatileLogs: BILog[] = [
      log('v', '2026-08-03', 'done'), // week 1 Monday -> rate 1
      // 2026-08-10 Monday: no log -> rate 0
      log('v', '2026-08-17', 'done'), // week 3 Monday -> rate 1
      // 2026-08-24 Monday: no log -> rate 0
    ];

    // Steady habit: due Mon-Fri, 3 done + 2 miss every week -> rate 0.6 every week.
    const steady = weeklyDaysHabit('s', '2026-07-01', [0, 1, 2, 3, 4]);
    const steadyLogs: BILog[] = [];
    const weekStarts = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'];
    for (const ws of weekStarts) {
      const monday = new Date(Number(ws.slice(0, 4)), Number(ws.slice(5, 7)) - 1, Number(ws.slice(8, 10)));
      steadyLogs.push(log('s', ymd(monday), 'done'));
      steadyLogs.push(log('s', ymd(addDaysLocal(monday, 1)), 'done'));
      steadyLogs.push(log('s', ymd(addDaysLocal(monday, 2)), 'done'));
      // Thu/Fri: no log -> miss. 3 done / 5 due = 0.6.
    }

    // BY HAND: volatile weekly rates = [1, 0, 1, 0] -> mean 0.5, variance
    // = ((0.5)^2 * 4) / 4 = 0.25, stdDev = 0.5, volatility = min(1, 0.5*2) = 1.
    // steady weekly rates = [0.6, 0.6, 0.6, 0.6] -> variance 0, stdDev 0,
    // volatility = 0.
    const volatileResult = habitFragility(volatile, volatileLogs, { weeks: 4, asOf });
    const steadyResult = habitFragility(steady, steadyLogs, { weeks: 4, asOf });
    expect(volatileResult).toEqual({ ok: true, value: expect.objectContaining({ volatility: 1, weeksUsed: 4 }) });
    expect(steadyResult).toEqual({ ok: true, value: expect.objectContaining({ volatility: 0, weeksUsed: 4 }) });
    expect(volatileResult.ok && steadyResult.ok && volatileResult.value.volatility)
      .toBeGreaterThan(steadyResult.ok ? steadyResult.value.volatility : -1);

    const worst = mostFragileHabit([volatile, steady], [...volatileLogs, ...steadyLogs], { weeks: 4, asOf });
    expect(worst).toEqual({ ok: true, value: { habitId: 'v', volatility: 1 } });
  });

  it('returns insufficient data below the minimum week count', () => {
    const habit = dailyHabit('f2', '2026-08-28'); // only ~2 days of history before asOf
    const result = habitFragility(habit, [], { weeks: 4, asOf });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
    expect(MIN_WEEKS_FOR_FRAGILITY).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// strongest habit -- reuses habitStrength, does not duplicate it
// ===========================================================================

describe('strongestHabit', () => {
  const asOf = new Date(2026, 7, 25);

  it('picks the habit with the higher time-weighted habitStrength, excluding under-sampled habits', () => {
    const weak = dailyHabit('sw', '2026-08-18');
    const weakLogs: BILog[] = [
      log('sw', '2026-08-23', 'miss'), log('sw', '2026-08-24', 'miss'), log('sw', '2026-08-25', 'miss'),
    ];
    const strong = dailyHabit('ss', '2026-08-18');
    const strongLogs: BILog[] = [
      log('ss', '2026-08-23', 'done'), log('ss', '2026-08-24', 'done'), log('ss', '2026-08-25', 'done'),
    ];
    const result = strongestHabit([weak, strong], [...weakLogs, ...strongLogs], { asOf });
    expect(result.ok).toBe(true);
    expect(result.ok && result.value.habitId).toBe('ss');
  });

  it('returns insufficient data when no habit has enough non-skip logs', () => {
    const habit = dailyHabit('sx', '2026-08-24');
    const logs: BILog[] = [log('sx', '2026-08-25', 'done')]; // only 1 log
    const result = strongestHabit([habit], logs, { asOf });
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// trend -- direction + magnitude, handles a shorter history than the window
// ===========================================================================

describe('completionTrend', () => {
  it('reports improving with exact magnitude when only 3 of 4 requested weeks have data (habit born mid-window)', () => {
    const asOf = new Date(2026, 7, 30); // Sunday 2026-08-30
    // Habit created 2026-08-10 -- the oldest of the 4 requested weeks
    // (2026-08-03..09) has ZERO due days and is excluded entirely.
    const habit = dailyHabit('t1', '2026-08-10');
    const logs: BILog[] = [];
    // Week A: 2026-08-10..16 (7 due days, habit born on the 10th) -> 1 done.
    logs.push(log('t1', '2026-08-10', 'done'));
    // Week B: 2026-08-17..23 (7 due days) -> 4 done.
    ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20'].forEach((d) => logs.push(log('t1', d, 'done')));
    // Week C: 2026-08-24..30 (7 due days, includes asOf) -> 6 done.
    ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29']
      .forEach((d) => logs.push(log('t1', d, 'done')));

    // BY HAND: weekly rates in chronological order = [1/7, 4/7, 6/7] (only 3
    // weeks carry data -- the pre-creation week is skipped, not a 0). n=3,
    // halfSize=floor(3/2)=1 -> firstHalf=[1/7] (oldest), secondHalf=[6/7]
    // (newest); the middle week (4/7) is dropped so both halves stay
    // balanced. magnitude = 6/7 - 1/7 computed with the SAME floating-point
    // division-then-subtraction order the implementation uses, so the
    // comparison is bit-exact even though 1/7 has no exact binary form.
    const result = completionTrend([habit], logs, { weeks: 4, asOf });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.direction).toBe('improving');
      expect(result.value.magnitude).toBe(6 / 7 - 1 / 7);
      expect(result.value.weeksUsed).toBe(3);
      expect(result.value.weeksRequested).toBe(4);
      expect(result.value.partialWindow).toBe(true);
    }
  });

  it('returns insufficient data with fewer than 2 weeks of history', () => {
    const asOf = new Date(2026, 7, 30);
    const habit = dailyHabit('t2', '2026-08-28'); // only 2-3 days old
    const logs: BILog[] = [log('t2', '2026-08-29', 'done')];
    const result = completionTrend([habit], logs, { weeks: 12, asOf });
    expect(result.ok).toBe(false);
  });
});

// ===========================================================================
// morning/evening -- honest unsupported signal, not a fabricated split
// ===========================================================================

describe('morningEveningDifference', () => {
  it('always returns the explicit unsupported signal -- habit_logs.completed_at carries no time-of-day', () => {
    const result = morningEveningDifference();
    expect(result.ok).toBe(false);
    expect(result).not.toEqual({ ok: true, value: expect.anything() });
  });
});

// ===========================================================================
// streak stability
// ===========================================================================

describe('streakStability', () => {
  it('is current/longest -- 2/4 = 0.5 for the earlier longestStreak fixture', () => {
    const asOf = new Date(2026, 7, 10);
    const habit = dailyHabit('ss1', '2026-08-01');
    const states: [string, BILog['state']][] = [
      ['2026-08-01', 'done'], ['2026-08-02', 'done'], ['2026-08-03', 'done'], ['2026-08-04', 'done'],
      ['2026-08-06', 'done'], ['2026-08-07', 'done'],
      ['2026-08-09', 'done'], ['2026-08-10', 'done'],
    ];
    const logs = states.map(([d, s]) => log('ss1', d, s));
    const result = streakStability(habit, logs, { asOf });
    expect(result).toEqual({ ok: true, value: 0.5 }); // 2 / 4
  });

  it('returns insufficient data when the habit has never completed a scheduled day', () => {
    const asOf = new Date(2026, 7, 10);
    const habit = dailyHabit('ss2', '2026-08-01');
    const result = streakStability(habit, [], { asOf });
    expect(result.ok).toBe(false);
  });
});

// =============================================================================
// R01.02-b -- count-based schedules ("3 a week", "10 a month")
// =============================================================================

/** Weekly habit with a count target and no fixed days. */
function weeklyCountHabit(id: string, createdAt: string, count: number): BIHabit {
  return {
    id,
    name: `weekly-count-${id}`,
    behavior_type: 'positive',
    created_at: `${createdAt}T00:00:00.000Z`,
    end_condition: null,
    frequency_config: { kind: 'weekly', count },
  };
}

describe('R01.02-b -- habitCompletionRate on count-based schedules', () => {
  // Week Mon 2026-08-03 .. Sun 2026-08-09.
  it('Tue/Thu/Sun for "3 a week" is exactly 3/3 -- the invented Mon/Wed/Sat denominator is gone', () => {
    const habit = weeklyCountHabit('c1', '2026-07-01', 3);
    const logs = [log('c1', '2026-08-04', 'done'), log('c1', '2026-08-06', 'done'), log('c1', '2026-08-09', 'done')];
    expect(habitCompletionRate(habit, logs, { start: '2026-08-03', end: '2026-08-09' })).toEqual({ ok: true, value: 1 });
  });

  it('two of three is 2/3, never 2/7', () => {
    const habit = weeklyCountHabit('c1', '2026-07-01', 3);
    const logs = [log('c1', '2026-08-04', 'done'), log('c1', '2026-08-06', 'partial')];
    const r = habitCompletionRate(habit, logs, { start: '2026-08-03', end: '2026-08-09' });
    expect(r.ok && r.value).toBeCloseTo(2 / 3, 10);
  });

  it('a count habit with no target is insufficient data, not 0', () => {
    const habit = weeklyCountHabit('c1', '2026-07-01', 0);
    expect(habitCompletionRate(habit, [log('c1', '2026-08-04', 'done')], { start: '2026-08-03', end: '2026-08-09' }).ok).toBe(false);
  });
});

describe('R01.02-b -- weekdayBreakdown excludes count-based habits', () => {
  it('a flexible habit contributes no weekday obligation, so no weekday rate', () => {
    const habit = weeklyCountHabit('c1', '2026-07-01', 3);
    const logs = [log('c1', '2026-08-04', 'done'), log('c1', '2026-08-06', 'done'), log('c1', '2026-08-09', 'done')];
    const stats = weekdayBreakdown([habit], logs, { start: '2026-07-06', end: '2026-08-30' });
    expect(stats.every((s) => s.scheduled === 0 && s.completed === 0)).toBe(true);
    expect(bestWeekday(stats).ok).toBe(false); // honest: insufficient, not "Tuesday is your best day"
  });

  it('fixed-day habits still produce weekday stats alongside a flexible one', () => {
    const fixed = weeklyDaysHabit('f1', '2026-07-01', [1]); // Tuesdays only
    const flex = weeklyCountHabit('c1', '2026-07-01', 3);
    const logs = [log('f1', '2026-08-04', 'done'), log('c1', '2026-08-04', 'done')];
    const stats = weekdayBreakdown([fixed, flex], logs, { start: '2026-08-03', end: '2026-08-09' });
    expect(stats[1]).toMatchObject({ weekday: 1, scheduled: 1, completed: 1 });
  });
});

describe('R01.02-b -- streaks on count-based schedules are counted in PERIODS', () => {
  const habit = weeklyCountHabit('c1', '2026-07-01', 3);
  // Weeks: Jul 13-19, Jul 20-26, Jul 27-Aug 2 (all 3/3); current week Aug 3-9 with 1 done as of Wed Aug 5.
  const satisfied = (mon: string) => {
    const d = new Date(mon + 'T00:00:00');
    return [1, 3, 6].map((off) => log('c1', ymd(addDaysLocal(d, off)), 'done')); // Tue/Thu/Sun
  };
  const logs = [...satisfied('2026-07-13'), ...satisfied('2026-07-20'), ...satisfied('2026-07-27'), log('c1', '2026-08-04', 'done')];

  it('currentStreak: three satisfied weeks, the open current week is transparent -> 3', () => {
    expect(currentStreak(habit, logs, new Date(2026, 7, 5))).toBe(3);
  });

  it('currentStreak: an unmet closed week breaks the run', () => {
    const broken = [...satisfied('2026-07-13'), ...satisfied('2026-07-27'), log('c1', '2026-08-04', 'done')]; // Jul 20-26 missing
    expect(currentStreak(habit, broken, new Date(2026, 7, 5))).toBe(1);
  });

  it('currentStreak: once the current week is satisfied it counts', () => {
    const now = [...logs, log('c1', '2026-08-06', 'done'), log('c1', '2026-08-09', 'done')];
    expect(currentStreak(habit, now, new Date(2026, 7, 9))).toBe(4);
  });

  it('longestStreak: longest run of satisfied weeks, unmet week resets', () => {
    const gap = [...satisfied('2026-07-06'), ...satisfied('2026-07-13'), ...satisfied('2026-07-27')]; // Jul 20-26 unmet
    expect(longestStreak(habit, gap, { since: new Date(2026, 6, 6), asOf: new Date(2026, 7, 2) })).toBe(2);
  });

  it('a habit with day-based schedule keeps its day streak semantics (unchanged path)', () => {
    const daily = dailyHabit('d1', '2026-08-01');
    const dl = [log('d1', '2026-08-03', 'done'), log('d1', '2026-08-04', 'done')];
    expect(currentStreak(daily, dl, new Date(2026, 7, 4))).toBe(2);
  });
});

describe('R01.02-b -- fragility and trend see period rates for count-based habits', () => {
  it('weekly rates come from the target: 3/3 then 2/3', () => {
    const habit = weeklyCountHabit('c1', '2026-06-01', 3);
    const wk = (mon: string, offs: number[]) => offs.map((o) => log('c1', ymd(addDaysLocal(new Date(mon + 'T00:00:00'), o)), 'done'));
    const logs = [
      ...wk('2026-07-13', [1, 3, 6]), ...wk('2026-07-20', [1, 3]), ...wk('2026-07-27', [1, 3, 6]), ...wk('2026-08-03', [1, 3]),
    ];
    const r = habitFragility(habit, logs, { weeks: 4, asOf: new Date(2026, 7, 9) });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value.weeklyRates.map((x) => Math.round(x * 100))).toEqual([100, 67, 100, 67]);
  });
});

// ===========================================================================
// R01.02-c — every_n_days / date_range on the day lane
//
// Streaks, completion rate and the weekday breakdown walked days through
// `isDueOn`, which ignores interval_days and ranges. "Every 3 days" therefore
// had two phantom due days in three: an unlogged off day broke the streak.
// ===========================================================================

describe('R01.02-c — behaviorIntelligence on every_n_days / date_range', () => {
  // created Mon 2026-08-03 local -> due Mon 03, Thu 06, Sun 09, ...
  const every3: BIHabit = {
    id: 'n3', name: 'n3', behavior_type: 'positive',
    created_at: '2026-08-03T09:00:00', end_condition: null,
    frequency_config: { kind: 'daily', interval_days: 3 },
  };
  const done3 = [log('n3', '2026-08-03', 'done'), log('n3', '2026-08-06', 'done'), log('n3', '2026-08-09', 'done')];
  const SUN = new Date(2026, 7, 9);

  it('A1 — completion rate over its due days only: 3/3', () => {
    const r = habitCompletionRate(every3, done3, { start: '2026-08-03', end: '2026-08-09' });
    expect(r).toEqual({ ok: true, value: 1 });
  });

  it('A1 — off days are transparent to the streak (red if an unlogged off day breaks it)', () => {
    expect(currentStreak(every3, done3, SUN)).toBe(3);
    expect(longestStreak(every3, done3, { since: new Date(2026, 7, 3), asOf: SUN })).toBe(3);
  });

  it('A1 — a real miss on a due day still breaks it', () => {
    const logs = [log('n3', '2026-08-03', 'done'), log('n3', '2026-08-06', 'miss'), log('n3', '2026-08-09', 'done')];
    expect(currentStreak(every3, logs, SUN)).toBe(1);
  });

  it('A1 — weekday breakdown only schedules Mon, Thu, Sun', () => {
    const wb = weekdayBreakdown([every3], done3, { start: '2026-08-03', end: '2026-08-09' });
    expect(wb.map((w) => w.scheduled)).toEqual([1, 0, 0, 1, 0, 0, 1]);
  });

  it('A4 — date range Wed..Fri: streak over the range, outside days transparent', () => {
    const ranged: BIHabit = { ...dailyHabit('rg', '2026-07-01'), frequency_config: { kind: 'daily', range_start: '2026-08-05', range_end: '2026-08-07' } };
    const logs = [log('rg', '2026-08-05', 'done'), log('rg', '2026-08-06', 'done'), log('rg', '2026-08-07', 'done')];
    expect(currentStreak(ranged, logs, SUN)).toBe(3);
    expect(habitCompletionRate(ranged, logs, { start: '2026-08-03', end: '2026-08-09' })).toEqual({ ok: true, value: 1 });
  });

  it('A5 — Mon/Wed/Fri + range: Thursday inside the range is still not due', () => {
    const both: BIHabit = { ...weeklyDaysHabit('wr', '2026-07-01', [0, 2, 4]), frequency_config: { kind: 'weekly', days: [0, 2, 4], range_start: '2026-08-05', range_end: '2026-08-09' } };
    const wb = weekdayBreakdown([both], [], { start: '2026-08-03', end: '2026-08-09' });
    // Mon 03 is before the range; Wed 05 and Fri 07 only.
    expect(wb.map((w) => w.scheduled)).toEqual([0, 0, 1, 0, 1, 0, 0]);
  });

  it('A8 — count-based streaks still count PERIODS (R01.02-b unchanged)', () => {
    const w3: BIHabit = { ...dailyHabit('w3', '2026-07-01'), frequency_config: { kind: 'weekly', count: 3 } };
    const logs = [log('w3', '2026-08-04', 'done'), log('w3', '2026-08-06', 'done'), log('w3', '2026-08-09', 'done')];
    expect(currentStreak(w3, logs, SUN)).toBe(1); // one satisfied week, not 3 days
  });
});
