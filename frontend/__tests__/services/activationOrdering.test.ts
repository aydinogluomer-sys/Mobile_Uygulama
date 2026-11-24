/**
 * F14 activation ordering, compensating refund on status-write failure,
 * pauseHabit refund reporting, and habitStore single-flight lock.
 * (REP-09, STO-15)
 */
import type { Habit } from '../../lib/supabase';
import type { WillpowerStateRow } from '../../repositories/willpowerRepository';

const callOrder: string[] = [];
const mockSpendWillpower = jest.fn();
const mockUpdateHabit = jest.fn();

jest.mock('../../lib/supabase', () => ({ supabase: {} }));

jest.mock('../../repositories/willpowerRepository', () => ({
  ...jest.requireActual('../../repositories/willpowerRepository'),
  spendWillpower: (...args: unknown[]) => {
    callOrder.push(`rpc:${(args[0] as { amount: number }).amount}`);
    return mockSpendWillpower(...args);
  },
  fetchOrCreateWillpowerState: jest.fn(async (date: string) => ({
    ok: true,
    data: {
      user_id: 'u1',
      state_date: date,
      daily_budget: 15,
      used: 3,
      focus_capacity: 3,
      active_count: 1,
    },
  })),
}));

jest.mock('../../repositories/habitRepository', () => ({
  ...jest.requireActual('../../repositories/habitRepository'),
  updateHabit: (...args: unknown[]) => {
    callOrder.push(`habitUpdate:${String((args[1] as { status?: string })?.status)}`);
    return mockUpdateHabit(...args);
  },
}));

jest.mock('../../lib/notifications', () => ({
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
}));

import { activateHabit, pauseHabit } from '../../services/habitService';
import { useHabitStore } from '../../store/habitStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import { todayLocal } from '../../lib/date';

function makeHabit(id = 'h1', status: Habit['status'] = 'waiting'): Habit {
  return {
    id,
    user_id: 'u1',
    name: 'Okuma',
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    willpower_cost: 3,
    status,
    impact_level: 'medium',
    urgency: 'not_urgent',
    difficulty: 2,
    estimated_minutes: 15,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: '2026-01-01T00:00:00.000Z',
  };
}

function wpRow(over: Partial<WillpowerStateRow> = {}): WillpowerStateRow {
  return {
    user_id: 'u1',
    state_date: todayLocal(),
    daily_budget: 15,
    used: 0,
    focus_capacity: 3,
    active_count: 0,
    ...over,
  };
}

beforeEach(() => {
  callOrder.length = 0;
  jest.clearAllMocks();
  useHabitStore.setState({ habits: [makeHabit('h1', 'waiting')], loading: false } as never);
  useWillpowerStore.setState({ state: wpRow() as never, loading: false });
});

