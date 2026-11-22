/**
 * F16 (INT-02, INT-08, INT-09, INT-10, INT-23) — `store/focusStore` background
 * wall-clock continuation, OS focus-end notification lifecycle, partial effort
 * recording, 12-hour snapshot freshness, settings normalization, and F33 awayMs seam.
 */
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

jest.mock('expo-notifications', () => ({
  __esModule: true,
  ...jest.requireActual('expo-notifications'),
  getPermissionsAsync: jest.fn(async () => ({ granted: false, status: 'denied' })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true, status: 'granted' })),
  setNotificationChannelAsync: jest.fn(async () => null),
  scheduleNotificationAsync: jest.fn(async () => 'focus-end-work'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  dismissNotificationAsync: jest.fn(async () => undefined),
}));

type WorkArgs = {
  task: unknown;
  plannedSeconds: number;
  completedSeconds: number;
  autoCheckTasks: boolean;
  title?: string | null;
  startedAtIso?: string;
  endedAtIso?: string;
};

type PartialArgs = {
  startedAtIso: string;
  endedAtIso: string;
  plannedSeconds: number;
  completedSeconds: number;
  taskId?: string | null;
  taskTitle?: string | null;
};

const mockWork = {
  calls: [] as WorkArgs[],
  partials: [] as PartialArgs[],
  gate: null as Promise<void> | null,
  outcome: { sessionRecorded: true, taskCompleted: false } as {
    sessionRecorded: boolean;
    sessionQueued?: boolean;
    taskCompleted: boolean;
  },
};

jest.mock('../../services/focusService', () => ({
  completeWorkPhase: jest.fn(async (args: WorkArgs) => {
    mockWork.calls.push(args);
    if (mockWork.gate) await mockWork.gate;
    return mockWork.outcome;
  }),
  recordPartialWorkPhase: jest.fn(async (args: PartialArgs) => {
    mockWork.partials.push(args);
    return { recorded: true };
  }),
  addTask: jest.fn(),
  completeTask: jest.fn(),
  listOpenTasks: jest.fn(async () => ({ ok: true, data: [] })),
  removeTask: jest.fn(),
}));

const mockNotif = {
  scheduled: [] as { phase: string; endsAtMs: number; plannedSeconds: number; withSound: boolean }[],
  cancelled: [] as (string | undefined)[],
};

jest.mock('../../lib/notifications', () => {
  const actual = jest.requireActual('../../lib/notifications') as typeof import('../../lib/notifications');
  return {
    ...actual,
    scheduleFocusEnd: jest.fn(async (p: { phase: string; endsAtMs: number; plannedSeconds: number; withSound: boolean }) => {
      mockNotif.scheduled.push(p);
      return true;
    }),
    cancelFocusEnd: jest.fn(async (kind?: string) => {
      mockNotif.cancelled.push(kind);
    }),
  };
});

jest.mock('../../lib/haptics', () => ({ haptic: { success: jest.fn(), light: jest.fn(), medium: jest.fn() } }));
jest.mock('../../lib/analytics', () => ({ buildEvent: jest.fn(() => ({})), emitEvent: jest.fn() }));
const mockSession = { uid: 'u1' as string | null };
jest.mock('../../lib/session', () => ({
  currentUser: async () => (mockSession.uid ? { id: mockSession.uid, email: null } : null),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useFocusStore,
  DEFAULT_SETTINGS,
  sessionKey,
  settingsKey,
  normaliseFocusSettings,
  type FocusSettings,
  type FocusTask,
} from '../../store/focusStore';
import { resetAccountMemory } from '../../lib/accountScope';
import {
  FOCUS_END_GRACE_MS,
  SESSION_MAX_AGE_MS,
  pauseClock,
  snapshotOf,
  startClock,
} from '../../lib/focusTimer';
import { FOCUS_END_KIND, focusEndContent, focusEndId, focusEndKindOf } from '../../lib/notifications';
import { reconcile } from '../../lib/reminderPlan';

const SESSION_KEY = sessionKey('u1');
const T0 = 1_800_000_000_000;
const SEC = 1_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
let now = T0;
const at = (deltaMs: number) => {
  now = T0 + deltaMs;
};

function setAppState(value: 'active' | 'background' | 'inactive') {
  Object.defineProperty(AppState, 'currentState', { value, configurable: true });
}

function resetStore(settings: Partial<FocusSettings> = {}) {
  resetAccountMemory('signed_out');
  mockNotif.scheduled = [];
  mockNotif.cancelled = [];
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
    settings: { ...DEFAULT_SETTINGS, ...settings },
    justCompleted: null,
    focusTasks: [],
    selectedTaskId: null,
    loadingTasks: false,
  });
}

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  now = T0;
  setAppState('active');
  mockWork.calls = [];
  mockWork.partials = [];
  mockWork.gate = null;
  mockWork.outcome = { sessionRecorded: true, taskCompleted: false };
  mockSession.uid = 'u1';
  await AsyncStorage.clear();
  resetStore();
});

