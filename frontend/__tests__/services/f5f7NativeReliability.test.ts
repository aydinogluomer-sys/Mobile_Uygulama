/**
 * Phases F5 & F7 — Native Reliability, Cue Policy, Cross-Surface Action Gate,
 * Early-Stop Partial Focus, Reminder Reconciliation & Focus Starter Guide
 * (`E07`, `E14`, `U06`, `U07`, `E17`, `U14`, `P06`).
 */
import React from 'react';
import { AccessibilityInfo } from 'react-native';

jest.setTimeout(30_000);

const mockReact = React;

const mockFocusSvc = {
  completedCalls: [] as Record<string, unknown>[],
  partialCalls: [] as Record<string, unknown>[],
  completeTaskCalls: [] as string[],
};

const mockHabitLogCalls: { habitId: string; state: string }[] = [];
const mockSession = { uid: 'user-a' as string | null };

const mockOS = {
  scheduled: [] as { identifier: string; data: Record<string, unknown> | null }[],
  permission: true,
  addedHabits: [] as { key: string; habitId: string; day: string }[],
  addedTasks: [] as { key: string; taskId: string; day: string }[],
  addedEvening: [] as { key: string; day: string }[],
  addedFollowUps: [] as { key: string; habitId: string; day: string }[],
  cancelled: [] as string[],
  nextId: 1,
};

let mockReviewLogs: { habit_id: string; completed_at: string; state: string }[] = [];

jest.mock('../../lib/supabase', () => ({ supabase: {} }));

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () =>
    mockSession.uid ? { id: mockSession.uid, email: null } : null,
  ),
}));

jest.mock('../../services/focusService', () => ({
  completeWorkPhase: jest.fn(async (args: Record<string, unknown>) => {
    mockFocusSvc.completedCalls.push(args);
    return { sessionRecorded: true, taskCompleted: false };
  }),
  recordPartialWorkPhase: jest.fn(async (args: Record<string, unknown>) => {
    mockFocusSvc.partialCalls.push(args);
    return { recorded: true };
  }),
  addTask: jest.fn(),
  completeTask: jest.fn(async (id: string) => {
    mockFocusSvc.completeTaskCalls.push(id);
    return { ok: true };
  }),
  listOpenTasks: jest.fn(async () => ({ ok: true, data: [] })),
  removeTask: jest.fn(),
}));

jest.mock('../../store/logStore', () => ({
  useLogStore: {
    getState: () => ({
      logHabit: jest.fn(async (p: { habitId: string; state: string }) => {
        mockHabitLogCalls.push({ habitId: p.habitId, state: p.state });
        return { ok: true };
      }),
    }),
  },
}));

jest.mock('../../lib/notifications', () => ({
  ensurePermission: jest.fn(async () => mockOS.permission),
  hasPermission: jest.fn(async () => mockOS.permission),
  ensureCategories: jest.fn(async () => undefined),
  listScheduled: jest.fn(async () => mockOS.scheduled.map((s) => ({ ...s }))),
  cancelScheduled: jest.fn(async (ids: readonly string[]) => {
    mockOS.cancelled.push(...ids);
    mockOS.scheduled = mockOS.scheduled.filter((s) => !ids.includes(s.identifier));
  }),
  scheduleReminder: jest.fn(async (p: { key: string; habitId: string; day: string }) => {
    mockOS.addedHabits.push({ key: p.key, habitId: p.habitId, day: p.day });
    mockOS.scheduled.push({
      identifier: `nh-${mockOS.nextId++}`,
      data: { kind: 'habit', key: p.key, habitId: p.habitId, day: p.day },
    });
    return true;
  }),
  scheduleTaskReminder: jest.fn(async (p: { key: string; taskId: string; day: string }) => {
    mockOS.addedTasks.push({ key: p.key, taskId: p.taskId, day: p.day });
    mockOS.scheduled.push({
      identifier: `nt-${mockOS.nextId++}`,
      data: { kind: 'task-reminder', key: p.key, taskId: p.taskId, day: p.day },
    });
    return true;
  }),
  scheduleEveningClose: jest.fn(async (p: { key: string; day: string }) => {
    mockOS.addedEvening.push({ key: p.key, day: p.day });
    mockOS.scheduled.push({
      identifier: `ne-${mockOS.nextId++}`,
      data: { kind: 'evening-close', key: p.key, day: p.day },
    });
    return true;
  }),
  scheduleFollowUp: jest.fn(async (p: { key: string; habitId: string; day: string }) => {
    mockOS.addedFollowUps.push({ key: p.key, habitId: p.habitId, day: p.day });
    mockOS.scheduled.push({
      identifier: `nf-${mockOS.nextId++}`,
      data: { kind: 'follow-up', key: p.key, habitId: p.habitId, day: p.day },
    });
    return true;
  }),
  scheduleSnooze: jest.fn(async () => undefined),
  scheduleReentryNudge: jest.fn(async () => {
    mockOS.scheduled = mockOS.scheduled.filter((s) => s.identifier !== 'reminder-reentry');
    mockOS.scheduled.push({ identifier: 'reminder-reentry', data: { kind: 'reentry' } });
    return true;
  }),
  cancelReentryNudge: jest.fn(async () => {
    mockOS.scheduled = mockOS.scheduled.filter((s) => s.identifier !== 'reminder-reentry');
  }),
  scheduleFocusEnd: jest.fn(async () => true),
  cancelFocusEnd: jest.fn(async () => undefined),
  reminderTitle: (n: string) => n,
}));

