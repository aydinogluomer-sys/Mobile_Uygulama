/**
 * Repository tests for `repositories/focusTaskRepository.ts`.  (Phase 1 + F16 CAS)
 */
type PgError = { message: string; code?: string };

const mockDb = {
  rows: [] as Record<string, unknown>[],
  error: null as PgError | null,
  user: { id: 'u1' } as { id: string } | null,
  beforeUpdate: null as (() => void) | null,
  updateEqs: [] as Record<string, unknown>[],
  tick: 0,
};

const nextVersion = () => `2026-10-01T12:00:${String(++mockDb.tick).padStart(2, '0')}.000Z`;

jest.mock('../../lib/supabase', () => {
  function select() {
    const eqFilters: Record<string, unknown> = {};
    const orders: { col: string; asc: boolean }[] = [];
    let limitN: number | null = null;
    let sliceRange: [number, number] | null = null;

    const filterRows = () => {
      let rows = mockDb.rows.filter((r) => {
        for (const [col, val] of Object.entries(eqFilters)) if (r[col] !== val) return false;
        return true;
      });
      if (orders.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const o of orders) {
            const av = String(a[o.col] ?? '');
            const bv = String(b[o.col] ?? '');
            if (av !== bv) return o.asc ? (av < bv ? -1 : 1) : (av > bv ? -1 : 1);
          }
          return 0;
        });
      }
      if (sliceRange) rows = rows.slice(sliceRange[0], sliceRange[1] + 1);
      else if (limitN != null) rows = rows.slice(0, limitN);
      return rows;
    };

    const q: any = {
      eq(col: string, val: unknown) { eqFilters[col] = val; return q; },
      order(col: string, opts?: { ascending?: boolean }) {
        orders.push({ col, asc: opts?.ascending ?? true });
        return q;
      },
      limit(n: number) { limitN = n; return q; },
      range(from: number, to: number) { sliceRange = [from, to]; return q; },
      async maybeSingle() {
        if (mockDb.error) return { data: null, error: mockDb.error };
        const rows = filterRows();
        return { data: rows[0] ? { ...rows[0] } : null, error: null };
      },
      then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
        if (mockDb.error) return Promise.resolve({ data: null, error: mockDb.error }).then(onOk, onErr);
        return Promise.resolve({ data: filterRows(), error: null }).then(onOk, onErr);
      },
    };
    return q;
  }

  function update(patch: Record<string, unknown>) {
    const eqFilters: Record<string, unknown> = {};
    const q: any = {
      eq(col: string, val: unknown) { eqFilters[col] = val; return q; },
      select() {
        return {
          async maybeSingle() {
            mockDb.beforeUpdate?.();
            mockDb.updateEqs.push({ ...eqFilters });
            if (mockDb.error) return { data: null, error: mockDb.error };
            const idx = mockDb.rows.findIndex((r) =>
              Object.entries(eqFilters).every(([col, val]) => r[col] === val),
            );
            if (idx < 0) return { data: null, error: null };
            const updated = { ...mockDb.rows[idx], ...patch, updated_at: nextVersion() };
            mockDb.rows[idx] = updated;
            return { data: { ...updated }, error: null };
          },
        };
      },
    };
    return q;
  }

  return {
    supabase: {
      auth: {
        getSession: async function (this: any) {
          const r = await this.getUser();
          return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
        },
        getUser: jest.fn(async () => ({ data: { user: mockDb.user }, error: null })),
      },
      from: () => ({ select, update }),
    },
  };
});

import * as focusTaskRepo from '../../repositories/focusTaskRepository';
import {
  addFocusTaskProgress,
  creditFocusTaskForSession,
  creditOf,
  fetchAllFocusTasks,
  fetchFocusTaskProgress,
} from '../../repositories/focusTaskRepository';

beforeEach(() => {
  mockDb.rows = [];
  mockDb.error = null;
  mockDb.user = { id: 'u1' };
  mockDb.beforeUpdate = null;
  mockDb.updateEqs = [];
  mockDb.tick = 0;
});

describe('fetchAllFocusTasks', () => {
  it('returns tasks for the current user, oldest first', async () => {
    mockDb.rows = [
      { id: 't2', user_id: 'u1', title: 'B', created_at: '2026-08-02' },
      { id: 't1', user_id: 'u1', title: 'A', created_at: '2026-08-01' },
      { id: 't3', user_id: 'u2', title: 'C', created_at: '2026-08-01' },
    ];
    const res = await fetchAllFocusTasks();
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.data.map((r) => r.id)).toEqual(['t1', 't2']);
  });

  it('surfaces an error instead of swallowing it', async () => {
    mockDb.error = { message: 'boom' };
    const res = await fetchAllFocusTasks();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('boom');
  });

  it('fails explicitly when unauthenticated', async () => {
    mockDb.user = null;
    const res = await fetchAllFocusTasks();
    expect(res.ok).toBe(false);
  });
});