afterEach(() => {
  setAppState('active');
  jest.restoreAllMocks();
});

describe('INT-02 — wall-clock background continuation and strict pauseInBackground option', () => {
  it('keeps running across background/foreground and reconciles secondsLeft immediately', () => {
    const st = useFocusStore.getState();
    st.start();
    at(1 * MIN);
    useFocusStore.getState().onBackground();
    expect(useFocusStore.getState().status).toBe('running');
    expect(useFocusStore.getState().pausedAt).toBeNull();

    at(11 * MIN);
    const away = useFocusStore.getState().onForeground();
    expect(useFocusStore.getState().status).toBe('running');
    expect(useFocusStore.getState().pausedAt).toBeNull();
    expect(useFocusStore.getState().secondsLeft).toBe(1500 - 660);
    expect(away).toEqual({ awayMs: 10 * MIN });
  });

  it('pauses on background when pauseInBackground is true and does not auto-resume on foreground', () => {
    resetStore({ pauseInBackground: true });
    useFocusStore.getState().start();
    at(4 * MIN);
    useFocusStore.getState().onBackground();
    expect(useFocusStore.getState().status).toBe('paused');
    expect(useFocusStore.getState().pausedAt).toBe(T0 + 4 * MIN);

    at(14 * MIN);
    const away = useFocusStore.getState().onForeground();
    expect(useFocusStore.getState().status).toBe('paused');
    expect(useFocusStore.getState().secondsLeft).toBe(1500 - 240);
    expect(away).toBeNull();
  });

  it('completes a session that finished while backgrounded using expectedEndMs, not the late return time', async () => {
    useFocusStore.getState().start();
    at(2 * MIN);
    useFocusStore.getState().onBackground();
    // User returns 7 minutes AFTER the 25-minute timer ended
    at(32 * MIN);
    useFocusStore.getState().onForeground();
    await flush();
    await flush();

    expect(mockWork.calls).toHaveLength(1);
    expect(mockWork.calls[0]).toMatchObject({
      plannedSeconds: 1500,
      completedSeconds: 1500,
      startedAtIso: new Date(T0).toISOString(),
      endedAtIso: new Date(T0 + 25 * MIN).toISOString(),
    });
  });

  it('returns null awayMs for brief < 10s glances (notification shade)', () => {
    useFocusStore.getState().start();
    at(10 * SEC);
    useFocusStore.getState().onBackground();
    at(15 * SEC);
    expect(useFocusStore.getState().onForeground()).toBeNull();
  });
});

