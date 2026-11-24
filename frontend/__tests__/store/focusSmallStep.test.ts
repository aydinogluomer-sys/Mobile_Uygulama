/**
 * R03.03 — a small step runs as its own focus session: its own length, its
 * own title on the session row, no focus task credited, no break after it,
 * and its parent task never written.
 */
const mockWork = { calls: [] as Record<string, unknown>[] };

jest.mock('../../services/focusService', () => ({
  completeWorkPhase: jest.fn(async (args: Record<string, unknown>) => {
    mockWork.calls.push(args);
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
// F04: a focus session is saved under the signed-in user's key; this suite runs as one user.
jest.mock('../../lib/session', () => ({ currentUser: async () => ({ id: 'u1', email: null }) }));
jest.mock('../../lib/analytics', () => ({ buildEvent: jest.fn((n: string, p: unknown) => ({ name: n, props: p })), emitEvent: jest.fn() }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as analytics from '../../lib/analytics';
import { EMPTY_TALLY } from '../../lib/focusRitual';
import { useFocusStore, DEFAULT_SETTINGS, type FocusTask } from '../../store/focusStore';

const T0 = 1_800_000_000_000;
const MIN = 60_000;
let now = T0;
const PARENT = { kind: 'task' as const, id: 'task-1', title: 'Tez giriş bölümünü yaz' };
const FOCUS_TASK: FocusTask = {
  id: 'ft1', user_id: 'u1', title: 'Pomodoro konusu', completed: false, selected: true,
  estimated_pomodoros: 1, completed_pomodoros: 0, total_focus_seconds: 0, color: '#000', created_at: '',
};

beforeEach(async () => {
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  now = T0;
  mockWork.calls = [];
  (analytics.emitEvent as jest.Mock).mockClear();
  await AsyncStorage.clear();
  useFocusStore.setState({
    phase: 'work', status: 'idle', secondsLeft: 1500, sessionsCompleted: 0, sessionStartedAt: null,
    clock: null, smallStep: null, pausedAt: null, lastPartial: null,
    intent: null, interruptions: EMPTY_TALLY,
    settings: { ...DEFAULT_SETTINGS, autoStartBreaks: true, autoCheckTasks: true },
    justCompleted: null, focusTasks: [FOCUS_TASK], selectedTaskId: 'ft1', loadingTasks: false,
  });
});
afterEach(() => jest.restoreAllMocks());

describe('R03.03 — starting', () => {
  it('runs for the step\'s own length, not the configured pomodoro', () => {
    expect(useFocusStore.getState().startSmallStep(PARENT, { title: 'ilk paragraf', minutes: 5 })).toBe(true);
    const s = useFocusStore.getState();
    expect(s.status).toBe('running');
    expect(s.phase).toBe('work');
    expect(s.secondsLeft).toBe(300);
    expect(s.clock?.plannedSeconds).toBe(300);
    expect(s.smallStep?.title).toBe('ilk paragraf');
  });

  it('is refused while another session is open', () => {
    useFocusStore.getState().start();
    expect(useFocusStore.getState().startSmallStep(PARENT, { title: 'x', minutes: 5 })).toBe(false);
    expect(useFocusStore.getState().smallStep).toBeNull();
  });

  it('is refused for a blank step', () => {
    expect(useFocusStore.getState().startSmallStep(PARENT, { title: ' ', minutes: 5 })).toBe(false);
    expect(useFocusStore.getState().status).toBe('idle');
  });

  it('nothing is recorded before the step finishes', () => {
    useFocusStore.getState().startSmallStep(PARENT, { title: 'x', minutes: 5 });
    expect(mockWork.calls).toHaveLength(0);
  });
});

describe('R03.03 — finishing', () => {
  async function finishStep(minutes = 5) {
    useFocusStore.getState().startSmallStep(PARENT, { title: 'ilk paragraf', minutes });
    now = T0 + minutes * MIN;
    await useFocusStore.getState().nextPhase();
  }

  it('records one session titled with the step, crediting no focus task', async () => {
    await finishStep();
    expect(mockWork.calls).toEqual([{
      task: undefined,
      plannedSeconds: 300,
      completedSeconds: 300,
      autoCheckTasks: false,
      title: 'ilk paragraf',
      startedAtIso: new Date(T0).toISOString(),
      endedAtIso: new Date(T0 + 5 * MIN).toISOString(),
    }]);
  });

  it('no break follows; the timer goes back to the plan', async () => {
    await finishStep();
    const s = useFocusStore.getState();
    expect(s.phase).toBe('work');
    expect(s.status).toBe('idle');
    expect(s.secondsLeft).toBe(1500);
    expect(s.smallStep).toBeNull();
    expect(s.clock).toBeNull();
    expect(s.justCompleted).toEqual({
      taskTitle: 'ilk paragraf',
      seconds: 300,
      sessionNumber: 1,
      intent: null,
      interruptions: 0,
    });
  });

  it('the selected focus task is untouched', async () => {
    await finishStep();
    expect(useFocusStore.getState().focusTasks).toEqual([FOCUS_TASK]);
    expect(useFocusStore.getState().selectedTaskId).toBe('ft1');
  });

  it('a pause inside the step is not focus time', async () => {
    useFocusStore.getState().startSmallStep(PARENT, { title: 'x', minutes: 10 });
    now = T0 + 2 * MIN; useFocusStore.getState().pause();
    now = T0 + 7 * MIN; useFocusStore.getState().start();
    now = T0 + 10 * MIN;
    await useFocusStore.getState().nextPhase();
    expect(mockWork.calls[0].completedSeconds).toBe(5 * 60);
  });
});

describe('R03.03 — leaving and coming back', () => {
  it('reset drops the step', () => {
    useFocusStore.getState().startSmallStep(PARENT, { title: 'x', minutes: 5 });
    useFocusStore.getState().reset();
    expect(useFocusStore.getState().smallStep).toBeNull();
    expect(useFocusStore.getState().secondsLeft).toBe(1500);
  });

  it('an app kill brings the step back, paused', async () => {
    useFocusStore.getState().startSmallStep(PARENT, { title: 'ilk paragraf', minutes: 5 });
    await new Promise((r) => setTimeout(r, 0));
    useFocusStore.setState({ status: 'idle', smallStep: null, clock: null, sessionStartedAt: null });
    await useFocusStore.getState().restoreSession();
    const s = useFocusStore.getState();
    expect(s.status).toBe('paused');
    expect(s.smallStep?.parent).toEqual(PARENT);
    expect(s.clock?.plannedSeconds).toBe(300);
  });
});
