/**
 * KD-12 — a measurable make-up asks for the amount; it never invents one.
 *
 * The defect: both recovery paths chose the log's state themselves. The
 * backlog "yaptım" and a full make-up wrote `done` with NO value, which
 * `completionRatio` reads as 0% for a measurable habit with a target -- the
 * user caught the day up and their completion rate counted it as nothing.
 * `split_two_days` wrote `partial` with `value = round(goal * 0.5)`, which for
 * a goal of 1 is the whole goal (`stateForValue` says `done`) and for a ceiling
 * is under the limit (`stateForValue` says `done`): the row contradicted itself.
 *
 * Owner decision 2026-10-07: ask the user (the measurable modal), do not
 * invent. The state is then derived from the amount through the same
 * `measuredEntryFor` the timeline uses (R01.03-a), so a recovery row can never
 * disagree with its own value. Non-measurable habits are unchanged.
 */
jest.mock('../../repositories/recoveryRepository', () => ({
  deleteRecoveryPlan: jest.fn(),
  fetchPlannedRecoveryPlans: jest.fn(),
  insertRecoveryPlan: jest.fn(),
  setRecoveryPlanStatus: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../repositories/habitLogRepository', () => ({
  fetchLogsForDate: jest.fn(), findHabitLog: jest.fn(), insertHabitLog: jest.fn(), updateHabitLog: jest.fn(),
}));
jest.mock('../../services/webhookService', () => ({ notify: jest.fn() }));
// R02.03 — the plan's status change is queued in the core outbox now (it used
// to be a direct `setRecoveryPlanStatus`); "the plan was not closed" is
// asserted on that queue instead -- the same claim, one layer up.
jest.mock('../../services/coreOutbox', () => ({
  coreOutbox: {
    write: jest.fn(async () => ({ ok: true, operationId: 'op', savedOnDevice: true })),
    flush: jest.fn(async () => undefined), ensure: jest.fn(async () => null), state: () => null,
  },
}));

import type { Habit } from '../../lib/supabase';
import {
  makeupNeedsValue, makeupSuggestedValue, makeupFor, completePlanWithMakeup,
} from '../../services/recoveryService';
import { stateForValue } from '../../services/habitLogService';
import { completionRatio, adaptTrackingType } from '../../lib/habitEngine';
import { coreOutbox } from '../../services/coreOutbox';
const setRecoveryPlanStatus = coreOutbox.write;

type H = Pick<Habit, 'tracking_type' | 'behavior_type' | 'daily_goal' | 'target_direction'>;
const READ10: H = { tracking_type: 'numeric', behavior_type: 'positive', daily_goal: 10, target_direction: 'at_least' };
const ONE: H = { tracking_type: 'numeric', behavior_type: 'positive', daily_goal: 1, target_direction: 'at_least' };
const SMOKE2: H = { tracking_type: 'numeric', behavior_type: 'negative', daily_goal: 2, target_direction: 'at_most' };
const MINUTES20: H = { tracking_type: 'duration', behavior_type: 'positive', daily_goal: 20, target_direction: 'at_least' };
const BOOL: H = { tracking_type: 'boolean', behavior_type: 'positive', daily_goal: null, target_direction: null };
const NUM_NO_GOAL: H = { tracking_type: 'numeric', behavior_type: 'positive', daily_goal: null, target_direction: 'at_least' };

const plan = (strategy: 'complete_today' | 'push_tomorrow' | 'split_two_days' | 'skip') => ({
  id: 'p1', habit_id: 'h1', strategy, target_date: '2026-08-05',
});

type Written = { habitId: string; date: Date; state: string; value?: number; targetValue?: number; targetDirection?: string };
function recorder(ok = true) {
  const calls: Written[] = [];
  const writeLog = jest.fn(async (input: Written) => { calls.push(input); return ok ? { ok: true } : { ok: false, error: 'boom' }; });
  return { calls, writeLog };
}

beforeEach(() => { (setRecoveryPlanStatus as jest.Mock).mockClear(); });

describe('KD-12 — which make-ups need an amount', () => {
  it('every measurable habit with a target needs one', () => {
    expect(makeupNeedsValue(READ10)).toBe(true);
    expect(makeupNeedsValue(SMOKE2)).toBe(true);
    expect(makeupNeedsValue(MINUTES20)).toBe(true);
  });
  it('a boolean habit, a measurable habit without a target, or no habit does not', () => {
    expect(makeupNeedsValue(BOOL)).toBe(false);
    expect(makeupNeedsValue(NUM_NO_GOAL)).toBe(false);
    expect(makeupNeedsValue(undefined)).toBe(false);
  });
});

describe('KD-12 — the prefill is a suggestion sized by the strategy', () => {
  it('a full make-up suggests the target', () => {
    expect(makeupSuggestedValue(plan('complete_today'), READ10)).toBe(10);
    expect(makeupSuggestedValue(plan('push_tomorrow'), READ10)).toBe(10);
  });
  it('split_two_days suggests half, never below 1', () => {
    expect(makeupSuggestedValue(plan('split_two_days'), READ10)).toBe(5);
    expect(makeupSuggestedValue(plan('split_two_days'), ONE)).toBe(1);
  });
  it('a habit that needs no amount gets no suggestion', () => {
    expect(makeupSuggestedValue(plan('complete_today'), BOOL)).toBeNull();
  });
});