describe('INT-02 — OS focus-end notification lifecycle and PS-40 calm defaults', () => {
  it('arms with FOCUS_END_GRACE_MS on start, cancels on pause, re-arms shifted on resume, cancels on reset/setPhase', async () => {
    resetStore({ notifyOnFinish: true, soundOnFinish: false });
    useFocusStore.getState().start();
    await flush();
    expect(mockNotif.scheduled).toEqual([
      {
        phase: 'work',
        endsAtMs: T0 + 1_500_000 + FOCUS_END_GRACE_MS,
        plannedSeconds: 1500,
        withSound: false,
      },
    ]);

    at(10 * MIN);
    useFocusStore.getState().pause();
    await flush();
    expect(mockNotif.cancelled).toEqual(['work']);

    at(15 * MIN);
    useFocusStore.getState().start();
    await flush();
    expect(mockNotif.scheduled[1]).toEqual({
      phase: 'work',
      endsAtMs: T0 + 1_500_000 + 5 * MIN + FOCUS_END_GRACE_MS,
      plannedSeconds: 1500,
      withSound: false,
    });

    useFocusStore.getState().reset();
    await flush();
    expect(mockNotif.cancelled).toEqual(['work', 'work']);

    // setPhase while running also cancels the armed notice
    useFocusStore.getState().start();
    await flush();
    useFocusStore.getState().setPhase('shortBreak');
    await flush();
    expect(mockNotif.cancelled).toEqual(['work', 'work', 'work']);
  });

  it('cancels work notice on foreground completion and schedules break notice under break id', async () => {
    resetStore({ notifyOnFinish: true, autoStartBreaks: true, shortBreakMinutes: 5 });
    setAppState('active');
    useFocusStore.getState().start();
    await flush();
    mockNotif.scheduled = [];
    mockNotif.cancelled = [];

    at(25 * MIN);
    await useFocusStore.getState().nextPhase();
    await flush();

    expect(mockNotif.cancelled).toEqual(['work']);
    expect(mockNotif.scheduled).toEqual([
      {
        phase: 'shortBreak',
        endsAtMs: T0 + 25 * MIN + 300_000 + FOCUS_END_GRACE_MS,
        plannedSeconds: 300,
        withSound: true,
      },
    ]);
  });

  it('negative: background completion does NOT cancel the work notice, and auto-break uses break id', async () => {
    resetStore({ notifyOnFinish: true, autoStartBreaks: true, shortBreakMinutes: 5 });
    useFocusStore.getState().start();
    await flush();
    mockNotif.scheduled = [];
    mockNotif.cancelled = [];

    setAppState('background');
    at(25 * MIN);
    await useFocusStore.getState().nextPhase();
    await flush();

    expect(mockNotif.cancelled).toEqual([]);
    expect(mockNotif.scheduled).toHaveLength(1);
    expect(mockNotif.scheduled[0].phase).toBe('shortBreak');
    expect(focusEndId(focusEndKindOf('shortBreak'))).toBe('focus-end-break');
    expect(focusEndId(focusEndKindOf('work'))).toBe('focus-end-work');
  });

  it('arms and disarms dynamically when notifyOnFinish is toggled mid-session', async () => {
    resetStore({ notifyOnFinish: false });
    useFocusStore.getState().start();
    await flush();
    expect(mockNotif.scheduled).toHaveLength(0);

    at(5 * MIN);
    useFocusStore.getState().updateSettings({ notifyOnFinish: true });
    await flush();
    expect(mockNotif.scheduled).toHaveLength(1);
    expect(mockNotif.scheduled[0].endsAtMs).toBe(T0 + 1_500_000 + FOCUS_END_GRACE_MS);

    useFocusStore.getState().updateSettings({ notifyOnFinish: false });
    await flush();
    expect(mockNotif.cancelled).toEqual(['work']);
  });

  it('negative: never schedules or cancels OS notices when notifyOnFinish stays false', async () => {
    resetStore({ notifyOnFinish: false });
    useFocusStore.getState().start();
    at(3 * MIN);
    useFocusStore.getState().pause();
    useFocusStore.getState().reset();
    await flush();
    expect(mockNotif.scheduled).toEqual([]);
    expect(mockNotif.cancelled).toEqual([]);
  });

  it('focusEndContent never exposes task titles, and reminderPlan.reconcile leaves focus-end untouched', () => {
    expect(focusEndContent('work', 1500)).toEqual({
      title: 'Odak tamam',
      body: '25 dk bitti. Hazır olduğunda mola ver ya da devam et.',
    });
    expect(focusEndContent('shortBreak', 300)).toEqual({
      title: 'Mola bitti',
      body: 'Hazır olduğunda odağa dönebilirsin; acele yok.',
    });
    const diff = reconcile(
      [
        { identifier: 'focus-end-work', data: { kind: FOCUS_END_KIND, phase: 'work' } },
        { identifier: 'focus-end-break', data: { kind: FOCUS_END_KIND, phase: 'shortBreak' } },
      ],
      [],
    );
    expect(diff.cancel).toEqual([]);
  });
});