describe('F16 (REP-11, INT-09) — conditional progress and session crediting', () => {
  it('does not export the removed absolute-overwrite setFocusTaskProgress', () => {
    expect('setFocusTaskProgress' in focusTaskRepo).toBe(false);
  });

  it('addFocusTaskProgress increments fresh server counters with updated_at CAS', async () => {
    mockDb.rows = [
      {
        id: 'ft1',
        user_id: 'u1',
        completed: false,
        estimated_pomodoros: 4,
        completed_pomodoros: 2,
        total_focus_seconds: 3000,
        updated_at: '2026-10-01T10:00:00.000Z',
      },
    ];
    const res = await addFocusTaskProgress({ id: 'ft1', pomodoros: 1, seconds: 1500 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.completed_pomodoros).toBe(3);
      expect(res.data.total_focus_seconds).toBe(4500);
    }
    expect(mockDb.updateEqs).toEqual([
      { id: 'ft1', user_id: 'u1', updated_at: '2026-10-01T10:00:00.000Z' },
    ]);
  });

  it('retries on a concurrent updated_at shift and adds onto the NEW server value, never the stale read', async () => {
    mockDb.rows = [
      {
        id: 'ft1',
        user_id: 'u1',
        completed: false,
        estimated_pomodoros: 6,
        completed_pomodoros: 2,
        total_focus_seconds: 3000,
        updated_at: 'v1',
      },
    ];
    let raced = false;
    mockDb.beforeUpdate = () => {
      if (!raced) {
        raced = true;
        mockDb.rows[0] = {
          ...mockDb.rows[0],
          completed_pomodoros: 4,
          total_focus_seconds: 6000,
          updated_at: 'v2-other-device',
        };
      }
    };

    const res = await addFocusTaskProgress({ id: 'ft1', pomodoros: 1, seconds: 1500 });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.completed_pomodoros).toBe(5);
      expect(res.data.total_focus_seconds).toBe(7500);
    }
    expect(mockDb.updateEqs).toHaveLength(2);
    expect(mockDb.updateEqs[0].updated_at).toBe('v1');
    expect(mockDb.updateEqs[1].updated_at).toBe('v2-other-device');
  });

  it('fails with CAS_EXHAUSTED after 3 consecutive version shifts without overwriting', async () => {
    mockDb.rows = [
      {
        id: 'ft1',
        user_id: 'u1',
        completed: false,
        estimated_pomodoros: 4,
        completed_pomodoros: 1,
        total_focus_seconds: 1500,
        updated_at: 'v0',
      },
    ];
    let n = 0;
    mockDb.beforeUpdate = () => {
      n += 1;
      mockDb.rows[0] = { ...mockDb.rows[0], completed_pomodoros: 1 + n, updated_at: `v-race-${n}` };
    };

    const res = await addFocusTaskProgress({ id: 'ft1', pomodoros: 1, seconds: 1500 });
    expect(res).toMatchObject({ ok: false, code: 'CAS_EXHAUSTED' });
    expect(mockDb.updateEqs).toHaveLength(3);
  });

  it('returns not-found when the task is missing or owned by another user', async () => {
    const missing = await addFocusTaskProgress({ id: 'gone', pomodoros: 1, seconds: 1500 });
    expect(missing).toEqual({ ok: false, error: 'Odak görevi bulunamadı.' });

    mockDb.rows = [
      {
        id: 'ft-other',
        user_id: 'u2',
        completed: false,
        estimated_pomodoros: 2,
        completed_pomodoros: 0,
        total_focus_seconds: 0,
        updated_at: 'v1',
      },
    ];
    const foreign = await addFocusTaskProgress({ id: 'ft-other', pomodoros: 1, seconds: 1500 });
    expect(foreign).toEqual({ ok: false, error: 'Odak görevi bulunamadı.' });
    expect(await fetchFocusTaskProgress('ft-other')).toEqual({ ok: true, data: null });
  });

  it('creditOf accepts only completed work sessions with a non-empty task_id', () => {
    expect(creditOf({ mode: 'work', completed: true, task_id: 'ft1', completed_seconds: 1500 })).toEqual({
      taskId: 'ft1',
      seconds: 1500,
    });
    expect(creditOf({ mode: 'work', completed: false, task_id: 'ft1', completed_seconds: 1200 })).toBeNull();
    expect(creditOf({ mode: 'shortBreak', completed: true, task_id: 'ft1', completed_seconds: 300 })).toBeNull();
    expect(creditOf({ mode: 'work', completed: true, task_id: null, completed_seconds: 1500 })).toBeNull();
    expect(creditOf({ mode: 'work', completed: true, task_id: '', completed_seconds: 1500 })).toBeNull();
    expect(creditOf({ mode: 'work', completed: true, task_id: 'ft1', completed_seconds: -20 })).toEqual({
      taskId: 'ft1',
      seconds: 0,
    });
    expect(creditOf({ mode: 'work', completed: true, task_id: 'ft1', completed_seconds: Number.NaN })).toEqual({
      taskId: 'ft1',
      seconds: 0,
    });
  });

  it('creditFocusTaskForSession skips non-creditable rows and credits completed work rows', async () => {
    expect(await creditFocusTaskForSession({ mode: 'work', completed: false, task_id: 'ft1', completed_seconds: 900 })).toBeNull();
    expect(mockDb.updateEqs).toHaveLength(0);

    mockDb.rows = [
      {
        id: 'ft1',
        user_id: 'u1',
        completed: false,
        estimated_pomodoros: 2,
        completed_pomodoros: 0,
        total_focus_seconds: 0,
        updated_at: 'v1',
      },
    ];
    const res = await creditFocusTaskForSession({ mode: 'work', completed: true, task_id: 'ft1', completed_seconds: 1500 });
    expect(res).toMatchObject({ ok: true, data: { completed_pomodoros: 1, total_focus_seconds: 1500 } });
  });
});
