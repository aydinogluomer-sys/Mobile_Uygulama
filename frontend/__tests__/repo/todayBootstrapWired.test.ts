// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('../helpers/sqliteAdapter').createExpoSqliteModule());

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { resetAccountMemory } from '../../lib/accountScope';
import { clearReadCacheMemory } from '../../lib/localReadCache';
import { coreOutbox } from '../../services/coreOutbox';
import { bootstrapTodayScreen } from '../../services/todayBootstrapService';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { useTaskStore } from '../../store/taskStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import { readSource, sqlKeywordsOf, stripComments } from '../helpers/sourceText';
import { buildTodayBootstrapFixture } from '../helpers/todayBootstrapFixture';

const mockRpcState: {
  result: { data: unknown; error: { message: string; code?: string } | null; status: number };
  calls: { fn: string; args: Record<string, unknown> }[];
} = {
  result: { data: null, error: null, status: 200 },
  calls: [],
};

const mockFromCalls: string[] = [];

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'u1', email: 'u1@aderyth.app' }, access_token: 'tok' } },
        error: null,
      }),
      getUser: async () => ({
        data: { user: { id: 'u1', email: 'u1@aderyth.app' } },
        error: null,
      }),
    },
    rpc: async (fn: string, args: Record<string, unknown>) => {
      mockRpcState.calls.push({ fn, args });
      return mockRpcState.result;
    },
    from: (table: string) => {
      mockFromCalls.push(table);
      throw new Error(`Unexpected direct PostgREST call to ${table} when single-RTT RPC succeeded`);
    },
  },
}));

describe('Atomic Single-RTT Today Bootstrap RPC (get_today_bootstrap)', () => {
  beforeEach(async () => {
    mockRpcState.calls.length = 0;
    mockFromCalls.length = 0;
    resetAccountMemory('user_changed');
    coreOutbox.reset();
    clearReadCacheMemory();
    await AsyncStorage.clear();
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();

    useHabitStore.setState({
      habits: [],
      pauses: [],
      goalVersions: [],
      timeOffAvailable: null,
      checklistItems: [],
      checklistChecks: [],
      checklistAvailable: null,
      loading: false,
    });
    useLogStore.setState({ logs: [], loading: false });
    useTaskStore.setState({ tasks: [], cursor: null, hasMore: false, loading: false, error: null });
    useWillpowerStore.setState({ state: null, loading: false });
    useRecoveryStore.setState({ plans: [], loading: false });
  });

  it('hydrates habits (+ pauses/checklists), logs, tasks, willpower, recovery_plans and periodLogs in 1 single RPC call with 0 table waterfalls', async () => {
    const today = '2026-10-31';
    mockRpcState.result = {
      status: 200,
      error: null,
      data: buildTodayBootstrapFixture(today),
    };

    const boot = await bootstrapTodayScreen(today);
    expect(boot.ok).toBe(true);
    if (!boot.ok) return;
    expect(boot.mode).toBe('rpc');
    expect(boot.periodLogs).toHaveLength(1);
    expect(mockRpcState.calls).toEqual([{ fn: 'get_today_bootstrap', args: { p_today: today } }]);
    expect(mockFromCalls).toEqual([]);

    expect(useHabitStore.getState().habits).toHaveLength(1);
    expect(useHabitStore.getState().habits[0].pause_intervals).toHaveLength(1);
    expect(useHabitStore.getState().checklistItems).toHaveLength(1);
    expect(useLogStore.getState().logs).toHaveLength(1);
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useWillpowerStore.getState().state?.used).toBe(3);
    expect(useRecoveryStore.getState().plans).toHaveLength(1);

    // Wait for fire-and-forget SQLite cache write to settle before testing cold restart
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 10));

    // Offline cold restart: hydrates from SQLite SWR snapshot without hitting PostgREST
    clearReadCacheMemory();
    useHabitStore.setState({ habits: [] });
    useTaskStore.setState({ tasks: [] });
    mockRpcState.result = {
      data: null,
      error: { message: 'TypeError: Network request failed', code: '' },
      status: 0,
    };

    const offlineBoot = await bootstrapTodayScreen(today);
    expect(offlineBoot.ok).toBe(true);
    if (!offlineBoot.ok) return;
    expect(offlineBoot.mode).toBe('cache');
    expect(useHabitStore.getState().habits).toHaveLength(1);
    expect(useTaskStore.getState().tasks).toHaveLength(1);
  });

  it('returns ok:false on PGRST202 so the screen takes the table path', async () => {
    mockRpcState.result = {
      data: null,
      error: {
        message: 'Could not find the function public.get_today_bootstrap(p_today) in the schema cache',
        code: 'PGRST202',
      },
      status: 404,
    };
    const boot = await bootstrapTodayScreen('2026-10-31');
    expect(boot.ok).toBe(false);
  });

  it('wires bootstrapTodayScreen into app/tabs/today.tsx and defines 037_today_bootstrap_rpc.sql as SECURITY INVOKER', () => {
    const todaySrc = stripComments(readSource('app', 'tabs', 'today.tsx'));
    expect(todaySrc).toContain('bootstrapTodayScreen(today)');

    const sqlSrc = readSource('..', 'supabase', 'migrations', '037_today_bootstrap_rpc.sql');
    const kw = sqlKeywordsOf(sqlSrc);
    expect(kw).toContain('SECURITY INVOKER');
    expect(kw).not.toContain('SECURITY DEFINER');
    expect(sqlSrc).toContain("to_regclass('public.habit_pauses')");
    expect(sqlSrc).toContain("to_regclass('public.habit_checklist_items')");
  });
});
