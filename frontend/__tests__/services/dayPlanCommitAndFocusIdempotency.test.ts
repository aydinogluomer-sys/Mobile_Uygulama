/**
 * Faz F3 + F4 (Dalga 2A — SYNC + NATIVE):
 * - LEAF-04: `startSmallStep` suggestionId idempotency (single focus session & single analytics event;
 *            different suggestionId never clobbers an open session; snapshot round-trip preserves suggestionId).
 * - LEAF-05: 5-minute small step start, early reset, and full completion (`nextPhase`) never mark the
 *            parent task in `useTaskStore` as `completed: true`.
 * - E03 / REC-03: Shared `operationId` double-submit lock (`inFlightOperations`), partial failure
 *                 (`overall: 'partial'`, `retryableItemIds` holds only failed item), and `retryFailedDayPlanItems`
 *                 re-running ONLY the failed item while leaving already applied items untouched.
 * - E03 / REC-04: Version check (`expectedVersion` vs current/server `updated_at`) yielding `status: 'conflict'`,
 *                 and receipt-based `undoDayPlanCommit` reverting applied items, skipping post-commit
 *                 modifications (`skippedConflictIds`), and never counting unapplied items as undone.
 * - E03 & §7.1: Account switch (`resetAccountMemory('user_changed')`) and midnight rollover abort remaining
 *               items (`overall: 'aborted'`), and offline outbox writes report `'pending'` instead of `'committed'`.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetAccountMemory } from '../../lib/accountScope';
import * as analytics from '../../lib/analytics';
import { todayLocal } from '../../lib/date';
import { EMPTY_TALLY } from '../../lib/focusRitual';
import { parseSnapshot, snapshotOf, startClock } from '../../lib/focusTimer';
import type { DeliveryOutcome, OutboxCommand } from '../../lib/outbox';
import { asyncStorageOutbox } from '../../lib/outboxStorage';
import { isSmallStep, normalizeSuggestionId, validateSmallStep, type SmallStepParent } from '../../lib/smallStart';
import type { Task } from '../../lib/taskTypes';
import {
  commitDayPlan,
  isDayPlanCommitInFlight,
  retryFailedDayPlanItems,
  undoDayPlanCommit,
  type PlanMutationItem,
} from '../../services/dayPlanCommitService';
import { DEFAULT_SETTINGS, useFocusStore } from '../../store/focusStore';
import { setTaskOutboxStorage, useTaskStore } from '../../store/taskStore';

const mockAsyncStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockAsyncStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockAsyncStore.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockAsyncStore.delete(k);
    }),
    multiRemove: jest.fn(async (ks: readonly string[]) => {
      for (const k of ks) mockAsyncStore.delete(k);
    }),
    multiGet: jest.fn(async (ks: readonly string[]) => ks.map((k) => [k, mockAsyncStore.get(k) ?? null])),
    getAllKeys: jest.fn(async () => [...mockAsyncStore.keys()]),
    clear: jest.fn(async () => {
      mockAsyncStore.clear();
    }),
  },
}));

const mockEnvBox = {
  userId: 'user-A' as string | null,
  serverTasks: new Map<string, Task>(),
  deliveryCalls: [] as { entityId: string; payload: Record<string, unknown>; baseVersion: string | null }[],
  nextOutcomeByTaskId: new Map<string, DeliveryOutcome | (() => Promise<DeliveryOutcome>)>(),
  offlineMode: false,
  versionSeq: 10,
};

jest.mock('../../lib/session', () => ({
  currentUser: async () => (mockEnvBox.userId ? { id: mockEnvBox.userId, email: null } : null),
}));

jest.mock('../../lib/localReadCache', () => ({
  clearAllReadCache: jest.fn(async () => undefined),
  clearReadCacheMemory: jest.fn(),
  clearUserReadCache: jest.fn(async () => undefined),
}));

jest.mock('../../lib/notifications', () => ({
  scheduleFocusEnd: jest.fn(async () => true),
  cancelFocusEnd: jest.fn(async () => undefined),
  cancelRecoveryReminder: jest.fn(),
  scheduleRecoveryReminder: jest.fn(),
  cancelScheduled: jest.fn(async () => undefined),
  listScheduled: jest.fn(async () => []),
}));

jest.mock('../../lib/haptics', () => ({
  haptic: { success: jest.fn() },
}));

jest.mock('../../lib/analytics', () => ({
  buildEvent: jest.fn((name: string, props: Record<string, unknown>) => ({ name, props })),
  emitEvent: jest.fn(),
}));

jest.mock('../../services/focusService', () => ({
  completeWorkPhase: jest.fn(async () => ({ sessionRecorded: true, taskCompleted: false })),
  recordPartialWorkPhase: jest.fn(async () => ({ recorded: true })),
  addTask: jest.fn(),
  completeTask: jest.fn(),
  listOpenTasks: jest.fn(async () => ({ ok: true, data: [] })),
  removeTask: jest.fn(),
}));

jest.mock('../../repositories/taskRepository', () => {
  const actual = jest.requireActual<typeof import('../../repositories/taskRepository')>(
    '../../repositories/taskRepository',
  );
  return {
    ...actual,
    fetchTaskRow: jest.fn(async (id: string) => {
      const row = mockEnvBox.serverTasks.get(id) ?? null;
      return { ok: true as const, data: row ? { ...row } : null };
    }),
  };
});

jest.mock('../../services/taskService', () => {
  const actual = jest.requireActual<typeof import('../../services/taskService')>('../../services/taskService');
  return {
    ...actual,
    listTasks: jest.fn(async () => ({
      ok: true as const,
      data: {
        rows: [...mockEnvBox.serverTasks.values()].map((r) => ({ ...r })),
        nextCursor: null,
        hasMore: false,
      },
    })),
    deliverTaskCommand: jest.fn(async (cmd: OutboxCommand): Promise<DeliveryOutcome> => {
      mockEnvBox.deliveryCalls.push({
        entityId: cmd.entityId,
        payload: { ...cmd.payload },
        baseVersion: cmd.baseVersion,
      });

      const custom = mockEnvBox.nextOutcomeByTaskId.get(cmd.entityId);
      if (custom) {
        mockEnvBox.nextOutcomeByTaskId.delete(cmd.entityId);
        return typeof custom === 'function' ? custom() : custom;
      }

      if (mockEnvBox.offlineMode) {
        return { kind: 'offline' };
      }

      const serverRow = mockEnvBox.serverTasks.get(cmd.entityId);
      if (!serverRow) {
        return { kind: 'gone' };
      }
      if (cmd.baseVersion !== null && serverRow.updated_at !== cmd.baseVersion) {
        return { kind: 'conflict', error: 'Bu görev başka bir yerde değiştirilmiş.' };
      }

      mockEnvBox.versionSeq += 1;
      const nextVersion = `2026-11-24T12:${String(mockEnvBox.versionSeq).padStart(2, '0')}:00.000Z`;
      const updatedRow: Task = {
        ...serverRow,
        ...(cmd.payload as Partial<Task>),
        updated_at: nextVersion,
      };
      mockEnvBox.serverTasks.set(cmd.entityId, updatedRow);
      return { kind: 'applied', version: nextVersion };
    }),
  };
});

const FIXED_NOON = new Date(2026, 10, 24, 12, 0, 0);
const FIXED_DAY = todayLocal(FIXED_NOON);
const PARENT_TASK: SmallStepParent = {
  kind: 'task',
  id: 'task-parent-1',
  title: 'Vergi belgelerini hazırla',
};

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    user_id: 'user-A',
    title: `Görev ${id}`,
    status: 'pending',
    priority: 'medium',
    list_type: 'this_week',
    due_date: FIXED_DAY,
    time_block_start: '09:00',
    time_block_end: '09:30',
    completed: false,
    completed_at: null,
    created_at: '2026-11-24T08:00:00.000Z',
    updated_at: '2026-11-24T09:00:00.000Z',
    ...overrides,
  };
}

function seedTasks(rows: readonly Task[]): void {
  mockEnvBox.serverTasks.clear();
  for (const row of rows) {
    mockEnvBox.serverTasks.set(row.id, { ...row });
  }
  useTaskStore.setState({
    tasks: rows.map((r) => ({ ...r })),
    tasksLoaded: true,
    error: null,
  });
}

beforeEach(async () => {
  resetAccountMemory('signed_out');
  await AsyncStorage.clear();
  mockEnvBox.userId = 'user-A';
  mockEnvBox.serverTasks.clear();
  mockEnvBox.deliveryCalls = [];
  mockEnvBox.nextOutcomeByTaskId.clear();
  mockEnvBox.offlineMode = false;
  mockEnvBox.versionSeq = 10;
  setTaskOutboxStorage(asyncStorageOutbox);
  useTaskStore.getState().resetForAccount();
  (analytics.emitEvent as jest.Mock).mockClear();
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
    settings: { ...DEFAULT_SETTINGS, autoCheckTasks: true },
    justCompleted: null,
    focusTasks: [],
    selectedTaskId: null,
    loadingTasks: false,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('F3 §6.1.6 (LEAF-04 & LEAF-05) — suggestionId focus idempotency and parent task isolation', () => {
  it('LEAF-04: preserves backward compatibility in smallStart and round-trips suggestionId through snapshots', () => {
    expect(normalizeSuggestionId(undefined)).toBeNull();
    expect(normalizeSuggestionId('   ')).toBeNull();
    expect(normalizeSuggestionId('  sug-42  ')).toBe('sug-42');

    const legacy = validateSmallStep(PARENT_TASK, { title: 'klasörü aç', minutes: 5 });
    expect(legacy).toEqual({
      ok: true,
      step: { title: 'klasörü aç', minutes: 5, parent: PARENT_TASK },
    });

    const withSuggestion = validateSmallStep(PARENT_TASK, {
      title: 'ilk faturayı indir',
      minutes: 5,
      suggestionId: '  sug-leaf-04 ',
    });
    expect(withSuggestion).toEqual({
      ok: true,
      step: {
        title: 'ilk faturayı indir',
        minutes: 5,
        parent: PARENT_TASK,
        suggestionId: 'sug-leaf-04',
      },
    });
    if (!withSuggestion.ok) throw new Error('expected valid step');

    const snap = snapshotOf({
      phase: 'work',
      clock: startClock(300, 1_800_000_000_000),
      sessionStartedAt: '2026-11-24T12:00:00.000Z',
      sessionsCompleted: 0,
      now: 1_800_000_000_000,
      step: withSuggestion.step,
    });
    const parsed = parseSnapshot(JSON.stringify(snap));
    expect(parsed?.step).toEqual(withSuggestion.step);
    expect(isSmallStep({ ...withSuggestion.step, suggestionId: '' })).toBe(false);
  });

  it('LEAF-04: duplicate startSmallStep with the same suggestionId opens one session and emits focus_started once; different suggestionId returns false', () => {
    let fakeNow = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    const first = useFocusStore.getState().startSmallStep(PARENT_TASK, {
      title: 'İlk belgeyi aç',
      minutes: 5,
      suggestionId: 'sug-001',
    });
    expect(first).toBe(true);

    const initialClock = useFocusStore.getState().clock;
    const initialStartedAt = useFocusStore.getState().sessionStartedAt;
    expect(useFocusStore.getState().smallStep?.suggestionId).toBe('sug-001');
    expect(analytics.emitEvent).toHaveBeenCalledTimes(1);

    // Advance 4 seconds and fire duplicate tap with the SAME suggestionId
    fakeNow += 4_000;
    const duplicate = useFocusStore.getState().startSmallStep(PARENT_TASK, {
      title: 'İlk belgeyi aç',
      minutes: 5,
      suggestionId: 'sug-001',
    });
    expect(duplicate).toBe(true);
    expect(useFocusStore.getState().clock).toBe(initialClock);
    expect(useFocusStore.getState().sessionStartedAt).toBe(initialStartedAt);
    expect(analytics.emitEvent).toHaveBeenCalledTimes(1);

    // Pause session -> same suggestionId remains idempotent; different suggestionId is refused
    useFocusStore.getState().pause();
    expect(
      useFocusStore.getState().startSmallStep(PARENT_TASK, {
        title: 'İlk belgeyi aç',
        minutes: 5,
        suggestionId: 'sug-001',
      }),
    ).toBe(true);
    expect(useFocusStore.getState().status).toBe('paused');

    const differentSuggestion = useFocusStore.getState().startSmallStep(PARENT_TASK, {
      title: 'Başka bir adım',
      minutes: 10,
      suggestionId: 'sug-002',
    });
    expect(differentSuggestion).toBe(false);
    expect(useFocusStore.getState().smallStep?.suggestionId).toBe('sug-001');
    expect(useFocusStore.getState().smallStep?.title).toBe('İlk belgeyi aç');
    expect(analytics.emitEvent).toHaveBeenCalledTimes(1);
  });

  it('LEAF-05: starting, resetting early, and completing a 5-minute small step never marks the parent task completed in useTaskStore', async () => {
    let fakeNow = 1_800_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => fakeNow);

    const parentRow = makeTask(PARENT_TASK.id, { title: PARENT_TASK.title, completed: false, status: 'pending' });
    seedTasks([parentRow]);

    // 1) Start 5-minute small step and stop early after 90s via reset()
    expect(
      useFocusStore.getState().startSmallStep(PARENT_TASK, {
        title: 'Dosya adını yaz',
        minutes: 5,
        suggestionId: 'sug-leaf-05-a',
      }),
    ).toBe(true);
    expect(useTaskStore.getState().tasks[0].completed).toBe(false);

    fakeNow += 90_000;
    useFocusStore.getState().reset();
    expect(useFocusStore.getState().status).toBe('idle');
    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      id: PARENT_TASK.id,
      completed: false,
      status: 'pending',
      completed_at: null,
    });

    // 2) Start 5-minute small step and run to full completion via nextPhase()
    expect(
      useFocusStore.getState().startSmallStep(PARENT_TASK, {
        title: 'İlk paragrafı tamamla',
        minutes: 5,
        suggestionId: 'sug-leaf-05-b',
      }),
    ).toBe(true);
    fakeNow += 5 * 60_000;
    await useFocusStore.getState().nextPhase();

    expect(useFocusStore.getState().status).toBe('idle');
    expect(useFocusStore.getState().justCompleted?.taskTitle).toBe('İlk paragrafı tamamla');
    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      id: PARENT_TASK.id,
      completed: false,
      status: 'pending',
      completed_at: null,
    });
    expect(mockEnvBox.deliveryCalls).toHaveLength(0);
  });
});

describe('E03 (REC-03 & REC-04) — dayPlanCommitService batch idempotency, failed-only retry, versioned undo, and guards', () => {
  it('coalesces concurrent commitDayPlan calls with the same operationId into a single execution', async () => {
    const t1 = makeTask('t-lock-1', { updated_at: '2026-11-24T09:00:00.000Z' });
    seedTasks([t1]);

    let releaseDelivery: (() => void) | null = null;
    mockEnvBox.nextOutcomeByTaskId.set('t-lock-1', async () => {
      await new Promise<void>((resolve) => {
        releaseDelivery = resolve;
      });
      const updated: Task = { ...t1, due_date: '2026-11-25', updated_at: '2026-11-24T12:01:00.000Z' };
      mockEnvBox.serverTasks.set('t-lock-1', updated);
      return { kind: 'applied', version: updated.updated_at ?? null };
    });

    const item: PlanMutationItem = {
      itemId: 'item-lock-1',
      entity: 'task',
      targetId: 't-lock-1',
      title: t1.title,
      expectedVersion: '2026-11-24T09:00:00.000Z',
      action: 'postpone_tomorrow',
      taskPatch: { due_date: '2026-11-25' },
    };

    const callA = commitDayPlan(
      { operationId: 'op-double-tap', localDayKey: FIXED_DAY, items: [item] },
      { now: () => FIXED_NOON },
    );
    const callB = commitDayPlan(
      { operationId: 'op-double-tap', localDayKey: FIXED_DAY, items: [item] },
      { now: () => FIXED_NOON },
    );

    expect(isDayPlanCommitInFlight('op-double-tap')).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    const triggerRelease = releaseDelivery as (() => void) | null;
    triggerRelease?.();

    const [resA, resB] = await Promise.all([callA, callB]);
    expect(isDayPlanCommitInFlight('op-double-tap')).toBe(false);
    expect(resA).toEqual(resB);
    expect(resA.overall).toBe('committed');
    expect(mockEnvBox.deliveryCalls).toHaveLength(1);
  });

  it('REC-03: reports partial on 2 successes + 1 transient failure, lists only item-3 in retryableItemIds, and retries ONLY item-3', async () => {
    const t1 = makeTask('t-1', { updated_at: '2026-11-24T09:01:00.000Z' });
    const t2 = makeTask('t-2', { updated_at: '2026-11-24T09:02:00.000Z' });
    const t3 = makeTask('t-3', { updated_at: '2026-11-24T09:03:00.000Z' });
    seedTasks([t1, t2, t3]);

    // Item 3 fails with a transient 503 on first attempt, then succeeds on retry
    mockEnvBox.nextOutcomeByTaskId.set('t-3', {
      kind: 'retryable',
      error: '503 Service Unavailable',
    });

    const items: PlanMutationItem[] = [
      {
        itemId: 'item-1',
        entity: 'task',
        targetId: 't-1',
        title: t1.title,
        expectedVersion: t1.updated_at ?? null,
        action: 'postpone_tomorrow',
        taskPatch: { due_date: '2026-11-25' },
      },
      {
        itemId: 'item-2',
        entity: 'task',
        targetId: 't-2',
        title: t2.title,
        expectedVersion: t2.updated_at ?? null,
        action: 'release_someday',
        taskPatch: { list_type: 'someday', due_date: null },
      },
      {
        itemId: 'item-3',
        entity: 'task',
        targetId: 't-3',
        title: t3.title,
        expectedVersion: t3.updated_at ?? null,
        action: 'update_time_block',
        taskPatch: { time_block_start: '17:00', time_block_end: '17:30' },
      },
    ];

    const firstPass = await commitDayPlan(
      { operationId: 'op-rec-03', localDayKey: FIXED_DAY, items },
      { now: () => FIXED_NOON },
    );

    expect(firstPass.overall).toBe('partial');
    expect(firstPass.retryableItemIds).toEqual(['item-3']);
    expect(firstPass.results.map((r) => ({ id: r.itemId, status: r.status, undoable: r.undoable }))).toEqual([
      { id: 'item-1', status: 'committed', undoable: true },
      { id: 'item-2', status: 'committed', undoable: true },
      { id: 'item-3', status: 'retryable', undoable: false },
    ]);
    expect(mockEnvBox.deliveryCalls.map((c) => c.entityId)).toEqual(['t-1', 't-2', 't-3']);

    // Clear delivery trace and retry ONLY failed items
    mockEnvBox.deliveryCalls = [];
    const retried = await retryFailedDayPlanItems(firstPass, { now: () => FIXED_NOON });

    expect(mockEnvBox.deliveryCalls.map((c) => c.entityId)).toEqual(['t-3']);
    expect(retried.overall).toBe('committed');
    expect(retried.retryableItemIds).toEqual([]);
    expect(retried.results.every((r) => r.status === 'committed' && r.undoable)).toBe(true);
    expect(retried.receipt?.items).toHaveLength(3);
  });

  it('REC-04: flags version conflict on write, reverts untouched applied items on undo, skips post-commit edits on another device, and ignores unapplied items', async () => {
    const tAppliedKeepUndo = makeTask('t-undo-ok', {
      due_date: FIXED_DAY,
      list_type: 'this_week',
      time_block_start: '10:00',
      time_block_end: '10:30',
      updated_at: '2026-11-24T09:00:00.000Z',
    });
    const tModifiedLater = makeTask('t-edited-later', {
      due_date: FIXED_DAY,
      list_type: 'this_week',
      time_block_start: '11:00',
      time_block_end: '11:30',
      updated_at: '2026-11-24T09:05:00.000Z',
    });
    const tConflictedAtWrite = makeTask('t-write-conflict', {
      due_date: FIXED_DAY,
      list_type: 'inbox',
      updated_at: '2026-11-24T09:10:00.000Z',
    });

    seedTasks([tAppliedKeepUndo, tModifiedLater, tConflictedAtWrite]);

    // Simulate another device updating `t-write-conflict` on the server right before commit runs
    mockEnvBox.serverTasks.set('t-write-conflict', {
      ...tConflictedAtWrite,
      title: 'Tablet üzerinde düzenlendi',
      due_date: '2026-11-28',
      updated_at: '2026-11-24T11:55:00.000Z',
    });

    const planItems: PlanMutationItem[] = [
      {
        itemId: 'item-undo-ok',
        entity: 'task',
        targetId: 't-undo-ok',
        title: tAppliedKeepUndo.title,
        expectedVersion: '2026-11-24T09:00:00.000Z',
        action: 'postpone_tomorrow',
        taskPatch: { due_date: '2026-11-25', time_block_start: null, time_block_end: null },
      },
      {
        itemId: 'item-edited-later',
        entity: 'task',
        targetId: 't-edited-later',
        title: tModifiedLater.title,
        expectedVersion: '2026-11-24T09:05:00.000Z',
        action: 'release_someday',
        taskPatch: { list_type: 'someday', due_date: null },
      },
      {
        itemId: 'item-write-conflict',
        entity: 'task',
        targetId: 't-write-conflict',
        title: tConflictedAtWrite.title,
        expectedVersion: '2026-11-24T09:10:00.000Z',
        action: 'postpone_tomorrow',
        taskPatch: { due_date: '2026-11-25' },
      },
    ];

    const commitRes = await commitDayPlan(
      { operationId: 'op-rec-04', localDayKey: FIXED_DAY, items: planItems },
      { now: () => FIXED_NOON },
    );

    expect(commitRes.overall).toBe('partial');
    const conflictItem = commitRes.results.find((r) => r.itemId === 'item-write-conflict');
    expect(conflictItem).toMatchObject({
      status: 'conflict',
      undoable: false,
      appliedAtVersion: null,
      newVersion: '2026-11-24T11:55:00.000Z',
    });
    // Server row for `t-write-conflict` was NOT overwritten by commit
    expect(mockEnvBox.serverTasks.get('t-write-conflict')?.due_date).toBe('2026-11-28');
    expect(commitRes.receipt).not.toBeNull();

    // Now simulate another device editing `t-edited-later` AFTER the plan committed
    const externallyEdited: Task = {
      ...mockEnvBox.serverTasks.get('t-edited-later')!,
      list_type: 'inbox',
      due_date: '2026-11-30',
      updated_at: '2026-11-24T13:45:00.000Z',
    };
    mockEnvBox.serverTasks.set('t-edited-later', externallyEdited);
    useTaskStore.setState((st) => ({
      tasks: st.tasks.map((t) => (t.id === 't-edited-later' ? externallyEdited : t)),
    }));

    const undoRes = await undoDayPlanCommit(commitRes.receipt!, { now: () => FIXED_NOON });

    expect(undoRes.overall).toBe('partial');
    expect(undoRes.undoneItemIds).toEqual(['item-undo-ok']);
    expect(undoRes.skippedConflictIds).toEqual(['item-edited-later']);
    expect(undoRes.skippedUnappliedIds).toEqual(['item-write-conflict']);
    expect(undoRes.failedItemIds).toEqual([]);

    // 1) `t-undo-ok` restored to exact prior snapshot
    expect(mockEnvBox.serverTasks.get('t-undo-ok')).toMatchObject({
      due_date: FIXED_DAY,
      list_type: 'this_week',
      time_block_start: '10:00',
      time_block_end: '10:30',
    });
    // 2) `t-edited-later` NOT clobbered: keeps the other device's `'2026-11-30'` & `'inbox'`
    expect(mockEnvBox.serverTasks.get('t-edited-later')).toMatchObject({
      due_date: '2026-11-30',
      list_type: 'inbox',
      updated_at: '2026-11-24T13:45:00.000Z',
    });
    // 3) `t-write-conflict` untouched
    expect(mockEnvBox.serverTasks.get('t-write-conflict')?.due_date).toBe('2026-11-28');

    // 4) Pre-write local expectedVersion mismatch refuses immediately with overall: 'conflict' and zero deliveries
    mockEnvBox.deliveryCalls = [];
    const preWriteConflict = await commitDayPlan(
      {
        operationId: 'op-prewrite-conflict',
        localDayKey: FIXED_DAY,
        items: [
          {
            itemId: 'item-stale-preview',
            entity: 'task',
            targetId: 't-edited-later',
            title: externallyEdited.title,
            expectedVersion: '2026-11-24T09:05:00.000Z',
            action: 'postpone_tomorrow',
          },
        ],
      },
      { now: () => FIXED_NOON },
    );
    expect(preWriteConflict.overall).toBe('conflict');
    expect(preWriteConflict.receipt).toBeNull();
    expect(preWriteConflict.results[0]).toMatchObject({
      itemId: 'item-stale-preview',
      status: 'conflict',
      newVersion: '2026-11-24T13:45:00.000Z',
      appliedAtVersion: null,
      undoable: false,
    });
    expect(mockEnvBox.deliveryCalls).toHaveLength(0);
  });

  it('§7.1 & E03: reports pending (never committed) when offline, and aborts remaining items on account switch or midnight rollover', async () => {
    // Part A: Honest offline `pending` vs `committed`
    const offlineTask = makeTask('t-offline-1', { updated_at: '2026-11-24T09:00:00.000Z' });
    seedTasks([offlineTask]);
    mockEnvBox.offlineMode = true;

    const offlineCommit = await commitDayPlan(
      {
        operationId: 'op-offline',
        localDayKey: FIXED_DAY,
        items: [
          {
            itemId: 'item-offline-1',
            entity: 'task',
            targetId: 't-offline-1',
            title: offlineTask.title,
            expectedVersion: offlineTask.updated_at ?? null,
            action: 'postpone_tomorrow',
            taskPatch: { due_date: '2026-11-25' },
          },
        ],
      },
      { now: () => FIXED_NOON },
    );

    expect(useTaskStore.getState().sync.pending).toBeGreaterThan(0);
    expect(offlineCommit.overall).toBe('pending');
    expect(offlineCommit.results[0]).toMatchObject({
      itemId: 'item-offline-1',
      status: 'pending',
      undoable: true,
    });

    // Part B: Account switch (`resetAccountMemory('user_changed')`) mid-batch aborts remaining items
    mockEnvBox.offlineMode = false;
    resetAccountMemory('user_changed');
    mockEnvBox.userId = 'user-A';
    const ta = makeTask('t-acc-1');
    const tb = makeTask('t-acc-2');
    seedTasks([ta, tb]);

    const executedIds: string[] = [];
    const accountAbortRes = await commitDayPlan(
      {
        operationId: 'op-account-switch',
        localDayKey: FIXED_DAY,
        items: [
          {
            itemId: 'item-acc-1',
            entity: 'task',
            targetId: 't-acc-1',
            title: ta.title,
            expectedVersion: ta.updated_at ?? null,
            action: 'postpone_tomorrow',
          },
          {
            itemId: 'item-acc-2',
            entity: 'task',
            targetId: 't-acc-2',
            title: tb.title,
            expectedVersion: tb.updated_at ?? null,
            action: 'postpone_tomorrow',
          },
        ],
      },
      {
        now: () => FIXED_NOON,
        executeItem: async (item) => {
          executedIds.push(item.itemId);
          // Switch account during item-1 before item-2 can start
          mockEnvBox.userId = 'user-B';
          resetAccountMemory('user_changed');
          return {
            result: {
              itemId: item.itemId,
              entity: item.entity,
              targetId: item.targetId,
              status: 'committed',
              newVersion: '2026-11-24T12:05:00.000Z',
              appliedAtVersion: item.expectedVersion,
              undoable: true,
            },
          };
        },
      },
    );

    expect(executedIds).toEqual(['item-acc-1']);
    expect(accountAbortRes.overall).toBe('aborted');
    expect(accountAbortRes.receipt).toBeNull();

    // Part C: Midnight rollover mid-batch stops remaining items (`overall: 'aborted'`)
    mockEnvBox.userId = 'user-A';
    let currentClock = new Date(2026, 10, 24, 23, 59, 50);
    const midnightExecuted: string[] = [];
    const midnightRes = await commitDayPlan(
      {
        operationId: 'op-midnight-rollover',
        localDayKey: FIXED_DAY,
        items: [
          {
            itemId: 'item-mid-1',
            entity: 'task',
            targetId: 't-acc-1',
            title: ta.title,
            expectedVersion: null,
            action: 'postpone_tomorrow',
          },
          {
            itemId: 'item-mid-2',
            entity: 'task',
            targetId: 't-acc-2',
            title: tb.title,
            expectedVersion: null,
            action: 'postpone_tomorrow',
          },
        ],
      },
      {
        now: () => currentClock,
        executeItem: async (item) => {
          midnightExecuted.push(item.itemId);
          // Clock crosses midnight into 2026-11-25 before item-2 starts
          currentClock = new Date(2026, 10, 25, 0, 0, 5);
          return {
            result: {
              itemId: item.itemId,
              entity: item.entity,
              targetId: item.targetId,
              status: 'committed',
              newVersion: '2026-11-24T23:59:55.000Z',
              appliedAtVersion: null,
              undoable: true,
            },
          };
        },
      },
    );

    expect(midnightExecuted).toEqual(['item-mid-1']);
    expect(midnightRes.overall).toBe('aborted');
    expect(midnightRes.results).toHaveLength(1);
    expect(midnightRes.retryableItemIds).toEqual([]);
  });
});
