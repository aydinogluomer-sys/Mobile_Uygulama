/**
 * L1 tests for stale-row invisibility.  (task 1C-007, finding N-07)
 *
 * AC-Y01  a day change clears the cached row
 * AC-Y02  a day change triggers a refetch, not just a clear
 * AC-Y03  a row that is still today's is left alone
 * AC-Y04  returning to the foreground re-evaluates immediately
 *
 * 1C-003 guarded the store's METHODS. It did not guard the `state` FIELD, and
 * every consumer reads that field directly -- today.tsx:279, habits.tsx:191,
 * timeline.tsx:559, WillpowerBand.tsx:27, and HabitOnboarding's prop. Nothing
 * re-triggered a fetch when the local day changed, because fetchToday() runs on
 * mount and pull-to-refresh only. An app left open past local midnight kept
 * rendering yesterday's budget.
 *
 * The fix makes staleness impossible to OBSERVE rather than asking six screens
 * to remember to check. That is why these tests assert on `state` itself and
 * not on any screen.
 *
 * Written BEFORE the fix and observed to fail, per R-01.
 */
type Row = {
  user_id: string; state_date: string; daily_budget: number;
  used: number; focus_capacity: number; active_count: number;
};

const mockDb = {
  rows: [] as Row[],
  selects: 0,
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
            mockDb.selects += 1;
            const row = mockDb.rows.find((r) => r.state_date === f.state_date);
            return row
              ? { data: row, error: null }
              : { data: null, error: { code: 'PGRST116', message: 'no rows' } };
          },
          // The repository uses maybeSingle(): a missing row for a new day is
          // an expected outcome, not the PGRST116 error single() raises.
          async maybeSingle() {
            mockDb.selects += 1;
            const row = mockDb.rows.find((r) => r.state_date === f.state_date);
            return { data: row ?? null, error: null };
          },
        };
        return q;
      },
      upsert(row: Row) {
        return {
          select: () => ({
            single: async () => { mockDb.rows.push(row); return { data: row, error: null }; },
          }),
        };
      },
      update() {
        const u = { eq() { return u; }, then(ok: (v: unknown) => unknown) { return Promise.resolve({ error: null }).then(ok); } };
        return u;
      },
    }),
  },
}));

import { AppState } from 'react-native';
import { useWillpowerStore } from '../../store/willpowerStore';

const D3 = '2026-08-03';
const D4 = '2026-08-04';

function row(state_date: string): Row {
  return { user_id: 'u1', state_date, daily_budget: 15, used: 12, focus_capacity: 3, active_count: 2 };
}

/** Let queued microtasks (the refetch) settle under fake timers. */
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  mockDb.rows = [];
  mockDb.selects = 0;
  useWillpowerStore.setState({ state: null, loading: false });
  jest.useFakeTimers();
});
afterEach(() => { jest.useRealTimers(); });

describe('AC-Y01/Y02 -- crossing local midnight', () => {
  it('stops exposing yesterday row and refetches', async () => {
    jest.setSystemTime(new Date(2026, 7, 3, 23, 59, 0));
    mockDb.rows.push(row(D3));
    await useWillpowerStore.getState().fetchToday();
    expect(useWillpowerStore.getState().state?.state_date).toBe(D3);

    // Yerel gün değişti. Hiçbir ekran bir şey sormuyor.
    jest.setSystemTime(new Date(2026, 7, 4, 0, 1, 0));
    mockDb.rows.push(row(D4));
    const before = mockDb.selects;

    jest.advanceTimersByTime(60_000);
    await flush();

    const s = useWillpowerStore.getState().state;
    expect(s?.state_date).not.toBe(D3);          // dünün satırı artık görünmüyor
    expect(mockDb.selects).toBeGreaterThan(before); // yalnızca temizlemedi, yeniden çekti
  });
});

describe('AC-Y03 -- a row that is still today stays', () => {
  it('does not clear or refetch within the same day', async () => {
    jest.setSystemTime(new Date(2026, 7, 4, 9, 0, 0));
    mockDb.rows.push(row(D4));
    await useWillpowerStore.getState().fetchToday();
    const before = mockDb.selects;

    jest.setSystemTime(new Date(2026, 7, 4, 23, 0, 0));
    jest.advanceTimersByTime(60_000);
    await flush();

    expect(useWillpowerStore.getState().state?.state_date).toBe(D4);
    expect(mockDb.selects).toBe(before);
  });
});

describe('AC-Y04 -- foreground re-evaluates without waiting for the timer', () => {
  it('reacts to an AppState change to active', async () => {
    jest.setSystemTime(new Date(2026, 7, 3, 23, 59, 0));
    mockDb.rows.push(row(D3));
    await useWillpowerStore.getState().fetchToday();

    jest.setSystemTime(new Date(2026, 7, 4, 8, 0, 0));
    mockDb.rows.push(row(D4));

    // Uygulama arka plandan dönüyor. Zamanlayıcıyı beklemeden kontrol etmeli:
    // telefon gece boyunca uykudayken interval güvenilir çalışmaz.
    const calls = (AppState.addEventListener as jest.Mock).mock?.calls ?? [];
    const handlers = calls.filter((c: unknown[]) => c[0] === 'change').map((c: unknown[]) => c[1]);
    expect(handlers.length).toBeGreaterThan(0);
    for (const h of handlers) (h as (s: string) => void)('active');
    await flush();

    expect(useWillpowerStore.getState().state?.state_date).not.toBe(D3);
  });
});
