/**
 * R03.02 — "Bugün daha az yapabilirim": the user sets chosen habits aside for
 * TODAY, by explicit choice, and nothing else changes.
 *
 * Built on the existing `skip` state. These tests pin both halves: the Today
 * selectors move a skipped habit out of today's work into its own group, and
 * the promises the sheet makes in words -- the rate does not drop, the streak
 * does not break but does not grow, no XP -- are what the engine actually does.
 */
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from: () => { throw new Error('selectors must not touch supabase'); },
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import type { Habit } from '../../lib/supabase';
import {
  selectTodayHabits, selectSetAsideHabits, selectPeriodDoneHabits, setAsideIds, summarizeTodayHabits,
} from '../../app/tabs/today';
import type { ReviewLogRow } from '../../services/reviewService';
import { xpFor } from '../../services/habitLogService';
import { currentStreak, habitCompletionRate } from '../../lib/behaviorIntelligence';

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1', user_id: 'u1', name: 'test', behavior_type: 'positive', status: 'active',
    frequency_config: { kind: 'daily' }, created_at: '2026-01-01T00:00:00Z',
    end_condition: null, target_direction: null, ...over,
  } as Habit;
}
const log = (habitId: string, ymd: string, state: ReviewLogRow['state']): ReviewLogRow =>
  ({ habit_id: habitId, completed_at: ymd, state, value: null }) as ReviewLogRow;

const THU = new Date(2026, 7, 6);   // Thursday 6 Aug 2026
const A = habit({ id: 'a', name: 'Kitap' });
const B = habit({ id: 'b', name: 'Yürüyüş' });
const W3 = habit({ id: 'w3', frequency_config: { kind: 'weekly', count: 3 } });

describe('R03.02 — which habits are set aside', () => {
  it('exactly the ones whose TODAY log is skip', () => {
    const state: Record<string, string> = { a: 'skip', b: 'done', w3: 'miss' };
    expect([...setAsideIds([A, B, W3], (id) => state[id])]).toEqual(['a']);
    expect([...setAsideIds([A, B], () => undefined)]).toEqual([]);
    expect([...setAsideIds([A], () => 'partial')]).toEqual([]);
  });
});

describe('R03.02 — today\'s work vs the light-day group', () => {
  it('a set-aside habit leaves today\'s list and appears in its own group', () => {
    const aside = new Set(['a']);
    expect(selectTodayHabits([A, B], THU, null, aside).map((h) => h.id)).toEqual(['b']);
    expect(selectSetAsideHabits([A, B], THU, null, aside).map((h) => h.id)).toEqual(['a']);
  });

  it('without a light-day set the list is unchanged (every earlier caller)', () => {
    expect(selectTodayHabits([A, B], THU).map((h) => h.id)).toEqual(['a', 'b']);
    expect(selectTodayHabits([A, B], THU, null).map((h) => h.id)).toEqual(['a', 'b']);
  });

  it('the denominator drops it: "2 adım" becomes "1 adım"', () => {
    const aside = new Set(['a']);
    expect(summarizeTodayHabits(selectTodayHabits([A, B], THU, null, aside), [])).toMatchObject({ total: 1, remaining: 1 });
  });

  it('a habit whose period is already met stays in the period-done group, not the light-day one', () => {
    const met = [log('w3', '2026-08-03', 'done'), log('w3', '2026-08-04', 'done'), log('w3', '2026-08-05', 'done')];
    const aside = new Set(['w3']);
    expect(selectSetAsideHabits([W3], THU, met, aside)).toEqual([]);
    expect(selectPeriodDoneHabits([W3], THU, met).map((h) => h.id)).toEqual(['w3']);
  });

  it('the three groups are a partition of today\'s eligible habits', () => {
    const met = [log('w3', '2026-08-03', 'done'), log('w3', '2026-08-04', 'done'), log('w3', '2026-08-05', 'done')];
    const aside = new Set(['a']);
    const work = selectTodayHabits([A, B, W3], THU, met, aside).map((h) => h.id);
    const light = selectSetAsideHabits([A, B, W3], THU, met, aside).map((h) => h.id);
    const done = selectPeriodDoneHabits([A, B, W3], THU, met).map((h) => h.id);
    expect([...work, ...light, ...done].sort()).toEqual(['a', 'b', 'w3']);
    expect(new Set([...work, ...light, ...done]).size).toBe(3);
  });
});

describe('R03.02 — what the sheet promises is what the engine does', () => {
  // "tamamlama oranın düşmez, serin bozulmaz — ama bugün uzamaz da", and no XP.
  const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-08-${String(from + i).padStart(2, '0')}`);

  it('no XP for a set-aside day', () => {
    expect(xpFor({ state: 'skip' })).toBe(0);
  });

  it('the completion rate does not drop: a skipped day is out of both sides', () => {
    const done4 = days(1, 4).map((d) => log('a', d, 'done'));
    const withSkip = [...done4, log('a', '2026-08-05', 'skip')];
    const r1 = habitCompletionRate(A, done4, { start: '2026-08-01', end: '2026-08-04' });
    const r2 = habitCompletionRate(A, withSkip, { start: '2026-08-01', end: '2026-08-05' });
    expect(r1.ok && r2.ok).toBe(true);
    expect(r2.ok && r2.value).toBe(1);
    expect(r1.ok && r1.value).toBe(1);
  });

  it('the streak does not break -- and does not grow', () => {
    const done4 = days(1, 4).map((d) => log('a', d, 'done'));
    const asOf = new Date(2026, 7, 5);
    const before = currentStreak(A, done4, new Date(2026, 7, 4));
    const withSkipToday = currentStreak(A, [...done4, log('a', '2026-08-05', 'skip')], asOf);
    expect(withSkipToday).toBe(before);      // not broken, not extended
    const unlogged = currentStreak(A, done4, new Date(2026, 7, 6));  // a missed due day breaks it
    expect(unlogged).toBe(0);
  });
});
