/**
 * L1 tests for the willpower midnight rollover.  (task 1C-003)
 *
 * AC-W01  isStale() compares the cached day against the LOCAL day
 * AC-W02  a stale budget cannot authorise an activation
 * AC-W03  a stale budget does not report yesterday's score
 * AC-W04  spend() never writes to yesterday's row
 * AC-W05  spend() rolls over first, then charges today
 * AC-W06  refund() behaves the same way
 *
 * The store caches one willpower_state row keyed by state_date and never
 * invalidates it. Leave the app open past local midnight and every read is
 * yesterday's: a user who spent their whole budget yesterday cannot activate
 * anything today.
 *
 * AC-W04 is the damaging one. spend() filters its UPDATE on
 * .eq('state_date', s.state_date) -- the CACHED day. After midnight that
 * mutates a past day's record, so today's budget never records the spend and
 * yesterday's history is silently rewritten.
 *
 * NOT covered here, and not claimed: spend() is still a client-side
 * read-modify-write, so two concurrent taps can both read used=4 and both
 * write 6. That is 1C-001 (an atomic debit RPC), it needs the live database,
 * and it is untouched by this task.
 *
 * Written BEFORE the fix and observed to fail, per R-01.
 */
type Row = {
  user_id: string; state_date: string; daily_budget: number;
  used: number; focus_capacity: number; active_count: number;
};

const mockDb = {
  /** Rows keyed by state_date. */
  rows: [] as Row[],
  /** Every UPDATE the store issued, with the day it targeted. */
  updates: [] as { state_date: string; patch: Record<string, unknown> }[],
  inserted: [] as Row[],
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      // The data layer resolves the user id from the LOCAL session -- see
      // `repositories/shared.currentUserId`. Derived from this mock's own
      // getUser so the two can never disagree.
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
       getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => {
        const f: Record<string, unknown> = {};
        const q: any = {
          eq(col: string, val: unknown) { f[col] = val; return q; },
          async single() {
            const row = mockDb.rows.find((r) => r.state_date === f.state_date);
            return row
              ? { data: row, error: null }
              : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
          },
          // `willpowerRepository.fetchOrCreateWillpowerState` uses
          // `maybeSingle()`: an absent row is a normal outcome (a new day),
          // not the PGRST116 error `single()` raises.
          async maybeSingle() {
            const row = mockDb.rows.find((r) => r.state_date === f.state_date);
            return { data: row ?? null, error: null };
          },
        };
        return q;
      },
      upsert(row: Row) {
        return {
          select: () => ({
            single: async () => {
              mockDb.rows.push(row);
              mockDb.inserted.push(row);
              return { data: row, error: null };
            },
          }),
        };
      },
      update(patch: Record<string, unknown>) {
        const f: Record<string, unknown> = {};
        const apply = () => {
          // Recorded here, not only in `then()`: the repository terminates
          // with `.select().maybeSingle()`, so this is the path the store
          // actually takes now and the assertions read `mockDb.updates`.
          mockDb.updates.push({ state_date: String(f.state_date), patch });
          const row = mockDb.rows.find((r) => Object.entries(f)
            .every(([k, v]) => (r as Record<string, unknown>)[k] === v));
          if (row) Object.assign(row, patch);
          return row ?? null;
        };
        const u: any = {
          select: () => ({ maybeSingle: async () => ({ data: apply(), error: null }) }),
          eq(col: string, val: unknown) { f[col] = val; return u; },
          then(onOk: (v: unknown) => unknown) {
            mockDb.updates.push({ state_date: String(f.state_date), patch });
            const row = mockDb.rows.find((r) => r.state_date === f.state_date);
            if (row) Object.assign(row, patch);
            return Promise.resolve({ data: null, error: null }).then(onOk);
          },
        };
        return u;
      },
    }),
  },
}));

import { useWillpowerStore } from '../../store/willpowerStore';

const YESTERDAY = '2026-08-03';
const TODAY = '2026-08-04';

/** 2026-08-04 01:00 local (UTC+3) -- a new local day, still 08-03 in UTC. */
const AFTER_MIDNIGHT = new Date(2026, 7, 4, 1, 0, 0);

function row(over: Partial<Row> = {}): Row {
  return {
    user_id: 'u1', state_date: YESTERDAY, daily_budget: 15,
    used: 12, focus_capacity: 3, active_count: 2, ...over,
  };
}

