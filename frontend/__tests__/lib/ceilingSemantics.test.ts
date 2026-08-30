/**
 * `target_direction = 'at_most'` — ceiling semantics.
 *
 * ## The defect
 *
 * `completionRatio`/`deriveState` scored every measured habit with a floor's
 * arithmetic, `min(value / target, 1)`, and never looked at
 * `target_direction`. For "at most 2 cigarettes a day" that inverts the
 * reward completely:
 *
 *     smoked 0 of 2  -> 0 / 2 = 0%   -> state 'miss'   (the BEST day)
 *     smoked 2 of 2  -> 2 / 2 = 100% -> state 'done'
 *     smoked 20 of 2 -> clamped 100% -> state 'done'   (the WORST day)
 *
 * The better the behaviour, the worse the score — and a perfect day was
 * recorded as a missed one, which feeds streaks, capacity and XP.
 *
 * This was unreachable while `behavior_type === 'negative'` forced every
 * negative habit to `abstinence`. Making negative+numeric expressible is
 * exactly what exposed it, so it ships with that change rather than after it.
 *
 * ## A second bug the same fix closes
 *
 * `lib/reportMetrics.ts` had ALREADY implemented ceiling scoring correctly,
 * by hand, in its own function. So one day produced two different numbers
 * depending on who asked: the weekly report said 100%, the engine — and
 * therefore XP and state derivation — said 0%. `habitLogPercent` now
 * delegates to `completionRatio`, so there is one definition.
 */
import { completionRatio, deriveState, completionPercent } from '../../lib/habitEngine';
import { calculateHabitCompletionRate } from '../../lib/reportMetrics';
import type { Habit, HabitLog } from '../../lib/supabase';

const ceiling = (value: number | null | undefined, target: number | null | undefined) =>
  completionRatio({ trackingType: 'numeric', state: 'partial', value, target, direction: 'at_most' });

const ceilingState = (value: number | null | undefined, target: number | null | undefined) =>
  deriveState({ trackingType: 'numeric', value, target, direction: 'at_most' });

describe('at_most — staying under the limit is success', () => {
  it('zero is a perfect day, not a missed one', () => {
    expect(ceiling(0, 2)).toBe(1);
    expect(completionPercent(ceiling(0, 2))).toBe(100);
    expect(ceilingState(0, 2)).toBe('done');
  });

  it('under the limit is a perfect day', () => {
    expect(ceiling(1, 2)).toBe(1);
    expect(ceilingState(1, 2)).toBe('done');
  });

  it('exactly at the limit is still success', () => {
    expect(ceiling(2, 2)).toBe(1);
    expect(ceilingState(2, 2)).toBe('done');
  });

  it('the at_least reading of the same day is the exact inverse', () => {
    // Pinned as the contrast, so a regression to direction-blind scoring is
    // visible as a change in meaning rather than a number.
    const asFloor = completionRatio({ trackingType: 'numeric', state: 'partial', value: 0, target: 2 });
    expect(asFloor).toBe(0);
    expect(ceiling(0, 2)).toBe(1);
  });
});

describe('at_most — going over decays, it does not reward', () => {
  it('overshoot reduces the score', () => {
    expect(ceiling(3, 2)).toBeCloseTo(0.5, 10);   // 1 over a limit of 2
    expect(ceilingState(3, 2)).toBe('partial');
  });

  it('reaches zero at twice the limit', () => {
    expect(ceiling(4, 2)).toBe(0);
    expect(ceilingState(4, 2)).toBe('miss');
  });

  it('never goes below zero, however large the overshoot', () => {
    expect(ceiling(20, 2)).toBe(0);
    expect(ceiling(1_000_000, 2)).toBe(0);
    expect(ceilingState(20, 2)).toBe('miss');
  });

  it('a worse day never scores higher than a better one', () => {
    const scores = [0, 1, 2, 3, 4, 10].map((v) => ceiling(v, 2));
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });
});

describe('at_most — target = 0 is zero tolerance', () => {
  it('zero on a zero limit is success', () => {
    expect(ceiling(0, 0)).toBe(1);
    expect(ceilingState(0, 0)).toBe('done');
  });

  it('anything above a zero limit is a miss, without dividing by zero', () => {
    expect(ceiling(1, 0)).toBe(0);
    expect(ceiling(100, 0)).toBe(0);
    expect(ceilingState(1, 0)).toBe('miss');
    expect(Number.isFinite(ceiling(1, 0))).toBe(true);
  });
});

