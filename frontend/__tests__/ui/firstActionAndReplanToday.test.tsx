/**
 * Phases F3 & F4 — U01, U03, U04, U05 UI verification:
 * 1. SmallStartSheet with ActionSuggestion, shrink/swap, quick capture, and non-completing parent guarantee.
 * 2. DayReplanSheet 3-step (Koru -> Gor -> Uygula) zero-write cancel, fixed-block lock (REC-01),
 *    staleness block (REC-04), partial retry (REC-03), pending vs committed honesty, and receipt Undo (REC-04).
 * 3. TodayScreen integration keeping interactive controls before first habit checkbox <= 8 at 10:00 and 20:00.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

jest.setTimeout(30_000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
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
  scheduleFocusEnd: jest.fn(async () => true),
  cancelFocusEnd: jest.fn(async () => undefined),
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
  listHabits: jest.fn(async () => ({
    ok: true,
    data: (globalThis as Record<string, unknown>).__u01Habits ?? [],
  })),
  loadTimeOff: jest.fn(async () => ({
    ok: true,
    data: { available: true, pauses: [], versions: [] },
  })),
  loadChecklists: jest.fn(async () => ({
    ok: true,
    data: { available: false, items: [], checks: [] },
  })),
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
    data: {
      rows: (globalThis as Record<string, unknown>).__u01Tasks ?? [],
      nextCursor: null,
      hasMore: false,
    },
  })),
  completionPatch: jest.fn(),
  newTaskRow: jest.fn(),
  deliverTaskCommand: jest.fn(async () => ({ kind: 'applied', version: '2026-03-07T12:01:00.000Z' })),
}));

import TodayScreen from '../../app/tabs/today';
import SmallStartSheet from '../../components/SmallStartSheet';
import DayReplanSheet from '../../components/today/DayReplanSheet';
import { resetAccountMemory } from '../../lib/accountScope';
import {
  evaluateActionSuggestion,
  shrinkActionSuggestion,
  type ActionSuggestion,
} from '../../lib/actionSuggestion';
import { TODAY_CONTRACT } from '../../lib/disclosure';
import type { FixedPlanBlock } from '../../lib/dayPlanPreview';
import type { SmallStepDraft, SmallStepParent } from '../../lib/smallStart';
import type { Habit, HabitLog } from '../../lib/supabase';
import type { Task } from '../../lib/taskTypes';
import type { DayPlanCommitDeps } from '../../services/dayPlanCommitService';
import { useDisclosureStore } from '../../store/disclosureStore';
import { useFocusStore } from '../../store/focusStore';
import { invalidateHabitsFetch, useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useTaskStore } from '../../store/taskStore';
import {
  act,
  fireEvent,
  renderWithProviders,
  screen,
  within,
  type RenderedScreen,
} from '../helpers/renderWithProviders';

const DAY_KEY = '2026-03-07';

const makeTask = (id: string, over: Partial<Task> = {}): Task => ({
  id,
  user_id: 'u1',
  title: `Task ${id}`,
  priority: 'medium',
  status: 'pending',
  list_type: 'inbox',
  due_date: DAY_KEY,
  completed: false,
  created_at: '2026-03-07T08:00:00.000Z',
  updated_at: '2026-03-07T08:00:00.000Z',
  ...over,
});

const makeHabit = (id: string, name: string, over: Partial<Habit> = {}): Habit => ({
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
  impact_level: 'medium',
  urgency: null,
  difficulty: 2,
  estimated_minutes: 20,
  reminders: null,
  cue_habit_id: null,
  cue_note: null,
  life_area: null,
  end_condition: null,
  created_at: '2026-01-01T08:00:00.000Z',
  ...over,
});

function collectInteractiveBeforeFirstCheckbox(r: RenderedScreen): number {
  const interactiveRoles = new Set(['button', 'checkbox', 'link', 'switch']);
  let count = 0;
  let foundCheckbox = false;

  const walk = (node: unknown): void => {
    if (foundCheckbox || node == null || typeof node === 'string') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const obj = node as {
      type?: unknown;
      props?: Record<string, unknown>;
      children?: unknown[];
    };
    if (typeof obj.type === 'string') {
      const role = obj.props?.accessibilityRole;
      if (role === 'checkbox') {
        foundCheckbox = true;
        return;
      }
      if (typeof role === 'string' && interactiveRoles.has(role)) {
        count += 1;
      }
    }
    if (Array.isArray(obj.children)) {
      for (const child of obj.children) walk(child);
    }
  };

  walk(r.toJSON());
  if (!foundCheckbox) {
    throw new Error('Expected at least one habit checkbox in TodayScreen');
  }
  return count;
}

function collectTodayBlocks(r: RenderedScreen): string[] {
  const blocks: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null || typeof node === 'string') return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child);
      return;
    }
    const obj = node as { props?: Record<string, unknown>; children?: unknown[] };
    const tid = obj.props?.testID;
    if (typeof tid === 'string' && tid.startsWith('today-block-')) {
      blocks.push(tid);
    }
    if (Array.isArray(obj.children)) {
      for (const child of obj.children) walk(child);
    }
  };
  walk(r.toJSON());
  return blocks;
}

async function flushEffects(useFake = false): Promise<void> {
  await act(async () => {
    if (useFake) jest.advanceTimersByTime(0);
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
    if (!useFake) {
      await new Promise((res) => setTimeout(res, 0));
    }
  });
}

describe('Phases F3 & F4 — SmallStartSheet (U04), DayReplanSheet (U05), and TodayScreen (U01/U03)', () => {
  const mounted: RenderedScreen[] = [];

  const track = (r: RenderedScreen): RenderedScreen => {
    mounted.push(r);
    return r;
  };

  beforeEach(async () => {
    jest.useRealTimers();
    resetAccountMemory('signed_out');
    await AsyncStorage.clear();
    invalidateHabitsFetch();
    mockCurrentUser.mockResolvedValue({ id: 'u1', email: null, createdAt: null });
    (globalThis as Record<string, unknown>).__u01Habits = [makeHabit('h1', 'Morning Walk')];
    (globalThis as Record<string, unknown>).__u01Tasks = [];
    useHabitStore.setState({
      habits: [],
      pauses: [],
      goalVersions: [],
      timeOffAvailable: null,
      checklistItems: [],
      checklistChecks: [],
      checklistAvailable: null,
    } as never);
    useTaskStore.setState({
      tasks: [],
      outbox: null,
      cursor: null,
      hasMore: false,
      loading: false,
      error: null,
    });
    useLogStore.setState({ logs: [], pendingSyncCount: 0, deadSyncCount: 0 } as never);
    useFocusStore.setState({
      status: 'idle',
      secondsLeft: 1500,
      smallStep: null,
      pausedAt: null,
      sessionStartedAt: null,
      sessionsCompleted: 0,
    });
    useDisclosureStore.setState(useDisclosureStore.getInitialState(), true);
    mockPush.mockClear();
    mockActionSheet.mockClear();
  });

  afterEach(async () => {
    while (mounted.length > 0) {
      const r = mounted.pop()!;
      await act(async () => {
        r.unmount();
      });
    }
    jest.useRealTimers();
  });

  describe('SmallStartSheet (U04)', () => {
    it('renders ActionSuggestion displayReason + missing-estimate note, shrinks & swaps, forwards suggestionId, and never completes parent task', async () => {
      const taskA = makeTask('t-alpha', { title: 'Prepare quarterly deck', estimated_minutes: null });
      const taskB = makeTask('t-beta', { title: 'Review budget sheet', estimated_minutes: 25 });
      useTaskStore.setState({ tasks: [taskA, taskB] });

      const initialSug: ActionSuggestion = evaluateActionSuggestion({
        localDayKey: DAY_KEY,
        userId: 'u1',
        tasksToday: [taskA, taskB],
      });
      const swappedSug: ActionSuggestion = evaluateActionSuggestion({
        localDayKey: DAY_KEY,
        userId: 'u1',
        tasksToday: [taskB],
      });

      const onShrink = jest.fn();
      const onSwap = jest.fn();
      const onStart = jest.fn((parent, draft) =>
        useFocusStore.getState().startSmallStep(parent, draft),
      );

      const r = track(
        renderWithProviders(
          <SmallStartSheet
            parent={{ kind: 'task', id: taskA.id, title: taskA.title }}
            suggestion={initialSug}
            onShrink={onShrink}
            onSwap={onSwap}
            onClose={() => {}}
            onStart={onStart}
          />,
        ),
      );

      expect(screen.getByTestId('small-start-display-reason').props.children).toBe(
        initialSug.displayReason,
      );
      expect(screen.getByTestId('small-start-estimate-note').props.children).toMatch(/5 dk/);
      expect(screen.getByTestId('small-start-min-5').props.accessibilityState?.selected).toBe(true);

      // Shrink: 5 -> 2 minutes
      await r.user.press(screen.getByTestId('small-start-shrink'));
      expect(onShrink).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('small-start-min-2').props.accessibilityState?.selected).toBe(true);

      // Swap callback invoked and rerendering with swapped suggestion updates draft
      await r.user.press(screen.getByTestId('small-start-swap'));
      expect(onSwap).toHaveBeenCalledTimes(1);

      const shrunkSwapped = shrinkActionSuggestion(swappedSug);
      r.rerender(
        <SmallStartSheet
          parent={{ kind: 'task', id: taskB.id, title: taskB.title }}
          suggestion={shrunkSwapped}
          onShrink={onShrink}
          onSwap={onSwap}
          onClose={() => {}}
          onStart={onStart}
        />,
      );
      expect(screen.getByTestId('small-start-min-15').props.accessibilityState?.selected).toBe(true);

      await r.user.press(screen.getByTestId('small-start-submit'));
      expect(onStart).toHaveBeenCalledTimes(1);
      expect(onStart).toHaveBeenCalledWith(
        { kind: 'task', id: taskB.id, title: taskB.title },
        {
          title: shrunkSwapped.firstStepTitle,
          minutes: 15,
          suggestionId: shrunkSwapped.suggestionId,
        },
      );

      // Parent tasks remain untouched / uncompleted
      expect(useFocusStore.getState().status).toBe('running');
      expect(useFocusStore.getState().smallStep?.suggestionId).toBe(shrunkSwapped.suggestionId);
      expect(useTaskStore.getState().tasks.find((t) => t.id === taskA.id)?.completed).toBe(false);
      expect(useTaskStore.getState().tasks.find((t) => t.id === taskB.id)?.completed).toBe(false);
    });

    it('turns raw quick-capture input into a single concrete micro-step via buildFallbackFirstStep and supports candidate clarification', async () => {
      const onStart = jest.fn<boolean, [SmallStepParent, SmallStepDraft]>(() => true);
      const onSelectCandidate = jest.fn();

      const r = track(
        renderWithProviders(
          <SmallStartSheet
            parent={{ kind: 'task', id: 'draft', title: 'Draft' }}
            allowQuickCapture
            localDayKey={DAY_KEY}
            userId="u1"
            clarificationCandidates={[
              { id: 'cand-1', title: 'Report Alpha' },
              { id: 'cand-2', title: 'Report Beta' },
            ]}
            onSelectCandidate={onSelectCandidate}
            onClose={() => {}}
            onStart={onStart}
          />,
        ),
      );

      expect(screen.getByTestId('small-start-clarification')).toBeTruthy();
      await r.user.press(screen.getByTestId('small-start-candidate-cand-2'));
      expect(onSelectCandidate).toHaveBeenCalledWith('cand-2');
      expect(screen.getByTestId('small-start-parent-title').props.children).toBe('Report Beta');

      fireEvent.changeText(
        screen.getByTestId('small-start-quick-capture'),
        'Client proposal draft',
      );
      expect(screen.getByTestId('small-start-parent-title').props.children).toBe(
        'Client proposal draft',
      );
      const stepInputVal = String(screen.getByTestId('small-start-step-input').props.value);
      expect(stepInputVal.length).toBeGreaterThan(5);
      expect(stepInputVal).toContain('Client proposal draft');

      await r.user.press(screen.getByTestId('small-start-submit'));
      expect(onStart).toHaveBeenCalledTimes(1);
      const [calledParent, calledDraft] = onStart.mock.calls[0];
      expect(calledParent.id).toBe('draft');
      expect(calledParent.title).toBe('Client proposal draft');
      expect(calledDraft.suggestionId).toMatch(/^sug_v1_start_small_/);
    });
  });

  describe('DayReplanSheet (U05 — Koru -> Gor -> Uygula)', () => {
    const fixedBlocks: FixedPlanBlock[] = [
      {
        id: 'fb-1600',
        title: 'Dentist Appointment',
        local_day: DAY_KEY,
        start_time: '16:00',
        end_time: '17:00',
        locked: true,
        source: 'internal_fixed',
      },
    ];

    it('REC-02: stepping Koru -> Gor -> Geri -> Kapat performs zero writes', async () => {
      const executeSpy = jest.fn();
      const deps: DayPlanCommitDeps = {
        now: () => new Date('2026-03-07T15:30:00.000Z'),
        resolveLocalDayKey: () => DAY_KEY,
        resolveUserId: async () => 'u1',
        executeItem: executeSpy,
      };
      const onClose = jest.fn();
      const task1 = makeTask('t-1', { title: 'Deep work block', estimated_minutes: 60 });

      const r = track(
        renderWithProviders(
          <DayReplanSheet
            visible
            userId="u1"
            localDayKey={DAY_KEY}
            nowLocalMinutes={15 * 60 + 30}
            tasks={[task1]}
            habits={[makeHabit('h-1', 'Evening Stretch')]}
            todayLogs={[]}
            fixedBlocks={fixedBlocks}
            nowFn={() => new Date('2026-03-07T15:30:00.000Z')}
            commitDeps={deps}
            onClose={onClose}
          />,
        ),
      );

      expect(screen.getByTestId('replan-step-indicator').props.children).toContain('1/3');

      await r.user.press(screen.getByTestId('replan-next-preview-btn'));
      expect(screen.getByTestId('replan-step-indicator').props.children).toContain('2/3');

      await r.user.press(screen.getByTestId('replan-back-btn'));
      expect(screen.getByTestId('replan-step-indicator').props.children).toContain('1/3');

      await r.user.press(screen.getByTestId('replan-cancel-btn'));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(executeSpy).not.toHaveBeenCalled();
    });

    it('REC-01 & P04: keeps 16:00 fixed block locked, postpones conflicting/excess work, preserves partial habit progress, and lowers load', async () => {
      const conflictTask = makeTask('t-conflict', {
        title: 'Call supplier',
        due_date: DAY_KEY,
        time_block_start: '16:15',
        time_block_end: '16:45',
        estimated_minutes: 30,
      });
      const waterHabit = makeHabit('h-water', 'Water Intake', {
        tracking_type: 'numeric',
        daily_goal: 2,
        unit: 'L',
        estimated_minutes: 15,
      });
      const partialWaterLog: HabitLog = {
        id: 'log-water-1',
        habit_id: 'h-water',
        user_id: 'u1',
        completed_at: DAY_KEY,
        is_completed: false,
        state: 'partial',
        value: 0.5,
        xp: 0,
        created_at: '2026-03-07T10:00:00.000Z',
      };

      const r = track(
        renderWithProviders(
          <DayReplanSheet
            visible
            userId="u1"
            localDayKey={DAY_KEY}
            nowLocalMinutes={20 * 60 + 30}
            tasks={[conflictTask]}
            habits={[waterHabit]}
            todayLogs={[partialWaterLog]}
            fixedBlocks={fixedBlocks}
            remainingCapacityMinutes={0}
            nowFn={() => new Date('2026-03-07T20:30:00.000Z')}
            onClose={() => {}}
          />,
        ),
      );

      await r.user.press(screen.getByTestId('replan-next-preview-btn'));

      // Fixed 16:00–17:00 block stays locked and is NOT in mutable changes
      expect(screen.getByTestId('replan-locked-fb-1600')).toBeTruthy();
      expect(
        within(screen.getByTestId('replan-locked-time-fb-1600')).getByText(/16:00/),
      ).toBeTruthy();
      expect(screen.queryByTestId('replan-change-task-fb-1600')).toBeNull();

      // Movable conflicting task is postponed to tomorrow; partial habit defaults to do_not_recover
      expect(
        screen.getByTestId('replan-action-task-t-conflict-postpone_tomorrow').props
          .accessibilityState?.selected,
      ).toBe(true);
      expect(
        screen.getByTestId('replan-action-habit-h-water-do_not_recover').props
          .accessibilityState?.selected,
      ).toBe(true);

      const loadBefore = Number(screen.getByTestId('replan-load-before').props.children);
      const loadAfter = Number(screen.getByTestId('replan-load-after').props.children);
      expect(loadBefore).toBeGreaterThan(0);
      expect(loadAfter).toBeLessThanOrEqual(loadBefore);
      expect(loadAfter).toBe(0);
    });

    it('REC-04: blocks commit when preview is stale (version changed) and refreshes cleanly', async () => {
      const executeSpy = jest.fn();
      const deps: DayPlanCommitDeps = {
        now: () => new Date('2026-03-07T18:00:00.000Z'),
        resolveLocalDayKey: () => DAY_KEY,
        resolveUserId: async () => 'u1',
        executeItem: executeSpy,
      };
      const v1Task = makeTask('t-stale', {
        title: 'Write summary',
        estimated_minutes: 45,
        updated_at: '2026-03-07T09:00:00.000Z',
      });

      const r = track(
        renderWithProviders(
          <DayReplanSheet
            visible
            userId="u1"
            localDayKey={DAY_KEY}
            nowLocalMinutes={18 * 60}
            tasks={[v1Task]}
            habits={[]}
            todayLogs={[]}
            remainingCapacityMinutes={0}
            nowFn={() => new Date('2026-03-07T18:00:00.000Z')}
            commitDeps={deps}
            onClose={() => {}}
          />,
        ),
      );

      await r.user.press(screen.getByTestId('replan-next-preview-btn'));

      // Concurrent edit changes task updated_at while user is viewing Step 2
      const v2Task: Task = { ...v1Task, updated_at: '2026-03-07T17:59:00.000Z' };
      r.rerender(
        <DayReplanSheet
          visible
          userId="u1"
          localDayKey={DAY_KEY}
          nowLocalMinutes={18 * 60}
          tasks={[v2Task]}
          habits={[]}
          todayLogs={[]}
          remainingCapacityMinutes={0}
          nowFn={() => new Date('2026-03-07T18:01:00.000Z')}
          commitDeps={deps}
          onClose={() => {}}
        />,
      );

      await r.user.press(screen.getByTestId('replan-apply-btn'));
      await flushEffects();

      expect(executeSpy).not.toHaveBeenCalled();
      expect(screen.getByTestId('replan-stale-alert')).toBeTruthy();
      expect(String(screen.getByTestId('replan-stale-ids').props.children)).toContain(
        'Write summary',
      );

      await r.user.press(screen.getByTestId('replan-refresh-btn'));
      expect(screen.getByTestId('replan-step-indicator').props.children).toContain('2/3');
    });

    it('REC-03, §7.1 & REC-04: retries only failed items on partial failure, distinguishes pending vs committed, and runs receipt Undo with conflict reporting', async () => {
      const task1 = makeTask('t-ok', { title: 'Archive receipts', estimated_minutes: 30 });
      const task2 = makeTask('t-flaky', { title: 'Sync notes', estimated_minutes: 30 });

      const executedTargets: string[] = [];
      let flakyAttempt = 0;

      const partialDeps: DayPlanCommitDeps = {
        now: () => new Date('2026-03-07T19:00:00.000Z'),
        resolveLocalDayKey: () => DAY_KEY,
        resolveUserId: async () => 'u1',
        executeItem: async (item) => {
          executedTargets.push(item.targetId);
          if (item.targetId === 't-flaky') {
            flakyAttempt += 1;
            if (flakyAttempt === 1) {
              return {
                result: {
                  itemId: item.itemId,
                  entity: item.entity,
                  targetId: item.targetId,
                  status: 'retryable',
                  newVersion: null,
                  appliedAtVersion: null,
                  error: 'Temporary timeout',
                  undoable: false,
                },
              };
            }
          }
          return {
            result: {
              itemId: item.itemId,
              entity: item.entity,
              targetId: item.targetId,
              status: 'committed',
              newVersion: '2026-03-07T19:01:00.000Z',
              appliedAtVersion: item.expectedVersion,
              undoable: true,
            },
          };
        },
        undoItem: async (entry) => {
          if (entry.targetId === 't-flaky') {
            return {
              itemId: entry.itemId,
              entity: entry.entity,
              targetId: entry.targetId,
              outcome: 'conflict_skipped',
              status: 'conflict',
              error: 'Edited elsewhere',
            };
          }
          return {
            itemId: entry.itemId,
            entity: entry.entity,
            targetId: entry.targetId,
            outcome: 'undone',
            status: 'committed',
          };
        },
      };

      const r = track(
        renderWithProviders(
          <DayReplanSheet
            visible
            userId="u1"
            localDayKey={DAY_KEY}
            nowLocalMinutes={19 * 60}
            tasks={[task1, task2]}
            habits={[]}
            todayLogs={[]}
            remainingCapacityMinutes={0}
            nowFn={() => new Date('2026-03-07T19:00:00.000Z')}
            commitDeps={partialDeps}
            onClose={() => {}}
          />,
        ),
      );

      await r.user.press(screen.getByTestId('replan-next-preview-btn'));
      await r.user.press(screen.getByTestId('replan-apply-btn'));
      await flushEffects();

      expect(screen.getByTestId('replan-outcome-partial')).toBeTruthy();
      expect(executedTargets).toEqual(['t-ok', 't-flaky']);

      // Failed-only retry re-runs ONLY t-flaky, never touching t-ok again
      await r.user.press(screen.getByTestId('replan-retry-failed-btn'));
      await flushEffects();

      expect(executedTargets).toEqual(['t-ok', 't-flaky', 't-flaky']);
      expect(screen.getByTestId('replan-outcome-committed')).toBeTruthy();
      expect(screen.getByTestId('replan-status-committed')).toBeTruthy();
      expect(screen.queryByTestId('replan-status-pending')).toBeNull();

      // Undo reverts t-ok and honestly reports t-flaky in skippedConflictIds
      await r.user.press(screen.getByTestId('replan-undo-btn'));
      await flushEffects();

      expect(screen.getByTestId('replan-undo-outcome-partial')).toBeTruthy();
      expect(String(screen.getByTestId('replan-undo-skipped-conflicts').props.children)).toContain(
        'Sync notes',
      );

      // Verify offline pending state never claims committed
      const offlineDeps: DayPlanCommitDeps = {
        now: () => new Date('2026-03-07T19:05:00.000Z'),
        resolveLocalDayKey: () => DAY_KEY,
        resolveUserId: async () => 'u1',
        executeItem: async (item) => ({
          result: {
            itemId: item.itemId,
            entity: item.entity,
            targetId: item.targetId,
            status: 'pending',
            newVersion: null,
            appliedAtVersion: item.expectedVersion,
            undoable: true,
          },
        }),
      };

      const rOffline = track(
        renderWithProviders(
          <DayReplanSheet
            visible
            userId="u1"
            localDayKey={DAY_KEY}
            nowLocalMinutes={19 * 60 + 5}
            tasks={[task1]}
            habits={[]}
            todayLogs={[]}
            remainingCapacityMinutes={0}
            nowFn={() => new Date('2026-03-07T19:05:00.000Z')}
            commitDeps={offlineDeps}
            onClose={() => {}}
          />,
        ),
      );

      await rOffline.user.press(screen.getByTestId('replan-next-preview-btn'));
      await rOffline.user.press(screen.getByTestId('replan-apply-btn'));
      await flushEffects();

      expect(screen.getByTestId('replan-outcome-pending')).toBeTruthy();
      expect(screen.getByTestId('replan-status-pending')).toBeTruthy();
      expect(screen.queryByTestId('replan-status-committed')).toBeNull();
    });
  });

  describe('TodayScreen integration & cognitive load budget (U01, U03)', () => {
    it('keeps interactive controls before first checkbox <= 8 at 10:00 and 20:00 and wires stuck + replan flows', async () => {
      jest.useFakeTimers().setSystemTime(new Date(2026, 2, 7, 10, 0, 0));
      const r10 = track(
        renderWithProviders(<TodayScreen />, {
          userEventOptions: { advanceTimers: jest.advanceTimersByTime },
        }),
      );
      await flushEffects(true);

      expect(collectTodayBlocks(r10)).toEqual([
        'today-block-hero',
        'today-block-habits',
        'today-block-composer',
      ]);
      const count10 = collectInteractiveBeforeFirstCheckbox(r10);
      expect(count10).toBeLessThanOrEqual(TODAY_CONTRACT.maxInteractiveBeforeFirstHabit);

      // Open stuck flow from More menu -> opens SmallStartSheet with ActionSuggestion + quick capture
      const buttons10 = r10.getAllByRole('button');
      const moreBtn10 = buttons10[3];
      mockActionSheet.mockResolvedValueOnce('stuck');
      await r10.user.press(moreBtn10);
      await flushEffects(true);

      expect(r10.getByTestId('small-start-sheet')).toBeTruthy();
      expect(r10.getByTestId('small-start-capture-block')).toBeTruthy();
      await r10.user.press(r10.getByTestId('small-start-submit'));
      await flushEffects(true);

      expect(useFocusStore.getState().status).toBe('running');
      expect(useFocusStore.getState().smallStep?.suggestionId).toBeTruthy();
      expect(mockPush).toHaveBeenCalledWith('/tabs/focus');

      await act(async () => {
        r10.unmount();
      });
      mounted.pop();

      // Reset focus and test 20:00 evening layout + replan chip
      useFocusStore.setState({ status: 'idle', smallStep: null });
      jest.setSystemTime(new Date(2026, 2, 7, 20, 0, 0));
      const r20 = track(
        renderWithProviders(<TodayScreen />, {
          userEventOptions: { advanceTimers: jest.advanceTimersByTime },
        }),
      );
      await flushEffects(true);

      const count20 = collectInteractiveBeforeFirstCheckbox(r20);
      expect(count20).toBeLessThanOrEqual(TODAY_CONTRACT.maxInteractiveBeforeFirstHabit);

      // Open DayReplanSheet via More menu ('replan')
      const buttons20 = r20.getAllByRole('button');
      mockActionSheet.mockResolvedValueOnce('replan');
      await r20.user.press(buttons20[3]);
      await flushEffects(true);

      expect(r20.getByTestId('day-replan-sheet')).toBeTruthy();
      expect(r20.getByTestId('replan-step-indicator').props.children).toContain('1/3');
    });
  });
});
