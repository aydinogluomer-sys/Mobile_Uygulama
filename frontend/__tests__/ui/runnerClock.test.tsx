/**
 * F34 (PRF-24, INT-14) — `RunnerClock` isolated 1-second tick, `AppState` wake
 * sync, single-fire `onTimeUp`, timer a11y role without live-region spam, zero
 * parent/canvas re-renders across ticks, 600ms double-tap guard, and
 * `StaleLogNotice` calm recovery row.
 */
import React from 'react';
import { AppState, Text, View, type AppStateStatus } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

const mockReact = React;
let mockCanvasRenderCount = 0;
const mockRouterPush = jest.fn();

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u-1', email: null })),
}));
jest.mock('../../store/logStore', () => ({
  useLogStore: {
    getState: () => ({
      logHabit: jest.fn(async () => ({ ok: true })),
    }),
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockRouterPush, navigate: jest.fn(), back: jest.fn() }),
}));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children, ...rest }: Record<string, unknown>) =>
    mockReact.createElement('SafeAreaView', rest, children as React.ReactNode),
}));
jest.mock('../../lib/haptics', () => ({
  haptic: { light: jest.fn(), select: jest.fn(), success: jest.fn(), warning: jest.fn() },
}));
jest.mock('../../components/spatial', () => ({
  AtmosphericScreenCanvas: (props: Record<string, unknown>) => {
    mockCanvasRenderCount += 1;
    return mockReact.createElement('AtmosphericScreenCanvas', props);
  },
  ChapterDivider: (props: Record<string, unknown>) => mockReact.createElement('ChapterDivider', props),
  EmbeddedFiligree: (props: Record<string, unknown>) => mockReact.createElement('EmbeddedFiligree', props),
}));
jest.mock('../../components/ui', () => {
  const actual = jest.requireActual('../../components/ui');
  return {
    ...actual,
    EditorialBanner: (props: Record<string, unknown>) => mockReact.createElement('EditorialBanner', props),
    EmblemMedallion: (props: Record<string, unknown>) => mockReact.createElement('EmblemMedallion', props),
  };
});

import RoutineRunnerScreen from '../../app/screens/routine-runner';
import {
  RunnerClock,
  RunnerEtaText,
  RunnerTimerText,
  RunnerTimeUp,
  useRunnerClock,
} from '../../components/routineRunner/RunnerClock';
import { editMark, pauseSession, setDuration, startSession, type RoutineTemplate } from '../../lib/routineRunner';
import { useRoutineRunnerStore } from '../../store/routineRunnerStore';
import { useHabitStore } from '../../store/habitStore';

const T0 = new Date(2026, 10, 22, 9, 0, 0, 0).getTime();

const TIMED_TPL: RoutineTemplate = {
  id: 'timed-clock',
  name: 'Odak Sabah',
  builtIn: false,
  versions: [
    {
      version: 1,
      createdAt: '2026-11-22T09:00:00.000Z',
      steps: [
        { id: 'c1', title: 'Nefes', kind: 'timed', durationSec: 10, habitId: null },
        { id: 'c2', title: 'Planla', kind: 'timed', durationSec: 300, habitId: null },
      ],
    },
  ],
};

class TestErrorBoundary extends React.Component<
  { onError: (err: Error) => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }
  componentDidCatch(error: Error): void {
    this.props.onError(error);
  }
  render(): React.ReactNode {
    return this.state.hasError ? null : this.props.children;
  }
}

