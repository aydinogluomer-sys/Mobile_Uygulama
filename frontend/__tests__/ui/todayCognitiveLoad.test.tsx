/**
 * F27 — Today Simplicity Contract, progressive disclosure, part-of-day groups,
 * and zero-render focus timer budget (`P1`–`P8`, `N1`–`N4`).
 */
import React from 'react';
import { Switch } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import AsyncStorage from '@react-native-async-storage/async-storage';

jest.setTimeout(30_000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: ({ children }: { children: React.ReactNode }) => children,
}));
const mockPush = jest.fn();
const mockActionSheet = jest.fn<Promise<string | null>, [unknown]>(async () => null);
jest.mock('../../lib/dialog', () => ({
  actionSheet: (arg: unknown) => mockActionSheet(arg),
  confirm: jest.fn(async () => false),
  notify: jest.fn(async () => undefined),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({}),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
const mockCurrentUser = jest.fn<
  Promise<{ id: string; email: string | null; createdAt?: string | null } | null>,
  []
>(async () => ({ id: 'u1', email: null, createdAt: null }));
jest.mock('../../lib/session', () => ({
  currentUser: () => mockCurrentUser(),
}));
jest.mock('../../lib/notifications', () => ({
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
  listScheduled: async () => [],
  cancelScheduled: async () => undefined,
}));
jest.mock('../../components/XPDisplay', () => () => null);
jest.mock('../../services/reviewService', () => ({
  logsForPeriod: jest.fn(async () => ({ ok: true, data: [] })),
}));
jest.mock('../../services/todayBootstrapService', () => ({
  bootstrapTodayScreen: jest.fn(async () => ({ ok: false, error: 'fallback' })),
}));
jest.mock('../../services/habitService', () => ({
  listHabits: jest.fn(async () => ({ ok: true, data: (globalThis as Record<string, unknown>).__f27Habits })),
  loadTimeOff: jest.fn(async () => ({
    ok: true,
    data: { available: true, pauses: (globalThis as Record<string, unknown>).__f27Pauses, versions: [] },
  })),
  loadChecklists: jest.fn(async () => ({ ok: true, data: { available: false, items: [], checks: [] } })),
  patchHabit: jest.fn(),
  recordGoalVersion: jest.fn(),
  addTimeOff: jest.fn(),
  endTimeOff: jest.fn(async () => ({ ok: true })),
  addChecklistItem: jest.fn(),
  editChecklistItem: jest.fn(),
  setCheck: jest.fn(),
  createHabit: jest.fn(),
  archiveHabit: jest.fn(),
  purgeHabit: jest.fn(),
  restoreHabit: jest.fn(),
  activateHabit: jest.fn(),
  pauseHabit: jest.fn(),
}));
jest.mock('../../services/taskService', () => ({
  listTasks: jest.fn(async () => ({
    ok: true,
    data: { rows: (globalThis as Record<string, unknown>).__f27Tasks, nextCursor: null, hasMore: false },
  })),
  completionPatch: jest.fn(),
  newTaskRow: jest.fn(),
  deliverTaskCommand: jest.fn(),
}));
jest.mock('../../store/logStore', () => {
  const state = {
    fetchLogsForDate: jest.fn(async () => undefined),
    getLogForHabit: () => undefined,
    logHabit: jest.fn(async () => ({ ok: true })),
    pendingSyncCount: 0,
    deadSyncCount: 0,
    logs: [],
  };
  const useLogStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state, subscribe: () => () => undefined },
  );
  return { useLogStore };
});
const mockWpState: { state: unknown; fetchToday: jest.Mock; isStale: () => boolean } = {
  state: null,
  fetchToday: jest.fn(async () => undefined),
  isStale: () => false,
};
jest.mock('../../store/willpowerStore', () => {
  const useWillpowerStore = Object.assign(
    (sel?: (s: typeof mockWpState) => unknown) => (sel ? sel(mockWpState) : mockWpState),
    { getState: () => mockWpState },
  );
  return { useWillpowerStore };
});
jest.mock('../../store/recoveryStore', () => {
  const state = { plans: [], fetchPlans: jest.fn(async () => undefined) };
  const useRecoveryStore = Object.assign(
    (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
    { getState: () => state },
  );
  return { useRecoveryStore };
});

import TodayScreen from '../../app/tabs/today';
import TodayToolsSection from '../../components/settings/TodayToolsSection';
import { TODAY_CONTRACT } from '../../lib/disclosure';
import { resetAccountMemory } from '../../lib/accountScope';
import { invalidateHabitsFetch, useHabitStore } from '../../store/habitStore';
import { useTaskStore } from '../../store/taskStore';
import { useFocusStore } from '../../store/focusStore';
import { useDisclosureStore } from '../../store/disclosureStore';
import { startClock } from '../../lib/focusTimer';

const makeHabit = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id,
  user_id: 'u1',
  name,
  icon: null,
  color: null,
  behavior_type: 'positive',
  tracking_type: 'boolean',
  unit: null,
  daily_goal: null,
  target_direction: null,
  frequency_config: { kind: 'daily' },
  willpower_cost: 2,
  status: 'active',
  impact_level: null,
  urgency: null,
  difficulty: 2,
  estimated_minutes: 15,
  reminders: null,
  cue_habit_id: null,
  cue_note: null,
  life_area: null,
  end_condition: null,
  created_at: '2026-01-01T08:00:00',
  ...over,
});

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    if (typeof n === 'object' && 'children' in (n as Record<string, unknown>)) {
      walk((n as { children: unknown }).children);
    }
  };
  walk(r.toJSON());
  return out.join(' ');
}

