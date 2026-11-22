/**
 * F27 (PRF-01, STO-07, PRF-14) — Memoized Today view-model and hour/day boundary clock.
 *
 * Deliberately omits `secondsLeft` from `useFocusStore` so a running focus timer
 * produces 0 renders/second on Today.
 */
import { useEffect, useMemo, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import type { NextUpItem } from '../components/today/NextUpStrip';
import { parseLocalDate, ymd } from '../lib/date';
import { pickDailySparkItem } from '../lib/focusFlowCatalog';
import { recentlyEndedBreak } from '../lib/flowCopy';
import { activePauseOn } from '../lib/habitPauses';
import type { Habit } from '../lib/supabase';
import type { Task } from '../lib/taskTypes';
import type { Palette } from '../lib/tokens';
import {
  focusForNext,
  nextActionable,
  primaryAction,
  todaySummaryLine,
  type NextAction,
} from '../lib/todayNext';
import {
  groupHabitsByPartOfDay,
  orderForNextStep,
  selectOnBreakHabits,
  selectPeriodDoneHabits,
  selectSetAsideHabits,
  selectTodayHabits,
  setAsideIds,
  summarizeTodayHabits,
  todayHabitCopy,
  todayTaskDueLabel,
  type HabitGroup,
  type PartGroupKey,
  type PeriodLogRow,
  type TodayHabitSummary,
} from '../lib/todaySelectors';
import { useFocusStore } from '../store/focusStore';
import { useHabitStore } from '../store/habitStore';
import { useLogStore } from '../store/logStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { useRoutineRunnerStore } from '../store/routineRunnerStore';
import { useTaskStore } from '../store/taskStore';
import { useWillpowerStore } from '../store/willpowerStore';
import { useThemeColors } from './useThemeColors';

export type TodayClock = { today: string; hour: number; nowMs?: number };

function readClock(): TodayClock {
  const d = new Date();
  return { today: ymd(d), hour: d.getHours(), nowMs: d.getTime() };
}

function msUntilNextHour(): number {
  const d = new Date();
  const elapsedMs = d.getMinutes() * 60_000 + d.getSeconds() * 1_000 + d.getMilliseconds();
  return Math.max(1_000, 3_600_000 - elapsedMs + 250);
}

/**
 * Re-reads local date & hour at every top-of-hour (+250 ms) and when AppState
 * becomes `'active'`. Preserves previous state identity when unchanged (0 extra renders).
 */
export function useTodayClock(): TodayClock {
  const [clock, setClock] = useState<TodayClock>(readClock);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;

    const refresh = () => {
      const next = readClock();
      setClock((prev) => (prev.today === next.today && prev.hour === next.hour ? prev : next));
    };

    const scheduleNext = () => {
      timer = setTimeout(() => {
        refresh();
        scheduleNext();
      }, msUntilNextHour());
      if (typeof timer === 'object' && timer !== null && 'unref' in timer && typeof timer.unref === 'function') {
        timer.unref();
      }
    };

    scheduleNext();

    const onAppState = (state: AppStateStatus) => {
      if (state === 'active') {
        refresh();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);

    return () => {
      if (timer !== null) clearTimeout(timer);
      sub.remove();
    };
  }, []);

  return clock;
}

const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const PRIORITY_TONE: Record<string, keyof Palette> = {
  high: 'error',
  medium: 'warning',
  low: 'success',
  none: 'textGhost',
};

export type TodayModelInput = {
  clock: TodayClock;
  periodLogs: readonly PeriodLogRow[] | null;
  lowEnergy: boolean;
  expandedGroups: ReadonlySet<PartGroupKey>;
  sparkEnabled: boolean;
};

export type TodayModel = {
  todayDate: Date;
  habits: Habit[];
  activeHabits: Habit[];
  todayHabits: Habit[];
  completedHabits: Habit[];
  setAsideHabits: Habit[];
  periodDoneHabits: Habit[];
  onBreakHabits: Habit[];
  lightDayCandidates: Habit[];
  holiday: ReturnType<typeof activePauseOn>;
  afterBreak: ReturnType<typeof recentlyEndedBreak>;
  habitSummary: TodayHabitSummary;
  habitCopy: { metricSub: string; ringSub: string };
  groups: HabitGroup[];
  todayTasks: Task[];
  overdueList: Task[];
  pendingTasks: Task[];
  nextUpItems: NextUpItem[];
  nowAction: NextAction | null;
  primary: ReturnType<typeof primaryAction>;
  summaryLine: string;
  dailySpark: ReturnType<typeof pickDailySparkItem> | null;
  plannedRecovery: number;
  sessionsCompleted: number;
  stateOf: (habitId: string) => string | undefined;
};

