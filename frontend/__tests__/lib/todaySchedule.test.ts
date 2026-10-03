/**
 * R01.06-a — Bugün ekranı kanonik takvimi sorar.
 *
 * Before this card `app/tabs/today.tsx` filtered on `status === 'active'` only,
 * so a Mon/Wed/Fri habit was a "remaining step" on Tuesday, sat in the
 * percentage denominator and was listed. These tests drive the screen's pure
 * selectors (`selectTodayHabits`, `summarizeTodayHabits`, `todayHabitCopy`)
 * with fixtures -- no render, no store.
 *
 * A1  Mon/Wed/Fri: absent Tuesday, present Wednesday
 * A2  "3 a week": present all 7 days
 * A3  "10 a month": present every day of the month
 * A4  interval_days / range_start+range_end follow `dueOnExtended`
 * A5  weekly row with neither days nor count stays VISIBLE (fail-open)
 * A6  pct and "N adım kaldı" share one denominator; no division by zero;
 *     denominator 0 shows the empty-state copy
 */
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from: () => { throw new Error('today selectors must not touch supabase'); },
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import { addDaysLocal } from '../../lib/date';
import type { Habit } from '../../lib/supabase';
import {
  selectTodayHabits, summarizeTodayHabits, todayHabitCopy, isScheduleAmbiguous,
} from '../../app/tabs/today';

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    user_id: 'u1',
    name: 'test',
    behavior_type: 'positive',
    status: 'active',
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

const ids = (hs: Habit[]) => hs.map((h) => h.id);
const shows = (h: Habit, d: Date) => ids(selectTodayHabits([h], d)).includes(h.id);

const MWF = habit({ id: 'mwf', frequency_config: { kind: 'weekly', days: [0, 2, 4] } });

describe('A1 — fixed weekdays', () => {
  it('Mon/Wed/Fri habit is NOT in Tuesday\'s list', () => {
    expect(shows(MWF, TUE)).toBe(false);
  });

  it('Mon/Wed/Fri habit IS in Wednesday\'s list', () => {
    expect(shows(MWF, WED)).toBe(true);
  });

  it('across the week it appears exactly on Mon, Wed, Fri', () => {
    expect(WEEK.map((d) => shows(MWF, d))).toEqual([true, false, true, false, true, false, false]);
  });

  it('NEGATIVE: on Tuesday it is not in the denominator (red if it is)', () => {
    const daily = habit({ id: 'daily' });
    const s = summarizeTodayHabits(selectTodayHabits([MWF, daily], TUE), []);
    expect(s.total).toBe(1);
    expect(s.remaining).toBe(1);
  });
});

describe('A2 — weekly count ("3 a week")', () => {
  const h = habit({ id: 'w3', frequency_config: { kind: 'weekly', count: 3 } });

  it('is present on all 7 days of the week', () => {
    expect(WEEK.map((d) => shows(h, d))).toEqual([true, true, true, true, true, true, true]);
  });

  it('NEGATIVE: a count-based habit is never hidden from Today (red if it is)', () => {
    for (const d of WEEK) expect(shows(h, d)).toBe(true);
  });
});

describe('A3 — monthly count ("10 a month")', () => {
  const h = habit({ id: 'm10', frequency_config: { kind: 'monthly', count: 10 } });

  it('is present on every day of the month', () => {
    const days = Array.from({ length: 31 }, (_, i) => new Date(2026, 7, i + 1));
    expect(days.filter((d) => !shows(h, d)).map((d) => d.getDate())).toEqual([]);
  });
});

describe('A4 — interval_days / date range follow dueOnExtended (fixtures; not yet writable by the client)', () => {
  it('every 3 days from a Monday creation: Mon and Thu and Sun, not the days between', () => {
    const h = habit({
      id: 'n3',
      created_at: '2026-08-03T09:00:00', // local, Monday
      frequency_config: { kind: 'daily', interval_days: 3 },
    });
    expect(WEEK.map((d) => shows(h, d))).toEqual([true, false, false, true, false, false, true]);
  });

  it('date range Wed..Fri: only inside the window', () => {
    const h = habit({
      id: 'rng',
      frequency_config: { kind: 'daily', range_start: '2026-08-05', range_end: '2026-08-07' },
    });
    expect(WEEK.map((d) => shows(h, d))).toEqual([false, false, true, true, true, false, false]);
  });
});