function collectHostNodesPreOrder(node: TestRenderer.ReactTestInstance): TestRenderer.ReactTestInstance[] {
  const out: TestRenderer.ReactTestInstance[] = [];
  const walk = (n: TestRenderer.ReactTestInstance | string) => {
    if (typeof n === 'string') return;
    if (typeof n.type === 'string') out.push(n);
    for (const child of n.children) walk(child);
  };
  walk(node);
  return out;
}

const INTERACTIVE_ROLES = new Set(['button', 'checkbox', 'link', 'switch']);

function countInteractiveBeforeFirstCheckbox(r: TestRenderer.ReactTestRenderer): number {
  const hosts = collectHostNodesPreOrder(r.root);
  let count = 0;
  for (const h of hosts) {
    const role = h.props?.accessibilityRole;
    if (role === 'checkbox') return count;
    if (typeof role === 'string' && INTERACTIVE_ROLES.has(role)) count += 1;
  }
  throw new Error('No checkbox host node found in rendered TodayScreen');
}

function blockIdsInOrder(r: TestRenderer.ReactTestRenderer): string[] {
  return collectHostNodesPreOrder(r.root)
    .map((n) => n.props?.testID)
    .filter((id): id is string => typeof id === 'string' && id.startsWith('today-block-'));
}

