/**
 * Pure-logic tests for the offline sync queue.  (Phase 4, plan §18, W1/W2)
 *
 * AC-Q01  enqueue collapses N taps on the same (habit, day) into ONE op,
 *         carrying the FINAL intent -- not N ops.
 * AC-Q02  ordering is deterministic: ascending by queue-position (`seq`),
 *         unaffected by a later collapse on an earlier key.
 * AC-Q03  a rejected (server-reached) failure counts toward the attempt
 *         budget; a network failure does not.
 * AC-Q04  a rejected op reaches a TERMINAL `dead` state after MAX_ATTEMPTS
 *         and is then excluded from `orderedPending` -- not retried forever.
 * AC-Q05  a fresh tap revives a dead op (new intent, attempts reset).
 * AC-Q06  markSynced removes the op; pendingFor/statusFor reflect it.
 * AC-Q07  persistence: save/load round-trips; a corrupt/unparseable stored
 *         payload is discarded, not thrown.
 *
 * Written BEFORE the fix and observed to fail for the right reason on a
 * deliberately-broken stub, per R-01 (see the "red-first evidence" run in
 * the task report -- this file itself carries no seeded bug).
 */
import {
  emptyQueueState,
  enqueue,
  dequeue,
  markSynced,
  markFailed,
  pendingFor,
  statusFor,
  pendingCount,
  deadCount,
  orderedPending,
  nextRetryDelayMs,
  MAX_ATTEMPTS,
  loadSyncQueue,
  saveSyncQueue,
  partitionByOwner,
  mergeOps,
  revive,
  deadOps,
  nextReadyAt,
  QUARANTINE_KEY,
  QUARANTINE_MAX,
  type SyncQueueState,
} from '../../lib/syncQueue';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DONE = { state: 'done' as const };
const PARTIAL3 = { state: 'partial' as const, value: 3, targetValue: 4 };
const MISS = { state: 'miss' as const };

describe('AC-Q01 -- N offline taps on the same (habit, day) collapse to one op', () => {
  it('keeps exactly one op after three taps on the same key', () => {
    let s = emptyQueueState();
    ({ state: s } = enqueue(s, 'h1', '2026-08-04', DONE));
    ({ state: s } = enqueue(s, 'h1', '2026-08-04', PARTIAL3));
    ({ state: s } = enqueue(s, 'h1', '2026-08-04', MISS));

    expect(s.ops).toHaveLength(1);
    expect(s.ops[0].intent).toEqual(MISS);
  });

  it('does not collapse across different habits or different days', () => {
    let s = emptyQueueState();
    ({ state: s } = enqueue(s, 'h1', '2026-08-04', DONE));
    ({ state: s } = enqueue(s, 'h2', '2026-08-04', DONE));
    ({ state: s } = enqueue(s, 'h1', '2026-08-05', DONE));

    expect(s.ops).toHaveLength(3);
  });
});

describe('AC-Q02 -- replay order is deterministic', () => {
  it('orders by original queue position, not by last-touched time', () => {
    let s = emptyQueueState();
    ({ state: s } = enqueue(s, 'A', '2026-08-04', DONE));
    ({ state: s } = enqueue(s, 'B', '2026-08-04', DONE));
    // A is tapped again with a different final intent -- collapses onto its
    // ORIGINAL position, so it must still replay before B.
    ({ state: s } = enqueue(s, 'A', '2026-08-04', PARTIAL3));

    const order = orderedPending(s).map((o) => o.habitId);
    expect(order).toEqual(['A', 'B']);
  });

  it('is stable across many entries queued in the same millisecond', () => {
    let s = emptyQueueState();
    const now = 1_000_000; // pin the clock -- proves seq, not wall time, drives order
    for (let i = 0; i < 20; i++) {
      ({ state: s } = enqueue(s, `h${i}`, '2026-08-04', DONE, { now }));
    }
    const order = orderedPending(s, now).map((o) => o.habitId);
    expect(order).toEqual(Array.from({ length: 20 }, (_, i) => `h${i}`));
  });
});

describe('AC-Q03 -- network failures do not spend the attempt budget', () => {
  it('leaves attempts at 0 and stays pending after a network failure', () => {
    let s = emptyQueueState();
    let op;
    ({ state: s, op } = enqueue(s, 'h1', '2026-08-04', DONE));
    s = markFailed(s, op.id, 'network');
    s = markFailed(s, op.id, 'network');
    s = markFailed(s, op.id, 'network');

    expect(s.ops[0].attempts).toBe(0);
    expect(s.ops[0].status).toBe('pending');
    expect(orderedPending(s)).toHaveLength(1); // still eligible, no backoff applied
  });

  it('increments attempts on a rejected (server-reached) failure', () => {
    let s = emptyQueueState();
    let op;
    ({ state: s, op } = enqueue(s, 'h1', '2026-08-04', DONE));
    s = markFailed(s, op.id, 'rejected', { error: 'RLS denied' });

    expect(s.ops[0].attempts).toBe(1);
    expect(s.ops[0].status).toBe('pending');
    expect(s.ops[0].lastError).toBe('RLS denied');
  });
});