describe('A5 — fail-open: an ambiguous schedule stays visible', () => {
  it('weekly row with neither days nor count is shown every day', () => {
    const h = habit({ id: 'bad', frequency_config: { kind: 'weekly' } });
    expect(isScheduleAmbiguous(h)).toBe(true);
    expect(WEEK.map((d) => shows(h, d))).toEqual([true, true, true, true, true, true, true]);
  });

  it('NEGATIVE: weekly row with empty days and count 0 is not hidden (red if it is)', () => {
    const h = habit({ id: 'bad0', frequency_config: { kind: 'weekly', days: [], count: 0 } });
    expect(shows(h, TUE)).toBe(true);
  });

  it('monthly row without a count is shown', () => {
    const h = habit({ id: 'badm', frequency_config: { kind: 'monthly' } });
    expect(shows(h, TUE)).toBe(true);
  });

  it('weekly row whose days hold no valid weekday index is shown', () => {
    const h = habit({ id: 'bad9', frequency_config: { kind: 'weekly', days: [9] } });
    expect(isScheduleAmbiguous(h)).toBe(true);
    expect(shows(h, TUE)).toBe(true);
  });

  it('a well-formed schedule is NOT ambiguous (fail-open does not swallow A1)', () => {
    expect(isScheduleAmbiguous(MWF)).toBe(false);
    expect(isScheduleAmbiguous(habit({ frequency_config: { kind: 'weekly', count: 3 } }))).toBe(false);
  });
});

describe('status and lifetime', () => {
  it('non-active habits never enter Today', () => {
    for (const status of ['paused', 'waiting', 'idea', 'completed'] as const) {
      expect(shows(habit({ id: status, status } as Partial<Habit>), WED)).toBe(false);
    }
  });

  it('a habit whose dated end condition has passed is not in Today', () => {
    const h = habit({ id: 'ended', end_condition: { kind: 'date', value: '2026-08-04' } } as Partial<Habit>);
    expect(shows(h, TUE)).toBe(true);
    expect(shows(h, WED)).toBe(false);
  });
});

describe('A6 — one denominator for pct and "N adım kaldı"', () => {
  const daily = habit({ id: 'daily' });
  const w3 = habit({ id: 'w3', frequency_config: { kind: 'weekly', count: 3 } });

  it('pct and remaining come from the same total', () => {
    const list = selectTodayHabits([MWF, daily, w3], TUE); // MWF excluded
    const s = summarizeTodayHabits(list, [daily]);
    expect(s).toEqual({ total: 2, completed: 1, remaining: 1, pct: 0.5 });
    expect(s.pct).toBe(s.completed / s.total);
    expect(s.remaining).toBe(s.total - s.completed);
    expect(todayHabitCopy(s, 3)).toEqual({ metricSub: '1 adım kaldı', ringSub: '1/2 tamamlandı' });
  });

  it('all done today reads as complete even though a Mon/Wed/Fri habit is untouched', () => {
    const s = summarizeTodayHabits(selectTodayHabits([MWF, daily], TUE), [daily]);
    expect(s.pct).toBe(1);
    expect(todayHabitCopy(s, 2).metricSub).toBe('günlük seri tamam');
  });

  it('a completion outside today\'s list (Mon/Wed/Fri logged on Tuesday elsewhere) cannot inflate the numerator', () => {
    const s = summarizeTodayHabits(selectTodayHabits([MWF, daily], TUE), [MWF]);
    expect(s).toEqual({ total: 1, completed: 0, remaining: 1, pct: 0 });
  });

  it('denominator 0 with active habits: pct 0, no NaN, "nothing planned today" copy', () => {
    const s = summarizeTodayHabits(selectTodayHabits([MWF], TUE), [MWF]);
    expect(s).toEqual({ total: 0, completed: 0, remaining: 0, pct: 0 });
    expect(Number.isFinite(s.pct)).toBe(true);
    expect(todayHabitCopy(s, 1)).toEqual({ metricSub: 'bugün planlı ritüel yok', ringSub: 'Bugün planlı ritüel yok' });
  });

  it('denominator 0 with no active habits: the create-first empty state', () => {
    const s = summarizeTodayHabits([], []);
    expect(s.pct).toBe(0);
    expect(todayHabitCopy(s, 0)).toEqual({ metricSub: 'ilk ritüelini oluştur', ringSub: 'Henüz aktif bir ritüel yok' });
  });

  it('day boundary is local: Tuesday 23:59 is still Tuesday', () => {
    const lateTue = new Date(2026, 7, 4, 23, 59);
    expect(shows(MWF, lateTue)).toBe(false);
    expect(shows(MWF, addDaysLocal(lateTue, 1))).toBe(true);
  });
});
