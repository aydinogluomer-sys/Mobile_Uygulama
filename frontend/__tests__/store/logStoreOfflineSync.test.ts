/**
 * Offline-first habit completion.  (Phase 4, plan §18)
 *
 * AC-O01  an offline tap updates local state IMMEDIATELY (optimistic),
 *         queues the write, and does not surface an error to the caller.
 * AC-O02  COLD START: the queue is persisted, the in-memory `chains` map
 *         (`store/logStore.ts`) is never touched for this key before replay
 *         runs, and replay against a row that ALREADY exists remotely
 *         resolves to an UPDATE -- not a duplicate row, not an error.
 * AC-O02b COLD START with no remote row yet: replay inserts exactly once.
 * AC-O03  N offline taps on the same (habit, day) collapse: exactly ONE
 *         write reaches the database, carrying the FINAL intended state.
 * AC-O04  a permanently failing (non-network) op reaches its terminal
 *         `dead` state after MAX_ATTEMPTS and a further flush does not
 *         attempt it again -- observable via `getSyncStatusFor`/`deadSyncCount`.
 * AC-O05  a corrupt persisted payload is discarded on hydrate, not thrown.
 * AC-O06  a REAL (non-network) rejection still surfaces `{ ok: false }` to
 *         the caller -- the 8a04c04 behaviour this task must not regress.
 *
 * Mirrors `store/logStore.test.ts`'s mock style (a fake `../../lib/supabase`
 * client) rather than reusing it, per this task's "no existing test file
 * changes" constraint -- this is a NEW file with its own mock DB, extended
 * with a `networkDown` switch (answers the way supabase-js really answers a
 * failed transport: a normal result with `status: 0` -- see `OFFLINE_RESULT`)
 * and a `networkThrows` switch for a call that genuinely throws, plus a
 * uniqueness check on
 * insert that mirrors the real `UNIQUE (habit_id, completed_at)` constraint
 * (`supabase/migrations/001_initial_schema.sql:34`) rather than requiring
 * the test to hand-inject a 23505 -- the whole point of AC-O02 is that the
 * constraint itself, not a manually staged error, is what replay reconciles
 * against.
 *
 * Written BEFORE the fix and observed to fail for the right reason on a
 * deliberately-broken stub (see the task report's "red-first evidence").
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MAX_ATTEMPTS } from '../../lib/outbox';
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
  /**
   * true => every DB call answers the way supabase-js ACTUALLY answers when
   * the transport fails: a normal result carrying an error and `status: 0`.
   * It does not throw. That was verified against the live project with the
   * app's own client:
   *
   *   { data: null,
   *     error: { message: 'TypeError: Network request failed', code: '' },
   *     status: 0 }
   *
   * This mock used to throw here, which is why `logStore.runAttempt`'s
   * `network` branch could pass its tests and still be unreachable on a real
   * device -- every offline tap was classified as a server REJECTION, burning
   * the MAX_ATTEMPTS budget until the op went `dead` and the user's logged
   * completion was dropped.
   */
  networkDown: false,
  /**
   * true => the call throws instead. Kept as a separate switch rather than
   * replaced: a thrown call is still possible (an adapter, a polyfill, an
   * `AbortError`), and `runAttempt`'s `catch` still has to handle it.
   */
  networkThrows: false,
  /** injects a non-uniqueness rejection, e.g. RLS/validation. */
  insertError: null as PgError | null,
  updateError: null as PgError | null,
  /** F05: the HTTP status that comes with `insertError` (e.g. 503); 0 = none, as before. */
  insertStatus: 0,
};

/** What a failed transport looks like coming back from supabase-js. */
const OFFLINE_RESULT = {
  data: null,
  error: { message: 'TypeError: Network request failed', details: '', hint: '', code: '' },
  status: 0,
  statusText: '',
};

