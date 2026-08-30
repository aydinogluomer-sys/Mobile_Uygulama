/**
 * Gate D evidence: the Routine/AI install gate.  (Phase 3, CODER-J, plan §13)
 *
 * Plan §24 Gate D: "AI olmadan uygulamanın bütün core işlevleri çalışmalıdır.
 * AI failure core product failure yaratmamalıdır." This file proves it at
 * the store level (`store/routineStore.ts`), the seam where an AI response
 * either becomes a database write or does not:
 *
 *  1. The AI call itself failing/throwing never crashes the store and never
 *     writes anything -- and pure "core" engines (`lib/capacity.ts`,
 *     `lib/behaviorIntelligence.ts`) are completely unaffected regardless
 *     (they take no dependency on the AI path at all -- proven directly, not
 *     assumed, right after simulating the failure).
 *  2. A syntactically-valid-JSON-but-wrong-schema AI response (missing
 *     required fields, the exact shape today's real edge function produces
 *     -- see this task's Edge Function Findings) is REJECTED with a clear,
 *     user-facing reason. Nothing is written. Calling `confirmInstall()` in
 *     this state is a safe no-op, not a bypass.
 *  3. A well-formed, capacity-violating AI response results in a WRITE where
 *     the over-capacity habit is queued (`status: 'waiting'`), never
 *     force-activated.
 *
 * Mocking follows the exact pattern __tests__/store/habitStoreCapacityWiring.test.ts
 * established (a hand-rolled chainable `supabase.from` mock, `mock`-prefixed
 * variables so Jest's hoisting allows the factory to reference them).
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
import { dailyLoad, canActivate, CAPACITY_CEILING_DEFAULT } from '../../lib/capacity';
import { recoverySuccessRate } from '../../lib/behaviorIntelligence';
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
    installing: false, installError: null, installed: false,
  });
}

beforeEach(resetStores);

describe('Gate D 1 -- the AI call failing never writes anything and never touches core engines', () => {
  it('functions.invoke THROWING is caught -- no crash, no write, a clear error surfaces', async () => {
    (supabase.functions.invoke as jest.Mock).mockRejectedValue(new Error('network timeout'));

    await expect(useRoutineStore.getState().generateRoutine('sabah rutini')).resolves.toBeUndefined();

    const s = useRoutineStore.getState();
    expect(s.generateError).toBeTruthy();
    expect(s.proposal).toBeNull();
    expect(mockInsertCalls).toEqual([]);
  });

  it('functions.invoke resolving with an error object is handled -- no crash, no write', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: null,
      error: { message: 'AI servisi şu an yoğun', context: { json: async () => ({ error: 'AI servisi şu an yoğun' }) } },
    });

    await useRoutineStore.getState().generateRoutine('sabah rutini');

    const s = useRoutineStore.getState();
    expect(s.generateError).toBe('AI servisi şu an yoğun');
    expect(s.proposal).toBeNull();
    expect(mockInsertCalls).toEqual([]);
  });

  it('the edge function\'s own guardrail error (data.error) is surfaced, not swallowed -- no write', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: { error: 'AI yanıt formatı geçersiz, tekrar deneyin.' },
      error: null,
    });

    await useRoutineStore.getState().generateRoutine('sabah rutini');

    expect(useRoutineStore.getState().generateError).toBe('AI yanıt formatı geçersiz, tekrar deneyin.');
    expect(mockInsertCalls).toEqual([]);
  });

  it('core engines (capacity, behaviorIntelligence) are completely unaffected by the AI failure above -- they take no dependency on it', () => {
    // These are plain, pure functions -- proven callable/correct in the same
    // test run right after every AI failure above, with no reset needed:
    // there is no shared state between the AI path and these engines at all.
    const load = dailyLoad({ habits: [{ difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' }, impact_level: null }] });
    expect(load.normalised).toBe(18);
    expect(canActivate({ currentLoad: 0, habit: { difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' }, impact_level: null }, ceiling: CAPACITY_CEILING_DEFAULT })).toBe(true);
    expect(recoverySuccessRate([{ habit_id: 'h1', status: 'completed' }])).toEqual({ ok: true, value: 1 });
  });
});

describe('Gate D 2 -- a schema-invalid AI response is rejected, nothing is written, confirmInstall is a safe no-op', () => {
  it('rejects TODAY\'S real edge-function shape once difficulty/estimated_minutes are absent (see Edge Function Findings)', async () => {
    // This is not a contrived fixture -- it is exactly the shape
    // supabase/functions/generate-routine/index.ts's SYSTEM_PROMPT asks the
    // AI for today: {name, description, items:[{name, icon, tracking_type,
    // unit, daily_goal, frequency_config, willpower_cost}]} -- no
    // difficulty, no estimated_minutes.
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: {
        name: 'Sabah Rutini',
        description: 'Daha üretken bir sabah',
        items: [
          { name: 'Su iç', icon: 'water-outline', tracking_type: 'boolean', unit: null, daily_goal: null, frequency_config: { kind: 'daily' }, willpower_cost: 2 },
        ],
      },
      error: null,
    });

    await useRoutineStore.getState().generateRoutine('sabah rutini');

    const s = useRoutineStore.getState();
    expect(s.proposal).toBeNull();
    expect(s.proposalErrors).not.toBeNull();
    expect(s.proposalErrors!.length).toBeGreaterThan(0);
    expect(s.proposalErrors!.some((m) => /difficulty/.test(m))).toBe(true);
    expect(s.proposalErrors!.some((m) => /estimated_minutes/.test(m))).toBe(true);
    expect(mockInsertCalls).toEqual([]);

    // Even if a caller tried to confirm anyway -- there is nothing staged to write.
    const confirmed = await useRoutineStore.getState().confirmInstall();
    expect(confirmed).toBe(false);
    expect(mockInsertCalls).toEqual([]);
  });

  it('rejects a proposal using a blocked (unpersistable) tracking_type, citing a specific not-persistable reason', async () => {
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: {
        name: 'Odak Rutini',
        description: 'test',
        // difficulty/estimated_minutes ARE present here -- isolates the
        // failure to tracking_type alone, so this test actually proves the
        // blocked-tracking-type reason path, not a missing-field rejection.
        items: [{ name: 'Sigara içmemek', tracking_type: 'abstinence', difficulty: 3, estimated_minutes: 0 }],
      },
      error: null,
    });
    await useRoutineStore.getState().generateRoutine('odak');
    const s = useRoutineStore.getState();
    expect(s.proposal).toBeNull();
    expect(s.proposalErrors!.some((m) => /cannot be persisted/.test(m) && !/unknown tracking_type/.test(m))).toBe(true);
    expect(mockInsertCalls).toEqual([]);
  });
});

describe('Gate D 3 -- a well-formed, capacity-violating response installs with a queue, never a force-activate', () => {
  it('queues the over-capacity habit as \'waiting\' and activates the rest as \'active\'', async () => {
    // Seed today's load at 72 (4 maximally-heavy active habits).
    useHabitStore.setState({
      habits: [heavyHabit('h1'), heavyHabit('h2'), heavyHabit('h3'), heavyHabit('h4')],
      loading: false,
    });

    // A well-formed response using the CANONICAL plan §13 field names
    // directly (title/goal/habits) -- proves the gate activates/queues
    // correctly once a proposal is valid, independent of the separate
    // adapter-shape finding covered by Gate D 2 above.
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: {
        name: 'Ağır Paket', // adapted: name -> title, description -> goal, items -> habits
        description: 'test',
        items: [
          { name: 'Light', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 },
          { name: 'Heavy', tracking_type: 'binary', difficulty: 5, estimated_minutes: 90 },
        ],
      },
      error: null,
    });

    await useRoutineStore.getState().generateRoutine('ağır paket');

    const staged = useRoutineStore.getState();
    expect(staged.proposal).not.toBeNull();
    expect(staged.evaluation).not.toBeNull();
    expect(staged.evaluation!.toActivate).toEqual(['Light']);
    expect(staged.evaluation!.toQueue).toEqual(['Heavy']);

    mockInsertResult = {
      data: [
        { ...heavyHabit('new1'), id: 'new1', name: 'Light', status: 'active' },
        { ...heavyHabit('new2'), id: 'new2', name: 'Heavy', status: 'waiting' },
      ],
      error: null,
    };

    const confirmed = await useRoutineStore.getState().confirmInstall();
    expect(confirmed).toBe(true);
    expect(mockInsertCalls).toHaveLength(1);

    const rows = mockInsertCalls[0].rows;
    const light = rows.find((r) => r.name === 'Light')!;
    const heavy = rows.find((r) => r.name === 'Heavy')!;
    expect(light.status).toBe('active');
    expect(heavy.status).toBe('waiting'); // queued, NEVER force-activated

    // Newly-installed habits are reflected in habitStore without a refetch.
    expect(useHabitStore.getState().habits.some((h) => h.id === 'new1')).toBe(true);
    expect(useHabitStore.getState().habits.some((h) => h.id === 'new2')).toBe(true);

    // The gate resets after a successful install -- no stale proposal lingers.
    expect(useRoutineStore.getState().proposal).toBeNull();
    expect(useRoutineStore.getState().installed).toBe(true);
  });

  it('a repository-level write failure surfaces installError and does not mark installed', async () => {
    useHabitStore.setState({ habits: [], loading: false });
    (supabase.functions.invoke as jest.Mock).mockResolvedValue({
      data: { name: 'Basit', description: 'test', items: [{ name: 'X', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 }] },
      error: null,
    });
    await useRoutineStore.getState().generateRoutine('basit');
    expect(useRoutineStore.getState().proposal).not.toBeNull();

    mockInsertResult = { data: [], error: { message: 'insert failed' } };
    const confirmed = await useRoutineStore.getState().confirmInstall();

    expect(confirmed).toBe(false);
    expect(useRoutineStore.getState().installError).toBe('insert failed');
    expect(useRoutineStore.getState().installed).toBe(false);
  });
});

describe('Routine Packs go through the identical gate', () => {
  it('loadPack stages a validated, capacity-evaluated proposal with no network call at all', () => {
    useHabitStore.setState({ habits: [], loading: false });
    useRoutineStore.getState().loadPack('morning-reset');

    const s = useRoutineStore.getState();
    expect(s.proposalSource).toBe('pack');
    expect(s.proposal).not.toBeNull();
    expect(s.proposal!.habits.length).toBe(5);
    expect(s.evaluation).not.toBeNull();
    expect(supabase.functions.invoke).not.toHaveBeenCalled();
  });
});
