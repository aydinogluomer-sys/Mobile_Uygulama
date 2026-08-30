/**
 * A queued offline write belongs to the account that made it.
 *
 * ## The defect
 *
 * The queue was persisted under one global key, `atlas_sync_queue_v1`, and a
 * `SyncOp` carried a `habitId` and a value but no owner. The replay path
 * resolves the user at FLUSH time — `logStore`'s write reads
 * `supabase.auth.getUser()` when the op drains, not when it was enqueued.
 *
 * So on a device where user A logged habits offline, signed out, and user B
 * signed in, B's first foreground flush attempted A's writes **as B**. Two
 * separate problems in one:
 *
 *  - attribution: A's offline work drained through B's session, and A's
 *    pending writes were consumed from an account that never made them;
 *  - data at rest: A's habit ids and logged values sat in storage that B's
 *    session loaded and acted on.
 *
 * The queue is now keyed per account, and every op carries `userId` as a
 * second line of defence for anything already in memory.
 *
 * These are behaviour tests: they drive the real store through a sign-out /
 * sign-in and assert on what reaches the database mock.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockUserId: string | null = 'userA';
const inserted: Array<Record<string, unknown>> = [];

jest.mock('../../lib/supabase', () => {
  const chain = (table: string) => ({
    select: () => ({
      eq: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
    }),
    insert: (row: Record<string, unknown>) => ({
      select: () => ({
        single: () => {
          inserted.push({ table, ...row });
          return Promise.resolve({ data: { id: `row-${inserted.length}`, ...row }, error: null });
        },
      }),
    }),
    update: () => ({ eq: () => ({ eq: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: null }) }) }) }) }),
  });
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
        getUser: jest.fn(async () => ({ data: { user: mockUserId ? { id: mockUserId } : null } })),
      },
      from: (t: string) => chain(t),
    },
  };
});

import { useLogStore } from '../../store/logStore';
import { enqueue, emptyQueueState, saveSyncQueue, loadSyncQueue } from '../../lib/syncQueue';

const DATE = '2026-08-30';

beforeEach(async () => {
  inserted.length = 0;
  mockUserId = 'userA';
  await AsyncStorage.clear();
  useLogStore.setState({ logs: [], pendingSyncCount: 0, deadSyncCount: 0 });
});

describe("one account's offline queue never drains through another", () => {
  it('B does not load A queue at all', async () => {
    const { state } = enqueue(emptyQueueState(), 'habit-of-A', DATE, { state: 'done', baseXp: 30 });
    await saveSyncQueue(state, 'userA');

    mockUserId = 'userB';
    await useLogStore.getState().hydrateSyncQueue();

    expect(useLogStore.getState().pendingSyncCount).toBe(0);
  });

  it("B's flush writes nothing belonging to A", async () => {
    const { state } = enqueue(emptyQueueState(), 'habit-of-A', DATE, { state: 'done', baseXp: 30 });
    await saveSyncQueue(state, 'userA');

    mockUserId = 'userB';
    await useLogStore.getState().hydrateSyncQueue();
    const results = await useLogStore.getState().flushPendingSync();

    expect(results).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it("A's queue is still there when A signs back in", async () => {
    // The isolation must not be achieved by destroying the other account's
    // work -- that would trade a leak for silent data loss.
    const { state } = enqueue(emptyQueueState(), 'habit-of-A', DATE, { state: 'done', baseXp: 30 });
    await saveSyncQueue(state, 'userA');

    mockUserId = 'userB';
    await useLogStore.getState().hydrateSyncQueue();
    await useLogStore.getState().flushPendingSync();

    mockUserId = 'userA';
    await useLogStore.getState().hydrateSyncQueue();
    expect(useLogStore.getState().pendingSyncCount).toBe(1);

    const results = await useLogStore.getState().flushPendingSync();
    expect(results).toHaveLength(1);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ habit_id: 'habit-of-A', user_id: 'userA' });
  });

  it('signing out leaves no queue loaded', async () => {
    const { state } = enqueue(emptyQueueState(), 'habit-of-A', DATE, { state: 'done', baseXp: 30 });
    await saveSyncQueue(state, 'userA');
    await useLogStore.getState().hydrateSyncQueue();
    expect(useLogStore.getState().pendingSyncCount).toBe(1);

    mockUserId = null; // signed out
    await useLogStore.getState().hydrateSyncQueue();
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
    expect(await useLogStore.getState().flushPendingSync()).toEqual([]);
    expect(inserted).toEqual([]);
  });

  it('an in-memory op owned by someone else is refused even if it is loaded', async () => {
    // Defence in depth: the storage key is the primary guard, but an op that
    // reached memory some other way must still not be replayed.
    const { state } = enqueue(emptyQueueState(), 'habit-of-A', DATE, { state: 'done', baseXp: 30 });
    const foreign = { ...state, ops: state.ops.map((o) => ({ ...o, userId: 'userA' })) };
    await saveSyncQueue(foreign, 'userB'); // deliberately mis-filed

    mockUserId = 'userB';
    await useLogStore.getState().hydrateSyncQueue();
    const results = await useLogStore.getState().flushPendingSync();

    expect(results).toEqual([]);
    expect(inserted).toEqual([]);
  });
});

describe('legacy migration does not lose work', () => {
  it('adopts a pre-scoping queue for the first account, once', async () => {
    const { state } = enqueue(emptyQueueState(), 'legacy-habit', DATE, { state: 'done', baseXp: 30 });
    await AsyncStorage.setItem('atlas_sync_queue_v1', JSON.stringify(state));

    mockUserId = 'userA';
    await useLogStore.getState().hydrateSyncQueue();
    expect(useLogStore.getState().pendingSyncCount).toBe(1);

    // The legacy key is consumed, so a second account inherits nothing.
    mockUserId = 'userB';
    await useLogStore.getState().hydrateSyncQueue();
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
    expect(await loadSyncQueue('userB')).toEqual(emptyQueueState());
  });
});
