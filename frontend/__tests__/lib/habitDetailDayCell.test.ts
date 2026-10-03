/**
 * R01.02-c A3 — habit-detail's calendar cell on the day lane.
 *
 * `dayCellFor` used to ask `isDueOn`, which ignores interval_days: an "every 3
 * days" habit had its two off days in every three painted `miss`. It now asks
 * `isEligibleOn`. `dayCellFor` is exported for this test only (pure function,
 * no store or render).
 */
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from: () => { throw new Error('dayCellFor must not touch supabase'); },
  },
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

import type { Habit } from '../../lib/supabase';
import type { HabitDetailLogRow } from '../../services/habitService';
import { addDaysLocal, ymd } from '../../lib/date';
import { dayCellFor } from '../../app/screens/habit-detail';

function habit(over: Partial<Habit>): Habit {
  return {
    id: 'h1', user_id: 'u1', name: 't', behavior_type: 'positive', status: 'active',
    tracking_type: 'boolean', daily_goal: null, target_direction: null,
    frequency_config: { kind: 'daily' }, created_at: '2026-07-01T09:00:00', end_condition: null,
    ...over,
  } as Habit;
}

const MON = new Date(2026, 7, 3);
const WEEK = Array.from({ length: 7 }, (_, i) => addDaysLocal(MON, i));
const TODAY = '2026-08-31';
const states = (h: Habit, logs: Map<string, HabitDetailLogRow> = new Map()) =>
  WEEK.map((d) => dayCellFor(h, logs, d, TODAY).state);

describe('R01.02-c A3 — calendar cells for every_n_days / date_range', () => {
  const every3 = habit({ created_at: '2026-08-03T09:00:00', frequency_config: { kind: 'daily', interval_days: 3 } });

  it('every 3 days, nothing logged: due days are miss, the days between are not_scheduled', () => {
    expect(states(every3)).toEqual(['miss', 'not_scheduled', 'not_scheduled', 'miss', 'not_scheduled', 'not_scheduled', 'miss']);
  });

  it('NEGATIVE — no off day is painted miss (red if every day is due)', () => {
    const offDays = states(every3).filter((_, i) => ![0, 3, 6].includes(i));
    expect(offDays.every((s) => s === 'not_scheduled')).toBe(true);
  });

  it('a completed due day is full', () => {
    const logs = new Map([[ymd(MON), { state: 'done', value: null } as unknown as HabitDetailLogRow]]);
    expect(dayCellFor(every3, logs, MON, TODAY).state).toBe('full');
  });

  it('date range Wed..Fri: outside days not_scheduled', () => {
    const ranged = habit({ frequency_config: { kind: 'daily', range_start: '2026-08-05', range_end: '2026-08-07' } });
    expect(states(ranged)).toEqual(['not_scheduled', 'not_scheduled', 'miss', 'miss', 'miss', 'not_scheduled', 'not_scheduled']);
  });

  it('A7 — daily and Mon/Wed/Fri cells are what isDueOn would give', () => {
    expect(states(habit({}))).toEqual(Array(7).fill('miss'));
    expect(states(habit({ frequency_config: { kind: 'weekly', days: [0, 2, 4] } })))
      .toEqual(['miss', 'not_scheduled', 'miss', 'not_scheduled', 'miss', 'not_scheduled', 'not_scheduled']);
  });

  it('A8 — count-based: an unlogged day is not_scheduled, a logged one keeps its state', () => {
    const w3 = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    expect(states(w3)).toEqual(Array(7).fill('not_scheduled'));
    const logs = new Map([[ymd(WEEK[1]), { state: 'done', value: null } as unknown as HabitDetailLogRow]]);
    expect(dayCellFor(w3, logs, WEEK[1], TODAY).state).toBe('full');
  });
});
