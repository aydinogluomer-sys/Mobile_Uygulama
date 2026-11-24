/**
 * Phases F3 + F4 Independent QA Acceptance Matrix (`f3f4AcceptanceMatrix.test.ts`).
 *
 * End-to-end integration verification for all 12 Playbook scenarios across
 * real domain engines, Zustand stores, and versioned commit/retry/undo services:
 *   - F3 (`LEAF-01` .. `LEAF-06`): Start / Small Step / AI First-Step Safety & Fallback
 *   - F4 (`REC-01`  .. `REC-06`):  Day Recovery Preview / Purity / Partial Retry / Versioned Undo / Rollover & DST / Weekly Review
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

type ServerTaskRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  completed: boolean;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  completed_at: string | null;
  updated_at: string;
  created_at: string;
  list_type: 'inbox' | 'this_week' | 'someday';
  priority: 'high' | 'medium' | 'low' | 'none';
  due_date: string | null;
  is_subtask: boolean;
  parent_task_id: string | null;
  project_id: string | null;
  notes_text: string | null;
  time_block_start: string | null;
  time_block_end: string | null;
  estimated_minutes?: number | null;
};

type ServerFocusSessionRow = {
  id: string;
  user_id: string;
  task_id: string | null;
  task_title: string | null;
  mode: string;
  started_at: string;
  ended_at: string;
  planned_seconds: number;
  completed_seconds: number;
  completed: boolean;
};

type ServerOnboardingRow = {
  user_id: string;
  onboarding_version: number;
  goals: string[];
  primary_barrier: string | null;
  pace: string | null;
  preferred_dayparts: string[];
  reminder_intent: boolean | null;
  status: 'pending' | 'installing' | 'completed' | 'skipped' | 'legacy';
  completed_at: string | null;
  install_id: string | null;
  install_expected_habits: number | null;
  install_return_status: 'pending' | 'completed' | 'skipped' | 'legacy' | null;
  created_at: string;
  updated_at: string;
};

type MockRepoFailure = {
  ok: false;
  error: string;
  offline?: boolean;
  status?: number;
  code?: string;
};

type MockRepoResult<T> = { ok: true; data: T } | MockRepoFailure;

const mockSession: { user: { id: string; email: string | null } | null } = {
  user: { id: 'user-qa-f3f4', email: null },
};

const mockServer = {
  online: true,
  clock: 0,
  tasks: new Map<string, ServerTaskRow>(),
  focusSessions: [] as ServerFocusSessionRow[],
  onboardingRows: new Map<string, ServerOnboardingRow>(),
  installedHabitsByInstallId: new Map<string, number>(),
  failTaskUpdates: new Map<string, MockRepoFailure>(),
  updateCallsByTaskId: new Map<string, number>(),
  onBeforeTaskUpdate: null as ((taskId: string) => void) | null,
};

function mockNextServerTimestamp(): string {
  mockServer.clock += 1;
  return `2026-11-24T10:00:${String(mockServer.clock).padStart(2, '0')}.000Z`;
}

function mockGuardAccount(expectedUserId?: string): MockRepoFailure | null {
  const activeUserId = mockSession.user?.id;
  if (!activeUserId) {
    return { ok: false, error: 'Oturum bulunamadı.', status: 401 };
  }
  if (expectedUserId !== undefined && expectedUserId !== activeUserId) {
    return { ok: false, error: 'Oturum başka bir hesaba ait.', status: 401 };
  }
  return null;
}

function mockGateNetwork<T>(compute: () => T): MockRepoResult<T> {
  if (!mockServer.online) {
    return { ok: false, error: 'Network request failed', offline: true };
  }
  if (!mockSession.user) {
    return { ok: false, error: 'JWT missing', status: 401 };
  }
  return { ok: true, data: compute() };
}

jest.mock('../../lib/notifications', () => ({
  ensurePermission: jest.fn(async () => true),
  scheduleFocusEnd: jest.fn(async () => true),
  cancelFocusEnd: jest.fn(async () => undefined),
  listScheduled: jest.fn(async () => []),
  cancelScheduled: jest.fn(async () => undefined),
}));

jest.mock('../../lib/haptics', () => ({
  haptic: {
    light: jest.fn(),
    medium: jest.fn(),
    heavy: jest.fn(),
    success: jest.fn(),
    warning: jest.fn(),
    error: jest.fn(),
    selection: jest.fn(),
  },
}));

jest.mock('../../services/webhookService', () => ({
  notify: jest.fn(),
}));

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => mockSession.user),
}));

jest.mock('../../repositories/focusSessionRepository', () => ({
  insertFocusSessionRow: jest.fn(
    async (
      payload: Omit<ServerFocusSessionRow, 'user_id'>,
      expectedUserId?: string,
    ): Promise<MockRepoResult<ServerFocusSessionRow>> => {
      const mismatch = mockGuardAccount(expectedUserId);
      if (mismatch) return mismatch;
      return mockGateNetwork(() => {
        const created: ServerFocusSessionRow = {
          ...payload,
          user_id: mockSession.user?.id ?? '',
        };
        mockServer.focusSessions.push(created);
        return created;
      });
    },
  ),
  fetchFocusSessionsSince: jest.fn(async () =>
    mockGateNetwork(() => [...mockServer.focusSessions]),
  ),
  fetchFocusSessionsBetween: jest.fn(async () =>
    mockGateNetwork(() => [...mockServer.focusSessions]),
  ),
  fetchAllFocusSessions: jest.fn(async () =>
    mockGateNetwork(() => [...mockServer.focusSessions]),
  ),
  deleteAllFocusSessions: jest.fn(async () =>
    mockGateNetwork(() => {
      mockServer.focusSessions = [];
      return undefined;
    }),
  ),
}));

jest.mock('../../repositories/focusTaskRepository', () => ({
  creditFocusTaskForSession: jest.fn(async () => ({ ok: true, data: true })),
  fetchOpenFocusTasks: jest.fn(async () => ({ ok: true, data: [] })),
  fetchAllFocusTasks: jest.fn(async () => ({ ok: true, data: [] })),
  fetchFocusTaskProgress: jest.fn(async () => ({ ok: true, data: null })),
  insertFocusTask: jest.fn(async () => ({ ok: false, error: 'unused' })),
  completeFocusTask: jest.fn(async () => ({ ok: false, error: 'unused' })),
  deleteFocusTask: jest.fn(async () => ({ ok: true, data: true })),
}));

jest.mock('../../repositories/onboardingRepository', () => ({
  fetchOnboarding: jest.fn(async (): Promise<MockRepoResult<ServerOnboardingRow | null>> =>
    mockGateNetwork(() => {
      const uid = mockSession.user?.id ?? '';
      return mockServer.onboardingRows.get(uid) ?? null;
    }),
  ),
  writeOnboarding: jest.fn(
    async (input: {
      answers: {
        goals: readonly string[];
        primaryBarrier: string | null;
        pace: string | null;
        preferredDayparts: readonly string[];
        reminderIntent: boolean | null;
      };
      status: ServerOnboardingRow['status'];
      installId?: string | null;
      installExpectedHabits?: number | null;
      installReturnStatus?: ServerOnboardingRow['install_return_status'];
    }): Promise<MockRepoResult<ServerOnboardingRow>> =>
      mockGateNetwork(() => {
        const uid = mockSession.user?.id ?? '';
        const prev = mockServer.onboardingRows.get(uid);
        const ts = mockNextServerTimestamp();
        const row: ServerOnboardingRow = {
          user_id: uid,
          onboarding_version: 1,
          goals: [...input.answers.goals],
          primary_barrier: input.answers.primaryBarrier,
          pace: input.answers.pace,
          preferred_dayparts: [...input.answers.preferredDayparts],
          reminder_intent: input.answers.reminderIntent,
          status: input.status,
          completed_at: input.status === 'completed' ? ts : null,
          install_id:
            input.installId !== undefined ? input.installId : (prev?.install_id ?? null),
          install_expected_habits:
            input.installExpectedHabits !== undefined
              ? input.installExpectedHabits
              : (prev?.install_expected_habits ?? null),
          install_return_status:
            input.installReturnStatus !== undefined
              ? input.installReturnStatus
              : (prev?.install_return_status ?? null),
          created_at: prev?.created_at ?? ts,
          updated_at: ts,
        };
        mockServer.onboardingRows.set(uid, row);
        return row;
      }),
  ),
}));

jest.mock('../../repositories/habitRepository', () => ({
  countHabitsForInstall: jest.fn(async (installId: string): Promise<MockRepoResult<number>> =>
    mockGateNetwork(() => mockServer.installedHabitsByInstallId.get(installId) ?? 0),
  ),
  insertRoutineHabits: jest.fn(async () => ({ ok: true, data: [] })),
}));

jest.mock('../../repositories/taskRepository', () => ({
  fetchTasksPage: jest.fn(async () =>
    mockGateNetwork(() => {
      const uid = mockSession.user?.id ?? '';
      const rows = [...mockServer.tasks.values()].filter(
        (r) => r.user_id === uid && r.status !== 'cancelled',
      );
      return { rows, nextCursor: null, hasMore: false };
    }),
  ),
  insertTaskRow: jest.fn(
    async (
      row: Partial<ServerTaskRow> & { id: string },
      expectedUserId?: string,
    ): Promise<MockRepoResult<ServerTaskRow>> => {
      const mismatch = mockGuardAccount(expectedUserId);
      if (mismatch) return mismatch;
      if (mockServer.online && mockServer.tasks.has(row.id)) {
        return { ok: false, error: 'duplicate key', code: '23505', status: 409 };
      }
      return mockGateNetwork(() => {
        const uid = mockSession.user?.id ?? '';
        const ts = mockNextServerTimestamp();
        const created: ServerTaskRow = {
          id: row.id,
          user_id: uid,
          title: row.title ?? '',
          description: row.description ?? null,
          completed: row.completed ?? false,
          status: row.status ?? 'pending',
          completed_at: row.completed_at ?? null,
          created_at: row.created_at ?? ts,
          updated_at: ts,
          list_type: row.list_type ?? 'inbox',
          priority: row.priority ?? 'none',
          due_date: row.due_date ?? null,
          is_subtask: row.is_subtask ?? false,
          parent_task_id: row.parent_task_id ?? null,
          project_id: row.project_id ?? null,
          notes_text: row.notes_text ?? null,
          time_block_start: row.time_block_start ?? null,
          time_block_end: row.time_block_end ?? null,
          ...(row.estimated_minutes !== undefined
            ? { estimated_minutes: row.estimated_minutes }
            : {}),
        };
        mockServer.tasks.set(created.id, created);
        return created;
      });
    },
  ),
  updateTaskVersioned: jest.fn(
    async (
      id: string,
      patch: Partial<ServerTaskRow>,
      baseVersion: string | null,
      expectedUserId?: string,
    ): Promise<MockRepoResult<{ row: ServerTaskRow | null; exists: boolean }>> => {
      mockServer.updateCallsByTaskId.set(
        id,
        (mockServer.updateCallsByTaskId.get(id) ?? 0) + 1,
      );
      if (mockServer.onBeforeTaskUpdate) {
        mockServer.onBeforeTaskUpdate(id);
      }
      const mismatch = mockGuardAccount(expectedUserId);
      if (mismatch) return mismatch;
      const injectedFailure = mockServer.failTaskUpdates.get(id);
      if (injectedFailure) {
        return injectedFailure;
      }
      return mockGateNetwork(() => {
        const current = mockServer.tasks.get(id);
        if (!current || current.user_id !== mockSession.user?.id) {
          return { row: null, exists: false };
        }
        if (baseVersion !== null && current.updated_at !== baseVersion) {
          return { row: null, exists: true };
        }
        const updated: ServerTaskRow = {
          ...current,
          ...patch,
          updated_at: mockNextServerTimestamp(),
        };
        mockServer.tasks.set(id, updated);
        return { row: updated, exists: true };
      });
    },
  ),
  fetchTaskRow: jest.fn(async (id: string): Promise<MockRepoResult<ServerTaskRow | null>> =>
    mockGateNetwork(() => {
      const found = mockServer.tasks.get(id);
      if (!found || found.user_id !== mockSession.user?.id) return null;
      return found;
    }),
  ),
  deleteTaskIfPresent: jest.fn(
    async (id: string, expectedUserId?: string): Promise<MockRepoResult<{ deleted: boolean }>> => {
      const mismatch = mockGuardAccount(expectedUserId);
      if (mismatch) return mismatch;
      return mockGateNetwork(() => {
        const found = mockServer.tasks.get(id);
        if (!found || found.user_id !== mockSession.user?.id) {
          return { deleted: false };
        }
        return { deleted: mockServer.tasks.delete(id) };
      });
    },
  ),
  insertTask: jest.fn(),
  updateTask: jest.fn(),
  deleteTask: jest.fn(),
  searchTasks: jest.fn(),
  insertSplitTasks: jest.fn(),
}));

import { resetAccountMemory } from '../../lib/accountScope';
import {
  cycleAlternativeSuggestion,
  evaluateActionSuggestion,
  shrinkActionSuggestion,
  suggestionToSmallStep,
} from '../../lib/actionSuggestion';
import {
  adaptAiFirstStep,
  CLARIFICATION_QUESTION,
  MAX_FIRST_STEP_LENGTH,
  MIN_FIRST_STEP_LENGTH,
  NO_AI_ESTIMATE,
  resolveAiFirstStepPromptContext,
  resolveFirstStepWithFallback,
  validateRawAiFirstStepPayload,
  verifyStagedAiSuggestionFreshness,
  type AiFirstStepContext,
} from '../../lib/aiFirstStepAdapter';
import { bandFor } from '../../lib/capacity';
import {
  buildDayBoundarySnapshot,
  inspectHistoricalLogAnchor,
  preserveHistoricalLogDay,
} from '../../lib/dayBoundaryContract';
import {
  applyPreviewItemOverride,
  buildDayPlanPreview,
  evaluatePreviewFreshness,
  previewItemKey,
  resolveEffectivePlanningDay,
  type DayPlanPreviewInput,
} from '../../lib/dayPlanPreview';
import { asyncStorageOutbox } from '../../lib/outboxStorage';
import {
  actionFor,
  actionOutcome,
  nextWeekMonday,
  previousWeekKey,
  taskTitleFrom,
  upsertAction,
  type NextAction as ReviewNextAction,
} from '../../lib/reviewActions';
import {
  DEFAULT_STARTER_PACK_KEY,
  listStarterQuickSteps,
  pickStarterQuickStep,
  STARTER_QUICK_PACK_KEYS,
} from '../../lib/routinePacks';
import { isSmallStep, validateSmallStep } from '../../lib/smallStart';
import {
  describeEstimateSource,
  reconcileFocusElapsedWithEstimate,
} from '../../lib/taskDuration';
import type { Task } from '../../lib/taskTypes';
import { OVERDUE_CALM_LIMIT } from '../../lib/todayNarrative';
import { FOCUS_PAUSE_YIELD_MS } from '../../lib/todayNext';
import { coreOutbox } from '../../services/coreOutbox';
import {
  commitDayPlan,
  retryFailedDayPlanItems,
  undoDayPlanCommit,
  type PlanMutationItem,
} from '../../services/dayPlanCommitService';
import { useFocusStore } from '../../store/focusStore';
import {
  resolveOnboardingRouting,
  useOnboardingStore,
} from '../../store/onboardingStore';
import { setTaskOutboxStorage, useTaskStore } from '../../store/taskStore';
import { buildRecoveryFixture, buildStartFixture } from '../helpers/playbookFixtures';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== null && typeof child === 'object') {
        deepFreeze(child);
      }
    }
  }
  return value;
}

function seedServerAndStoreTask(row: ServerTaskRow): Task {
  mockServer.tasks.set(row.id, { ...row });
  const task: Task = {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    description: row.description ?? undefined,
    completed: row.completed,
    status: row.status,
    completed_at: row.completed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    list_type: row.list_type,
    priority: row.priority,
    due_date: row.due_date,
    is_subtask: row.is_subtask,
    parent_task_id: row.parent_task_id,
    project_id: row.project_id,
    notes_text: row.notes_text,
    time_block_start: row.time_block_start,
    time_block_end: row.time_block_end,
    estimated_minutes: row.estimated_minutes ?? null,
  };
  useTaskStore.setState((st) => ({
    tasks: [...st.tasks.filter((t) => t.id !== task.id), task],
    tasksLoaded: true,
  }));
  return task;
}

function makeServerTaskRow(overrides: Partial<ServerTaskRow> & { id: string; title: string }): ServerTaskRow {
  return {
    id: overrides.id,
    user_id: overrides.user_id ?? (mockSession.user?.id ?? 'user-qa-f3f4'),
    title: overrides.title,
    description: overrides.description ?? null,
    completed: overrides.completed ?? false,
    status: overrides.status ?? 'pending',
    completed_at: overrides.completed_at ?? null,
    created_at: overrides.created_at ?? '2026-11-24T07:00:00.000Z',
    updated_at: overrides.updated_at ?? '2026-11-24T07:00:00.000Z',
    list_type: overrides.list_type ?? 'inbox',
    priority: overrides.priority ?? 'medium',
    due_date: overrides.due_date === undefined ? '2026-11-24' : overrides.due_date,
    is_subtask: overrides.is_subtask ?? false,
    parent_task_id: overrides.parent_task_id ?? null,
    project_id: overrides.project_id ?? null,
    notes_text: overrides.notes_text ?? null,
    time_block_start: overrides.time_block_start ?? null,
    time_block_end: overrides.time_block_end ?? null,
    estimated_minutes: overrides.estimated_minutes ?? null,
  };
}

describe('Phases F3 & F4 Independent QA Acceptance Matrix (LEAF-01..06 & REC-01..06)', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockServer.online = true;
    mockServer.clock = 0;
    mockServer.tasks.clear();
    mockServer.focusSessions = [];
    mockServer.onboardingRows.clear();
    mockServer.installedHabitsByInstallId.clear();
    mockServer.failTaskUpdates.clear();
    mockServer.updateCallsByTaskId.clear();
    mockServer.onBeforeTaskUpdate = null;
    mockSession.user = { id: 'user-qa-f3f4', email: null };
    setTaskOutboxStorage(asyncStorageOutbox);
    resetAccountMemory('signed_out');
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ===========================================================================
  // PHASE F3 — START, SMALL STEP, AI SAFETY & FALLBACK (LEAF-01 .. LEAF-06)
  // ===========================================================================
  describe('Phase F3 — Start, Small Step & AI First-Step Safety (LEAF-01..06)', () => {
    it('LEAF-01 · Empty account & onboarding interruption: returns 5-min starter_sample, starts immediately in focusStore, and preserves onboarding state across hydration', async () => {
      // 1. Empty account evaluation -> 5-minute starter_sample without completing any parent
      const emptySuggestion = evaluateActionSuggestion({
        localDayKey: '2026-11-24',
        userId: 'user-qa-f3f4',
        focus: { status: 'idle' },
        routine: null,
        recoveryToday: [],
        overdueTasks: [],
        tasksToday: [],
        habitsToDo: [],
      });

      expect(emptySuggestion.kind).toBe('start_small');
      expect(emptySuggestion.reasonCode).toBe('starter_sample');
      expect(emptySuggestion.completesParentOnFinish).toBe(false);
      expect(emptySuggestion.requiresConfirmation).toBe(false);
      expect(emptySuggestion.estimate).toMatchObject({
        source: 'default',
        minutes: 5,
        rangeMin: 2,
        rangeMax: 5,
        isMissingEstimate: false,
      });
      expect(emptySuggestion.sourceRef).toMatchObject({
        entity: 'starter_pack',
        id: DEFAULT_STARTER_PACK_KEY,
      });

      // 2. pickStarterQuickStep starts immediately in focusStore.startSmallStep without mandatory setup
      const quickStep = pickStarterQuickStep();
      expect(quickStep.packKey).toBe(DEFAULT_STARTER_PACK_KEY);
      expect(quickStep.estimatedMinutes).toBe(5);
      expect(quickStep.firstStepTitle.length).toBeGreaterThanOrEqual(1);
      expect(quickStep.firstStepTitle.length).toBeLessThanOrEqual(MAX_FIRST_STEP_LENGTH);
      expect(listStarterQuickSteps().length).toBeGreaterThanOrEqual(STARTER_QUICK_PACK_KEYS.length);

      const started = useFocusStore.getState().startSmallStep(
        {
          kind: 'task',
          id: `starter:${quickStep.packKey}`,
          title: quickStep.packTitle,
        },
        {
          title: quickStep.firstStepTitle,
          minutes: quickStep.estimatedMinutes,
          suggestionId: emptySuggestion.suggestionId,
        },
      );

      expect(started).toBe(true);
      expect(useFocusStore.getState().status).toBe('running');
      expect(useFocusStore.getState().phase).toBe('work');
      expect(useFocusStore.getState().secondsLeft).toBe(5 * 60);
      expect(useFocusStore.getState().smallStep).toMatchObject({
        title: quickStep.firstStepTitle,
        minutes: 5,
        suggestionId: emptySuggestion.suggestionId,
      });

      // 3. Onboarding interruption & cold-start hydration preserves partial answers and in-flight install state
      await useOnboardingStore.getState().hydrate();
      expect(useOnboardingStore.getState().hydrationState).toBe('ready');
      expect(useOnboardingStore.getState().status).toBe('pending');
      expect(
        resolveOnboardingRouting({
          hasSupabaseSession: true,
          hasAnySession: true,
          hydrationState: useOnboardingStore.getState().hydrationState,
          status: useOnboardingStore.getState().status,
          inAuthGroup: false,
          inPasswordRecovery: false,
          inOnboarding: false,
          personalizing: false,
        }),
      ).toEqual({ kind: 'redirect', to: '/onboarding/needs' });

      useOnboardingStore.getState().toggleGoal('focus_productivity');
      useOnboardingStore.getState().toggleGoal('daily_order');
      useOnboardingStore.getState().setBarrier('getting_started');
      useOnboardingStore.getState().setPace('gentle');
      useOnboardingStore.getState().toggleDaypart('morning');
      useOnboardingStore.getState().setReminderIntent(false);

      const savedNeeds = await useOnboardingStore.getState().saveProgress('needs');
      expect(savedNeeds).toBe(true);
      expect(useOnboardingStore.getState().status).toBe('pending');

      // Simulate app restart mid-onboarding: reset memory and re-hydrate from server row
      useOnboardingStore.getState().resetForAccount();
      expect(useOnboardingStore.getState().status).toBe('unknown');

      await useOnboardingStore.getState().hydrate();
      expect(useOnboardingStore.getState().hydrationState).toBe('ready');
      expect(useOnboardingStore.getState().status).toBe('pending');
      expect(useOnboardingStore.getState().answers).toEqual({
        goals: ['focus_productivity', 'daily_order'],
        primaryBarrier: 'getting_started',
        pace: 'gentle',
        preferredDayparts: ['morning'],
        reminderIntent: false,
      });

      // Simulate crash during `status: 'installing'` with partial habits (2 of 3 landed) -> recovers `installPhase: 'partial'`
      const existingRow = mockServer.onboardingRows.get('user-qa-f3f4')!;
      mockServer.onboardingRows.set('user-qa-f3f4', {
        ...existingRow,
        status: 'installing',
        install_id: 'inst-interrupted-leaf01',
        install_expected_habits: 3,
        install_return_status: 'pending',
      });
      mockServer.installedHabitsByInstallId.set('inst-interrupted-leaf01', 2);

      useOnboardingStore.getState().resetForAccount();
      await useOnboardingStore.getState().hydrate();

      expect(useOnboardingStore.getState().status).toBe('installing');
      expect(useOnboardingStore.getState().installPhase).toBe('partial');
      expect(useOnboardingStore.getState().installedHabitCount).toBe(2);
      expect(useOnboardingStore.getState().installExpectedHabits).toBe(3);
      expect(useOnboardingStore.getState().answers.goals).toEqual([
        'focus_productivity',
        'daily_order',
      ]);
      expect(
        resolveOnboardingRouting({
          hasSupabaseSession: true,
          hasAnySession: true,
          hydrationState: useOnboardingStore.getState().hydrationState,
          status: useOnboardingStore.getState().status,
          inAuthGroup: false,
          inPasswordRecovery: false,
          inOnboarding: false,
          personalizing: false,
        }),
      ).toEqual({ kind: 'redirect', to: '/onboarding/plan' });
    });

    it('LEAF-02 · AI plan validation & safety: extracts one 1..120-char micro-step, drops extras, blocks authority/prototype keys, isolates accounts, asks clarification, and catches stale tasks', () => {
      const startFixture = buildStartFixture({ userId: 'user-qa-f3f4' });
      const proposalTask = startFixture.tasks[0];
      const reportTask: Task = {
        id: 'task-report-owned',
        user_id: 'user-qa-f3f4',
        title: 'Rapor yaz',
        status: 'pending',
        priority: 'high',
        due_date: '2026-11-24',
        estimated_minutes: null,
        list_type: 'inbox',
        completed: false,
        created_at: '2026-11-24T06:30:00.000Z',
        updated_at: '2026-11-24T06:30:00.000Z',
      };

      const baseContext: AiFirstStepContext = {
        userId: 'user-qa-f3f4',
        localDayKey: '2026-11-24',
        requestId: 'req-leaf02-001',
        userPrompt: 'Teklifi hazırla',
        openTasks: [proposalTask, reportTask],
        journalText: 'Gizli günlük metni dışarı sızmamalı',
      };

      // Journal privacy default: excluded unless includeJournalContext === true
      const promptEnvelope = resolveAiFirstStepPromptContext(baseContext);
      expect(promptEnvelope.includeJournalContext).toBe(false);
      expect(promptEnvelope.journalExcerpt).toBeNull();
      expect(promptEnvelope.openTaskTitles).toEqual(['Teklifi hazırla', 'Rapor yaz']);

      // 1. «Teklifi hazırla» & «Rapor yaz»: single micro-step (1..120 chars), drops extra steps
      const adaptedProposal = adaptAiFirstStep(
        {
          type: 'suggest_first_step',
          task_query: 'Teklifi hazırla',
          steps: [
            { title: 'Müşteri kapsam belgesini aç ve 3 ana teslim başlığını alt alta yaz', minutes: 10 },
            { title: 'Fiyat tablosunu ekle', minutes: 20 },
            { title: 'Son okumayı yap', minutes: 15 },
          ],
        },
        baseContext,
      );

      expect(adaptedProposal.kind).toBe('ready_suggestion');
      if (adaptedProposal.kind !== 'ready_suggestion') {
        throw new Error('Expected ready_suggestion for Teklifi hazırla');
      }
      expect(adaptedProposal.taskId).toBe(proposalTask.id);
      expect(adaptedProposal.stepTitle.length).toBeGreaterThanOrEqual(MIN_FIRST_STEP_LENGTH);
      expect(adaptedProposal.stepTitle.length).toBeLessThanOrEqual(MAX_FIRST_STEP_LENGTH);
      expect(adaptedProposal.droppedExtraStepsCount).toBe(2);
      expect(adaptedProposal.requiresConfirmation).toBe(true);
      expect(adaptedProposal.completesParentOnFinish).toBe(false);
      expect(adaptedProposal.estimate).toEqual({
        source: 'ai',
        minutes: 10,
        rangeMin: null,
        rangeMax: null,
        editable: true,
      });

      const adaptedReport = adaptAiFirstStep(
        {
          task_query: 'Rapor yaz',
          step: 'Boş belge açıp özet bölümüne ilk üç bulguyu madde olarak not et',
          steps: ['Grafikleri ekle', 'Ekleri düzenle'],
          minutes: 999, // Out-of-bounds duration -> falls back to NO_AI_ESTIMATE without fake precision
        },
        { ...baseContext, userPrompt: 'Rapor yaz' },
      );

      expect(adaptedReport.kind).toBe('ready_suggestion');
      if (adaptedReport.kind !== 'ready_suggestion') {
        throw new Error('Expected ready_suggestion for Rapor yaz');
      }
      expect(adaptedReport.taskId).toBe(reportTask.id);
      expect(adaptedReport.stepTitle.length).toBeGreaterThanOrEqual(MIN_FIRST_STEP_LENGTH);
      expect(adaptedReport.stepTitle.length).toBeLessThanOrEqual(MAX_FIRST_STEP_LENGTH);
      expect(adaptedReport.droppedExtraStepsCount).toBe(2);
      expect(adaptedReport.estimate).toEqual(NO_AI_ESTIMATE);

      // 2. (-) Rejects fabricated authority, write, and prototype pollution fields
      const forbiddenAuthorityPayloads: { label: string; raw: unknown; expectedField: string }[] = [
        {
          label: 'user_id',
          raw: { step: 'Başlığı aç', user_id: 'victim-user' },
          expectedField: 'user_id',
        },
        {
          label: 'completed',
          raw: { step: 'Başlığı aç', completed: true },
          expectedField: 'completed',
        },
        {
          label: 'xp',
          raw: { step: 'Başlığı aç', xp: 500 },
          expectedField: 'xp',
        },
        {
          label: 'daily_goal',
          raw: { step: 'Başlığı aç', daily_goal: 10 },
          expectedField: 'daily_goal',
        },
        {
          label: 'nested completed',
          raw: { steps: [{ title: 'Başlığı aç', completed: true }] },
          expectedField: 'completed',
        },
      ];

      for (const item of forbiddenAuthorityPayloads) {
        const rejected = adaptAiFirstStep(item.raw, baseContext);
        expect(rejected).toMatchObject({
          kind: 'rejected',
          reason: 'forbidden_authority_field',
          field: item.expectedField,
        });
      }

      const protoJsonPayload: unknown = JSON.parse(
        '{"step":"Başlığı aç","__proto__":{"polluted":true}}',
      );
      expect(validateRawAiFirstStepPayload(protoJsonPayload)).toMatchObject({
        ok: false,
        reason: 'forbidden_prototype_field',
        field: '__proto__',
      });

      const customProtoObj = Object.assign(Object.create({ inherited: true }), {
        step: 'Başlığı aç',
      });
      expect(adaptAiFirstStep(customProtoObj, baseContext)).toMatchObject({
        kind: 'rejected',
        reason: 'forbidden_prototype_field',
        field: '__proto__',
      });

      // 3. (-) Rejects cross-account tasks (never matches another user's task)
      const foreignTask: Task = {
        ...reportTask,
        id: 'task-foreign-victim',
        user_id: 'another-user-id',
        title: 'Gizli yönetim kurulu raporu yaz',
      };
      const crossAccountAttempt = adaptAiFirstStep(
        {
          task_query: 'Gizli yönetim kurulu raporu yaz',
          step: 'İlk sayfayı aç',
          minutes: 5,
        },
        {
          userId: 'user-qa-f3f4',
          localDayKey: '2026-11-24',
          requestId: 'req-leaf02-cross',
          userPrompt: 'Gizli yönetim kurulu raporu yaz',
          openTasks: [proposalTask, foreignTask],
        },
      );
      expect(crossAccountAttempt.kind).toBe('draft_candidate');

      // 4. Ambiguous owned task match -> asks CLARIFICATION_QUESTION instead of guessing
      const reportA: Task = {
        ...reportTask,
        id: 'task-ambig-1',
        title: 'Aylık finans raporu yaz',
      };
      const reportB: Task = {
        ...reportTask,
        id: 'task-ambig-2',
        title: 'Haftalık operasyon raporu yaz',
      };
      const ambiguousResult = adaptAiFirstStep(
        {
          task_query: 'raporu yaz',
          step: 'Son verileri tek tabloda aç',
          minutes: 10,
        },
        {
          userId: 'user-qa-f3f4',
          localDayKey: '2026-11-24',
          requestId: 'req-leaf02-ambig',
          userPrompt: 'raporu yaz',
          openTasks: [reportA, reportB],
        },
      );
      expect(ambiguousResult).toMatchObject({
        kind: 'clarification_needed',
        question: CLARIFICATION_QUESTION,
      });
      if (ambiguousResult.kind === 'clarification_needed') {
        expect(ambiguousResult.candidates.map((c) => c.id)).toEqual([
          'task-ambig-1',
          'task-ambig-2',
        ]);
      }

      // 5. verifyStagedAiSuggestionFreshness catches stale updated_at, edited title, cross-user, and deleted tasks
      const stagedExpectation = {
        taskId: adaptedProposal.taskId,
        expectedFingerprint: adaptedProposal.expectedFingerprint,
        expectedVersion: adaptedProposal.expectedVersion,
        userId: 'user-qa-f3f4',
      };

      expect(verifyStagedAiSuggestionFreshness(stagedExpectation, proposalTask)).toBe('fresh');
      expect(
        verifyStagedAiSuggestionFreshness(stagedExpectation, {
          ...proposalTask,
          updated_at: '2026-11-24T09:45:00.000Z',
        }),
      ).toBe('refresh_required');
      expect(
        verifyStagedAiSuggestionFreshness(stagedExpectation, {
          ...proposalTask,
          completed: true,
          status: 'completed',
        }),
      ).toBe('refresh_required');
      expect(verifyStagedAiSuggestionFreshness(stagedExpectation, null)).toBe('task_gone');
      expect(
        verifyStagedAiSuggestionFreshness(stagedExpectation, {
          ...proposalTask,
          user_id: 'different-user',
        }),
      ).toBe('task_gone');
    });

    it('LEAF-03 · Provider down / timeout / malformed / quota: preserves exact requestId, keeps active focus session running, and returns deterministic local_fallback', () => {
      const startFixture = buildStartFixture({ userId: 'user-qa-f3f4' });
      const proposalTask = startFixture.tasks[0];

      // Start an active focus session before triggering AI first-step requests
      const activeStarted = useFocusStore.getState().startSmallStep(
        { kind: 'task', id: 'task-active-focus', title: 'Mevcut odak işi' },
        { title: 'İlk paragrafı düzenle', minutes: 10, suggestionId: 'sug-existing-active' },
      );
      expect(activeStarted).toBe(true);
      const runningSnapshotBefore = {
        status: useFocusStore.getState().status,
        sessionStartedAt: useFocusStore.getState().sessionStartedAt,
        clock: useFocusStore.getState().clock,
        smallStep: useFocusStore.getState().smallStep,
      };
      expect(runningSnapshotBefore.status).toBe('running');

      const exactRequestId = 'req-leaf03-stable-77';
      const context: AiFirstStepContext = {
        userId: 'user-qa-f3f4',
        localDayKey: startFixture.localDayKey,
        requestId: exactRequestId,
        userPrompt: 'Teklifi hazırla',
        openTasks: [proposalTask],
        activeFocusRunning: useFocusStore.getState().status === 'running',
      };

      const failureMatrix = [
        {
          outcome: { ok: false as const, status: 503, error: new Error('503 Service Unavailable') },
          expectedReason: '5xx',
        },
        {
          outcome: {
            ok: false as const,
            error: Object.assign(new Error('Edge invocation timed out'), {
              name: 'EdgeTimeoutError',
            }),
          },
          expectedReason: 'timeout',
        },
        {
          outcome: { ok: true as const, rawText: '{"step": "Kırık JSON yanıtı' },
          expectedReason: 'malformed_response',
        },
        {
          outcome: {
            ok: true as const,
            payload: { step: 'Yetkisiz alan enjeksiyonu', user_id: 'attacker' },
          },
          expectedReason: 'malformed_response',
        },
        {
          outcome: {
            ok: false as const,
            status: 429,
            code: 'quota_exceeded',
            error: new Error('Daily AI quota exceeded'),
          },
          expectedReason: 'quota_exceeded',
        },
      ] as const;

      const fallbackStepTitles = new Set<string>();

      for (const testCase of failureMatrix) {
        const resolved = resolveFirstStepWithFallback(testCase.outcome, context);
        expect(resolved.kind).toBe('local_fallback');
        if (resolved.kind !== 'local_fallback') {
          throw new Error(`Expected local_fallback for ${testCase.expectedReason}`);
        }

        expect(resolved.fallbackUsed).toBe(true);
        expect(resolved.source).toBe('local_splitter');
        expect(resolved.reason).toBe(testCase.expectedReason);
        expect(resolved.requestId).toBe(exactRequestId);
        expect(resolved.retryRequestId).toBe(exactRequestId);
        expect(resolved.preserveActiveSession).toBe(true);
        expect(resolved.completesParentOnFinish).toBe(false);
        expect(resolved.requiresConfirmation).toBe(true);
        expect(resolved.taskId).toBe(proposalTask.id);
        expect(resolved.estimate).toEqual(NO_AI_ESTIMATE);
        expect(isSmallStep(resolved.smallStep)).toBe(true);
        expect(
          validateSmallStep(
            { kind: 'task', id: proposalTask.id, title: proposalTask.title },
            { title: resolved.stepTitle, minutes: resolved.smallStep.minutes },
          ).ok,
        ).toBe(true);

        fallbackStepTitles.add(resolved.stepTitle);
      }

      // Deterministic local splitter yields the exact same micro-step across every failure mode
      expect(fallbackStepTitles.size).toBe(1);

      // Active focus session in focusStore was never interrupted, reset, or overwritten
      expect({
        status: useFocusStore.getState().status,
        sessionStartedAt: useFocusStore.getState().sessionStartedAt,
        clock: useFocusStore.getState().clock,
        smallStep: useFocusStore.getState().smallStep,
      }).toEqual(runningSnapshotBefore);
    });

    it('LEAF-04 · Action idempotency: rapid double-tap / duplicate delivery of startSmallStep with the same suggestionId produces at most ONE active session and zero duplicate rows', async () => {
      const startFixture = buildStartFixture({ userId: 'user-qa-f3f4' });
      const proposalTask = startFixture.tasks[0];

      const suggestion = evaluateActionSuggestion({
        localDayKey: startFixture.localDayKey,
        userId: startFixture.userId,
        tasksToday: [proposalTask],
      });
      const smallStep = suggestionToSmallStep(suggestion);
      expect(smallStep).not.toBeNull();

      const parentRef = {
        kind: 'task' as const,
        id: proposalTask.id,
        title: proposalTask.title,
      };

      // First tap starts the session; rapid duplicate taps (including padded whitespace) join idempotently
      const tap1 = useFocusStore.getState().startSmallStep(parentRef, {
        title: suggestion.firstStepTitle,
        minutes: 5,
        suggestionId: suggestion.suggestionId,
      });
      const startedAtAfterTap1 = useFocusStore.getState().sessionStartedAt;
      const clockAfterTap1 = useFocusStore.getState().clock;

      const tap2 = useFocusStore.getState().startSmallStep(parentRef, {
        title: suggestion.firstStepTitle,
        minutes: 5,
        suggestionId: suggestion.suggestionId,
      });
      const tap3 = useFocusStore.getState().startSmallStep(parentRef, {
        title: suggestion.firstStepTitle,
        minutes: 5,
        suggestionId: `  ${suggestion.suggestionId}  `,
      });

      // (-) A different suggestionId while session is active must be refused (false)
      const conflictingTap = useFocusStore.getState().startSmallStep(
        { kind: 'task', id: 'other-task', title: 'Başka görev' },
        { title: 'Farklı adım', minutes: 5, suggestionId: 'sug_different_id' },
      );

      expect(tap1).toBe(true);
      expect(tap2).toBe(true);
      expect(tap3).toBe(true);
      expect(conflictingTap).toBe(false);

      expect(useFocusStore.getState().status).toBe('running');
      expect(useFocusStore.getState().sessionStartedAt).toBe(startedAtAfterTap1);
      expect(useFocusStore.getState().clock).toBe(clockAfterTap1);
      expect(useFocusStore.getState().smallStep?.suggestionId).toBe(suggestion.suggestionId);

      // Completing the session writes exactly ONE focus_sessions row (zero duplicates)
      await useFocusStore.getState().nextPhase();
      await coreOutbox.flush();

      expect(useFocusStore.getState().sessionsCompleted).toBe(1);
      expect(mockServer.focusSessions).toHaveLength(1);
      expect(mockServer.focusSessions[0]).toMatchObject({
        task_id: null,
        task_title: suggestion.firstStepTitle,
        planned_seconds: 300,
        completed: true,
      });
    });

    it('LEAF-05 · Started vs completed: early stop and full 5-minute completion record focus progress while NEVER marking parent Task completed', async () => {
      const parentTask = seedServerAndStoreTask(
        makeServerTaskRow({
          id: 'task-leaf05-parent',
          title: 'Teklifi hazırla',
          estimated_minutes: 30,
          completed: false,
          status: 'pending',
        }),
      );

      // Enable autoCheckTasks to prove small-step sessions still never auto-complete parent tasks
      useFocusStore.getState().updateSettings({ autoCheckTasks: true });

      const suggestion = evaluateActionSuggestion({
        localDayKey: '2026-11-24',
        userId: 'user-qa-f3f4',
        tasksToday: [parentTask],
      });
      expect(suggestion.completesParentOnFinish).toBe(false);

      const parentRef = {
        kind: 'task' as const,
        id: parentTask.id,
        title: parentTask.title,
      };

      let fakeNowMs = Date.parse('2026-11-24T09:00:00.000Z');
      const nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => fakeNowMs);

      try {
        // Case A: Start 5-min small step, work 125s (< 300s, >= 60s partial threshold), stop early
        const startedEarly = useFocusStore.getState().startSmallStep(parentRef, {
          title: suggestion.firstStepTitle,
          minutes: 5,
          suggestionId: suggestion.suggestionId,
        });
        expect(startedEarly).toBe(true);

        fakeNowMs += 125_000;
        useFocusStore.getState().tick();
        expect(useFocusStore.getState().secondsLeft).toBe(175);

        useFocusStore.getState().reset();
        for (let i = 0; i < 6; i += 1) {
          await Promise.resolve();
        }
        await coreOutbox.flush();

        expect(useFocusStore.getState().status).toBe('idle');
        expect(useFocusStore.getState().lastPartial).toEqual({ seconds: 125 });
        expect(mockServer.focusSessions).toHaveLength(1);
        expect(mockServer.focusSessions[0]).toMatchObject({
          task_id: null,
          task_title: suggestion.firstStepTitle,
          planned_seconds: 300,
          completed_seconds: 125,
          completed: false,
        });

        // Parent Task remains open and uncompleted after partial stop
        expect(useTaskStore.getState().tasks.find((t) => t.id === parentTask.id)).toMatchObject({
          completed: false,
          status: 'pending',
          estimated_minutes: 30,
        });
        expect(mockServer.tasks.get(parentTask.id)).toMatchObject({
          completed: false,
          status: 'pending',
        });

        // Case B: Start 5-min small step and finish the full 300-second timer
        fakeNowMs = Date.parse('2026-11-24T09:10:00.000Z');
        const startedFull = useFocusStore.getState().startSmallStep(parentRef, {
          title: suggestion.firstStepTitle,
          minutes: 5,
          suggestionId: `${suggestion.suggestionId}:second-run`,
        });
        expect(startedFull).toBe(true);

        fakeNowMs += 300_000;
        await useFocusStore.getState().nextPhase();
        await coreOutbox.flush();

        expect(useFocusStore.getState().status).toBe('idle');
        expect(useFocusStore.getState().phase).toBe('work');
        expect(useFocusStore.getState().sessionsCompleted).toBe(1);
        expect(useFocusStore.getState().justCompleted).toMatchObject({
          taskTitle: suggestion.firstStepTitle,
          seconds: 300,
          sessionNumber: 1,
        });
        expect(mockServer.focusSessions).toHaveLength(2);
        expect(mockServer.focusSessions[1]).toMatchObject({
          task_id: null,
          task_title: suggestion.firstStepTitle,
          planned_seconds: 300,
          completed_seconds: 300,
          completed: true,
        });

        // Parent Task STILL remains open, uncompleted, and its estimate is never auto-mutated
        const storedParentAfter = useTaskStore
          .getState()
          .tasks.find((t) => t.id === parentTask.id)!;
        expect(storedParentAfter.completed).toBe(false);
        expect(storedParentAfter.status).toBe('pending');
        expect(storedParentAfter.completed_at).toBeNull();
        expect(storedParentAfter.estimated_minutes).toBe(30);
        expect(mockServer.tasks.get(parentTask.id)?.completed).toBe(false);

        const estimateCheck = reconcileFocusElapsedWithEstimate(storedParentAfter, 5);
        expect(estimateCheck.autoMutated).toBe(false);
        expect(estimateCheck.preservedEstimatedMinutes).toBe(30);
        expect(estimateCheck.confirmationCandidate).toEqual({
          proposedMinutes: 5,
          proposedSource: 'user',
          requiresUserConfirmation: true,
        });
      } finally {
        nowSpy.mockRestore();
      }
    });

    it('LEAF-06 · Priority, yielded focus, calm overdue & accessibility metadata: enforces priority ladder, >30m yielded focus, calm shortest overdue pick, and explicit estimate/energy metadata', () => {
      const nowMs = Date.parse('2026-11-24T12:00:00.000Z');
      expect(OVERDUE_CALM_LIMIT).toBe(5);
      expect(FOCUS_PAUSE_YIELD_MS).toBe(30 * 60 * 1000);

      const activeRoutine = {
        id: 'routine-morning',
        status: 'running' as const,
        templateName: 'Sabah Sıfırlama',
        done: 1,
        total: 4,
        remainingMinutes: 10,
      };
      const dueHabit = {
        id: 'habit-due-1',
        name: 'Su tüketimi',
        status: 'active' as const,
        estimated_minutes: 5,
      };
      const dueTask = {
        id: 'task-due-today',
        title: 'Müşteri notunu gönder',
        due_date: '2026-11-24',
        estimated_minutes: null,
      };

      // 1. Active running focus takes top priority over routine, recovery, overdue, habit, and task
      const topFocus = evaluateActionSuggestion({
        localDayKey: '2026-11-24',
        userId: 'user-qa-f3f4',
        nowMs,
        focus: {
          id: 'focus-live-1',
          status: 'running',
          title: 'Teklifi hazırla',
          remainingMinutes: 8,
        },
        routine: activeRoutine,
        recoveryToday: [{ id: 'rec-1', habitName: 'Okuma' }],
        overdueTasks: [{ id: 'ov-1', title: 'Eski görev', estimated_minutes: 10 }],
        habitsToDo: [dueHabit],
        tasksToday: [dueTask],
      });
      expect(topFocus).toMatchObject({
        kind: 'resume_focus',
        reasonCode: 'active_focus',
        completesParentOnFinish: false,
      });

      // 2. Active routine takes priority when focus is idle
      const secondRoutine = evaluateActionSuggestion({
        localDayKey: '2026-11-24',
        userId: 'user-qa-f3f4',
        nowMs,
        focus: { status: 'idle' },
        routine: activeRoutine,
        recoveryToday: [{ id: 'rec-1', habitName: 'Okuma' }],
        habitsToDo: [dueHabit],
        tasksToday: [dueTask],
      });
      expect(secondRoutine).toMatchObject({
        kind: 'resume_routine',
        reasonCode: 'active_routine',
        completesParentOnFinish: false,
      });

      // 3. >30m paused focus yields to due work, then surfaces as yielded_focus when due work is absent/excluded
      const paused35mAgo = nowMs - 35 * 60 * 1000;
      const yieldedWithDueWork = evaluateActionSuggestion({
        localDayKey: '2026-11-24',
        userId: 'user-qa-f3f4',
        nowMs,
        focus: {
          id: 'focus-paused-stale',
          status: 'paused',
          title: 'Sabah taslağı',
          pausedAt: paused35mAgo,
          remainingMinutes: 12,
        },
        habitsToDo: [dueHabit],
        tasksToday: [dueTask],
      });
      expect(yieldedWithDueWork).toMatchObject({
        kind: 'habit',
        reasonCode: 'due_habit',
      });

      const yieldedAtTail = cycleAlternativeSuggestion(
        {
          localDayKey: '2026-11-24',
          userId: 'user-qa-f3f4',
          nowMs,
          focus: {
            id: 'focus-paused-stale',
            status: 'paused',
            title: 'Sabah taslağı',
            pausedAt: paused35mAgo,
            remainingMinutes: 12,
          },
          habitsToDo: [dueHabit],
          tasksToday: [dueTask],
        },
        [dueHabit.id, dueTask.id],
      );
      expect(yieldedAtTail).toMatchObject({
        kind: 'resume_focus',
        reasonCode: 'yielded_focus',
      });

      // 4. > OVERDUE_CALM_LIMIT (6 overdue tasks) picks the calm shortest explicit step + surfaces estimate & low-energy metadata
      const sixOverdueTasks = [
        { id: 'ov-45', title: 'Uzun analiz raporu', due_date: '2026-11-18', estimated_minutes: 45 },
        { id: 'ov-none', title: 'Süresiz belge kontrolü', due_date: '2026-11-19', estimated_minutes: null },
        { id: 'ov-25', title: 'Sunum revizyonu', due_date: '2026-11-20', estimated_minutes: 25 },
        { id: 'ov-05', title: 'Kısa onay e-postası gönder', due_date: '2026-11-21', estimated_minutes: 5 },
        { id: 'ov-30', title: 'Sözleşme eki oku', due_date: '2026-11-22', estimated_minutes: 30 },
        { id: 'ov-15', title: 'Fatura arşivle', due_date: '2026-11-23', estimated_minutes: 15 },
      ];
      expect(sixOverdueTasks.length).toBeGreaterThan(OVERDUE_CALM_LIMIT);

      const calmOverduePick = evaluateActionSuggestion({
        localDayKey: '2026-11-24',
        userId: 'user-qa-f3f4',
        overdueTasks: sixOverdueTasks,
        energyLevel: 'low',
        loadState: { currentLoad: 88, ceiling: 70, isHighLoad: true },
      });

      expect(calmOverduePick).toMatchObject({
        kind: 'task',
        reasonCode: 'overdue_calm_pick',
        sourceRef: { entity: 'task', id: 'ov-05', parentTitle: 'Kısa onay e-postası gönder' },
        estimate: { source: 'user', minutes: 5, isMissingEstimate: false },
        completesParentOnFinish: false,
      });
      expect(describeEstimateSource(calmOverduePick.estimate.source)).toBe('Seçtiğin süre');
      expect(calmOverduePick.displayReason).toContain('düşük enerji tercihi');

      // Missing-estimate task carries explicit default estimate metadata & shrink ladder preserves safety
      const unestimatedLowEnergy = evaluateActionSuggestion({
        localDayKey: '2026-11-24',
        userId: 'user-qa-f3f4',
        tasksToday: [dueTask],
        lowEnergy: true,
      });
      expect(unestimatedLowEnergy.estimate).toMatchObject({
        source: 'default',
        minutes: 15,
        rangeMin: 5,
        rangeMax: 15,
        isMissingEstimate: true,
      });
      expect(describeEstimateSource(unestimatedLowEnergy.estimate.source)).toBe(
        'Varsayılan tahmin (15 dk)',
      );
      expect(unestimatedLowEnergy.displayReason).toContain('15 dk varsayılan süre');
      expect(unestimatedLowEnergy.displayReason).toContain('düşük enerji tercihi');

      const shrunkOnce = shrinkActionSuggestion(unestimatedLowEnergy);
      expect(shrunkOnce.estimate.minutes).toBe(10);
      expect(shrunkOnce.completesParentOnFinish).toBe(false);
    });
  });

  // ===========================================================================
  // PHASE F4 — DAY RECOVERY PREVIEW, COMMIT, UNDO, ROLLOVER & REVIEW (REC-01..06)
  // ===========================================================================
  describe('Phase F4 — Day Recovery, Versioned Commit/Undo, Boundaries & Weekly Review (REC-01..06)', () => {
    it('REC-01 · Fixed appointment: keeps 16:00 block locked in lockedItems, protects chosen item, detects overlap conflicts, and computes accurate loadBefore -> loadAfter', () => {
      const recovery = buildRecoveryFixture({ userId: 'user-qa-f3f4' });

      const preview = buildDayPlanPreview({
        userId: recovery.userId,
        localDayKey: recovery.localDayKey,
        nowLocalMinutes: 14 * 60 + 30, // 14:30
        generatedAtIso: recovery.nowIso,
        protectedRef: { entity: 'task', id: 'task-rec-blocked' },
        fixedBlocks: recovery.fixedBlocks,
        tasks: recovery.tasks,
        habits: recovery.habits,
        todayLogs: recovery.todayLogs,
        remainingCapacityMinutes: 50,
      });

      // 1. 16:00 appointment stays strictly locked in lockedItems and never enters mutable changes
      expect(preview.lockedItems).toEqual([
        expect.objectContaining({
          kind: 'fixed_block',
          id: 'appt-fixed-1600',
          title: 'Müşteri değerlendirme toplantısı',
          localDay: recovery.localDayKey,
          locked: true,
          timeBlock: { start: '16:00', end: '17:00' },
          reasonCode: 'fixed_appointment',
        }),
      ]);
      expect(preview.changes.some((c) => c.sourceRef.id === 'appt-fixed-1600')).toBe(false);
      expect(preview.unplacedItems.some((u) => u.sourceRef.id === 'appt-fixed-1600')).toBe(false);

      // 2. Chosen task is protected in protectedItems and excluded from lighten/postpone changes
      expect(preview.protectedItems).toHaveLength(1);
      expect(preview.protectedItems[0]).toMatchObject({
        sourceRef: {
          entity: 'task',
          id: 'task-rec-blocked',
          title: 'Sunum taslağını güncelle',
        },
        reasonCode: 'protected_by_user',
        conflictsWithFixedBlockId: null,
      });
      expect(preview.changes.some((c) => c.sourceRef.id === 'task-rec-blocked')).toBe(false);

      // 3. Remaining open tasks + partial habit are planned within remaining 50m capacity (45m protected + 5m shrunk/habit)
      expect(preview.capacitySummary.effectiveCapacityMinutes).toBe(50);
      expect(preview.capacitySummary.usedCapacityMinutes).toBeLessThanOrEqual(50);
      expect(preview.capacitySummary.fixedBlockedMinutes).toBe(60); // 16:00..17:00 inside 14:30..21:00
      expect(preview.missingEstimateTaskIds).toEqual(['task-rec-unestimated']);

      // 4. Accurate loadBefore -> loadAfter reduction & band alignment
      expect(preview.loadBefore).toBeGreaterThan(0);
      expect(preview.loadAfter).toBeGreaterThanOrEqual(0);
      expect(preview.loadAfter).toBeLessThan(preview.loadBefore);
      expect(preview.loadDelta).toBe(preview.loadAfter - preview.loadBefore);
      expect(preview.bandBefore).toBe(bandFor(preview.loadBefore));
      expect(preview.bandAfter).toBe(bandFor(preview.loadAfter));

      // 5. Overlap check: a task scheduled at 16:15–16:45 conflicts with the locked 16:00–17:00 appointment
      const overlappingTask: Task = {
        ...recovery.tasks[1],
        id: 'task-overlap-1615',
        title: 'Çakışan 16:15 araması',
        time_block_start: '16:15',
        time_block_end: '16:45',
        estimated_minutes: 30,
      };
      const overlapPreview = buildDayPlanPreview({
        userId: recovery.userId,
        localDayKey: recovery.localDayKey,
        nowLocalMinutes: 14 * 60 + 30,
        generatedAtIso: recovery.nowIso,
        protectedRef: null,
        fixedBlocks: recovery.fixedBlocks,
        tasks: [overlappingTask],
        habits: [],
        todayLogs: [],
        remainingCapacityMinutes: 120,
      });

      expect(overlapPreview.lockedItems[0].id).toBe('appt-fixed-1600');
      expect(overlapPreview.changes[0]).toMatchObject({
        sourceRef: { entity: 'task', id: 'task-overlap-1615' },
        action: 'postpone_tomorrow',
        reasonCode: 'conflicts_with_fixed_block',
        conflictingFixedBlockId: 'appt-fixed-1600',
      });
    });

    it('REC-02 · Pre-confirmation purity: Object.freeze inputs stay untouched across preview, overrides, step-back, and discard while preserving 0.5/1.5 L (1.0 L deficit)', () => {
      const recovery = buildRecoveryFixture({ userId: 'user-qa-f3f4' });
      const frozenInput: DayPlanPreviewInput = deepFreeze({
        userId: recovery.userId,
        localDayKey: recovery.localDayKey,
        nowLocalMinutes: 14 * 60 + 30,
        generatedAtIso: recovery.nowIso,
        protectedRef: { entity: 'task', id: 'task-rec-blocked' },
        fixedBlocks: recovery.fixedBlocks.map((b) => ({ ...b })),
        tasks: recovery.tasks.map((t) => ({ ...t })),
        habits: recovery.habits.map((h) => ({ ...h })),
        todayLogs: recovery.todayLogs.map((l) => ({ ...l })),
        remainingCapacityMinutes: 45,
        itemOverrides: {},
      });

      const snapshotBeforeJson = JSON.stringify(frozenInput);

      // Step 1: Open initial preview
      const initialPreview = buildDayPlanPreview(frozenInput);

      // Verify 0.5 / 1.5 L partial habit deficit (1.0 L) is preserved without inventing completion
      const waterChangeInitial = initialPreview.changes.find(
        (c) => c.sourceRef.entity === 'habit' && c.sourceRef.id === 'habit-rec-water',
      );
      expect(waterChangeInitial).toBeDefined();
      expect(waterChangeInitial!.before).toMatchObject({
        habitState: 'partial',
        loggedValue: 0.5,
        targetValue: 1.5,
        deficitRemaining: 1.0,
        unit: 'L',
      });
      expect(waterChangeInitial!.action).toBe('do_not_recover');
      expect(waterChangeInitial!.after).toMatchObject({
        habitState: 'partial',
        loggedValue: 0.5,
        targetValue: 1.5,
        deficitRemaining: 0,
        recoveryStrategy: 'skip',
      });

      // Step 2: Override task and habit actions in preview («Gör» step)
      const overriddenTaskPreview = applyPreviewItemOverride(
        frozenInput,
        previewItemKey('task', 'task-rec-unestimated'),
        'release_someday',
      );
      expect(
        overriddenTaskPreview.changes.find((c) => c.sourceRef.id === 'task-rec-unestimated'),
      ).toMatchObject({
        action: 'release_someday',
        reasonCode: 'user_override',
        after: { dueDate: null, listType: 'someday' },
      });

      const overriddenHabitPreview = applyPreviewItemOverride(
        frozenInput,
        previewItemKey('habit', 'habit-rec-water'),
        'keep',
      );
      expect(
        overriddenHabitPreview.changes.find((c) => c.sourceRef.id === 'habit-rec-water'),
      ).toMatchObject({
        action: 'keep',
        reasonCode: 'user_override',
        after: {
          habitState: 'partial',
          loggedValue: 0.5,
          targetValue: 1.5,
          deficitRemaining: 1.0,
        },
      });

      // Step 3: Step back to original un-overridden input -> identical deterministic preview
      const steppedBackPreview = buildDayPlanPreview(frozenInput);
      expect(steppedBackPreview).toEqual(initialPreview);

      // Step 4: Discard without committing -> zero input mutations and zero server/store writes
      expect(JSON.stringify(frozenInput)).toBe(snapshotBeforeJson);
      expect(mockServer.tasks.size).toBe(0);
      expect(mockServer.updateCallsByTaskId.size).toBe(0);
      expect(useTaskStore.getState().tasks).toEqual([]);
    });

    it('REC-03 · Partial write & failed-only retry: 3-item commitDayPlan with item #3 failing returns overall: "partial", and retryFailedDayPlanItems executes ONLY item #3', async () => {
      const t1 = seedServerAndStoreTask(
        makeServerTaskRow({
          id: 'task-rec03-1',
          title: 'Fatura belgelerini topla',
          due_date: '2026-11-24',
          updated_at: '2026-11-24T08:00:00.000Z',
        }),
      );
      const t2 = seedServerAndStoreTask(
        makeServerTaskRow({
          id: 'task-rec03-2',
          title: 'Geçen hafta e-postasını yanıtla',
          due_date: '2026-11-21',
          updated_at: '2026-11-21T08:00:00.000Z',
        }),
      );
      const t3 = seedServerAndStoreTask(
        makeServerTaskRow({
          id: 'task-rec03-3',
          title: 'Arşiv klasörünü düzenle',
          due_date: '2026-11-24',
          updated_at: '2026-11-24T08:30:00.000Z',
        }),
      );

      // Inject a transient 503 failure strictly on item #3
      mockServer.failTaskUpdates.set(t3.id, {
        ok: false,
        error: '503 Service Unavailable',
        status: 503,
      });

      const items: PlanMutationItem[] = [
        {
          itemId: 'mut-rec03-1',
          entity: 'task',
          targetId: t1.id,
          title: t1.title,
          expectedVersion: t1.updated_at ?? null,
          action: 'postpone_tomorrow',
        },
        {
          itemId: 'mut-rec03-2',
          entity: 'task',
          targetId: t2.id,
          title: t2.title,
          expectedVersion: t2.updated_at ?? null,
          action: 'release_someday',
        },
        {
          itemId: 'mut-rec03-3',
          entity: 'task',
          targetId: t3.id,
          title: t3.title,
          expectedVersion: t3.updated_at ?? null,
          action: 'postpone_tomorrow',
        },
      ];

      const fixedNow = new Date('2026-11-24T12:00:00.000Z');
      const partialResult = await commitDayPlan(
        {
          operationId: 'op-rec03-batch',
          localDayKey: '2026-11-24',
          ianaZone: 'Europe/Istanbul',
          items,
        },
        { now: () => fixedNow },
      );

      expect(partialResult.overall).toBe('partial');
      expect(partialResult.retryableItemIds).toEqual(['mut-rec03-3']);
      expect(partialResult.results).toEqual([
        expect.objectContaining({
          itemId: 'mut-rec03-1',
          targetId: t1.id,
          status: 'committed',
          undoable: true,
        }),
        expect.objectContaining({
          itemId: 'mut-rec03-2',
          targetId: t2.id,
          status: 'committed',
          undoable: true,
        }),
        expect.objectContaining({
          itemId: 'mut-rec03-3',
          targetId: t3.id,
          status: 'retryable',
          undoable: false,
        }),
      ]);
      expect(partialResult.receipt).not.toBeNull();

      // Items #1 and #2 landed on server; item #3 rolled back cleanly to 2026-11-24
      expect(mockServer.tasks.get(t1.id)?.due_date).toBe('2026-11-25');
      expect(mockServer.tasks.get(t2.id)?.list_type).toBe('someday');
      expect(mockServer.tasks.get(t3.id)?.due_date).toBe('2026-11-24');
      expect(mockServer.updateCallsByTaskId.get(t1.id)).toBe(1);
      expect(mockServer.updateCallsByTaskId.get(t2.id)).toBe(1);
      expect(mockServer.updateCallsByTaskId.get(t3.id)).toBe(1);

      // Heal transient failure on item #3 and run failed-only retry
      mockServer.failTaskUpdates.clear();
      const retriedResult = await retryFailedDayPlanItems(partialResult, {
        ianaZone: 'Europe/Istanbul',
        now: () => fixedNow,
      });

      expect(retriedResult.overall).toBe('committed');
      expect(retriedResult.retryableItemIds).toEqual([]);
      expect(retriedResult.results.every((r) => r.status === 'committed' && r.undoable)).toBe(
        true,
      );

      // Items #1 and #2 were NEVER touched again (call counts stay 1); ONLY item #3 ran a second time
      expect(mockServer.updateCallsByTaskId.get(t1.id)).toBe(1);
      expect(mockServer.updateCallsByTaskId.get(t2.id)).toBe(1);
      expect(mockServer.updateCallsByTaskId.get(t3.id)).toBe(2);
      expect(mockServer.tasks.get(t3.id)?.due_date).toBe('2026-11-25');
    });

    it('REC-04 · Multi-device race & versioned Undo: detects pre-commit version_conflict/expired, reverts unchanged items on undo, skips Device B post-commit edits, and never claims unapplied items undone', async () => {
      const recovery = buildRecoveryFixture({ userId: 'user-qa-f3f4' });

      // Part A: Pre-commit evaluatePreviewFreshness detects Device B version_conflict and TTL expiry
      const preview = buildDayPlanPreview({
        userId: recovery.userId,
        localDayKey: recovery.localDayKey,
        nowLocalMinutes: 14 * 60 + 30,
        generatedAtIso: '2026-11-24T11:30:00.000Z',
        protectedRef: { entity: 'task', id: 'task-rec-blocked' },
        fixedBlocks: recovery.fixedBlocks,
        tasks: recovery.tasks,
        habits: recovery.habits,
        todayLogs: recovery.todayLogs,
        remainingCapacityMinutes: 45,
        previewTtlMinutes: 30,
      });

      expect(
        evaluatePreviewFreshness(preview, {
          nowIso: '2026-11-24T11:45:00.000Z',
          currentLocalDayKey: '2026-11-24',
          tasks: recovery.tasks,
          habits: recovery.habits,
          todayLogs: recovery.todayLogs,
        }),
      ).toEqual({ fresh: true, staleItemIds: [], reason: null });

      // Device B edits task-rec-unestimated before Device A confirms
      const tasksEditedByDeviceB = recovery.tasks.map((t) =>
        t.id === 'task-rec-unestimated'
          ? { ...t, title: 'B cihazında güncellenen fatura', updated_at: '2026-11-24T11:40:00.000Z' }
          : t,
      );
      expect(
        evaluatePreviewFreshness(preview, {
          nowIso: '2026-11-24T11:45:00.000Z',
          currentLocalDayKey: '2026-11-24',
          tasks: tasksEditedByDeviceB,
          habits: recovery.habits,
          todayLogs: recovery.todayLogs,
        }),
      ).toEqual({
        fresh: false,
        staleItemIds: ['task-rec-unestimated'],
        reason: 'version_conflict',
      });

      // TTL expired after 30 minutes
      expect(
        evaluatePreviewFreshness(preview, {
          nowIso: '2026-11-24T12:05:00.000Z',
          currentLocalDayKey: '2026-11-24',
          tasks: recovery.tasks,
          habits: recovery.habits,
          todayLogs: recovery.todayLogs,
        }),
      ).toMatchObject({
        fresh: false,
        reason: 'expired',
      });

      // Part B: Post-commit Device B edit + receipt-verified undoDayPlanCommit
      const item1Task = seedServerAndStoreTask(
        makeServerTaskRow({
          id: 'task-rec04-1',
          title: 'Sunum notlarını sadeleştir',
          due_date: '2026-11-24',
          list_type: 'this_week',
          time_block_start: '15:00',
          time_block_end: '15:30',
          updated_at: '2026-11-24T08:00:00.000Z',
        }),
      );
      const item2Task = seedServerAndStoreTask(
        makeServerTaskRow({
          id: 'task-rec04-2',
          title: 'Fatura belgelerini topla',
          due_date: '2026-11-24',
          list_type: 'inbox',
          updated_at: '2026-11-24T08:05:00.000Z',
        }),
      );

      const fixedNow = new Date('2026-11-24T12:00:00.000Z');
      const commitRes = await commitDayPlan(
        {
          operationId: 'op-rec04-race',
          localDayKey: '2026-11-24',
          ianaZone: 'Europe/Istanbul',
          items: [
            {
              itemId: 'item-rec04-1',
              entity: 'task',
              targetId: item1Task.id,
              title: item1Task.title,
              expectedVersion: item1Task.updated_at ?? null,
              action: 'postpone_tomorrow',
            },
            {
              itemId: 'item-rec04-2',
              entity: 'task',
              targetId: item2Task.id,
              title: item2Task.title,
              expectedVersion: item2Task.updated_at ?? null,
              action: 'release_someday',
            },
            {
              // Missing on server -> unapplied (`status: 'permanent'`, `undoable: false`)
              itemId: 'item-rec04-3-unapplied',
              entity: 'task',
              targetId: 'task-missing-on-server',
              title: 'Silinmiş görev',
              expectedVersion: '2026-11-24T07:00:00.000Z',
              action: 'postpone_tomorrow',
            },
          ],
        },
        { now: () => fixedNow },
      );

      expect(commitRes.overall).toBe('partial');
      expect(commitRes.receipt).not.toBeNull();
      expect(mockServer.tasks.get(item1Task.id)?.due_date).toBe('2026-11-25');
      expect(mockServer.tasks.get(item2Task.id)?.list_type).toBe('someday');

      // Device B edits item #1 AFTER Device A's commit (`updated_at` advances)
      seedServerAndStoreTask({
        ...mockServer.tasks.get(item1Task.id)!,
        title: 'B cihazından yeni kapsam notu',
        due_date: '2026-11-29',
        updated_at: '2026-11-24T14:30:00.000Z',
      });

      const undoRes = await undoDayPlanCommit(commitRes.receipt!, {
        now: () => new Date('2026-11-24T14:35:00.000Z'),
      });

      expect(undoRes.overall).toBe('partial');
      expect(undoRes.skippedConflictIds).toEqual(['item-rec04-1']);
      expect(undoRes.undoneItemIds).toEqual(['item-rec04-2']);
      expect(undoRes.skippedUnappliedIds).toEqual(['item-rec04-3-unapplied']);
      expect(undoRes.failedItemIds).toEqual([]);

      // Device B's edit on item #1 was NOT overwritten; unchanged item #2 reverted to 2026-11-24 / inbox
      expect(mockServer.tasks.get(item1Task.id)).toMatchObject({
        title: 'B cihazından yeni kapsam notu',
        due_date: '2026-11-29',
        updated_at: '2026-11-24T14:30:00.000Z',
      });
      expect(mockServer.tasks.get(item2Task.id)).toMatchObject({
        due_date: '2026-11-24',
        list_type: 'inbox',
      });
    });

    it('REC-05 · Rollover & DST boundary: resolves 03:30 vs 04:15 across Istanbul, New York DST, and Auckland without double-writing days, and aborts commitDayPlan on mid-flight midnight rollover', async () => {
      // 1. Europe/Istanbul (UTC+3): 03:30 (< 04:00 rollover) vs 04:15 (>= 04:00 rollover)
      const istanbul0330 = resolveEffectivePlanningDay(
        new Date('2026-11-24T00:30:00.000Z'),
        'Europe/Istanbul',
      );
      expect(istanbul0330).toEqual({
        localDayKey: '2026-11-24',
        closingDayKey: '2026-11-23',
        effectiveDayKey: '2026-11-23',
        nowLocalMinutes: 3 * 60 + 30,
        isBeforeRollover: true,
      });

      const istanbul0415 = resolveEffectivePlanningDay(
        new Date('2026-11-24T01:15:00.000Z'),
        'Europe/Istanbul',
      );
      expect(istanbul0415).toEqual({
        localDayKey: '2026-11-24',
        closingDayKey: '2026-11-24',
        effectiveDayKey: '2026-11-24',
        nowLocalMinutes: 4 * 60 + 15,
        isBeforeRollover: false,
      });

      // 2. America/New_York DST transitions (Spring-forward 2026-03-08 & Fall-back 2026-11-01)
      const nySpringBefore = buildDayBoundarySnapshot(
        new Date('2026-03-08T06:30:00.000Z'), // 01:30 EST -> before 04:00
        'America/New_York',
      );
      const nySpringAfter = buildDayBoundarySnapshot(
        new Date('2026-03-08T08:15:00.000Z'), // 04:15 EDT -> after 02:00->03:00 jump and >= 04:00
        'America/New_York',
      );
      expect(nySpringBefore).toMatchObject({
        localDayKey: '2026-03-08',
        closingDayKey: '2026-03-07',
        localTimeHm: '01:30',
        isBeforeDayCloseRollover: true,
      });
      expect(nySpringAfter).toMatchObject({
        localDayKey: '2026-03-08',
        closingDayKey: '2026-03-08',
        localTimeHm: '04:15',
        isBeforeDayCloseRollover: false,
      });

      const nyFall0330 = resolveEffectivePlanningDay(
        new Date('2026-11-01T08:30:00.000Z'), // 03:30 EST
        'America/New_York',
      );
      const nyFall0415 = resolveEffectivePlanningDay(
        new Date('2026-11-01T09:15:00.000Z'), // 04:15 EST
        'America/New_York',
      );
      expect(nyFall0330.effectiveDayKey).toBe('2026-10-31');
      expect(nyFall0330.isBeforeRollover).toBe(true);
      expect(nyFall0415.effectiveDayKey).toBe('2026-11-01');
      expect(nyFall0415.isBeforeRollover).toBe(false);

      // 3. Pacific/Auckland (UTC+13 NZDT): 03:30 vs 04:15
      const auckland0330 = resolveEffectivePlanningDay(
        new Date('2026-11-24T14:30:00.000Z'), // 2026-11-25 03:30 NZDT
        'Pacific/Auckland',
      );
      const auckland0415 = resolveEffectivePlanningDay(
        new Date('2026-11-24T15:15:00.000Z'), // 2026-11-25 04:15 NZDT
        'Pacific/Auckland',
      );
      expect(auckland0330).toMatchObject({
        localDayKey: '2026-11-25',
        effectiveDayKey: '2026-11-24',
        isBeforeRollover: true,
      });
      expect(auckland0415).toMatchObject({
        localDayKey: '2026-11-25',
        effectiveDayKey: '2026-11-25',
        isBeforeRollover: false,
      });

      // Historical habit log day key never drifts across timezone travel
      expect(
        preserveHistoricalLogDay(
          { completed_at: '2026-11-24', tz: 'Europe/Istanbul' },
          'America/New_York',
        ),
      ).toBe('2026-11-24');
      expect(
        inspectHistoricalLogAnchor(
          { completed_at: '2026-11-24', tz: 'Europe/Istanbul' },
          'Pacific/Auckland',
        ),
      ).toEqual({
        dayKey: '2026-11-24',
        recordedZone: 'Europe/Istanbul',
        viewingZone: 'Pacific/Auckland',
        zoneChangedSinceLog: true,
      });

      // 4. Never double-writes a task onto two days simultaneously + aborts if midnight rolls over mid-flight
      const rowA = seedServerAndStoreTask(
        makeServerTaskRow({
          id: 'task-rec05-a',
          title: 'Gece yarısı öncesi ilk iş',
          due_date: '2026-11-24',
          updated_at: '2026-11-24T18:00:00.000Z',
        }),
      );
      const rowB = seedServerAndStoreTask(
        makeServerTaskRow({
          id: 'task-rec05-b',
          title: 'Gece yarısı sonrası iptal edilecek iş',
          due_date: '2026-11-24',
          updated_at: '2026-11-24T18:05:00.000Z',
        }),
      );

      // Start at 23:59:58 Europe/Istanbul (20:59:58Z); advance across midnight during item #1's write
      let clockUtcIso = '2026-11-24T20:59:58.000Z';
      mockServer.onBeforeTaskUpdate = (taskId: string) => {
        if (taskId === rowA.id) {
          clockUtcIso = '2026-11-24T21:00:03.000Z'; // 2026-11-25 00:00:03 Europe/Istanbul
        }
      };

      const rolloverCommit = await commitDayPlan(
        {
          operationId: 'op-rec05-midnight-rollover',
          localDayKey: '2026-11-24',
          ianaZone: 'Europe/Istanbul',
          items: [
            {
              itemId: 'mut-rec05-a',
              entity: 'task',
              targetId: rowA.id,
              title: rowA.title,
              expectedVersion: rowA.updated_at ?? null,
              action: 'postpone_tomorrow',
            },
            {
              itemId: 'mut-rec05-b',
              entity: 'task',
              targetId: rowB.id,
              title: rowB.title,
              expectedVersion: rowB.updated_at ?? null,
              action: 'postpone_tomorrow',
            },
          ],
        },
        { now: () => new Date(clockUtcIso) },
      );

      expect(rolloverCommit.overall).toBe('aborted');
      expect(rolloverCommit.retryableItemIds).toEqual([]);
      expect(rolloverCommit.results).toHaveLength(1);
      expect(rolloverCommit.results[0].itemId).toBe('mut-rec05-a');

      // Task A exists once (updated to 2026-11-25, never duplicated across two days); Task B was never touched
      expect(mockServer.tasks.size).toBe(2);
      expect(
        [...mockServer.tasks.values()].filter((t) => t.title === rowA.title),
      ).toHaveLength(1);
      expect(mockServer.tasks.get(rowA.id)?.due_date).toBe('2026-11-25');
      expect(mockServer.tasks.get(rowB.id)?.due_date).toBe('2026-11-24');
      expect(mockServer.updateCallsByTaskId.get(rowB.id)).toBeUndefined();
    });

    it('REC-06 · Transition to weekly review: upsertAction -> actionFor -> actionOutcome links concrete weekly adjustment to nextWeekMonday and reflects completion vs pending without fabricating metrics', async () => {
      // Recovery day 2026-11-24 (Tuesday) belongs to Monday week 2026-11-23; next week starts Monday 2026-11-30
      const boundary = buildDayBoundarySnapshot(
        new Date('2026-11-24T15:00:00.000Z'),
        'Europe/Istanbul',
      );
      expect(boundary.xpWeekMondayKey).toBe('2026-11-23');

      const currentWeekKey = boundary.xpWeekMondayKey;
      const targetNextMonday = nextWeekMonday('2026-11-24');
      expect(targetNextMonday).toBe('2026-11-30');
      expect(nextWeekMonday(currentWeekKey)).toBe('2026-11-30');
      expect(previousWeekKey(targetNextMonday)).toBe(currentWeekKey);

      const extractedTitle = taskTitleFrom(
        '\n  - Öğleden sonra 16:00 toplantısı öncesi 15 dk hazırlık tamponu bırak\n  - İkinci satır göz ardı edilir',
      );
      expect(extractedTitle).toBe(
        'Öğleden sonra 16:00 toplantısı öncesi 15 dk hazırlık tamponu bırak',
      );

      // Create the real task for next week's Monday through taskStore
      const createdNextWeekTask = await useTaskStore.getState().addTask({
        title: extractedTitle,
        due_date: targetNextMonday,
        list_type: 'this_week',
        priority: 'medium',
      });
      await useTaskStore.getState().flush();
      expect(createdNextWeekTask).not.toBeNull();
      expect(createdNextWeekTask!.due_date).toBe('2026-11-30');
      expect(createdNextWeekTask!.completed).toBe(false);

      // Link weekly review adjustment via upsertAction (deduplicating per weekKey)
      let reviewActions: ReviewNextAction[] = [];
      reviewActions = upsertAction(reviewActions, {
        weekKey: currentWeekKey,
        kind: 'habit_edit',
        habitId: 'habit-rec-water',
        label: 'Su hedefini akşam öncesi 1,5 L olarak koru',
        createdAt: '2026-11-29T18:00:00.000Z',
      });
      reviewActions = upsertAction(reviewActions, {
        weekKey: currentWeekKey,
        kind: 'task',
        taskId: createdNextWeekTask!.id,
        label: extractedTitle,
        createdAt: '2026-11-29T18:05:00.000Z',
      });
      expect(reviewActions).toHaveLength(1);

      // Next week's review looks up previousWeekKey('2026-11-30') === '2026-11-23'
      const linkedAction = actionFor(reviewActions, previousWeekKey(targetNextMonday));
      expect(linkedAction).toEqual({
        weekKey: '2026-11-23',
        kind: 'task',
        taskId: createdNextWeekTask!.id,
        label: extractedTitle,
        createdAt: '2026-11-29T18:05:00.000Z',
      });

      const resolveCompleted = (id: string): boolean | undefined =>
        useTaskStore.getState().tasks.find((t) => t.id === id)?.completed;

      // 1. Before completion: honestly reports pending without fabricating percentages or streak scores
      const pendingOutcome = actionOutcome(linkedAction!, { taskCompleted: resolveCompleted });
      expect(pendingOutcome).toBe(`${extractedTitle} — henüz yapılmadı`);
      expect(pendingOutcome).not.toMatch(/%|\bpuan\b|\bXP\b/i);

      // 2. After completing the task in taskStore: accurately reflects completion
      await useTaskStore.getState().toggleDone(createdNextWeekTask!.id);
      await useTaskStore.getState().flush();
      expect(actionOutcome(linkedAction!, { taskCompleted: resolveCompleted })).toBe(
        `${extractedTitle} — yapıldı`,
      );

      // 3. Missing task & habit_edit outcomes remain factual without inventing metrics
      expect(actionOutcome(linkedAction!, { taskCompleted: () => undefined })).toBe(
        `${extractedTitle} — görev bulunamadı`,
      );
      const habitEditAction: ReviewNextAction = {
        weekKey: '2026-11-16',
        kind: 'habit_edit',
        habitId: 'habit-rec-water',
        label: 'Su tüketimi hedefini düzenle',
        createdAt: '2026-11-22T19:00:00.000Z',
      };
      expect(actionOutcome(habitEditAction, { taskCompleted: resolveCompleted })).toBe(
        'Su tüketimi hedefini düzenle — alışkanlık ekranında düzenlemek için seçilmişti',
      );
    });
  });
});