beforeEach(() => {
  mockDb.rows = [];
  mockDb.updates = [];
  mockDb.inserted = [];
  useWillpowerStore.setState({ state: null, loading: false });
  jest.useFakeTimers();
  jest.setSystemTime(AFTER_MIDNIGHT);
});
afterEach(() => { jest.useRealTimers(); });

describe('AC-W01 -- staleness is measured against the local day', () => {
  it('is stale when the cached row is yesterday', () => {
    useWillpowerStore.setState({ state: row() as never });
    expect(useWillpowerStore.getState().isStale()).toBe(true);
  });

  it('is not stale when the cached row is today', () => {
    useWillpowerStore.setState({ state: row({ state_date: TODAY }) as never });
    expect(useWillpowerStore.getState().isStale()).toBe(false);
  });

  it('treats an empty cache as stale', () => {
    expect(useWillpowerStore.getState().isStale()).toBe(true);
  });
});

describe('AC-W02/W03 -- a stale budget is not used for decisions', () => {
  it('refuses to authorise an activation from yesterday numbers', () => {
    // used 12 of 15, 2 of 3 slots: yesterday this would have allowed a cost of 3.
    useWillpowerStore.setState({ state: row() as never });
    expect(useWillpowerStore.getState().canActivate(3)).toBe(false);
  });

  it('still authorises when the cached row really is today', () => {
    useWillpowerStore.setState({ state: row({ state_date: TODAY }) as never });
    expect(useWillpowerStore.getState().canActivate(3)).toBe(true);
  });

  // plan/01:661 -- "score() returns a loading state, not 100, when state is null".
  // The first implementation returned 100 for both the null and the stale case,
  // which shows the user a fabricated "100% willpower" they never had. 100 is a
  // real reading; absence of a reading is not 100.
  it('returns null, not a fabricated 100, when the cache is stale', () => {
    useWillpowerStore.setState({ state: row() as never });          // 12/15 spent
    expect(useWillpowerStore.getState().score()).toBeNull();
  });

  it('returns null when there is no state at all', () => {
    useWillpowerStore.setState({ state: null });
    expect(useWillpowerStore.getState().score()).toBeNull();
  });

  it('returns a real number when the row really is today', () => {
    useWillpowerStore.setState({ state: row({ state_date: TODAY }) as never });
    expect(useWillpowerStore.getState().score()).toBe(20);          // (15-12)/15
  });

  it('still returns 100 for a fresh day with a zero budget', () => {
    useWillpowerStore.setState({ state: row({ state_date: TODAY, daily_budget: 0 }) as never });
    expect(useWillpowerStore.getState().score()).toBe(100);
  });
});

describe('AC-W04/W05 -- spend never charges the wrong day', () => {
  it('does not update yesterday row', async () => {
    mockDb.rows.push(row());                                        // dünkü satır
    useWillpowerStore.setState({ state: row() as never });

    await useWillpowerStore.getState().spend(2);

    expect(mockDb.updates.map((u) => u.state_date)).not.toContain(YESTERDAY);
  });

  it('rolls over and charges today', async () => {
    mockDb.rows.push(row());
    useWillpowerStore.setState({ state: row() as never });

    await useWillpowerStore.getState().spend(2);

    // Bugün için taze satır açılmalı ve harcama ona yazılmalı.
    expect(mockDb.inserted.map((r) => r.state_date)).toContain(TODAY);
    expect(mockDb.updates.map((u) => u.state_date)).toEqual([TODAY]);
    const today = mockDb.rows.find((r) => r.state_date === TODAY);
    expect(today?.used).toBe(2);            // dünün 12'si taşınmaz
    expect(today?.active_count).toBe(1);
    expect(useWillpowerStore.getState().state?.state_date).toBe(TODAY);
  });

  it('leaves yesterday row exactly as it was', async () => {
    mockDb.rows.push(row());
    useWillpowerStore.setState({ state: row() as never });

    await useWillpowerStore.getState().spend(2);

    const yesterday = mockDb.rows.find((r) => r.state_date === YESTERDAY);
    expect(yesterday?.used).toBe(12);
    expect(yesterday?.active_count).toBe(2);
  });
});

describe('AC-W06 -- refund behaves the same way', () => {
  it('does not credit yesterday row', async () => {
    mockDb.rows.push(row());
    useWillpowerStore.setState({ state: row() as never });

    await useWillpowerStore.getState().refund(2);

    expect(mockDb.updates.map((u) => u.state_date)).not.toContain(YESTERDAY);
    const yesterday = mockDb.rows.find((r) => r.state_date === YESTERDAY);
    expect(yesterday?.used).toBe(12);
  });
});
