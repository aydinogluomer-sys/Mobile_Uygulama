/**
 * L1 tests for the Habit Engine V2 completion semantics.  (task 1-W4,
 * IMPLEMENTATION_V2.md §8)
 *
 * Written against `lib/habitEngine.ts`. Follows the style of
 * `habitSchedule.test.ts`/`date.test.ts`: fixed inputs, no injected clock
 * needed here since none of this module reads `Date`.
 */
import {
  adaptTrackingType, completionPercent, completionRatio, deriveState, isPartial,
} from '../../lib/habitEngine';
import type { Habit } from '../../lib/supabase';

describe('adaptTrackingType', () => {
  it('maps a positive boolean habit to binary', () => {
    expect(adaptTrackingType({ tracking_type: 'boolean', behavior_type: 'positive' })).toBe('binary');
  });

  it('maps a positive numeric habit to numeric', () => {
    expect(adaptTrackingType({ tracking_type: 'numeric', behavior_type: 'positive' })).toBe('numeric');
  });

  it('maps ANY negative habit to abstinence, regardless of tracking_type', () => {
    expect(adaptTrackingType({ tracking_type: 'boolean', behavior_type: 'negative' })).toBe('abstinence');
    expect(adaptTrackingType({ tracking_type: 'numeric', behavior_type: 'negative' })).toBe('abstinence');
  });

  it('never produces duration — todays schema cannot express it', () => {
    const cases: Array<Pick<Habit, 'tracking_type' | 'behavior_type'>> = [
      { tracking_type: 'boolean', behavior_type: 'positive' },
      { tracking_type: 'numeric', behavior_type: 'positive' },
      { tracking_type: 'boolean', behavior_type: 'negative' },
      { tracking_type: 'numeric', behavior_type: 'negative' },
    ];
    for (const c of cases) expect(adaptTrackingType(c)).not.toBe('duration');
  });
});

describe('completionRatio — plan-verbatim cases', () => {
  it('Gate B numeric case: target 10000, actual 8000 -> ratio 0.8', () => {
    const ratio = completionRatio({ trackingType: 'numeric', state: 'partial', value: 8000, target: 10000 });
    expect(ratio).toBe(0.8);
    expect(completionPercent(ratio)).toBe(80);
    expect(deriveState({ trackingType: 'numeric', value: 8000, target: 10000 })).toBe('partial');
  });

  it('duration case: target 20 min, actual 12 -> 60%, partial', () => {
    const ratio = completionRatio({ trackingType: 'duration', state: 'partial', value: 12, target: 20 });
    expect(ratio).toBe(0.6);
    expect(completionPercent(ratio)).toBe(60);
    expect(deriveState({ trackingType: 'duration', value: 12, target: 20 })).toBe('partial');
  });
});

describe('completionRatio — binary', () => {
  it('done is 1', () => {
    expect(completionRatio({ trackingType: 'binary', state: 'done' })).toBe(1);
  });
  it('miss is 0', () => {
    expect(completionRatio({ trackingType: 'binary', state: 'miss' })).toBe(0);
  });
  it('an undefined partial state falls to the conservative 0, not a fabricated half-credit', () => {
    expect(completionRatio({ trackingType: 'binary', state: 'partial' })).toBe(0);
  });
});

describe('completionRatio — abstinence semantics', () => {
  it('done means "I abstained today" -> success -> ratio 1', () => {
    expect(completionRatio({ trackingType: 'abstinence', state: 'done' })).toBe(1);
  });
  it('miss means "I relapsed" -> failure -> ratio 0', () => {
    expect(completionRatio({ trackingType: 'abstinence', state: 'miss' })).toBe(0);
  });
});

describe('completionRatio — skip is a neutral 0 for every tracking type', () => {
  it.each(['binary', 'numeric', 'duration', 'abstinence'] as const)('%s + skip -> 0', (trackingType) => {
    expect(completionRatio({ trackingType, state: 'skip', value: 999, target: 10 })).toBe(0);
  });
});

