import type { Habit } from '../../lib/supabase';

type StoredHabitRow = Habit & { install_id: string | null };

const db = {
  habits: [] as StoredHabitRow[],
  resolveFailsOnce: false,
  resolveCalls: 0,
  actionStatus: 'pending' as 'pending' | 'confirmed' | 'cancelled',
  seq: 0,
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { user: { id: 'u-coach-1' } } },
        error: null,
      })),
    },
    from: (table: string) => {
      if (table === 'habits') {
        let pendingInsert: Record<string, unknown>[] | null = null;
        const eqFilters: Record<string, unknown> = {};
        const q = {
          insert: (rows: Record<string, unknown>[]) => {
            pendingInsert = rows;
            return q;
          },
          select: () => {
            if (pendingInsert) {
              const rows = pendingInsert;
              pendingInsert = null;
              const installId = (rows[0]?.install_id as string | null) ?? null;
              if (
                installId &&
                db.habits.some((h) => h.user_id === rows[0].user_id && h.install_id === installId)
              ) {
                return Promise.resolve({
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint "habits_user_install_name_uniq"' },
                });
              }
              // Simulate a bare 23505 when no installId was supplied and caller forces collision
              if (!installId && rows[0]?.name === '__COLLIDE_WITHOUT_INSTALL_ID__') {
                return Promise.resolve({
                  data: null,
                  error: { code: '23505', message: 'duplicate key' },
                });
              }
              const created: StoredHabitRow[] = rows.map((r) => ({
                ...(r as unknown as Habit),
                id: `hab-${++db.seq}`,
                created_at: '2026-11-22T10:00:00.000Z',
                install_id: installId,
              }));
              db.habits.push(...created);
              return Promise.resolve({ data: created, error: null });
            }
            return q;
          },
          eq: (col: string, val: unknown) => {
            eqFilters[col] = val;
            return q;
          },
          limit: () => q,
          then: (onOk: (v: unknown) => unknown) => {
            const found = db.habits.filter((h) =>
              Object.entries(eqFilters).every(([k, v]) => (h as unknown as Record<string, unknown>)[k] === v),
            );
            return Promise.resolve({ data: found, error: null }).then(onOk);
          },
        };
        return q;
      }
      if (table === 'ai_conversation_actions') {
        const q = {
          update: () => q,
          eq: () => q,
          select: () => ({
            maybeSingle: async () => {
              db.resolveCalls += 1;
              if (db.resolveFailsOnce) {
                db.resolveFailsOnce = false;
                return { data: null, error: { message: 'network drop before resolve committed' } };
              }
              db.actionStatus = 'confirmed';
              return {
                data: {
                  id: 'act-install-1',
                  conversation_id: 'conv-1',
                  assistant_message_id: 'msg-1',
                  user_id: 'u-coach-1',
                  action_type: 'propose_habit',
                  payload: {},
                  status: 'confirmed',
                  created_at: '2026-11-22T10:00:00.000Z',
                  resolved_at: '2026-11-22T10:00:05.000Z',
                },
                error: null,
              };
            },
          }),
        };
        return q;
      }
      if (table === 'willpower_state') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
    rpc: async () => ({ data: [], error: null }),
  },
}));

import { insertRoutineHabits } from '../../repositories/habitRepository';
import { useAiConversationStore } from '../../store/aiConversationStore';
import { useHabitStore } from '../../store/habitStore';
import { useRoutineStore } from '../../store/routineStore';

const SAMPLE_PROPOSAL = {
  title: 'Odak Planı',
  goal: 'Günlük kitap okuma',
  habits: [
    {
      name: 'Kitap Oku',
      tracking_type: 'numeric' as const,
      difficulty: 3 as const,
      estimated_minutes: 20,
      unit: 'dakika',
      daily_goal: 20,
      target_direction: 'at_least' as const,
      frequency_config: { kind: 'daily' as const },
    },
  ],
};

