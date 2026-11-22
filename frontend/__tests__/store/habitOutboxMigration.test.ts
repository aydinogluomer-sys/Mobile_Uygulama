import AsyncStorage from '@react-native-async-storage/async-storage';

let mockUserId: string | null = 'u1';
const mockServer = {
  online: true,
  rejectStatus: 0,
  gateFirst: null as Promise<void> | null,
  writes: [] as { kind: 'insert' | 'update'; habitId: string; state: unknown; value: unknown }[],
  rows: new Map<string, { id: string; habit_id: string; user_id: string; completed_at: string; state: string; value: number | null; is_completed: boolean; xp: number; created_at: string }>(),
};

jest.mock('../../lib/supabase', () => {
  const offline = { data: null, error: { message: 'TypeError: Network request failed', code: '' }, status: 0 };
  return {
    supabase: {
      auth: {
        getSession: async () => ({
          data: { session: mockUserId ? { user: { id: mockUserId }, access_token: 'jwt' } : null },
          error: null,
        }),
        getUser: async () => ({
          data: { user: mockUserId ? { id: mockUserId } : null },
          error: null,
        }),
      },
      from: () => ({
        select: () => {
          const filters: Record<string, string> = {};
          const q = {
            eq(k: string, v: string) {
              filters[k] = v;
              return q;
            },
            maybeSingle: async () => {
              if (!mockServer.online) return offline;
              const key = `${filters.habit_id}|${filters.completed_at}`;
              return { data: mockServer.rows.get(key) ?? null, error: null, status: 200 };
            },
          };
          return q;
        },
        insert: (payload: Record<string, unknown>) => ({
          select: () => ({
            single: async () => {
              if (mockServer.gateFirst) {
                const g = mockServer.gateFirst;
                mockServer.gateFirst = null;
                await g;
              }
              if (!mockServer.online) return offline;
              if (mockServer.rejectStatus) {
                return {
                  data: null,
                  error: { message: 'RLS rejected', code: '42501' },
                  status: mockServer.rejectStatus,
                };
              }
              const key = `${String(payload.habit_id)}|${String(payload.completed_at)}`;
              if (mockServer.rows.has(key)) {
                return { data: null, error: { message: 'duplicate key', code: '23505' }, status: 409 };
              }
              const row = {
                id: `srv-${mockServer.rows.size + 1}`,
                habit_id: String(payload.habit_id),
                user_id: String(payload.user_id),
                completed_at: String(payload.completed_at),
                state: String(payload.state),
                value: (payload.value as number | null) ?? null,
                is_completed: Boolean(payload.is_completed),
                xp: 10,
                created_at: '2026-08-04T10:00:00Z',
              };
              mockServer.rows.set(key, row);
              mockServer.writes.push({ kind: 'insert', habitId: row.habit_id, state: row.state, value: row.value });
              return { data: row, error: null, status: 201 };
            },
          }),
        }),
        update: (payload: Record<string, unknown>) => {
          const filters: Record<string, string> = {};
          const applyUpdate = async () => {
            if (!mockServer.online) return offline;
            const found = [...mockServer.rows.values()].find((r) => r.id === filters.id);
            if (!found) return { data: null, error: { message: 'missing' }, status: 404 };
            const updated = {
              ...found,
              state: String(payload.state ?? found.state),
              value: (payload.value as number | null) ?? found.value,
              is_completed: Boolean(payload.is_completed ?? found.is_completed),
            };
            mockServer.rows.set(`${updated.habit_id}|${updated.completed_at}`, updated);
            mockServer.writes.push({ kind: 'update', habitId: updated.habit_id, state: updated.state, value: updated.value });
            return { data: updated, error: null, status: 200 };
          };
          const u = {
            eq(k: string, v: string) {
              filters[k] = v;
              return u;
            },
            select: () => ({
              single: applyUpdate,
              maybeSingle: applyUpdate,
            }),
          };
          return u;
        },
      }),
    },
  };
});