describe('F34 PRF-24 — RunnerClock isolated tick & RoutineRunnerScreen render budget', () => {
  const activeRenderers: TestRenderer.ReactTestRenderer[] = [];
  const track = (r: TestRenderer.ReactTestRenderer) => {
    activeRenderers.push(r);
    return r;
  };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
    jest.setSystemTime(T0);
    mockCanvasRenderCount = 0;
    mockRouterPush.mockClear();
    act(() => {
      useHabitStore.setState({ habits: [] });
    });
  });

  afterEach(() => {
    while (activeRenderers.length > 0) {
      const r = activeRenderers.pop()!;
      act(() => {
        r.unmount();
      });
    }
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('(+) countdown decreases by 5s over 5 ticks, timer has role="timer" without liveRegion, and AppState active syncs immediately', () => {
    let appStateListener: ((s: AppStateStatus) => void) | null = null;
    const removeMock = jest.fn();
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      appStateListener = handler as (s: AppStateStatus) => void;
      return { remove: removeMock } as unknown as ReturnType<typeof AppState.addEventListener>;
    });

    const s = startSession(TIMED_TPL, 'sess-1', T0)!;
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <RunnerClock session={s} running={true}>
          <View>
            <RunnerTimerText />
            <RunnerEtaText />
          </View>
        </RunnerClock>,
      );
    });

    const timerNode = () => r.root.find((n) => n.props?.accessibilityRole === 'timer');
    expect(timerNode().props.children).toBe('00:10');
    expect(timerNode().props.accessibilityLiveRegion).toBeUndefined();

    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(timerNode().props.children).toBe('00:05');

    // Simulate OS sleep jump + AppState 'active' before next interval tick
    act(() => {
      jest.setSystemTime(T0 + 8000);
      appStateListener?.('active');
    });
    expect(timerNode().props.children).toBe('00:02');

    act(() => {
      r.unmount();
    });
    expect(removeMock).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('(+) RunnerTimeUp shows the time-up note, fires onTimeUp ONCE per step, and (-) never auto-completes the step', () => {
    const onTimeUp = jest.fn();
    const s = startSession(TIMED_TPL, 'sess-up', T0)!;
    let r!: TestRenderer.ReactTestRenderer;
    act(() => {
      r = TestRenderer.create(
        <RunnerClock session={s} running={true}>
          <RunnerTimerText />
          <RunnerTimeUp onTimeUp={onTimeUp}>
            <Text>Süre doldu. Tamamlamak sana kalmış — yaptıysan işaretle.</Text>
          </RunnerTimeUp>
        </RunnerClock>,
      );
    });

    expect(onTimeUp).not.toHaveBeenCalled();
    expect(
      r.root.findAllByType(Text).some((t) => String(t.props.children).includes('Süre doldu. Tamamlamak sana kalmış')),
    ).toBe(false);

    // Advance past 10s step duration and keep ticking for several more seconds
    act(() => {
      jest.advanceTimersByTime(14_000);
    });

    expect(onTimeUp).toHaveBeenCalledTimes(1);
    expect(
      r.root.findAllByType(Text).some((t) => String(t.props.children).includes('Süre doldu. Tamamlamak sana kalmış')),
    ).toBe(true);
    expect(s.results).toEqual({});

    // Extending duration on the same step hides the note until elapsed again, still firing onTimeUp at most ONCE per step
    const extended = setDuration(s, 'c1', 20);
    act(() => {
      r.update(
        <RunnerClock session={extended} running={true}>
          <RunnerTimerText />
          <RunnerTimeUp onTimeUp={onTimeUp}>
            <Text>Süre doldu. Tamamlamak sana kalmış — yaptıysan işaretle.</Text>
          </RunnerTimeUp>
        </RunnerClock>,
      );
    });
    expect(
      r.root.findAllByType(Text).some((t) => String(t.props.children).includes('Süre doldu. Tamamlamak sana kalmış')),
    ).toBe(false);

    act(() => {
      jest.advanceTimersByTime(10_000);
    });
    expect(
      r.root.findAllByType(Text).some((t) => String(t.props.children).includes('Süre doldu. Tamamlamak sana kalmış')),
    ).toBe(true);
    expect(onTimeUp).toHaveBeenCalledTimes(1);

    act(() => {
      r.unmount();
    });
  });

  it('(-) AtmosphericScreenCanvas render count does NOT change across 5 seconds of running ticks, and paused leaves 0 timers', async () => {
    const runningSession = startSession(TIMED_TPL, 'sess-screen', T0)!;
    useRoutineRunnerStore.setState({
      userId: 'u-1',
      templates: [TIMED_TPL],
      session: runningSession,
      logged: [],
      history: [],
      activeTemplateId: null,
      staleDismissed: [],
      error: null,
    });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = track(TestRenderer.create(<RoutineRunnerScreen />));
      await Promise.resolve();
    });

    const initialCanvasRenders = mockCanvasRenderCount;
    expect(initialCanvasRenders).toBeGreaterThanOrEqual(1);

    // Advance 5 seconds: timer updates from 00:10 -> 00:05, parent screen/canvas does NOT re-render
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockCanvasRenderCount).toBe(initialCanvasRenders);
    // Only the 1s RunnerClock interval + 15s heartbeat interval remain active
    expect(jest.getTimerCount()).toBe(2);
    const timerNode = r.root.find((n) => n.props?.accessibilityRole === 'timer');
    expect(timerNode.props.children).toBe('00:05');

    // Pause session -> passive effects clear both intervals; flushing one-shot RN timeouts leaves 0 timers
    const paused = pauseSession(runningSession, T0 + 5000);
    act(() => {
      useRoutineRunnerStore.setState({ session: paused });
    });
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(jest.getTimerCount()).toBe(0);

    // Direct RunnerClock with running=false schedules 0 timers immediately
    let pausedClockRenderer!: TestRenderer.ReactTestRenderer;
    act(() => {
      pausedClockRenderer = TestRenderer.create(
        <RunnerClock session={paused} running={false}>
          <RunnerTimerText />
        </RunnerClock>,
      );
    });
    expect(jest.getTimerCount()).toBe(0);
    act(() => {
      pausedClockRenderer.unmount();
    });

    const beforePausedAdvance = timerNode.props.children;
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(timerNode.props.children).toBe(beforePausedAdvance);

    act(() => {
      r.unmount();
    });
    activeRenderers.pop();
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('(+) 600ms double-tap guard prevents completing two steps on rapid double press and allows after 600ms', async () => {
    const runningSession = startSession(TIMED_TPL, 'sess-guard', T0)!;
    useRoutineRunnerStore.setState({
      userId: 'u-1',
      templates: [TIMED_TPL],
      session: runningSession,
      logged: [],
      history: [],
      activeTemplateId: null,
      staleDismissed: [],
      error: null,
    });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = track(TestRenderer.create(<RoutineRunnerScreen />));
      await Promise.resolve();
    });

    const findCompleteBtn = () =>
      r.root.find((n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Adımı tamamla');

    await act(async () => {
      findCompleteBtn().props.onPress();
      await Promise.resolve();
    });
    expect(useRoutineRunnerStore.getState().session?.index).toBe(1);

    // Second tap 100ms later (< 600ms) is ignored
    await act(async () => {
      jest.setSystemTime(T0 + 100);
      findCompleteBtn().props.onPress();
      await Promise.resolve();
    });
    expect(useRoutineRunnerStore.getState().session?.index).toBe(1);

    // Tap after 700ms (>= 600ms) completes the second step
    await act(async () => {
      jest.setSystemTime(T0 + 700);
      findCompleteBtn().props.onPress();
      await Promise.resolve();
    });
    expect(useRoutineRunnerStore.getState().session?.index).toBe(2);

    act(() => {
      r.unmount();
    });
    activeRenderers.pop();
  });

  it('(+) StaleLogNotice renders calm notice with Düzelt and Kalsın when a logged habit step is reverted; (-) useRunnerClock throws outside provider', async () => {
    useHabitStore.setState({
      habits: [
        {
          id: 'h-water',
          user_id: 'u-1',
          name: 'Su',
          icon: null,
          color: null,
          behavior_type: 'positive',
          tracking_type: 'boolean',
          unit: null,
          daily_goal: null,
          target_direction: null,
          frequency_config: { kind: 'daily' },
          willpower_cost: 1,
          status: 'active',
          impact_level: null,
          urgency: null,
          difficulty: 1,
          estimated_minutes: 2,
          reminders: null,
          cue_habit_id: null,
          cue_note: null,
          life_area: null,
          end_condition: null,
          created_at: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    const tplWithHabit: RoutineTemplate = {
      id: 'tpl-h',
      name: 'Sabah',
      builtIn: false,
      versions: [
        {
          version: 1,
          createdAt: 'x',
          steps: [
            { id: 'st-w', title: 'Su iç', kind: 'check', habitId: 'h-water' },
            { id: 'st-2', title: 'Esne', kind: 'timed', durationSec: 60, habitId: null },
          ],
        },
      ],
    };

    const reverted = editMark(startSession(tplWithHabit, 'sess-stale', T0)!, 'st-w', 'skipped', T0 + 1000);
    useRoutineRunnerStore.setState({
      userId: 'u-1',
      templates: [tplWithHabit],
      session: reverted,
      logged: ['h-water'],
      history: [],
      activeTemplateId: null,
      staleDismissed: [],
      error: null,
    });

    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      r = track(TestRenderer.create(<RoutineRunnerScreen />));
      await Promise.resolve();
    });

    const allTexts = r.root
      .findAllByType(Text)
      .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')))
      .join(' ');
    expect(allTexts).toContain('“Su” alışkanlığı bugün hâlâ yapıldı görünüyor; bu adımı geri aldın.');

    const fixBtn = r.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Su alışkanlık kaydını düzelt',
    );
    act(() => {
      fixBtn.props.onPress();
    });
    expect(mockRouterPush).toHaveBeenCalledWith({ pathname: '/screens/habit-detail', params: { id: 'h-water' } });

    const keepBtn = r.root.find(
      (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Su alışkanlığı yapıldı olarak kalsın',
    );
    act(() => {
      keepBtn.props.onPress();
    });
    const afterTexts = r.root
      .findAllByType(Text)
      .map((n) => (Array.isArray(n.props.children) ? n.props.children.join('') : String(n.props.children ?? '')))
      .join(' ');
    expect(afterTexts).not.toContain('“Su” alışkanlığı bugün hâlâ yapıldı görünüyor; bu adımı geri aldın.');

    act(() => {
      r.unmount();
    });
    activeRenderers.pop();

    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const caught: { error: Error | null } = { error: null };
    function OrphanConsumer() {
      useRunnerClock();
      return null;
    }
    act(() => {
      TestRenderer.create(
        <TestErrorBoundary onError={(err) => { caught.error = err; }}>
          <OrphanConsumer />
        </TestErrorBoundary>,
      );
    });
    consoleErrorSpy.mockRestore();
    expect(caught.error?.message).toMatch(/RunnerClock/);
  });
});