describe('AC-Q04 -- a permanently failing op reaches a terminal state, not retried forever', () => {
  it('goes dead after MAX_ATTEMPTS rejections and drops out of orderedPending', () => {
    let s = emptyQueueState();
    let op;
    ({ state: s, op } = enqueue(s, 'h1', '2026-08-04', DONE));

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      s = markFailed(s, op.id, 'rejected', { error: 'validation failed', now: i * 1_000_000 });
    }

    expect(s.ops[0].status).toBe('dead');
    expect(s.ops[0].attempts).toBe(MAX_ATTEMPTS);
    expect(deadCount(s)).toBe(1);
    expect(pendingCount(s)).toBe(0);
    // A flush loop must stop trying it -- this is HOW it stops being retried forever.
    expect(orderedPending(s, Number.MAX_SAFE_INTEGER)).toHaveLength(0);
    // It is still OBSERVABLE (not silently dropped) -- this is how the user finds out.
    expect(statusFor(s, 'h1', '2026-08-04')).toBe('dead');
  });

  it('backs off exponentially between rejections, bounded', () => {
    expect(nextRetryDelayMs(1)).toBeLessThan(nextRetryDelayMs(2));
    expect(nextRetryDelayMs(2)).toBeLessThan(nextRetryDelayMs(3));
    // bounded -- does not grow without limit
    expect(nextRetryDelayMs(50)).toBe(nextRetryDelayMs(20));
  });
});

describe('AC-Q05 -- a fresh tap revives a dead op', () => {
  it('resets attempts and status when the same key is tapped again', () => {
    let s = emptyQueueState();
    let op;
    ({ state: s, op } = enqueue(s, 'h1', '2026-08-04', DONE));
    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      s = markFailed(s, op.id, 'rejected', { error: 'boom' });
    }
    expect(s.ops[0].status).toBe('dead');

    ({ state: s } = enqueue(s, 'h1', '2026-08-04', PARTIAL3));

    expect(s.ops).toHaveLength(1);
    expect(s.ops[0].status).toBe('pending');
    expect(s.ops[0].attempts).toBe(0);
    expect(s.ops[0].intent).toEqual(PARTIAL3);
  });
});

describe('AC-Q06 -- markSynced / pendingFor / statusFor / dequeue', () => {
  it('markSynced removes the op entirely', () => {
    let s = emptyQueueState();
    let op;
    ({ state: s, op } = enqueue(s, 'h1', '2026-08-04', DONE));
    expect(pendingFor(s, 'h1', '2026-08-04')).toBeDefined();

    s = markSynced(s, op.id);

    expect(s.ops).toHaveLength(0);
    expect(pendingFor(s, 'h1', '2026-08-04')).toBeUndefined();
    expect(statusFor(s, 'h1', '2026-08-04')).toBe('synced');
  });

  it('statusFor reports synced for a key that was never queued', () => {
    const s = emptyQueueState();
    expect(statusFor(s, 'never-tapped', '2026-08-04')).toBe('synced');
  });

  it('dequeue on an unknown id is a safe no-op', () => {
    let s = emptyQueueState();
    ({ state: s } = enqueue(s, 'h1', '2026-08-04', DONE));
    const before = s.ops.length;
    s = dequeue(s, 'not-a-real-id');
    expect(s.ops.length).toBe(before);
  });
});

