import { readFileSync } from 'fs';
import { join } from 'path';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('../../services/focusService', () => ({
  completeWorkPhase: jest.fn(async () => ({
    sessionRecorded: true,
    taskCompleted: false,
  })),
  recordPartialWorkPhase: jest.fn(async () => ({ recorded: true })),
  addTask: jest.fn(),
  completeTask: jest.fn(),
  listOpenTasks: jest.fn(async () => ({ ok: true, data: [] })),
  removeTask: jest.fn(),
}));

jest.mock('../../lib/notifications', () => ({
  scheduleFocusEnd: jest.fn(async () => true),
  cancelFocusEnd: jest.fn(async () => undefined),
}));

jest.mock('../../lib/haptics', () => ({
  haptic: { success: jest.fn(), light: jest.fn(), medium: jest.fn() },
}));

const emittedPayloads: { name: string; props: Record<string, unknown> }[] = [];
jest.mock('../../lib/analytics', () => ({
  __esModule: true,
  ...jest.requireActual('../../lib/analytics'),
  emitEvent: jest.fn((ev: { name: string; props: Record<string, unknown> }) => {
    emittedPayloads.push(ev);
  }),
}));

const mockSession = { uid: 'u1' as string | null };
jest.mock('../../lib/session', () => ({
  currentUser: async () =>
    mockSession.uid ? { id: mockSession.uid, email: null } : null,
}));

import { endAccountScope, resetAccountMemory } from '../../lib/accountScope';
import { EMPTY_TALLY, focusIntentKey } from '../../lib/focusRitual';
import { stripComments } from '../helpers/sourceText';
import {
  DEFAULT_SETTINGS,
  normaliseFocusSettings,
  useFocusStore,
  type FocusSettings,
} from '../../store/focusStore';

const T0 = 1_800_000_000_000;
const SEC = 1_000;
const MIN = 60_000;
let now = T0;
const at = (deltaMs: number) => {
  now = T0 + deltaMs;
};

function resetStore(settings: Partial<FocusSettings> = {}) {
  resetAccountMemory('signed_out');
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
    focusTasks: [],
    selectedTaskId: null,
    loadingTasks: false,
  });
}

