/**
 * F14 `installProposal` charges active routine habits' willpower cost with
 * `{ activations, clamp: true }` and never discards a confirmed plan if the
 * budget write fails.
 * (INT-05, REP-09)
 */
import type { Habit } from '../../lib/supabase';
import type { WillpowerStateRow } from '../../repositories/willpowerRepository';

const mockInsertRoutineHabits = jest.fn();
const mockLoadToday = jest.fn();
const mockSpend = jest.fn();

jest.mock('../../lib/supabase', () => ({ supabase: {} }));

jest.mock('../../repositories/habitRepository', () => ({
  ...jest.requireActual('../../repositories/habitRepository'),
  insertRoutineHabits: (...args: unknown[]) => mockInsertRoutineHabits(...args),
}));

jest.mock('../../services/capacityService', () => ({
  ...jest.requireActual('../../services/capacityService'),
  loadToday: (...args: unknown[]) => mockLoadToday(...args),
  spend: (...args: unknown[]) => mockSpend(...args),
}));

import { installProposal, type ProposalHabit } from '../../services/routineService';

function proposalHabit(name: string, difficulty = 3, minutes = 20): ProposalHabit {
  return {
    name,
    icon: '✨',
    tracking_type: 'binary',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    difficulty,
    estimated_minutes: minutes,
  };
}

function insertedFromRows(rows: Record<string, unknown>[]): Habit[] {
  return rows.map((r, i) => ({
    id: `ins-${i + 1}`,
    user_id: 'u1',
    created_at: '2026-10-10T09:00:00.000Z',
    ...r,
  })) as unknown as Habit[];
}

function wpRow(over: Partial<WillpowerStateRow> = {}): WillpowerStateRow {
  return {
    user_id: 'u1',
    state_date: '2026-10-10',
    daily_budget: 15,
    used: 10,
    focus_capacity: 3,
    active_count: 1,
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockInsertRoutineHabits.mockImplementation(async (rows: Record<string, unknown>[]) => ({
    ok: true,
    data: insertedFromRows(rows),
  }));
});

describe('installProposal records active willpower spend with clamp: true (INT-05)', () => {
  it('charges the sum of active habits willpower_cost once with activations=3 and clamp=true, even over remaining budget', async () => {
    const proposal = [
      proposalHabit('Su', 4, 30),
      proposalHabit('Yürüyüş', 4, 30),
      proposalHabit('Okuma', 4, 30),
      proposalHabit('Günlük', 2, 10),
      proposalHabit('Esneme', 2, 10),
    ];
    const state = wpRow({ used: 10, daily_budget: 15 });
    mockLoadToday.mockResolvedValueOnce({ ok: true, data: state });
    mockSpend.mockResolvedValueOnce({
      ok: true,
      data: wpRow({ used: 15, daily_budget: 15, active_count: 4 }),
    });

    const res = await installProposal(proposal, ['Su', 'Yürüyüş', 'Okuma']);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const activeRows = res.habits.filter((h) => h.status === 'active');
    const waitingRows = res.habits.filter((h) => h.status === 'waiting');
    expect(activeRows).toHaveLength(3);
    expect(waitingRows).toHaveLength(2);
    const expectedTotal = activeRows.reduce((sum, h) => sum + (h.willpower_cost ?? 0), 0);

    expect(mockSpend).toHaveBeenCalledTimes(1);
    expect(mockSpend).toHaveBeenCalledWith(state, expectedTotal, {
      activations: 3,
      clamp: true,
    });
    expect(res.budgetRecorded).toBe(true);
  });

  it('negative: keeps ok: true with budgetRecorded: false when budget write or loadToday fails', async () => {
    mockLoadToday.mockResolvedValueOnce({ ok: false, error: 'offline' });

    const res1 = await installProposal([proposalHabit('Su')], ['Su']);
    expect(res1).toMatchObject({ ok: true, budgetRecorded: false });
    expect(mockSpend).not.toHaveBeenCalled();

    const state = wpRow();
    mockLoadToday.mockResolvedValueOnce({ ok: true, data: state });
    mockSpend.mockResolvedValueOnce({ ok: false, reason: 'write_failed', error: 'offline' });

    const res2 = await installProposal([proposalHabit('Su')], ['Su']);
    expect(res2).toMatchObject({ ok: true, budgetRecorded: false });
  });

  it('negative: skips spend RPC completely when zero habits are installed as active', async () => {
    const res = await installProposal([proposalHabit('Su'), proposalHabit('Okuma')], []);
    expect(res).toMatchObject({ ok: true, budgetRecorded: true });
    expect(mockLoadToday).not.toHaveBeenCalled();
    expect(mockSpend).not.toHaveBeenCalled();
  });
});
