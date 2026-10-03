/**
 * R01.02-d1 — a date range is an ENVELOPE, not a schedule SHAPE.
 *
 * `scheduleKind` used to return `'date_range'` before reading `kind`, so the
 * range replaced the real shape:
 *
 *   weekly + count 3 + range 08-05..08-20  -> countDueDays' invented Mon/Wed/Sat,
 *                                             clipped: 5, 8, 10, 12, 15, 17, 19 (KD-06)
 *   daily + interval 3 + range 08-03..08-20 -> all 18 days; the interval was lost
 *
 * The range now clips in `withinLifetime`, next to `created_at` and a dated
 * `end_condition`, and every shape is evaluated as itself inside it.
 *
 * A1 KD-06 closed · A2 interval + range · A3 weekly days + range (unchanged)
 * A4 outside the range nothing is due, in any consumer · A5 one-sided ranges
 * A6 a period the range cuts too short for its NOMINAL target says so
 * (A7 lives in rangelessPreservation.test.ts; A8 is `tsc`.)
 */
import type { Habit, HabitLog } from '../../lib/supabase';
import {
  isDueOn, isEligibleOn, carriesDayLoad, scheduledCompletionRate, periodStatus, streakBroken,
  scheduleKind, isCountBasedSchedule,
} from '../../lib/habitSchedule';
import { habitAveragePercent, summarizeHabitProgress } from '../../lib/reportMetrics';
import { currentStreak, habitCompletionRate, weekdayBreakdown } from '../../lib/behaviorIntelligence';

function habit(over: Partial<Habit>): Habit {
  return {
    id: 'h1', user_id: 'u1', name: 't', behavior_type: 'positive', status: 'active',
    tracking_type: 'boolean', daily_goal: null, target_direction: null,
    frequency_config: { kind: 'daily' }, created_at: '2026-07-01T09:00:00', end_condition: null,
    ...over,
  } as Habit;
}
type L = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;
const done = (day: number, id = 'h1'): L =>
  ({ habit_id: id, completed_at: `2026-08-${String(day).padStart(2, '0')}`, state: 'done', value: null });

const aug = (d: number) => new Date(2026, 7, d);
const AUG = Array.from({ length: 31 }, (_, i) => i + 1);
const R = { range_start: '2026-08-05', range_end: '2026-08-20' };
const inRange = (d: number) => d >= 5 && d <= 20;

const daily = habit({ frequency_config: { kind: 'daily', ...R } });
const w3 = habit({ frequency_config: { kind: 'weekly', count: 3, ...R } });
const m10 = habit({ frequency_config: { kind: 'monthly', count: 10, ...R } });
const n3 = habit({ created_at: '2026-08-03T09:00:00', frequency_config: { kind: 'daily', interval_days: 3, range_start: '2026-08-03', range_end: '2026-08-20' } });
const mwf = habit({ frequency_config: { kind: 'weekly', days: [0, 2, 4], ...R } });

describe('A1 — KD-06 closed: weekly count + range', () => {
  it('is weekly_count and count-based, so every count guard catches it', () => {
    expect(scheduleKind(w3)).toEqual({ kind: 'weekly_count', count: 3 });
    expect(isCountBasedSchedule(w3)).toBe(true);
  });

  it('is eligible on EVERY day inside the range and on none outside', () => {
    expect(AUG.filter((d) => isEligibleOn(w3, aug(d)))).toEqual(AUG.filter(inRange));
  });

  it('NEGATIVE — no invented weekday pattern (red if countDueDays leaks back)', () => {
    expect(AUG.filter((d) => isEligibleOn(w3, aug(d)))).not.toEqual([5, 8, 10, 12, 15, 17, 19]);
  });

  it('monthly count + range behaves the same way', () => {
    expect(scheduleKind(m10)).toEqual({ kind: 'monthly_count', count: 10 });
    expect(AUG.filter((d) => isEligibleOn(m10, aug(d)))).toEqual(AUG.filter(inRange));
  });
});

