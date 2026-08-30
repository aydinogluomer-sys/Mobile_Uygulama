/**
 * §22 analytics emission -- `store/routineStore.ts` /
 * `routine_installed` + `ai_routine_generated`.  (task Phase-4 CODER-O)
 *
 * Behavioural, for the reason spelled out in
 * `habitStoreAnalytics.test.ts`'s header.
 *
 * The two events sit on opposite sides of the Gate D pipeline and must not
 * be confused with one another: `ai_routine_generated` reports that an AI
 * response survived validation (nothing has been written), while
 * `routine_installed` reports that habits were actually inserted -- and
 * fires for the Routine Pack path too, which involves no AI at all.
 *
 * Invariants:
 *  AC-1  a complete AI response -> exactly one `ai_routine_generated`
 *        {habit_count, complete:true}, and NO `routine_installed`.
 *  AC-2  an accepted-but-incomplete AI response (today's real edge-function
 *        shape) -> still exactly one `ai_routine_generated`, complete:false.
 *  AC-3  a rejected / errored / thrown AI call -> no event at all.
 *  AC-4  `confirmInstall` success -> exactly one `routine_installed` with
 *        the source and the activated/queued split.
 *  AC-5  `confirmInstall` whose bulk insert fails -> no event.
 *  AC-6  no AI prose (routine title, goal, habit names) on any event.
 *  AC-7  a throwing sink does not break generation or installation.
 */
type PgError = { message: string } | null;

const mockState = {
  insertedRows: [] as Record<string, unknown>[],
  insertError: null as PgError,
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      getUser: jest.fn(),
    },
    functions: { invoke: jest.fn() },
    from: () => ({
      insert: (rows: Record<string, unknown>[]) => ({
        select: () => {
          mockState.insertedRows.push(...rows);
          if (mockState.insertError) return Promise.resolve({ data: null, error: mockState.insertError });
          return Promise.resolve({
            data: rows.map((r, i) => ({
              id: `dddddddd-4444-4444-8444-00000000000${i}`,
              user_id: 'u1',
              created_at: '2026-08-30T09:00:00.000Z',
              ...r,
            })),
            error: null,
          });
        },
      }),
    }),
  },
}));

// The real module plus a spy on its emission funnel. `buildEvent` is NOT
// stubbed: the privacy filter these tests assert on is the shipping one.
// Spying on `emitEvent` (rather than attaching a sink via
// `setAnalyticsSink`) is deliberate -- `emitEvent` swallows a sink's throw
// by design, so a sink-based spy could never show whether THIS STORE is
// safe against an analytics failure. AC "analytics never breaks the
// feature" below needs the throw to originate where the store calls it.
jest.mock('../../lib/analytics', () => ({
  __esModule: true,
  ...jest.requireActual('../../lib/analytics'),
  emitEvent: jest.fn(),
}));

import * as analytics from '../../lib/analytics';
import type { AnalyticsEvent } from '../../lib/analytics';
import { supabase } from '../../lib/supabase';
import { useRoutineStore } from '../../store/routineStore';
import { useHabitStore } from '../../store/habitStore';

const emit = (analytics as unknown as { emitEvent: jest.Mock }).emitEvent;

function emitted(name?: string): AnalyticsEvent[] {
  return emit.mock.calls
    .map((c) => c[0] as AnalyticsEvent)
    .filter((e) => name === undefined || e.name === name);
}

/** A COMPLETE edge response (difficulty + estimated_minutes present). */
const COMPLETE_RESPONSE = {
  name: 'Sabah Rutini',
  description: 'Daha üretken ve sakin bir sabah için',
  items: [
    // difficulty must be one of the app's real levels (1/3/5 -- Kolay/Orta/Zor).
    { name: 'Su iç', tracking_type: 'binary', difficulty: 1, estimated_minutes: 2 },
    { name: 'Kısa yürüyüş yap', tracking_type: 'binary', difficulty: 3, estimated_minutes: 15 },
  ],
};

/**
 * Exactly the shape `supabase/functions/generate-routine` asks the AI for
 * today -- no difficulty, no estimated_minutes. Accepted, but incomplete.
 */
const INCOMPLETE_RESPONSE = {
  name: 'Akşam Rutini',
  description: 'Ekranı bırak, uykuya hazırlan',
  items: [
    { name: 'Telefonu şarja tak', icon: 'phone-portrait-outline', tracking_type: 'boolean', unit: null, daily_goal: null, frequency_config: { kind: 'daily' }, willpower_cost: 2 },
  ],
};

beforeEach(() => {
  mockState.insertedRows = [];
  mockState.insertError = null;
  emit.mockReset();
  emit.mockImplementation(() => undefined);
  jest.clearAllMocks();
  (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: { user: { id: 'u1' } } } });
  (supabase.auth.getUser as jest.Mock).mockResolvedValue({ data: { user: { id: 'u1' } } });
  useHabitStore.setState({ habits: [], loading: false });
  useRoutineStore.setState({
    routines: [], generating: false, generateError: null,
    proposalSource: null, proposal: null, proposalErrors: null,
    evaluation: null, pendingProposal: null,
    installing: false, installError: null, installed: false,
  });
});

describe('AC-1 -- a complete AI response emits exactly one ai_routine_generated', () => {
  it('reports the habit count and completeness, and writes nothing', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: COMPLETE_RESPONSE, error: null });

    await useRoutineStore.getState().generateRoutine('sabah rutini kur');

    expect(useRoutineStore.getState().proposal).not.toBeNull();
    const evs = emitted('ai_routine_generated');
    expect(evs).toHaveLength(1);
    expect(evs[0].props).toEqual({ habit_count: 2, complete: true });
    expect(evs[0].dropped).toEqual([]);
    // Generation is not installation.
    expect(emitted('routine_installed')).toHaveLength(0);
    expect(mockState.insertedRows).toHaveLength(0);
  });
});