import { resetAccountMemory } from '../../lib/accountScope';
import { MAX_ATTEMPTS } from '../../lib/outbox';
import {
  habitMigratedKey,
  legacyHabitMigratedKey,
  legacyHabitQueueKey,
  migrateLegacyHabitQueue,
} from '../../lib/outboxEngine';
import { asyncStorageOutboxNs, namespacedOutboxKey, type OutboxStorage } from '../../lib/outboxStorage';
import { emptyQueueState, enqueue as legacyEnqueue, QUARANTINE_KEY, saveSyncQueue } from '../../lib/syncQueue';
import { NO_SESSION_ERROR, useLogStore } from '../../store/logStore';
import { pinToday } from '../helpers/pinnedClock';

const DAY_STR = '2026-08-04';
const DAY_DATE = new Date(2026, 7, 4, 12, 0, 0);
pinToday(DAY_DATE);

describe('F46 (5.2-h) — Stage G habit-log queue migration, in-flight race regression & isolation', () => {
  beforeEach(async () => {
    mockUserId = null;
    mockServer.online = true;
    mockServer.rejectStatus = 0;
    mockServer.gateFirst = null;
    mockServer.writes = [];
    mockServer.rows.clear();

    await useLogStore.getState().rebindSyncQueue(null);
    resetAccountMemory('signed_out');
    await AsyncStorage.clear();
    useLogStore.setState({ logs: [], pendingSyncCount: 0, deadSyncCount: 0, logsError: null });
    mockUserId = 'u1';
  });

  it('(+) migrates legacy atlas_sync_queue_v1:<uid> + matching quarantine ops, writes .migrated + marker, flushes once, and is idempotent on second boot', async () => {
    let legacy = legacyEnqueue(emptyQueueState(), 'h-1', DAY_STR, { state: 'done', baseXp: 30 }, { id: 'leg-1', userId: 'u1' }).state;
    legacy = {
      ...legacy,
      ops: [
        ...legacy.ops,
        {
          id: 'foreign-1',
          habitId: 'h-foreign',
          date: DAY_STR,
          intent: { state: 'done' },
          attempts: 0,
          status: 'pending',
          seq: 9,
          createdAt: 10,
          updatedAt: 10,
          userId: 'u-other',
        },
      ],
    };
    await saveSyncQueue(legacy, 'u1');
    await AsyncStorage.setItem(
      QUARANTINE_KEY,
      JSON.stringify([
        {
          id: 'quar-u1',
          habitId: 'h-2',
          date: DAY_STR,
          intent: { state: 'partial', value: 3, targetValue: 5 },
          attempts: 0,
          status: 'pending',
          seq: 2,
          createdAt: 20,
          updatedAt: 20,
          userId: 'u1',
        },
      ]),
    );

    await useLogStore.getState().hydrateSyncQueue();
    expect(await AsyncStorage.getItem(habitMigratedKey('u1'))).toBe('1');
    expect(await AsyncStorage.getItem(legacyHabitQueueKey('u1'))).toBeNull();
    expect(await AsyncStorage.getItem(legacyHabitMigratedKey('u1'))).not.toBeNull();
    expect(useLogStore.getState().pendingSyncCount).toBe(2);

    // Second boot hydration is idempotent (still 2 commands, not 4)
    await useLogStore.getState().hydrateSyncQueue();
    expect(useLogStore.getState().pendingSyncCount).toBe(2);

    // Overlapping flushPendingSync calls coalesce and apply each migrated op ONCE
    const [r1, r2] = await Promise.all([
      useLogStore.getState().flushPendingSync(),
      useLogStore.getState().flushPendingSync(),
    ]);
    expect(r1).toHaveLength(2);
    expect(r2).toEqual(r1);
    expect(mockServer.writes.map((w) => w.habitId)).toEqual(['h-1', 'h-2']);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
  });

  it('(+) REGRESSION (step 31): a second tap while the first attempt is IN FLIGHT queues behind it and is NEVER dropped by the first attempt settling', async () => {
    await useLogStore.getState().rebindSyncQueue('u1');
    let releaseFirst!: () => void;
    mockServer.gateFirst = new Promise<void>((r) => {
      releaseFirst = r;
    });

    // Tap 1 ('done') goes out on the wire and pauses at gateFirst...
    const p1 = useLogStore.getState().logHabit({ habitId: 'h-race', date: DAY_DATE, state: 'done' });
    for (let i = 0; i < 15; i += 1) await Promise.resolve();

    // Tap 2 ('partial', value: 2) arrives while Tap 1 is still in flight (`sending: true`)!
    const p2 = useLogStore.getState().logHabit({
      habitId: 'h-race',
      date: DAY_DATE,
      state: 'partial',
      value: 2,
      targetValue: 5,
    });
    for (let i = 0; i < 10; i += 1) await Promise.resolve();

    releaseFirst();
    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);

    // Both writes executed in strict order (insert 'done' -> update 'partial'), second intent NOT lost!
    expect(mockServer.writes).toEqual([
      { kind: 'insert', habitId: 'h-race', state: 'done', value: null },
      { kind: 'update', habitId: 'h-race', state: 'partial', value: 2 },
    ]);
    expect(useLogStore.getState().getLogForHabit('h-race', DAY_STR)).toMatchObject({
      state: 'partial',
      value: 2,
    });
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
  });

  it('(-) read-back verification failure leaves legacy key untouched and writes NO migration marker', async () => {
    const legacy = legacyEnqueue(emptyQueueState(), 'h-keep', DAY_STR, { state: 'done' }, { id: 'keep-1', userId: 'u1' }).state;
    await saveSyncQueue(legacy, 'u1');

    const brokenStorage: OutboxStorage = {
      load: async (uid) => asyncStorageOutboxNs('habit').load(uid),
      save: async () => {
        // Pretend save succeeded without writing -> read-back verification MUST catch mismatch!
      },
    };

    const ok = await migrateLegacyHabitQueue('u1', brokenStorage);
    expect(ok).toBe(false);
    expect(await AsyncStorage.getItem(habitMigratedKey('u1'))).toBeNull();
    expect(await AsyncStorage.getItem(legacyHabitQueueKey('u1'))).not.toBeNull();
    expect(await AsyncStorage.getItem(legacyHabitMigratedKey('u1'))).toBeNull();
  });

  it('(-) isolates Account A -> B switches, dies after 6 server rejections, and refuses signed-out logHabit', async () => {
    await useLogStore.getState().rebindSyncQueue('u1');
    mockServer.online = false;
    await useLogStore.getState().logHabit({ habitId: 'h-a', date: DAY_DATE, state: 'done' });
    expect(useLogStore.getState().pendingSyncCount).toBe(1);

    // Switch to u2 -> u1 command never sent under u2
    mockUserId = 'u2';
    mockServer.online = true;
    await useLogStore.getState().rebindSyncQueue('u2');
    await useLogStore.getState().flushPendingSync();
    expect(mockServer.writes).toEqual([]);
    expect(await AsyncStorage.getItem(namespacedOutboxKey('habit', 'u2'))).toBeNull();

    // 6 rejections on u2 -> dead
    mockServer.rejectStatus = 403;
    const first = await useLogStore.getState().logHabit({ habitId: 'h-bad', date: DAY_DATE, state: 'done' });
    expect(first.ok).toBe(false);
    let clock = Date.now();
    for (let i = 1; i < MAX_ATTEMPTS; i += 1) {
      clock += 2 * 3600_000;
      await useLogStore.getState().flushPendingSync(clock);
    }
    expect(useLogStore.getState().deadSyncCount).toBe(1);

    // Signed-out logHabit -> NO_SESSION_ERROR
    mockUserId = null;
    await useLogStore.getState().rebindSyncQueue(null);
    const noSess = await useLogStore.getState().logHabit({ habitId: 'h-anon', date: DAY_DATE, state: 'done' });
    expect(noSess).toEqual({ ok: false, error: NO_SESSION_ERROR });
  });
});