describe('at_most — hostile and absent input', () => {
  it('a missing value is NOT credited as staying under the limit', () => {
    // Nothing was recorded. Crediting a perfect day would reward not logging.
    expect(completionRatio({ trackingType: 'numeric', state: 'partial', value: null, target: 2, direction: 'at_most' })).toBe(0);
    expect(completionRatio({ trackingType: 'numeric', state: 'done', value: null, target: 2, direction: 'at_most' })).toBe(1);
    expect(ceilingState(null, 2)).toBe('miss');
    expect(ceilingState(undefined, 2)).toBe('miss');
  });

  it('NaN is treated as absent, never propagated', () => {
    const r = ceiling(NaN, 2);
    expect(Number.isNaN(r)).toBe(false);
    expect(r).toBe(0);
    expect(ceilingState(NaN, 2)).toBe('miss');
  });

  it('a negative value is floored at zero, i.e. success', () => {
    expect(ceiling(-5, 2)).toBe(1);
    expect(ceilingState(-5, 2)).toBe('done');
  });

  it('Infinity is a miss, not NaN or a clamp to success', () => {
    expect(ceiling(Infinity, 2)).toBe(0);
    expect(ceilingState(Infinity, 2)).toBe('miss');
  });

  it('a non-finite target falls back to the logged state', () => {
    for (const t of [null, undefined, NaN, Infinity, -1]) {
      expect(completionRatio({ trackingType: 'numeric', state: 'done', value: 5, target: t as number, direction: 'at_most' })).toBe(1);
      expect(completionRatio({ trackingType: 'numeric', state: 'miss', value: 5, target: t as number, direction: 'at_most' })).toBe(0);
    }
  });

  it('a skipped day is still excluded, direction notwithstanding', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'skip', value: 0, target: 2, direction: 'at_most' })).toBe(0);
  });
});

describe('at_most — duration ceilings behave identically', () => {
  it('under a time budget is success', () => {
    // "at most 30 minutes of social media"
    expect(completionRatio({ trackingType: 'duration', state: 'partial', value: 10, target: 30, direction: 'at_most' })).toBe(1);
    expect(deriveState({ trackingType: 'duration', value: 10, target: 30, direction: 'at_most' })).toBe('done');
  });

  it('double the budget scores zero', () => {
    expect(completionRatio({ trackingType: 'duration', state: 'partial', value: 60, target: 30, direction: 'at_most' })).toBe(0);
  });
});

describe('the engine and the report now agree', () => {
  // The whole point of routing habitLogPercent through completionRatio.
  //
  // The fixture is a POSITIVE habit with a ceiling ("at most 30 minutes of
  // screen time"), not a negative one, because `isDueOn` excludes negative
  // habits outright — see the describe block below, which pins that.
  const habit = (overrides: Partial<Habit> = {}) => ({
    id: 'h1', name: 'Ekran süresi', color: '#000', status: 'active',
    tracking_type: 'numeric', daily_goal: 2, target_direction: 'at_most',
    behavior_type: 'positive', frequency_config: { kind: 'daily' },
    created_at: '2026-01-01T00:00:00Z', end_condition: null,
    ...overrides,
  } as unknown as Habit);

  const logFor = (value: number, state: HabitLog['state'] = 'partial') => ([{
    habit_id: 'h1', completed_at: '2026-08-30', state, value,
  }] as Array<Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>>);

  it.each([
    [0, 100],
    [1, 100],
    [2, 100],
    [3, 50],
    [4, 0],
  ])('value %i scores %i%% in the report, matching the engine', (value, expected) => {
    const reported = calculateHabitCompletionRate([habit()], logFor(value), '2026-08-30', '2026-08-30');
    expect(reported).toBe(expected);
    expect(completionPercent(ceiling(value, 2))).toBe(expected);
  });

  it('a floor habit is unaffected by the change', () => {
    const floor = habit({ target_direction: 'at_least', daily_goal: 10 } as Partial<Habit>);
    expect(calculateHabitCompletionRate([floor], logFor(5), '2026-08-30', '2026-08-30')).toBe(50);
    expect(calculateHabitCompletionRate([floor], logFor(10), '2026-08-30', '2026-08-30')).toBe(100);
  });
});

describe('KNOWN GAP — negative habits are excluded from due-day reporting', () => {
  /**
   * `habitSchedule.isDueOn` opens with `if (habit.behavior_type !== 'positive')
   * return false`, so a negative habit is never due on any day. Everything
   * built on due days therefore skips it entirely: `habitAveragePercent`,
   * `calculateHabitCompletionRate`, and the missed-day backlog that feeds
   * recovery (`app/screens/recovery.tsx` filters on the same predicate).
   *
   * That was invisible while negative habits could only be `abstinence`
   * flags. Now that "at most 2 cigarettes" is expressible, a user can create
   * a habit that is tracked, scored correctly by the engine, and reported
   * nowhere.
   *
   * This is pinned as CURRENT BEHAVIOUR rather than fixed here: changing
   * `isDueOn` alters streaks, capacity, recovery backlog and every report at
   * once, which is a product decision with a far wider blast radius than
   * ceiling scoring. Recorded in the pre-merge audit as an open gap so it is
   * visible rather than inferred from a missing test.
   */
  const negative = {
    id: 'n1', name: 'Sigara', color: '#000', status: 'active',
    tracking_type: 'numeric', daily_goal: 2, target_direction: 'at_most',
    behavior_type: 'negative', frequency_config: { kind: 'daily' },
    created_at: '2026-01-01T00:00:00Z', end_condition: null,
  } as unknown as Habit;

  it('scores 0 in due-day reports regardless of a perfect day', () => {
    const perfectDay = [{ habit_id: 'n1', completed_at: '2026-08-30', state: 'done' as const, value: 0 }];
    expect(calculateHabitCompletionRate([negative], perfectDay, '2026-08-30', '2026-08-30')).toBe(0);
    // …while the engine scores the same day correctly.
    expect(ceiling(0, 2)).toBe(1);
  });
});
