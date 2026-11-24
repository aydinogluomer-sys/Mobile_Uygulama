/**
 * F14 behavioural tests for atomic `spend_willpower` RPC, session-sticky
 * `missing_rpc` fallback, single-flight `fetchOrCreateWillpowerState`, and
 * `willpowerStore.score()` bounds.
 * (REP-08, REP-09, STO-15)
 */
type Row = {
  user_id: string;
  state_date: string;
  daily_budget: number;
  used: number;
  focus_capacity: number;
  active_count: number;
};

const mockState = {
  userId: 'u1' as string | null,
  rows: [] as Row[],
  rpcCalls: [] as { fn: string; args: Record<string, unknown> }[],
  upsertCalls: 0,
  selectCalls: 0,
  updateCalls: [] as { state_date: string; patch: Record<string, unknown> }[],
  rpcResponder: null as null | ((args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown; status?: number }>),
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: mockState.userId
            ? { user: { id: mockState.userId }, access_token: 'test-jwt' }
            : null,
        },
      }),
      getUser: async () => ({
        data: { user: mockState.userId ? { id: mockState.userId } : null },
      }),
    },
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockState.rpcCalls.push({ fn, args });
      if (mockState.rpcResponder) return mockState.rpcResponder(args);
      const day = String(args.p_day);
      const amt = Number(args.p_amount);
      const delta = args.p_active_delta == null ? Math.sign(amt) : Number(args.p_active_delta);
      const clamp = Boolean(args.p_clamp);
      let row = mockState.rows.find((r) => r.user_id === mockState.userId && r.state_date === day);
      if (!row) {
        row = {
          user_id: mockState.userId ?? 'u1',
          state_date: day,
          daily_budget: 15,
          used: 0,
          focus_capacity: 3,
          active_count: 0,
        };
        mockState.rows.push(row);
      }
      if (amt > 0 && !clamp && row.used + amt > row.daily_budget) {
        return Promise.resolve({
          data: null,
          error: { code: 'P0001', message: 'willpower_budget_exceeded' },
          status: 400,
        });
      }
      row.used = clamp && amt > 0
        ? Math.max(row.used, Math.min(row.daily_budget, row.used + amt))
        : Math.max(0, row.used + amt);
      row.active_count = Math.max(0, row.active_count + delta);
      return Promise.resolve({ data: { ...row }, error: null, status: 200 });
    },
    from: () => ({
      upsert: (payload: Row, _opts?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        mockState.upsertCalls += 1;
        const exists = mockState.rows.some(
          (r) => r.user_id === payload.user_id && r.state_date === payload.state_date,
        );
        if (!exists) mockState.rows.push({ ...payload });
        return Promise.resolve({ data: null, error: null, status: 201 });
      },
      select: () => {
        mockState.selectCalls += 1;
        const filters: Record<string, unknown> = {};
        const q: Record<string, unknown> = {
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return q;
          },
          maybeSingle: async () => {
            const hit = mockState.rows.find(
              (r) => r.user_id === filters.user_id && r.state_date === filters.state_date,
            );
            return { data: hit ? { ...hit } : null, error: null, status: 200 };
          },
        };
        return q;
      },
      update: (patch: Record<string, unknown>) => {
        const filters: Record<string, unknown> = {};
        const q: Record<string, unknown> = {
          eq: (col: string, val: unknown) => {
            filters[col] = val;
            return q;
          },
          select: () => ({
            maybeSingle: async () => {
              mockState.updateCalls.push({ state_date: String(filters.state_date), patch });
              const hit = mockState.rows.find(
                (r) => r.user_id === filters.user_id && r.state_date === filters.state_date,
              );
              if (hit) Object.assign(hit, patch);
              return { data: hit ? { ...hit } : null, error: null, status: 200 };
            },
          }),
        };
        return q;
      },
    }),
  },
}));

import { endAccountScope } from '../../lib/accountScope';
import {
  fetchOrCreateWillpowerState,
  resetWillpowerRepositoryMemory,
  spendWillpower,
} from '../../repositories/willpowerRepository';
import { useWillpowerStore } from '../../store/willpowerStore';

const TODAY = '2026-10-10';
const YESTERDAY = '2026-10-09';

