/**
 * Phase F4 UI Integration Tests — WeeklyReviewScreen (`U10`, `REC-06`) & RecoveryScreen (`U05`, `P04`, `REC-02`, `REC-03`, `REC-04`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, startOfWeek } from 'date-fns';
import React from 'react';

jest.setTimeout(30_000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: null })),
}));
jest.mock('../../lib/dialog', () => ({
  notify: jest.fn(async () => undefined),
  confirm: jest.fn(async () => false),
  actionSheet: jest.fn(async () => null),
}));
jest.mock('../../lib/notifications', () => ({
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
  scheduleRecoveryReminder: jest.fn(),
  cancelRecoveryReminder: jest.fn(),
  listScheduled: jest.fn(async () => []),
  cancelScheduled: jest.fn(async () => undefined),
}));

const mockLogsForPeriod = jest.fn();
const mockRecoveryForPeriod = jest.fn();
const mockLoadWeeklyReflection = jest.fn();
const mockSaveWeeklyReflection = jest.fn();

jest.mock('../../services/reviewService', () => ({
  logsForPeriod: (...args: unknown[]) => mockLogsForPeriod(...args),
  recoveryForPeriod: (...args: unknown[]) => mockRecoveryForPeriod(...args),
  loadWeeklyReflection: (...args: unknown[]) => mockLoadWeeklyReflection(...args),
  saveWeeklyReflection: (...args: unknown[]) => mockSaveWeeklyReflection(...args),
}));

const mockSessionsBetween = jest.fn();
jest.mock('../../services/focusService', () => ({
  sessionsBetween: (...args: unknown[]) => mockSessionsBetween(...args),
}));

const mockLogsForHabitsSince = jest.fn(async () => ({ ok: true, data: [] }));
const mockListHabits = jest.fn(async () => ({ ok: true, data: (globalThis as Record<string, unknown>).__testHabits ?? [] }));

jest.mock('../../services/habitService', () => ({
  logsForHabitsSince: () => mockLogsForHabitsSince(),
  listHabits: () => mockListHabits(),
  loadTimeOff: jest.fn(async () => ({ ok: true, data: { available: false, pauses: [], versions: [] } })),
  loadChecklists: jest.fn(async () => ({ ok: true, data: { available: false, items: [], checks: [] } })),
  patchHabit: jest.fn(),
  recordGoalVersion: jest.fn(),
  addTimeOff: jest.fn(),
  endTimeOff: jest.fn(),
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
      rows: ((globalThis as Record<string, unknown>).__testTasks as unknown[]) ?? [],
      nextCursor: null,
      hasMore: false,
    },
  })),
  completionPatch: jest.fn((completed: boolean) => ({
    completed,
    status: completed ? 'completed' : 'pending',
    completed_at: completed ? new Date().toISOString() : null,
  })),
  newTaskRow: jest.fn((id: string, input: Record<string, unknown>) => ({
    id,
    user_id: 'u1',
    title: String(input.title ?? ''),
    status: 'pending',
    priority: (input.priority as string) ?? 'none',
    list_type: (input.list_type as string) ?? 'this_week',
    due_date: (input.due_date as string | null) ?? null,
    completed: false,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  })),
  deliverTaskCommand: jest.fn(async () => ({ kind: 'applied', version: '2026-11-24T12:00:00.000Z' })),
}));

jest.mock('../../repositories/recoveryRepository', () => ({
  fetchRecoveryPlansPage: jest.fn(async () => ({ ok: true, data: { rows: [], nextCursor: null, hasMore: false } })),
  fetchPlannedRecoveryPlans: jest.fn(async () => ({ ok: true, data: [] })),
  fetchRecoveryPlansForReview: jest.fn(async () => ({ ok: true, data: [] })),
  insertRecoveryPlan: jest.fn(),
  updateRecoveryPlan: jest.fn(),
  deleteRecoveryPlan: jest.fn(),
}));

import RecoveryScreen from '../../app/screens/recovery';
import WeeklyReviewScreen from '../../app/screens/weekly-review';
import { resetAccountMemory } from '../../lib/accountScope';
import { todayLocal } from '../../lib/date';
import { resolveEffectivePlanningDay } from '../../lib/dayPlanPreview';
import { memoryOutboxStorage } from '../../lib/outboxStorage';
import {
  actionFor,
  previousWeekKey,
  reviewActionsKey,
  type NextAction,
} from '../../lib/reviewActions';
import type { Habit, HabitLog } from '../../lib/supabase';
import * as dayPlanCommitService from '../../services/dayPlanCommitService';
import { invalidateHabitsFetch, useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { setTaskOutboxStorage, useTaskStore, type Task } from '../../store/taskStore';
import {
  act,
  renderWithProviders,
  type RenderedScreen,
} from '../helpers/renderWithProviders';

function extractText(node: unknown): string {
  const parts: string[] = [];
  const visit = (n: unknown): void => {
    if (n == null) return;
    if (typeof n === 'string' || typeof n === 'number') {
      parts.push(String(n));
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (typeof n === 'object' && 'children' in (n as Record<string, unknown>)) {
      visit((n as { children: unknown }).children);
    }
  };
  visit(node);
  return parts.join(' ');
}

function makeHabit(id: string, name: string, overrides: Partial<Habit> = {}): Habit {
  return {
    id,
    user_id: 'u1',
    name,
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: 'at_least',
    frequency_config: { kind: 'daily' },
    willpower_cost: 2,
    status: 'active',
    impact_level: 'medium',
    urgency: 'not_urgent',
    difficulty: 2,
    estimated_minutes: 20,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: 'work',
    end_condition: null,
    created_at: '2026-10-01T08:00:00.000Z',
    ...overrides,
  };
}

function makeTask(id: string, title: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    user_id: 'u1',
    title,
    status: 'pending',
    priority: 'medium',
    list_type: 'this_week',
    due_date: todayLocal(),
    time_block_start: null,
    time_block_end: null,
    estimated_minutes: 30,
    completed: false,
    completed_at: null,
    created_at: new Date().toISOString(),
    updated_at: '2026-11-24T08:00:00.000Z',
    ...overrides,
  };
}

async function settleUi(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) {
      await Promise.resolve();
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('F4 UI Flows — WeeklyReviewScreen & RecoveryScreen', () => {
  const mounted: RenderedScreen[] = [];

  beforeEach(async () => {
    resetAccountMemory('signed_out');
    await AsyncStorage.clear();
    setTaskOutboxStorage(memoryOutboxStorage());
    invalidateHabitsFetch();
    (globalThis as Record<string, unknown>).__testHabits = [];
    (globalThis as Record<string, unknown>).__testTasks = [];
    useTaskStore.setState({
      tasks: [],
      tasksLoaded: true,
      outbox: null,
      loading: false,
      error: null,
      cursor: null,
      hasMore: false,
    });
    useHabitStore.setState({ habits: [], loading: false } as Partial<ReturnType<typeof useHabitStore.getState>>);
    useLogStore.setState({ logs: [], loading: false, logsError: null });
    useRecoveryStore.setState({ plans: [], loading: false });

    mockLogsForPeriod.mockReset();
    mockRecoveryForPeriod.mockReset();
    mockLoadWeeklyReflection.mockReset();
    mockSaveWeeklyReflection.mockReset();
    mockSessionsBetween.mockReset();

    mockLogsForPeriod.mockResolvedValue({ ok: true, data: [] });
    mockRecoveryForPeriod.mockResolvedValue({ ok: true, data: [] });
    mockLoadWeeklyReflection.mockResolvedValue({ ok: true, data: null });
    mockSaveWeeklyReflection.mockResolvedValue({ ok: true, data: null });
    mockSessionsBetween.mockResolvedValue({ ok: true, data: [] });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    while (mounted.length > 0) {
      const screen = mounted.pop()!;
      await act(async () => {
        screen.unmount();
      });
    }
  });

  async function mountScreen(element: React.ReactElement): Promise<RenderedScreen> {
    const rendered = renderWithProviders(element);
    mounted.push(rendered);
    await settleUi();
    return rendered;
  }

  describe('WeeklyReviewScreen — U10 sample threshold, correlation framing, and REC-06 reversible adjustment', () => {
    it('(+) renders weekly-insight-insufficient when sample size < 3 or log fetch fails, never claiming correlation', async () => {
      const today = todayLocal();
      const habits = [makeHabit('h1', 'Sabah Rutini')];
      const tasks = [
        makeTask('t-done-1', 'Kisa not', {
          completed: true,
          status: 'completed',
          completed_at: `${today}T10:00:00.000Z`,
          created_at: `${today}T08:00:00.000Z`,
        }),
      ];
      (globalThis as Record<string, unknown>).__testHabits = habits;
      (globalThis as Record<string, unknown>).__testTasks = tasks;
      useHabitStore.setState({ habits } as Partial<ReturnType<typeof useHabitStore.getState>>);
      useTaskStore.setState({ tasks, tasksLoaded: true });

      // Sample count = 1 completed log + 1 completed task + 0 focus (>=10m) = 2 < 3
      mockLogsForPeriod.mockResolvedValue({
        ok: true,
        data: [{ habit_id: 'h1', completed_at: today, state: 'done', value: null }],
      });
      mockSessionsBetween.mockResolvedValue({
        ok: true,
        data: [{ started_at: `${today}T11:00:00.000Z`, completed_seconds: 300 }],
      });

      const r1 = await mountScreen(<WeeklyReviewScreen />);
      expect(r1.getByTestId('weekly-insight-action-card')).toBeTruthy();
      expect(r1.getByTestId('weekly-insight-insufficient')).toBeTruthy();
      expect(r1.queryByTestId('weekly-insight-correlation-note')).toBeNull();

      await act(async () => {
        r1.unmount();
      });
      mounted.pop();

      // Failed log query -> autoMetrics.totalCompletions === null -> still insufficient
      mockLogsForPeriod.mockResolvedValue({ ok: false, error: 'offline' });
      const r2 = await mountScreen(<WeeklyReviewScreen />);
      expect(r2.getByTestId('weekly-insight-insufficient')).toBeTruthy();
      expect(r2.queryByTestId('weekly-insight-correlation-note')).toBeNull();
    });

    it('(+) renders weekly-insight-correlation-note when sample size >= 3, surfaces NextAction for weekKey, and cleanly undoes it', async () => {
      const now = new Date();
      const today = todayLocal(now);
      const weekKey = format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
      const prevKey = previousWeekKey(weekKey);

      const habits = [makeHabit('h1', 'Sabah Yuru'), makeHabit('h2', 'Okuma')];
      const completedTask = makeTask('t-completed', ' Rapor gonder ', {
        completed: true,
        status: 'completed',
        completed_at: `${today}T09:00:00.000Z`,
        created_at: `${today}T08:00:00.000Z`,
      });
      const adjustmentTask = makeTask('t-next-adj', 'Aksam bildirimlerini kapat', {
        completed: false,
        status: 'pending',
        due_date: today,
      });

      const allTasks = [completedTask, adjustmentTask];
      (globalThis as Record<string, unknown>).__testHabits = habits;
      (globalThis as Record<string, unknown>).__testTasks = allTasks;
      useHabitStore.setState({ habits } as Partial<ReturnType<typeof useHabitStore.getState>>);
      useTaskStore.setState({ tasks: allTasks, tasksLoaded: true });

      // Sample count = 2 completed logs + 1 completed task + 1 focus (20m >= 10m) = 4 >= 3
      mockLogsForPeriod.mockResolvedValue({
        ok: true,
        data: [
          { habit_id: 'h1', completed_at: today, state: 'done', value: null },
          { habit_id: 'h2', completed_at: today, state: 'partial', value: null },
        ],
      });
      mockSessionsBetween.mockResolvedValue({
        ok: true,
        data: [{ started_at: `${today}T10:00:00.000Z`, completed_seconds: 1200 }],
      });

      const seededActions: NextAction[] = [
        {
          weekKey,
          kind: 'task',
          taskId: adjustmentTask.id,
          label: 'Aksam bildirimlerini kapat',
          createdAt: `${today}T11:00:00.000Z`,
        },
        {
          weekKey: prevKey,
          kind: 'task',
          taskId: completedTask.id,
          label: 'Masa duzeni',
          createdAt: `${prevKey}T11:00:00.000Z`,
        },
      ];
      await AsyncStorage.setItem(reviewActionsKey('u1'), JSON.stringify(seededActions));

      const r = await mountScreen(<WeeklyReviewScreen />);

      expect(r.queryByTestId('weekly-insight-insufficient')).toBeNull();
      expect(r.getByTestId('weekly-insight-summary')).toBeTruthy();
      expect(r.getByTestId('weekly-insight-correlation-note')).toBeTruthy();
      expect(r.getByTestId('weekly-previous-adjustment-outcome')).toBeTruthy();

      const currentNode = r.getByTestId('weekly-current-adjustment');
      expect(extractText(currentNode.children)).toContain('Aksam bildirimlerini kapat');

      // Undo the weekly adjustment (U10): removes weekKey from AsyncStorage AND deletes uncompleted task
      await r.user.press(r.getByTestId('weekly-undo-adjustment'));
      await settleUi();

      expect(r.queryByTestId('weekly-undo-adjustment')).toBeNull();
      expect(r.getByTestId('weekly-jump-to-adjustment')).toBeTruthy();

      const storedAfterRaw = await AsyncStorage.getItem(reviewActionsKey('u1'));
      const storedAfter = JSON.parse(storedAfterRaw ?? '[]') as NextAction[];
      expect(actionFor(storedAfter, weekKey)).toBeUndefined();
      expect(actionFor(storedAfter, prevKey)?.label).toBe('Masa duzeni');
      expect(useTaskStore.getState().tasks.some((t) => t.id === adjustmentTask.id)).toBe(false);
    });
  });

  describe('RecoveryScreen — U05, P04, REC-02, REC-03, and REC-04 Koru -> Gor -> Uygula replan flow', () => {
    it('(+) steps through Koru -> Gor -> Uygula, writes nothing on back/close, preserves fixed block & P04 partial log, retries failed items, and gates undo on undoable receipt', async () => {
      const today = resolveEffectivePlanningDay(new Date()).effectiveDayKey;
      const fixedTask = makeTask('t-fixed-1600', 'Musteri toplantisi', {
        due_date: today,
        time_block_start: '16:00',
        time_block_end: '17:00',
        estimated_minutes: 60,
      });
      const protectTask = makeTask('t-protect', 'Sunum taslagi', {
        due_date: today,
        priority: 'high',
        estimated_minutes: 45,
      });
      const movableTask = makeTask('t-movable', 'Belge arsivi', {
        due_date: today,
        priority: 'low',
        estimated_minutes: 60,
      });
      const waterHabit = makeHabit('h-water', 'Su takibi', {
        tracking_type: 'numeric',
        daily_goal: 1.5,
        unit: 'L',
        estimated_minutes: 10,
      });
      const partialWaterLog: HabitLog = {
        id: 'log-water-1',
        habit_id: waterHabit.id,
        user_id: 'u1',
        completed_at: today,
        state: 'partial',
        value: 0.5,
        xp: 0,
        is_completed: false,
        created_at: `${today}T09:00:00.000Z`,
      };

      const seededTasks = [fixedTask, protectTask, movableTask];
      const seededHabits = [waterHabit];
      (globalThis as Record<string, unknown>).__testTasks = seededTasks;
      (globalThis as Record<string, unknown>).__testHabits = seededHabits;
      useTaskStore.setState({ tasks: seededTasks, tasksLoaded: true });
      useHabitStore.setState({ habits: seededHabits } as Partial<ReturnType<typeof useHabitStore.getState>>);
      useLogStore.setState({
        logs: [partialWaterLog],
        fetchLogsForDate: jest.fn(async () => undefined),
      } as Partial<ReturnType<typeof useLogStore.getState>>);

      const commitSpy = jest.spyOn(dayPlanCommitService, 'commitDayPlan');
      const retrySpy = jest.spyOn(dayPlanCommitService, 'retryFailedDayPlanItems');
      const undoSpy = jest.spyOn(dayPlanCommitService, 'undoDayPlanCommit');

      const r = await mountScreen(<RecoveryScreen />);

      expect(r.getByTestId('recovery-day-replan-card')).toBeTruthy();
      expect(r.queryByTestId('recovery-replan-undo')).toBeNull();

      // Open flow -> Step 1: Koru
      await r.user.press(r.getByTestId('recovery-open-replan'));
      expect(r.getByTestId('recovery-replan-step-protect')).toBeTruthy();

      // Protect 't-protect' and proceed to Step 2: Gor
      await r.user.press(r.getByTestId('recovery-replan-protect-task-t-protect'));
      await r.user.press(r.getByTestId('recovery-replan-to-preview'));
      expect(r.getByTestId('recovery-replan-step-preview')).toBeTruthy();

      const loadSummaryText = extractText(r.getByTestId('recovery-replan-load-summary').children);
      expect(loadSummaryText).toContain('->');

      const lockedText = extractText(r.getByTestId('recovery-replan-locked-list').children);
      expect(lockedText).toContain('16:00');
      expect(lockedText).toContain('Musteri toplantisi');

      const protectedText = extractText(r.getByTestId('recovery-replan-protected-summary').children);
      expect(protectedText).toContain('Sunum taslagi');

      // Override movableTask -> postpone_tomorrow & waterHabit -> do_not_recover (P04)
      await r.user.press(
        r.getByTestId('recovery-replan-action-task-t-movable-postpone_tomorrow'),
      );
      await r.user.press(
        r.getByTestId('recovery-replan-action-habit-h-water-do_not_recover'),
      );
      expect(r.getByTestId('recovery-replan-p04-note-h-water')).toBeTruthy();

      // REC-02: Back and Close perform ZERO writes
      await r.user.press(r.getByTestId('recovery-replan-back'));
      expect(r.getByTestId('recovery-replan-step-protect')).toBeTruthy();
      await r.user.press(r.getByTestId('recovery-replan-close'));
      expect(r.queryByTestId('recovery-replan-step-protect')).toBeNull();
      expect(commitSpy).not.toHaveBeenCalled();

      // Re-open, configure, and confirm -> simulate partial failure first (no undoable receipt yet)
      commitSpy.mockResolvedValueOnce({
        operationId: 'op-replan-1',
        localDayKey: today,
        overall: 'partial',
        results: [
          {
            itemId: 'task:t-movable',
            entity: 'task',
            targetId: 't-movable',
            status: 'retryable',
            newVersion: null,
            appliedAtVersion: null,
            error: 'timeout',
            undoable: false,
          },
        ],
        retryableItemIds: ['task:t-movable'],
        receipt: null,
      });

      await r.user.press(r.getByTestId('recovery-open-replan'));
      await r.user.press(r.getByTestId('recovery-replan-protect-task-t-protect'));
      await r.user.press(r.getByTestId('recovery-replan-to-preview'));
      await r.user.press(
        r.getByTestId('recovery-replan-action-task-t-movable-postpone_tomorrow'),
      );
      await r.user.press(
        r.getByTestId('recovery-replan-action-habit-h-water-do_not_recover'),
      );
      await r.user.press(r.getByTestId('recovery-replan-confirm'));
      await settleUi();

      expect(commitSpy).toHaveBeenCalledTimes(1);
      // Only t-movable is mutated; fixed block, protected task, and P04 partial habit log are untouched
      expect(commitSpy.mock.calls[0][0].items.map((it) => it.itemId)).toEqual(['task:t-movable']);

      expect(r.getByTestId('recovery-replan-step-apply')).toBeTruthy();
      expect(r.getByTestId('recovery-replan-status-partial')).toBeTruthy();
      expect(r.getByTestId('recovery-replan-retry-failed')).toBeTruthy();
      // Receipt is null -> undo button MUST NOT be rendered!
      expect(r.queryByTestId('recovery-replan-undo')).toBeNull();

      // REC-03: Retry failed-only -> succeeds with an undoable receipt
      const realReceipt: dayPlanCommitService.DayPlanCommitReceipt = {
        operationId: 'op-replan-1',
        userId: 'u1',
        localDayKey: today,
        committedAtIso: `${today}T12:05:00.000Z`,
        items: [
          {
            itemId: 'task:t-movable',
            entity: 'task',
            targetId: 't-movable',
            status: 'committed',
            newVersion: '2026-11-24T12:05:00.000Z',
            appliedAtVersion: '2026-11-24T08:00:00.000Z',
            undoable: true,
            mutation: commitSpy.mock.calls[0][0].items[0],
          },
        ],
      };

      retrySpy.mockResolvedValueOnce({
        operationId: 'op-replan-1',
        localDayKey: today,
        overall: 'committed',
        results: realReceipt.items.map(({ mutation: _m, ...rest }) => rest),
        retryableItemIds: [],
        receipt: realReceipt,
      });

      await r.user.press(r.getByTestId('recovery-replan-retry-failed'));
      await settleUi();

      expect(retrySpy).toHaveBeenCalledTimes(1);
      expect(r.getByTestId('recovery-replan-status-committed')).toBeTruthy();
      expect(r.getByTestId('recovery-replan-undo')).toBeTruthy();

      // Receipt-backed Undo
      undoSpy.mockResolvedValueOnce({
        operationId: 'op-replan-1',
        overall: 'undone',
        undoneItemIds: ['task:t-movable'],
        skippedConflictIds: [],
        skippedUnappliedIds: [],
        failedItemIds: [],
        results: [
          {
            itemId: 'task:t-movable',
            entity: 'task',
            targetId: 't-movable',
            outcome: 'undone',
            status: 'committed',
          },
        ],
      });

      await r.user.press(r.getByTestId('recovery-replan-undo'));
      await settleUi();

      expect(undoSpy).toHaveBeenCalledTimes(1);
      expect(undoSpy).toHaveBeenCalledWith(realReceipt);
      expect(r.queryByTestId('recovery-replan-undo')).toBeNull();
      expect(r.getByTestId('recovery-replan-undo-feedback')).toBeTruthy();
    });

    it('(-) blocks stale preview via evaluatePreviewFreshness before calling commitDayPlan (REC-04)', async () => {
      const today = resolveEffectivePlanningDay(new Date()).effectiveDayKey;
      const movableTask = makeTask('t-stale', 'Plan revizyonu', {
        due_date: today,
        updated_at: '2026-11-24T08:00:00.000Z',
      });
      (globalThis as Record<string, unknown>).__testTasks = [movableTask];
      useTaskStore.setState({ tasks: [movableTask], tasksLoaded: true });

      const commitSpy = jest.spyOn(dayPlanCommitService, 'commitDayPlan');

      const r = await mountScreen(<RecoveryScreen />);
      await r.user.press(r.getByTestId('recovery-open-replan'));
      await r.user.press(r.getByTestId('recovery-replan-to-preview'));
      await r.user.press(
        r.getByTestId('recovery-replan-action-task-t-stale-postpone_tomorrow'),
      );

      // Simulate concurrent edit on another device while preview is open
      await act(async () => {
        useTaskStore.setState({
          tasks: [{ ...movableTask, updated_at: '2026-11-24T13:30:00.000Z' }],
        });
      });

      await r.user.press(r.getByTestId('recovery-replan-confirm'));
      await settleUi();

      expect(commitSpy).not.toHaveBeenCalled();
      expect(r.getByTestId('recovery-replan-stale-banner')).toBeTruthy();

      // Refreshing preview picks up the updated version and allows clean commit
      commitSpy.mockResolvedValueOnce({
        operationId: 'op-stale-refreshed',
        localDayKey: today,
        overall: 'committed',
        results: [],
        retryableItemIds: [],
        receipt: null,
      });
      await r.user.press(r.getByTestId('recovery-replan-refresh-preview'));
      expect(r.queryByTestId('recovery-replan-stale-banner')).toBeNull();
      await r.user.press(r.getByTestId('recovery-replan-confirm'));
      await settleUi();
      expect(commitSpy).toHaveBeenCalledTimes(1);
    });
  });
});
