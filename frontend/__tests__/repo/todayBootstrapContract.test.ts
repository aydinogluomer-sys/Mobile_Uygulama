// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('../helpers/sqliteAdapter').createExpoSqliteModule());

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { resetAccountMemory } from '../../lib/accountScope';
import { clearReadCacheMemory } from '../../lib/localReadCache';
import { TODAY_BOOTSTRAP_KEYS } from '../../repositories/todayBootstrapRepository';
import { coreOutbox } from '../../services/coreOutbox';
import { bootstrapTodayScreen } from '../../services/todayBootstrapService';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { useTaskStore } from '../../store/taskStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import { extractJsonbObjectKeys, readSource } from '../helpers/sourceText';
import { buildTodayBootstrapFixture } from '../helpers/todayBootstrapFixture';

const mockRpcResult: {
  data: unknown;
  error: { message: string; code?: string } | null;
  status: number;
} = {
  data: null,
  error: null,
  status: 200,
};

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
    rpc: async () => mockRpcResult,
    from: (table: string) => {
      throw new Error(`Unexpected table query to ${table} during RPC contract test`);
    },
  },
}));

describe('F48 C10a (TST-14) — Today Bootstrap SQL ↔ Client Key Contract', () => {
  const sql037 = readSource('..', 'supabase', 'migrations', '037_today_bootstrap_rpc.sql');

  beforeEach(async () => {
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

  it('(+) top-level jsonb_build_object keys of get_today_bootstrap in 037 match TODAY_BOOTSTRAP_KEYS', () => {
    const sqlKeys = extractJsonbObjectKeys(sql037, 'get_today_bootstrap');
    expect(sqlKeys).toEqual([...TODAY_BOOTSTRAP_KEYS]);
  });

  it('(+) typed fixture derived from TODAY_BOOTSTRAP_KEYS hydrates all five stores via bootstrapTodayScreen', async () => {
    const today = '2026-10-31';
    const payload = buildTodayBootstrapFixture(today);
    expect(Object.keys(payload)).toEqual([...TODAY_BOOTSTRAP_KEYS]);

    mockRpcResult.data = payload;
    mockRpcResult.error = null;
    mockRpcResult.status = 200;

    const res = await bootstrapTodayScreen(today);
    expect(res).toEqual({
      ok: true,
      mode: 'rpc',
      periodLogs: [{ habit_id: 'h1', completed_at: today, state: 'done', value: 1 }],
    });

    expect(useHabitStore.getState().habits).toHaveLength(1);
    expect(useHabitStore.getState().timeOffAvailable).toBe(true);
    expect(useHabitStore.getState().checklistAvailable).toBe(true);
    expect(useLogStore.getState().logs).toHaveLength(1);
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useWillpowerStore.getState().state?.daily_budget).toBe(15);
    expect(useRecoveryStore.getState().plans).toHaveLength(1);
  });

  it('(-) detects drift when SQL adds an unmapped top-level key (period_logs2)', () => {
    const driftedSql = sql037.replace(
      "'period_logs', v_period_logs,",
      "'period_logs', v_period_logs,\n    'period_logs2', v_period_logs,",
    );
    const driftedKeys = extractJsonbObjectKeys(driftedSql, 'get_today_bootstrap');
    expect(driftedKeys).not.toEqual([...TODAY_BOOTSTRAP_KEYS]);
    expect(driftedKeys).toContain('period_logs2');
  });

  it('(-) nested jsonb_build_object keys inside value expressions never leak into top-level keys', () => {
    const synthetic = [
      'CREATE OR REPLACE FUNCTION public.get_today_bootstrap(p_today date)',
      'RETURNS jsonb LANGUAGE plpgsql AS $function$',
      'BEGIN',
      '  -- jsonb_build_object(\'comment_ghost\', 1)',
      '  RETURN jsonb_build_object(',
      "    'today', p_today,",
      "    'willpower', COALESCE(v_wp, jsonb_build_object('inner_leaked_key', 99, 'another_inner', 'x')),",
      "    'tasks', '[]'::jsonb",
      '  );',
      'END;',
      '$function$;',
    ].join('\n');

    const keys = extractJsonbObjectKeys(synthetic, 'get_today_bootstrap');
    expect(keys).toEqual(['today', 'willpower', 'tasks']);
    expect(keys).not.toContain('inner_leaked_key');
    expect(keys).not.toContain('comment_ghost');
  });
});