describe('AC-Q07 -- persistence round-trips and survives corruption', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('loadSyncQueue returns an empty queue when nothing is stored', async () => {
    const s = await loadSyncQueue('u1');
    expect(s).toEqual(emptyQueueState());
  });

  it('round-trips a non-trivial queue through save/load', async () => {
    let s = emptyQueueState();
    ({ state: s } = enqueue(s, 'h1', '2026-08-04', DONE));
    ({ state: s } = enqueue(s, 'h2', '2026-08-05', PARTIAL3, { now: 42 }));

    await saveSyncQueue(s, 'u1');
    const loaded = await loadSyncQueue('u1');

    // The queue is now stored per account, and loading stamps every op with
    // the account that owns it — the replay path resolves the user at flush
    // time, so an unowned op would drain through whoever is signed in then.
    expect(loaded.nextSeq).toBe(s.nextSeq);
    expect(loaded.ops).toEqual(s.ops.map((o) => ({ ...o, userId: 'u1' })));
  });

  it('stores per account — one user cannot load another user queue', async () => {
    let s = emptyQueueState();
    ({ state: s } = enqueue(s, 'h1', '2026-08-04', DONE));
    await saveSyncQueue(s, 'userA');

    expect((await loadSyncQueue('userB')).ops).toEqual([]);
    expect((await loadSyncQueue('userA')).ops).toHaveLength(1);
  });

  it('adopts a legacy unscoped queue once, then removes it', async () => {
    let s = emptyQueueState();
    ({ state: s } = enqueue(s, 'legacy-habit', '2026-08-04', DONE));
    await AsyncStorage.setItem('atlas_sync_queue_v1', JSON.stringify(s));

    // Adopted rather than discarded: dropping it would silently lose writes
    // the user is still owed on a single-account device.
    const first = await loadSyncQueue('u1');
    expect(first.ops).toHaveLength(1);
    expect(first.ops[0].userId).toBe('u1');
    expect(await AsyncStorage.getItem('atlas_sync_queue_v1')).toBeNull();

    // And only once — a second account gets nothing.
    expect((await loadSyncQueue('u2')).ops).toEqual([]);
  });

  it('an empty user id loads nothing and saves nothing', async () => {
    let s = emptyQueueState();
    ({ state: s } = enqueue(s, 'h1', '2026-08-04', DONE));
    await saveSyncQueue(s, '');
    expect((await loadSyncQueue('')).ops).toEqual([]);
  });

  it('discards an unparseable stored payload instead of throwing', async () => {
    await AsyncStorage.setItem('atlas_sync_queue_v1:u1', '{{{ not json');
    const s = await loadSyncQueue('u1');
    expect(s).toEqual(emptyQueueState());
  });

  it('discards a well-formed JSON payload of the wrong shape', async () => {
    await AsyncStorage.setItem('atlas_sync_queue_v1:u1', JSON.stringify({ hello: 'world' }));
    const s = await loadSyncQueue('u1');
    expect(s).toEqual(emptyQueueState());
  });

  it('discards a queue whose ops carry an invalid state', async () => {
    const corrupt: SyncQueueState = {
      nextSeq: 2,
      ops: [{
        id: 'x', habitId: 'h1', date: '2026-08-04',
        intent: { state: 'not-a-real-state' as never },
        attempts: 0, status: 'pending', seq: 1, createdAt: 1, updatedAt: 1,
      }],
    };
    await AsyncStorage.setItem('atlas_sync_queue_v1:u1', JSON.stringify(corrupt));
    const s = await loadSyncQueue('u1');
    expect(s).toEqual(emptyQueueState());
  });
});

