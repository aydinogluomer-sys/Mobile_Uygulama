import { AppState, type AppStateStatus } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/notifications', () => ({
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
  scheduleRecoveryReminder: jest.fn(),
  cancelRecoveryReminder: jest.fn(),
  cancelFocusEnd: jest.fn(),
  scheduleFocusEnd: jest.fn(),
}));

import type { Habit, HabitLog, RecoveryPlan, WillpowerState } from '../../lib/supabase';
import type { Task } from '../../lib/taskTypes';
import type { PartGroupKey } from '../../lib/todaySelectors';
import { useFocusStore } from '../../store/focusStore';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { useRoutineRunnerStore } from '../../store/routineRunnerStore';
import { useTaskStore } from '../../store/taskStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import {
  useTodayClock,
  useTodayModel,
  type TodayClock,
  type TodayModelInput,
} from '../../hooks/useTodayModel';

const EMPTY_EXPANDED: ReadonlySet<PartGroupKey> = new Set();

function makeHabit(overrides: Partial<Habit> & Pick<Habit, 'id' | 'name'>): Habit {
  return {
    user_id: 'u-1',
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily', part_of_day: ['morning'] },
    willpower_cost: 2,
    status: 'active',
    impact_level: null,
    urgency: null,
    difficulty: 2,
    estimated_minutes: 10,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: '2026-10-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeLog(overrides: Partial<HabitLog> & Pick<HabitLog, 'id' | 'habit_id' | 'completed_at' | 'state'>): HabitLog {
  return {
    user_id: 'u-1',
    value: 1,
    is_completed: overrides.state === 'done',
    xp: 10,
    created_at: '2026-11-24T08:00:00.000Z',
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> & Pick<Task, 'id' | 'title'>): Task {
  return {
    user_id: 'u-1',
    status: 'pending',
    priority: 'medium',
    due_date: null,
    list_type: 'inbox',
    completed: false,
    created_at: '2026-11-20T09:00:00.000Z',
    ...overrides,
  };
}

function resetStores(): void {
  useHabitStore.setState({ habits: [], pauses: [], goalVersions: [] });
  useLogStore.setState({ logs: [] });
  useTaskStore.setState({ tasks: [] });
  useWillpowerStore.setState({ state: null });
  useFocusStore.setState({
    sessionsCompleted: 0,
    status: 'idle',
    smallStep: null,
    focusTasks: [],
    selectedTaskId: null,
    pausedAt: null,
    sessionStartedAt: null,
  });
  useRecoveryStore.setState({ plans: [] });
  useRoutineRunnerStore.setState({ session: null });
}

describe('useTodayClock', () => {
  let appStateListener: ((state: AppStateStatus) => void) | null = null;
  let removeSubscription: jest.Mock<void, []>;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    // Local time: 2026-11-24 09:40:00.000 -> 20m 0s remaining until 10:00 (+250ms = 1_200_250ms)
    jest.setSystemTime(new Date(2026, 10, 24, 9, 40, 0, 0));
    appStateListener = null;
    removeSubscription = jest.fn<void, []>();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateListener = handler as (state: AppStateStatus) => void;
      return { remove: removeSubscription } as ReturnType<typeof AppState.addEventListener>;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('(+) schedules top-of-hour (+250ms) timeout, updates across hour boundary, refreshes on AppState "active", and cleans up on unmount', () => {
    const setTimeoutSpy = jest.spyOn(global, 'setTimeout');
    const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

    const { result, unmount } = renderHook(() => useTodayClock());
    const initialClock = result.current;

    expect(initialClock.today).toBe('2026-11-24');
    expect(initialClock.hour).toBe(9);
    expect(setTimeoutSpy).toHaveBeenLastCalledWith(expect.any(Function), 1_200_250);

    // Same hour & day on AppState 'active' preserves state object identity
    jest.setSystemTime(new Date(2026, 10, 24, 9, 50, 0, 0));
    act(() => {
      appStateListener?.('active');
    });
    expect(result.current).toBe(initialClock);

    // Advance timer across 10:00 (+250ms from original 09:40 schedule)
    jest.setSystemTime(new Date(2026, 10, 24, 9, 40, 0, 0));
    act(() => {
      jest.advanceTimersByTime(1_200_250);
    });
    expect(result.current.today).toBe('2026-11-24');
    expect(result.current.hour).toBe(10);

    // Midnight jump while backgrounded -> AppState 'active' updates today & hour immediately
    jest.setSystemTime(new Date(2026, 10, 25, 0, 5, 0, 0));
    act(() => {
      appStateListener?.('active');
    });
    expect(result.current.today).toBe('2026-11-25');
    expect(result.current.hour).toBe(0);

    unmount();

    expect(removeSubscription).toHaveBeenCalledTimes(1);
    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

describe('useTodayModel', () => {
  const PINNED_LOCAL = new Date(2026, 10, 24, 9, 30, 0, 0);
  const CLOCK: TodayClock = {
    today: '2026-11-24',
    hour: 9,
    nowMs: PINNED_LOCAL.getTime(),
  };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    jest.setSystemTime(PINNED_LOCAL);
    act(() => {
      resetStores();
    });
  });

  afterEach(() => {
    act(() => {
      resetStores();
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('(+) derives todayHabits, completedHabits, overdueList, todayTasks, nextUpItems, primary, summaryLine, and dailySpark gating', () => {
    const habits: Habit[] = [
      makeHabit({ id: 'h-done', name: 'Su iç' }),
      makeHabit({ id: 'h-todo', name: '10 sayfa oku' }),
      makeHabit({ id: 'h-skip', name: 'Esneme' }),
      makeHabit({ id: 'h-paused', name: 'Koşu', status: 'paused' }),
    ];
    const logs: HabitLog[] = [
      makeLog({ id: 'l-1', habit_id: 'h-done', completed_at: '2026-11-24', state: 'done' }),
      makeLog({ id: 'l-2', habit_id: 'h-skip', completed_at: '2026-11-24', state: 'skip' }),
    ];
    const tasks: Task[] = [
      makeTask({ id: 't-overdue', title: 'Vergi ödemesi', due_date: '2026-11-23', priority: 'high' }),
      makeTask({
        id: 't-today',
        title: 'Sprint özeti yaz',
        due_date: '2026-11-24',
        priority: 'medium',
        time_block_start: '14:00',
      }),
      makeTask({ id: 't-upcoming', title: 'Sunum provası', due_date: '2026-11-26', priority: 'low' }),
      makeTask({
        id: 't-completed',
        title: 'Tamamlanan iş',
        due_date: '2026-11-24',
        completed: true,
        status: 'completed',
      }),
    ];
    const wp: WillpowerState = {
      user_id: 'u-1',
      state_date: '2026-11-24',
      used: 4,
      daily_budget: 12,
      active_count: 3,
      focus_capacity: 4,
    };
    const plans: RecoveryPlan[] = [
      {
        id: 'rp-future',
        user_id: 'u-1',
        habit_id: 'h-todo',
        source_log_id: null,
        source_date: '2026-11-23',
        target_date: '2026-11-25',
        deficit_type: 'binary',
        deficit_value: 1,
        strategy: 'push_tomorrow',
        distributed_days: null,
        note: null,
        reminder_time: null,
        status: 'planned',
        completed_at: null,
        created_at: '2026-11-23T20:00:00.000Z',
      },
    ];

    act(() => {
      useHabitStore.setState({ habits });
      useLogStore.setState({ logs });
      useTaskStore.setState({ tasks });
      useWillpowerStore.setState({ state: wp });
      useRecoveryStore.setState({ plans });
      useFocusStore.setState({ sessionsCompleted: 2 });
    });

    const baseInput: TodayModelInput = {
      clock: CLOCK,
      periodLogs: null,
      lowEnergy: false,
      expandedGroups: EMPTY_EXPANDED,
      sparkEnabled: false,
    };

    const { result, rerender } = renderHook(
      (props: TodayModelInput) => useTodayModel(props),
      { initialProps: baseInput },
    );

    expect(result.current.todayHabits.map((h) => h.id)).toEqual(['h-done', 'h-todo']);
    expect(result.current.completedHabits.map((h) => h.id)).toEqual(['h-done']);
    expect(result.current.setAsideHabits.map((h) => h.id)).toEqual(['h-skip']);
    expect(result.current.lightDayCandidates.map((h) => h.id)).toEqual(['h-todo']);
    expect(result.current.stateOf('h-done')).toBe('done');
    expect(result.current.stateOf('h-todo')).toBeUndefined();

    expect(result.current.overdueList.map((t) => t.id)).toEqual(['t-overdue']);
    expect(result.current.todayTasks.map((t) => t.id)).toEqual(['t-today']);
    expect(result.current.nextUpItems.map((it) => ({ id: it.id, overdue: Boolean(it.overdue) }))).toEqual([
      { id: 't-overdue', overdue: true },
      { id: 't-today', overdue: false },
      { id: 't-upcoming', overdue: false },
    ]);

    expect(result.current.primary).toEqual({
      verb: 'Başla',
      label: 'Başla: Vergi ödemesi',
      hint: 'Gecikmiş görev',
    });
    expect(result.current.summaryLine).toBe('İrade 4/12 · 1 alışkanlık, 2 görev kaldı');
    expect(result.current.plannedRecovery).toBe(1);
    expect(result.current.sessionsCompleted).toBe(2);
    expect(result.current.dailySpark).toBeNull();

    // Enabling sparkEnabled derives a DailySpark item from focusFlowCatalog
    rerender({ ...baseInput, sparkEnabled: true });
    expect(result.current.dailySpark).not.toBeNull();
    expect(typeof result.current.dailySpark?.item.id).toBe('string');
    expect(typeof result.current.dailySpark?.reasonTag).toBe('string');

    // Active focus session elevates primary action to "Devam et"
    act(() => {
      useFocusStore.setState({
        status: 'running',
        smallStep: {
          parent: { kind: 'task', id: 't-today', title: 'Sprint özeti yaz' },
          title: 'Taslak başlıkları yaz',
          minutes: 5,
          suggestionId: null,
        },
        pausedAt: null,
        sessionStartedAt: '2026-11-24T09:25:00.000Z',
      });
    });

    expect(result.current.primary).toEqual({
      verb: 'Devam et',
      label: 'Devam et: Odak: Taslak başlıkları yaz',
      hint: 'Sürüyor — devam et',
    });
  });

  it('(+) reports calm focus fallback primary action and empty-work summaryLine when nothing is due', () => {
    const { result } = renderHook(() =>
      useTodayModel({
        clock: CLOCK,
        periodLogs: null,
        lowEnergy: false,
        expandedGroups: EMPTY_EXPANDED,
        sparkEnabled: false,
      }),
    );

    expect(result.current.todayHabits).toEqual([]);
    expect(result.current.overdueList).toEqual([]);
    expect(result.current.todayTasks).toEqual([]);
    expect(result.current.primary.verb).toBe('Başla');
    expect(result.current.primary.label).toBe('Başla: odak');
    expect(result.current.summaryLine).toBe('bugün için açık iş yok');
  });
});