describe('AC-2 -- an accepted-but-incomplete AI response still emits once', () => {
  it('emits with complete:false while the proposal is only staged', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: INCOMPLETE_RESPONSE, error: null });

    await useRoutineStore.getState().generateRoutine('akşam rutini kur');

    const s = useRoutineStore.getState();
    expect(s.pendingProposal).not.toBeNull();
    expect(s.proposal).toBeNull();

    const evs = emitted('ai_routine_generated');
    expect(evs).toHaveLength(1);
    expect(evs[0].props).toEqual({ habit_count: 1, complete: false });
  });
});

describe('AC-3 -- a generation that fails emits nothing', () => {
  it('no event when the edge function returns an error', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: null, error: { message: 'insufficient credits' } });

    await useRoutineStore.getState().generateRoutine('rutin');

    expect(useRoutineStore.getState().generateError).not.toBeNull();
    expect(emitted()).toHaveLength(0);
  });

  it('no event when the edge function throws', async () => {
    (supabase.functions.invoke as jest.Mock).mockRejectedValue(new Error('network timeout'));

    await useRoutineStore.getState().generateRoutine('rutin');

    expect(emitted()).toHaveLength(0);
  });

  it('no event when the response is schema-invalid (the gate rejects it)', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: { name: 'X', description: 'y', items: [], sneaky_extra_field: true },
      error: null,
    });

    await useRoutineStore.getState().generateRoutine('rutin');

    const s = useRoutineStore.getState();
    expect(s.proposal).toBeNull();
    expect(s.pendingProposal).toBeNull();
    expect(s.proposalErrors).not.toBeNull();
    expect(emitted()).toHaveLength(0);
  });

  it('no event when there is no session (the AI is never called)', async () => {
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({ data: { session: null } });

    await useRoutineStore.getState().generateRoutine('rutin');

    expect(supabase.functions.invoke).not.toHaveBeenCalled();
    expect(emitted()).toHaveLength(0);
  });
});

describe('AC-4 -- a successful install emits exactly one routine_installed', () => {
  it('reports the source and the activated/queued split', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: COMPLETE_RESPONSE, error: null });
    await useRoutineStore.getState().generateRoutine('sabah rutini kur');
    emit.mockClear();

    const ok = await useRoutineStore.getState().confirmInstall();

    expect(ok).toBe(true);
    const evs = emitted('routine_installed');
    expect(evs).toHaveLength(1);
    expect(evs[0].props).toEqual({
      source: 'ai',
      habit_count: 2,
      activated_count: 2,
      queued_count: 0,
    });
    expect(evs[0].dropped).toEqual([]);
  });

  it('fires for the Routine Pack path too -- no AI involved', async () => {
    useRoutineStore.getState().loadPack('morning-reset');
    emit.mockClear();

    const ok = await useRoutineStore.getState().confirmInstall();

    expect(ok).toBe(true);
    const evs = emitted('routine_installed');
    expect(evs).toHaveLength(1);
    expect(evs[0].props.source).toBe('pack');
    expect(emitted('ai_routine_generated')).toHaveLength(0);
  });

  it('a second confirmInstall on cleared state is a no-op and emits nothing', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: COMPLETE_RESPONSE, error: null });
    await useRoutineStore.getState().generateRoutine('sabah rutini kur');
    await useRoutineStore.getState().confirmInstall();
    emit.mockClear();

    const again = await useRoutineStore.getState().confirmInstall();

    expect(again).toBe(false);
    expect(emitted()).toHaveLength(0);
  });
});

describe('AC-5 -- an install that fails emits nothing', () => {
  it('no event when the bulk insert is rejected', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: COMPLETE_RESPONSE, error: null });
    await useRoutineStore.getState().generateRoutine('sabah rutini kur');
    emit.mockClear();
    mockState.insertError = { message: 'new row violates row-level security policy' };

    const ok = await useRoutineStore.getState().confirmInstall();

    expect(ok).toBe(false);
    expect(useRoutineStore.getState().installError).not.toBeNull();
    expect(emitted()).toHaveLength(0);
  });
});

describe('AC-6 -- no AI prose reaches either event', () => {
  it('carries no routine title, goal or habit name', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: COMPLETE_RESPONSE, error: null });
    await useRoutineStore.getState().generateRoutine('sabah rutini kur');
    await useRoutineStore.getState().confirmInstall();

    const serialised = JSON.stringify(emitted());
    expect(emitted()).toHaveLength(2);
    expect(serialised).not.toContain('Sabah Rutini');
    expect(serialised).not.toContain('üretken');
    expect(serialised).not.toContain('yürüyüş');

    // The names ARE written to the habits rows -- the user's own data.
    expect(mockState.insertedRows.map((r) => r.name)).toEqual(['Su iç', 'Kısa yürüyüş yap']);
  });
});

describe('AC-7 -- analytics never breaks the feature', () => {
  it('a throwing sink still generates and still installs', async () => {
    emit.mockImplementation(() => {
      throw new Error('sink exploded');
    });
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({ data: COMPLETE_RESPONSE, error: null });

    await useRoutineStore.getState().generateRoutine('sabah rutini kur');
    expect(useRoutineStore.getState().proposal).not.toBeNull();

    const ok = await useRoutineStore.getState().confirmInstall();
    expect(ok).toBe(true);
    expect(useRoutineStore.getState().installed).toBe(true);
    expect(useHabitStore.getState().habits).toHaveLength(2);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});