describe('KD-12 — completePlanWithMakeup on a measurable habit', () => {
  it('refuses to write without an amount, and closes nothing', async () => {
    const r = recorder();
    const res = await completePlanWithMakeup({ plan: plan('complete_today'), habit: READ10, writeLog: r.writeLog });
    expect(res).toEqual({ ok: false, error: 'Bu alışkanlık için miktar gerekiyor.', stage: 'log' });
    expect(r.writeLog).not.toHaveBeenCalled();
    expect(setRecoveryPlanStatus).not.toHaveBeenCalled();
  });

  it('the full amount writes done WITH the value -- not done with nothing', async () => {
    const r = recorder();
    const res = await completePlanWithMakeup({ plan: plan('complete_today'), habit: READ10, writeLog: r.writeLog, enteredValue: 10, priorDayValue: 0 });
    expect(res).toEqual({ ok: true });
    expect(r.calls[0]).toMatchObject({ habitId: 'h1', state: 'done', value: 10, targetValue: 10, targetDirection: 'at_least' });
    expect(r.calls[0].date).toEqual(new Date(2026, 7, 5));
  });

  it('a short amount is partial, recorded honestly', async () => {
    const r = recorder();
    await completePlanWithMakeup({ plan: plan('complete_today'), habit: READ10, writeLog: r.writeLog, enteredValue: 4, priorDayValue: 0 });
    expect(r.calls[0]).toMatchObject({ state: 'partial', value: 4 });
  });

  it('the entry ADDS to what the day already holds (R01.03-a contract)', async () => {
    const r = recorder();
    await completePlanWithMakeup({ plan: plan('complete_today'), habit: READ10, writeLog: r.writeLog, enteredValue: 4, priorDayValue: 6 });
    expect(r.calls[0]).toMatchObject({ state: 'done', value: 10 });
  });

  it('split_two_days at goal 1 no longer writes partial for the whole goal', async () => {
    // Old: { state: 'partial', value: 1 } against a goal of 1 -- stateForValue says done.
    const r = recorder();
    await completePlanWithMakeup({ plan: plan('split_two_days'), habit: ONE, writeLog: r.writeLog, enteredValue: 1, priorDayValue: 0 });
    expect(r.calls[0]).toMatchObject({ state: 'done', value: 1 });
  });

  it('split_two_days at the suggested half stays partial -- the reduced rule survives', async () => {
    const r = recorder();
    await completePlanWithMakeup({ plan: plan('split_two_days'), habit: READ10, writeLog: r.writeLog, enteredValue: 5, priorDayValue: 0 });
    expect(r.calls[0]).toMatchObject({ state: 'partial', value: 5 });
  });

  it('a ceiling made up OVER its limit is a miss, not a clean day', async () => {
    const r = recorder();
    await completePlanWithMakeup({ plan: plan('complete_today'), habit: SMOKE2, writeLog: r.writeLog, enteredValue: 5, priorDayValue: 0 });
    expect(r.calls[0]).toMatchObject({ state: 'miss', value: 5 });
  });

  it('the log is still written before the plan is closed, and a failed log closes nothing', async () => {
    const r = recorder(false);
    const res = await completePlanWithMakeup({ plan: plan('complete_today'), habit: READ10, writeLog: r.writeLog, enteredValue: 10, priorDayValue: 0 });
    expect(res).toMatchObject({ ok: false, stage: 'log' });
    expect(setRecoveryPlanStatus).not.toHaveBeenCalled();
  });
});

describe('KD-12 — no measurable make-up row can contradict itself', () => {
  // Every (habit x strategy x entry x prior) the prompt can produce: the
  // written state must equal what the service derives from the written value,
  // and a `done` row's ratio must be a real completion, never the old 0%.
  const habits = [READ10, ONE, SMOKE2, MINUTES20];
  const strategies = ['complete_today', 'push_tomorrow', 'split_two_days'] as const;
  const entries = [0, 0.5, 1, 2, 3, 4, 5, 9, 10, 11, 20];
  const priors = [0, 1, 6];

  it('state === stateForValue(value), and done is never 0%', async () => {
    let n = 0;
    for (const h of habits) for (const st of strategies) for (const e of entries) for (const p of priors) {
      const r = recorder();
      await completePlanWithMakeup({ plan: plan(st), habit: h, writeLog: r.writeLog, enteredValue: e, priorDayValue: p });
      const w = r.calls[0];
      expect(w.state).toBe(stateForValue(h, w.value as number));
      if (w.state === 'done') {
        const ratio = completionRatio({ trackingType: adaptTrackingType(h), state: 'done', value: w.value, target: h.daily_goal, direction: h.target_direction });
        expect(ratio).toBeGreaterThan(0);
      }
      n++;
    }
    expect(n).toBe(habits.length * strategies.length * entries.length * priors.length);
  });
});

describe('KD-12 — non-measurable habits are unchanged (A7)', () => {
  it('a full make-up is still done with no value', async () => {
    const r = recorder();
    const res = await completePlanWithMakeup({ plan: plan('complete_today'), habit: BOOL, writeLog: r.writeLog });
    expect(res).toEqual({ ok: true });
    expect(r.calls[0]).toEqual({ habitId: 'h1', date: new Date(2026, 7, 5), state: 'done', value: undefined, targetValue: undefined, targetDirection: undefined });
  });
  it('split_two_days is still a deliberate partial with no value', async () => {
    const r = recorder();
    await completePlanWithMakeup({ plan: plan('split_two_days'), habit: BOOL, writeLog: r.writeLog });
    expect(r.calls[0]).toMatchObject({ state: 'partial', value: undefined });
  });
  it('makeupFor itself is untouched -- it is just no longer the authority for measurable habits', () => {
    expect(makeupFor(plan('complete_today'), BOOL)).toEqual({ state: 'done' });
    expect(makeupFor(plan('split_two_days'), BOOL)).toEqual({ state: 'partial' });
    expect(makeupFor(plan('split_two_days'), READ10)).toEqual({ state: 'partial', value: 5 });
  });
});