export function useTodayModel(input: TodayModelInput): TodayModel {
  const { clock, periodLogs, lowEnergy, expandedGroups, sparkEnabled } = input;
  const c = useThemeColors();

  const habits = useHabitStore((s) => s.habits);
  const pauses = useHabitStore((s) => s.pauses);
  const logs = useLogStore((s) => s.logs);
  const getLogForHabit = useLogStore((s) => s.getLogForHabit);
  const tasks = useTaskStore((s) => s.tasks);
  const dueToday = useTaskStore((s) => s.dueToday);
  const overdue = useTaskStore((s) => s.overdue);
  const wp = useWillpowerStore((s) => s.state);
  const {
    sessionsCompleted,
    focusStatus,
    focusSmallStep,
    focusTasks,
    selectedTaskId,
    focusPausedAt,
    focusStartedAt,
  } = useFocusStore(
    useShallow((s) => ({
      sessionsCompleted: s.sessionsCompleted,
      focusStatus: s.status,
      focusSmallStep: s.smallStep,
      focusTasks: s.focusTasks,
      selectedTaskId: s.selectedTaskId,
      focusPausedAt: s.pausedAt,
      focusStartedAt: s.sessionStartedAt,
    })),
  );
  const recoveryPlans = useRecoveryStore((s) => s.plans);
  const runnerSession = useRoutineRunnerStore((s) => s.session);

  const todayDate = useMemo(() => parseLocalDate(clock.today)!, [clock.today]);

  const stateMap = useMemo(() => {
    void logs;
    return new Map<string, string | undefined>(
      habits.map((h) => [h.id, getLogForHabit(h.id)?.state]),
    );
  }, [habits, logs, getLogForHabit]);

  const stateOf = useMemo(
    () => (habitId: string): string | undefined => stateMap.get(habitId),
    [stateMap],
  );

  const habitDerived = useMemo(() => {
    void logs;
    const activeHabits = habits.filter((h) => h.status === 'active');
    const lightDayIds = setAsideIds(habits, (id) => getLogForHabit(id)?.state);
    const todayHabits = selectTodayHabits(habits, todayDate, periodLogs, lightDayIds);
    const setAsideHabits = selectSetAsideHabits(habits, todayDate, periodLogs, lightDayIds);
    const periodDoneHabits = selectPeriodDoneHabits(habits, todayDate, periodLogs);
    const onBreakHabits = selectOnBreakHabits(habits, todayDate);
    const completedHabits = todayHabits.filter((h) => {
      const st = stateMap.get(h.id);
      return st === 'done' || st === 'partial';
    });
    const habitSummary = summarizeTodayHabits(todayHabits, completedHabits);
    const habitCopy = todayHabitCopy(habitSummary, activeHabits.length);
    const completedSet = new Set(completedHabits.map((h) => h.id));
    const lightDayCandidates = todayHabits.filter((h) => !completedSet.has(h.id));
    return {
      activeHabits,
      todayHabits,
      setAsideHabits,
      periodDoneHabits,
      onBreakHabits,
      completedHabits,
      habitSummary,
      habitCopy,
      lightDayCandidates,
    };
  }, [habits, todayDate, periodLogs, logs, getLogForHabit, stateMap]);

  const {
    activeHabits,
    todayHabits,
    setAsideHabits,
    periodDoneHabits,
    onBreakHabits,
    completedHabits,
    habitSummary,
    habitCopy,
    lightDayCandidates,
  } = habitDerived;

  const holiday = useMemo(
    () => activePauseOn({ pause_intervals: pauses.filter((p) => p.habit_id === null) }, todayDate),
    [pauses, todayDate],
  );

  const afterBreak = useMemo(
    () =>
      recentlyEndedBreak(
        pauses.filter((p) => p.habit_id === null || todayHabits.some((h) => h.id === p.habit_id)),
        clock.today,
      ),
    [pauses, todayHabits, clock.today],
  );

  const groups = useMemo(() => {
    const doneIds = new Set(completedHabits.map((h) => h.id));
    return groupHabitsByPartOfDay({
      habits: todayHabits,
      isDone: (id) => doneIds.has(id),
      hour: clock.hour,
      expanded: expandedGroups,
    });
  }, [todayHabits, completedHabits, clock.hour, expandedGroups]);

  const todayTasks = useMemo(() => {
    void tasks;
    void clock.today;
    return dueToday();
  }, [tasks, dueToday, clock.today]);
  const overdueList = useMemo(() => {
    void tasks;
    void clock.today;
    return overdue();
  }, [tasks, overdue, clock.today]);
  const pendingTasks = useMemo(
    () => tasks.filter((t) => !t.completed && t.status === 'pending').slice(0, 5),
    [tasks],
  );

  const nextUpItems = useMemo<NextUpItem[]>(() => {
    const priorityColor = (p: string): string => c[PRIORITY_TONE[p] ?? 'textGhost'];
    const upcoming = tasks
      .filter((t) => !t.completed && t.status !== 'cancelled' && t.due_date && t.due_date > clock.today)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));

    const dueLabel = (iso: string): string => {
      const d = parseLocalDate(iso);
      if (!d) return iso;
      const diff = Math.round((d.getTime() - todayDate.getTime()) / 86_400_000);
      if (diff <= 0) return diff < 0 ? 'gecikmiş' : 'bugün';
      if (diff < 7) return DAYS[d.getDay()];
      return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
    };

    return [
      ...overdueList.map((t) => ({
        id: t.id,
        title: t.title,
        dueLabel: 'gecikmiş',
        dotColor: priorityColor(t.priority),
        overdue: true,
      })),
      ...todayTasks.map((t) => ({
        id: t.id,
        title: t.title,
        dueLabel: todayTaskDueLabel(t.time_block_start),
        dotColor: priorityColor(t.priority),
      })),
      ...upcoming.map((t) => ({
        id: t.id,
        title: t.title,
        dueLabel: dueLabel(t.due_date!),
        dotColor: priorityColor(t.priority),
      })),
    ].slice(0, 8);
  }, [tasks, overdueList, todayTasks, clock.today, todayDate, c]);

  const plannedRecovery = useMemo(
    () => recoveryPlans.filter((p) => p.status === 'planned').length,
    [recoveryPlans],
  );

  const nowAction = useMemo<NextAction | null>(() => {
    const doneIds = new Set(completedHabits.map((h) => h.id));
    const orderedHabits = orderForNextStep(todayHabits, clock.hour);
    const refNowMs = clock.nowMs ?? todayDate.getTime();
    return nextActionable({
      focus: focusForNext(
        {
          status: focusStatus,
          title: focusSmallStep?.title ?? focusTasks.find((t) => t.id === selectedTaskId)?.title ?? null,
          pausedAt: focusPausedAt,
          startedAtIso: focusStartedAt,
        },
        refNowMs,
      ),
      routine: runnerSession
        ? {
            status: runnerSession.status,
            templateName: runnerSession.templateName,
            done: Object.keys(runnerSession.results).length,
            total: runnerSession.steps.length,
          }
        : null,
      recoveryToday: recoveryPlans
        .filter((p) => p.status === 'planned' && p.target_date === clock.today)
        .map((p) => ({
          id: p.id,
          habitName: habits.find((h) => h.id === p.habit_id)?.name ?? 'Telafi',
        })),
      overdueTasks: overdueList.map((t) => ({ id: t.id, title: t.title })),
      habitsToDo: orderedHabits
        .filter((h) => !doneIds.has(h.id))
        .map((h) => ({ id: h.id, name: h.name })),
      tasksToday: todayTasks
        .filter((t) => !t.completed)
        .map((t) => ({ id: t.id, title: t.title })),
    });
  }, [
    completedHabits,
    todayHabits,
    clock.hour,
    clock.nowMs,
    clock.today,
    todayDate,
    focusStatus,
    focusSmallStep,
    focusTasks,
    selectedTaskId,
    focusPausedAt,
    focusStartedAt,
    runnerSession,
    recoveryPlans,
    habits,
    overdueList,
    todayTasks,
  ]);

  const primary = useMemo(() => primaryAction(nowAction), [nowAction]);

  const summaryLine = useMemo(
    () =>
      todaySummaryLine({
        used: wp?.used ?? null,
        budget: wp?.daily_budget ?? null,
        habitsLeft: habitSummary.remaining,
        tasksLeft: overdueList.length + todayTasks.filter((t) => !t.completed).length,
      }),
    [wp, habitSummary.remaining, overdueList.length, todayTasks],
  );

  const dailySpark = useMemo(() => {
    if (!sparkEnabled) return null;
    return pickDailySparkItem({
      hour: clock.hour,
      overdueCount: overdueList.length,
      lowEnergy,
      activeHabitCount: habits.filter((h) => h.status === 'active').length,
      focusSessionsToday: sessionsCompleted,
    });
  }, [sparkEnabled, clock.hour, overdueList.length, lowEnergy, habits, sessionsCompleted]);

  return {
    todayDate,
    habits,
    activeHabits,
    todayHabits,
    completedHabits,
    setAsideHabits,
    periodDoneHabits,
    onBreakHabits,
    lightDayCandidates,
    holiday,
    afterBreak,
    habitSummary,
    habitCopy,
    groups,
    todayTasks,
    overdueList,
    pendingTasks,
    nextUpItems,
    nowAction,
    primary,
    summaryLine,
    dailySpark,
    plannedRecovery,
    sessionsCompleted,
    stateOf,
  };
}