async function flushEffects(useFake = false) {
  await act(async () => {
    if (useFake) jest.advanceTimersByTime(0);
    else await new Promise((res) => setTimeout(res, 0));
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const mountedRenderers: TestRenderer.ReactTestRenderer[] = [];

async function mountToday(node?: React.ReactElement, useFake = false) {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    r = TestRenderer.create(node ?? <TodayScreen />);
  });
  mountedRenderers.push(r);
  await flushEffects(useFake);
  return r;
}

describe('F27 — todayCognitiveLoad (Simplicity Contract, disclosure, part-of-day, 0-render timer)', () => {
  afterEach(async () => {
    while (mountedRenderers.length > 0) {
      const r = mountedRenderers.pop()!;
      await act(async () => {
        r.unmount();
      });
    }
    jest.useRealTimers();
  });

  beforeEach(async () => {
    jest.useRealTimers();
    resetAccountMemory('signed_out');
    await AsyncStorage.clear();
    invalidateHabitsFetch();
    (globalThis as Record<string, unknown>).__f27Habits = [makeHabit('h1', 'Yürüyüş')];
    (globalThis as Record<string, unknown>).__f27Pauses = [];
    (globalThis as Record<string, unknown>).__f27Tasks = [];
    mockWpState.state = null;
    mockCurrentUser.mockResolvedValue({ id: 'u1', email: null, createdAt: null });
    useHabitStore.setState({
      habits: [],
      pauses: [],
      goalVersions: [],
      timeOffAvailable: null,
      checklistItems: [],
      checklistChecks: [],
      checklistAvailable: null,
    } as never);
    useTaskStore.setState({ tasks: [], cursor: null, hasMore: false, loading: false, error: null });
    useFocusStore.setState({
      status: 'idle',
      secondsLeft: 1500,
      smallStep: null,
      pausedAt: null,
      sessionStartedAt: null,
      sessionsCompleted: 0,
    });
    mockPush.mockClear();
    mockActionSheet.mockClear();
  });

  it('P1 & P3: renders exactly [today-block-hero, today-block-habits, today-block-composer] in DOM order on default morning view', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 7, 10, 0, 0));
    const r = await mountToday(undefined, true);
    const blocks = blockIdsInOrder(r);
    expect(blocks).toEqual(['today-block-hero', 'today-block-habits', 'today-block-composer']);
    expect(blocks.length).toBeLessThanOrEqual(TODAY_CONTRACT.maxMainBlocks);
    await act(async () => { r.unmount(); });
  });

  it('P2: keeps interactive host nodes before the first habit checkbox <= 8 at both 10:00 and 20:00 (when Günü Kapat chip appears)', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 7, 10, 0, 0));
    const r10 = await mountToday(undefined, true);
    const count10 = countInteractiveBeforeFirstCheckbox(r10);
    expect(count10).toBeGreaterThan(0);
    expect(count10).toBeLessThanOrEqual(TODAY_CONTRACT.maxInteractiveBeforeFirstHabit);
    expect(r10.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel?.startsWith?.('Günü kapat:'))).toHaveLength(0);
    await act(async () => { r10.unmount(); });

    jest.setSystemTime(new Date(2026, 2, 7, 20, 0, 0));
    const r20 = await mountToday(undefined, true);
    const count20 = countInteractiveBeforeFirstCheckbox(r20);
    expect(count20).toBeGreaterThan(0);
    expect(count20).toBeLessThanOrEqual(TODAY_CONTRACT.maxInteractiveBeforeFirstHabit);
    expect(r20.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel?.startsWith?.('Günü kapat:'))).toHaveLength(1);
    await act(async () => { r20.unmount(); });
  });

  it('P4 & N1: commits 0 renders across 10 secondsLeft ticks, and immediately re-renders when focus status changes to running', async () => {
    let commits = 0;
    const onRender: React.ProfilerOnRenderCallback = () => {
      commits += 1;
    };
    const r = await mountToday(
      <React.Profiler id="today" onRender={onRender}>
        <TodayScreen />
      </React.Profiler>,
    );

    const settledCommits = commits;
    expect(settledCommits).toBeGreaterThan(0);

    await act(async () => {
      for (let i = 1; i <= 10; i += 1) {
        useFocusStore.setState({ secondsLeft: 1500 - i });
      }
    });
    expect(commits).toBe(settledCommits);

    // N1: status transition DOES re-render Today and flips hero CTA to "Devam et"
    await act(async () => {
      useFocusStore.setState({
        status: 'running',
        sessionStartedAt: new Date().toISOString(),
      });
    });
    expect(commits).toBeGreaterThan(settledCommits);
    const resumeBtn = r.root.findAll(
      (n) =>
        typeof n.type === 'string' &&
        n.props?.accessibilityRole === 'button' &&
        /^Devam et/.test(n.props?.accessibilityLabel ?? ''),
    );
    expect(resumeBtn).toHaveLength(1);
    await act(async () => { r.unmount(); });
  });

  it('N2: focusStore.tick() mutates ONLY secondsLeft during an active countdown', () => {
    const now = 1_800_000_000_000;
    const spy = jest.spyOn(Date, 'now').mockReturnValue(now);
    try {
      useFocusStore.setState({
        phase: 'work',
        status: 'running',
        secondsLeft: 1500,
        clock: startClock(1500, now),
        sessionStartedAt: new Date(now).toISOString(),
      });
      const before = { ...useFocusStore.getState() };
      spy.mockReturnValue(now + 1000);
      useFocusStore.getState().tick();
      const after = useFocusStore.getState();

      const changedKeys = (Object.keys(after) as (keyof typeof after)[]).filter(
        (k) => after[k] !== before[k],
      );
      expect(changedKeys).toEqual(['secondsLeft']);
    } finally {
      spy.mockRestore();
    }
  });

  it('N3: hides optional tools by default, toggles each via disclosureStore & TodayToolsSection, and hides again on off', async () => {
    mockWpState.state = {
      user_id: 'u1',
      state_date: '2026-03-07',
      daily_budget: 15,
      used: 4,
      focus_capacity: 3,
      active_count: 1,
    };
    const r = await mountToday();
    const initialText = textOf(r);
    expect(initialText).not.toContain('🔥 ODAK AKIŞI');
    expect(initialText).not.toContain('Açık görev');
    expect(initialText).not.toContain('STRATEJİ & OKR');
    expect(initialText).not.toContain('İrade dengesi');
    expect(initialText).not.toContain('RUTİN');
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Tümünü göster')).toHaveLength(0);

    const checks: [Parameters<ReturnType<typeof useDisclosureStore.getState>['setTool']>[0], () => boolean][] = [
      ['spark', () => textOf(r).includes('🔥 ODAK AKIŞI')],
      ['metrics', () => textOf(r).includes('Açık görev')],
      ['segments', () => r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Tümünü göster').length === 1],
      ['balance', () => textOf(r).includes('İrade dengesi')],
      ['routine', () => textOf(r).includes('RUTİN')],
      ['strategy', () => textOf(r).includes('STRATEJİ & OKR')],
    ];

    for (const [tool, isPresent] of checks) {
      await act(async () => { useDisclosureStore.getState().setTool(tool, 'on'); });
      expect({ tool, on: isPresent() }).toEqual({ tool, on: true });
      await act(async () => { useDisclosureStore.getState().setTool(tool, 'off'); });
      expect({ tool, off: isPresent() }).toEqual({ tool, off: false });
    }

    // TodayToolsSection UI switch + resetTools
    let settingsRenderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      settingsRenderer = TestRenderer.create(<TodayToolsSection />);
    });
    mountedRenderers.push(settingsRenderer);
    const switches = settingsRenderer.root.findAllByType(Switch);
    expect(switches).toHaveLength(6);
    await act(async () => {
      switches[0].props.onValueChange?.(true);
    });
    expect(useDisclosureStore.getState().choices.spark).toBe('on');
    expect(textOf(r)).toContain('🔥 ODAK AKIŞI');

    const resetBtn = settingsRenderer.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Önerilen düzene dön' && typeof n.props.onPress === 'function',
    )[0];
    expect(resetBtn).toBeDefined();
    await act(async () => {
      resetBtn.props.onPress();
    });
    expect(useDisclosureStore.getState().choices).toEqual({});
  });

  it('P5: renders a single today-block-context between hero and habits only when context (holiday / legacy notice) is active', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 7, 10, 0, 0));
    const rEmpty = await mountToday(undefined, true);
    expect(blockIdsInOrder(rEmpty)).toEqual(['today-block-hero', 'today-block-habits', 'today-block-composer']);
    await act(async () => { rEmpty.unmount(); });

    invalidateHabitsFetch();
    (globalThis as Record<string, unknown>).__f27Pauses = [
      { id: 'hol1', habit_id: null, kind: 'holiday', start_date: '2026-03-07', end_date: null },
    ];
    mockCurrentUser.mockResolvedValue({ id: 'legacyU', email: null, createdAt: '2026-01-01T08:00:00Z' });
    resetAccountMemory('user_changed');

    const rCtx = await mountToday(undefined, true);
    const blocks = blockIdsInOrder(rCtx);
    expect(blocks).toEqual(['today-block-hero', 'today-block-context', 'today-block-habits', 'today-block-composer']);
    expect(blocks.length).toBeLessThanOrEqual(TODAY_CONTRACT.maxBlocksWithContext);
    expect(textOf(rCtx)).toContain('TATİL MODU');
    expect(textOf(rCtx)).toContain('Bugün sadeleşti.');

    const okBtn = rCtx.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Tamam' && typeof n.props.onPress === 'function',
    )[0];
    expect(okBtn).toBeDefined();
    await act(async () => { okBtn.props.onPress(); });
    expect(useDisclosureStore.getState().legacyNoticeSeen).toBe(true);
  });

  it('P6 & N4: collapses non-current part-of-day groups while keeping current & anytime open, and renders flat with no headers when part_of_day is absent', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 7, 20, 0, 0));

    // N4: flat list when no habit carries part_of_day
    const rFlat = await mountToday(undefined, true);
    const flatGroupHeaders = rFlat.root.findAll(
      (n) =>
        typeof n.type === 'string' &&
        n.props?.accessibilityRole === 'button' &&
        typeof n.props?.accessibilityState?.expanded === 'boolean',
    );
    expect(flatGroupHeaders).toHaveLength(0);
    expect(rFlat.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Yürüyüş')).toHaveLength(1);
    await act(async () => { rFlat.unmount(); });

    // P6: 3 habits (morning, evening, anytime) at 20:00
    invalidateHabitsFetch();
    useHabitStore.setState({ habits: [] } as never);
    (globalThis as Record<string, unknown>).__f27Habits = [
      makeHabit('hm', 'Sabah Koşusu', { frequency_config: { kind: 'daily', part_of_day: ['morning'] } }),
      makeHabit('he', 'Akşam Günlüğü', { frequency_config: { kind: 'daily', part_of_day: ['evening'] } }),
      makeHabit('ha', 'Su İç', { frequency_config: { kind: 'daily' } }),
    ];

    const rGrouped = await mountToday(undefined, true);
    expect(rGrouped.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Akşam Günlüğü')).toHaveLength(1);
    expect(rGrouped.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Su İç')).toHaveLength(1);
    expect(rGrouped.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Sabah Koşusu')).toHaveLength(0);

    const morningHeader = rGrouped.root.findAll(
      (n) =>
        n.props?.accessibilityRole === 'button' &&
        n.props?.accessibilityState?.expanded === false &&
        String(n.props?.accessibilityLabel ?? '').startsWith('Sabah,') &&
        typeof n.props.onPress === 'function',
    )[0];
    expect(morningHeader).toBeDefined();

    await act(async () => {
      morningHeader.props.onPress();
    });
    expect(rGrouped.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Sabah Koşusu')).toHaveLength(1);
  });

  it('P7: rolls clock.today across midnight via useTodayClock and recomputes due habits', async () => {
    // Sunday 2026-03-08 23:59:30 local -> Monday 2026-03-09 00:00:00.250 local
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 8, 23, 59, 30));
    (globalThis as Record<string, unknown>).__f27Habits = [
      makeHabit('hSun', 'Pazar Ritüeli', { frequency_config: { kind: 'weekly', days: [6] } }),
      makeHabit('hMon', 'Pazartesi Ritüeli', { frequency_config: { kind: 'weekly', days: [0] } }),
    ];

    const r = await mountToday(undefined, true);
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Pazar Ritüeli')).toHaveLength(1);
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Pazartesi Ritüeli')).toHaveLength(0);

    await act(async () => {
      jest.advanceTimersByTime(31_000);
    });
    await flushEffects(true);

    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Pazartesi Ritüeli')).toHaveLength(1);
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Pazar Ritüeli')).toHaveLength(0);
  });

  it('P8: includes "Günü kapat" in the Diğer actionSheet at all hours and records markFirstClose on confirm', async () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 2, 7, 10, 0, 0));
    const r = await mountToday(undefined, true);

    const more = r.root.findAll(
      (n) => n.props?.accessibilityLabel === 'Diğer' && typeof n.props.onPress === 'function',
    )[0];
    expect(more).toBeDefined();
    mockActionSheet.mockResolvedValueOnce('shutdown');
    await act(async () => {
      await more.props.onPress();
    });

    expect(mockActionSheet).toHaveBeenCalledTimes(1);
    const arg = mockActionSheet.mock.calls[0][0] as { options: { id: string; label: string }[] };
    expect(arg.options.map((o) => o.label)).toContain('Günü kapat');

    const closeBtn = r.root.findAll(
      (n) =>
        n.props?.accessibilityLabel === 'Bugünlük bitti, ekranı kapat' &&
        typeof n.props.onPress === 'function',
    )[0];
    expect(closeBtn).toBeDefined();
    await act(async () => {
      closeBtn.props.onPress();
    });
    expect(useDisclosureStore.getState().firstCloseAt).not.toBeNull();
  });
});