describe('F05 -- ownership, recovery and timing helpers', () => {
  const T = 5_000_000;

  it('enqueue stamps the owner and the state before the tap; a collapse keeps the FIRST base', () => {
    let s = enqueue(emptyQueueState(), 'h', '2026-08-04', DONE, { userId: 'A', priorState: 'miss', now: T }).state;
    expect(s.ops[0]).toMatchObject({ userId: 'A', priorState: 'miss' });
    s = enqueue(s, 'h', '2026-08-04', { state: 'skip' }, { userId: 'A', priorState: 'done', now: T + 1 }).state;
    expect(s.ops).toHaveLength(1);
    expect(s.ops[0]).toMatchObject({ userId: 'A', priorState: 'miss', intent: { state: 'skip' } });
  });

  it('a collapse clears the transient counters and stamps an unstamped op', () => {
    let s = enqueue(emptyQueueState(), 'h', '2026-08-04', DONE, { id: 'x', now: T }).state;
    s = markFailed(s, 'x', 'retryable', { now: T });
    expect(s.ops[0].retryableCount).toBe(1);
    s = enqueue(s, 'h', '2026-08-04', DONE, { userId: 'B', now: T + 1 }).state;
    expect(s.ops[0]).toMatchObject({ userId: 'B' });
    expect(s.ops[0].retryableCount).toBeUndefined();
    expect(s.ops[0].firstRetryableAt).toBeUndefined();
  });

  it('partitionByOwner: own (unstamped adopted) vs foreign', () => {
    let s = enqueue(emptyQueueState(), 'a', '2026-08-04', DONE, { id: 'mine', userId: 'A' }).state;
    s = enqueue(s, 'b', '2026-08-04', DONE, { id: 'legacy' }).state;
    s = enqueue(s, 'c', '2026-08-04', DONE, { id: 'theirs', userId: 'B' }).state;
    const { own, foreign } = partitionByOwner(s, 'A');
    expect(own.ops.map((o) => [o.id, o.userId])).toEqual([['mine', 'A'], ['legacy', 'A']]);
    expect(foreign.map((o) => o.id)).toEqual(['theirs']);
  });

  it('mergeOps: the newer op wins its key, seq is renumbered base-then-extra, nextSeq follows', () => {
    let base = enqueue(emptyQueueState(), 'a', '2026-08-04', DONE, { id: 'base-a', userId: 'A' }).state;
    base = enqueue(base, 'b', '2026-08-04', DONE, { id: 'base-b', userId: 'A' }).state;
    const extra = enqueue(emptyQueueState(), 'a', '2026-08-04', { state: 'skip' }, { id: 'new-a' }).state.ops;
    const m = mergeOps(base, extra, 'A');
    expect(m.ops.map((o) => [o.id, o.seq, o.userId])).toEqual([['base-b', 1, 'A'], ['new-a', 2, 'A']]);
    expect(m.nextSeq).toBe(3);
  });

  it('revive gives a dead op a clean slate; deadOps lists only dead ones', () => {
    let s = enqueue(emptyQueueState(), 'h', '2026-08-04', DONE, { id: 'd', now: T }).state;
    for (let i = 0; i < MAX_ATTEMPTS; i++) s = markFailed(s, 'd', 'rejected', { error: 'no', now: T });
    expect(deadOps(s).map((o) => o.id)).toEqual(['d']);
    s = revive(s, 'd', T + 10);
    expect(s.ops[0]).toMatchObject({ status: 'pending', attempts: 0, updatedAt: T + 10 });
    expect(s.ops[0].lastError).toBeUndefined();
    expect(s.ops[0].readyAt).toBeUndefined();
    expect(deadOps(s)).toEqual([]);
  });

  it('nextReadyAt: the soonest FUTURE readyAt of a pending op, else null', () => {
    let s = enqueue(emptyQueueState(), 'a', '2026-08-04', DONE, { id: 'a', now: T }).state;
    s = enqueue(s, 'b', '2026-08-04', DONE, { id: 'b', now: T }).state;
    expect(nextReadyAt(s, T)).toBeNull();
    s = markFailed(s, 'a', 'retryable', { now: T }); // T + 5 s
    s = markFailed(s, 'b', 'rejected', { now: T }); // T + nextRetryDelayMs(1)
    const times = [T + 5_000, T + nextRetryDelayMs(1)].sort((x, y) => x - y);
    expect(times[0]).not.toBe(times[1]);
    expect(nextReadyAt(s, T)).toBe(times[0]);
    expect(nextReadyAt(s, times[0])).toBe(times[1]); // a due time is not "deferred"
    expect(nextReadyAt(s, times[1])).toBeNull();
  });

  it('loadSyncQueue moves a foreign op to the quarantine and gives the quarantine back to its owner', async () => {
    let s = enqueue(emptyQueueState(), 'a', '2026-08-04', DONE, { id: 'mine', userId: 'A' }).state;
    s = enqueue(s, 'b', '2026-08-04', DONE, { id: 'stray', userId: 'B' }).state;
    await AsyncStorage.setItem('atlas_sync_queue_v1:A', JSON.stringify(s));
    const a = await loadSyncQueue('A');
    expect(a.ops.map((o) => o.id)).toEqual(['mine']);
    expect(JSON.parse((await AsyncStorage.getItem(QUARANTINE_KEY))!).map((o: { id: string }) => o.id)).toEqual(['stray']);
    expect(JSON.parse((await AsyncStorage.getItem('atlas_sync_queue_v1:A'))!).ops.map((o: { id: string }) => o.id)).toEqual(['mine']);

    const b = await loadSyncQueue('B'); // B has no key of its own yet
    expect(b.ops.map((o) => [o.id, o.userId])).toEqual([['stray', 'B']]);
    expect(await AsyncStorage.getItem(QUARANTINE_KEY)).toBeNull();
  });

  it('the quarantine keeps at most QUARANTINE_MAX ops, newest kept', async () => {
    let s = emptyQueueState();
    for (let i = 0; i < QUARANTINE_MAX + 5; i++) {
      s = enqueue(s, `h${i}`, '2026-08-04', DONE, { id: `q${i}`, userId: 'B', now: T + i }).state;
    }
    await AsyncStorage.setItem('atlas_sync_queue_v1:A', JSON.stringify(s));
    await loadSyncQueue('A');
    const q = JSON.parse((await AsyncStorage.getItem(QUARANTINE_KEY))!) as { id: string }[];
    expect(q).toHaveLength(QUARANTINE_MAX);
    expect(q[0].id).toBe('q5');
  });

  it('saveSyncQueue answers honestly', async () => {
    await expect(saveSyncQueue(emptyQueueState(), 'A')).resolves.toBe(true);
    await expect(saveSyncQueue(emptyQueueState(), '')).resolves.toBe(false);
  });
});
