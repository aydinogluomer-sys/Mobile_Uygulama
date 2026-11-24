/**
 * F15 (DOM-12): `habitCreatedDay` resolver, `stampCreatedDay` repository helper,
 * and `isEligibleOn` stability for stamped `every_n_days` habits.
 */
const mockInsertSingle = jest.fn();
const mockInsertBulk = jest.fn();

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { user: { id: 'u1' }, access_token: 'tok' } },
        error: null,
      })),
    },
    from: jest.fn((table: string) => {
      if (table !== 'habits') throw new Error(`Unexpected table: ${table}`);
      return {
        insert: (payload: unknown) => {
          if (Array.isArray(payload)) {
            mockInsertBulk(payload);
            return {
              select: async () => ({ data: payload, error: null }),
            };
          }
          mockInsertSingle(payload);
          return {
            select: () => ({
              single: async () => ({ data: payload, error: null }),
            }),
          };
        },
      };
    }),
  },
}));

import { parseLocalDate, todayLocal, ymdFromIso } from '../../lib/date';
import {
  CREATED_DAY_KEY,
  habitCreatedDay,
  readCreatedDayStamp,
  stampCreatedDay,
} from '../../lib/habitCreatedDay';
import { isEligibleOn } from '../../lib/habitSchedule';
import type { FrequencyConfig, Habit } from '../../lib/supabase';
import { insertHabit, insertRoutineHabits } from '../../repositories/habitRepository';

beforeEach(() => {
  mockInsertSingle.mockReset();
  mockInsertBulk.mockReset();
});

describe('habitCreatedDay & stampCreatedDay (lib/habitCreatedDay.ts)', () => {
  it('(+) prefers valid created_day stamp over created_at UTC instant across both positive and negative offsets', () => {
    expect(CREATED_DAY_KEY).toBe('created_day');
    expect(readCreatedDayStamp({ created_day: '2026-08-01' })).toBe('2026-08-01');
    const fcStamped: FrequencyConfig = { kind: 'daily', interval_days: 3, created_day: '2026-08-01' };
    // Created 02:00 Istanbul (2026-07-31 in UTC / New_York) AND created 23:00 New_York (2026-08-02 in UTC / Istanbul / Auckland):
    expect(
      habitCreatedDay({
        created_at: '2026-07-31T23:00:00.000Z',
        frequency_config: fcStamped,
      }),
    ).toBe('2026-08-01');
    expect(
      habitCreatedDay({
        created_at: '2026-08-02T03:00:00.000Z',
        frequency_config: fcStamped,
      }),
    ).toBe('2026-08-01');
  });

  it('(+) falls back to ymdFromIso(created_at) when unstamped, and null when both absent', () => {
    const iso = '2026-08-04T09:00:00.000Z';
    const fcPlain: FrequencyConfig = { kind: 'daily' };
    expect(habitCreatedDay({ created_at: iso, frequency_config: fcPlain })).toBe(
      ymdFromIso(iso),
    );
    expect(habitCreatedDay({ created_at: null, frequency_config: null })).toBeNull();
    expect(habitCreatedDay({})).toBeNull();
  });

  it('(+) stampCreatedDay returns a new object without mutating input and overwrites injected created_day', () => {
    const original = { kind: 'daily' as const, interval_days: 3, created_day: '1999-01-01' };
    const stamped = stampCreatedDay(original, '2026-08-01');
    expect(stamped).toEqual({ kind: 'daily', interval_days: 3, created_day: '2026-08-01' });
    expect(original.created_day).toBe('1999-01-01');
  });

  it('(-) ignores malformed or non-existent created_day stamps and falls back to created_at', () => {
    // 09:00Z falls on 2026-08-10 across UTC-4 (05:00), UTC (09:00), UTC+3 (12:00), and UTC+12 (21:00).
    const fallbackIso = '2026-08-10T09:00:00.000Z';
    for (const bad of ['2026-13-01', '2026-02-30', 'not-a-date', '', 20260801, {}, null, undefined]) {
      expect(readCreatedDayStamp({ created_day: bad })).toBeNull();
      expect(
        habitCreatedDay({
          created_at: fallbackIso,
          frequency_config: { created_day: bad },
        }),
      ).toBe('2026-08-10');
    }
    expect(
      habitCreatedDay({
        created_at: fallbackIso,
        frequency_config: null,
      }),
    ).toBe('2026-08-10');
  });

  it('(+) keeps every_n_days eligibility anchored to created_day even when created_at is previous UTC day', () => {
    const habit: Habit = {
      id: 'h-dom12',
      user_id: 'u1',
      name: 'Koşu',
      icon: null,
      color: null,
      behavior_type: 'positive',
      tracking_type: 'boolean',
      unit: null,
      daily_goal: null,
      target_direction: null,
      frequency_config: { kind: 'daily', interval_days: 3, created_day: '2026-08-01' },
      willpower_cost: 3,
      status: 'active',
      impact_level: 'medium',
      urgency: 'not_urgent',
      difficulty: 3,
      estimated_minutes: 20,
      reminders: null,
      cue_habit_id: null,
      cue_note: null,
      life_area: null,
      end_condition: null,
      created_at: '2026-07-31T23:00:00.000Z',
    };

    expect(isEligibleOn(habit, parseLocalDate('2026-07-31')!)).toBe(false);
    expect(isEligibleOn(habit, parseLocalDate('2026-08-01')!)).toBe(true);
    expect(isEligibleOn(habit, parseLocalDate('2026-08-03')!)).toBe(false);
    expect(isEligibleOn(habit, parseLocalDate('2026-08-04')!)).toBe(true);
    expect(isEligibleOn(habit, parseLocalDate('2026-08-07')!)).toBe(true);
  });

  it('(+) habitRepository stamps todayLocal() on insertHabit and insertRoutineHabits, overwriting any injected stamp', async () => {
    const expectedToday = todayLocal();

    await insertHabit({
      name: 'Su',
      icon: null,
      color: null,
      behavior_type: 'positive',
      tracking_type: 'boolean',
      unit: null,
      daily_goal: null,
      target_direction: null,
      frequency_config: { kind: 'daily', created_day: '2000-01-01' },
      willpower_cost: 2,
      status: 'active',
      impact_level: 'medium',
      urgency: 'not_urgent',
      difficulty: 1,
      estimated_minutes: 5,
      reminders: null,
      cue_habit_id: null,
      cue_note: null,
      life_area: null,
      end_condition: null,
    });
    expect(mockInsertSingle).toHaveBeenCalledTimes(1);
    expect(mockInsertSingle.mock.calls[0][0].frequency_config.created_day).toBe(expectedToday);

    await insertRoutineHabits([
      {
        name: 'Kitap',
        icon: null,
        tracking_type: 'boolean',
        unit: null,
        daily_goal: null,
        target_direction: null,
        frequency_config: { kind: 'daily', interval_days: 2, created_day: '1999-12-31' },
        willpower_cost: 3,
        difficulty: 3,
        estimated_minutes: 15,
        status: 'active',
      },
    ]);
    expect(mockInsertBulk).toHaveBeenCalledTimes(1);
    expect(mockInsertBulk.mock.calls[0][0][0].frequency_config.created_day).toBe(expectedToday);
  });
});
