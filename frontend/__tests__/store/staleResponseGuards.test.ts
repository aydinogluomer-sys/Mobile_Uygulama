import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { resetAccountMemory } from '../../lib/accountScope';
import { addDaysLocal, todayLocal, ymd } from '../../lib/date';
import { clearReadCacheMemory, getCachedSnapshot } from '../../lib/localReadCache';
import type { Habit, HabitLog, LeaderboardRow } from '../../lib/supabase';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const mockLoadDay = jest.fn();
const mockPersistCompletion = jest.fn();

jest.mock('../../services/habitLogService', () => {
  const actual = jest.requireActual('../../services/habitLogService');
  return {
    ...actual,
    loadDay: (...args: unknown[]) => mockLoadDay(...args),
    persistCompletion: (...args: unknown[]) => mockPersistCompletion(...args),
  };
});

const mockOpenThread = jest.fn();
const mockOlderMessages = jest.fn();
const mockResolveStagedAction = jest.fn();
const mockUpdateStagedAction = jest.fn();

jest.mock('../../services/aiCoachService', () => {
  const actual = jest.requireActual('../../services/aiCoachService');
  return {
    ...actual,
    openThread: (...args: unknown[]) => mockOpenThread(...args),
    olderMessages: (...args: unknown[]) => mockOlderMessages(...args),
    resolveStagedAction: (...args: unknown[]) => mockResolveStagedAction(...args),
    updateStagedAction: (...args: unknown[]) => mockUpdateStagedAction(...args),
  };
});

const mockListTasks = jest.fn();
const mockDeliverTaskCommand = jest.fn();

jest.mock('../../services/taskService', () => {
  const actual = jest.requireActual('../../services/taskService');
  return {
    ...actual,
    listTasks: (...args: unknown[]) => mockListTasks(...args),
    deliverTaskCommand: (...args: unknown[]) => mockDeliverTaskCommand(...args),
  };
});

const mockFetchGoalsPage = jest.fn();
jest.mock('../../repositories/goalRepository', () => ({
  fetchGoalsPage: (...args: unknown[]) => mockFetchGoalsPage(...args),
  insertGoal: jest.fn(),
  updateGoalProgress: jest.fn(),
  archiveGoal: jest.fn(),
  deleteGoal: jest.fn(),
}));

const mockFetchLeaderboard = jest.fn();
jest.mock('../../repositories/profileRepository', () => ({
  fetchOrCreateProfile: jest.fn(),
  fetchBadges: jest.fn(),
  updateUsername: jest.fn(),
  fetchLeaderboard: (...args: unknown[]) => mockFetchLeaderboard(...args),
  fetchMyRank: jest.fn(),
}));

const mockInvoke = jest.fn();
let mockSessionUserId: string | null = 'u1';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: {
          session: mockSessionUserId
            ? { user: { id: mockSessionUserId, email: 'u1@aderyth.app' }, access_token: 'tok' }
            : null,
        },
        error: null,
      })),
      getUser: jest.fn(async () => ({
        data: { user: mockSessionUserId ? { id: mockSessionUserId, email: 'u1@aderyth.app' } : null },
        error: null,
      })),
    },
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

import { useLogStore, mergeDayLogs, MAX_LOG_DAYS } from '../../store/logStore';
import { useAiConversationStore } from '../../store/aiConversationStore';
import { useTaskStore } from '../../store/taskStore';
import { useGoalStore, type Goal } from '../../store/goalStore';
import { useProfileStore } from '../../store/profileStore';
import { useRoutineStore } from '../../store/routineStore';
import { useHabitStore } from '../../store/habitStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';

function makeLog(habitId: string, day: string, state: HabitLog['state'] = 'done', id = `log-${habitId}-${day}`): HabitLog {
  return {
    id,
    habit_id: habitId,
    user_id: 'u1',
    completed_at: day,
    is_completed: state === 'done',
    state,
    value: null,
    xp: 10,
    created_at: `${day}T10:00:00Z`,
  };
}

function makeHabit(id: string, name: string): Habit {
  return {
    id,
    user_id: 'u1',
    name,
    status: 'active',
    behavior_type: 'positive',
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    willpower_cost: 1,
    difficulty: 1,
    estimated_minutes: 10,
    created_at: '2026-11-01T00:00:00Z',
  } as Habit;
}

