/**
 * L1 tests for report metrics.  (task 1E-L1b)
 *
 * Four defects, AC-H04..H09:
 *   H04  the denominator is every day, not every DUE day, so a Mon/Wed/Fri
 *        habit done perfectly caps at 3/7 = 43 %
 *   H05  `at_most` scores value/goal, which REWARDS overshooting the limit
 *   H06  `at_most` exactly at the limit is treated as a failure
 *   H07  `state:'miss'` counts as a completed day
 *   H08  `state:'skip'` counts as a completed day
 *   H09  pausing a habit today rewrites last month's report
 *
 * Written BEFORE the fix and observed to fail, per R-01.
 */
import type { Habit, HabitLog } from '../../lib/supabase';
import {
  habitAveragePercent, summarizeHabitProgress, calculateHabitCompletionRate,
} from '../../lib/reportMetrics';

type H = Habit;
type L = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;

function h(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1', user_id: 'u1', name: 'test',
    behavior_type: 'positive', status: 'active',
    tracking_type: 'boolean', daily_goal: null, target_direction: null,
    frequency_config: { kind: 'daily' },
    created_at: '2020-01-01T00:00:00Z', end_condition: null,
  } as Habit;
}
function log(over: Partial<L> = {}): L {
  return { habit_id: 'h1', completed_at: '2026-08-03', state: 'done', value: null, ...over } as L;
}

// ISO week Mon 2026-08-03 .. Sun 2026-08-09
const WEEK_START = '2026-08-03';
const WEEK_END = '2026-08-09';

describe('AC-H04 — the denominator is DUE days, not all days', () => {
  it('a Mon/Wed/Fri habit completed on all three due days scores 100%, not 43%', () => {
    const habit = { ...h(), frequency_config: { kind: 'weekly', days: [0, 2, 4] } } as Habit;
    const logs = ['2026-08-03', '2026-08-05', '2026-08-07'].map((d) =>
      log({ completed_at: d, state: 'done' }));
    const pct = habitAveragePercent({
      habits: [habit], logs, start: WEEK_START, end: WEEK_END,
    });
    expect(pct).toBe(100);
  });

  it('a daily habit completed every day is still 100%', () => {
    const habit = h();
    const logs = ['03', '04', '05', '06', '07', '08', '09'].map((d) =>
      log({ completed_at: `2026-08-${d}`, state: 'done' }));
    expect(habitAveragePercent({
      habits: [habit], logs, start: WEEK_START, end: WEEK_END,
    })).toBe(100);
  });

  it('a Mon/Wed/Fri habit done on only one due day scores about a third', () => {
    const habit = { ...h(), frequency_config: { kind: 'weekly', days: [0, 2, 4] } } as Habit;
    const pct = habitAveragePercent({
      habits: [habit],
      logs: [log({ completed_at: '2026-08-03', state: 'done' })],
      start: WEEK_START, end: WEEK_END,
    });
    expect(pct).toBeGreaterThanOrEqual(30);
    expect(pct).toBeLessThanOrEqual(40);
  });
});

