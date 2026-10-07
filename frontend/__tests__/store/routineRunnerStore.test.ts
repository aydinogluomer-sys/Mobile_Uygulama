/**
 * R05.02 / R05.07 — the runner store: per-account device storage, a session
 * restored after a kill, habit logs once and never for measurable habits,
 * and "şablona uygula" never changing a built-in.
 */
const mockLogCalls: any[] = [];
const mockSession = { user: { id: 'user-a', email: null } as any };

jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => mockSession.user) }));
jest.mock('../../store/logStore', () => ({
  useLogStore: { getState: () => ({ logHabit: jest.fn(async (p: any) => { mockLogCalls.push(p); return { ok: true }; }) }) },
}));
jest.mock('../../store/habitStore', () => ({
  useHabitStore: {
    getState: () => ({
      habits: [
        { id: 'h-bool', name: 'Su', tracking_type: 'boolean', status: 'active' },
        { id: 'h-num', name: 'Adım', tracking_type: 'numeric', status: 'active' },
      ],
    }),
  },
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRoutineRunnerStore, RUNNER_KEY } from '../../store/routineRunnerStore';

const st = () => useRoutineRunnerStore.getState();
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  mockLogCalls.length = 0;
  mockSession.user = { id: 'user-a', email: null };
  await AsyncStorage.clear();
  useRoutineRunnerStore.setState({ userId: null, templates: [], session: null, logged: [], history: [], error: null });
  await st().hydrate();
});

describe('starting and persisting', () => {
  it('a built-in template starts; a second start is refused while one runs', () => {
    expect(st().start('builtin-morning')).toBe(true);
    expect(st().start('builtin-evening')).toBe(false);
    expect(st().session?.templateName).toBe('Sabah');
  });

  it('a session survives an app kill, paused at the last save -- not at its start', async () => {
    const realNow = Date.now;
    let now = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    st().start('builtin-work');
    now += 4 * 60_000;
    st().heartbeat();
    await flush();
    // app dies; hours later it comes back
    now += 3 * 60 * 60_000;
    useRoutineRunnerStore.setState({ userId: null, session: null });
    await st().hydrate();
    const s = st().session!;
    expect(s.status).toBe('paused');
    expect(s.clock.accumulatedMs).toBe(4 * 60_000);
    (Date.now as jest.Mock).mockRestore?.();
    Date.now = realNow;
  });

  it('each account has its own runner state', async () => {
    st().start('builtin-morning');
    await flush();
    mockSession.user = { id: 'user-b', email: null };
    await st().hydrate();
    expect(st().session).toBeNull();
    expect(await AsyncStorage.getItem(RUNNER_KEY('user-a'))).not.toBeNull();
  });
});

describe('R05.07 — habit logs', () => {
  it('a completed step linked to a yes/no habit logs it done once; a measurable habit is never logged from here', async () => {
    st().start('builtin-morning');
    st().addStep({ title: 'Su', kind: 'check', habitId: 'h-bool' });
    st().addStep({ title: 'Adım', kind: 'check', habitId: 'h-num' });
    // complete everything in order
    for (let i = 0; i < 5; i++) await st().complete();
    expect(mockLogCalls.map((c) => [c.habitId, c.state])).toEqual([['h-bool', 'done']]);
    // marking it again and completing again does not log twice
    st().mark(st().session!.steps[3].id, null);
    st().back();
    await st().complete();
    expect(mockLogCalls).toHaveLength(1);
  });
});

describe('finishing and templates', () => {
  it('finish records a history entry with the summary', () => {
    st().start('builtin-evening');
    st().skip();
    st().finish();
    expect(st().history[0]).toMatchObject({ templateName: 'Akşam', summary: { skipped: 1, done: 0, total: 3 } });
  });

  it('an edited built-in becomes the user\'s copy; the built-in is untouched', () => {
    st().start('builtin-morning');
    st().addStep({ title: 'Yeni', kind: 'check' });
    st().finish();
    st().applyToTemplate();
    expect(st().templates).toHaveLength(1);
    expect(st().templates[0].name).toBe('Sabah (benim)');
    const builtIn = st().allTemplates().find((t) => t.id === 'builtin-morning')!;
    expect(builtIn.versions[0].steps).toHaveLength(3);
  });

  it('an edited own template gets a new version', () => {
    st().start('builtin-morning');
    st().addStep({ title: 'Yeni', kind: 'check' });
    st().finish();
    st().applyToTemplate();
    st().discard();
    const mine = st().templates[0];
    st().start(mine.id);
    st().removeStep(st().session!.steps[0].id);
    st().finish();
    st().applyToTemplate();
    expect(st().templates[0].versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it('nothing to apply when the session was not edited', () => {
    st().start('builtin-morning');
    st().finish();
    st().applyToTemplate();
    expect(st().templates).toHaveLength(0);
  });
});
