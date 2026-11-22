/**
 * F05 (SYN-01, STO-02, SYN-V01) — the habit-log queue follows the signed-in account.
 *
 * Before: the queue was bound to an owner only at boot. A device that booted signed out had no owner
 * all session, so every offline tap was saved under no key at all (lost on restart); signing out kept
 * the old owner's queue in memory; a tap of B could ride on A's queue. Now `rebindSyncQueue` binds it
 * on every auth event: the leaving owner's work is saved under ITS key, the new owner's is loaded,
 * taps made with no owner are stamped and kept, and a write in flight across the change leaves the
 * new owner's memory alone.
 *
 * Behaviour tests: the real store, a database mock that can go offline or hold a request in flight,
 * and the real AsyncStorage mock.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockUserId: string | null = null;
const inserted: Record<string, unknown>[] = [];
const mockNet = {
  online: true,
  /** When set, the next insert waits for this to resolve. */
  gate: null as Promise<void> | null,
  serverRows: [] as Record<string, unknown>[],
  /** When set, the server answers every insert with this HTTP status. */
  serverStatus: 0,
};

jest.mock('../../lib/supabase', () => {
  const offline = { data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 };
  const rows = () => {
    const answer = () => Promise.resolve({ data: mockNet.serverRows, error: null, status: 200 });
    return Object.assign(answer(), { limit: answer });
  };
  const chain = (table: string) => ({
    select: () => ({
      eq: () => ({ eq: rows }),
    }),
    insert: (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          if (mockNet.gate) { const g = mockNet.gate; mockNet.gate = null; await g; }
          if (!mockNet.online) return offline;
          if (mockNet.serverStatus) return { data: null, error: { message: 'Service Unavailable', code: '' }, status: mockNet.serverStatus };
          inserted.push({ table, ...row });
          return { data: { id: `row-${inserted.length}`, created_at: 'now', ...row }, error: null, status: 201 };
        },
      }),
    }),
    update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null, status: 200 }) }) }) }) }),
  });
  return {
    supabase: {
      auth: {
        getSession: async () => ({
          data: { session: mockUserId ? { user: { id: mockUserId }, access_token: 'jwt' } : null },
          error: null,
        }),
        getUser: async () => ({ data: { user: mockUserId ? { id: mockUserId } : null }, error: null }),
      },
      from: (t: string) => chain(t),
    },
  };
});

import { useLogStore, NO_SESSION_ERROR } from '../../store/logStore';
import {
  enqueue, emptyQueueState, saveSyncQueue, markFailed, QUARANTINE_KEY, type SyncOp, type SyncQueueState,
} from '../../lib/syncQueue';
import type { OutboxCommand } from '../../lib/outbox';
import { parseHabitLogEntityId } from '../../lib/outboxEngine';
import { namespacedOutboxKey } from '../../lib/outboxStorage';
import { pinToday } from '../helpers/pinnedClock';
import { resetAccountMemory } from '../../lib/accountScope';

const DAY = '2026-08-04';
const keyOf = (uid: string) => namespacedOutboxKey('habit', uid);
async function onDisk(uid: string): Promise<SyncQueueState | null> {
  const raw = await AsyncStorage.getItem(keyOf(uid));
  if (!raw) return null;
  const parsed = JSON.parse(raw) as { state: { commands: OutboxCommand[]; nextSeq: number } };
  const ops: SyncOp[] = parsed.state.commands.map((c) => {
    const p = parseHabitLogEntityId(c.entityId) ?? { habitId: c.entityId, date: DAY };
    return {
      id: c.operationId,
      habitId: p.habitId,
      date: p.date,
      intent: c.payload.intent as SyncOp['intent'],
      attempts: c.attempts,
      status: c.status === 'dead' ? 'dead' : 'pending',
      seq: c.seq,
      createdAt: c.createdAt,
      updatedAt: c.createdAt,
      ...(c.readyAt > 0 ? { readyAt: c.readyAt } : {}),
      ...(c.lastError !== undefined ? { lastError: c.lastError } : {}),
      userId: c.userId,
      priorState: null,
      ...(c.retryableCount !== undefined ? { retryableCount: c.retryableCount } : {}),
      ...(c.firstRetryableAt !== undefined ? { firstRetryableAt: c.firstRetryableAt } : {}),
    };
  });
  return { ops, nextSeq: parsed.state.nextSeq };
}
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const tap = (habitId = 'h1') => useLogStore.getState().logHabit({ habitId, date: new Date(`${DAY}T12:00:00`), state: 'done' });

pinToday(new Date(`${DAY}T12:00:00`));

