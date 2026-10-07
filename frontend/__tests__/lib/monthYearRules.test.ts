/**
 * R01.02 — "Ayın 29/30/31'i, yıllık 29 Şubat ve hafta başlangıcı davranışı açık olsun."
 *
 * The acceptance sentence as tests: a day the month does not have follows the
 * habit's explicit policy (never silently dropped, never silently moved); 29
 * February in other years follows its explicit policy; the week starts on
 * Monday for both the weekday map and the weekly window. The validator refuses
 * a late day / a 29 February without a policy, so no ambiguous config reaches
 * the engine.
 */
import {
  isEligibleOn, monthDayMatches, yearlyDateMatches, scheduleKind, weekdayIndex, windowFor,
} from '../../lib/habitSchedule';
import { validateFrequencyConfig, MONTH_MAX_DAYS } from '../../lib/routineProposal';
import { occurrencesPerWeek } from '../../lib/capacity';
import { costBreakdown } from '../../lib/triage';
import {
  frequencySummary, isFrequencyComplete, setFrequencyKind, setMonthlyMode, toggleMonthDay,
  setShortMonth, setYearlyDate, setLeapDay, monthlyModeOf,
} from '../../lib/frequencyForm';
import type { Habit, FrequencyConfig } from '../../lib/supabase';

function habit(fc: FrequencyConfig): Habit {
  return {
    id: 'h1', user_id: 'u1', name: 't', behavior_type: 'positive', frequency_config: fc,
    created_at: '2020-01-01T00:00:00Z', end_condition: null, target_direction: null,
  } as Habit;
}