describe('INT-08 / K4 — partial focus effort recording and boundaries', () => {
  it('records >= 60s abandoned work on reset and setPhase, sets lastPartial, and clears it on next start', async () => {
    useFocusStore.getState().start();
    at(20 * MIN);
    useFocusStore.getState().reset();
    await flush();

    expect(mockWork.partials).toHaveLength(1);
    expect(mockWork.partials[0]).toEqual({
      startedAtIso: new Date(T0).toISOString(),
      endedAtIso: new Date(T0 + 20 * MIN).toISOString(),
      plannedSeconds: 1500,
      completedSeconds: 1200,
      taskId: null,
      taskTitle: null,
    });
    expect(useFocusStore.getState().lastPartial).toEqual({ seconds: 1200 });

    // Starting a new session clears lastPartial
    at(21 * MIN);
    useFocusStore.getState().start();
    expect(useFocusStore.getState().lastPartial).toBeNull();

    // Switching phase after 15 min also records partial effort
    at(36 * MIN);
    useFocusStore.getState().setPhase('shortBreak');
    await flush();
    expect(mockWork.partials).toHaveLength(2);
    expect(mockWork.partials[1].completedSeconds).toBe(900);
    expect(useFocusStore.getState().phase).toBe('shortBreak');
    expect(useFocusStore.getState().status).toBe('idle');
    expect(useFocusStore.getState().lastPartial).toEqual({ seconds: 900 });
  });

  it('negative: skips < 60s, accepts exact 60s, skips breaks, and skips reset while advancing', async () => {
    useFocusStore.getState().start();
    at(59 * SEC);
    useFocusStore.getState().reset();
    await flush();
    expect(mockWork.partials).toHaveLength(0);
    expect(useFocusStore.getState().lastPartial).toBeNull();

    at(60 * SEC);
    useFocusStore.getState().start();
    at(120 * SEC);
    useFocusStore.getState().reset();
    await flush();
    expect(mockWork.partials).toHaveLength(1);
    expect(mockWork.partials[0].completedSeconds).toBe(60);

    // Break phase reset writes nothing
    mockWork.partials = [];
    useFocusStore.getState().setPhase('shortBreak');
    useFocusStore.getState().start();
    at(5 * MIN);
    useFocusStore.getState().reset();
    await flush();
    expect(mockWork.partials).toHaveLength(0);

    // Reset while nextPhase is awaiting completeWorkPhase does NOT double-write
    useFocusStore.getState().setPhase('work');
    let release!: () => void;
    mockWork.gate = new Promise<void>((r) => {
      release = r;
    });
    at(10 * MIN);
    useFocusStore.getState().start();
    at(35 * MIN);
    const p = useFocusStore.getState().nextPhase();
    useFocusStore.getState().reset();
    release();
    await p;
    await flush();
    expect(mockWork.calls).toHaveLength(1);
    expect(mockWork.partials).toHaveLength(0);
  });

  it('optimistically increments local task counters when offline sessionQueued is true without fetching stale server tasks', async () => {
    const task: FocusTask = {
      id: 'ft1',
      user_id: 'u1',
      title: 'Çevrimdışı görev',
      completed: false,
      selected: true,
      estimated_pomodoros: 4,
      completed_pomodoros: 1,
      total_focus_seconds: 1500,
      color: '#000',
      created_at: '',
    };
    mockWork.outcome = { sessionRecorded: false, sessionQueued: true, taskCompleted: false };
    useFocusStore.setState({ focusTasks: [task], selectedTaskId: 'ft1' });
    useFocusStore.getState().start();
    at(25 * MIN);
    await useFocusStore.getState().nextPhase();

    const updated = useFocusStore.getState().focusTasks[0];
    expect(updated.completed_pomodoros).toBe(2);
    expect(updated.total_focus_seconds).toBe(3000);
  });
});

