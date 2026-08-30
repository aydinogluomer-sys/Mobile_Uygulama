/**
 * The completion step of the Rule 8 regression fix.  (Phase 3, CODER-K)
 *
 * `lib/routineProposal.ts`'s `adaptEdgeRoutineResponse` now ACCEPTS today's
 * real edge-function response (see
 * `__tests__/lib/routineProposalAdapter.test.ts`) instead of rejecting it
 * outright -- but an incomplete proposal (missing difficulty/
 * estimated_minutes) must still be completely uninstallable until the USER
 * supplies the two missing fields. This file proves that at the store level
 * (`store/routineStore.ts`), the same seam
 * `__tests__/store/routineInstallGate.test.ts` already covers for the
 * complete/rejected cases -- this file does not duplicate those, it covers
 * the new `pendingProposal` / `completeProposal` step those predate.
 *
 * Mocking follows the exact pattern `routineInstallGate.test.ts` established.
 */
let mockInsertResult: { data: Record<string, unknown>[]; error: { message: string } | null } = {
  data: [],
  error: null,
};
const mockInsertCalls: { table: string; rows: Record<string, unknown>[] }[] = [];

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      getUser: jest.fn(),
    },
    functions: { invoke: jest.fn() },
    from: (table: string) => ({
      insert: (rows: Record<string, unknown>[]) => ({
        select: () => {
          mockInsertCalls.push({ table, rows });
          return Promise.resolve(mockInsertResult);
        },
      }),
    }),
  },
}));

import { supabase } from '../../lib/supabase';
import { useRoutineStore } from '../../store/routineStore';
import { useHabitStore } from '../../store/habitStore';
import type { Habit } from '../../lib/supabase';

function heavyHabit(id: string): Habit {
  return {
    id, user_id: 'u1', name: `Heavy ${id}`, icon: null, color: null,
    behavior_type: 'positive', tracking_type: 'boolean', unit: null,
    daily_goal: null, target_direction: null,
    frequency_config: { kind: 'daily' }, willpower_cost: 5, status: 'active',
    impact_level: null, urgency: null, difficulty: 5, estimated_minutes: 90,
    reminders: null, cue_habit_id: null, cue_note: null, life_area: null,
    end_condition: null, created_at: '2026-01-01T00:00:00.000Z',
  };
}

