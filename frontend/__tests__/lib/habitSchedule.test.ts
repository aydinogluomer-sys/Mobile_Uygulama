/**
 * L1 tests for habit scheduling.  (task 1E-L1a)
 *
 * AC-H03: a `{kind:'weekly', count:n}` habit with no explicit `days` is due on
 * no day of the year. `isDueOn` falls through to `return false`, so "3 times a
 * week" is never due, never missed, and never counted.
 *
 * Written BEFORE the fix and observed to fail, per R-01. A test that passes
 * against unmodified code is not evidence of anything.
 */
import type { Habit } from '../../lib/supabase';
import { isDueOn, weekdayIndex } from '../../lib/habitSchedule';

/** Minimal positive habit; override what a case cares about. */
function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    user_id: 'u1',
    name: 'test',
    behavior_type: 'positive',
    frequency_config: { kind: 'daily' },
    created_at: '2020-01-01T00:00:00Z',
    end_condition: null,
    target_direction: null,
    ...over,
  } as Habit;
}

// 2026-08-03 is a Monday; the ISO week runs Mon 03 .. Sun 09.
const MON = new Date(2026, 7, 3);
const TUE = new Date(2026, 7, 4);
const WED = new Date(2026, 7, 5);
const THU = new Date(2026, 7, 6);
const FRI = new Date(2026, 7, 7);
const SAT = new Date(2026, 7, 8);
const SUN = new Date(2026, 7, 9);
const WEEK = [MON, TUE, WED, THU, FRI, SAT, SUN];

describe('weekdayIndex', () => {
  it('maps Monday to 0 and Sunday to 6', () => {
    expect(weekdayIndex(MON)).toBe(0);
    expect(weekdayIndex(SUN)).toBe(6);
  });
});

describe('isDueOn — daily', () => {
  it('is due every day', () => {
    const h = habit({ frequency_config: { kind: 'daily' } });
    expect(WEEK.every((d) => isDueOn(h, d))).toBe(true);
  });
});

describe('isDueOn — weekly with explicit days (must not regress)', () => {
  const h = habit({ frequency_config: { kind: 'weekly', days: [0, 2, 4] } });

  it('is due exactly on Mon, Wed, Fri', () => {
    expect(WEEK.map((d) => isDueOn(h, d))).toEqual([true, false, true, false, true, false, false]);
  });
});

describe('AC-H03 — weekly with count and no days', () => {
  const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });

  it('is due on at least `count` days of the ISO week', () => {
    const dueDays = WEEK.filter((d) => isDueOn(h, d)).length;
    expect(dueDays).toBeGreaterThanOrEqual(3);
  });

  it('is due on exactly `count` days — neither never nor every day', () => {
    expect(WEEK.filter((d) => isDueOn(h, d)).length).toBe(3);
  });

  it('count:1 is due on exactly one day', () => {
    const h1 = habit({ frequency_config: { kind: 'weekly', count: 1 } });
    expect(WEEK.filter((d) => isDueOn(h1, d)).length).toBe(1);
  });

  it('count:7 is due every day', () => {
    const h7 = habit({ frequency_config: { kind: 'weekly', count: 7 } });
    expect(WEEK.filter((d) => isDueOn(h7, d)).length).toBe(7);
  });

  it('is deterministic — the same date always gives the same answer', () => {
    expect(isDueOn(h, WED)).toBe(isDueOn(h, WED));
  });

  it('gives the same pattern in every ISO week', () => {
    const nextWeek = WEEK.map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7));
    expect(WEEK.map((d) => isDueOn(h, d))).toEqual(nextWeek.map((d) => isDueOn(h, d)));
  });

  it('weekly with neither days nor count stays conservative (not due)', () => {
    const h0 = habit({ frequency_config: { kind: 'weekly' } });
    expect(WEEK.filter((d) => isDueOn(h0, d)).length).toBe(0);
  });
});

describe('isDueOn — guards still hold', () => {
  it('negative habits are never due', () => {
    const h = habit({ behavior_type: 'negative', frequency_config: { kind: 'weekly', count: 3 } });
    expect(WEEK.some((d) => isDueOn(h, d))).toBe(false);
  });

  it('not due before created_at', () => {
    const h = habit({
      frequency_config: { kind: 'daily' },
      created_at: '2026-08-05T00:00:00Z',
    });
    expect(isDueOn(h, MON)).toBe(false);
    expect(isDueOn(h, WED)).toBe(true);
  });

  it('not due after a date end_condition', () => {
    const h = habit({
      frequency_config: { kind: 'daily' },
      end_condition: { kind: 'date', value: '2026-08-05' },
    });
    expect(isDueOn(h, WED)).toBe(true);
    expect(isDueOn(h, THU)).toBe(false);
  });

  it('count-based habits respect the same guards', () => {
    const h = habit({
      frequency_config: { kind: 'weekly', count: 7 },
      end_condition: { kind: 'date', value: '2026-08-05' },
    });
    expect(isDueOn(h, THU)).toBe(false);
  });
});

describe('isDueOn — monthly is an explicit decision', () => {
  it('is not due on any day, deliberately', () => {
    const h = habit({ frequency_config: { kind: 'monthly' } });
    expect(WEEK.some((d) => isDueOn(h, d))).toBe(false);
  });
});
