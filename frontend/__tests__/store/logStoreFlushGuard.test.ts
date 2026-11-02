/**
 * §18 — `flushPendingSync` re-entrancy.  (Phase 4)
 *
 * THE DEFECT THIS GUARDS, precisely. `flushPendingSync` reads
 * `orderedPending(queueState)` at the START of a pass. Two overlapping passes
 * therefore each capture the SAME op and each run it. Nothing crashes and no
 * duplicate row appears — `serialise` chains the two attempts, so the second
 * observes the row the first created and takes the UPDATE branch, and the
 * `markSynced`/`markFailed` it then applies lands on an op that is already
 * gone. What is left is a second, entirely pointless round trip per queued op
 * on every flush, run against a connection that has just come back and is
 * usually the slowest it will be all session.
 *
 * That makes the observable invariant "ONE write attempt per queued op per
 * pass", not "no duplicate rows" — a duplicate-row assertion would pass
 * without the guard and prove nothing.
 *
 * There are now two independent flush triggers (`app/_layout.tsx`: boot, and
 * `AppState -> 'active'`), so the overlap below is not hypothetical: an app
 * foregrounded while its boot flush is still in flight produces exactly it.
 *
 * AC-G01  two overlapping flushes make ONE write attempt, not two
 * AC-G02  both callers still get the real results (coalesced, not skipped)
 * AC-G03  the guard is RELEASED when the pass settles — a later flush works
 * AC-G04  the guard is released after a FAILING pass too (no permanent wedge)
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { enqueue as enqueueOp, emptyQueueState, saveSyncQueue } from '../../lib/syncQueue';

type Row = {
  id: string; habit_id: string; user_id: string; completed_at: string;
  value: number | null; is_completed: boolean; state: string;
  xp: number | null; created_at: string;
};
type PgError = { message: string; code?: string };

const mockDb = {
  calls: [] as string[],
  rows: [] as Row[],
  idSeq: 0,
  insertError: null as PgError | null,
};

jest.mock('../../lib/supabase', () => {
  const match = (filters: Record<string, unknown>) =>
    mockDb.rows.filter((r) =>
      Object.entries(filters).every(
        ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));

  return {
    supabase: {
      auth: {
      // The data layer resolves the user id from the LOCAL session -- see
      // `repositories/shared.currentUserId`. Derived from this mock's own
      // getUser so the two can never disagree.
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
       getUser: jest.fn().mockImplementation(async () => ({ data: { user: { id: 'u1' } } })) },
      from: () => ({
        select: () => {
          const filters: Record<string, unknown> = {};
          const q = {
            eq(col: string, val: unknown) { filters[col] = val; return q; },
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
                if (mockDb.insertError) return { data: null, error: mockDb.insertError };
                const dup = mockDb.rows.find((r) =>
                  r.habit_id === payload.habit_id && r.completed_at === payload.completed_at);
                if (dup) {
                  return {
                    data: null,
                    error: { message: 'duplicate key value violates unique constraint', code: '23505' },
                  };
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

const DATE_STR = '2026-08-04';
const OTHER_DATE = '2026-08-05';

/** Counts only calls that WRITE — `select` is the 23505 recovery lookup. */
const writeCalls = () => mockDb.calls.filter((c) => c === 'insert' || c === 'update');

async function queueOne(habitId: string, date: string) {
  const persisted = enqueueOp(emptyQueueState(), habitId, date, { state: 'done', baseXp: 30 });
  await saveSyncQueue(persisted.state, 'u1');
  await useLogStore.getState().hydrateSyncQueue();
}

beforeEach(async () => {
  mockDb.calls.length = 0;
  mockDb.rows.length = 0;
  mockDb.idSeq = 0;
  mockDb.insertError = null;
  await AsyncStorage.clear();
  useLogStore.setState({ logs: [], loading: false, pendingSyncCount: 0, deadSyncCount: 0 });
  await useLogStore.getState().hydrateSyncQueue();
});