describe('INT-10 — 12-hour snapshot freshness and stale pause expiry', () => {
  it('drops a > 12h stored work snapshot, records partial effort once, and clears storage', async () => {
    const snap = snapshotOf({
      phase: 'work',
      clock: startClock(1500, T0),
      sessionStartedAt: new Date(T0).toISOString(),
      sessionsCompleted: 0,
      now: T0 + 10 * MIN,
    });
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(snap));

    at(13 * HOUR);
    await useFocusStore.getState().restoreSession();
    await flush();

    expect(useFocusStore.getState().status).toBe('idle');
    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();
    expect(mockWork.partials).toHaveLength(1);
    expect(mockWork.partials[0].completedSeconds).toBe(600);
    expect(useFocusStore.getState().lastPartial).toEqual({ seconds: 600 });

    // Calling restoreSession again does not write a second partial record
    await useFocusStore.getState().restoreSession();
    await flush();
    expect(mockWork.partials).toHaveLength(1);
  });

  it('restores < 12h snapshots with pausedAt preserved across re-stamping, and falls back to lastSeenAt on legacy snapshots', async () => {
    const pausedClock = pauseClock(startClock(1500, T0), T0 + 6 * MIN);
    const freshSnap = snapshotOf({
      phase: 'work',
      clock: pausedClock,
      sessionStartedAt: new Date(T0).toISOString(),
      sessionsCompleted: 1,
      now: T0 + 6 * MIN,
      pausedAt: T0 + 6 * MIN,
    });
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(freshSnap));

    at(3 * HOUR);
    await useFocusStore.getState().restoreSession();
    await flush();
    expect(useFocusStore.getState().status).toBe('paused');
    expect(useFocusStore.getState().pausedAt).toBe(T0 + 6 * MIN);

    // Restore 2 more times at later hours: pausedAt never drifts forward!
    useFocusStore.setState({ status: 'idle', clock: null, sessionStartedAt: null, pausedAt: null });
    at(6 * HOUR);
    await useFocusStore.getState().restoreSession();
    await flush();
    expect(useFocusStore.getState().pausedAt).toBe(T0 + 6 * MIN);

    // At > 12h after pausedAt (even though lastSeenAt was 6h!), snapshot is stale
    useFocusStore.setState({ status: 'idle', clock: null, sessionStartedAt: null, pausedAt: null });
    at(6 * MIN + SESSION_MAX_AGE_MS + 1);
    await useFocusStore.getState().restoreSession();
    await flush();
    expect(useFocusStore.getState().status).toBe('idle');
    expect(mockWork.partials).toHaveLength(1);

    // Legacy snapshot without pausedAt falls back to lastSeenAt
    const legacy = snapshotOf({
      phase: 'work',
      clock: pausedClock,
      sessionStartedAt: new Date(T0).toISOString(),
      sessionsCompleted: 0,
      now: T0 + 14 * HOUR,
    });
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(legacy));
    at(15 * HOUR);
    await useFocusStore.getState().restoreSession();
    expect(useFocusStore.getState().status).toBe('paused');
    expect(useFocusStore.getState().pausedAt).toBe(T0 + 14 * HOUR);
  });

  it('expires an in-memory > 12h paused session on foreground and records partial effort', async () => {
    useFocusStore.getState().start();
    at(5 * MIN);
    useFocusStore.getState().pause();
    expect(useFocusStore.getState().pausedAt).toBe(T0 + 5 * MIN);

    at(5 * MIN + SESSION_MAX_AGE_MS + 1000);
    useFocusStore.getState().onForeground();
    await flush();

    expect(useFocusStore.getState().status).toBe('idle');
    expect(useFocusStore.getState().pausedAt).toBeNull();
    expect(mockWork.partials).toHaveLength(1);
    expect(mockWork.partials[0].completedSeconds).toBe(300);
    expect(useFocusStore.getState().lastPartial).toEqual({ seconds: 300 });
  });

  it('negative: restoreSession neither overwrites a running session nor cancels its armed end notice', async () => {
    resetStore({ notifyOnFinish: true });
    const stored = snapshotOf({
      phase: 'shortBreak',
      clock: startClock(300, T0),
      sessionStartedAt: new Date(T0).toISOString(),
      sessionsCompleted: 2,
      now: T0,
    });
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(stored));

    useFocusStore.getState().start();
    await flush();
    mockNotif.cancelled = [];

    await useFocusStore.getState().restoreSession();
    await flush();

    expect(useFocusStore.getState().status).toBe('running');
    expect(useFocusStore.getState().phase).toBe('work');
    expect(mockNotif.cancelled).toEqual([]);
  });
});

