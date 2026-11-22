/**
 * §22 analytics emission -- `store/focusStore.ts` /
 * `focus_started` + `focus_completed`.  (task Phase-4 CODER-O)
 *
 * Behavioural, for the reason spelled out in
 * `habitStoreAnalytics.test.ts`'s header.
 *
 * Two things make this store the awkward one, and both are asserted here
 * rather than assumed:
 *
 *  - `app/tabs/focus.tsx` calls `start()` for BOTH "Başla" and "Devam Et",
 *    so a naive emission in `start()` would report an extra session for
 *    every pause/resume the user does.
 *  - a pomodoro chain can auto-start the next phase from inside
 *    `nextPhase()`. Before this task that path set `status: 'running'`
 *    inline; it now routes through `start()`, so auto-started sessions are
 *    reported like hand-started ones instead of producing a
 *    `focus_completed` with no matching `focus_started`.
 *
 * Invariants:
 *  AC-1  idle -> running emits exactly one `focus_started`.
 *  AC-2  a pause/resume cycle emits NO second `focus_started`.
 *  AC-3  a completed work session emits exactly one `focus_completed`, gated
 *        on the `focus_sessions` insert actually succeeding.
 *  AC-4  a rejected insert emits nothing, while the phase still advances.
 *  AC-5  the phase reaches the payload as a lowercase enum token. The raw
 *        `Phase` union is camelCase ('shortBreak'), which `buildEvent`'s
 *        shape allowlist would DROP -- an event silently missing its most
 *        important dimension.
 *  AC-6  no task title on any event (it is written to the user's own
 *        `focus_sessions` row, which is a different boundary).
 *  AC-7  a throwing sink does not break the timer.
 */
type PgError = { message: string } | null;

const mockState = {
  inserts: [] as { table: string; row: Record<string, unknown> }[],
  sessionError: null as PgError,
  user: { id: 'u1' } as { id: string } | null,
  tasks: [] as Record<string, unknown>[],
};

/** Chainable + thenable query stub. `mock`-prefixed so Jest's hoisting check
 *  allows the factory below to name it. */
type MockQuery = {
  eq: () => MockQuery;
  order: () => MockQuery;
  then: (onOk: (v: unknown) => unknown) => Promise<unknown>;
};

jest.mock('../../lib/supabase', () => {
  // The repository layer terminates its chains explicitly -- `.limit()` on a
  // bounded read, `.select().maybeSingle()` on a scoped write -- so the mock
  // has to offer those links as well as being thenable.
  const thenable = (result: () => unknown): MockQuery => {
    const q: any = {
      eq: () => q,
      order: () => q,
      limit: () => q,
      maybeSingle: async () => ({ data: mockState.tasks[0] ?? null, error: null }),
      select: () => ({
        maybeSingle: async () => {
          const r = result() as { data: unknown; error: unknown };
          return { data: r.error ? null : { id: 'ft1' }, error: r.error };
        },
        single: async () => {
          const r = result() as { data: unknown; error: unknown };
          return { data: r.error ? null : { id: 'ft1' }, error: r.error };
        },
        then: (onOk: (v: unknown) => unknown) => Promise.resolve(result()).then(onOk),
      }),
      then: (onOk: (v: unknown) => unknown) => Promise.resolve(result()).then(onOk),
    };
    return q as MockQuery;
  };
  return {
    supabase: {
      auth: {
      // The data layer resolves the user id from the LOCAL session -- see
      // `repositories/shared.currentUserId`. Derived from this mock's own
      // getUser so the two can never disagree.
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
       getUser: async () => ({ data: { user: mockState.user } }) },
      from: (table: string) => ({
        insert: (row: Record<string, unknown>) => {
          mockState.inserts.push({ table, row });
          return thenable(() => ({
            data: null,
            error: table === 'focus_sessions' ? mockState.sessionError : null,
          }));
        },
        update: () => thenable(() => ({ data: null, error: null })),
        select: () => thenable(() => ({ data: mockState.tasks, error: null })),
      }),
    },
  };
});

jest.mock('../../lib/notifications', () => ({
  scheduleFocusEnd: jest.fn(async () => true),
  cancelFocusEnd: jest.fn(async () => undefined),
}));

jest.mock('../../lib/haptics', () => ({
  haptic: { success: jest.fn(), light: jest.fn(), medium: jest.fn(), warning: jest.fn(), error: jest.fn(), selection: jest.fn() },
}));

