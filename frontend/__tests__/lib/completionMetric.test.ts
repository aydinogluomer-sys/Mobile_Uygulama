/**
 * F13 — completionMetric: single day-verdict, credit, rate and policy contract
 * (INT-01, INT-06, DOM-20).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Habit, HabitLog } from '../../lib/supabase';
import { completionRatio, isMeasurableTracking, type HabitLogState } from '../../lib/habitEngine';
import { scheduledCompletionRate } from '../../lib/habitSchedule';
import { habitAveragePercent } from '../../lib/reportMetrics';
import {
  addVerdict,
  dayCredit,
  emptyCompletion,
  isCompletedState,
  judgeDay,
  periodVerdict,
  toPercent,
  toRate,
  type DayHabit,
  type DayLog,
} from '../../lib/completionMetric';
import { CORPUS_HABITS, PRIOR_VALUES, STATES } from '../helpers/measurableCorpus';
import { COST_CORPUS } from '../helpers/costCorpus';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const readCode = (rel: string) => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

/** Pre-F13 reference copy of `reportMetrics.habitLogPercent` for bit-exact parity check. */
function legacyHabitLogPercent(
  habit: Pick<Habit, 'tracking_type' | 'daily_goal' | 'target_direction'>,
  log: { state: HabitLog['state']; value?: number | null },
): number {
  if (!(log.state === 'done' || log.state === 'partial')) return 0;
  if (isMeasurableTracking(habit.tracking_type)) {
    if (typeof log.value === 'number' && habit.daily_goal != null && habit.daily_goal >= 0) {
      const ratio = completionRatio({
        trackingType: habit.tracking_type === 'duration' ? 'duration' : 'numeric',
        state: log.state as HabitLogState,
        value: log.value,
        target: habit.daily_goal,
        direction: habit.target_direction,
      });
      return Math.max(0, Math.min(100, ratio * 100));
    }
    if (log.state === 'done') return 100;
    if (log.state === 'partial') return 50;
    return 0;
  }
  if (log.state === 'done') return 100;
  if (log.state === 'partial') return 50;
  return 0;
}

describe('F13 completionMetric — dayCredit table and corpus parity', () => {
  const binaryHabit: DayHabit = { behavior_type: 'positive', tracking_type: 'boolean', daily_goal: null, target_direction: null };
  const durationHabit: DayHabit = { behavior_type: 'positive', tracking_type: 'duration', daily_goal: 30, target_direction: 'at_least' };
  const ceilingHabit: DayHabit = { behavior_type: 'negative', tracking_type: 'numeric', daily_goal: 2, target_direction: 'at_most' };

  it('scores done=1, unmeasured partial=0.5, measured partial=ratio, miss=0, skip=0', () => {
    expect(isCompletedState('done')).toBe(true);
    expect(isCompletedState('partial')).toBe(true);
    expect(isCompletedState('miss')).toBe(false);
    expect(isCompletedState('skip')).toBe(false);

    expect(dayCredit(binaryHabit, { state: 'done' })).toBe(1);
    expect(dayCredit(binaryHabit, { state: 'partial' })).toBe(0.5);
    expect(dayCredit(durationHabit, { state: 'partial', value: 25 })).toBe(25 / 30);
    expect(dayCredit(ceilingHabit, { state: 'miss', value: 5 })).toBe(0);
    expect(dayCredit(binaryHabit, { state: 'miss' })).toBe(0);
    expect(dayCredit(binaryHabit, { state: 'skip' })).toBe(0);
  });

  it('strict_done policy gives 0 for partial and 1 for done', () => {
    expect(dayCredit(binaryHabit, { state: 'done' }, 'strict_done')).toBe(1);
    expect(dayCredit(binaryHabit, { state: 'partial' }, 'strict_done')).toBe(0);
    expect(dayCredit(durationHabit, { state: 'partial', value: 25 }, 'strict_done')).toBe(0);
    expect(dayCredit(durationHabit, { state: 'done', value: 30 }, 'strict_done')).toBe(1);
  });

  it('matches legacy habitLogPercent bit-for-bit (Object.is) across measurableCorpus and costCorpus', () => {
    for (const h of CORPUS_HABITS) {
      for (const value of PRIOR_VALUES) {
        for (const state of STATES) {
          const log: DayLog = { state, value: value ?? null };
          const actual = dayCredit(h, log) * 100;
          const expected = legacyHabitLogPercent(h, log);
          expect(Object.is(actual, expected)).toBe(true);
        }
      }
    }

    for (const c of COST_CORPUS.slice(0, 120)) {
      const h: DayHabit & Pick<Habit, 'tracking_type' | 'daily_goal' | 'target_direction'> = {
        behavior_type: c.behavior_type ?? 'positive',
        tracking_type: c.tracking_type ?? 'boolean',
        daily_goal: c.tracking_type === 'boolean' ? null : 20,
        target_direction: c.behavior_type === 'negative' ? 'at_most' : 'at_least',
      };
      for (const state of STATES) {
        const log: DayLog = { state, value: 10 };
        expect(Object.is(dayCredit(h, log) * 100, legacyHabitLogPercent(h, log))).toBe(true);
      }
    }
  });
});