beforeEach(async () => {
  inserted.length = 0;
  mockNet.online = true;
  mockNet.gate = null;
  mockNet.serverRows = [];
  mockNet.serverStatus = 0;
  mockUserId = null;
  // the previous test's owner leaves first (its memory is saved under its key, by design), and only
  // then is the device wiped: the other order would write that memory back into the fresh storage
  await useLogStore.getState().rebindSyncQueue(null);
  await useLogStore.getState().hydrateSyncQueue(); // signed out: no owner
  await settle();
  await AsyncStorage.clear();
  useLogStore.setState({ logs: [], pendingSyncCount: 0, deadSyncCount: 0 });
});

describe('SYN-01 — a session that starts after boot owns the queue', () => {
  it('booted signed out, then signed in: an offline tap is saved under that account and replayed later', async () => {
    mockUserId = 'A';
    await useLogStore.getState().rebindSyncQueue('A');
    mockNet.online = false;

    const res = await tap();
    expect(res.ok).toBe(true); // queued, not an error
    const disk = await onDisk('A');
    expect(disk?.ops).toHaveLength(1);
    expect(disk?.ops[0]).toMatchObject({ habitId: 'h1', date: DAY, userId: 'A', priorState: null });
    expect(useLogStore.getState().pendingSyncCount).toBe(1);

    mockNet.online = true;
    await useLogStore.getState().flushPendingSync();
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ habit_id: 'h1', user_id: 'A' });
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
    expect((await onDisk('A'))?.ops).toEqual([]);
  });

  it('no owner and no session: an honest failure, the optimistic row rolled back, nothing queued', async () => {
    const res = await tap();
    expect(res).toEqual({ ok: false, error: NO_SESSION_ERROR });
    expect(useLogStore.getState().logs).toEqual([]);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
    expect(await AsyncStorage.getAllKeys()).not.toContainEqual(expect.stringMatching(/^(atlas_sync_queue_v1|outbox\.v1\.habit)/));
  });

  it('no owner yet but a session: the tap finds the session itself and is saved under it', async () => {
    mockUserId = 'A';
    mockNet.online = false;
    const res = await tap();
    expect(res.ok).toBe(true);
    expect((await onDisk('A'))?.ops[0]).toMatchObject({ userId: 'A' });
  });

  it('a tap made while the sign-in is being applied is stamped with that account and kept', async () => {
    mockUserId = 'A';
    mockNet.online = false;
    const binding = useLogStore.getState().rebindSyncQueue('A'); // SIGNED_IN arrives...
    const tapped = tap(); // ...and the user taps in the same tick, before it is applied
    await Promise.all([binding, tapped]);
    const disk = await onDisk('A');
    expect(disk?.ops).toHaveLength(1);
    expect(disk?.ops[0]).toMatchObject({ habitId: 'h1', userId: 'A' });
    expect(useLogStore.getState().pendingSyncCount).toBe(1);
  });
});

describe('STO-02 — signing out puts the work away under its owner', () => {
  it('the remaining work is saved under the old key, memory is empty, the day reads as synced', async () => {
    mockUserId = 'A';
    await useLogStore.getState().rebindSyncQueue('A');
    mockNet.online = false;
    await tap();
    expect(useLogStore.getState().pendingSyncCount).toBe(1);

    mockUserId = null;
    await useLogStore.getState().rebindSyncQueue(null);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
    expect(useLogStore.getState().getSyncStatusFor('h1', DAY)).toBe('synced');
    expect((await onDisk('A'))?.ops).toHaveLength(1);
    mockNet.online = true;
    expect(await useLogStore.getState().flushPendingSync()).toEqual([]);
    expect(inserted).toEqual([]);
  });
});