function resetStores() {
  mockInsertCalls.length = 0;
  mockInsertResult = { data: [], error: null };
  jest.clearAllMocks();
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  (supabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' } } });
  useHabitStore.setState({ habits: [], loading: false });
  useRoutineStore.setState({
    routines: [],
    generating: false, generateError: null,
    proposalSource: null, proposal: null, proposalErrors: null, evaluation: null,
    pendingProposal: null,
    installing: false, installError: null, installed: false,
  });
}

beforeEach(resetStores);

/** TODAY's real edge-function response shape -- see
 *  `__tests__/lib/routineProposalAdapter.test.ts` for the field-by-field
 *  provenance (SYSTEM_PROMPT, verbatim). */
function realEdgeResponsePayload() {
  return {
    name: 'Sabah Rutini',
    description: 'Daha üretken bir sabah',
    items: [
      { name: 'Su iç', icon: 'water-outline', tracking_type: 'boolean', unit: null, daily_goal: null, frequency_config: { kind: 'daily' }, willpower_cost: 2 },
      { name: 'Meditasyon', icon: 'leaf-outline', tracking_type: 'boolean', unit: null, daily_goal: null, frequency_config: { kind: 'daily' }, willpower_cost: 3 },
    ],
  };
}

describe("the regression, fixed: today's real edge-function shape stages an incomplete proposal instead of dead-ending", () => {
  it('generateRoutine stages pendingProposal, leaves proposal/evaluation null, and confirmInstall is a safe no-op', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: realEdgeResponsePayload(), error: null });

    await useRoutineStore.getState().generateRoutine('sabah rutini');

    const s = useRoutineStore.getState();
    expect(s.pendingProposal).not.toBeNull();
    expect(s.pendingProposal!.incomplete).toBe(true);
    expect(s.pendingProposal!.habits).toHaveLength(2);
    expect(s.proposal).toBeNull();
    expect(s.evaluation).toBeNull();
    expect(mockInsertCalls).toEqual([]);

    // Nothing valid is staged to write yet -- confirming is a safe no-op,
    // exactly like a genuinely-rejected proposal (Gate D 2 in
    // routineInstallGate.test.ts).
    const confirmed = await useRoutineStore.getState().confirmInstall();
    expect(confirmed).toBe(false);
    expect(mockInsertCalls).toEqual([]);
  });

  it('completeProposal refuses a hostile/absurd completion value -- pendingProposal is untouched, nothing installs', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: realEdgeResponsePayload(), error: null });
    await useRoutineStore.getState().generateRoutine('sabah rutini');
    expect(useRoutineStore.getState().pendingProposal).not.toBeNull();

    useRoutineStore.getState().completeProposal([
      { difficulty: 1, estimated_minutes: 2 },
      { difficulty: 99 as any, estimated_minutes: 15 }, // out of VALID_DIFFICULTIES
    ]);

    const s = useRoutineStore.getState();
    expect(s.proposal).toBeNull();
    expect(s.evaluation).toBeNull();
    expect(s.proposalErrors).not.toBeNull();

    const confirmed = await useRoutineStore.getState().confirmInstall();
    expect(confirmed).toBe(false);
    expect(mockInsertCalls).toEqual([]);
  });

  it("completeProposal with valid user values evaluates capacity for real and installs with correct active/waiting status -- proves the old estimated_minutes:0 blindness is gone", async () => {
    // Seed today's load at 72 (4 maximally-heavy active habits) -- identical
    // fixture shape to routineInstallGate.test.ts's Gate D 3.
    useHabitStore.setState({
      habits: [heavyHabit('h1'), heavyHabit('h2'), heavyHabit('h3'), heavyHabit('h4')],
      loading: false,
    });

    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: realEdgeResponsePayload(), error: null });
    await useRoutineStore.getState().generateRoutine('sabah rutini');
    expect(useRoutineStore.getState().pendingProposal).not.toBeNull();

    // The user supplies a HIGH estimated_minutes for 'Su iç'. If this were
    // silently defaulted to 0 (the exact pre-Gate-D bug this whole feature
    // exists to prevent), it would register near-zero load and be activated
    // regardless of today's actual capacity.
    useRoutineStore.getState().completeProposal([
      { difficulty: 5, estimated_minutes: 90 }, // 'Su iç' -- heavy
      { difficulty: 1, estimated_minutes: 2 },  // 'Meditasyon' -- light
    ]);

    const staged = useRoutineStore.getState();
    expect(staged.pendingProposal).toBeNull();
    expect(staged.proposal).not.toBeNull();
    expect(staged.evaluation).not.toBeNull();
    expect(staged.evaluation!.currentLoad).toBe(72);
    expect(staged.evaluation!.toQueue).toContain('Su iç');
    expect(staged.evaluation!.toActivate).toContain('Meditasyon');

    mockInsertResult = {
      data: [
        { ...heavyHabit('new1'), id: 'new1', name: 'Su iç', status: 'waiting' },
        { ...heavyHabit('new2'), id: 'new2', name: 'Meditasyon', status: 'active' },
      ],
      error: null,
    };

    const confirmed = await useRoutineStore.getState().confirmInstall();
    expect(confirmed).toBe(true);

    const rows = mockInsertCalls[0].rows;
    expect(rows.find((r) => r.name === 'Su iç')!.status).toBe('waiting');       // queued, never force-activated
    expect(rows.find((r) => r.name === 'Meditasyon')!.status).toBe('active');
    // The high user-supplied value really did travel all the way to the
    // written row -- not zero, not dropped, not overwritten.
    expect(rows.find((r) => r.name === 'Su iç')!.estimated_minutes).toBe(90);

    expect(useHabitStore.getState().habits.some((h) => h.id === 'new1')).toBe(true);
    expect(useRoutineStore.getState().installed).toBe(true);
  });
});

describe('Routine Packs still install unaffected by the adapter/completion changes', () => {
  it('loadPack stages a COMPLETE, capacity-evaluated proposal with no pendingProposal at all', () => {
    useHabitStore.setState({ habits: [], loading: false });
    useRoutineStore.getState().loadPack('deep-work');

    const s = useRoutineStore.getState();
    expect(s.proposalSource).toBe('pack');
    expect(s.pendingProposal).toBeNull();
    expect(s.proposal).not.toBeNull();
    expect(s.proposal!.habits.length).toBe(4);
    expect(s.evaluation).not.toBeNull();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