describe('A2 — the second hole: interval + range', () => {
  it('every 3 days from 08-03, range 08-03..08-20: 03, 06, 09, 12, 15, 18', () => {
    expect(scheduleKind(n3)).toEqual({ kind: 'every_n_days', intervalDays: 3 });
    expect(AUG.filter((d) => isEligibleOn(n3, aug(d)))).toEqual([3, 6, 9, 12, 15, 18]);
  });

  it('NEGATIVE — not every day in the range (18), not running past it (7)', () => {
    const got = AUG.filter((d) => isEligibleOn(n3, aug(d)));
    expect(got).toHaveLength(6);
    expect(got).not.toHaveLength(18);
    expect(got).not.toContain(21);
  });

  it('due-day denominator over August is 6', () => {
    expect(scheduledCompletionRate(n3, [], { from: aug(1), to: aug(31) }).dueDays).toBe(6);
  });
});

describe('A3 — weekly days + range: only Mon/Wed/Fri inside the range (now by design)', () => {
  it('5, 7, 10, 12, 14, 17, 19', () => {
    expect(scheduleKind(mwf).kind).toBe('weekly_days');
    expect(AUG.filter((d) => isEligibleOn(mwf, aug(d)))).toEqual([5, 7, 10, 12, 14, 17, 19]);
    expect(AUG.filter((d) => isDueOn(mwf, aug(d)))).toEqual([5, 7, 10, 12, 14, 17, 19]);
  });
});

describe('A4 — outside the range nothing is due, in any consumer', () => {
  const OUT = [1, 4, 21, 22, 31];

  it('isDueOn / isEligibleOn / carriesDayLoad: false outside, for day and count shapes', () => {
    for (const h of [daily, w3, m10, mwf]) {
      for (const d of OUT) {
        expect(isDueOn(h, aug(d))).toBe(false);
        expect(isEligibleOn(h, aug(d))).toBe(false);
        expect(carriesDayLoad(h, [], aug(d))).toBe(false);
      }
    }
  });

  it('scheduledCompletionRate: daily + range has 16 due days in August, not 31', () => {
    expect(scheduledCompletionRate(daily, [], { from: aug(1), to: aug(31) }).dueDays).toBe(16);
  });

  it('streakBroken: never broken outside the range (day and count shapes)', () => {
    for (const d of OUT) {
      expect(streakBroken(daily, [], aug(d))).toBe(false);
      expect(streakBroken(w3, [], aug(d))).toBe(false); // 08-22: without the envelope "3 left, 2 days" read as broken
    }
    expect(streakBroken(daily, [], aug(10))).toBe(true); // inside, nothing logged
  });

  it('periodStatus: an out-of-range day is not_scheduled; a period wholly outside the range too', () => {
    expect(periodStatus(daily, [], aug(4), { asOf: aug(31) })).toMatchObject({ status: 'unknown', reason: 'not_scheduled' });
    expect(periodStatus(w3, [], aug(25), { asOf: aug(31) })).toMatchObject({ status: 'unknown', reason: 'not_scheduled' });
  });

  it('periodStatus counts only completions inside the range', () => {
    // a 'done' on 08-03 (before the range) in the 08-03..08-09 week does not count
    const st = periodStatus(w3, [done(3), done(5)], aug(5), { asOf: aug(6) });
    expect(st.counted).toBe(1);
  });

  it('reportMetrics: daily + range possibleDays 16; count + range charges only the weeks it touches (3 x 3)', () => {
    const [d] = summarizeHabitProgress([daily], [], '2026-08-01', '2026-08-31');
    expect(d.possibleDays).toBe(16);
    const [c] = summarizeHabitProgress([{ ...w3, id: 'w3' } as Habit], [], '2026-08-01', '2026-08-31');
    expect(c.possibleDays).toBe(9);
    const logs = AUG.filter(inRange).map((x) => done(x));
    expect(habitAveragePercent({ habits: [daily], logs, start: '2026-08-01', end: '2026-08-31' })).toBe(100);
  });

  it('behaviorIntelligence: out-of-range days are transparent and unscheduled', () => {
    const logs = AUG.filter(inRange).map((x) => done(x));
    expect(currentStreak(daily, logs, aug(31))).toBe(16);
    expect(habitCompletionRate(daily, logs, { start: '2026-08-01', end: '2026-08-31' })).toEqual({ ok: true, value: 1 });
    const wb = weekdayBreakdown([daily], logs, { start: '2026-08-01', end: '2026-08-31' });
    expect(wb.reduce((s, w) => s + w.scheduled, 0)).toBe(16);
  });
});

