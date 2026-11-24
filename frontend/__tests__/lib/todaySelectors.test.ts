import { readFileSync } from 'fs';
import { join } from 'path';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from: () => {
      throw new Error('todaySelectors must remain pure and never touch supabase');
    },
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import type { Habit } from '../../lib/supabase';
import * as selectors from '../../lib/todaySelectors';
import * as todayTab from '../../app/tabs/today';

function makeHabit(id: string, over: Partial<Habit> = {}): Habit {
  return {
    id,
    user_id: 'u1',
    name: `Habit ${id}`,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    status: 'active',
    frequency_config: { kind: 'daily' },
    created_at: '2026-01-01T00:00:00Z',
    end_condition: null,
    target_direction: null,
    ...over,
  } as Habit;
}

describe('F27 (PRF-14, PS-16) — lib/todaySelectors', () => {
  describe('currentPartOfDay boundaries', () => {
    it.each([
      [0, 'evening'],
      [4, 'evening'],
      [5, 'morning'],
      [11, 'morning'],
      [12, 'afternoon'],
      [17, 'afternoon'],
      [18, 'evening'],
      [23, 'evening'],
    ] as const)('hour %i -> %s', (hour, expected) => {
      expect(selectors.currentPartOfDay(hour)).toBe(expected);
    });
  });

  describe('partGroupOf (fail-open to anytime)', () => {
    it('returns the exact slot when part_of_day has a single valid entry', () => {
      expect(selectors.partGroupOf(makeHabit('m', { frequency_config: { kind: 'daily', part_of_day: ['morning'] } }))).toBe('morning');
      expect(selectors.partGroupOf(makeHabit('a', { frequency_config: { kind: 'daily', part_of_day: ['afternoon'] } }))).toBe('afternoon');
      expect(selectors.partGroupOf(makeHabit('e', { frequency_config: { kind: 'daily', part_of_day: ['evening'] } }))).toBe('evening');
    });

    it('falls back to anytime when absent, empty, multi-slot, corrupt, or null frequency_config', () => {
      expect(selectors.partGroupOf(makeHabit('none', { frequency_config: { kind: 'daily' } }))).toBe('anytime');
      expect(selectors.partGroupOf(makeHabit('empty', { frequency_config: { kind: 'daily', part_of_day: [] } }))).toBe('anytime');
      expect(
        selectors.partGroupOf(makeHabit('multi', { frequency_config: { kind: 'daily', part_of_day: ['morning', 'evening'] } })),
      ).toBe('anytime');
      expect(
        selectors.partGroupOf(makeHabit('corruptStr', { frequency_config: { kind: 'daily', part_of_day: ['midnight' as never] } })),
      ).toBe('anytime');
      expect(
        selectors.partGroupOf(makeHabit('corruptNum', { frequency_config: { kind: 'daily', part_of_day: [42 as never] } })),
      ).toBe('anytime');
      expect(selectors.partGroupOf({ frequency_config: null as never })).toBe('anytime');
    });
  });

  describe('groupHabitsByPartOfDay', () => {
    const hMorning = makeHabit('m1', { name: 'Sabah Su', frequency_config: { kind: 'daily', part_of_day: ['morning'] } });
    const hAfternoon = makeHabit('a1', { name: 'Öğle Yürüyüşü', frequency_config: { kind: 'daily', part_of_day: ['afternoon'] } });
    const hEvening = makeHabit('e1', { name: 'Akşam Kitap', frequency_config: { kind: 'daily', part_of_day: ['evening'] } });
    const hAnytime = makeHabit('x1', { name: 'Her An Nefes', frequency_config: { kind: 'daily' } });

    it('skips empty groups, opens current slot + anytime, collapses others, and counts completions', () => {
      const groups = selectors.groupHabitsByPartOfDay({
        habits: [hEvening, hMorning, hAnytime],
        isDone: (id) => id === 'm1' || id === 'x1',
        hour: 20, // evening
        expanded: new Set(),
      });

      expect(groups.map((g) => g.key)).toEqual(['morning', 'evening', 'anytime']);
      expect(groups.find((g) => g.key === 'morning')).toMatchObject({
        label: 'Sabah',
        open: false,
        doneCount: 1,
      });
      expect(groups.find((g) => g.key === 'evening')).toMatchObject({
        label: 'Akşam',
        open: true,
        doneCount: 0,
      });
      // Contract rule 6: anytime habits are NEVER hidden
      expect(groups.find((g) => g.key === 'anytime')).toMatchObject({
        label: 'Her an',
        open: true,
        doneCount: 1,
      });
    });

    it('opens a single remaining group regardless of hour so flat lists never collapse', () => {
      const groups = selectors.groupHabitsByPartOfDay({
        habits: [hMorning],
        isDone: () => false,
        hour: 21, // evening, yet morning is the ONLY group
        expanded: new Set(),
      });
      expect(groups).toHaveLength(1);
      expect(groups[0].open).toBe(true);
    });

    it('opens a collapsed group when present in expanded set', () => {
      const groups = selectors.groupHabitsByPartOfDay({
        habits: [hMorning, hAfternoon, hEvening],
        isDone: () => false,
        hour: 9,
        expanded: new Set(['evening']),
      });
      expect(groups.map((g) => [g.key, g.open])).toEqual([
        ['morning', true],
        ['afternoon', false],
        ['evening', true],
      ]);
    });
  });

  describe('orderForNextStep', () => {
    it('places current part of day first, then anytime, then remaining slots in clock order (stable)', () => {
      const m1 = makeHabit('m1', { frequency_config: { kind: 'daily', part_of_day: ['morning'] } });
      const a1 = makeHabit('a1', { frequency_config: { kind: 'daily', part_of_day: ['afternoon'] } });
      const e1 = makeHabit('e1', { frequency_config: { kind: 'daily', part_of_day: ['evening'] } });
      const e2 = makeHabit('e2', { frequency_config: { kind: 'daily', part_of_day: ['evening'] } });
      const x1 = makeHabit('x1', { frequency_config: { kind: 'daily' } });

      const input = Object.freeze([m1, x1, e1, a1, e2]);
      const orderedAtEvening = selectors.orderForNextStep(input, 20);
      expect(orderedAtEvening.map((h) => h.id)).toEqual(['e1', 'e2', 'x1', 'm1', 'a1']);

      const orderedAtAfternoon = selectors.orderForNextStep(input, 14);
      expect(orderedAtAfternoon.map((h) => h.id)).toEqual(['a1', 'x1', 'm1', 'e1', 'e2']);
    });
  });

  describe('isoWeek & re-export identity & purity guards', () => {
    it('computes ISO-8601 week numbers accurately', () => {
      expect(selectors.isoWeek(new Date(2026, 0, 1))).toBe(1);
      expect(selectors.isoWeek(new Date(2026, 5, 15))).toBe(25);
    });

    it('re-exports all 11 canonical selector functions identically from app/tabs/today', () => {
      expect(todayTab.isScheduleAmbiguous).toBe(selectors.isScheduleAmbiguous);
      expect(todayTab.isPeriodDoneBefore).toBe(selectors.isPeriodDoneBefore);
      expect(todayTab.selectTodayHabits).toBe(selectors.selectTodayHabits);
      expect(todayTab.selectOnBreakHabits).toBe(selectors.selectOnBreakHabits);
      expect(todayTab.setAsideIds).toBe(selectors.setAsideIds);
      expect(todayTab.selectSetAsideHabits).toBe(selectors.selectSetAsideHabits);
      expect(todayTab.periodDoneLabel).toBe(selectors.periodDoneLabel);
      expect(todayTab.selectPeriodDoneHabits).toBe(selectors.selectPeriodDoneHabits);
      expect(todayTab.periodWindowStart).toBe(selectors.periodWindowStart);
      expect(todayTab.summarizeTodayHabits).toBe(selectors.summarizeTodayHabits);
      expect(todayTab.todayHabitCopy).toBe(selectors.todayHabitCopy);
    });

    it('(-) never reads preferred_time_of_day or imports React/RN/stores', () => {
      const raw = readFileSync(join(__dirname, '..', '..', 'lib', 'todaySelectors.ts'), 'utf8');
      expect(raw).not.toContain('preferred_time_of_day');
      expect(raw).not.toMatch(/from\s+['"](?:react|react-native|\.\.\/store\/)/);
    });
  });
});
