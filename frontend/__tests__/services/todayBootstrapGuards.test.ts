// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('../helpers/sqliteAdapter').createExpoSqliteModule());

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { resetAccountMemory } from '../../lib/accountScope';
import * as localReadCache from '../../lib/localReadCache';
import { coreOutbox } from '../../services/coreOutbox';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type RpcReply = { data: unknown; error: { message: string; code?: string } | null; status: number };

const mockRpcState: {
  handler: () => Promise<RpcReply>;
  calls: { fn: string; args: Record<string, unknown> }[];
  userId: string;
} = {
  handler: async () => ({ data: null, error: null, status: 200 }),
  calls: [],
  userId: 'u1',
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: mockRpcState.userId, email: 'u1@aderyth.app' }, access_token: 'tok' } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: mockRpcState.userId, email: 'u1@aderyth.app' } },
        error: null,
      }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mockRpcState.calls.push({ fn, args });
      return mockRpcState.handler();
    },
    from: (table: string) => {
      throw new Error(`Unexpected direct table access: ${table}`);
    },
  },
}));

import {
  BOOTSTRAP_MISSING_RPC_TTL_MS,
  bootstrapTodayScreen,
  parseBootstrapPayload,
} from '../../services/todayBootstrapService';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { useTaskStore } from '../../store/taskStore';
import { useWillpowerStore } from '../../store/willpowerStore';

const validRpcData = (today: string) => ({
  today,
  habits: [
    {
      id: 'h1',
      user_id: 'u1',
      name: 'Koşu',
      status: 'active',
      behavior_type: 'positive',
      tracking_type: 'boolean',
      frequency_config: { kind: 'daily' },
      willpower_cost: 2,
      difficulty: 2,
      estimated_minutes: 20,
      created_at: '2026-10-01T08:00:00Z',
    },
  ],
  today_logs: [
    { id: 'l1', habit_id: 'h1', user_id: 'u1', completed_at: today, state: 'done', value: 1, xp: 10, is_completed: true },
  ],
  period_logs: [{ habit_id: 'h1', completed_at: today, state: 'done', value: 1 }],
  tasks: [
    { id: 't1', user_id: 'u1', title: 'Görev', status: 'pending', priority: 'medium', list_type: 'inbox', completed: false, created_at: '2026-10-31T09:00:00Z' },
  ],
  willpower: { user_id: 'u1', state_date: today, daily_budget: 15, used: 2, focus_capacity: 3, active_count: 1 },
  recovery_plans: [
    { id: 'rp1', user_id: 'u1', habit_id: 'h1', source_date: '2026-10-29', target_date: today, strategy: 'micro_version', status: 'planned', created_at: 'now' },
  ],
  time_off_available: true,
  pauses: [],
  goal_versions: [],
  checklist_available: true,
  checklist_items: [],
  checklist_checks: [],
});