describe('AC-H05 / AC-H06 — at_most is scored in the right direction', () => {
  const smoking = {
    ...h(), id: 'h1', tracking_type: 'numeric', daily_goal: 5,
    target_direction: 'at_most',
  } as Habit;

  // The defect was that MORE scored HIGHER: 20 cigarettes clamped to 100 while
  // 1 cigarette scored 20. The fix must stop that. It does NOT need to rank two
  // successes against each other - someone at 1/5 and someone at 4/5 both kept
  // the commitment, and grading between them would be false precision the
  // product does not use anywhere.
  it('AC-H05 — staying under the limit beats exceeding it', () => {
    const score = (v: number) => habitAveragePercent({
      habits: [smoking],
      logs: [log({ completed_at: WEEK_START, state: 'done', value: v })],
      start: WEEK_START, end: WEEK_START,
    });
    expect(score(1)).toBeGreaterThan(score(20));
    expect(score(4)).toBeGreaterThan(score(20));
    // and crucially, more is never rewarded
    expect(score(20)).toBeLessThan(score(5));
  });

  it('AC-H05 — both values under the limit are successes', () => {
    const score = (v: number) => habitAveragePercent({
      habits: [smoking],
      logs: [log({ completed_at: WEEK_START, state: 'done', value: v })],
      start: WEEK_START, end: WEEK_START,
    });
    expect(score(1)).toBe(100);
    expect(score(4)).toBe(100);
  });

  it('AC-H05 — exceeding the limit scores 0, not over 100', () => {
    const over = habitAveragePercent({
      habits: [smoking],
      logs: [log({ completed_at: WEEK_START, state: 'done', value: 20 })],
      start: WEEK_START, end: WEEK_START,
    });
    expect(over).toBe(0);
  });

  it('AC-H06 — exactly at the limit is a success', () => {
    expect(habitAveragePercent({
      habits: [smoking],
      logs: [log({ completed_at: WEEK_START, state: 'done', value: 5 })],
      start: WEEK_START, end: WEEK_START,
    })).toBe(100);
  });

  it('zero is a perfect score for at_most', () => {
    expect(habitAveragePercent({
      habits: [smoking],
      logs: [log({ completed_at: WEEK_START, state: 'done', value: 0 })],
      start: WEEK_START, end: WEEK_START,
    })).toBe(100);
  });

  it('at_least is unchanged — more is better', () => {
    const water = {
      ...h(), tracking_type: 'numeric', daily_goal: 8, target_direction: 'at_least',
    } as Habit;
    const score = (v: number) => habitAveragePercent({
      habits: [water],
      logs: [log({ completed_at: WEEK_START, state: 'done', value: v })],
      start: WEEK_START, end: WEEK_START,
    });
    expect(score(8)).toBe(100);
    expect(score(4)).toBe(50);
    expect(score(8)).toBeGreaterThan(score(4));
  });
});

describe('AC-H07 / AC-H08 — miss and skip are not completions', () => {
  const habit = h();

  it('AC-H07 — state:"miss" is not a completed day', () => {
    const r = summarizeHabitProgress(
      [habit],
      [log({ completed_at: WEEK_START, state: 'miss' })],
      WEEK_START, WEEK_END,
    );
    expect(r[0].completedDays).toBe(0);
  });

  it('AC-H08 — state:"skip" is not a completed day', () => {
    const r = summarizeHabitProgress(
      [habit],
      [log({ completed_at: WEEK_START, state: 'skip' })],
      WEEK_START, WEEK_END,
    );
    expect(r[0].completedDays).toBe(0);
  });

  it('done and partial still count', () => {
    const r = summarizeHabitProgress(
      [habit],
      [log({ completed_at: '2026-08-03', state: 'done' }),
       log({ completed_at: '2026-08-04', state: 'partial' }),
       log({ completed_at: '2026-08-05', state: 'miss' }),
       log({ completed_at: '2026-08-06', state: 'skip' })],
      WEEK_START, WEEK_END,
    );
    expect(r[0].completedDays).toBe(2);
  });

  it('calculateHabitCompletionRate ignores miss and skip too', () => {
    const only = calculateHabitCompletionRate(
      [habit],
      [log({ completed_at: WEEK_START, state: 'miss' })],
      WEEK_START, WEEK_START,
    );
    expect(only).toBe(0);
  });
});

describe('AC-H09 — history does not change when a habit is paused today', () => {
  it('a paused habit still counts for a period it was active in', () => {
    const active = h();
    const paused = { ...h(), status: 'paused' } as Habit;
    const logs = [log({ completed_at: WEEK_START, state: 'done' })];

    const before = habitAveragePercent({
      habits: [active], logs, start: WEEK_START, end: WEEK_START,
    });
    const after = habitAveragePercent({
      habits: [paused], logs, start: WEEK_START, end: WEEK_START,
    });
    expect(after).toBe(before);
  });
});
