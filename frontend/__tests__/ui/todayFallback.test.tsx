// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-sqlite', () => require('../helpers/sqliteAdapter').createExpoSqliteModule());

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import React from 'react';

jest.setTimeout(30_000);

const mockRpc = jest.fn();

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../lib/dialog', () => ({
  actionSheet: jest.fn(async () => null),
  confirm: jest.fn(async () => false),
  notify: jest.fn(async () => undefined),
}));
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: 'u1@aderyth.app' })),
}));
jest.mock('../../lib/notifications', () => ({
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
}));
jest.mock('../../components/XPDisplay', () => () => null);
jest.mock('../../services/reviewService', () => ({
  logsForPeriod: jest.fn(async () => ({ ok: true, data: [] })),
}));
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
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

const mockFetchHabits = jest.fn(async () => undefined);
const mockFetchLogsForDate = jest.fn(async () => undefined);
const mockFetchTasks = jest.fn(async () => undefined);
const mockFetchToday = jest.fn(async () => undefined);
const mockFetchPlans = jest.fn(async () => undefined);

jest.mock('../../store/habitStore', () => {
  const actual = jest.requireActual('../../store/habitStore');
  const state: Record<string, any> = {
    habits: [],
    pauses: [],
    goalVersions: [],
    timeOffAvailable: false,
    checklistItems: [],
    checklistChecks: [],
    checklistAvailable: false,
    loading: false,
    error: null,
    hasLoaded: true,
    fetchHabits: (...args: unknown[]) => mockFetchHabits(...(args as [])),
  };
  const useHabitStore: any = (sel?: (s: any) => unknown) => (sel ? sel(state) : state);
  useHabitStore.getState = () => state;
  useHabitStore.setState = (patch: Record<string, unknown>) => Object.assign(state, patch);
  useHabitStore.subscribe = () => () => undefined;
  return {
    ...actual,
    useHabitStore,
  };
});

jest.mock('../../store/logStore', () => {
  const state: Record<string, any> = {
    logs: [],
    loading: false,
    pendingSyncCount: 0,
    deadSyncCount: 0,
    getLogForHabit: () => undefined,
    logHabit: jest.fn(async () => ({ ok: true })),
    applyFetchedDay: jest.fn(),
    fetchLogsForDate: (...args: unknown[]) => mockFetchLogsForDate(...(args as [])),
  };
  const useLogStore: any = (sel?: (s: any) => unknown) => (sel ? sel(state) : state);
  useLogStore.getState = () => state;
  useLogStore.setState = (patch: Record<string, unknown>) => Object.assign(state, patch);
  useLogStore.subscribe = () => () => undefined;
  return { useLogStore };
});

jest.mock('../../store/taskStore', () => {
  const actual = jest.requireActual('../../store/taskStore');
  const base = actual.useTaskStore.getInitialState();
  const state: Record<string, any> = {
    ...base,
    tasks: [],
    outbox: null,
    cursor: null,
    hasMore: false,
    loading: false,
    error: null,
    sync: { pending: 0, dead: 0, conflict: 0, authBlocked: false },
    fetchTasks: (...args: unknown[]) => mockFetchTasks(...(args as [])),
  };
  const useTaskStore: any = (sel?: (s: any) => unknown) => (sel ? sel(state) : state);
  useTaskStore.getState = () => state;
  useTaskStore.getInitialState = () => base;
  useTaskStore.setState = (patch: Record<string, unknown>) => Object.assign(state, patch);
  useTaskStore.subscribe = () => () => undefined;
  return { ...actual, useTaskStore };
});

jest.mock('../../store/willpowerStore', () => {
  const state: Record<string, any> = {
    state: null,
    loading: false,
    isStale: () => false,
    fetchToday: (...args: unknown[]) => mockFetchToday(...(args as [])),
  };
  const useWillpowerStore: any = (sel?: (s: any) => unknown) => (sel ? sel(state) : state);
  useWillpowerStore.getState = () => state;
  useWillpowerStore.setState = (patch: Record<string, unknown>) => Object.assign(state, patch);
  return { useWillpowerStore };
});

jest.mock('../../store/recoveryStore', () => {
  const state: Record<string, any> = {
    plans: [],
    loading: false,
    fetchPlans: (...args: unknown[]) => mockFetchPlans(...(args as [])),
  };
  const useRecoveryStore: any = (sel?: (s: any) => unknown) => (sel ? sel(state) : state);
  useRecoveryStore.getState = () => state;
  useRecoveryStore.setState = (patch: Record<string, unknown>) => Object.assign(state, patch);
  return { useRecoveryStore };
});

import TodayScreen from '../../app/tabs/today';
import { resetAccountMemory } from '../../lib/accountScope';
import { ymd } from '../../lib/date';
import { clearReadCacheMemory } from '../../lib/localReadCache';
import { coreOutbox } from '../../services/coreOutbox';
import {
  act,
  renderWithProviders,
  screen,
  waitFor,
} from '../helpers/renderWithProviders';
import { buildTodayBootstrapFixture } from '../helpers/todayBootstrapFixture';

describe('F48 C10a (TST-14) — TodayScreen PGRST202 Parallel Store Fallback', () => {
  beforeEach(async () => {
    resetAccountMemory('user_changed');
    coreOutbox.reset();
    clearReadCacheMemory();
    await AsyncStorage.clear();
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();

    mockRpc.mockReset();
    mockFetchHabits.mockClear();
    mockFetchLogsForDate.mockClear();
    mockFetchTasks.mockClear();
    mockFetchToday.mockClear();
    mockFetchPlans.mockClear();
  });

  it('(+) invokes all five parallel store fetch* fallbacks exactly once on PGRST202 and renders zero error alerts', async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.get_today_bootstrap(p_today) in the schema cache',
      },
      status: 404,
    });

    const r = renderWithProviders(<TodayScreen />);
    await waitFor(() => {
      expect(mockFetchHabits).toHaveBeenCalledTimes(1);
      expect(mockFetchLogsForDate).toHaveBeenCalledTimes(1);
      expect(mockFetchTasks).toHaveBeenCalledTimes(1);
      expect(mockFetchToday).toHaveBeenCalledTimes(1);
      expect(mockFetchPlans).toHaveBeenCalledTimes(1);
    });
    await act(async () => {});

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/PGRST202/i)).toBeNull();
    await act(async () => {
      r.unmount();
    });
  });

  it('(-) skips all five fallback fetch* loaders when get_today_bootstrap succeeds and shows zero error alerts', async () => {
    const today = ymd(new Date());
    mockRpc.mockResolvedValue({
      data: buildTodayBootstrapFixture(today),
      error: null,
      status: 200,
    });

    const r = renderWithProviders(<TodayScreen />);
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      for (let i = 0; i < 6; i += 1) await Promise.resolve();
    });

    expect(mockFetchHabits).not.toHaveBeenCalled();
    expect(mockFetchLogsForDate).not.toHaveBeenCalled();
    expect(mockFetchTasks).not.toHaveBeenCalled();
    expect(mockFetchToday).not.toHaveBeenCalled();
    expect(mockFetchPlans).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
    await act(async () => {
      r.unmount();
    });
  });
});
