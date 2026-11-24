/**
 * W1 wiring (task Phase-1 CODER-F, store/habitStore.ts:113): `activateHabit`
 * must pass the currently-active habits' load into `willpowerStore.canActivate`
 * so the capacity-ceiling rule (Plan §10) actually gates activation, instead
 * of only the legacy fixed `active_count < focus_capacity` slot rule.
 *
 * Fixture: 4 already-active HEAVY habits (18 points each, per
 * `lib/capacity.ts`'s `HABIT_POINTS_SCALE` doc -- one maximally-heavy daily
 * habit == 18 of the 100-point budget) plus one more HEAVY habit pending
 * activation. `focus_capacity` is set to 10 -- well above the 4 already
 * active -- so the LEGACY fixed-slot rule alone (`active_count < focus_capacity`,
 * 4 < 10) would PERMIT the 5th activation. The capacity-ceiling rule refuses
 * it instead: 4*18 + 18 = 90 > `CAPACITY_CEILING_DEFAULT` (85).
 *
 * Written BEFORE `store/habitStore.ts:113` was wired and observed to fail
 * (the write happened, the habit flipped to 'active') -- see the task's
 * red-first evidence.
 */
const mockCalls: { table: string; patch: unknown }[] = [];

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      // The data layer resolves the user id from the LOCAL session -- see
      // `repositories/shared.currentUserId`. Derived from this mock's own
      // getUser so the two can never disagree.
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
       getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: (table: string) => ({
      // `habitService.activateHabit` re-reads today's willpower row after the
      // write, so the mock needs a read path as well as a write path.
      select: () => {
        const q: any = {
          eq: () => q,
          maybeSingle: async () => ({
            data: { user_id: 'u1', state_date: '2026-08-30', daily_budget: 15, used: 0, focus_capacity: 3, active_count: 0 },
            error: null,
          }),
          single: async () => ({ data: null, error: { code: 'PGRST116', message: 'no rows' } }),
          limit: () => q,
          order: () => q,
          not: () => q,
          then: (onOk: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(onOk),
        };
        return q;
      },
      upsert: () => ({
        then: (onOk: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(onOk),
        select: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
      // Chainable + thenable: `updateHabit` calls `.update().eq('id', ...)`
      // (one `.eq()`), `willpowerStore.spend`/`refund` fallback call
      // `.update().eq('user_id', ...).eq('state_date', ...)` (two, chained).
      update: (patch: unknown) => {
        const record = () => { mockCalls.push({ table, patch }); };
        const filters: Record<string, unknown> = {};
        const q: any = {
          eq: (col: string, val: unknown) => { filters[col] = val; return q; },
          select: () => ({
            maybeSingle: async () => {
              record();
              if (table === 'willpower_state') {
                return {
                  data: {
                    user_id: (filters.user_id as string) ?? 'u1',
                    state_date: (filters.state_date as string) ?? '2026-08-30',
                    daily_budget: 1000,
                    used: 5,
                    focus_capacity: 10,
                    active_count: 5,
                    ...(patch as Record<string, unknown>),
                  },
                  error: null,
                };
              }
              return {
                data: { id: (filters.id as string) ?? 'h1', ...(patch as Record<string, unknown>) },
                error: null,
              };
            },
          }),
          then: (onOk: (v: unknown) => unknown) => {
            record();
            return Promise.resolve({ data: null, error: null }).then(onOk);
          },
        };
        return q;
      },
    }),
  },
}));

jest.mock('../../lib/notifications', () => ({
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
}));

import { useHabitStore } from '../../store/habitStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import { todayLocal } from '../../lib/date';
import type { Habit } from '../../lib/supabase';

function heavyHabit(id: string, status: Habit['status']): Habit {
  return {
    id, user_id: 'u1', name: `Heavy ${id}`, icon: null, color: null,
    behavior_type: 'positive', tracking_type: 'boolean', unit: null,
    daily_goal: null, target_direction: null,
    frequency_config: { kind: 'daily' }, willpower_cost: 5, status,
    impact_level: null, urgency: null, difficulty: 5, estimated_minutes: 90,
    reminders: null, cue_habit_id: null, cue_note: null, life_area: null,
    end_condition: null, created_at: '2026-01-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  mockCalls.length = 0;
  jest.clearAllMocks();
  useHabitStore.setState({ habits: [], loading: false });
  useWillpowerStore.setState({
    state: {
      user_id: 'u1', state_date: todayLocal(), daily_budget: 1000, used: 0,
      focus_capacity: 10, active_count: 4,
    } as never,
    loading: false,
  });
});

describe('activateHabit (store/habitStore.ts:113) wires activeHabits into canActivate', () => {
  it('refuses a 5th heavy habit that the legacy fixed-slot rule alone would have permitted', async () => {
    const habits = [
      heavyHabit('h1', 'active'), heavyHabit('h2', 'active'),
      heavyHabit('h3', 'active'), heavyHabit('h4', 'active'),
      heavyHabit('h5', 'waiting'),
    ];
    useHabitStore.setState({ habits, loading: false });

    // Sanity: the legacy fixed-slot rule alone WOULD permit this (4 < 10).
    expect(useWillpowerStore.getState().canActivate(5)).toBe(true);

    await useHabitStore.getState().activateHabit('h5', 5);

    expect(mockCalls).toEqual([]); // no supabase write happened -- activation was refused
    expect(useHabitStore.getState().habits.find((h) => h.id === 'h5')?.status).toBe('waiting');
  });

  it('still allows activation for a light habit under the same conditions (sanity)', async () => {
    const lightPending: Habit = { ...heavyHabit('h6', 'waiting'), difficulty: 1, estimated_minutes: 5 };
    useHabitStore.setState({ habits: [lightPending], loading: false });

    await useHabitStore.getState().activateHabit('h6', 5);

    expect(mockCalls.some((c) => c.table === 'habits')).toBe(true);
    expect(useHabitStore.getState().habits.find((h) => h.id === 'h6')?.status).toBe('active');
  });
});