describe('todayBootstrapGuards — SYN-24 & Gemini I2', () => {
  let now = 1_000_000;
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(async () => {
    mockRpcState.calls.length = 0;
    mockRpcState.userId = 'u1';
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    resetAccountMemory('signed_out');
    coreOutbox.reset();
    localReadCache.clearReadCacheMemory();
    await AsyncStorage.clear();
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('caches missing RPC (PGRST202) negatively for BOOTSTRAP_MISSING_RPC_TTL_MS and retries afterwards', async () => {
    mockRpcState.handler = async () => ({
      data: null,
      error: { message: 'Could not find the function public.get_today_bootstrap', code: 'PGRST202' },
      status: 404,
    });

    expect((await bootstrapTodayScreen('2026-10-31')).ok).toBe(false);
    expect(mockRpcState.calls).toHaveLength(1);

    // Second call within 6h TTL does NOT hit supabase.rpc
    now += BOOTSTRAP_MISSING_RPC_TTL_MS - 1_000;
    expect((await bootstrapTodayScreen('2026-10-31')).ok).toBe(false);
    expect(mockRpcState.calls).toHaveLength(1);

    // Past 6h TTL -> retries RPC
    now += 2_000;
    mockRpcState.handler = async () => ({ status: 200, error: null, data: validRpcData('2026-10-31') });
    expect((await bootstrapTodayScreen('2026-10-31')).ok).toBe(true);
    expect(mockRpcState.calls).toHaveLength(2);
  });

  it('does not await setCachedSnapshot on the critical path and validates payload shape via parseBootstrapPayload', async () => {
    expect(parseBootstrapPayload(null)).toBeNull();
    expect(parseBootstrapPayload({ today: '2026-10-31' })).toBeNull();

    const filtered = parseBootstrapPayload({
      userId: 'u1',
      today: '2026-10-31',
      habits: [{ id: 'h-ok', name: 'Geçerli' }, { name: 'Kimliksiz' }, null],
      tasks: [{ id: 't-ok', title: 'Geçerli' }, { id: 123 }],
    });
    expect(filtered?.habits.map((h) => h.id)).toEqual(['h-ok']);
    expect(filtered?.tasks.map((t) => t.id)).toEqual(['t-ok']);
    expect(filtered?.period_logs).toEqual([]);

    // Never-resolving setCachedSnapshot must NOT block bootstrapTodayScreen
    const hangSpy = jest
      .spyOn(localReadCache, 'setCachedSnapshot')
      .mockReturnValueOnce(new Promise<void>(() => undefined));

    mockRpcState.handler = async () => ({ status: 200, error: null, data: validRpcData('2026-10-31') });
    const out = await bootstrapTodayScreen('2026-10-31');
    expect(out.ok).toBe(true);
    hangSpy.mockRestore();
  });

  it('skips overwriting habits when habitMutationEpoch moves mid-RPC (Gemini I2) and drops response on account switch', async () => {
    const rpcGate = deferred<RpcReply>();
    mockRpcState.handler = () => rpcGate.promise;

    const pBoot = bootstrapTodayScreen('2026-10-31');
    await Promise.resolve();
    await Promise.resolve();

    // Local habit install completes while bootstrap RPC is still on the wire
    useHabitStore.getState().addInstalledHabits([
      { ...validRpcData('2026-10-31').habits[0], id: 'h-local-fresh', name: 'Yerel Yeni Alışkanlık' } as never,
    ]);

    rpcGate.resolve({ status: 200, error: null, data: validRpcData('2026-10-31') });
    const boot = await pBoot;
    expect(boot.ok).toBe(true);
    // Habits block was skipped -> local fresh habit was NOT overwritten by stale RPC snapshot!
    expect(useHabitStore.getState().habits.map((h) => h.id)).toEqual(['h-local-fresh']);
    // Other stores still hydrated
    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(['t1']);

    // Account switch mid-RPC drops everything
    const switchGate = deferred<RpcReply>();
    mockRpcState.handler = () => switchGate.promise;
    const pSwitch = bootstrapTodayScreen('2026-10-31');
    await Promise.resolve();
    resetAccountMemory('user_changed');

    switchGate.resolve({ status: 200, error: null, data: validRpcData('2026-10-31') });
    expect((await pSwitch).ok).toBe(false);
    expect(useHabitStore.getState().habits).toEqual([]);
    expect(useTaskStore.getState().tasks).toEqual([]);
  });

  it('falls back to yesterday latest snapshot offline when today key is missing, and hydrates all stores on normal RPC (negative case)', async () => {
    // Populate yesterday's snapshot via normal RPC (negative case check too)
    useLogStore.setState({
      logs: [{ id: 'other-day', habit_id: 'h9', user_id: 'u1', completed_at: '2026-10-29', state: 'done', value: 1, xp: 10, is_completed: true } as never],
    });
    mockRpcState.handler = async () => ({ status: 200, error: null, data: validRpcData('2026-10-30') });
    const online = await bootstrapTodayScreen('2026-10-30');
    expect(online).toEqual({ ok: true, mode: 'rpc', periodLogs: expect.any(Array) });
    expect(useHabitStore.getState().habits).toHaveLength(1);
    expect(useWillpowerStore.getState().state?.used).toBe(2);
    expect(useRecoveryStore.getState().plans).toHaveLength(1);
    // applyFetchedDay preserved 2026-10-29 while adding 2026-10-30
    expect(useLogStore.getState().logs).toHaveLength(2);

    await new Promise((r) => setTimeout(r, 15));

    // Next morning offline: '2026-10-31' has no snapshot, falls back to '2026-10-30' via getLatestSnapshot
    localReadCache.clearReadCacheMemory();
    useHabitStore.setState({ habits: [] });
    useTaskStore.setState({ tasks: [] });
    mockRpcState.handler = async () => ({
      data: null,
      error: { message: 'TypeError: Network request failed', code: '' },
      status: 0,
    });

    const offline = await bootstrapTodayScreen('2026-10-31');
    expect(offline.ok).toBe(true);
    if (offline.ok) expect(offline.mode).toBe('cache');
    expect(useHabitStore.getState().habits.map((h) => h.id)).toEqual(['h1']);
    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(['t1']);
  });
});