describe('SYN-V01 — one account never drains through another', () => {
  it('A out, B in: B\'s offline tap lands under B, A\'s key is untouched', async () => {
    mockUserId = 'A';
    await useLogStore.getState().rebindSyncQueue('A');
    mockNet.online = false;
    await tap('hA');
    const before = await AsyncStorage.getItem(keyOf('A'));

    mockUserId = 'B';
    await useLogStore.getState().rebindSyncQueue('B');
    await tap('hB');
    expect((await onDisk('B'))?.ops).toEqual([expect.objectContaining({ habitId: 'hB', userId: 'B' })]);
    expect(await AsyncStorage.getItem(keyOf('A'))).toBe(before);
  });

  it('A\'s pending op is never replayed with B\'s session', async () => {
    mockUserId = 'A';
    await useLogStore.getState().rebindSyncQueue('A');
    mockNet.online = false;
    await tap('hA');

    mockUserId = 'B';
    mockNet.online = true;
    await useLogStore.getState().rebindSyncQueue('B');
    await settle();
    await useLogStore.getState().flushPendingSync();
    expect(inserted).toEqual([]);
    expect((await onDisk('A'))?.ops).toHaveLength(1); // still owed by A
  });

  it('a legacy unstamped op is adopted by the account whose key holds it; a foreign-stamped op goes to quarantine and back to its owner', async () => {
    let s = enqueue(emptyQueueState(), 'h-legacy', DAY, { state: 'done', baseXp: 30 }, { id: 'legacy' }).state; // no userId
    s = enqueue(s, 'h-of-B', DAY, { state: 'done', baseXp: 30 }, { id: 'stray', userId: 'B' }).state;
    await saveSyncQueue(s, 'A');

    mockUserId = 'A';
    await useLogStore.getState().hydrateSyncQueue();
    expect(useLogStore.getState().pendingSyncCount).toBe(1);
    const quarantined = JSON.parse((await AsyncStorage.getItem(QUARANTINE_KEY)) ?? '[]');
    expect(quarantined).toEqual([expect.objectContaining({ id: 'stray', userId: 'B' })]);
    expect((await onDisk('A'))?.ops.map((o) => [o.id, o.userId])).toEqual([['legacy', 'A']]);

    mockUserId = 'B';
    mockNet.online = false;
    await useLogStore.getState().rebindSyncQueue('B');
    expect(useLogStore.getState().pendingSyncCount).toBe(1);
    expect(JSON.parse((await AsyncStorage.getItem(QUARANTINE_KEY)) ?? '[]')).toEqual([]);
  });
});

describe('the account boundary (F04 registry) and the queue on disk', () => {
  async function ownerAWithMemoryOnly() {
    mockUserId = 'A';
    await useLogStore.getState().rebindSyncQueue('A');
    mockNet.online = false;
    await tap();
    const setItem = AsyncStorage.setItem as jest.Mock;
    setItem.mockClear();
    return setItem;
  }

  it('a sign-out writes what A still owes under A\'s key before memory is cleared', async () => {
    const setItem = await ownerAWithMemoryOnly();
    resetAccountMemory('signed_out');
    expect(setItem).toHaveBeenCalledWith(keyOf('A'), expect.stringContaining('"userId":"A"'));
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
  });

  it('an account deletion does NOT write the deleted account\'s queue back', async () => {
    const setItem = await ownerAWithMemoryOnly();
    resetAccountMemory('account_deleted');
    await settle();
    expect(setItem.mock.calls.filter(([k]) => k === keyOf('A'))).toEqual([]);
  });
});

describe('races', () => {
  it('two owner changes in the same tick: the last one wins and A\'s work is intact', async () => {
    mockUserId = 'A';
    await useLogStore.getState().rebindSyncQueue('A');
    mockNet.online = false;
    await tap('hA');

    mockUserId = 'B';
    await Promise.all([
      useLogStore.getState().rebindSyncQueue('A'),
      useLogStore.getState().rebindSyncQueue('B'),
    ]);
    await tap('hB');
    expect((await onDisk('B'))?.ops.map((o) => o.habitId)).toEqual(['hB']);
    expect((await onDisk('A'))?.ops.map((o) => o.habitId)).toEqual(['hA']);
  });

  it('a write in flight across an owner change does not touch the new owner\'s queue', async () => {
    mockUserId = 'A';
    await useLogStore.getState().rebindSyncQueue('A');
    let release!: () => void;
    mockNet.gate = new Promise<void>((r) => { release = r; });

    const inFlight = tap('hA'); // A's request is out...
    await settle();
    mockUserId = 'B';
    await useLogStore.getState().rebindSyncQueue('B'); // ...when B signs in
    expect(useLogStore.getState().pendingSyncCount).toBe(0);

    release();
    const res = await inFlight;
    expect(res.ok).toBe(true); // A's request resolved
    expect(useLogStore.getState().pendingSyncCount).toBe(0); // B's memory untouched
    expect((await onDisk('B'))).toBeNull();
    // A's op stays owed under A (saved at the change); replaying it later is idempotent (23505 path)
    expect((await onDisk('A'))?.ops.map((o) => o.habitId)).toEqual(['hA']);
  });
});