describe('AC-G01 / AC-G02 — two overlapping flushes make one pass', () => {
  it('performs exactly ONE write attempt for one queued op', async () => {
    await queueOne('guard-1', DATE_STR);

    // Both started before either settles — the boot/foreground overlap.
    const first = useLogStore.getState().flushPendingSync();
    const second = useLogStore.getState().flushPendingSync();
    const [a, b] = await Promise.all([first, second]);

    expect(writeCalls()).toEqual(['insert']);
    expect(mockDb.rows).toHaveLength(1);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);

    // Coalesced, not skipped: the second caller got the real outcome, so a
    // caller that awaits the flush before, say, refreshing a list is not
    // told "nothing was owed".
    expect(a).toHaveLength(1);
    expect(a[0].ok).toBe(true);
    expect(b).toEqual(a);
  });

  it('three overlapping flushes over two queued ops still write each op once', async () => {
    let state = enqueueOp(emptyQueueState(), 'guard-2', DATE_STR, { state: 'done', baseXp: 30 }).state;
    state = enqueueOp(state, 'guard-3', OTHER_DATE, { state: 'done', baseXp: 30 }).state;
    await saveSyncQueue(state, 'u1');
    await useLogStore.getState().hydrateSyncQueue();

    await Promise.all([
      useLogStore.getState().flushPendingSync(),
      useLogStore.getState().flushPendingSync(),
      useLogStore.getState().flushPendingSync(),
    ]);

    expect(writeCalls()).toEqual(['insert', 'insert']);
    expect(mockDb.rows).toHaveLength(2);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
  });
});

describe('AC-G03 — the guard releases when the pass settles', () => {
  it('a flush after a completed flush still runs', async () => {
    await queueOne('guard-4', DATE_STR);
    await useLogStore.getState().flushPendingSync();
    expect(writeCalls()).toEqual(['insert']);

    // A genuinely new op, queued after the first pass finished.
    await queueOne('guard-5', OTHER_DATE);
    await useLogStore.getState().flushPendingSync();

    expect(writeCalls()).toEqual(['insert', 'insert']);
    expect(mockDb.rows).toHaveLength(2);
  });

  it('a flush over an empty queue neither writes nor wedges the guard', async () => {
    await useLogStore.getState().flushPendingSync();
    expect(writeCalls()).toEqual([]);

    await queueOne('guard-6', DATE_STR);
    await useLogStore.getState().flushPendingSync();
    expect(writeCalls()).toEqual(['insert']);
  });
});

describe('AC-G04 — a failing pass releases the guard too', () => {
  it('a rejected pass does not lock out every later flush', async () => {
    await queueOne('guard-7', DATE_STR);
    mockDb.insertError = { message: 'RLS denied' };

    const failed = await useLogStore.getState().flushPendingSync();
    expect(failed[0].ok).toBe(false);
    expect(useLogStore.getState().pendingSyncCount).toBe(1); // still owed

    // The server recovers; the op must be retryable rather than stranded
    // behind a guard that was never cleared.
    mockDb.insertError = null;
    const retried = await useLogStore.getState().flushPendingSync(Date.now() + 10 * 60_000);

    expect(retried[0].ok).toBe(true);
    expect(mockDb.rows).toHaveLength(1);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
  });
});

describe('F05 -- an owner change does not break the guard', () => {
  it('a flush started after a rebind is a new pass, and the old pass cannot clear it', async () => {
    await queueOne('guard-f05', DATE_STR);
    const first = useLogStore.getState().flushPendingSync();
    // the same account signs in again (a token refresh): a no-op that must not disturb the pass
    await useLogStore.getState().rebindSyncQueue('u1');
    expect(useLogStore.getState().flushPendingSync()).toBe(first);
    await first;
    expect(writeCalls()).toEqual(['insert']);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
  });
});