describe('completionRatio — numeric/duration edge cases (documented in W1)', () => {
  it('target null falls back to state: done -> 1', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'done', value: 5, target: null })).toBe(1);
  });
  it('target null falls back to state: miss -> 0', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'miss', value: 5, target: null })).toBe(0);
  });
  it('target 0 behaves the same as target null', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'done', value: 5, target: 0 })).toBe(1);
  });
  it('target negative behaves the same as target null/0', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'done', value: 5, target: -10 })).toBe(1);
  });
  it('value null with a valid target is 0 progress', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'miss', value: null, target: 10 })).toBe(0);
  });
  it('value negative is clamped to 0 progress, not a negative ratio', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'partial', value: -5, target: 10 })).toBe(0);
  });
  it('value greater than target clamps the ratio to 1, not above', () => {
    expect(completionRatio({ trackingType: 'numeric', state: 'done', value: 25, target: 10 })).toBe(1);
  });
  it('value exactly at target is a full 1', () => {
    expect(completionRatio({ trackingType: 'duration', state: 'done', value: 20, target: 20 })).toBe(1);
  });
});

describe('deriveState', () => {
  it('numeric: ratio >= 1 is done', () => {
    expect(deriveState({ trackingType: 'numeric', value: 10000, target: 10000 })).toBe('done');
    expect(deriveState({ trackingType: 'numeric', value: 12000, target: 10000 })).toBe('done');
  });
  it('numeric: 0 < ratio < 1 is partial', () => {
    expect(deriveState({ trackingType: 'numeric', value: 8000, target: 10000 })).toBe('partial');
  });
  it('numeric: ratio 0 (or no value) is miss', () => {
    expect(deriveState({ trackingType: 'numeric', value: 0, target: 10000 })).toBe('miss');
    expect(deriveState({ trackingType: 'numeric', value: null, target: 10000 })).toBe('miss');
  });
  it('binary/abstinence never produce partial', () => {
    expect(deriveState({ trackingType: 'binary', value: 1, target: null })).toBe('done');
    expect(deriveState({ trackingType: 'binary', value: 0, target: null })).toBe('miss');
    expect(deriveState({ trackingType: 'abstinence', value: 1, target: null })).toBe('done');
    expect(deriveState({ trackingType: 'abstinence', value: null, target: null })).toBe('miss');
  });
  it('never returns skip — skip is a user action, not a derived value', () => {
    const combos: Array<{ trackingType: 'binary' | 'numeric' | 'duration' | 'abstinence'; value: number | null; target: number | null }> = [
      { trackingType: 'binary', value: 1, target: null },
      { trackingType: 'numeric', value: 5, target: 10 },
      { trackingType: 'duration', value: 0, target: 20 },
      { trackingType: 'abstinence', value: 0, target: null },
    ];
    for (const c of combos) expect(deriveState(c)).not.toBe('skip');
  });
  it('numeric with degenerate target falls back to value > 0', () => {
    expect(deriveState({ trackingType: 'numeric', value: 5, target: 0 })).toBe('done');
    expect(deriveState({ trackingType: 'numeric', value: 0, target: 0 })).toBe('miss');
  });
});

describe('isPartial', () => {
  it('is true strictly between 0 and 1', () => {
    expect(isPartial(0.5)).toBe(true);
    expect(isPartial(0.01)).toBe(true);
    expect(isPartial(0.99)).toBe(true);
  });
  it('is false at the boundaries', () => {
    expect(isPartial(0)).toBe(false);
    expect(isPartial(1)).toBe(false);
  });
});

describe('completionPercent', () => {
  it('rounds to the nearest integer', () => {
    expect(completionPercent(1 / 3)).toBe(33);
    expect(completionPercent(2 / 3)).toBe(67);
  });
  it('clamps defensively to [0, 100]', () => {
    expect(completionPercent(-0.2)).toBe(0);
    expect(completionPercent(1.4)).toBe(100);
  });
});