beforeEach(() => {
  mockState.userId = 'u1';
  mockState.rows = [];
  mockState.rpcCalls = [];
  mockState.upsertCalls = 0;
  mockState.selectCalls = 0;
  mockState.updateCalls = [];
  mockState.rpcResponder = null;
  resetWillpowerRepositoryMemory();
  useWillpowerStore.setState({ state: null, loading: false });
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 9, 10, 10, 0, 0));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('atomic spend_willpower RPC + fallback + score bounds', () => {
  it('accumulates consecutive spends from the server row without client RMW loss', async () => {
    mockState.rows.push({
      user_id: 'u1',
      state_date: TODAY,
      daily_budget: 15,
      used: 0,
      focus_capacity: 3,
      active_count: 0,
    });
    useWillpowerStore.setState({ state: { ...mockState.rows[0] } as never });

    await useWillpowerStore.getState().spend(3);
    await useWillpowerStore.getState().spend(4);

    expect(mockState.rpcCalls).toHaveLength(2);
    expect(mockState.updateCalls).toHaveLength(0);
    expect(useWillpowerStore.getState().state).toMatchObject({
      state_date: TODAY,
      used: 7,
      active_count: 2,
    });
  });

  it('falls back to updateWillpowerState on PGRST202 and remembers missing RPC for the session until account reset', async () => {
    mockState.rpcResponder = async () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.spend_willpower' },
      status: 404,
    });
    mockState.rows.push({
      user_id: 'u1',
      state_date: TODAY,
      daily_budget: 15,
      used: 2,
      focus_capacity: 3,
      active_count: 1,
    });
    useWillpowerStore.setState({ state: { ...mockState.rows[0] } as never });

    await useWillpowerStore.getState().spend(3);
    await useWillpowerStore.getState().refund(2);

    // RPC probed once, then skipped on second call in the same session
    expect(mockState.rpcCalls).toHaveLength(1);
    expect(mockState.updateCalls).toHaveLength(2);
    expect(useWillpowerStore.getState().state).toMatchObject({ used: 3, active_count: 1 });

    // Account boundary clears the sticky flag
    await endAccountScope('signed_out', 'u1');
    mockState.rpcResponder = null;
    mockState.rows = [{
      user_id: 'u1',
      state_date: TODAY,
      daily_budget: 15,
      used: 0,
      focus_capacity: 3,
      active_count: 0,
    }];
    useWillpowerStore.setState({ state: { ...mockState.rows[0] } as never });
    await useWillpowerStore.getState().spend(4);
    expect(mockState.rpcCalls).toHaveLength(2);
  });

  it('coalesces concurrent fetchOrCreateWillpowerState calls per (userId, date) without leaking across users', async () => {
    const [a, b] = await Promise.all([
      fetchOrCreateWillpowerState(TODAY),
      fetchOrCreateWillpowerState(TODAY),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(mockState.upsertCalls).toBe(1);
    expect(mockState.selectCalls).toBe(1);
  });

  it('clamps score() into [0, 100] and returns null on non-finite numbers', () => {
    useWillpowerStore.setState({
      state: { user_id: 'u1', state_date: TODAY, daily_budget: 15, used: 25, focus_capacity: 3, active_count: 1 } as never,
    });
    expect(useWillpowerStore.getState().score()).toBe(0);

    useWillpowerStore.setState({
      state: { user_id: 'u1', state_date: TODAY, daily_budget: 15, used: -5, focus_capacity: 3, active_count: 0 } as never,
    });
    expect(useWillpowerStore.getState().score()).toBe(100);

    useWillpowerStore.setState({
      state: { user_id: 'u1', state_date: TODAY, daily_budget: Number.NaN, used: 0, focus_capacity: 3, active_count: 0 } as never,
    });
    expect(useWillpowerStore.getState().score()).toBeNull();
  });

  it('negative: leaves local state untouched on budget_exceeded and on offline transport failure, and rolls over stale day first', async () => {
    const initial: Row = {
      user_id: 'u1',
      state_date: TODAY,
      daily_budget: 15,
      used: 12,
      focus_capacity: 3,
      active_count: 2,
    };
    mockState.rows.push({ ...initial });
    useWillpowerStore.setState({ state: { ...initial } as never });

    // Overshoot (12 + 5 > 15) -> server refuses P0001, store stays at 12
    await useWillpowerStore.getState().spend(5);
    expect(useWillpowerStore.getState().state).toMatchObject({ used: 12, active_count: 2 });

    // Offline (status 0) -> offline: true in repository, store stays at 12
    mockState.rpcResponder = async () => ({
      data: null,
      error: { message: 'TypeError: Network request failed', code: '' },
      status: 0,
    });
    const offlineRes = await spendWillpower({ day: TODAY, amount: 2 });
    expect(offlineRes).toMatchObject({ ok: false, offline: true });

    await useWillpowerStore.getState().spend(2);
    expect(useWillpowerStore.getState().state).toMatchObject({ used: 12, active_count: 2 });

    // Stale cached day -> rolls over via fetchToday before calling spend_willpower
    mockState.rpcResponder = null;
    mockState.rows = [{
      user_id: 'u1',
      state_date: YESTERDAY,
      daily_budget: 15,
      used: 14,
      focus_capacity: 3,
      active_count: 3,
    }];
    useWillpowerStore.setState({ state: { ...mockState.rows[0] } as never });
    await useWillpowerStore.getState().spend(4);
    expect(mockState.rpcCalls.at(-1)?.args.p_day).toBe(TODAY);
    expect(useWillpowerStore.getState().state).toMatchObject({ state_date: TODAY, used: 4, active_count: 1 });
  });
});