describe('staleResponseGuards — F18 store consistency', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockSessionUserId = 'u1';
    resetAccountMemory('signed_out');
    clearReadCacheMemory();
    await AsyncStorage.clear();
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();
  });

  describe('logStore (STO-05)', () => {
    it('keeps D1 rows intact when D2 is fetched, and getLogForHabit(h) without date reads only today', async () => {
      const today = todayLocal();
      const yesterday = ymd(addDaysLocal(new Date(), -1));

      mockLoadDay.mockResolvedValueOnce({ ok: true, logs: [makeLog('h1', today, 'done')] });
      await useLogStore.getState().fetchLogsForDate(today);

      mockLoadDay.mockResolvedValueOnce({ ok: true, logs: [makeLog('h2', yesterday, 'done')] });
      await useLogStore.getState().fetchLogsForDate(yesterday);

      expect(useLogStore.getState().getLogForHabit('h1')?.completed_at).toBe(today);
      expect(useLogStore.getState().getLogForHabit('h2')).toBeUndefined();
      expect(useLogStore.getState().getLogForHabit('h2', yesterday)?.state).toBe('done');
    });

    it('protects an in-flight optimistic tap and a queued offline tap from an overlapping empty fetch', async () => {
      const today = todayLocal();
      const todayDate = new Date();
      const writeGate = deferred<{ ok: true; log: HabitLog }>();
      mockPersistCompletion.mockImplementationOnce(() => writeGate.promise);

      const tapPromise = useLogStore.getState().logHabit({ habitId: 'h1', date: todayDate, state: 'done' });
      expect(useLogStore.getState().getLogForHabit('h1')?.id).toMatch(/^pending-/);

      // Concurrent fetch started before write landed returns empty rows from server
      mockLoadDay.mockResolvedValueOnce({ ok: true, logs: [] });
      await useLogStore.getState().fetchLogsForDate(today);

      // Optimistic row must survive!
      expect(useLogStore.getState().getLogForHabit('h1')?.state).toBe('done');

      writeGate.resolve({ ok: true, log: makeLog('h1', today, 'done', 'confirmed-1') });
      await tapPromise;
      expect(useLogStore.getState().getLogForHabit('h1')?.id).toBe('confirmed-1');

      // Queued offline op protection
      mockPersistCompletion.mockResolvedValueOnce({ ok: false, error: 'offline', offline: true });
      await useLogStore.getState().logHabit({ habitId: 'h2', date: todayDate, state: 'done' });
      expect(useLogStore.getState().getSyncStatusFor('h2', today)).toBe('pending');

      mockLoadDay.mockResolvedValueOnce({ ok: true, logs: [] });
      await useLogStore.getState().fetchLogsForDate(today);
      expect(useLogStore.getState().getLogForHabit('h2')?.state).toBe('done');
    });

    it('drops out-of-order same-day responses, keeps loading true until all day fetches finish, and records logsError', async () => {
      const today = todayLocal();
      const yesterday = ymd(addDaysLocal(new Date(), -1));
      const d1 = deferred<{ ok: true; logs: HabitLog[] }>();
      const d2 = deferred<{ ok: true; logs: HabitLog[] }>();

      mockLoadDay.mockImplementationOnce(() => d1.promise).mockImplementationOnce(() => d2.promise);
      const p1 = useLogStore.getState().fetchLogsForDate(today);
      const p2 = useLogStore.getState().fetchLogsForDate(today);

      d2.resolve({ ok: true, logs: [makeLog('h-new', today, 'done')] });
      await p2;
      // p1 is still open, so loading remains true until p1 finishes
      expect(useLogStore.getState().loading).toBe(true);

      d1.resolve({ ok: true, logs: [makeLog('h-stale', today, 'done')] });
      await p1;
      expect(useLogStore.getState().loading).toBe(false);
      expect(useLogStore.getState().getLogForHabit('h-new', today)).toBeDefined();
      expect(useLogStore.getState().getLogForHabit('h-stale', today)).toBeUndefined();

      // Error preserves existing rows and writes logsError; next success clears logsError
      mockLoadDay.mockResolvedValueOnce({ ok: false, error: 'Sunucu erişilemedi' });
      await useLogStore.getState().fetchLogsForDate(yesterday);
      expect(useLogStore.getState().logsError).toBe('Sunucu erişilemedi');
      expect(useLogStore.getState().getLogForHabit('h-new', today)).toBeDefined();

      mockLoadDay.mockResolvedValueOnce({ ok: true, logs: [] });
      await useLogStore.getState().fetchLogsForDate(today);
      expect(useLogStore.getState().logsError).toBeNull();
      // Negative: unprotected row absent on server is dropped
      expect(useLogStore.getState().getLogForHabit('h-new', today)).toBeUndefined();
    });

    it('caps mergeDayLogs to MAX_LOG_DAYS (120) newest days', () => {
      const base: HabitLog[] = [];
      for (let i = 0; i < 120; i += 1) {
        const d = ymd(addDaysLocal(new Date(2026, 0, 1), i));
        base.push(makeLog('h1', d));
      }
      const newest = ymd(addDaysLocal(new Date(2026, 0, 1), 120));
      const merged = mergeDayLogs(base, newest, [makeLog('h1', newest)], () => false);
      const days = new Set(merged.map((r) => r.completed_at));
      expect(days.size).toBe(MAX_LOG_DAYS);
      expect(days.has(ymd(new Date(2026, 0, 1)))).toBe(false);
      expect(days.has(newest)).toBe(true);
    });
  });

  describe('aiConversationStore (STO-06)', () => {
    it('drops stale openConversation, double-open, loadOlderMessages, and newChat-interrupted responses', async () => {
      const openX = deferred<{ ok: true; data: { messages: unknown[]; hasMore: boolean; staged: null } }>();
      const openY = deferred<{ ok: true; data: { messages: unknown[]; hasMore: boolean; staged: null } }>();

      mockOpenThread.mockImplementationOnce(() => openX.promise).mockImplementationOnce(() => openY.promise);
      const pX = useAiConversationStore.getState().openConversation('conv-x');
      const pY = useAiConversationStore.getState().openConversation('conv-y');

      openY.resolve({
        ok: true,
        data: {
          messages: [{ id: 'my', conversation_id: 'conv-y', user_id: 'u1', role: 'user', content: 'Y mesajı', request_id: null, created_at: '2026-11-21T10:00:00Z' }],
          hasMore: true,
          staged: null,
        },
      });
      await pY;

      openX.resolve({
        ok: true,
        data: {
          messages: [{ id: 'mx', conversation_id: 'conv-x', user_id: 'u1', role: 'user', content: 'X bayat', request_id: null, created_at: '2026-11-21T09:00:00Z' }],
          hasMore: false,
          staged: null,
        },
      });
      await pX;
      expect(useAiConversationStore.getState().messages.map((m) => m.content)).toEqual(['Y mesajı']);

      // Same conversation opened twice: first answer dropped
      const yFirst = deferred<{ ok: true; data: { messages: unknown[]; hasMore: boolean; staged: null } }>();
      const ySecond = deferred<{ ok: true; data: { messages: unknown[]; hasMore: boolean; staged: null } }>();
      mockOpenThread.mockImplementationOnce(() => yFirst.promise).mockImplementationOnce(() => ySecond.promise);
      const py1 = useAiConversationStore.getState().openConversation('conv-y');
      const py2 = useAiConversationStore.getState().openConversation('conv-y');
      ySecond.resolve({
        ok: true,
        data: {
          messages: [{ id: 'my2', conversation_id: 'conv-y', user_id: 'u1', role: 'user', content: 'Y güncel', request_id: null, created_at: '2026-11-21T11:00:00Z' }],
          hasMore: true,
          staged: null,
        },
      });
      await py2;
      yFirst.resolve({
        ok: true,
        data: {
          messages: [{ id: 'my1', conversation_id: 'conv-y', user_id: 'u1', role: 'user', content: 'Y eski', request_id: null, created_at: '2026-11-21T10:30:00Z' }],
          hasMore: false,
          staged: null,
        },
      });
      await py1;
      expect(useAiConversationStore.getState().messages.map((m) => m.content)).toEqual(['Y güncel']);

      // loadOlderMessages in flight while switching conversation
      const olderGate = deferred<{ ok: true; data: { messages: unknown[]; hasMore: boolean } }>();
      mockOlderMessages.mockImplementationOnce(() => olderGate.promise);
      const pOlder = useAiConversationStore.getState().loadOlderMessages();

      mockOpenThread.mockResolvedValueOnce({
        ok: true,
        data: {
          messages: [{ id: 'mz', conversation_id: 'conv-z', user_id: 'u1', role: 'user', content: 'Z mesajı', request_id: null, created_at: '2026-11-21T12:00:00Z' }],
          hasMore: false,
          staged: null,
        },
      });
      await useAiConversationStore.getState().openConversation('conv-z');
      olderGate.resolve({
        ok: true,
        data: {
          messages: [{ id: 'my-old', conversation_id: 'conv-y', user_id: 'u1', role: 'user', content: 'Y eski sayfa', request_id: null, created_at: '2026-11-21T08:00:00Z' }],
          hasMore: false,
        },
      });
      await pOlder;
      expect(useAiConversationStore.getState().messages.map((m) => m.content)).toEqual(['Z mesajı']);

      // newChat() while openConversation is in flight
      const openLate = deferred<{ ok: true; data: { messages: unknown[]; hasMore: boolean; staged: null } }>();
      mockOpenThread.mockImplementationOnce(() => openLate.promise);
      const pLate = useAiConversationStore.getState().openConversation('conv-z');
      useAiConversationStore.getState().newChat();
      expect(useAiConversationStore.getState().loadingMessages).toBe(false);
      openLate.resolve({
        ok: true,
        data: {
          messages: [{ id: 'mz2', conversation_id: 'conv-z', user_id: 'u1', role: 'user', content: 'Geri gelmemeli', request_id: null, created_at: '2026-11-21T12:00:00Z' }],
          hasMore: false,
          staged: null,
        },
      });
      await pLate;
      expect(useAiConversationStore.getState().activeId).toBeNull();
      expect(useAiConversationStore.getState().messages).toEqual([]);
    });

    it('restores pendingAction only on failed cancellation, suppresses re-show on failed confirmation, and checks updatePendingPayload', async () => {
      const staged = {
        row: {
          id: 'act-1',
          conversation_id: 'conv-a',
          assistant_message_id: null,
          user_id: 'u1',
          action_type: 'propose_habit' as const,
          payload: {},
          status: 'pending' as const,
          created_at: '2026-11-21T10:00:00Z',
          resolved_at: null,
        },
        action: {
          type: 'propose_habit' as const,
          habit: { name: 'Yürüyüş', tracking_type: 'binary' as const, difficulty: 1 as const, estimated_minutes: 10 },
        },
      };

      useAiConversationStore.setState({ activeId: 'conv-a', pendingAction: staged, error: null });

      mockUpdateStagedAction.mockResolvedValueOnce({ ok: false, error: 'Güncelleme hatası' });
      expect(await useAiConversationStore.getState().updatePendingPayload(staged.action)).toBe(false);
      expect(useAiConversationStore.getState().error).toBe('Güncelleme hatası');

      // Failed cancellation restores card
      mockResolveStagedAction.mockResolvedValueOnce({ ok: false, error: 'İptal edilemedi' });
      expect(await useAiConversationStore.getState().resolvePending('cancelled')).toBe(false);
      expect(useAiConversationStore.getState().pendingAction?.row.id).toBe('act-1');
      expect(useAiConversationStore.getState().error).toBe('İptal edilemedi');

      // Failed confirmation does NOT restore card and suppresses it on reopen
      mockResolveStagedAction.mockResolvedValueOnce({ ok: false, error: 'Ağ koptu' });
      expect(await useAiConversationStore.getState().resolvePending('confirmed')).toBe(false);
      expect(useAiConversationStore.getState().pendingAction).toBeNull();

      mockOpenThread.mockResolvedValueOnce({
        ok: true,
        data: { messages: [], hasMore: false, staged },
      });
      mockResolveStagedAction.mockResolvedValueOnce({ ok: true, data: staged.row });
      await useAiConversationStore.getState().openConversation('conv-a');
      expect(useAiConversationStore.getState().pendingAction).toBeNull();
    });
  });

  describe('taskStore (STO-09)', () => {
    const sampleTask = (id: string, completed = false) => ({
      id,
      user_id: 'u1',
      title: `Görev ${id}`,
      status: (completed ? 'completed' : 'pending') as 'completed' | 'pending',
      priority: 'medium' as const,
      list_type: 'inbox' as const,
      completed,
      created_at: '2026-11-21T10:00:00Z',
      updated_at: '2026-11-21T10:00:00Z',
    });

    it('overlays the LIVE outbox when toggleDone runs during an in-flight fetchTasks', async () => {
      mockDeliverTaskCommand.mockResolvedValue({ kind: 'offline' });
      mockListTasks.mockResolvedValueOnce({
        ok: true,
        data: { rows: [sampleTask('t1', false)], nextCursor: null, hasMore: false },
      });
      await useTaskStore.getState().fetchTasks();

      const refetchGate = deferred<{ ok: true; data: { rows: ReturnType<typeof sampleTask>[]; nextCursor: null; hasMore: boolean } }>();
      mockListTasks.mockImplementationOnce(() => refetchGate.promise);
      const refetchPromise = useTaskStore.getState().fetchTasks();
      await Promise.resolve();
      await Promise.resolve();

      await useTaskStore.getState().toggleDone('t1');
      expect(useTaskStore.getState().tasks[0].completed).toBe(true);

      // Server returns pre-toggle row; live outbox overlay must keep completed: true
      refetchGate.resolve({
        ok: true,
        data: { rows: [sampleTask('t1', false)], nextCursor: null, hasMore: false },
      });
      await refetchPromise;
      expect(useTaskStore.getState().tasks[0].completed).toBe(true);
    });

    it('re-fetches once when an outbox delivery applies while fetchTasks was reading stale rows, and drops stale loadMore', async () => {
      mockListTasks.mockResolvedValueOnce({
        ok: true,
        data: {
          rows: [sampleTask('t1', false)],
          nextCursor: { key: '2026-11-21T10:00:00Z', id: 't1' },
          hasMore: true,
        },
      });
      await useTaskStore.getState().fetchTasks();

      // Start loadMore, then interrupt with fetchTasks
      const moreGate = deferred<{ ok: true; data: { rows: ReturnType<typeof sampleTask>[]; nextCursor: null; hasMore: boolean } }>();
      mockListTasks.mockImplementationOnce(() => moreGate.promise);
      const pMore = useTaskStore.getState().loadMore();
      expect(useTaskStore.getState().loadingMore).toBe(true);

      const firstFetchGate = deferred<{ ok: true; data: { rows: ReturnType<typeof sampleTask>[]; nextCursor: null; hasMore: boolean } }>();
      mockListTasks
        .mockImplementationOnce(() => firstFetchGate.promise)
        .mockResolvedValueOnce({
          ok: true,
          data: { rows: [sampleTask('t1', true)], nextCursor: null, hasMore: false },
        });
      mockDeliverTaskCommand.mockResolvedValueOnce({ kind: 'applied', version: '2026-11-21T10:05:00Z' });

      const pFetch = useTaskStore.getState().fetchTasks();
      await Promise.resolve();
      await Promise.resolve();

      // Delivery completes while firstFetchGate is still in flight -> appliedCount advances
      await useTaskStore.getState().toggleDone('t1');
      await useTaskStore.getState().flush();

      firstFetchGate.resolve({
        ok: true,
        data: { rows: [sampleTask('t1', false)], nextCursor: null, hasMore: false },
      });
      await pFetch;

      // Resolve old loadMore after fetchTasks finished -> stale page must be ignored
      moreGate.resolve({
        ok: true,
        data: { rows: [sampleTask('t-stale-page', false)], nextCursor: null, hasMore: false },
      });
      await pMore;

      expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(['t1']);
      expect(useTaskStore.getState().tasks[0].completed).toBe(true);
      expect(useTaskStore.getState().loadingMore).toBe(false);
    });
  });

  describe('list stores & profileStore (STO-09)', () => {
    it('loadGoals keeps only the newest response and does not overwrite cache with stale data', async () => {
      const g1 = deferred<{ ok: true; data: { rows: Goal[]; nextCursor: null; hasMore: boolean } }>();
      const g2 = deferred<{ ok: true; data: { rows: Goal[]; nextCursor: null; hasMore: boolean } }>();

      mockFetchGoalsPage.mockImplementationOnce(() => g1.promise).mockImplementationOnce(() => g2.promise);

      const p1 = useGoalStore.getState().loadGoals();
      await new Promise((r) => setTimeout(r, 0));
      const p2 = useGoalStore.getState().loadGoals();

      const freshGoal: Goal = {
        id: 'goal-fresh',
        user_id: 'u1',
        kind: 'yearly',
        title: 'Güncel Hedef',
        progress: 50,
        year: 2026,
        quarter: null,
        month: null,
        archived: false,
        created_at: '2026-11-21T10:00:00Z',
      };
      const staleGoal: Goal = { ...freshGoal, id: 'goal-stale', title: 'Bayat Hedef' };

      g2.resolve({ ok: true, data: { rows: [freshGoal], nextCursor: null, hasMore: false } });
      await p2;

      g1.resolve({ ok: true, data: { rows: [staleGoal], nextCursor: null, hasMore: false } });
      await p1;

      expect(useGoalStore.getState().goals.map((g) => g.id)).toEqual(['goal-fresh']);
      expect(useGoalStore.getState().loading).toBe(false);

      const cached = await getCachedSnapshot<{ rows: Goal[] }>('u1', 'goals:p1');
      expect(cached?.data.rows.map((g) => g.id)).toEqual(['goal-fresh']);
    });

    it('profileStore.fetchLeaderboard prevents scope/leaderboard mismatch on rapid scope switch', async () => {
      const globalGate = deferred<{ ok: true; data: LeaderboardRow[] }>();
      const weeklyGate = deferred<{ ok: true; data: LeaderboardRow[] }>();

      mockFetchLeaderboard
        .mockImplementationOnce(() => globalGate.promise)
        .mockImplementationOnce(() => weeklyGate.promise);

      const pGlobal = useProfileStore.getState().fetchLeaderboard('global');
      const pWeekly = useProfileStore.getState().fetchLeaderboard('weekly');

      weeklyGate.resolve({
        ok: true,
        data: [
          {
            user_id: 'u-weekly',
            username: 'haftalik',
            total_xp: 120,
            weekly_xp: 120,
            level: 2,
            willpower_rank: 'Çırak',
            rank: 1,
          },
        ],
      });
      await pWeekly;
      expect(useProfileStore.getState().lbLoading).toBe(true); // global still pending

      globalGate.resolve({
        ok: true,
        data: [
          {
            user_id: 'u-global',
            username: 'genel',
            total_xp: 9999,
            level: 20,
            willpower_rank: 'Usta',
            rank: 1,
          },
        ],
      });
      await pGlobal;

      expect(useProfileStore.getState().scope).toBe('weekly');
      expect(useProfileStore.getState().leaderboard.map((r) => r.user_id)).toEqual(['u-weekly']);
      expect(useProfileStore.getState().lbLoading).toBe(false);
    });
  });

  describe('routineStore & habit deduplication (STO-16)', () => {
    it('blocks re-entrant generateRoutine, drops cross-account balance/proposal writes, and deduplicates addInstalledHabits', async () => {
      useSubscriptionStore.getState().setBalance(10);
      const invokeGate = deferred<{ data: Record<string, unknown>; error: null }>();
      mockInvoke.mockImplementationOnce(() => invokeGate.promise);

      const first = useRoutineStore.getState().generateRoutine('Sabah odak rutini');
      const second = useRoutineStore.getState().generateRoutine('Farklı metin çift dokunuş');

      await second;
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve();
      }
      expect(mockInvoke).toHaveBeenCalledTimes(1);

      // Account switches while generation is in flight: User A's balance & proposal must NOT land in User B
      resetAccountMemory('user_changed');
      useSubscriptionStore.getState().setBalance(50);

      invokeGate.resolve({
        data: {
          balance: 3,
          title: 'A Rutini',
          goal: 'Hedef',
          habits: [{ name: 'Su iç', tracking_type: 'binary', difficulty: 1, estimated_minutes: 5 }],
        },
        error: null,
      });
      await first;

      expect(useSubscriptionStore.getState().focusPoints).toBe(50);
      expect(useRoutineStore.getState().proposal).toBeNull();
      expect(useRoutineStore.getState().pendingProposal).toBeNull();

      // Subsequent call in new session is allowed (negative check)
      mockInvoke.mockResolvedValueOnce({ data: { error: 'Test bitti' }, error: null });
      await useRoutineStore.getState().generateRoutine('Yeni oturum');
      expect(mockInvoke).toHaveBeenCalledTimes(2);

      // addInstalledHabits deduplicates by id
      useHabitStore.setState({ habits: [makeHabit('h1', 'Eski H1'), makeHabit('h2', 'H2')] });
      useHabitStore.getState().addInstalledHabits([makeHabit('h1', 'Güncel H1'), makeHabit('h3', 'H3')]);
      expect(useHabitStore.getState().habits.map((h) => `${h.id}:${h.name}`)).toEqual([
        'h1:Güncel H1',
        'h3:H3',
        'h2:H2',
      ]);
    });
  });
});