describe('focusRitualStore (PS-11, PS-15)', () => {
  beforeEach(async () => {
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    now = T0;
    mockSession.uid = 'u1';
    emittedPayloads.length = 0;
    await AsyncStorage.clear();
    resetStore();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('(+) persists user-scoped intent, counts >= 10s away, carries intent & interruptions into justCompleted, and clears active state on completion', async () => {
    expect(DEFAULT_SETTINGS.intentPrompt).toBe(true);
    expect(normaliseFocusSettings({ intentPrompt: false }).intentPrompt).toBe(false);
    expect(normaliseFocusSettings({ intentPrompt: 'no' }).intentPrompt).toBe(true);

    await useFocusStore.getState().setIntent('  Giriş bölümünü bitir  ');
    expect(useFocusStore.getState().intent).toBe('Giriş bölümünü bitir');
    expect(await AsyncStorage.getItem(focusIntentKey('u1'))).not.toBeNull();
    expect(await useFocusStore.getState().loadLastIntent()).toBe(
      'Giriş bölümünü bitir',
    );

    useFocusStore.getState().start();
    at(2 * MIN);
    useFocusStore.getState().onBackground();
    at(7 * MIN); // 5 minutes away (300_000 ms)
    const res = useFocusStore.getState().onForeground();
    expect(res).toEqual({ awayMs: 300_000 });
    expect(useFocusStore.getState().interruptions).toEqual({
      total: 1,
      byCause: { notification: 0, someone: 0, self: 0 },
      pendingAwayMs: 300_000,
    });

    useFocusStore.getState().classifyAway('notification');
    expect(useFocusStore.getState().interruptions.byCause.notification).toBe(1);
    expect(useFocusStore.getState().interruptions.pendingAwayMs).toBeNull();

    at(25 * MIN);
    await useFocusStore.getState().nextPhase();

    const st = useFocusStore.getState();
    expect(st.intent).toBeNull();
    expect(st.interruptions).toEqual(EMPTY_TALLY);
    expect(st.justCompleted).toMatchObject({
      seconds: 1500,
      sessionNumber: 1,
      intent: 'Giriş bölümünü bitir',
      interruptions: 1,
    });
  });

  it('(+) counts >= 10s away in strict pauseInBackground mode without auto-resuming the paused session', () => {
    resetStore({ pauseInBackground: true });
    useFocusStore.getState().start();
    at(3 * MIN);
    useFocusStore.getState().onBackground();
    expect(useFocusStore.getState().status).toBe('paused');

    at(5 * MIN);
    useFocusStore.getState().onForeground();
    expect(useFocusStore.getState().status).toBe('paused');
    expect(useFocusStore.getState().interruptions.total).toBe(1);
    expect(useFocusStore.getState().interruptions.pendingAwayMs).toBe(2 * MIN);
  });

  it('(-) ignores < 10s away, break phases, and idle sessions; clears on reset; isolates accounts; and never leaks intent or interruptions to analytics', async () => {
    // 5s away -> ignored
    useFocusStore.getState().start();
    at(10 * SEC);
    useFocusStore.getState().onBackground();
    at(15 * SEC);
    expect(useFocusStore.getState().onForeground()).toBeNull();
    expect(useFocusStore.getState().interruptions.total).toBe(0);

    // Reset clears intent & interruptions
    await useFocusStore.getState().setIntent('Gizli niyet cümlesi');
    at(30 * SEC);
    useFocusStore.getState().onBackground();
    at(60 * SEC);
    useFocusStore.getState().onForeground();
    expect(useFocusStore.getState().interruptions.total).toBe(1);

    useFocusStore.getState().reset();
    expect(useFocusStore.getState().intent).toBeNull();
    expect(useFocusStore.getState().interruptions).toEqual(EMPTY_TALLY);

    // Break phase -> away is not counted
    useFocusStore.getState().setPhase('shortBreak');
    useFocusStore.getState().start();
    at(70 * SEC);
    useFocusStore.getState().onBackground();
    at(120 * SEC);
    useFocusStore.getState().onForeground();
    expect(useFocusStore.getState().interruptions.total).toBe(0);

    // Idle session -> away is not counted
    useFocusStore.getState().reset();
    useFocusStore.getState().onBackground();
    at(200 * SEC);
    useFocusStore.getState().onForeground();
    expect(useFocusStore.getState().interruptions.total).toBe(0);

    // Account isolation & sign-out wipe (transient: true)
    useFocusStore.getState().setPhase('work');
    await useFocusStore.getState().setIntent('Kullanıcı A niyeti');
    mockSession.uid = 'u2';
    expect(await useFocusStore.getState().loadLastIntent()).toBeNull();

    await endAccountScope('signed_out', 'u1');
    expect(await AsyncStorage.getItem(focusIntentKey('u1'))).toBeNull();

    // Analytics payload check (runtime + static source scan)
    const serializedEvents = JSON.stringify(emittedPayloads);
    expect(serializedEvents).not.toContain('Gizli niyet');
    expect(serializedEvents).not.toContain('Kullanıcı A');

    const storeCode = stripComments(
      readFileSync(join(__dirname, '..', '..', 'store', 'focusStore.ts'), 'utf8'),
    );
    const analyticsCalls = [
      ...storeCode.matchAll(/emitAnalytics\s*\(\s*['"][^'"]+['"]\s*,\s*\{[^}]*\}\s*\)/g),
    ].map((m) => m[0]);
    expect(analyticsCalls.length).toBeGreaterThanOrEqual(2);
    for (const call of analyticsCalls) {
      expect(call).not.toMatch(/\bintent\b|\binterruptions\b/);
    }
  });
});