jest.mock('../../lib/supabase', () => {
  const match = (filters: Record<string, unknown>) =>
    mockDb.rows.filter((r) =>
      Object.entries(filters).every(
        ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));

  return {
    supabase: {
      auth: {
        getSession: async function (this: any) {
        // The repository layer resolves the user id from the LOCAL session
        // rather than paying a network round trip per query. Derived from
        // this mock's own getUser so both stay in step.
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
        // Deliberately NOT affected by `networkDown`: `getSession()` reads
        // the persisted session locally, so being offline does not sign the
        // user out. Only an outright thrown call is simulated here.
        getUser: jest.fn().mockImplementation(async () => {
          if (mockDb.networkThrows) throw new TypeError('Network request failed');
          return { data: { user: { id: 'u1' } } };
        }),
      },
      from: () => ({
        select: () => {
          const filters: Record<string, unknown> = {};
          const q = {
            eq(col: string, val: unknown) { filters[col] = val; return q; },
            async maybeSingle() {
              if (mockDb.networkThrows) throw new TypeError('Network request failed');
              if (mockDb.networkDown) return OFFLINE_RESULT;
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
                if (mockDb.networkThrows) throw new TypeError('Network request failed');
                if (mockDb.networkDown) return OFFLINE_RESULT;
                mockDb.calls.push('insert');
                if (mockDb.insertError) {
                  const e = mockDb.insertError;
                  return { data: null, error: e, ...(mockDb.insertStatus ? { status: mockDb.insertStatus } : {}) };
                }
                // Mirrors the real UNIQUE (habit_id, completed_at) constraint
                // (supabase/migrations/001_initial_schema.sql:34) -- this is
                // what a cold-start replay must reconcile against, not a
                // manually staged error.
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
                if (mockDb.networkThrows) throw new TypeError('Network request failed');
                if (mockDb.networkDown) return OFFLINE_RESULT;
                mockDb.calls.push('update');
                if (mockDb.updateError) {
                  const e = mockDb.updateError;
                  return { data: null, error: e };
                }
                const row = mockDb.rows.find((r) => r.id === filters.id);
                if (!row) return { data: null, error: { message: 'no row' } };
                Object.assign(row, payload);
                return { data: row, error: null };
              },
              maybeSingle: async () => {
                if (mockDb.networkThrows) throw new TypeError('Network request failed');
                if (mockDb.networkDown) return OFFLINE_RESULT;
                mockDb.calls.push('update');
                if (mockDb.updateError) {
                  const e = mockDb.updateError;
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
import { pinToday } from '../helpers/pinnedClock';
import { resetAccountMemory } from '../../lib/accountScope';

const DAY = new Date(2026, 7, 4);
// F03: the store refuses days outside today and the previous 14 (migration 038); DAY must stay "recent".
pinToday(new Date(2026, 7, 4, 12, 0, 0));
const DATE_STR = '2026-08-04';

beforeEach(async () => {
  mockDb.calls.length = 0;
  mockDb.rows.length = 0;
  mockDb.idSeq = 0;
  mockDb.networkDown = false;
  mockDb.networkThrows = false;
  mockDb.insertError = null;
  mockDb.updateError = null;
  mockDb.insertStatus = 0;
  await AsyncStorage.clear();
  useLogStore.setState({ logs: [], loading: false, pendingSyncCount: 0, deadSyncCount: 0 });
  await useLogStore.getState().hydrateSyncQueue();
});

describe('AC-O01 -- an offline tap is optimistic, queued, and not an error', () => {
  it('updates local state immediately and does not wait for the network', () => {
    mockDb.networkDown = true;
    const habitId = 'off-1';

    // Call synchronously, without awaiting -- the point is that the local
    // state is already correct before any microtask runs.
    void useLogStore.getState().logHabit({ habitId, date: DAY, state: 'done' });

    const local = useLogStore.getState().getLogForHabit(habitId, DATE_STR);
    expect(local).toBeDefined();
    expect(local?.state).toBe('done');
    expect(useLogStore.getState().getSyncStatusFor(habitId, DATE_STR)).toBe('pending');
  });

  it('resolves ok:true (not an error) while offline, and leaves the op pending', async () => {
    mockDb.networkDown = true;
    const habitId = 'off-2';

    const res = await useLogStore.getState().logHabit({ habitId, date: DAY, state: 'done' });

    expect(res.ok).toBe(true);
    expect(mockDb.rows).toHaveLength(0); // nothing reached the database
    expect(useLogStore.getState().pendingSyncCount).toBe(1);
    expect(useLogStore.getState().getSyncStatusFor(habitId, DATE_STR)).toBe('pending');
  });

  it('nothing is lost: the queued op carries the tapped state', async () => {
    mockDb.networkDown = true;
    const habitId = 'off-3';
    await useLogStore.getState().logHabit({ habitId, date: DAY, state: 'partial', value: 2, targetValue: 4 });

    mockDb.networkDown = false;
    await useLogStore.getState().flushPendingSync();

    expect(mockDb.rows).toHaveLength(1);
    expect(mockDb.rows[0].state).toBe('partial');
    expect(mockDb.rows[0].value).toBe(2);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
  });
});

describe('AC-O02 -- cold start: persisted queue replays without duplicating', () => {
  it('resolves to an UPDATE, not a duplicate insert, when the row already exists remotely', async () => {
    const habitId = 'cold-1';

    // The previous process's write actually reached the server (or another
    // device wrote it) before this process ever ran -- nothing in THIS test
    // has called logHabit for this key, so store/logStore.ts's in-memory
    // `chains` map has no entry for it. This is the cold-start condition,
    // not a simulation of it.
    mockDb.rows.push({
      id: 'remote-1', habit_id: habitId, user_id: 'u1', completed_at: DATE_STR,
      value: null, is_completed: false, state: 'partial', xp: 10, created_at: 'now',
    });

    // A previous session persisted its intent before being killed.
    const persisted = enqueueOp(emptyQueueState(), habitId, DATE_STR, { state: 'done', baseXp: 30 });
    await saveSyncQueue(persisted.state, 'u1');

    // True cold start: reload the queue from disk into a fresh store.
    await useLogStore.getState().hydrateSyncQueue();
    expect(useLogStore.getState().getSyncStatusFor(habitId, DATE_STR)).toBe('pending');

    const results = await useLogStore.getState().flushPendingSync();

    expect(results).toHaveLength(1);
    expect(results[0].ok).toBe(true);
    expect(mockDb.rows).toHaveLength(1); // NOT duplicated
    expect(mockDb.rows[0].state).toBe('done'); // the queued intent won, via update
    expect(mockDb.calls).toEqual(expect.arrayContaining(['insert', 'update']));
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
    expect(useLogStore.getState().deadSyncCount).toBe(0);
  });

  it('inserts exactly once when no remote row exists yet', async () => {
    const habitId = 'cold-2';
    const persisted = enqueueOp(emptyQueueState(), habitId, DATE_STR, { state: 'done', baseXp: 30 });
    await saveSyncQueue(persisted.state, 'u1');

    await useLogStore.getState().hydrateSyncQueue();
    const results = await useLogStore.getState().flushPendingSync();

    expect(results[0].ok).toBe(true);
    expect(mockDb.calls.filter((c) => c === 'insert')).toHaveLength(1);
    expect(mockDb.rows).toHaveLength(1);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
  });
});

describe('AC-O03 -- N offline taps on the same (habit, day) collapse to one write', () => {
  it('replays exactly one write, carrying the FINAL tapped state', async () => {
    mockDb.networkDown = true;
    const habitId = 'collapse-1';

    await useLogStore.getState().logHabit({ habitId, date: DAY, state: 'done' });
    await useLogStore.getState().logHabit({ habitId, date: DAY, state: 'partial', value: 1, targetValue: 4 });
    await useLogStore.getState().logHabit({ habitId, date: DAY, state: 'miss' });

    expect(useLogStore.getState().pendingSyncCount).toBe(1); // collapsed, not 3
    // The optimistic local display already reflects the final intent, before any sync.
    expect(useLogStore.getState().getLogForHabit(habitId, DATE_STR)?.state).toBe('miss');

    mockDb.networkDown = false;
    await useLogStore.getState().flushPendingSync();

    expect(mockDb.calls.filter((c) => c === 'insert' || c === 'update')).toHaveLength(1);
    expect(mockDb.rows).toHaveLength(1);
    expect(mockDb.rows[0].state).toBe('miss');
  });
});

describe('AC-O04 -- a permanently failing op reaches a terminal state, not retried forever', () => {
  it('goes dead after MAX_ATTEMPTS (6 on unified outbox) rejections and stops being attempted', async () => {
    const habitId = 'dead-1';
    mockDb.insertError = { message: 'check constraint violation' }; // reached the server, real rejection

    const first = await useLogStore.getState().logHabit({ habitId, date: DAY, state: 'done' });
    expect(first.ok).toBe(false); // AC-O06 double-checked inline: still surfaced

    // `readyAt` after that first rejection was stamped from the REAL clock
    // (logHabit's own attempt does not take a `now` override) -- the
    // synthetic clock driving the remaining flushes must start from there,
    // not from an arbitrary small number, or the backoff comparison in
    // `orderedPending` would compare a real timestamp against a tiny one.
    let clock = Date.now();
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      clock += 10 * 60_000; // well past any backoff window
      await useLogStore.getState().flushPendingSync(clock);
    }

    expect(useLogStore.getState().getSyncStatusFor(habitId, DATE_STR)).toBe('dead');
    expect(useLogStore.getState().deadSyncCount).toBe(1);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);

    const insertsSoFar = mockDb.calls.filter((c) => c === 'insert').length;
    expect(insertsSoFar).toBe(MAX_ATTEMPTS);

    // A further flush must NOT attempt the dead op again.
    await useLogStore.getState().flushPendingSync(clock + 10 * 60_000);
    expect(mockDb.calls.filter((c) => c === 'insert').length).toBe(insertsSoFar);
  });
});

describe('AC-O05 -- a corrupt persisted payload is discarded on hydrate, not thrown', () => {
  it('hydrateSyncQueue resolves cleanly and leaves counts at zero', async () => {
    await AsyncStorage.setItem('atlas_sync_queue_v1', 'not json at all {{{');
    await expect(useLogStore.getState().hydrateSyncQueue()).resolves.toBeUndefined();
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
    expect(useLogStore.getState().deadSyncCount).toBe(0);
  });
});

describe('AC-O06 -- a real (non-network) failure still surfaces ok:false (commit 8a04c04)', () => {
  it('an insert rejection is returned to the caller, not swallowed as offline', async () => {
    const habitId = 'reject-1';
    mockDb.insertError = { message: 'RLS denied' };

    const res = await useLogStore.getState().logHabit({ habitId, date: DAY, state: 'done' });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('RLS denied');
    // The optimistic placeholder is rolled back -- a rejected write leaves
    // no phantom "done" in local state, same net effect as the pre-offline
    // store/logStore.test.ts AC-L02 assertion this mirrors.
    expect(useLogStore.getState().getLogForHabit(habitId, DATE_STR)).toBeUndefined();
  });
});

describe('F04 (STO-01) -- the queue in memory goes with the account', () => {
  it("after an account boundary A's queued write is not replayed by this session; it stays on disk for A", async () => {
    mockDb.networkDown = true;
    await useLogStore.getState().logHabit({ habitId: 'acc-1', date: DAY, state: 'done' });
    expect(useLogStore.getState().pendingSyncCount).toBe(1);
    mockDb.networkDown = false;

    resetAccountMemory('signed_out');
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
    expect(useLogStore.getState().logs).toEqual([]);
    await useLogStore.getState().flushPendingSync();
    expect(mockDb.calls.filter((c) => c === 'insert')).toHaveLength(0);

    // the same account hydrates its own queue back from disk and delivers it
    await useLogStore.getState().hydrateSyncQueue();
    expect(useLogStore.getState().pendingSyncCount).toBe(1);
    await useLogStore.getState().flushPendingSync();
    expect(mockDb.calls.filter((c) => c === 'insert')).toHaveLength(1);
  });
});

describe('F05 (SYN-03) -- what each failure class costs', () => {
  const opOnDisk = async () => {
    const raw = await AsyncStorage.getItem('outbox.v1.habit.u1');
    return raw ? JSON.parse(raw).state.commands[0] : undefined;
  };

  it('a lost connection costs nothing, however often it happens', async () => {
    mockDb.networkDown = true;
    await useLogStore.getState().logHabit({ habitId: 'f05-net', date: DAY, state: 'done' });
    for (let i = 0; i < 8; i++) await useLogStore.getState().flushPendingSync();
    expect(await opOnDisk()).toMatchObject({ attempts: 0, status: 'pending' });
    expect(useLogStore.getState().deadSyncCount).toBe(0);
  });

  it('a transient server answer (503) keeps the tap, costs nothing and backs off', async () => {
    mockDb.insertError = { message: 'Service Unavailable' };
    mockDb.insertStatus = 503;
    const res = await useLogStore.getState().logHabit({ habitId: 'f05-503', date: DAY, state: 'done' });
    expect(res.ok).toBe(true); // queued, not refused
    expect(useLogStore.getState().getLogForHabit('f05-503', DATE_STR)?.state).toBe('done'); // not rolled back
    let now = Date.now();
    for (let i = 0; i < 10; i++) {
      now += 16 * 60_000; // past any backoff (15 min cap)
      await useLogStore.getState().flushPendingSync(now);
    }
    expect(await opOnDisk()).toMatchObject({ attempts: 0, status: 'pending', retryableCount: 11 });
    expect(useLogStore.getState().deadSyncCount).toBe(0);
  });

  it('a refusal on its merits (403) still dies after MAX_ATTEMPTS', async () => {
    mockDb.insertError = { message: 'permission denied' };
    mockDb.insertStatus = 403;
    await useLogStore.getState().logHabit({ habitId: 'f05-403', date: DAY, state: 'done' });
    let now = Date.now();
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      now += 24 * 3600_000;
      await useLogStore.getState().flushPendingSync(now);
    }
    expect(await opOnDisk()).toMatchObject({ status: 'dead' });
    expect(useLogStore.getState().deadSyncCount).toBe(1);
  });
});