// The real module plus a spy on its emission funnel. `buildEvent` is NOT
// stubbed: the privacy filter these tests assert on is the shipping one.
// Spying on `emitEvent` (rather than attaching a sink via
// `setAnalyticsSink`) is deliberate -- `emitEvent` swallows a sink's throw
// by design, so a sink-based spy could never show whether THIS STORE is
// safe against an analytics failure. AC "analytics never breaks the
// feature" below needs the throw to originate where the store calls it.
jest.mock('../../lib/analytics', () => ({
  __esModule: true,
  ...jest.requireActual('../../lib/analytics'),
  emitEvent: jest.fn(),
}));

import * as analytics from '../../lib/analytics';
import type { AnalyticsEvent } from '../../lib/analytics';
import { useFocusStore, DEFAULT_SETTINGS, type FocusSettings, type FocusTask } from '../../store/focusStore';

const emit = (analytics as unknown as { emitEvent: jest.Mock }).emitEvent;

function emitted(name?: string): AnalyticsEvent[] {
  return emit.mock.calls
    .map((c) => c[0] as AnalyticsEvent)
    .filter((e) => name === undefined || e.name === name);
}

const TASK_ID = 'eeeeeeee-5555-4555-8555-eeeeeeeeeeee';
const TASK_TITLE = 'Tez giriş bölümünü yaz ve kaynakları düzenle';

function task(): FocusTask {
  return {
    id: TASK_ID, user_id: 'u1', title: TASK_TITLE, completed: false, selected: true,
    estimated_pomodoros: 4, completed_pomodoros: 0, total_focus_seconds: 0,
    color: '#4F8A8B', created_at: '2026-08-30T08:00:00.000Z',
  };
}

