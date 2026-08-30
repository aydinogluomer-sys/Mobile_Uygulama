/**
 * L1 tests for habit-log write integrity.  (task 1B-005)
 *
 * AC-L01  a double-tap issues exactly ONE insert
 * AC-L02  an insert error is reported to the caller, not discarded
 * AC-L03  an update error is reported to the caller, not discarded
 * AC-L04  a unique violation (23505) is recovered, not lost
 * AC-L05  two different habits are not serialised against each other
 *
 * SCOPE LIMIT, stated rather than implied: these are Layer 1 tests against a
 * fake client. They prove the store issues the right calls. They do NOT prove
 * the database rejects a duplicate row -- only a UNIQUE constraint does that,
 * and that is asserted in Layer 2 (pgTAP), not here.
 *
 * Written BEFORE the fix and observed to fail, per R-01.
 */
type Row = {
  id: string; habit_id: string; user_id: string; completed_at: string;
  value: number | null; is_completed: boolean; state: string;
  xp: number | null; created_at: string;
};

type PgError = { message: string; code?: string };

/**
 * All fake-client state lives here. The name is `mock`-prefixed because Jest
 * hoists `jest.mock()` above every declaration and rejects factories that
 * close over anything else. Nothing below dereferences it at factory-build
 * time -- only inside method bodies, which run during the tests.
 */
const mockDb = {
  calls: [] as string[],
  rows: [] as Row[],
  insertError: null as PgError | null,
  updateError: null as PgError | null,
  gate: null as null | (() => void),
  idSeq: 0,
};

function openGate() { const g = mockDb.gate; mockDb.gate = null; g?.(); }

jest.mock('../../lib/supabase', () => {
  /** Writes park here until the gate is released -- lets a second tap land mid-flight. */
  const pause = async () => {
    if (!mockDb.gate) return;
    await new Promise<void>((res) => {
      const prev = mockDb.gate as () => void;
      mockDb.gate = () => { prev(); res(); };
    });
  };
  const match = (filters: Record<string, unknown>) =>
    mockDb.rows.filter((r) =>
      Object.entries(filters).every(
        ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));

  return {
    supabase: {
      auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: () => ({
        select: () => {
          const filters: Record<string, unknown> = {};
          const q = {
            eq(col: string, val: unknown) { filters[col] = val; return q; },
            then(onOk: (v: unknown) => unknown) {
              mockDb.calls.push('select');
              return Promise.resolve({ data: match(filters), error: null }).then(onOk);
            },
            async maybeSingle() {
              mockDb.calls.push('select');
              return { data: match(filters)[0] ?? null, error: null };
            },
          };
          return q;
        },
        insert(payload: Record<string, unknown>) {
          return {
            select: () => ({
              single: async () => {
                mockDb.calls.push('insert');
                await pause();
                if (mockDb.insertError) {
                  const e = mockDb.insertError; mockDb.insertError = null;
                  return { data: null, error: e };
                }
                const row = { id: 'r' + ++mockDb.idSeq, created_at: 'now', ...payload } as unknown as Row;
                mockDb.rows.push(row);
                return { data: row, error: null };
              },
            }),
          };
        },
        update(payload: Record<string, unknown>) {
          const filters: Record<string, unknown> = {};
          const u = {
            eq(col: string, val: unknown) { filters[col] = val; return u; },
            select: () => ({
              single: async () => {
                mockDb.calls.push('update');
                await pause();
                if (mockDb.updateError) {
                  const e = mockDb.updateError; mockDb.updateError = null;
                  return { data: null, error: e };
                }
                const row = mockDb.rows.find((r) => r.id === filters.id);
                if (!row) return { data: null, error: { message: 'no row' } };
                Object.assign(row, payload);
                return { data: row, error: null };
              },
              maybeSingle: async () => {
                mockDb.calls.push('update');
                await pause();
                if (mockDb.updateError) {
                  const e = mockDb.updateError; mockDb.updateError = null;
                  return { data: null, error: e };
                }
                const row = mockDb.rows.find((r) => r.id === filters.id);
                if (!row) return { data: null, error: { message: 'no row' } };
                Object.assign(row, payload);
                return { data: row, error: null };
              },
            }),
          };
          return u;
        },
      }),
    },
  };
});

import { useLogStore } from '../../store/logStore';

const DAY = new Date(2026, 7, 4);

beforeEach(() => {
  mockDb.calls.length = 0;
  mockDb.rows.length = 0;
  mockDb.idSeq = 0;
  mockDb.insertError = null;
  mockDb.updateError = null;
  mockDb.gate = null;
  useLogStore.setState({ logs: [], loading: false });
});

describe('AC-L01 -- a double-tap must not create two rows', () => {
  it('issues exactly one insert when the same habit is tapped twice mid-flight', async () => {
    mockDb.gate = () => {};
    const first = useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'done' });
    const second = useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'done' });
    openGate();
    await Promise.resolve();
    openGate();
    await Promise.all([first, second]);

    expect(mockDb.calls.filter((c) => c === 'insert')).toHaveLength(1);
    expect(mockDb.rows).toHaveLength(1);
  });

  it('leaves exactly one log in local state', async () => {
    await useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'done' });
    await useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'partial', value: 2, targetValue: 4 });
    expect(useLogStore.getState().logs).toHaveLength(1);
    expect(useLogStore.getState().logs[0].state).toBe('partial');
  });
});

describe('AC-L02/L03 -- errors reach the caller', () => {
  it('reports an insert failure instead of returning silently', async () => {
    mockDb.insertError = { message: 'insert boom' };
    const res = await useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'done' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('insert boom');
    expect(useLogStore.getState().logs).toHaveLength(0);
  });

  it('reports an update failure instead of returning silently', async () => {
    await useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'done' });
    mockDb.updateError = { message: 'update boom' };
    const res = await useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'miss' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('update boom');
  });

  it('reports success with the stored row', async () => {
    const res = await useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'done' });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.log.completed_at).toBe('2026-08-04');
  });
});

describe('AC-L04 -- a unique violation is recovered, not lost', () => {
  it('re-reads and updates when the database rejects the duplicate', async () => {
    // The row exists in the database but not in local state: the old code
    // reads local state, sees nothing, and inserts.
    mockDb.rows.push({
      id: 'existing', habit_id: 'h1', user_id: 'u1', completed_at: '2026-08-04',
      value: null, is_completed: true, state: 'done', xp: 30, created_at: 'now',
    });
    mockDb.insertError = { message: 'duplicate key value violates unique constraint', code: '23505' };

    const res = await useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'miss' });

    expect(res.ok).toBe(true);
    expect(mockDb.rows).toHaveLength(1);
    expect(mockDb.rows[0].state).toBe('miss');
    expect(mockDb.calls).toContain('update');
  });
});

describe('AC-L05 -- different habits are not coupled', () => {
  it('does not serialise h2 behind an in-flight h1', async () => {
    mockDb.gate = () => {};
    const a = useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'done' });
    const b = useLogStore.getState().logHabit({ habitId: 'h2', date: DAY, state: 'done' });
    openGate();
    await Promise.all([a, b]);
    expect(mockDb.calls.filter((c) => c === 'insert')).toHaveLength(2);
    expect(mockDb.rows).toHaveLength(2);
  });
});