describe('F13 completionMetric — judgeDay every branch', () => {
  const pos: DayHabit = { behavior_type: 'positive', tracking_type: 'boolean' };
  const neg: DayHabit = { behavior_type: 'negative', tracking_type: 'abstinence' };

  it('eligible=false -> not_scheduled', () => {
    expect(judgeDay({ habit: pos, eligible: false, dayYmd: '2026-08-05', asOfYmd: '2026-08-10', log: { state: 'done' } }))
      .toEqual({ kind: 'not_scheduled' });
  });

  it('future day (dayYmd > asOfYmd) -> pending even if a log is present', () => {
    expect(judgeDay({ habit: pos, dayYmd: '2026-08-11', asOfYmd: '2026-08-10', log: { state: 'done' } }))
      .toEqual({ kind: 'pending' });
  });

  it('asOf day without log -> pending; asOf day with done -> credit 1', () => {
    expect(judgeDay({ habit: pos, dayYmd: '2026-08-10', asOfYmd: '2026-08-10' }))
      .toEqual({ kind: 'pending' });
    expect(judgeDay({ habit: pos, dayYmd: '2026-08-10', asOfYmd: '2026-08-10', log: { state: 'done' } }))
      .toEqual({ kind: 'credit', credit: 1 });
  });

  it('past scheduled unlogged positive -> credit 0; past unlogged negative -> unknown', () => {
    expect(judgeDay({ habit: pos, dayYmd: '2026-08-09', asOfYmd: '2026-08-10' }))
      .toEqual({ kind: 'credit', credit: 0 });
    expect(judgeDay({ habit: neg, dayYmd: '2026-08-09', asOfYmd: '2026-08-10' }))
      .toEqual({ kind: 'unknown' });
  });

  it('skip -> excused (including on asOf day)', () => {
    expect(judgeDay({ habit: pos, dayYmd: '2026-08-09', asOfYmd: '2026-08-10', log: { state: 'skip' } }))
      .toEqual({ kind: 'excused' });
    expect(judgeDay({ habit: pos, dayYmd: '2026-08-10', asOfYmd: '2026-08-10', log: { state: 'skip' } }))
      .toEqual({ kind: 'excused' });
  });

  it('NEGATIVE — without asOfYmd, no clipping happens (future date still produces credit)', () => {
    expect(judgeDay({ habit: pos, dayYmd: '2099-01-01', log: { state: 'done' } }))
      .toEqual({ kind: 'credit', credit: 1 });
    expect(judgeDay({ habit: pos, dayYmd: '2099-01-01', asOfYmd: null }))
      .toEqual({ kind: 'credit', credit: 0 });
  });
});