jest.mock('../../repositories/habitLogRepository', () => ({
  fetchHabitLogsForReview: jest.fn(async () => ({ ok: true, data: mockReviewLogs })),
}));

jest.mock('../../lib/analytics', () => ({
  buildEvent: jest.fn((name: string, props: unknown) => ({ name, props })),
  emitEvent: jest.fn(),
}));

const mockHaptic = {
  light: jest.fn(),
  medium: jest.fn(),
  select: jest.fn(),
  success: jest.fn(),
  warning: jest.fn(),
  error: jest.fn(),
};
jest.mock('../../lib/haptics', () => ({ haptic: mockHaptic }));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn(), back: jest.fn() }),
}));
jest.mock('../../components/spatial', () => ({
  AtmosphericScreenCanvas: (props: Record<string, unknown>) =>
    mockReact.createElement('AtmosphericScreenCanvas', props),
  ChapterDivider: (props: Record<string, unknown>) =>
    mockReact.createElement('ChapterDivider', props),
  EmbeddedFiligree: (props: Record<string, unknown>) =>
    mockReact.createElement('EmbeddedFiligree', props),
}));
jest.mock('../../components/ui', () => {
  const actual = jest.requireActual('../../components/ui');
  return {
    ...actual,
    EditorialBanner: (props: Record<string, unknown>) =>
      mockReact.createElement('EditorialBanner', props),
    EmblemMedallion: (props: Record<string, unknown>) =>
      mockReact.createElement('EmblemMedallion', props),
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, cleanup, renderWithProviders } from '../helpers/renderWithProviders';
import RoutineRunnerScreen from '../../app/screens/routine-runner';
import {
  registeredAccountStorage,
  resetAccountMemory,
  wipeAccountDevice,
} from '../../lib/accountScope';
import {
  activeMs,
  completedSeconds,
  remainingSeconds,
  restoredClock,
  snapshotOf,
  startClock,
} from '../../lib/focusTimer';
import {
  DEFAULT_STARTER_GUIDE,
  EMPTY_TALLY,
  FOCUS_GUIDE_DISMISSED_KEY,
  resolveFocusStarterGuide,
} from '../../lib/focusRitual';
import {
  DEFAULT_ROUTINE_CUE_SETTINGS,
  MASKED_REMINDER_TITLE,
  MASKED_ROUTINE_STEP_TITLE,
  buildCanonicalSurfaceActionId,
  createSurfaceActionGate,
  maskPrivateSurfaceTitle,
  resolveRoutineStepCue,
} from '../../lib/routineCuePolicy';
import {
  computeRunnerClock,
  editMark,
  pauseSession,
  startSession,
  summarize,
  timeUp,
  type RoutineTemplate,
} from '../../lib/routineRunner';
import type { BlockTask } from '../../lib/nextBlock';
import type { Habit } from '../../lib/supabase';
import {
  reconcileReminders,
  saveTimeSupportSettings,
  stopFollowUps,
  followUpStoppedKey,
  type TimeSupportContext,
} from '../../services/reminderService';
import { DEFAULT_TIME_SUPPORT_SETTINGS } from '../../lib/taskReminderPlan';
import {
  DEFAULT_SETTINGS,
  sessionKey,
  useFocusStore,
  type FocusSettings,
  type FocusTask,
} from '../../store/focusStore';
import { useHabitStore } from '../../store/habitStore';
import { RUNNER_KEY, useRoutineRunnerStore } from '../../store/routineRunnerStore';

const T0 = new Date(2026, 10, 24, 9, 0, 0, 0).getTime();
const SEC = 1_000;
const MIN = 60_000;

let fakeNow = T0;
const setClock = (ms: number) => {
  fakeNow = ms;
};

const flushAsync = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const makeFocusTask = (overrides: Partial<FocusTask> = {}): FocusTask => ({
  id: 'ft-1',
  user_id: 'user-a',
  title: 'Mimari raporu tamamla',
  completed: false,
  selected: true,
  estimated_pomodoros: 2,
  completed_pomodoros: 0,
  total_focus_seconds: 0,
  color: '#D97757',
  created_at: '2026-11-24T08:00:00.000Z',
  ...overrides,
});

const makeHabit = (overrides: Partial<Habit> = {}): Habit =>
  ({
    id: 'hab-1',
    user_id: 'user-a',
    name: 'Sabah Yürüyüşü',
    tracking_type: 'boolean',
    status: 'active',
    behavior_type: 'positive',
    frequency_config: { kind: 'daily' },
    reminders: { enabled: true, time: '10:00' },
    created_at: '2026-10-01T08:00:00.000Z',
    daily_goal: null,
    target_direction: null,
    end_condition: null,
    ...overrides,
  }) as Habit;

const RUNNER_TPL: RoutineTemplate = {
  id: 'tpl-reliability',
  name: 'Sabah Akışı',
  builtIn: false,
  partOfDay: 'morning',
  versions: [
    {
      version: 1,
      createdAt: '2026-11-24T07:00:00.000Z',
      steps: [
        { id: 'rs-1', title: 'Derin nefes', kind: 'timed', durationSec: 120, habitId: 'hab-1' },
        { id: 'rs-2', title: 'Öncelikleri yaz', kind: 'timed', durationSec: 300, habitId: null },
        { id: 'rs-3', title: 'Masayı hazırla', kind: 'check', habitId: null },
      ],
    },
  ],
};

function resetFocusInMemory(settings: Partial<FocusSettings> = {}, tasks: FocusTask[] = []) {
  useFocusStore.setState({
    phase: 'work',
    status: 'idle',
    secondsLeft: 1500,
    sessionsCompleted: 0,
    sessionStartedAt: null,
    clock: null,
    smallStep: null,
    pausedAt: null,
    lastPartial: null,
    intent: null,
    interruptions: EMPTY_TALLY,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    justCompleted: null,
    focusTasks: tasks,
    selectedTaskId: tasks[0]?.id ?? null,
    loadingTasks: false,
  });
}

function resetRunnerInMemory() {
  useRoutineRunnerStore.setState({
    userId: null,
    templates: [],
    session: null,
    logged: [],
    history: [],
    activeTemplateId: null,
    staleDismissed: [],
    error: null,
  });
}

beforeEach(async () => {
  fakeNow = T0;
  jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);
  mockSession.uid = 'user-a';
  mockFocusSvc.completedCalls = [];
  mockFocusSvc.partialCalls = [];
  mockFocusSvc.completeTaskCalls = [];
  mockHabitLogCalls.length = 0;
  mockReviewLogs = [];
  mockOS.scheduled = [];
  mockOS.permission = true;
  mockOS.addedHabits = [];
  mockOS.addedTasks = [];
  mockOS.addedEvening = [];
  mockOS.addedFollowUps = [];
  mockOS.cancelled = [];
  mockOS.nextId = 1;
  Object.values(mockHaptic).forEach((fn) => fn.mockClear());
  await AsyncStorage.clear();
  useHabitStore.setState({ habits: [makeHabit()] });
  resetFocusInMemory();
  resetRunnerInMemory();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

// ============================================================================
// 1. E07 — Timer Interruption & OS-Kill Matrix
// ============================================================================

describe('E07 — Focus & Routine Runner interruption, OS-kill, clock-jump, and account matrix', () => {
  it('(+) focusStore: running -> background/OS-kill -> rehydrate restores exact active session paused without dead time or auto-completion', async () => {
    const task = makeFocusTask();
    resetFocusInMemory({}, [task]);

    useFocusStore.getState().start();
    await flushAsync();

    // Run 4m, pause 3m (excluded!), resume 2m -> total active = 6m (360s), remaining = 19m (1140s)
    setClock(T0 + 4 * MIN);
    useFocusStore.getState().pause();
    await flushAsync();

    setClock(T0 + 7 * MIN);
    useFocusStore.getState().start();
    await flushAsync();

    setClock(T0 + 9 * MIN);
    useFocusStore.getState().onBackground();
    await flushAsync();

    // Simulate OS kill and cold restart 45 minutes later
    resetFocusInMemory({}, [task]);
    setClock(T0 + 54 * MIN);
    await useFocusStore.getState().restoreSession();

    const restored = useFocusStore.getState();
    expect(restored.status).toBe('paused');
    expect(restored.phase).toBe('work');
    expect(restored.secondsLeft).toBe(1500 - 360);
    expect(restored.sessionStartedAt).toBe(new Date(T0).toISOString());

    // OS kill NEVER marks task or session completed
    expect(mockFocusSvc.completedCalls).toHaveLength(0);
    expect(mockFocusSvc.completeTaskCalls).toHaveLength(0);
    expect(restored.focusTasks[0].completed).toBe(false);
  });

  it('(+) focusTimer & routineRunner: forward/backward wall-clock jumps clamp safely with zero negative or runaway elapsed time', () => {
    const fc = startClock(600, T0);
    // Backward NTP clock jump (now < runningSince) -> 0 elapsed, full remaining
    expect(activeMs(fc, T0 - 50_000)).toBe(0);
    expect(completedSeconds(fc, T0 - 50_000)).toBe(0);
    expect(remainingSeconds(fc, T0 - 50_000)).toBe(600);

    // Snapshot with backward lastSeenAt clamps safely to 0 accumulatedMs
    const backwardSnap = snapshotOf({
      phase: 'work',
      clock: fc,
      sessionStartedAt: new Date(T0).toISOString(),
      sessionsCompleted: 0,
      now: T0 - 30_000,
    });
    expect(restoredClock(backwardSnap).accumulatedMs).toBe(0);

    // Forward huge clock jump clamps completedSeconds to plannedSeconds and remainingSeconds to 0
    expect(completedSeconds(fc, T0 + 10 * 3600_000)).toBe(600);
    expect(remainingSeconds(fc, T0 + 10 * 3600_000)).toBe(0);

    // Routine runner: backward & huge forward clock jumps
    const rs = startSession(RUNNER_TPL, 'sess-jump', T0)!;
    const backView = computeRunnerClock(rs, T0 - 25_000);
    expect(backView.elapsedMs).toBe(0);
    expect(backView.remainingMs).toBe(120_000);
    expect(backView.timeUp).toBe(false);

    const fwdView = computeRunnerClock(rs, T0 + 5 * 3600_000);
    expect(fwdView.remainingMs).toBe(0);
    expect(timeUp(rs, T0 + 5 * 3600_000)).toBe(true);
    // Even after 5h forward jump, step is NEVER marked done without user action
    expect(rs.results['rs-1']).toBeUndefined();
    expect(summarize(rs).done).toBe(0);
  });

  it('(+) routineRunnerStore: running -> step 1 done -> step 2 running -> OS kill -> rehydrates exact step 2 paused, excludes pause & kill gap, and isolates accounts', async () => {
    await useRoutineRunnerStore.getState().hydrate();
    useRoutineRunnerStore.setState({ templates: [RUNNER_TPL] });

    expect(useRoutineRunnerStore.getState().start('tpl-reliability')).toBe(true);
    setClock(T0 + 60 * SEC);
    await useRoutineRunnerStore.getState().complete();
    expect(mockHabitLogCalls).toEqual([{ habitId: 'hab-1', state: 'done' }]);

    // Now on step index 1 ('rs-2', 300s). Run 90s, pause 120s, resume 30s -> 120s active
    setClock(T0 + 150 * SEC);
    useRoutineRunnerStore.getState().pause();
    setClock(T0 + 270 * SEC);
    useRoutineRunnerStore.getState().resume();
    setClock(T0 + 300 * SEC);
    useRoutineRunnerStore.getState().heartbeat();
    await flushAsync();

    // Simulated OS kill; app wakes 2 hours later
    resetRunnerInMemory();
    setClock(T0 + 2 * 3600_000);
    await useRoutineRunnerStore.getState().hydrate();

    const restored = useRoutineRunnerStore.getState().session!;
    expect(restored).not.toBeNull();
    expect(restored.status).toBe('paused');
    expect(restored.index).toBe(1);
    expect(restored.clock.accumulatedMs).toBe(120 * SEC);
    expect(restored.results['rs-1']?.mark).toBe('done');
    expect(restored.results['rs-2']).toBeUndefined();

    // Account switch to user-b isolates runner & focus sessions completely
    useFocusStore.getState().start();
    await flushAsync();
    resetAccountMemory('user_changed');
    mockSession.uid = 'user-b';

    await useRoutineRunnerStore.getState().hydrate();
    await useFocusStore.getState().restoreSession();

    expect(useRoutineRunnerStore.getState().session).toBeNull();
    expect(useFocusStore.getState().status).toBe('idle');
    expect(await AsyncStorage.getItem(RUNNER_KEY('user-a'))).not.toBeNull();
    expect(await AsyncStorage.getItem(sessionKey('user-a'))).not.toBeNull();
  });
});

// ============================================================================
// 2. U07 — Early Stop & Partial Progress
// ============================================================================

describe('U07 — Early stop records partial focus (>= 60s), preserves open parent task, and resumes exact remaining time', () => {
  it('(+) stopping a work session after >= 60s records exact partial seconds while keeping parent task completed === false', async () => {
    const parentTask = makeFocusTask({ id: 'ft-u07', completed: false });
    resetFocusInMemory({ autoCheckTasks: true }, [parentTask]);

    useFocusStore.getState().start();
    // Pause and resume first: 70s work -> 180s pause -> resume -> +115s work = 185s active
    setClock(T0 + 70 * SEC);
    useFocusStore.getState().pause();
    expect(useFocusStore.getState().secondsLeft).toBe(1500 - 70);

    setClock(T0 + 250 * SEC);
    useFocusStore.getState().start();
    // Resuming from paused keeps exact remaining seconds and original sessionStartedAt
    expect(useFocusStore.getState().secondsLeft).toBe(1500 - 70);
    expect(useFocusStore.getState().sessionStartedAt).toBe(new Date(T0).toISOString());

    setClock(T0 + 365 * SEC);
    useFocusStore.getState().reset();
    await flushAsync();

    const afterStop = useFocusStore.getState();
    expect(afterStop.status).toBe('idle');
    expect(afterStop.lastPartial).toEqual({ seconds: 185 });
    expect(mockFocusSvc.partialCalls).toHaveLength(1);
    expect(mockFocusSvc.partialCalls[0]).toMatchObject({
      plannedSeconds: 1500,
      completedSeconds: 185,
      taskId: 'ft-u07',
      taskTitle: 'Mimari raporu tamamla',
    });
    expect(mockFocusSvc.completedCalls).toHaveLength(0);
    expect(mockFocusSvc.completeTaskCalls).toHaveLength(0);
    expect(afterStop.focusTasks[0].completed).toBe(false);
  });

  it('(+) stopping a SmallStep early after >= 60s records partial effort under step title without completing parent task; < 60s is ignored', async () => {
    const parentTask = makeFocusTask({ id: 'ft-parent', completed: false });
    resetFocusInMemory({ autoCheckTasks: true }, [parentTask]);

    // Sub-60s accidental start + stop -> zero partial recorded
    useFocusStore.getState().start();
    setClock(T0 + 35 * SEC);
    useFocusStore.getState().reset();
    expect(useFocusStore.getState().lastPartial).toBeNull();
    expect(mockFocusSvc.partialCalls).toHaveLength(0);

    // SmallStep run for 95s -> early stop records 95s partial, parent task untouched
    const started = useFocusStore.getState().startSmallStep(
      { kind: 'task', id: 'ft-parent', title: parentTask.title },
      { title: 'Giriş cümlesini yaz', minutes: 5 },
    );
    expect(started).toBe(true);

    setClock(T0 + 130 * SEC);
    useFocusStore.getState().reset();
    await flushAsync();

    expect(useFocusStore.getState().lastPartial).toEqual({ seconds: 95 });
    expect(mockFocusSvc.partialCalls).toHaveLength(1);
    expect(mockFocusSvc.partialCalls[0]).toMatchObject({
      plannedSeconds: 300,
      completedSeconds: 95,
      taskId: null,
      taskTitle: 'Giriş cümlesini yaz',
    });
    expect(useFocusStore.getState().focusTasks[0].completed).toBe(false);
    expect(mockFocusSvc.completeTaskCalls).toHaveLength(0);
  });
});

// ============================================================================
// 3. E14 — Reminder Reconciliation
// ============================================================================

describe('E14 — Deterministic reminder reconciliation, deduplication, permission denial, and account isolation', () => {
  const baseMorning = () => new Date(2026, 10, 24, 8, 0, 0, 0);

  const makeTaskBlock = (overrides: Partial<BlockTask> = {}): BlockTask => ({
    id: 'blk-1',
    title: 'Müşteri sunumu',
    completed: false,
    status: 'todo',
    due_date: '2026-11-24',
    time_block_start: '11:00',
    time_block_end: '11:30',
    ...overrides,
  });

  it('(+) produces at most 1 scheduled reminder per (dayKey, targetId, channel) and cancels stale reminders on completion or date shift', async () => {
    await saveTimeSupportSettings(
      { ...DEFAULT_TIME_SUPPORT_SETTINGS, taskLeadMin: 30, eveningClose: true, eveningTime: '21:00' },
      'user-a',
    );

    let currentTasks: BlockTask[] = [makeTaskBlock()];
    const ctx: TimeSupportContext = {
      tasks: () => currentTasks,
      userId: () => 'user-a',
      focus: () => ({ active: false, endsAt: null }),
      isDayClosed: async () => false,
    };

    const r1 = await reconcileReminders(() => [makeHabit()], baseMorning, ctx);
    expect(r1.permission).toBe(true);

    // Inject duplicate OS notifications for the exact same habit & task keys, then re-reconcile
    const dupHabit = mockOS.scheduled.find((s) => s.data?.kind === 'habit')!;
    const dupTask = mockOS.scheduled.find((s) => s.data?.kind === 'task-reminder')!;
    mockOS.scheduled.push(
      { identifier: 'dup-habit-os', data: { ...(dupHabit.data ?? {}) } },
      { identifier: 'dup-task-os', data: { ...(dupTask.data ?? {}) } },
    );

    const r2 = await reconcileReminders(() => [makeHabit()], baseMorning, ctx);
    expect(r2.added).toBe(0);
    expect(r2.cancelled).toBe(1);
    expect(r2.timeSupport?.added).toBe(0);
    expect(r2.timeSupport?.cancelled).toBe(1);

    // Verify uniqueness per (dayKey, targetId, channel)
    const keysByTuple = new Map<string, number>();
    for (const s of mockOS.scheduled) {
      const kind = String(s.data?.kind ?? 'unknown');
      if (kind === 'reentry') continue;
      const day = String(s.data?.day ?? '');
      const target = String(s.data?.habitId ?? s.data?.taskId ?? 'evening');
      const tuple = `${day}|${target}|${kind}`;
      keysByTuple.set(tuple, (keysByTuple.get(tuple) ?? 0) + 1);
    }
    for (const count of keysByTuple.values()) {
      expect(count).toBe(1);
    }

    // Completing today's habit log & postponing task to tomorrow cancels today's reminders
    mockReviewLogs = [{ habit_id: 'hab-1', completed_at: '2026-11-24T08:05:00.000Z', state: 'done' }];
    currentTasks = [makeTaskBlock({ due_date: '2026-11-25' })];

    const r3 = await reconcileReminders(() => [makeHabit()], baseMorning, ctx);
    expect(r3.cancelled).toBeGreaterThanOrEqual(1);
    expect(r3.timeSupport?.cancelled).toBe(1);
    expect(r3.timeSupport?.added).toBe(1);

    const todayHabitScheduled = mockOS.scheduled.filter(
      (s) => s.data?.kind === 'habit' && s.data?.day === '2026-11-24',
    );
    const todayTaskScheduled = mockOS.scheduled.filter(
      (s) => s.data?.kind === 'task-reminder' && s.data?.day === '2026-11-24',
    );
    expect(todayHabitScheduled).toHaveLength(0);
    expect(todayTaskScheduled).toHaveLength(0);
  });

  it('(+) permission denial degrades cleanly (permission: false, zero crash) and account switch prevents reminder/follow-up leaks', async () => {
    await saveTimeSupportSettings(
      { ...DEFAULT_TIME_SUPPORT_SETTINGS, taskLeadMin: 10, followUp: true },
      'user-a',
    );
    await stopFollowUps('hab-1', '2026-11-24', 'user-a');

    let activeUid: string | null = 'user-a';
    const ctx: TimeSupportContext = {
      tasks: () => [makeTaskBlock()],
      userId: () => activeUid,
      focus: () => ({ active: false, endsAt: null }),
      isDayClosed: async () => false,
    };

    // Schedule under user-a with permission granted
    await reconcileReminders(() => [makeHabit()], baseMorning, ctx);
    expect(mockOS.scheduled.length).toBeGreaterThan(0);

    // Revoke OS permission -> degrades cleanly, cancels pending OS items, never throws
    mockOS.permission = false;
    const deniedReport = await reconcileReminders(() => [makeHabit()], baseMorning, ctx);
    expect(deniedReport.permission).toBe(false);
    expect(deniedReport.added).toBe(0);
    expect(deniedReport.timeSupport?.skipped).toBe('permission');
    expect(mockOS.scheduled).toHaveLength(0);

    // Re-grant permission, schedule for user-a, then switch to user-b
    mockOS.permission = true;
    await reconcileReminders(() => [makeHabit()], baseMorning, ctx);
    expect(mockOS.scheduled.length).toBeGreaterThan(0);
    expect(await AsyncStorage.getItem(followUpStoppedKey('user-a'))).not.toBeNull();

    resetAccountMemory('user_changed');
    await wipeAccountDevice('user_changed', 'user-a');
    activeUid = 'user-b';

    // Account A's OS reminders & transient follow-up stop state are wiped; Account B has default settings
    expect(mockOS.scheduled).toHaveLength(0);
    expect(await AsyncStorage.getItem(followUpStoppedKey('user-a'))).toBeNull();

    const userBReport = await reconcileReminders(() => [], baseMorning, ctx);
    expect(userBReport.planned).toBe(0);
    expect(userBReport.timeSupport?.tasks).toBe(0);
    expect(userBReport.timeSupport?.added).toBe(0);
  });
});

// ============================================================================
// 4. U06, U14, E17, P06 — Routine UI Clarity, Cue Policy, Cross-Surface Gate & Focus Guide
// ============================================================================

describe('U06, U14, E17, P06 — Routine cues, UI state clarity, cross-surface action gate, and focus starter guide', () => {
  it('(+) U14: resolveRoutineStepCue suppresses overlapping audio for screen readers, silences cues in quiet hours, and masks lock-screen titles', () => {
    // Screen reader active -> suppresses sound on step_start & time_up so TalkBack/VoiceOver is never drowned out
    const srStart = resolveRoutineStepCue({
      stepId: 's-1',
      stepTitle: 'Terapi notlarını gözden geçir',
      remainingSec: 300,
      nowHm: '14:30',
      event: 'step_start',
      surface: 'lock_screen',
      settings: {
        ...DEFAULT_ROUTINE_CUE_SETTINGS,
        quietStart: '22:00',
        quietEnd: '07:00',
        hidePrivateStepTitles: true,
        screenReaderActive: true,
      },
    });
    expect(srStart.playSound).toBe(false);
    expect(srStart.suppressedByScreenReader).toBe(true);
    expect(srStart.screenReaderAnnouncement).toBe('Sıradaki adım: Terapi notlarını gözden geçir');
    expect(srStart.externalSurfaceTitle).toBe(MASKED_ROUTINE_STEP_TITLE);
    expect(srStart.surfaceTitle).toBe(MASKED_ROUTINE_STEP_TITLE);
    expect(srStart.inAppTitle).toBe('Terapi notlarını gözden geçir');

    // Quiet hours (cross-midnight 22:00..07:00 at 23:45) -> suppresses sound & haptic, keeps calm visual cue
    const quietTimeUp = resolveRoutineStepCue({
      stepId: 's-1',
      stepTitle: 'Gece okuma',
      remainingSec: 0,
      nowHm: '23:45',
      event: 'time_up',
      settings: {
        ...DEFAULT_ROUTINE_CUE_SETTINGS,
        quietStart: '22:00',
        quietEnd: '07:00',
        screenReaderActive: false,
      },
    });
    expect(quietTimeUp.inQuietWindow).toBe(true);
    expect(quietTimeUp.playSound).toBe(false);
    expect(quietTimeUp.playHaptic).toBe(false);
    expect(quietTimeUp.suppressedByQuietHours).toBe(true);
    expect(quietTimeUp.visualCue).toBe('calm_time_up');

    // Private title masking helper defaults to true on widget/lock_screen and supports reminder fallback
    expect(maskPrivateSurfaceTitle('Dr. Kaya randevusu', { surface: 'widget' })).toBe(
      MASKED_ROUTINE_STEP_TITLE,
    );
    expect(
      maskPrivateSurfaceTitle('İlaç dozu', { surface: 'lock_screen', fallbackKind: 'reminder' }),
    ).toBe(MASKED_REMINDER_TITLE);
    expect(
      maskPrivateSurfaceTitle('Açık başlık', {
        surface: 'widget',
        hidePrivateStepTitles: false,
      }),
    ).toBe('Açık başlık');
  });

  it('(+) U06: RoutineRunnerScreen renders next-step preview, paused session banner, and distinct skipped vs done badges', async () => {
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
    let sess = startSession(RUNNER_TPL, 'sess-u06', T0)!;
    // Mark step 0 done, step 2 skipped, keep index at 0 then move to paused state on step 1
    sess = editMark(sess, 'rs-1', 'done', T0 + 10 * SEC);
    sess = editMark(sess, 'rs-3', 'skipped', T0 + 15 * SEC);
    sess = { ...pauseSession(sess, T0 + 20 * SEC), index: 1 };

    useRoutineRunnerStore.setState({
      userId: 'user-a',
      templates: [RUNNER_TPL],
      session: sess,
      logged: [],
      history: [],
      activeTemplateId: null,
      staleDismissed: [],
      error: null,
    });

    const view = renderWithProviders(React.createElement(RoutineRunnerScreen));
    await act(async () => {
      await flushAsync();
    });

    // 1) Next step preview inside active stepCard (index 1 -> next is index 2 'Masayı hazırla')
    const preview = view.getByTestId('runner-next-step-preview');
    expect(preview.props.children).toBe('Sonra: Masayı hazırla');

    // 2) Paused session banner explicitly distinguishes frozen clock
    const pausedBanner = view.getByTestId('runner-paused-banner');
    expect(pausedBanner).toBeTruthy();
    expect(view.getByText('Oturum duraklatıldı — geçen süre donduruldu')).toBeTruthy();

    // 3) Done vs Skipped steps carry distinct semantic labels and badges
    expect(view.getByText('Yapıldı')).toBeTruthy();
    expect(view.getByText('Atlandı (yapılmadı)')).toBeTruthy();

    view.unmount();
  });

  it('(+) E17: createSurfaceActionGate deduplicates cross-surface rapid taps into 1 side-effect and wipes snapshot on account switch or flag off', () => {
    const gate = createSurfaceActionGate({
      activeUserId: 'user-a',
      externalSurfacesEnabled: true,
    });

    const snap = gate.publishSnapshot({
      userId: 'user-a',
      localDayKey: '2026-11-24',
      rawTitle: 'Özel terapi notu',
      nowMs: T0,
    });
    expect(snap?.title).toBe(MASKED_ROUTINE_STEP_TITLE);
    expect(gate.getSnapshot()).not.toBeNull();

    const baseAction = {
      userId: 'user-a',
      localDayKey: '2026-11-24',
      targetKind: 'habit' as const,
      targetId: 'hab-1',
      action: 'done' as const,
    };
    const expectedId = 'act:user-a:2026-11-24:habit:hab-1:done';
    expect(buildCanonicalSurfaceActionId(baseAction)).toBe(expectedId);

    let sideEffects = 0;
    const rNotification = gate.dispatch(
      { ...baseAction, surface: 'notification' },
      () => { sideEffects += 1; },
    );
    const rWidget = gate.dispatch(
      { ...baseAction, surface: 'widget' },
      () => { sideEffects += 1; },
    );
    const rLockScreen = gate.dispatch(
      { ...baseAction, surface: 'lock_screen' },
      () => { sideEffects += 1; },
    );
    const rColdReplay = gate.dispatch(
      { ...baseAction, surface: 'in_app' },
      () => { sideEffects += 1; },
    );

    expect(rNotification).toEqual({
      outcome: 'accepted',
      actionId: expectedId,
      executed: true,
      surface: 'notification',
    });
    expect(rWidget.outcome).toBe('duplicate_ignored');
    expect(rLockScreen.outcome).toBe('duplicate_ignored');
    expect(rColdReplay.outcome).toBe('duplicate_ignored');
    expect(sideEffects).toBe(1);

    // Mismatched account is rejected with zero side-effect
    const rWrongUser = gate.dispatch(
      { ...baseAction, userId: 'user-b', targetId: 'hab-2', surface: 'widget' },
      () => { sideEffects += 1; },
    );
    expect(rWrongUser.outcome).toBe('rejected_account_mismatch');
    expect(sideEffects).toBe(1);

    // Account switch wipes cached snapshot and resets deduplication scope for user-b
    gate.setAccount('user-b');
    expect(gate.getSnapshot()).toBeNull();
    const rUserB = gate.dispatch(
      { ...baseAction, userId: 'user-b', surface: 'widget' },
      () => { sideEffects += 1; },
    );
    expect(rUserB.outcome).toBe('accepted');
    expect(sideEffects).toBe(2);

    // Republish snapshot for user-b, then disable flag -> wipes snapshot and rejects external tap
    gate.publishSnapshot({
      userId: 'user-b',
      localDayKey: '2026-11-24',
      rawTitle: 'Odak bloğu',
      nowMs: T0 + 1000,
    });
    expect(gate.getSnapshot()).not.toBeNull();

    const rFlagOff = gate.dispatch(
      {
        userId: 'user-b',
        localDayKey: '2026-11-24',
        targetKind: 'routine_step',
        targetId: 'rs-1',
        action: 'done',
        surface: 'widget',
        flagEnabled: false,
      },
      () => { sideEffects += 1; },
    );
    expect(rFlagOff.outcome).toBe('rejected_disabled_surface');
    expect(gate.getSnapshot()).toBeNull();
    expect(sideEffects).toBe(2);
  });

  it('(+) P06: resolveFocusStarterGuide requires zero OS blocker permissions, respects dismissal, adapts to lowEnergy, and cleans storage on account wipe', async () => {
    const full = resolveFocusStarterGuide({ enabled: true, dismissed: false, lowEnergy: false });
    expect(full.visible).toBe(true);
    expect(full.requiresExtraPermissions).toBe(false);
    expect(full.steps).toEqual(DEFAULT_STARTER_GUIDE);
    expect(full.steps).toHaveLength(3);
    expect(full.steps.every((s) => s.durationSec === 10)).toBe(true);

    const lowEnergy = resolveFocusStarterGuide({ enabled: true, dismissed: false, lowEnergy: true });
    expect(lowEnergy.visible).toBe(true);
    expect(lowEnergy.requiresExtraPermissions).toBe(false);
    expect(lowEnergy.steps).toHaveLength(1);

    expect(resolveFocusStarterGuide({ enabled: true, dismissed: true }).visible).toBe(false);
    expect(resolveFocusStarterGuide({ enabled: false, dismissed: false }).visible).toBe(false);

    // Account storage registration & cleanup on switch/deletion
    expect(registeredAccountStorage()).toContain('focusStarterGuide');
    await AsyncStorage.setItem(FOCUS_GUIDE_DISMISSED_KEY('user-a'), '1');
    expect(await AsyncStorage.getItem(FOCUS_GUIDE_DISMISSED_KEY('user-a'))).toBe('1');

    await wipeAccountDevice('user_changed', 'user-a');
    expect(await AsyncStorage.getItem(FOCUS_GUIDE_DISMISSED_KEY('user-a'))).toBeNull();
  });
});