function resetStore(settings: Partial<FocusSettings> = {}) {
  useFocusStore.setState({
    phase: 'work',
    status: 'idle',
    secondsLeft: DEFAULT_SETTINGS.workMinutes * 60,
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

beforeEach(() => {
  mockState.inserts = [];
  mockState.sessionError = null;
  mockState.user = { id: 'u1' };
  mockState.tasks = [];
  emit.mockReset();
  emit.mockImplementation(() => undefined);
  resetStore();
});

describe('AC-1 -- starting a session emits exactly one focus_started', () => {
  it('emits once, with the phase, the planned length and whether a task was chosen', () => {
    resetStore({ workMinutes: 30 });
    useFocusStore.setState({ focusTasks: [task()], selectedTaskId: TASK_ID });

    useFocusStore.getState().start();

    expect(useFocusStore.getState().status).toBe('running');
    const evs = emitted('focus_started');
    expect(evs).toHaveLength(1);
    expect(evs[0].props).toEqual({
      phase: 'work',
      planned_seconds: 1800,
      task_id: TASK_ID,
      has_task: true,
    });
    expect(evs[0].dropped).toEqual([]);
  });

  it('reports has_task:false and a null task_id when nothing is selected', () => {
    useFocusStore.getState().start();

    const ev = emitted('focus_started')[0];
    expect(ev.props.has_task).toBe(false);
    expect(ev.props.task_id).toBeNull();
  });
});

describe('AC-2 -- resuming is not a new session', () => {
  it('pause + start (the "Devam Et" path) emits no second focus_started', () => {
    const st = useFocusStore.getState();
    st.start();
    st.pause();
    st.start();
    st.pause();
    st.start();

    expect(useFocusStore.getState().status).toBe('running');
    expect(emitted('focus_started')).toHaveLength(1);
  });

  it('reset then start IS a new session', () => {
    const st = useFocusStore.getState();
    st.start();
    st.reset();
    st.start();

    expect(emitted('focus_started')).toHaveLength(2);
  });
});

describe('AC-3 -- a completed work session emits exactly one focus_completed', () => {
  it('emits once, after the focus_sessions row is written', async () => {
    resetStore({ workMinutes: 25 });
    useFocusStore.getState().start();
    emit.mockClear();

    await useFocusStore.getState().nextPhase();

    expect(mockState.inserts.filter((i) => i.table === 'focus_sessions')).toHaveLength(1);
    const evs = emitted('focus_completed');
    expect(evs).toHaveLength(1);
    expect(evs[0].props.phase).toBe('work');
    expect(evs[0].props.planned_seconds).toBe(1500);
    expect(evs[0].props.session_number).toBe(1);
    expect(evs[0].props.has_task).toBe(false);
    expect(evs[0].dropped).toEqual([]);
  });

  it('a break ending is not a completed focus session', async () => {
    resetStore();
    useFocusStore.setState({ phase: 'shortBreak' });
    useFocusStore.getState().start();
    emit.mockClear();

    await useFocusStore.getState().nextPhase();

    expect(mockState.inserts.filter((i) => i.table === 'focus_sessions')).toHaveLength(0);
    expect(emitted('focus_completed')).toHaveLength(0);
  });

  it('no session row is written and no event fires when signed out', async () => {
    mockState.user = null;
    useFocusStore.getState().start();
    emit.mockClear();

    await useFocusStore.getState().nextPhase();

    expect(mockState.inserts).toHaveLength(0);
    expect(emitted('focus_completed')).toHaveLength(0);
  });
});

describe('AC-4 -- a rejected session write emits nothing', () => {
  it('no focus_completed when the insert fails, but the phase still advances', async () => {
    mockState.sessionError = { message: 'permission denied for table focus_sessions' };
    useFocusStore.getState().start();
    emit.mockClear();

    await useFocusStore.getState().nextPhase();

    expect(emitted('focus_completed')).toHaveLength(0);
    // Unchanged pre-existing behaviour -- the timer moves on regardless.
    expect(useFocusStore.getState().phase).toBe('shortBreak');
    expect(useFocusStore.getState().sessionsCompleted).toBe(1);
  });
});

describe('AC-5 -- the phase survives the privacy filter as an enum token', () => {
  it('an auto-started break reports short_break, not the camelCase literal', async () => {
    resetStore({ autoStartBreaks: true, shortBreakMinutes: 5 });
    useFocusStore.getState().start();
    emit.mockClear();

    await useFocusStore.getState().nextPhase();

    expect(useFocusStore.getState().status).toBe('running');
    expect(useFocusStore.getState().phase).toBe('shortBreak');

    const started = emitted('focus_started');
    expect(started).toHaveLength(1);
    expect(started[0].props.phase).toBe('short_break');
    expect(started[0].props.planned_seconds).toBe(300);
    // The whole point: nothing was refused by the shape allowlist. A raw
    // 'shortBreak' would appear here as a dropped key instead.
    expect(started[0].dropped).toEqual([]);
  });

  it('an auto-started long break reports long_break', async () => {
    resetStore({ autoStartBreaks: true, longBreakInterval: 2 });
    useFocusStore.setState({ sessionsCompleted: 1 });
    useFocusStore.getState().start();
    emit.mockClear();

    await useFocusStore.getState().nextPhase();

    expect(useFocusStore.getState().phase).toBe('longBreak');
    expect(emitted('focus_started')[0].props.phase).toBe('long_break');
  });

  it('an auto-started pomodoro after a break gets its own focus_started', async () => {
    resetStore({ autoStartPomodoros: true });
    useFocusStore.setState({ phase: 'shortBreak' });
    useFocusStore.getState().start();
    emit.mockClear();

    await useFocusStore.getState().nextPhase();

    expect(useFocusStore.getState().phase).toBe('work');
    expect(useFocusStore.getState().status).toBe('running');
    const started = emitted('focus_started');
    expect(started).toHaveLength(1);
    expect(started[0].props.phase).toBe('work');
  });

  it('does NOT emit a start when auto-start is off', async () => {
    resetStore({ autoStartBreaks: false });
    useFocusStore.getState().start();
    emit.mockClear();

    await useFocusStore.getState().nextPhase();

    expect(useFocusStore.getState().status).toBe('idle');
    expect(emitted('focus_started')).toHaveLength(0);
  });
});

describe('AC-6 -- no task title reaches any event', () => {
  it('the title is written to the session row but never to the payload', async () => {
    mockState.tasks = [];
    useFocusStore.setState({ focusTasks: [task()], selectedTaskId: TASK_ID });

    useFocusStore.getState().start();
    await useFocusStore.getState().nextPhase();

    const serialised = JSON.stringify(emitted());
    expect(emitted().length).toBeGreaterThanOrEqual(2);
    expect(serialised).not.toContain('Tez');
    expect(serialised).not.toContain('kaynakları');

    const sessionRow = mockState.inserts.find((i) => i.table === 'focus_sessions')!.row;
    expect(sessionRow.task_title).toBe(TASK_TITLE);

    for (const ev of emitted()) expect(ev.dropped).toEqual([]);
  });
});

describe('AC-7 -- analytics never breaks the feature', () => {
  it('a throwing sink still starts and still advances the timer', async () => {
    emit.mockImplementation(() => {
      throw new Error('sink exploded');
    });

    useFocusStore.getState().start();
    expect(useFocusStore.getState().status).toBe('running');

    await useFocusStore.getState().nextPhase();

    expect(useFocusStore.getState().phase).toBe('shortBreak');
    expect(useFocusStore.getState().sessionsCompleted).toBe(1);
    expect(useFocusStore.getState().justCompleted).not.toBeNull();
    expect(emit).toHaveBeenCalledTimes(2);
  });
});
