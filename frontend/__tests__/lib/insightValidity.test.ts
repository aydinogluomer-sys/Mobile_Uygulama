/**
 * F13 — Insight validity: asOf period clipping, sample-size gates, trend noise
 * threshold, and non-causal AI digest preamble (INT-01, INT-07).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Habit, HabitLog } from '../../lib/supabase';
import { addDaysLocal, parseLocalDate, ymd } from '../../lib/date';
import { calculateHabitCompletionRate } from '../../lib/reportMetrics';
import {
  bestWeekday,
  completionTrend,
  strongestHabit,
  weekdayBreakdown,
  worstWeekday,
  type BIHabit,
  type BILog,
} from '../../lib/behaviorIntelligence';
import { weeklyDigest } from '../../lib/insightDigest';
import { DIGEST_PREAMBLE } from '../../lib/metricCopy';

const ROOT = join(__dirname, '..', '..');

function makeHabit(id: string, createdAt = '2026-07-01', over: Partial<Habit> = {}): Habit {
  return {
    id,
    user_id: 'u1',
    name: `Habit ${id}`,
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    willpower_cost: 3,
    status: 'active',
    impact_level: null,
    urgency: null,
    difficulty: 3,
    estimated_minutes: 15,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: `${createdAt}T08:00:00`,
    ...over,
  } as Habit;
}

type LogRow = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;
const mkLog = (habit_id: string, completed_at: string, state: HabitLog['state'] = 'done'): LogRow => ({
  habit_id,
  completed_at,
  state,
  value: null,
});

describe('F13 INT-01 — period rates and weekdayBreakdown clip at asOf', () => {
  // Week Mon 2026-08-03 .. Sun 2026-08-09; Tuesday = 2026-08-04
  const habits = [makeHabit('h1'), makeHabit('h2'), makeHabit('h3')];
  const monLogs = habits.map((h) => mkLog(h.id, '2026-08-03', 'done'));
  const tueLogs = habits.map((h) => mkLog(h.id, '2026-08-04', 'done'));
  const asOfTue = parseLocalDate('2026-08-04')!;

  it('3 daily habits all done Mon+Tue on Tuesday -> 100 with { asOf }, vs 29 without asOf', () => {
    const logs = [...monLogs, ...tueLogs];
    expect(calculateHabitCompletionRate(habits, logs, '2026-08-03', '2026-08-09', { asOf: asOfTue })).toBe(100);
    expect(calculateHabitCompletionRate(habits, logs, '2026-08-03', '2026-08-09')).toBe(29);
  });

  it('asOf Tuesday with Tuesday unlogged -> only Monday in denominator, rate 100; all pending -> null', () => {
    expect(calculateHabitCompletionRate(habits, monLogs, '2026-08-03', '2026-08-09', { asOf: asOfTue })).toBe(100);
    const asOfMon = parseLocalDate('2026-08-03')!;
    expect(calculateHabitCompletionRate(habits, [], '2026-08-03', '2026-08-09', { asOf: asOfMon })).toBeNull();
  });

  it('weekdayBreakdown with { asOf: Tuesday } leaves Wed..Sun scheduled === 0', () => {
    const stats = weekdayBreakdown(
      habits,
      [...monLogs, ...tueLogs],
      { start: '2026-08-03', end: '2026-08-09' },
      { asOf: asOfTue },
    );
    expect(stats[0].scheduled).toBe(3);
    expect(stats[1].scheduled).toBe(3);
    for (let wd = 2; wd <= 6; wd++) {
      expect(stats[wd].scheduled).toBe(0);
    }
  });

  it('on the 5th of the month, monthly completion rate uses at most 5 days in denominator', () => {
    const h = makeHabit('m1', '2026-07-01');
    const logs = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05'].map((d) => mkLog('m1', d, 'done'));
    expect(calculateHabitCompletionRate([h], logs, '2026-08-01', '2026-08-31', { asOf: parseLocalDate('2026-08-05')! })).toBe(100);
  });

  it('REGRESSION — for a completed past week, { asOf } after end matches output without asOf', () => {
    const logs = [...monLogs, ...tueLogs];
    const withAsOf = calculateHabitCompletionRate(habits, logs, '2026-08-03', '2026-08-09', {
      asOf: parseLocalDate('2026-08-20')!,
    });
    const withoutAsOf = calculateHabitCompletionRate(habits, logs, '2026-08-03', '2026-08-09');
    expect(withAsOf).toBe(withoutAsOf);
  });
});

describe('F13 INT-07 — statistical validity gates (distinct weekday dates, trend thresholds, strength min logs)', () => {
  it('bestWeekday / worstWeekday: 3 distinct dates -> ok; 3 habits on 1 single Monday -> ok: false', () => {
    const threeHabits: BIHabit[] = [makeHabit('a'), makeHabit('b'), makeHabit('c')];
    const oneMondayLogs: BILog[] = threeHabits.map((h) => mkLog(h.id, '2026-08-03', 'done'));
    const singleWeekStats = weekdayBreakdown(threeHabits, oneMondayLogs, { start: '2026-08-03', end: '2026-08-03' });
    expect(singleWeekStats[0].scheduled).toBe(3);
    expect(singleWeekStats[0].distinctDates).toBe(1);
    expect(bestWeekday(singleWeekStats).ok).toBe(false);
    expect(worstWeekday(singleWeekStats).ok).toBe(false);

    const h = makeHabit('single');
    const threeMondays: BILog[] = ['2026-08-03', '2026-08-10', '2026-08-17'].map((d) => mkLog('single', d, 'done'));
    const threeWeekStats = weekdayBreakdown([h], threeMondays, { start: '2026-08-03', end: '2026-08-23' });
    expect(threeWeekStats[0].distinctDates).toBe(3);
    expect(bestWeekday(threeWeekStats).ok).toBe(true);
    expect(worstWeekday(threeWeekStats).ok).toBe(true);
  });

  it('completionTrend noise band: 0.80 -> 0.79 is flat (|delta| < 0.05); 0.60 -> 0.80 is improving', () => {
    const monToFri = makeHabit('wk5', '2026-07-01', { frequency_config: { kind: 'weekly', days: [0, 1, 2, 3, 4] } });
    // 4 weeks ending Sun 2026-08-30: 20 lived scheduled days (>= 14).
    // Build 0.80 (4/5) in first 2 weeks -> 0.79-ish: use 2 habits Mon-Fri (10/week, 40 total):
    // First half avg = 8/10 = 0.80, second half avg = 7.9/10 -> across 2 weeks: 8+8=16/20=0.80 vs 8+7.8 -> with partial: 7 done + 1 partial(0.5) = 7.5, avg(8/10, 7.8/10)=0.79!
    const hA = makeHabit('hA', '2026-07-01', { frequency_config: { kind: 'weekly', days: [0, 1, 2, 3, 4] } });
    const weeks = ['2026-08-03', '2026-08-10', '2026-08-17', '2026-08-24'];
    const buildWeek = (monStr: string, aCount: number, bCount: number, extraPartialB = false): BILog[] => {
      const mon = parseLocalDate(monStr)!;
      const out: BILog[] = [];
      for (let i = 0; i < aCount; i++) out.push(mkLog('hA', ymd(addDaysLocal(mon, i)), 'done'));
      for (let i = 0; i < bCount; i++) out.push(mkLog('hB', ymd(addDaysLocal(mon, i)), 'done'));
      if (extraPartialB) out.push(mkLog('hB', ymd(addDaysLocal(mon, bCount)), 'partial')); // +0.5 -> 7.5 + 0.5? wait: 4+3+0.5 = 7.5; for 7.8 use numeric or 8/10 & 7.8/10:
      return out;
    };
    // Week 0: 8/10 (0.80), Week 1: 8/10 (0.80) -> firstHalf avg = 0.80
    // Week 2: 8/10 (0.80), Week 3: 7.5/10 (0.75) -> wait: avg(0.80, 0.78) = 0.79 with numeric goal 5, value 4 (0.8)!
    const numB = makeHabit('hB', '2026-07-01', {
      tracking_type: 'numeric',
      daily_goal: 5,
      target_direction: 'at_least',
      frequency_config: { kind: 'weekly', days: [0, 1, 2, 3, 4] },
    });
    const flatLogs: BILog[] = [
      ...buildWeek(weeks[0], 4, 4),
      ...buildWeek(weeks[1], 4, 4),
      ...buildWeek(weeks[2], 4, 4),
      ...buildWeek(weeks[3], 4, 3),
      { habit_id: 'hB', completed_at: '2026-08-27', state: 'partial', value: 4 }, // 0.8 credit -> week 3 = 7.8/10 = 0.78 -> secondHalf avg = 0.79!
    ];
    const asOfSun = parseLocalDate('2026-08-30')!;
    const flatRes = completionTrend([hA, numB], flatLogs, { weeks: 4, asOf: asOfSun });
    expect(flatRes.ok).toBe(true);
    if (flatRes.ok) {
      expect(flatRes.value.magnitude).toBeCloseTo(-0.01, 5);
      expect(flatRes.value.direction).toBe('flat');
    }

    // 0.60 -> 0.80 -> improving
    const improvingLogs: BILog[] = [
      ...buildWeek(weeks[0], 3, 0),
      ...buildWeek(weeks[1], 3, 0),
      ...buildWeek(weeks[2], 4, 0),
      ...buildWeek(weeks[3], 4, 0),
    ];
    const impRes = completionTrend([monToFri.id === 'wk5' ? hA : monToFri], improvingLogs, { weeks: 4, asOf: asOfSun });
    expect(impRes.ok).toBe(true);
    if (impRes.ok) {
      expect(impRes.value.magnitude).toBeCloseTo(0.2, 5);
      expect(impRes.value.direction).toBe('improving');
    }
  });

  it('2-week comparison: prev week 7 lived days + this week 3 lived days -> ok; only 2 lived days this week -> insufficient', () => {
    const h = makeHabit('hero', '2026-08-01');
    const prevWeek = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
      .map((d) => mkLog('hero', d, 'done'));
    const wedLogs = [...prevWeek, mkLog('hero', '2026-08-10', 'done'), mkLog('hero', '2026-08-11', 'done'), mkLog('hero', '2026-08-12', 'done')];
    expect(completionTrend([h], wedLogs, { weeks: 2, asOf: parseLocalDate('2026-08-12')! }).ok).toBe(true);

    const tueLogs = [...prevWeek, mkLog('hero', '2026-08-10', 'done'), mkLog('hero', '2026-08-11', 'done')];
    expect(completionTrend([h], tueLogs, { weeks: 2, asOf: parseLocalDate('2026-08-11')! }).ok).toBe(false);
  });

  it('NEGATIVE — 4-week window with 13 total lived scheduled days (even with >= 3 per week) returns insufficient', () => {
    // Mon/Wed/Fri for 3 weeks (9 days) + Mon/Tue/Wed/Fri in 4th week via second habit born last week (4 days) = 13 lived dates
    const mwf = makeHabit('mwf13', '2026-07-01', { frequency_config: { kind: 'weekly', days: [0, 2, 4] } });
    const tueLastWeek = makeHabit('tue13', '2026-08-24', { frequency_config: { kind: 'weekly', days: [1] } });
    const res = completionTrend([mwf, tueLastWeek], [], { weeks: 4, asOf: parseLocalDate('2026-08-30')! });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('14');
  });

  it('strongestHabit requires >= 10 non-skip logs (9 excluded, 10 included)', () => {
    const asOf = parseLocalDate('2026-08-25')!;
    const h9 = makeHabit('nine', '2026-08-01');
    const logs9 = Array.from({ length: 9 }, (_, i) => mkLog('nine', ymd(addDaysLocal(asOf, -i)), 'done'));
    expect(strongestHabit([h9], logs9, { asOf }).ok).toBe(false);

    const logs10 = [...logs9, mkLog('nine', ymd(addDaysLocal(asOf, -9)), 'done')];
    const ok10 = strongestHabit([h9], logs10, { asOf });
    expect(ok10.ok).toBe(true);
  });

  it('weeklyDigest requires >= 3 distinctDates for weekday keys and omits null weekCompletionRate honestly', () => {
    const oneDateThreeHabits = Array.from({ length: 7 }, (_, weekday) => ({
      weekday,
      scheduled: weekday === 0 ? 3 : 0,
      completed: weekday === 0 ? 3 : 0,
      distinctDates: weekday === 0 ? 1 : 0,
      rate: weekday === 0 ? 1 : 0,
    }));

    const d1 = weeklyDigest({
      activeHabitCount: 3,
      weekCompletionRate: null,
      weekOverWeekTrend: { ok: false, reason: 'insufficient' },
      weekdayStats: oneDateThreeHabits,
      strongestHabit: { ok: false, reason: 'insufficient' },
      mostFragileHabit: { ok: false, reason: 'insufficient' },
      recoverySuccess: { ok: false, reason: 'insufficient' },
      habitCompletionRates30d: [],
      capacityLoadToday: 20,
      overloadDaysThisWeek: 0,
      focusMinutesThisWeek: 0,
    });

    expect(d1.entries.week_completion_rate).toBeUndefined();
    expect(d1.omittedMetrics).toContainEqual({
      key: 'week_completion_rate',
      reason: 'no lived scheduled days in range',
    });
    expect(d1.entries.monday_completion).toBeUndefined();
    expect(d1.omittedMetrics.find((m) => m.key === 'monday_completion')?.reason).toMatch(/distinct date/i);

    const threeDates = oneDateThreeHabits.map((s) => (s.weekday === 0 ? { ...s, distinctDates: 3 } : s));
    const d2 = weeklyDigest({
      activeHabitCount: 1,
      weekCompletionRate: 85,
      weekOverWeekTrend: { ok: false, reason: 'insufficient' },
      weekdayStats: threeDates,
      strongestHabit: { ok: false, reason: 'insufficient' },
      mostFragileHabit: { ok: false, reason: 'insufficient' },
      recoverySuccess: { ok: false, reason: 'insufficient' },
      habitCompletionRates30d: [],
      capacityLoadToday: 20,
      overloadDaysThisWeek: 0,
      focusMinutesThisWeek: 0,
    });
    expect(d2.entries.monday_completion).toBe(100);
    expect(d2.entries.week_completion_rate).toBe(85);
  });
});

describe('F13 INT-07 — non-causal AI prompt preamble', () => {
  it('DIGEST_PREAMBLE forbids causal claims and notes small samples; insights.tsx wires it alongside formatDigestForPrompt', () => {
    expect(DIGEST_PREAMBLE).toContain('Neden-sonuç iddiası kurma');
    expect(DIGEST_PREAMBLE).toContain('Örnek küçükse');

    const src = readFileSync(join(ROOT, 'app/screens/insights.tsx'), 'utf8');
    expect(src).toContain('DIGEST_PREAMBLE');
    expect(src).toMatch(/formatDigestForPrompt\s*\(/);
  });
});