describe('activateHabit & pauseHabit ordering + single-flight lock (F14)', () => {
  it('charges spend_willpower FIRST, then writes status: active (single RPC call on success)', async () => {
    mockSpendWillpower.mockResolvedValueOnce({ ok: true, data: wpRow({ used: 3, active_count: 1 }) });
    mockUpdateHabit.mockResolvedValueOnce({ ok: true, data: makeHabit('h1', 'active') });

    const res = await activateHabit({
      habit: makeHabit('h1', 'waiting'),
      cost: 3,
      willpower: { state: wpRow(), stale: false },
      activeHabits: [],
      useCapacityRule: true,
    });

    expect(res).toEqual({ ok: true, habit: expect.objectContaining({ id: 'h1', status: 'active' }) });
    expect(callOrder).toEqual(['rpc:3', 'habitUpdate:active']);
    expect(mockSpendWillpower).toHaveBeenCalledTimes(1);
  });

  it('issues compensating refund and returns write_failed (never no_state) when habit status write fails', async () => {
    const afterSpend = wpRow({ used: 3, active_count: 1 });
    mockSpendWillpower
      .mockResolvedValueOnce({ ok: true, data: afterSpend })
      .mockResolvedValueOnce({ ok: true, data: wpRow({ used: 0, active_count: 0 }) });
    mockUpdateHabit.mockResolvedValueOnce({ ok: false, error: 'connection lost' });

    const res = await activateHabit({
      habit: makeHabit('h1', 'waiting'),
      cost: 3,
      willpower: { state: wpRow(), stale: false },
      activeHabits: [],
      useCapacityRule: true,
    });

    expect(res).toEqual({ ok: false, verdict: { allowed: false, reason: 'write_failed' } });
    expect(callOrder).toEqual(['rpc:3', 'habitUpdate:active', 'rpc:-3']);

    // Store surfaces the calm-tech write_failed copy
    mockSpendWillpower
      .mockResolvedValueOnce({ ok: true, data: afterSpend })
      .mockResolvedValueOnce({ ok: true, data: wpRow({ used: 0, active_count: 0 }) });
    mockUpdateHabit.mockResolvedValueOnce({ ok: false, error: 'connection lost' });
    const storeRes = await useHabitStore.getState().activateHabit('h1', 3);
    expect(storeRes).toEqual({
      ok: false,
      reason: 'write_failed',
      error: 'Kaydedilemedi; bütçen değişmedi. Bağlantını kontrol edip tekrar dene.',
    });
  });

  it('never touches habits table when atomic spend refuses with budget_exceeded or write_failed', async () => {
    mockSpendWillpower.mockResolvedValueOnce({
      ok: false,
      kind: 'budget_exceeded',
      error: 'willpower_budget_exceeded',
    });

    const over = await activateHabit({
      habit: makeHabit('h1', 'waiting'),
      cost: 3,
      willpower: { state: wpRow({ used: 10 }), stale: false },
      activeHabits: [],
      useCapacityRule: true,
    });
    expect(over).toEqual({ ok: false, verdict: { allowed: false, reason: 'over_budget' } });
    expect(mockUpdateHabit).not.toHaveBeenCalled();

    mockSpendWillpower.mockResolvedValueOnce({
      ok: false,
      kind: 'unknown',
      error: 'offline',
      offline: true,
    });
    const failed = await activateHabit({
      habit: makeHabit('h1', 'waiting'),
      cost: 3,
      willpower: { state: wpRow(), stale: false },
      activeHabits: [],
      useCapacityRule: true,
    });
    expect(failed).toEqual({ ok: false, verdict: { allowed: false, reason: 'write_failed' } });
    expect(mockUpdateHabit).not.toHaveBeenCalled();
  });

  it('pauseHabit transitions habit to waiting and reports refunded: false when refund fails', async () => {
    mockUpdateHabit.mockResolvedValueOnce({ ok: true, data: makeHabit('h1', 'waiting') });
    mockSpendWillpower.mockResolvedValueOnce({ ok: false, kind: 'unknown', error: 'offline', offline: true });

    const res = await pauseHabit({
      habitId: 'h1',
      cost: 3,
      willpower: { state: wpRow({ used: 6, active_count: 2 }) },
    });

    expect(res).toEqual({
      ok: true,
      habit: expect.objectContaining({ id: 'h1', status: 'waiting' }),
      refunded: false,
    });
    expect(callOrder).toEqual(['habitUpdate:waiting', 'rpc:-3']);
  });

  it('single-flight lock in habitStore blocks duplicate concurrent tap from double-spending', async () => {
    let resolveSpend!: (v: unknown) => void;
    mockSpendWillpower.mockImplementationOnce(
      () => new Promise((r) => { resolveSpend = r; }),
    );
    mockUpdateHabit.mockResolvedValueOnce({ ok: true, data: makeHabit('h1', 'active') });

    const p1 = useHabitStore.getState().activateHabit('h1', 3);
    const p2 = useHabitStore.getState().activateHabit('h1', 3);

    const dup = await p2;
    expect(dup.ok).toBe(false);
    expect(mockSpendWillpower).toHaveBeenCalledTimes(1);

    resolveSpend({ ok: true, data: wpRow({ used: 3, active_count: 1 }) });
    const first = await p1;
    expect(first).toEqual({ ok: true });
    expect(mockSpendWillpower).toHaveBeenCalledTimes(1);
  });
});
