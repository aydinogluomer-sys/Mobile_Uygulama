/**
 * KD-09 — an installed habit's schedule can be edited, with the SAME controls
 * as the creation form, and the edit does not silently rewrite a cost the user
 * chose by hand.
 *
 * Before: habit-detail only displayed the schedule (with its own kind-based
 * label that called "3 a week, 5-20 Aug" just "Haftada 3 kez" and an every-3-
 * days habit "Her gün"); once installed, interval / range / count could not be
 * changed at all.
 */
import type { Habit, FrequencyConfig } from '../../lib/supabase';
import { frequencyEditPatch, frequencySummary } from '../../lib/frequencyForm';
import { computeWillpowerCost, type CostInput } from '../../lib/triage';

type H = Pick<Habit, 'difficulty' | 'impact_level' | 'behavior_type' | 'tracking_type' | 'estimated_minutes' | 'willpower_cost' | 'frequency_config'>;
const base = (fc: FrequencyConfig, over: Partial<H> = {}): H => ({
  difficulty: 4, impact_level: 'high', behavior_type: 'positive', tracking_type: 'boolean',
  estimated_minutes: 30, willpower_cost: 0, frequency_config: fc, ...over,
});
const formulaCost = (h: H, fc: FrequencyConfig) =>
  computeWillpowerCost({ ...h, estimated_minutes: h.estimated_minutes ?? undefined, frequency_config: fc } as CostInput);

describe('KD-09 — frequencyEditPatch', () => {
  it('a cost left to the formula follows the new schedule', () => {
    const daily: FrequencyConfig = { kind: 'daily' };
    const every7: FrequencyConfig = { kind: 'daily', interval_days: 7 };
    const h = base(daily);
    h.willpower_cost = formulaCost(h, daily);
    const patch = frequencyEditPatch(h, every7);
    expect(patch.frequency_config).toBe(every7);
    expect(patch.willpower_cost).toBe(formulaCost(h, every7));
    expect(patch.willpower_cost).toBeLessThan(h.willpower_cost);   // less often -> cheaper (R01.02-d2)
  });

  it('a cost the user picked by hand is kept -- the edit does not touch it', () => {
    const daily: FrequencyConfig = { kind: 'daily' };
    const h = base(daily, { willpower_cost: 9 });
    expect(formulaCost(h, daily)).not.toBe(9);                   // precondition: it IS a manual value
    const patch = frequencyEditPatch(h, { kind: 'daily', interval_days: 7 });
    expect(patch).toEqual({ frequency_config: { kind: 'daily', interval_days: 7 } });
    expect('willpower_cost' in patch).toBe(false);
  });

  it('when the formula gives the same cost, willpower_cost is not in the patch', () => {
    const a: FrequencyConfig = { kind: 'weekly', days: [0, 2, 4] };
    const b: FrequencyConfig = { kind: 'weekly', days: [1, 3, 5] };
    const h = base(a);
    h.willpower_cost = formulaCost(h, a);
    expect(formulaCost(h, b)).toBe(h.willpower_cost);
    expect(frequencyEditPatch(h, b)).toEqual({ frequency_config: b });
  });

  it('adding a date envelope alone leaves the cost (a range is lifetime, not frequency)', () => {
    const daily: FrequencyConfig = { kind: 'daily' };
    const h = base(daily);
    h.willpower_cost = formulaCost(h, daily);
    expect(frequencyEditPatch(h, { kind: 'daily', range_start: '2026-08-05' })).toEqual({ frequency_config: { kind: 'daily', range_start: '2026-08-05' } });
  });
});

describe('KD-09 — the detail screen says the real schedule', () => {
  // The old habit-detail label was kind-based; these are the shapes it got wrong.
  it.each([
    [{ kind: 'daily', interval_days: 3 } as FrequencyConfig, '3 günde bir'],
    [{ kind: 'weekly', count: 3, range_start: '2026-08-05', range_end: '2026-08-20' } as FrequencyConfig, 'Haftada 3 kez · '],
    [{ kind: 'monthly', count: 10 } as FrequencyConfig, 'Ayda 10 kez'],
  ])('%j -> "%s…"', (fc, expected) => {
    expect(frequencySummary(fc).startsWith(expected)).toBe(true);
  });
});
