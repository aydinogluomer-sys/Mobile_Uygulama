const mockDisk = new Map<string, string>();
const mockAuth = { userId: 'u-a' as string | null };
const mockTransport = {
  offline: true,
  writtenPatches: [] as { habitId: string; dateStr: string; patch: Record<string, unknown> }[],
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k: string) => mockDisk.get(k) ?? null),
  setItem: jest.fn(async (k: string, v: string) => {
    mockDisk.set(k, v);
  }),
  removeItem: jest.fn(async (k: string) => {
    mockDisk.delete(k);
  }),
}));

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () =>
    mockAuth.userId ? { id: mockAuth.userId, email: null } : null,
  ),
}));

jest.mock('../../services/webhookService', () => ({
  notify: jest.fn(),
}));

jest.mock('../../repositories/habitLogRepository', () => ({
  fetchLogsForDate: jest.fn(async () => ({ ok: true, data: [] })),
  findHabitLog: jest.fn(async () => ({ ok: true, data: null })),
  insertHabitLog: jest.fn(
    async (params: { habitId: string; dateStr: string; patch: Record<string, unknown> }) => {
      if (mockTransport.offline) {
        return { ok: false, error: 'Network request failed', offline: true, status: 0 };
      }
      mockTransport.writtenPatches.push(params);
      return {
        ok: true,
        data: {
          id: `srv-${params.habitId}-${params.dateStr}`,
          habit_id: params.habitId,
          user_id: mockAuth.userId ?? '',
          completed_at: params.dateStr,
          value: (params.patch.value as number | null) ?? null,
          is_completed: Boolean(params.patch.is_completed),
          state: params.patch.state as 'done' | 'partial' | 'skip' | 'miss',
          xp: 0,
          created_at: '2026-08-19T10:00:00Z',
        },
      };
    },
  ),
  updateHabitLog: jest.fn(async (id: string, patch: Record<string, unknown>) => {
    if (mockTransport.offline) {
      return { ok: false, error: 'Network request failed', offline: true, status: 0 };
    }
    mockTransport.writtenPatches.push({ habitId: id, dateStr: '', patch });
    return {
      ok: true,
      data: {
        id,
        habit_id: 'h1',
        user_id: mockAuth.userId ?? '',
        completed_at: '2026-08-19',
        value: (patch.value as number | null) ?? null,
        is_completed: Boolean(patch.is_completed),
        state: patch.state as 'done' | 'partial' | 'skip' | 'miss',
        xp: 0,
        created_at: '2026-08-19T10:00:00Z',
      },
    };
  }),
  updateLogNote: jest.fn(),
}));

import { emptyQueueState, enqueue, loadSyncQueue, saveSyncQueue } from '../../lib/syncQueue';
import { todayLocal, parseLocalDate } from '../../lib/date';
import { useLogStore } from '../../store/logStore';

beforeEach(async () => {
  mockDisk.clear();
  mockAuth.userId = 'u-a';
  mockTransport.offline = true;
  mockTransport.writtenPatches = [];
  useLogStore.setState({ logs: [], pendingSyncCount: 0, deadSyncCount: 0, logsError: null });
  await useLogStore.getState().rebindSyncQueue('u-a');
});

describe('syncQueue & logStore — offline habit note queueing (F31 PS-03 / F05)', () => {
  it('(+) enqueue preserves prior note when subsequent tap omits note, replaces on string, and clears on null', () => {
    const q0 = emptyQueueState();
    const { state: q1, op: op1 } = enqueue(q0, 'h1', '2026-08-19', {
      state: 'skip',
      note: 'yorgundum',
    });
    expect(op1.intent.note).toBe('yorgundum');

    // Second tap without note -> preserves 'yorgundum'
    const { state: q2, op: op2 } = enqueue(q1, 'h1', '2026-08-19', {
      state: 'partial',
      value: 2,
    });
    expect(op2.intent.note).toBe('yorgundum');

    // Third tap with new string -> replaces note
    const { state: q3, op: op3 } = enqueue(q2, 'h1', '2026-08-19', {
      state: 'partial',
      value: 3,
      note: 'yarısını yaptım',
    });
    expect(op3.intent.note).toBe('yarısını yaptım');

    // Fourth tap with note: null -> clears note
    const { op: op4 } = enqueue(q3, 'h1', '2026-08-19', {
      state: 'done',
      note: null,
    });
    expect(op4.intent.note).toBeNull();
  });

  it('(+) loadSyncQueue validates intent.note without dropping the op on malformed note', async () => {
    const raw = JSON.stringify({
      nextSeq: 2,
      ops: [
        {
          id: 'op-1',
          habitId: 'h1',
          date: '2026-08-19',
          intent: { state: 'skip', note: 12345 },
          attempts: 0,
          status: 'pending',
          seq: 1,
          createdAt: 1,
          updatedAt: 1,
          userId: 'u-a',
        },
      ],
    });
    mockDisk.set('atlas_sync_queue_v1:u-a', raw);
    const loaded = await loadSyncQueue('u-a');
    expect(loaded.ops).toHaveLength(1);
    expect(loaded.ops[0].intent.note).toBeUndefined();

    // Valid note survives round-trip capped at 280 code points
    const q = enqueue(emptyQueueState(), 'h1', '2026-08-19', {
      state: 'skip',
      note: 'x'.repeat(300),
    }, { userId: 'u-a' });
    await saveSyncQueue(q.state, 'u-a');
    const reloaded = await loadSyncQueue('u-a');
    expect(reloaded.ops[0].intent.note).toHaveLength(280);
  });

  it('(+) offline logHabit queues intent.note, preserves it across noteless collapse, flushes notes online, and (-) never puts notes in logStore.logs or leaks across accounts', async () => {
    const todayStr = todayLocal();
    const todayDate = parseLocalDate(todayStr)!;

    // 1) Offline logHabit with note
    const r1 = await useLogStore.getState().logHabit({
      habitId: 'h1',
      date: todayDate,
      state: 'skip',
      note: '  migren tuttu  ',
    });
    expect(r1.ok).toBe(true);

    // (-) logStore.logs rows NEVER carry a notes field (optimistic)
    for (const row of useLogStore.getState().logs) {
      expect('notes' in row).toBe(false);
    }

    // 2) Second offline tap without note -> preserves queued note
    await useLogStore.getState().logHabit({
      habitId: 'h1',
      date: todayDate,
      state: 'partial',
      value: 1,
      targetValue: 2,
    });

    // 3) (-) Switch to account B -> account A's noted op NEVER flushes under B
    mockAuth.userId = 'u-b';
    mockTransport.offline = false;
    await useLogStore.getState().rebindSyncQueue('u-b');
    await useLogStore.getState().flushPendingSync();
    expect(mockTransport.writtenPatches).toHaveLength(0);

    // 4) (+) Switch back to account A -> flushes with preserved notes!
    mockAuth.userId = 'u-a';
    await useLogStore.getState().rebindSyncQueue('u-a');
    await useLogStore.getState().flushPendingSync();

    expect(mockTransport.writtenPatches.length).toBeGreaterThanOrEqual(1);
    expect(mockTransport.writtenPatches[0].patch).toEqual(
      expect.objectContaining({
        state: 'partial',
        notes: 'migren tuttu',
      }),
    );

    // (-) Confirmed row in logStore.logs also has no notes field
    for (const row of useLogStore.getState().logs) {
      expect('notes' in row).toBe(false);
    }
  });
});