describe('quiet edges', () => {
  it('saveSyncQueue reports a failed write with false and does not throw', async () => {
    // a one-off rejection; NOT mockRestore(): the AsyncStorage mock's setItem is a jest.fn whose
    // implementation a restore would erase for every later test
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await expect(saveSyncQueue(emptyQueueState(), 'A')).resolves.toBe(false);
    await expect(saveSyncQueue(emptyQueueState(), '')).resolves.toBe(false);
    await expect(saveSyncQueue(emptyQueueState(), 'A')).resolves.toBe(true); // the next write works
  });

  it('a second rebind to the same user is a no-op: nothing reloaded, the tap in memory is kept', async () => {
    mockUserId = 'A';
    await useLogStore.getState().rebindSyncQueue('A');
    mockNet.online = false;
    await tap();
    // the AsyncStorage mock's getItem is already a jest.fn: its earlier calls are cleared, its
    // implementation is kept
    const getItem = AsyncStorage.getItem as jest.Mock;
    getItem.mockClear();
    await useLogStore.getState().rebindSyncQueue('A');
    expect(getItem).not.toHaveBeenCalled();
    expect(useLogStore.getState().pendingSyncCount).toBe(1);
  });
});

describe('SYN-03 — a way out for a dead op', () => {
  async function deadOpFor(uid: string) {
    let s = enqueue(emptyQueueState(), 'h1', DAY, { state: 'done', baseXp: 30 }, { id: 'dead-1', userId: uid }).state;
    for (let i = 0; i < 5; i++) s = markFailed(s, 'dead-1', 'rejected', { error: 'RLS denied' });
    await saveSyncQueue(s, uid);
  }

  it('reviveSyncOp makes it pending again and sends it', async () => {
    await deadOpFor('A');
    mockUserId = 'A';
    await useLogStore.getState().hydrateSyncQueue();
    expect(useLogStore.getState().deadSyncCount).toBe(1);
    expect(useLogStore.getState().deadSyncOps().map((o) => o.id)).toEqual(['dead-1']);

    await useLogStore.getState().reviveSyncOp('dead-1');
    await settle();
    await useLogStore.getState().flushPendingSync();
    expect(inserted).toHaveLength(1);
    expect(useLogStore.getState().deadSyncCount).toBe(0);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
  });

  it('dropSyncOp removes it and puts the server\'s row for that day back (or nothing)', async () => {
    await deadOpFor('A');
    mockUserId = 'A';
    await useLogStore.getState().hydrateSyncQueue();
    useLogStore.setState({ logs: [{ id: 'local-1', habit_id: 'h1', completed_at: DAY, state: 'done' } as never, { id: 'x', habit_id: 'h2', completed_at: '2026-08-03', state: 'skip' } as never] });
    mockNet.serverRows = [{ id: 'srv', habit_id: 'h1', completed_at: DAY, state: 'partial', value: 2 }];

    await useLogStore.getState().dropSyncOp('dead-1');
    expect(useLogStore.getState().deadSyncCount).toBe(0);
    expect((await onDisk('A'))?.ops).toEqual([]);
    const logs = useLogStore.getState().logs;
    expect(logs.find((l) => l.habit_id === 'h1')).toMatchObject({ id: 'srv', state: 'partial' });
    expect(logs.find((l) => l.habit_id === 'h2')).toMatchObject({ id: 'x' }); // other days untouched
  });

  it('dropSyncOp with no server row clears the optimistic row', async () => {
    await deadOpFor('A');
    mockUserId = 'A';
    await useLogStore.getState().hydrateSyncQueue();
    useLogStore.setState({ logs: [{ id: 'local-1', habit_id: 'h1', completed_at: DAY, state: 'done' } as never] });
    await useLogStore.getState().dropSyncOp('dead-1');
    expect(useLogStore.getState().logs).toEqual([]);
  });

  it('a 503 keeps the tap like a lost connection (no rollback, no attempt spent) and nextSyncReadyAt reports its backoff', async () => {
    mockUserId = 'A';
    await useLogStore.getState().rebindSyncQueue('A');
    expect(useLogStore.getState().nextSyncReadyAt()).toBeNull();

    mockNet.serverStatus = 503;
    const res = await tap();
    expect(res.ok).toBe(true);
    expect(useLogStore.getState().logs).toHaveLength(1);
    expect(useLogStore.getState().pendingSyncCount).toBe(1);
    const op = (await onDisk('A'))!.ops[0];
    expect(op).toMatchObject({ attempts: 0, retryableCount: 1, status: 'pending' });
    expect(op.readyAt! - Date.now()).toBe(5_000);
    expect(useLogStore.getState().nextSyncReadyAt()).toBe(op.readyAt);

    // a refusal on its merits is still a rejection: rolled back, one attempt spent
    mockNet.serverStatus = 403;
    const refused = await tap('h2');
    expect(refused.ok).toBe(false);
    expect((await onDisk('A'))!.ops.find((o) => o.habitId === 'h2')).toMatchObject({ attempts: 1 });
  });
});