describe('F13 completionMetric — toRate / toPercent / periodVerdict', () => {
  it('emptyCompletion and all-pending completion return null, never 0', () => {
    expect(toRate(emptyCompletion())).toBeNull();
    expect(toPercent(emptyCompletion())).toBeNull();

    let acc = emptyCompletion();
    acc = addVerdict(acc, { kind: 'pending' });
    acc = addVerdict(acc, { kind: 'excused' });
    acc = addVerdict(acc, { kind: 'not_scheduled' });
    acc = addVerdict(acc, { kind: 'unknown' });
    expect(toRate(acc)).toBeNull();
    expect(toPercent(acc)).toBeNull();
  });

  it('computes exact rate and rounded percent from credited days', () => {
    let acc = emptyCompletion();
    acc = addVerdict(acc, { kind: 'credit', credit: 1.0 });
    acc = addVerdict(acc, { kind: 'credit', credit: 0.5 });
    expect(toRate(acc)).toBe(0.75);
    expect(toPercent(acc)).toBe(75);
  });

  it('periodVerdict maps canonical periodStatus shapes cleanly', () => {
    expect(periodVerdict({ status: 'satisfied', reason: 'ok', target: 3, counted: 3 }))
      .toEqual({ kind: 'credit', credit: 1 });
    expect(periodVerdict({ status: 'closed_unmet', reason: 'ok', target: 3, counted: 2 }))
      .toEqual({ kind: 'credit', credit: 2 / 3 });
    expect(periodVerdict({ status: 'in_progress', reason: 'ok', target: 3, counted: 1 }))
      .toEqual({ kind: 'pending' });
    expect(periodVerdict({ status: 'not_started', reason: 'period_not_started', target: 3, counted: 0 }))
      .toEqual({ kind: 'pending' });
    expect(periodVerdict({ status: 'paused', reason: 'habit_paused', target: 0, counted: 0 }))
      .toEqual({ kind: 'not_scheduled' });
    expect(periodVerdict({ status: 'unknown', reason: 'not_scheduled', target: 0, counted: 0 }))
      .toEqual({ kind: 'not_scheduled' });
    expect(periodVerdict({ status: 'unknown', reason: 'habit_paused', target: 0, counted: 0 }))
      .toEqual({ kind: 'not_scheduled' });
    expect(periodVerdict({ status: 'unknown', reason: 'no_target', target: 0, counted: 0 }))
      .toEqual({ kind: 'unknown' });
  });
});

describe('F13 DOM-20 — strict_done mastery policy vs weighted report policy', () => {
  it('on a 7-day fixture with a partial day, strict_done <= weighted and partial adds 0 to doneDays', () => {
    const habit = {
      id: 'dom20',
      user_id: 'u1',
      name: 'Okuma',
      behavior_type: 'positive',
      status: 'active',
      tracking_type: 'boolean',
      daily_goal: null,
      target_direction: null,
      frequency_config: { kind: 'daily' },
      created_at: '2026-07-01T00:00:00Z',
      end_condition: null,
    } as Habit;

    const logs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>[] = [
      { habit_id: 'dom20', completed_at: '2026-08-03', state: 'done', value: null },
      { habit_id: 'dom20', completed_at: '2026-08-04', state: 'done', value: null },
      { habit_id: 'dom20', completed_at: '2026-08-05', state: 'partial', value: null },
      { habit_id: 'dom20', completed_at: '2026-08-06', state: 'done', value: null },
      { habit_id: 'dom20', completed_at: '2026-08-07', state: 'done', value: null },
      { habit_id: 'dom20', completed_at: '2026-08-08', state: 'miss', value: null },
      { habit_id: 'dom20', completed_at: '2026-08-09', state: 'done', value: null },
    ];

    const strict = scheduledCompletionRate(habit, logs, {
      from: new Date(2026, 7, 3),
      to: new Date(2026, 7, 9),
    });
    const weightedPct = habitAveragePercent({
      habits: [habit],
      logs,
      start: '2026-08-03',
      end: '2026-08-09',
    });

    expect(strict.dueDays).toBe(7);
    expect(strict.doneDays).toBe(5); // partial contributes 0 to mastery doneDays
    expect(weightedPct).not.toBeNull();
    expect(strict.rate).toBeLessThanOrEqual((weightedPct ?? 0) / 100);
    expect(strict.rate).toBeLessThan((weightedPct ?? 0) / 100);
  });
});

describe('F13 completionMetric — structural purity and single-definition guard', () => {
  it('completionMetric.ts is pure: no new Date(), no cycle-forming imports', () => {
    const src = readCode('lib/completionMetric.ts');
    expect(src).not.toMatch(/new\s+Date\s*\(/);
    expect(src).not.toMatch(/habitSchedule/);
    expect(src).not.toMatch(/reportMetrics/);
    expect(src).not.toMatch(/behaviorIntelligence/);
  });

  it('reportMetrics.ts and behaviorIntelligence.ts do not define duplicate isCompletedState / habitLogPercent bodies', () => {
    const rm = readCode('lib/reportMetrics.ts');
    const bi = readCode('lib/behaviorIntelligence.ts');
    expect(rm).not.toMatch(/function\s+isCompletedState\b/);
    expect(bi).not.toMatch(/function\s+isCompletedState\b/);
    expect(bi).not.toMatch(/function\s+habitLogPercent\b/);
    expect(rm).not.toMatch(/completionRatio\s*\(/);
  });
});
