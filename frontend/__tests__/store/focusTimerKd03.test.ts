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
  addTask: jest.fn(), completeTask: jest.fn(), listOpenTasks: jest.fn(async () => ({ ok: true, data: [] })), removeTask: jest.fn(),
}));
jest.mock('../../lib/haptics', () => ({ haptic: { success: jest.fn() } }));
jest.mock('../../lib/analytics', () => ({ buildEvent: jest.fn(() => ({})), emitEvent: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusStore, DEFAULT_SETTINGS, SESSION_KEY, type FocusSettings } from '../../store/focusStore';
import { startClock, snapshotOf } from '../../lib/focusTimer';

const T0 = 1_800_000_000_000;
const MIN = 60_000;
let now = T0;
const at = (ms: number) => { now = T0 + ms; };

function resetStore(settings: Partial<FocusSettings> = {}) {
  useFocusStore.setState({
    phase: 'work', status: 'idle', secondsLeft: 1500, sessionsCompleted: 0, sessionStartedAt: null,
    clock: null, settings: { ...DEFAULT_SETTINGS, ...settings }, justCompleted: null,
    focusTasks: [], selectedTaskId: null, loadingTasks: false,
  });
}

beforeEach(async () => {
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  now = T0;
  mockWork.calls = [];
  mockWork.gate = null;
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
