/**
 * R05.03 / KD-03 — the focus store measures running time only, keeps the
 * session's start across resumes, uses the configured lengths, survives an
 * app kill, and records one session however many ticks land while it saves.
 */
const mockWork = { calls: [] as { plannedSeconds: number; completedSeconds: number }[], gate: null as null | Promise<void> };

jest.mock('../../services/focusService', () => ({
  completeWorkPhase: jest.fn(async (args: { plannedSeconds: number; completedSeconds: number }) => {
    mockWork.calls.push({ plannedSeconds: args.plannedSeconds, completedSeconds: args.completedSeconds });
    if (mockWork.gate) await mockWork.gate;
    return { sessionRecorded: true, taskCompleted: false };
  }),
  recordPartialWorkPhase: jest.fn(async () => ({ recorded: true })),
  addTask: jest.fn(), completeTask: jest.fn(), listOpenTasks: jest.fn(async () => ({ ok: true, data: [] })), removeTask: jest.fn(),
}));
jest.mock('../../lib/notifications', () => ({
  scheduleFocusEnd: jest.fn(async () => true),
  cancelFocusEnd: jest.fn(async () => undefined),
}));
jest.mock('../../lib/haptics', () => ({ haptic: { success: jest.fn() } }));
jest.mock('../../lib/analytics', () => ({ buildEvent: jest.fn(() => ({})), emitEvent: jest.fn() }));
// F04: the session and the settings live under the signed-in user's key.
const mockSession = { uid: 'u1' as string | null };
jest.mock('../../lib/session', () => ({ currentUser: async () => (mockSession.uid ? { id: mockSession.uid, email: null } : null) }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  useFocusStore, DEFAULT_SETTINGS, sessionKey, settingsKey, SESSION_KEY_PREFIX, SETTINGS_KEY_PREFIX,
  normaliseFocusSettings, type FocusSettings,
} from '../../store/focusStore';
import { resetAccountMemory } from '../../lib/accountScope';
import { EMPTY_TALLY } from '../../lib/focusRitual';
import { startClock, snapshotOf } from '../../lib/focusTimer';

const SESSION_KEY = sessionKey('u1');
const T0 = 1_800_000_000_000;
const MIN = 60_000;
let now = T0;
const at = (ms: number) => { now = T0 + ms; };

function resetStore(settings: Partial<FocusSettings> = {}) {
  useFocusStore.setState({
    phase: 'work', status: 'idle', secondsLeft: 1500, sessionsCompleted: 0, sessionStartedAt: null,
    clock: null, pausedAt: null, lastPartial: null, intent: null, interruptions: EMPTY_TALLY,
    settings: { ...DEFAULT_SETTINGS, ...settings }, justCompleted: null,
    focusTasks: [], selectedTaskId: null, loadingTasks: false,
  });
}

beforeEach(async () => {
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  now = T0;
  mockWork.calls = [];
  mockWork.gate = null;
  mockSession.uid = 'u1';
  await AsyncStorage.clear();
  resetStore();
});
afterEach(() => jest.restoreAllMocks());

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('KD-03 — pause is not focus time', () => {
  it('20 min work + 5 min pause records 20 minutes', async () => {
    const st = useFocusStore.getState();
    st.start();
    at(10 * MIN); st.pause();
    at(15 * MIN); st.start();
    at(25 * MIN);
    await useFocusStore.getState().nextPhase();
    expect(mockWork.calls).toEqual([{ plannedSeconds: 1500, completedSeconds: 1200 }]);
    expect(useFocusStore.getState().justCompleted?.seconds).toBe(1200);
  });

  it('resume keeps the session\'s start', () => {
    const st = useFocusStore.getState();
    st.start();
    const started = useFocusStore.getState().sessionStartedAt;
    at(5 * MIN); st.pause();
    at(9 * MIN); st.start();
    expect(useFocusStore.getState().sessionStartedAt).toBe(started);
  });

  it('the countdown stands still while paused', () => {
    const st = useFocusStore.getState();
    st.start();
    at(2 * MIN); st.pause();
    at(30 * MIN); st.tick();
    expect(useFocusStore.getState().secondsLeft).toBe(1500 - 120);
  });
});

describe('KD-03 — the clock, not the interval, is the truth', () => {
  it('a tick after a long JS sleep shows the real remaining time', () => {
    useFocusStore.getState().start();
    at(7 * MIN);
    useFocusStore.getState().tick();
    expect(useFocusStore.getState().secondsLeft).toBe(1500 - 420);
  });

  it('ticks landing while the session is saved record it once', async () => {
    let release!: () => void;
    mockWork.gate = new Promise<void>((r) => { release = r; });
    useFocusStore.getState().start();
    at(26 * MIN);
    useFocusStore.getState().tick();
    useFocusStore.getState().tick();
    useFocusStore.getState().tick();
    release();
    await flush(); await flush();
    expect(mockWork.calls).toHaveLength(1);
  });
});

describe('KD-03 — reset uses the configured length', () => {
  it('a 50-minute setting resets to 50 minutes, not 25', () => {
    resetStore({ workMinutes: 50 });
    useFocusStore.getState().start();
    at(MIN);
    useFocusStore.getState().reset();
    expect(useFocusStore.getState().secondsLeft).toBe(3000);
  });
});

describe('KD-03 — the session survives an app kill', () => {
  it('a running session is persisted and comes back paused without the dead time', async () => {
    useFocusStore.getState().start();
    at(8 * MIN);
    useFocusStore.getState().tick();                 // heartbeat: > 15 s since start
    await flush();
    // the app dies; an hour later it starts fresh
    resetStore();
    at(68 * MIN);
    await useFocusStore.getState().restoreSession();
    const s = useFocusStore.getState();
    expect(s.status).toBe('paused');
    expect(s.secondsLeft).toBe(1500 - 480);
    expect(s.sessionStartedAt).toBe(new Date(T0).toISOString());
  });

  it('a session already open in memory is not overwritten by a stored one', async () => {
    const stale = snapshotOf({ phase: 'longBreak', clock: startClock(900, T0), sessionStartedAt: 'x', sessionsCompleted: 3, now: T0 });
    await AsyncStorage.setItem(SESSION_KEY, JSON.stringify(stale));
    useFocusStore.getState().start();
    await useFocusStore.getState().restoreSession();
    expect(useFocusStore.getState().phase).toBe('work');
    expect(useFocusStore.getState().status).toBe('running');
  });

  it('reset and a finished phase clear the stored session', async () => {
    useFocusStore.getState().start();
    await flush();
    expect(await AsyncStorage.getItem(SESSION_KEY)).not.toBeNull();
    useFocusStore.getState().reset();
    await flush();
    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();

    useFocusStore.getState().start();
    at(25 * MIN);
    await useFocusStore.getState().nextPhase();
    await flush();
    expect(await AsyncStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe('F04 (STO-13, INT-16) — a focus session and its settings belong to one account', () => {
  it("A's paused session is not loaded for B; A gets it back", async () => {
    useFocusStore.getState().start();
    at(8 * MIN); useFocusStore.getState().pause();
    await flush(); await flush();
    expect(await AsyncStorage.getItem(sessionKey('u1'))).not.toBeNull();

    // B signs in on the same device (the account boundary resets memory)
    resetAccountMemory('signed_out');
    mockSession.uid = 'u2';
    await useFocusStore.getState().restoreSession();
    expect(useFocusStore.getState().status).toBe('idle');
    expect(useFocusStore.getState().sessionStartedAt).toBeNull();

    // A again: the same user restores the same session
    mockSession.uid = 'u1';
    await useFocusStore.getState().restoreSession();
    expect(useFocusStore.getState().status).toBe('paused');
    expect(useFocusStore.getState().secondsLeft).toBe(1500 - 480);
  });

  it('a session under the old unscoped key is dropped, never loaded', async () => {
    const old = snapshotOf({ phase: 'work', clock: startClock(1500, T0), sessionStartedAt: 'x', sessionsCompleted: 0, now: T0 });
    await AsyncStorage.setItem(SESSION_KEY_PREFIX, JSON.stringify(old));
    await useFocusStore.getState().restoreSession();
    expect(useFocusStore.getState().status).toBe('idle');
    expect(await AsyncStorage.getItem(SESSION_KEY_PREFIX)).toBeNull();
  });

  it('signed out: nothing is restored and nothing is written', async () => {
    await AsyncStorage.setItem(sessionKey('u1'), JSON.stringify(snapshotOf({ phase: 'work', clock: startClock(1500, T0), sessionStartedAt: 'x', sessionsCompleted: 0, now: T0 })));
    mockSession.uid = null;
    await useFocusStore.getState().restoreSession();
    expect(useFocusStore.getState().status).toBe('idle');
    useFocusStore.getState().updateSettings({ workMinutes: 40 });
    await flush(); await flush();
    expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(SETTINGS_KEY_PREFIX))).toEqual([]);
  });

  it("settings are saved under the user's key and read back for that user only", async () => {
    useFocusStore.getState().updateSettings({ workMinutes: 40 });
    await flush(); await flush();
    expect(JSON.parse((await AsyncStorage.getItem(settingsKey('u1')))!).workMinutes).toBe(40);
    resetStore();
    mockSession.uid = 'u2';
    await useFocusStore.getState().loadSettings();
    expect(useFocusStore.getState().settings.workMinutes).toBe(25);
    mockSession.uid = 'u1';
    await useFocusStore.getState().loadSettings();
    expect(useFocusStore.getState().settings.workMinutes).toBe(40);
  });

  it('the old unscoped settings are adopted once, normalised, then removed', async () => {
    await AsyncStorage.setItem(SETTINGS_KEY_PREFIX, JSON.stringify({ workMinutes: 30, hourFormat: '12h' }));
    await useFocusStore.getState().loadSettings();
    expect(useFocusStore.getState().settings).toMatchObject({ workMinutes: 30, hourFormat: '12h' });
    expect(await AsyncStorage.getItem(SETTINGS_KEY_PREFIX)).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(settingsKey('u1')))!).workMinutes).toBe(30);
  });

  it('a corrupt stored setting falls back to the default (no NaN phase length)', async () => {
    await AsyncStorage.setItem(settingsKey('u1'), JSON.stringify({ workMinutes: 'abc', shortBreakMinutes: 9999 }));
    await useFocusStore.getState().loadSettings();
    expect(useFocusStore.getState().settings.workMinutes).toBe(25);
    expect(useFocusStore.getState().settings.shortBreakMinutes).toBe(60);
    expect(Number.isFinite(useFocusStore.getState().secondsLeft)).toBe(true);
    expect(useFocusStore.getState().secondsLeft).toBe(1500);
  });
});

describe('normaliseFocusSettings', () => {
  it.each([
    [{ workMinutes: 'abc' }, 'workMinutes', 25],
    [{ workMinutes: 9999 }, 'workMinutes', 120],
    [{ workMinutes: 0 }, 'workMinutes', 1],
    [{ workMinutes: 32.6 }, 'workMinutes', 33],
    [{ workMinutes: Number.NaN }, 'workMinutes', 25],
    [{ longBreakInterval: 1 }, 'longBreakInterval', 2],
    [{ overlayOpacity: 0.35 }, 'overlayOpacity', 0.35],
    [{ overlayOpacity: 4 }, 'overlayOpacity', 1],
    [{ hourFormat: 'foo' }, 'hourFormat', '24h'],
    [{ defaultReportRange: 'decade' }, 'defaultReportRange', 'week'],
    [{ soundOnFinish: 'yes' }, 'soundOnFinish', true],
    [{ presetId: 42 }, 'presetId', 'default'],
  ] as [Record<string, unknown>, keyof FocusSettings, unknown][])('%j -> %s = %p', (raw, key, expected) => {
    expect(normaliseFocusSettings(raw)[key]).toBe(expected);
  });

  it('not an object -> the defaults', () => {
    for (const raw of [null, undefined, 'x', 3, [1, 2]]) expect(normaliseFocusSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it('a valid full object comes back unchanged; unknown keys are dropped', () => {
    const valid: FocusSettings = { ...DEFAULT_SETTINGS, workMinutes: 50, hourFormat: '12h', defaultReportRange: 'month', autoStartBreaks: true, presetId: 'deep' };
    expect(normaliseFocusSettings(valid)).toEqual(valid);
    expect(Object.keys(normaliseFocusSettings({ ...valid, evil: 1 })).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
  });
});