describe('INT-23 — updateSettings normalization and corrupt storage resilience', () => {
  it('clamps out-of-range and NaN values in updateSettings and keeps secondsLeft >= 60', async () => {
    useFocusStore.getState().updateSettings({ workMinutes: 0 });
    expect(useFocusStore.getState().settings.workMinutes).toBe(1);
    expect(useFocusStore.getState().secondsLeft).toBe(60);

    useFocusStore.getState().updateSettings({ workMinutes: Number.NaN });
    expect(useFocusStore.getState().settings.workMinutes).toBe(25);
    expect(useFocusStore.getState().secondsLeft).toBe(1500);

    expect(normaliseFocusSettings({ pauseInBackground: true }).pauseInBackground).toBe(true);
    expect(normaliseFocusSettings({ pauseInBackground: 'yes' }).pauseInBackground).toBe(false);

    await AsyncStorage.setItem(settingsKey('u1'), '{corrupt-json');
    useFocusStore.getState().updateSettings({ workMinutes: 40 });
    await AsyncStorage.setItem(settingsKey('u1'), '{corrupt-json');
    await useFocusStore.getState().loadSettings();
    expect(useFocusStore.getState().settings.workMinutes).toBe(40);
  });
});

describe('lib/notifications — scheduleFocusEnd & cancelFocusEnd OS contract', () => {
  it('checks permission without prompting, creates both Android channels, schedules DATE trigger, and cancels/dismisses', async () => {
    const actualNotif = jest.requireActual('../../lib/notifications') as typeof import('../../lib/notifications');
    const platformMut = Platform as { OS: string };
    const origOs = platformMut.OS;
    platformMut.OS = 'android';

    const permSpy = Notifications.getPermissionsAsync as jest.Mock;
    const reqSpy = Notifications.requestPermissionsAsync as jest.Mock;
    const chanSpy = Notifications.setNotificationChannelAsync as jest.Mock;
    const schedSpy = Notifications.scheduleNotificationAsync as jest.Mock;
    const cancelSpy = Notifications.cancelScheduledNotificationAsync as jest.Mock;
    const dismissSpy = Notifications.dismissNotificationAsync as jest.Mock;
    permSpy.mockClear().mockResolvedValue({ granted: false });
    reqSpy.mockClear().mockResolvedValue({ granted: true });
    chanSpy.mockClear().mockResolvedValue(null);
    schedSpy.mockClear().mockResolvedValue('focus-end-work');
    cancelSpy.mockClear().mockResolvedValue(undefined);
    dismissSpy.mockClear().mockResolvedValue(undefined);

    try {
      // Near/past instant -> false immediately
      expect(
        await actualNotif.scheduleFocusEnd({
          phase: 'work',
          endsAtMs: T0 + 500,
          plannedSeconds: 1500,
          withSound: true,
          now: T0,
        }),
      ).toBe(false);
      expect(permSpy).not.toHaveBeenCalled();

      // Permission not granted -> false and NEVER prompts
      expect(
        await actualNotif.scheduleFocusEnd({
          phase: 'work',
          endsAtMs: T0 + 60_000,
          plannedSeconds: 1500,
          withSound: true,
          now: T0,
        }),
      ).toBe(false);
      expect(reqSpy).not.toHaveBeenCalled();
      expect(schedSpy).not.toHaveBeenCalled();

      // Permission granted -> sets up HABIT_CHANNEL + FOCUS_CHANNEL and schedules DATE trigger
      permSpy.mockResolvedValue({ granted: true } as never);
      expect(
        await actualNotif.scheduleFocusEnd({
          phase: 'work',
          endsAtMs: T0 + 60_000,
          plannedSeconds: 1500,
          withSound: false,
          now: T0,
        }),
      ).toBe(true);
      expect(chanSpy).toHaveBeenCalledWith(
        'focus-timer',
        expect.objectContaining({ name: 'Odak Bitişi', vibrationPattern: [0, 200, 120, 200] }),
      );
      expect(schedSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          identifier: 'focus-end-work',
          content: expect.objectContaining({ sound: false, data: { kind: 'focus-end', phase: 'work' } }),
          trigger: expect.objectContaining({ channelId: 'focus-timer', date: new Date(T0 + 60_000) }),
        }),
      );

      await actualNotif.cancelFocusEnd();
      expect(cancelSpy).toHaveBeenCalledWith('focus-end-work');
      expect(cancelSpy).toHaveBeenCalledWith('focus-end-break');
      expect(dismissSpy).toHaveBeenCalledWith('focus-end-work');
      expect(dismissSpy).toHaveBeenCalledWith('focus-end-break');
    } finally {
      platformMut.OS = origOs;
    }
  });
});
