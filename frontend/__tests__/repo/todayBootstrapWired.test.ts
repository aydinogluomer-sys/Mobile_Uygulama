import { readFileSync } from 'fs';
import { join } from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { clearReadCacheMemory } from '../../lib/localReadCache';
import { coreOutbox } from '../../services/coreOutbox';
import { bootstrapTodayScreen } from '../../services/todayBootstrapService';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { useTaskStore } from '../../store/taskStore';
import { useWillpowerStore } from '../../store/willpowerStore';

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

describe('Item #5 — Atomic Single-RTT Today Bootstrap RPC (get_today_bootstrap)', () => {
  beforeEach(async () => {
    mockRpcState.calls.length = 0;
    mockFromCalls.length = 0;
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
      data: {
        today,
        habits: [
          {
            id: 'h1',
            user_id: 'u1',
            name: 'Sabah Koşusu',
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
          {
            id: 'l1',
            habit_id: 'h1',
            user_id: 'u1',
            completed_at: today,
            state: 'done',
            value: 1,
            xp: 10,
            is_completed: true,
          },
        ],
        period_logs: [
          { habit_id: 'h1', completed_at: today, state: 'done', value: 1 },
        ],
        tasks: [
          {
            id: 't1',
            user_id: 'u1',
            title: 'Mimari raporu tamamla',
            status: 'pending',
            priority: 'high',
            list_type: 'inbox',
            due_date: today,
            completed: false,
            created_at: '2026-10-31T09:00:00Z',
          },
        ],
        willpower: {
          user_id: 'u1',
          state_date: today,
          daily_budget: 15,
          used: 3,
          focus_capacity: 3,
          active_count: 1,
        },
        recovery_plans: [
          {
            id: 'rp1',
            user_id: 'u1',
            habit_id: 'h1',
            source_date: '2026-10-30',
            target_date: today,
            strategy: 'micro_version',
            status: 'planned',
            created_at: '2026-10-30T21:00:00Z',
          },
        ],
        time_off_available: true,
        pauses: [
          { id: 'p1', habit_id: 'h1', kind: 'pause', start_date: '2026-11-05', end_date: '2026-11-07' },
        ],
        goal_versions: [],
        checklist_available: true,
        checklist_items: [
          { id: 'ci1', habit_id: 'h1', title: 'Su iç', required: true, position: 0, created_at: '2026-10-01', archived_at: null },
        ],
        checklist_checks: [],
      },
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

  it('falls back cleanly when migration 037 is not yet applied on a frozen DB (PGRST202)', async () => {
    mockRpcState.result = {
      data: null,
      error: { message: 'Could not find the function public.get_today_bootstrap(p_today) in the schema cache', code: 'PGRST202' },
      status: 404,
    };
    const boot = await bootstrapTodayScreen('2026-10-31');
    expect(boot.ok).toBe(false);
  });

  it('wires bootstrapTodayScreen into app/tabs/today.tsx and defines 037_today_bootstrap_rpc.sql as SECURITY INVOKER', () => {
    const todaySrc = readFileSync(join(__dirname, '..', '..', 'app', 'tabs', 'today.tsx'), 'utf8');
    expect(todaySrc).toContain('bootstrapTodayScreen(today)');

    const sqlSrc = readFileSync(
      join(__dirname, '..', '..', '..', 'supabase', 'migrations', '037_today_bootstrap_rpc.sql'),
      'utf8',
    );
    expect(sqlSrc).toContain('SECURITY INVOKER');
    expect(sqlSrc).not.toContain('SECURITY DEFINER');
    expect(sqlSrc).toContain("to_regclass('public.habit_pauses')");
    expect(sqlSrc).toContain("to_regclass('public.habit_checklist_items')");
  });
});