describe('F21 (INT-13) — Coach staged habit install idempotency across mid-flight crash / retry', () => {
  beforeEach(() => {
    db.habits = [];
    db.resolveFailsOnce = false;
    db.resolveCalls = 0;
    db.actionStatus = 'pending';
    db.seq = 0;
    useHabitStore.setState({ habits: [] });
    useRoutineStore.getState().clearGenerated();
    useAiConversationStore.getState().reset();
  });

  it('(+) crash/failure between habit insert and action resolution recovers on second confirm without duplicating habits', async () => {
    const actionId = 'act-install-1';
    useAiConversationStore.setState({
      activeId: 'conv-1',
      pendingAction: {
        row: {
          id: actionId,
          conversation_id: 'conv-1',
          assistant_message_id: 'msg-1',
          user_id: 'u-coach-1',
          action_type: 'propose_habit',
          payload: {},
          status: 'pending',
          created_at: '2026-11-22T10:00:00.000Z',
          resolved_at: null,
        },
        action: { type: 'propose_habit', habit: SAMPLE_PROPOSAL.habits[0] },
      },
    });

    // Attempt 1: habits insert succeeds with install_id = actionId, then resolvePending fails
    expect(useRoutineStore.getState().stageCoachProposal(SAMPLE_PROPOSAL)).toBe(true);
    expect(await useRoutineStore.getState().confirmInstall(actionId)).toBe(true);
    db.resolveFailsOnce = true;
    const firstResolve = await useAiConversationStore.getState().resolvePending('confirmed');
    expect(firstResolve).toBe(false);
    expect(db.habits).toHaveLength(1);
    expect(useHabitStore.getState().habits).toHaveLength(1);

    // App restarts / card re-opens with same actionId; Attempt 2 hits 23505 on install_id and returns existing rows!
    useAiConversationStore.setState({
      activeId: 'conv-1',
      pendingAction: {
        row: {
          id: actionId,
          conversation_id: 'conv-1',
          assistant_message_id: 'msg-1',
          user_id: 'u-coach-1',
          action_type: 'propose_habit',
          payload: {},
          status: 'pending',
          created_at: '2026-11-22T10:00:00.000Z',
          resolved_at: null,
        },
        action: { type: 'propose_habit', habit: SAMPLE_PROPOSAL.habits[0] },
      },
    });
    expect(useRoutineStore.getState().stageCoachProposal(SAMPLE_PROPOSAL)).toBe(true);
    expect(await useRoutineStore.getState().confirmInstall(actionId)).toBe(true);
    const secondResolve = await useAiConversationStore.getState().resolvePending('confirmed');
    expect(secondResolve).toBe(true);

    // Zero duplicate rows in DB AND zero duplicate entries in habitStore!
    expect(db.habits).toHaveLength(1);
    expect(useHabitStore.getState().habits).toHaveLength(1);
    expect(db.resolveCalls).toBe(2);
    expect(db.actionStatus).toBe('confirmed');
  });

  it('(-) distinct installId allows a second independent install, and missing installId keeps 23505 as an error', async () => {
    expect(useRoutineStore.getState().stageCoachProposal(SAMPLE_PROPOSAL)).toBe(true);
    expect(await useRoutineStore.getState().confirmInstall('act-first')).toBe(true);

    expect(useRoutineStore.getState().stageCoachProposal(SAMPLE_PROPOSAL)).toBe(true);
    expect(await useRoutineStore.getState().confirmInstall('act-second')).toBe(true);

    expect(db.habits).toHaveLength(2);
    expect(useHabitStore.getState().habits).toHaveLength(2);

    const noIdCollision = await insertRoutineHabits([
      {
        name: '__COLLIDE_WITHOUT_INSTALL_ID__',
        icon: null,
        tracking_type: 'boolean',
        unit: null,
        daily_goal: null,
        target_direction: null,
        frequency_config: { kind: 'daily' },
        willpower_cost: 2,
        difficulty: 3,
        estimated_minutes: 15,
        status: 'active',
      },
    ]);
    expect(noIdCollision.ok).toBe(false);
  });
});