/** Every date of a year on which the habit is eligible, as 'MM-DD'. */
function eligibleDays(fc: FrequencyConfig, year: number): string[] {
  const out: string[] = [];
  const h = habit(fc);
  for (let d = new Date(year, 0, 1); d.getFullYear() === year; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    if (isEligibleOn(h, d)) out.push(`${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return out;
}
const inMonth = (days: string[], m: number) => days.filter((x) => x.startsWith(`${String(m).padStart(2, '0')}-`));

describe('R01.02 — day 29/30/31 of the month', () => {
  it('31st with skip: only the seven 31-day months, nothing in Feb/Apr/Jun/Sep/Nov', () => {
    const days = eligibleDays({ kind: 'monthly', month_days: [31], short_month: 'skip' }, 2026);
    expect(days).toEqual(['01-31', '03-31', '05-31', '07-31', '08-31', '10-31', '12-31']);
  });

  it('31st with last_day: every month exactly once, on its last day', () => {
    const days = eligibleDays({ kind: 'monthly', month_days: [31], short_month: 'last_day' }, 2026);
    expect(days).toHaveLength(12);
    expect(inMonth(days, 2)).toEqual(['02-28']);
    expect(inMonth(days, 4)).toEqual(['04-30']);
  });

  it('30 and 31 with last_day in February are ONE occurrence (28th, or 29th in a leap year)', () => {
    const fc: FrequencyConfig = { kind: 'monthly', month_days: [30, 31], short_month: 'last_day' };
    expect(inMonth(eligibleDays(fc, 2026), 2)).toEqual(['02-28']);
    expect(inMonth(eligibleDays(fc, 2028), 2)).toEqual(['02-29']);
    // April has the 30th, not the 31st: the 30th is the last day -> still one day
    expect(inMonth(eligibleDays(fc, 2026), 4)).toEqual(['04-30']);
  });

  it('29th with skip: February only in leap years', () => {
    const fc: FrequencyConfig = { kind: 'monthly', month_days: [29], short_month: 'skip' };
    expect(inMonth(eligibleDays(fc, 2026), 2)).toEqual([]);
    expect(inMonth(eligibleDays(fc, 2028), 2)).toEqual(['02-29']);
  });

  it('month days respect the date envelope (range_end)', () => {
    expect(eligibleDays({ kind: 'monthly', month_days: [1, 15], range_end: '2026-03-31' }, 2026)).toHaveLength(6);
  });

  it('a day every month has (15th) is unaffected by the policy', () => {
    expect(eligibleDays({ kind: 'monthly', month_days: [1, 15] }, 2026)).toHaveLength(24);
  });

  it('the pure matcher: last_day fires on the last day only when a picked day is past it', () => {
    expect(monthDayMatches(new Date(2026, 3, 30), [15], 'last_day')).toBe(false);
    expect(monthDayMatches(new Date(2026, 3, 30), [31], 'last_day')).toBe(true);
    expect(monthDayMatches(new Date(2026, 3, 29), [31], 'last_day')).toBe(false);
    expect(monthDayMatches(new Date(2026, 3, 30), [31], 'skip')).toBe(false);
  });

  it('scheduleKind tells monthly days from monthly count', () => {
    expect(scheduleKind(habit({ kind: 'monthly', month_days: [5], short_month: undefined })).kind).toBe('monthly_days');
    expect(scheduleKind(habit({ kind: 'monthly', count: 3 })).kind).toBe('monthly_count');
  });
});

describe('R01.02 — yearly 29 February', () => {
  it('a plain yearly date fires once a year', () => {
    expect(eligibleDays({ kind: 'yearly', month: 7, day: 14 }, 2026)).toEqual(['07-14']);
  });

  it('leap year: 29 Feb itself, whatever the policy', () => {
    for (const leap of ['feb28', 'mar1', 'skip'] as const) {
      expect(eligibleDays({ kind: 'yearly', month: 2, day: 29, leap_day: leap }, 2028)).toEqual(['02-29']);
    }
  });

  it('non-leap year: feb28 -> 28 Feb, mar1 -> 1 Mar, skip -> none', () => {
    expect(eligibleDays({ kind: 'yearly', month: 2, day: 29, leap_day: 'feb28' }, 2026)).toEqual(['02-28']);
    expect(eligibleDays({ kind: 'yearly', month: 2, day: 29, leap_day: 'mar1' }, 2026)).toEqual(['03-01']);
    expect(eligibleDays({ kind: 'yearly', month: 2, day: 29, leap_day: 'skip' }, 2026)).toEqual([]);
  });

  it('century rule: 2100 is not a leap year, 2000 is', () => {
    expect(yearlyDateMatches(new Date(2100, 1, 28), 2, 29, 'feb28')).toBe(true);
    expect(yearlyDateMatches(new Date(2000, 1, 29), 2, 29, 'skip')).toBe(true);
    expect(yearlyDateMatches(new Date(2000, 1, 28), 2, 29, 'feb28')).toBe(false);
  });

  it('a yearly habit outside its date envelope is not eligible', () => {
    expect(eligibleDays({ kind: 'yearly', month: 7, day: 14, range_end: '2026-07-13' }, 2026)).toEqual([]);
  });
});

describe('R01.02 — week start is Monday', () => {
  it('weekday index 0 is Monday, 6 is Sunday', () => {
    expect(weekdayIndex(new Date(2026, 7, 3))).toBe(0); // Mon 3 Aug 2026
    expect(weekdayIndex(new Date(2026, 7, 9))).toBe(6); // Sun
  });

  it('the weekly window for a Sunday runs Monday..Sunday of the same week', () => {
    const w = windowFor(habit({ kind: 'weekly', count: 3 }), new Date(2026, 7, 9))!;
    expect([w.start.getDate(), w.end.getDate()]).toEqual([3, 9]);
  });
});

describe('R01.02 — the validator refuses ambiguous configs', () => {
  const ok = (raw: unknown) => validateFrequencyConfig(raw, 'f').errors;
  it('accepts the explicit shapes', () => {
    expect(ok({ kind: 'monthly', month_days: [31], short_month: 'skip' })).toEqual([]);
    expect(ok({ kind: 'monthly', month_days: [1, 15] })).toEqual([]);
    expect(ok({ kind: 'yearly', month: 2, day: 29, leap_day: 'mar1' })).toEqual([]);
    expect(ok({ kind: 'yearly', month: 12, day: 31 })).toEqual([]);
  });
  it('refuses a late day without a short-month policy', () => {
    expect(ok({ kind: 'monthly', month_days: [30] }).length).toBeGreaterThan(0);
  });
  it('refuses 29 Feb without a leap policy, 30 Feb, month 13', () => {
    expect(ok({ kind: 'yearly', month: 2, day: 29 }).length).toBeGreaterThan(0);
    expect(ok({ kind: 'yearly', month: 2, day: 30 }).length).toBeGreaterThan(0);
    expect(ok({ kind: 'yearly', month: 13, day: 1 }).length).toBeGreaterThan(0);
  });
  it('refuses mixed shapes', () => {
    expect(ok({ kind: 'monthly', month_days: [5], count: 2 }).length).toBeGreaterThan(0);
    expect(ok({ kind: 'monthly', month_days: [0] }).length).toBeGreaterThan(0);
    expect(ok({ kind: 'monthly', month_days: [5, 5] }).length).toBeGreaterThan(0);
    expect(ok({ kind: 'weekly', month_days: [5] }).length).toBeGreaterThan(0);
    expect(ok({ kind: 'daily', month: 3, day: 1 }).length).toBeGreaterThan(0);
    expect(ok({ kind: 'yearly', month: 3, day: 1, days: [0] }).length).toBeGreaterThan(0);
    expect(ok({ kind: 'yearly', month: 3, day: 1, count: 2 }).length).toBeGreaterThan(0);
    expect(ok({ kind: 'yearly', month: 3, day: 1, interval_days: 3 }).length).toBeGreaterThan(0);
    // a rule that can never apply is refused, not silently kept or dropped
    expect(ok({ kind: 'yearly', month: 3, day: 1, leap_day: 'skip' }).length).toBeGreaterThan(0);
    expect(ok({ kind: 'monthly', month_days: [5], short_month: 'skip' }).length).toBeGreaterThan(0);
  });
  it('the month table is the real one (February allows 29)', () => {
    expect(MONTH_MAX_DAYS).toEqual([31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  });
});

describe('R01.02 — load and cost read the new kinds', () => {
  it('occurrencesPerWeek: month days count per month, yearly once a year', () => {
    expect(occurrencesPerWeek({ kind: 'monthly', month_days: [1, 15] })).toBeCloseTo(2 * 7 / 30.44, 6);
    expect(occurrencesPerWeek({ kind: 'yearly', month: 1, day: 1 })).toBeCloseTo(7 / 365.25, 6);
  });
  it('cost: a yearly date clamps to the monthly anchor; more month days cost more', () => {
    const base = { difficulty: 3, impact_level: null, behavior_type: 'positive', tracking_type: 'boolean' } as const;
    const y = costBreakdown({ ...base, frequency_config: { kind: 'yearly' } });
    const m1 = costBreakdown({ ...base, frequency_config: { kind: 'monthly' } });
    const m10 = costBreakdown({ ...base, frequency_config: { kind: 'monthly', month_days: [1, 3, 5, 7, 9, 11, 13, 15, 17, 19] } });
    expect(y.freqKind).toBe('yearly');
    expect(y.freqFactor).toBe(m1.freqFactor);
    expect(m10.freqFactor).toBeGreaterThan(m1.freqFactor);
  });
});

describe('R01.02 — the form helpers', () => {
  it('monthly -> days -> pick 31 needs a policy before it is complete', () => {
    let fc = setMonthlyMode(setFrequencyKind({ kind: 'daily' }, 'monthly'), 'days');
    expect(monthlyModeOf(fc)).toBe('days');
    expect(fc.count).toBeUndefined();
    fc = toggleMonthDay(fc, 31);
    expect(isFrequencyComplete(fc)).toBe(false);
    fc = setShortMonth(fc, 'last_day');
    expect(isFrequencyComplete(fc)).toBe(true);
    expect(frequencySummary(fc)).toMatch(/31/);
    expect(frequencySummary(fc)).toMatch(/son gün/);
    // un-picking the late day drops the policy
    expect(toggleMonthDay(fc, 31).short_month).toBeUndefined();
  });
  it('switching to yearly on the 31st starts on a day every year has (<= 28)', () => {
    jest.useFakeTimers({ now: new Date(2026, 0, 31, 12) });
    try {
      const fc = setFrequencyKind({ kind: 'daily' }, 'yearly');
      expect([fc.month, fc.day]).toEqual([1, 28]);
      expect(isFrequencyComplete(fc)).toBe(true);
    } finally { jest.useRealTimers(); }
  });

  it('yearly 29 Feb needs a leap policy; moving off 29 Feb drops it; day clamps to the month', () => {
    let fc = setYearlyDate(setFrequencyKind({ kind: 'daily' }, 'yearly'), 2, 29);
    expect(isFrequencyComplete(fc)).toBe(false);
    fc = setLeapDay(fc, 'mar1');
    expect(isFrequencyComplete(fc)).toBe(true);
    expect(frequencySummary(fc)).toMatch(/29 Şubat/);
    expect(frequencySummary(fc)).toMatch(/1 Mart/);
    expect(setYearlyDate(fc, 2, 28).leap_day).toBeUndefined();
    expect(setYearlyDate(fc, 4, 31).day).toBe(30);
    expect(setYearlyDate(fc, 1, 0).day).toBe(1);
  });
});