describe('A5 — one-sided ranges clip one side only', () => {
  it('only range_start: nothing before, open after', () => {
    const h = habit({ frequency_config: { kind: 'daily', range_start: '2026-08-10' } });
    expect(isEligibleOn(h, aug(9))).toBe(false);
    expect(isEligibleOn(h, aug(10))).toBe(true);
    expect(isEligibleOn(h, new Date(2026, 11, 31))).toBe(true);
  });

  it('only range_end: open before (back to created_at), nothing after', () => {
    const h = habit({ frequency_config: { kind: 'daily', range_end: '2026-08-10' } });
    expect(isEligibleOn(h, new Date(2026, 6, 1))).toBe(true);
    expect(isEligibleOn(h, aug(10))).toBe(true);
    expect(isEligibleOn(h, aug(11))).toBe(false);
  });

  it('both bounds are inclusive', () => {
    expect(isEligibleOn(daily, aug(5))).toBe(true);
    expect(isEligibleOn(daily, aug(20))).toBe(true);
    expect(isEligibleOn(daily, aug(4))).toBe(false);
    expect(isEligibleOn(daily, aug(21))).toBe(false);
  });
});

describe('A6 — a period the range cuts too short says so (target stays nominal; R01.05 owns proration)', () => {
  // week 08-03..08-09; range starts Saturday 08-08 -> two days for a target of 3
  const lateStart = habit({ frequency_config: { kind: 'weekly', count: 3, range_start: '2026-08-08', range_end: '2026-08-20' } });

  it('nothing logged yet: not_started, but reason unreachable (not a silent "ok")', () => {
    const st = periodStatus(lateStart, [], aug(8), { asOf: aug(8) });
    expect(st).toMatchObject({ status: 'not_started', reason: 'unreachable_in_remaining_days', target: 3 });
  });

  it('one logged with one day left: in_progress, unreachable', () => {
    const st = periodStatus(lateStart, [done(8)], aug(8), { asOf: aug(9) });
    expect(st).toMatchObject({ status: 'in_progress', reason: 'unreachable_in_remaining_days', counted: 1, remaining: 2 });
  });

  it('after the week: closed_unmet', () => {
    expect(periodStatus(lateStart, [done(8), done(9)], aug(8), { asOf: aug(10) }).status).toBe('closed_unmet');
  });

  it('a range that ends mid-week leaves no days after it (Mon..Wed, 1 done, as of Wed)', () => {
    const early = habit({ frequency_config: { kind: 'weekly', count: 3, range_start: '2026-08-03', range_end: '2026-08-05' } });
    const st = periodStatus(early, [done(3)], aug(5), { asOf: aug(5) });
    expect(st).toMatchObject({ status: 'in_progress', reason: 'unreachable_in_remaining_days' });
  });

  it('a cut period that can still make it reports ok; target is NOT prorated', () => {
    // 08-05..08-09 = five days for 3
    const st = periodStatus(w3, [], aug(5), { asOf: aug(5) });
    expect(st).toMatchObject({ status: 'not_started', reason: 'ok', target: 3 });
  });
});
