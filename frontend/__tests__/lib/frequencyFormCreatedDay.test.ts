/**
 * F15 (DOM-12): `frequencyForm.ts` preserves `created_day` across schedule edits,
 * accepts stamped complete configs in `isFrequencyComplete`, and keeps
 * `validateFrequencyConfig` (`routineProposal.ts`) rejecting `created_day` so AI
 * proposals cannot inject creation-day stamps.
 */
import {
  isFrequencyComplete,
  setFrequencyCount,
  setFrequencyKind,
  setIntervalDays,
  setRangeEnd,
  setRangeStart,
  setWeeklyMode,
  toggleMonthDay,
  togglePartOfDay,
  toggleWeekday,
  setMonthlyMode,
  setShortMonth,
  setYearlyDate,
  setLeapDay,
} from '../../lib/frequencyForm';
import { validateFrequencyConfig } from '../../lib/routineProposal';
import type { FrequencyConfig } from '../../lib/supabase';
import { a7Paths, legacyRun } from '../helpers/legacyFrequencyForm';

describe('frequencyForm with created_day stamp (F15)', () => {
  const STAMP = '2026-08-01';

  it('(+) preserves created_day across kind switches and shape edits', () => {
    let fc: FrequencyConfig = { kind: 'daily', created_day: STAMP, part_of_day: ['morning'] };
    fc = setIntervalDays(fc, 3);
    expect(fc.created_day).toBe(STAMP);

    fc = setFrequencyKind(fc, 'weekly');
    expect(fc.created_day).toBe(STAMP);
    fc = setWeeklyMode(fc, 'days');
    fc = toggleWeekday(fc, 1);
    expect(fc.created_day).toBe(STAMP);

    fc = setFrequencyKind(fc, 'monthly');
    expect(fc.created_day).toBe(STAMP);
    fc = setFrequencyCount(fc, 4);
    fc = setMonthlyMode(fc, 'days');
    fc = toggleMonthDay(fc, 31);
    fc = setShortMonth(fc, 'last_day');
    expect(fc.created_day).toBe(STAMP);

    fc = setFrequencyKind(fc, 'yearly');
    expect(fc.created_day).toBe(STAMP);
    fc = setYearlyDate(fc, 2, 29);
    fc = setLeapDay(fc, 'feb28');
    expect(fc.created_day).toBe(STAMP);

    fc = setFrequencyKind(fc, 'daily');
    fc = togglePartOfDay(fc, 'morning');
    fc = setRangeStart(fc, '2026-08-10');
    fc = setRangeEnd(fc, '2026-08-20');
    expect(fc.created_day).toBe(STAMP);
  });

  it('(+) isFrequencyComplete accepts valid stamped configs across all shapes', () => {
    const validStamped: FrequencyConfig[] = [
      { kind: 'daily', created_day: STAMP },
      { kind: 'daily', interval_days: 3, created_day: STAMP },
      { kind: 'weekly', count: 3, created_day: STAMP },
      { kind: 'weekly', days: [0, 2, 4], created_day: STAMP },
      { kind: 'monthly', count: 2, created_day: STAMP },
      { kind: 'monthly', month_days: [1, 15], created_day: STAMP },
      { kind: 'yearly', month: 5, day: 19, created_day: STAMP },
    ];
    for (const fc of validStamped) {
      expect(isFrequencyComplete(fc)).toBe(true);
    }
  });

  it('(-) isFrequencyComplete still rejects target-less stamped configs', () => {
    expect(isFrequencyComplete({ kind: 'weekly', days: [], created_day: STAMP })).toBe(false);
    expect(isFrequencyComplete({ kind: 'monthly', created_day: STAMP })).toBe(false);
    expect(isFrequencyComplete({ kind: 'monthly', month_days: [], created_day: STAMP })).toBe(false);
  });

  it('(-) validateFrequencyConfig still refuses created_day (AI injection remains closed)', () => {
    const res = validateFrequencyConfig(
      { kind: 'daily', created_day: STAMP },
      'frequency_config',
    );
    expect(res.frequency).toBeNull();
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it('(+) unstamped transitions stay identical to legacyFrequencyForm paths', () => {
    const runModern = (actions: ReturnType<typeof a7Paths>[number]['actions']): FrequencyConfig => {
      let fc: FrequencyConfig = { kind: 'daily' };
      for (const a of actions) {
        if (a.t === 'kind') {
          fc = setFrequencyKind(fc, a.kind);
          if (a.kind === 'weekly') fc = setWeeklyMode(fc, 'days');
        } else if (a.t === 'day') {
          fc = toggleWeekday(fc, a.i);
        } else {
          fc = togglePartOfDay(fc, a.p);
        }
      }
      return fc;
    };
    const paths = a7Paths();
    expect(paths.length).toBeGreaterThan(0);
    for (const p of paths) {
      const legacy = legacyRun(p.actions);
      const modern = runModern(p.actions);
      const normLegacy = legacy.part_of_day?.length === 0
        ? (({ part_of_day: _drop, ...r }) => r)(legacy)
        : legacy;
      expect(modern).toEqual(normLegacy);
    }
  });
});
