/**
 * R01.06-b — a count-based habit whose period is already met steps out of
 * today's work, into a dimmed "bu dönem tamam" group.
 *
 * R01.06-a used `isEligibleOn` and only today's log, so "3 a week" finished on
 * Wednesday stayed in "N adım kaldı" until Sunday. Today now loads the current
 * week+month's logs and asks `periodStatus` with logs STRICTLY BEFORE the day:
 * the day's own completion never makes the habit vanish the moment it is
 * ticked. Until those logs load -- or if they fail to -- nothing is hidden.
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

import type { Habit } from '../../lib/supabase';
import {
  selectTodayHabits, selectPeriodDoneHabits, isPeriodDoneBefore, periodWindowStart,
  periodDoneLabel, summarizeTodayHabits,
} from '../../app/tabs/today';
import type { ReviewLogRow } from '../../services/reviewService';

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1', user_id: 'u1', name: 'test', behavior_type: 'positive', status: 'active',
    frequency_config: { kind: 'daily' }, created_at: '2020-01-01T00:00:00Z',
    end_condition: null, target_direction: null, ...over,
  } as Habit;
}
const log = (habitId: string, ymd: string, state: ReviewLogRow['state'] = 'done'): ReviewLogRow =>
  ({ habit_id: habitId, completed_at: ymd, state, value: null }) as ReviewLogRow;

// 2026-08-03 is a Monday.
const D = (n: number) => new Date(2026, 7, n);
const MON = D(3), TUE = D(4), WED = D(5), THU = D(6), SUN = D(9);
const WEEK = [D(3), D(4), D(5), D(6), D(7), D(8), D(9)];

const W3 = habit({ id: 'w3', frequency_config: { kind: 'weekly', count: 3 } });
const DAILY = habit({ id: 'daily' });
const MET_BY_WED = [log('w3', '2026-08-03'), log('w3', '2026-08-04'), log('w3', '2026-08-05')];

describe('R01.06-b — isPeriodDoneBefore', () => {
  it('"3 a week" done Mon/Tue/Wed is period-done on Thursday and after', () => {
    expect(isPeriodDoneBefore(W3, THU, MET_BY_WED)).toBe(true);
    expect(isPeriodDoneBefore(W3, SUN, MET_BY_WED)).toBe(true);
  });
  it('the day of the third completion is NOT period-done -- it began owing one', () => {
    expect(isPeriodDoneBefore(W3, WED, MET_BY_WED)).toBe(false);
    expect(isPeriodDoneBefore(W3, MON, MET_BY_WED)).toBe(false);
  });
  it('partial days count, as everywhere else (AC-H07/H08)', () => {
    const partials = MET_BY_WED.map((l) => ({ ...l, state: 'partial' as const }));
    expect(isPeriodDoneBefore(W3, THU, partials)).toBe(true);
  });
  it('miss / skip do not count toward the target', () => {
    const misses = [log('w3', '2026-08-03', 'miss'), log('w3', '2026-08-04', 'skip'), log('w3', '2026-08-05')];
    expect(isPeriodDoneBefore(W3, THU, misses)).toBe(false);
  });
  it('another habit\'s logs never satisfy this one', () => {
    expect(isPeriodDoneBefore(W3, THU, MET_BY_WED.map((l) => ({ ...l, habit_id: 'other' })))).toBe(false);
  });
  it('a day-based habit is never period-done -- it has no period', () => {
    const allWeek = WEEK.map((d) => log('daily', `2026-08-0${d.getDate()}`));
    expect(isPeriodDoneBefore(DAILY, SUN, allWeek)).toBe(false);
  });
  it('a new week starts owing again', () => {
    expect(isPeriodDoneBefore(W3, D(10), MET_BY_WED)).toBe(false);   // Monday 10 Aug
  });
  it('monthly: "10 a month" met by the 15th is done on the 16th', () => {
    const m10 = habit({ id: 'm10', frequency_config: { kind: 'monthly', count: 10 } });
    const logs = Array.from({ length: 10 }, (_, i) => log('m10', `2026-08-${String(i + 1).padStart(2, '0')}`));
    expect(isPeriodDoneBefore(m10, D(16), logs)).toBe(true);
    expect(isPeriodDoneBefore(m10, D(10), logs)).toBe(false);
    expect(periodDoneLabel(m10)).toBe('bu ay tamam');
    expect(periodDoneLabel(W3)).toBe('bu hafta tamam');
  });
});

describe('R01.06-b — today\'s list and the dimmed group', () => {
  it('without period logs the list is exactly R01.06-a\'s (fail-open: nothing hidden for lack of data)', () => {
    for (const d of WEEK) {
      expect(selectTodayHabits([W3, DAILY], d).map((h) => h.id)).toEqual(['w3', 'daily']);
      expect(selectTodayHabits([W3, DAILY], d, null).map((h) => h.id)).toEqual(['w3', 'daily']);
      expect(selectPeriodDoneHabits([W3, DAILY], d, null)).toEqual([]);
    }
  });

  it('with period logs, a met "3 a week" leaves the list from Thursday and appears in the dimmed group', () => {
    const inList = WEEK.map((d) => selectTodayHabits([W3, DAILY], d, MET_BY_WED).some((h) => h.id === 'w3'));
    const inDone = WEEK.map((d) => selectPeriodDoneHabits([W3, DAILY], d, MET_BY_WED).some((h) => h.id === 'w3'));
    expect(inList).toEqual([true, true, true, false, false, false, false]);
    expect(inDone).toEqual([false, false, false, true, true, true, true]);
  });

  it('every eligible habit is in exactly one of the two groups', () => {
    for (const d of WEEK) {
      const a = selectTodayHabits([W3, DAILY], d, MET_BY_WED).map((h) => h.id);
      const b = selectPeriodDoneHabits([W3, DAILY], d, MET_BY_WED).map((h) => h.id);
      expect(a.filter((x) => b.includes(x))).toEqual([]);
      expect([...a, ...b].sort()).toEqual(['daily', 'w3']);
    }
  });

  it('the denominator drops a period-done habit: Thursday is 1 step, not 2', () => {
    const list = selectTodayHabits([W3, DAILY], THU, MET_BY_WED);
    const s = summarizeTodayHabits(list, []);
    expect(s).toMatchObject({ total: 1, remaining: 1 });
  });

  it('the fail-open rule for an ambiguous schedule still holds with logs loaded', () => {
    const bad = habit({ id: 'bad', frequency_config: { kind: 'weekly' } });
    expect(selectTodayHabits([bad], TUE, []).map((h) => h.id)).toEqual(['bad']);
  });
});

describe('R01.06-b — the period window covers a week that started last month', () => {
  it('Thu 1 Oct 2026: the week began Mon 28 Sep', () => {
    expect(periodWindowStart(new Date(2026, 9, 1))).toBe('2026-09-28');
  });
  it('Wed 14 Oct 2026: the month began before the week', () => {
    expect(periodWindowStart(new Date(2026, 9, 14))).toBe('2026-10-01');
  });
});
