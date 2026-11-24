/**
 * E05 + E06 + Y11 — Outbox resilience probe (150-command queue, p50/p95 latency, crash recovery,
 * low-disk / quarantine visibility), unified sync outcome contract + field diffing, and
 * two-account (`user-A` / `user-B`) zero-leakage + backup dry-run / partial-collection visibility.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { accountEpoch, endAccountScope } from '../../lib/accountScope';
import { BACKUP_FORMAT_VERSION, buildManifest, verifyBackupText } from '../../lib/backupFormat';
import { emptyOutbox, type OutboxState } from '../../lib/outbox';
import { percentile, runOutboxResilienceProbe } from '../../lib/outboxBench';
import { asyncStorageOutbox, outboxKey, type OutboxStorage } from '../../lib/outboxStorage';
import { planNotices, planRestore, planSummary } from '../../lib/restorePlan';
import {
  classifyRepoFailure,
  diffConflictingRecord,
  guardAccountResponse,
  mapCommandToSyncOutcome,
  mapSettleToSyncOutcome,
} from '../../lib/syncOutcomes';
import type { Task } from '../../lib/taskTypes';
import { isBackupComplete } from '../../services/exportService';
import {
  describeFlushOutcome,
  mapSummaryToSyncOutcome,
  type UnifiedOutboxSummary,
} from '../../services/unifiedOutbox';

type TaskPageResponse = { ok: true; data: { rows: Task[]; nextCursor: null; hasMore: boolean } };

const mockAsyncBacking = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockAsyncBacking.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockAsyncBacking.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockAsyncBacking.delete(k);
    }),
    multiRemove: jest.fn(async (ks: readonly string[]) => {
      for (const k of ks) mockAsyncBacking.delete(k);
    }),
    multiGet: jest.fn(async (ks: readonly string[]) => ks.map((k) => [k, mockAsyncBacking.get(k) ?? null])),
    getAllKeys: jest.fn(async () => [...mockAsyncBacking.keys()]),
    clear: jest.fn(async () => {
      mockAsyncBacking.clear();
    }),
  },
}));

const mockSessionBox = {
  userId: 'user-A' as string | null,
  onDeferredFetch: null as ((resolve: (res: TaskPageResponse) => void) => void) | null,
  serverTasksByUser: {
    'user-A': [] as Task[],
    'user-B': [] as Task[],
  } as Record<string, Task[]>,
  offlineDeliveries: true,
};

jest.mock('../../lib/session', () => ({
  currentUser: async () => (mockSessionBox.userId ? { id: mockSessionBox.userId } : null),
}));

jest.mock('../../lib/localReadCache', () => ({
  clearAllReadCache: jest.fn(async () => undefined),
  clearReadCacheMemory: jest.fn(),
  clearUserReadCache: jest.fn(async () => undefined),
}));

jest.mock('../../lib/notifications', () => ({
  cancelScheduled: jest.fn(async () => undefined),
  listScheduled: jest.fn(async () => []),
}));

jest.mock('../../services/taskService', () => {
  const actual = jest.requireActual<typeof import('../../services/taskService')>('../../services/taskService');
  return {
    ...actual,
    listTasks: jest.fn(async () => {
      if (mockSessionBox.onDeferredFetch) {
        const handler = mockSessionBox.onDeferredFetch;
        return new Promise<TaskPageResponse>((resolve) => {
          handler(resolve);
        });
      }
      const uid = mockSessionBox.userId ?? '';
      return {
        ok: true as const,
        data: {
          rows: [...(mockSessionBox.serverTasksByUser[uid] ?? [])],
          nextCursor: null,
          hasMore: false,
        },
      };
    }),
    deliverTaskCommand: jest.fn(async () => {
      if (mockSessionBox.offlineDeliveries) return { kind: 'offline' as const };
      return { kind: 'applied' as const, version: '2026-11-24T12:00:00.000Z' };
    }),
  };
});

import { setTaskOutboxStorage, useTaskStore } from '../../store/taskStore';

function makeSummary(overrides: Partial<UnifiedOutboxSummary> = {}): UnifiedOutboxSummary {
  const empty = { pending: 0, dead: 0, conflict: 0, authBlocked: false };
  return {
    ...empty,
    channels: {
      habitLogs: { pending: 0, dead: 0 },
      tasks: { ...empty },
      core: { ...empty },
      effects: { ...empty },
    },
    ...overrides,
  };
}

beforeEach(() => {
  mockAsyncBacking.clear();
  mockSessionBox.userId = 'user-A';
  mockSessionBox.onDeferredFetch = null;
  mockSessionBox.serverTasksByUser = { 'user-A': [], 'user-B': [] };
  mockSessionBox.offlineDeliveries = true;
  setTaskOutboxStorage(asyncStorageOutbox);
  useTaskStore.getState().resetForAccount();
});

describe('E05 — 150-command outbox resilience, p50/p95 latency, crash recovery, and low-disk visibility', () => {
  it('proves zero data loss, zero duplicates, crash recovery, quarantine safety, and latency metrics across 150 commands', async () => {
    let fakeTick = 0;
    const report = await runOutboxResilienceProbe({
      queueSize: 150,
      iterations: 12,
      userA: 'user-A',
      userB: 'user-B',
      clock: () => {
        fakeTick += 1.5;
        return fakeTick;
      },
    });

    expect(report.allPassed).toBe(true);
    expect(report.largeQueue).toEqual({
      enqueuedCount: 150,
      deliveredUniqueCount: 150,
      lostCount: 0,
      duplicateDeliveryCount: 0,
      dedupedRepeatEnqueue: true,
      remainingPending: 0,
    });

    expect(report.latencyMs.coldReadMs).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(report.latencyMs.writeP50Ms)).toBe(true);
    expect(Number.isFinite(report.latencyMs.writeP95Ms)).toBe(true);
    expect(report.latencyMs.writeP50Ms).toBeLessThanOrEqual(report.latencyMs.writeP95Ms);
    expect(report.latencyMs.readP50Ms).toBeLessThanOrEqual(report.latencyMs.readP95Ms);

    expect(report.crashRecovery).toEqual({
      inFlightBeforeCrash: 1,
      sendingAfterBoot: 0,
      readyAfterBoot: 150,
      lostAfterCrash: 0,
    });

    expect(report.lowDiskAndQuarantine).toEqual({
      writeFailureSurfacedAsUnsaved: true,
      inMemoryPreservedOnWriteFailure: true,
      corruptBlobQuarantined: true,
      corruptOverwriteRefusedWhenDiskFull: true,
    });

    expect(report.accountIsolation).toEqual({
      userACommandsOnDisk: 150,
      leakedToUserBCount: 0,
      foreignBlobRejected: true,
      crossAccountEnqueueRejected: true,
      userARetainedAfterSwitchBack: 150,
    });
  });

  it('computes exact p50 and p95 percentiles including empty and boundary inputs', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([10, 2, 8, 4, 6, 12, 14, 16, 18, 20], 50)).toBe(10);
    expect(percentile([10, 2, 8, 4, 6, 12, 14, 16, 18, 20], 95)).toBe(20);
    expect(percentile([5, 1, 9], 0)).toBe(1);
    expect(percentile([5, 1, 9], 100)).toBe(9);
  });

  it('surfaces low-disk storage refusal on useTaskStore without losing the in-memory optimistic task', async () => {
    const quotaFailingStorage: OutboxStorage = {
      async load(uid: string): Promise<OutboxState> {
        return emptyOutbox(uid);
      },
      async save(): Promise<void> {
        throw new Error('QuotaExceededError');
      },
    };
    setTaskOutboxStorage(quotaFailingStorage);

    const added = await useTaskStore.getState().addTask({
      title: 'Keep me visible even when disk is full',
      estimated_minutes: 15,
      estimate_source: 'user',
    });

    expect(added).not.toBeNull();
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(useTaskStore.getState().tasks[0].estimated_minutes).toBe(15);
    // Store surfaces an explicit device-save warning instead of silent success
    expect(typeof useTaskStore.getState().error).toBe('string');
    expect((useTaskStore.getState().error ?? '').length).toBeGreaterThan(0);
  });
});

describe('E06 — sync outcome contract, failure classification, conflict diffing, and late-response guard', () => {
  it('separates pending, committed, conflict, retryable, and permanent outcomes consistently', () => {
    expect(mapSummaryToSyncOutcome(makeSummary())).toBe('committed');
    expect(mapSummaryToSyncOutcome(makeSummary({ pending: 3 }))).toBe('pending');
    expect(mapSummaryToSyncOutcome(makeSummary({ pending: 2, authBlocked: true }))).toBe('retryable');
    expect(mapSummaryToSyncOutcome(makeSummary({ errors: { tasks: 'timeout' } }))).toBe('retryable');
    expect(mapSummaryToSyncOutcome(makeSummary({ pending: 1, dead: 1 }))).toBe('permanent');
    expect(mapSummaryToSyncOutcome(makeSummary({ pending: 2, dead: 1, conflict: 1 }))).toBe('conflict');

    // Describe-outcome parity
    expect(describeFlushOutcome(makeSummary()).tone).toBe('success');
    expect(describeFlushOutcome(makeSummary({ pending: 1 })).tone).toBe('waiting');
    expect(describeFlushOutcome(makeSummary({ conflict: 1 })).tone).toBe('attention');
    expect(describeFlushOutcome(makeSummary({ authBlocked: true })).tone).toBe('auth');

    // Per-command and per-settle mappings
    expect(mapCommandToSyncOutcome(null)).toBe('committed');
    expect(mapCommandToSyncOutcome({ status: 'pending' })).toBe('pending');
    expect(mapCommandToSyncOutcome({ status: 'pending', retryableCount: 2 })).toBe('retryable');
    expect(mapCommandToSyncOutcome({ status: 'pending' }, { authBlocked: true })).toBe('retryable');
    expect(mapCommandToSyncOutcome({ status: 'conflict' })).toBe('conflict');
    expect(mapCommandToSyncOutcome({ status: 'dead' })).toBe('permanent');

    expect(mapSettleToSyncOutcome('applied')).toBe('committed');
    expect(mapSettleToSyncOutcome('gone')).toBe('committed');
    expect(mapSettleToSyncOutcome('offline')).toBe('pending');
    expect(mapSettleToSyncOutcome('retryable')).toBe('retryable');
    expect(mapSettleToSyncOutcome('auth')).toBe('retryable');
    expect(mapSettleToSyncOutcome('rejected')).toBe('retryable');
    expect(mapSettleToSyncOutcome('conflict')).toBe('conflict');
    expect(mapSettleToSyncOutcome('dead')).toBe('permanent');
  });

  it('strictly distinguishes network loss, missing DB schema, not_found/gone, auth, validation, and conflict', () => {
    expect(
      classifyRepoFailure({ ok: false, offline: true, status: 0, error: 'TypeError: Network request failed' }),
    ).toEqual({
      status: 'retryable',
      category: 'network',
      reason: 'TypeError: Network request failed',
    });

    expect(
      classifyRepoFailure({
        ok: false,
        status: 400,
        code: '42703',
        error: 'column tasks.estimated_minutes does not exist',
      }),
    ).toEqual({
      status: 'permanent',
      category: 'missing_schema',
      reason: 'column tasks.estimated_minutes does not exist',
    });

    expect(
      classifyRepoFailure({
        ok: false,
        status: 400,
        code: 'PGRST204',
        error: "Could not find the 'estimate_source' column of 'tasks' in the schema cache",
      }),
    ).toMatchObject({
      status: 'permanent',
      category: 'missing_schema',
    });

    expect(
      classifyRepoFailure({ ok: false, status: 404, code: 'PGRST116', error: 'Row not found' }),
    ).toEqual({
      status: 'permanent',
      category: 'not_found',
      reason: 'Row not found',
    });

    expect(
      classifyRepoFailure({ ok: false, status: 401, code: 'PGRST301', error: 'JWT expired' }),
    ).toMatchObject({
      status: 'retryable',
      category: 'auth',
    });

    expect(
      classifyRepoFailure({ ok: false, status: 403, code: '42501', error: 'RLS policy violation' }),
    ).toMatchObject({
      status: 'permanent',
      category: 'auth',
    });

    expect(
      classifyRepoFailure({ ok: false, status: 409, code: '23505', error: 'duplicate key value' }),
    ).toMatchObject({
      status: 'conflict',
      category: 'conflict',
    });

    expect(
      classifyRepoFailure({ ok: false, status: 400, code: '23514', error: 'check constraint violated' }),
    ).toMatchObject({
      status: 'permanent',
      category: 'validation',
    });

    expect(
      classifyRepoFailure({ ok: false, status: 503, error: 'Service Unavailable' }),
    ).toMatchObject({
      status: 'retryable',
      category: 'server',
    });
  });

  it('diffs local user intent against server row per field while ignoring volatile metadata and equivalent instants', () => {
    const diffs = diffConflictingRecord(
      {
        title: 'Local draft',
        estimated_minutes: 45,
        estimate_source: 'user',
        priority: 'high',
        time_block_start: '2026-11-24T09:00:00.000Z',
        updated_at: '2026-11-24T09:05:00.000Z',
      },
      {
        id: 'task-1',
        user_id: 'user-A',
        title: 'Server edit on tablet',
        estimated_minutes: 20,
        estimate_source: 'ai',
        priority: 'high',
        time_block_start: '2026-11-24T09:00:00+00:00',
        updated_at: '2026-11-24T09:10:00.000Z',
      },
    );

    expect(diffs).toEqual([
      { field: 'title', localValue: 'Local draft', serverValue: 'Server edit on tablet' },
      { field: 'estimated_minutes', localValue: 45, serverValue: 20 },
      { field: 'estimate_source', localValue: 'user', serverValue: 'ai' },
    ]);

    // Clearing duration (null) vs server holding 25 surfaces as a diff
    expect(
      diffConflictingRecord({ estimated_minutes: null }, { id: 'task-1', estimated_minutes: 25 }),
    ).toEqual([{ field: 'estimated_minutes', localValue: null, serverValue: 25 }]);
  });

  it('drops Account A late async response after switching to Account B', async () => {
    const startEpoch = accountEpoch();

    // Begin a slow in-flight fetch for user-A
    let releaseSlowFetchOfA: ((res: TaskPageResponse) => void) | null = null;
    mockSessionBox.onDeferredFetch = (resolve) => {
      releaseSlowFetchOfA = resolve;
    };

    const pendingFetchOfA = useTaskStore.getState().fetchTasks();
    await new Promise((r) => setTimeout(r, 0));

    // Switch from user-A -> user-B before user-A's response arrives
    mockSessionBox.onDeferredFetch = null;
    mockSessionBox.userId = 'user-B';
    await endAccountScope('user_changed', 'user-A');
    expect(accountEpoch()).toBeGreaterThan(startEpoch);

    // Pure epoch guard rejects late callback from user-A
    const guarded = guardAccountResponse({
      capturedEpoch: startEpoch,
      currentEpoch: accountEpoch(),
      capturedUserId: 'user-A',
      activeUserId: mockSessionBox.userId,
      apply: () => 'mutated-B',
    });
    expect(guarded).toEqual({ applied: false, reason: 'epoch_changed' });

    // Now release user-A's delayed network response containing user-A's private task
    const lateTaskOfA: Task = {
      id: 'secret-a-task',
      user_id: 'user-A',
      title: 'Private to user-A',
      status: 'pending',
      priority: 'high',
      list_type: 'inbox',
      estimated_minutes: 30,
      estimate_source: 'user',
      completed: false,
      created_at: '2026-11-24T08:00:00.000Z',
    };
    const releaseFn = releaseSlowFetchOfA as ((res: TaskPageResponse) => void) | null;
    releaseFn?.({
      ok: true,
      data: { rows: [lateTaskOfA], nextCursor: null, hasMore: false },
    });
    await pendingFetchOfA;

    // Account B's store NEVER receives Account A's late task
    expect(useTaskStore.getState().tasks.some((t) => t.user_id === 'user-A')).toBe(false);
    expect(useTaskStore.getState().tasks).toEqual([]);
  });
});

describe('Y11 — two-account sign-out & deletion zero-leakage and backup dry-run visibility', () => {
  it('isolates user-A and user-B across sign-out and wipes user-A outbox on account deletion', async () => {
    // 1. user-A creates two offline tasks with estimated_minutes
    mockSessionBox.userId = 'user-A';
    const taskA1 = await useTaskStore.getState().addTask({
      title: 'User-A confidential task',
      estimated_minutes: 25,
      estimate_source: 'user',
    });
    expect(taskA1).not.toBeNull();
    expect(useTaskStore.getState().tasks).toHaveLength(1);
    expect(await AsyncStorage.getItem(outboxKey('user-A'))).not.toBeNull();

    // 2. user-A signs out, user-B signs in on the same device
    await endAccountScope('signed_out', 'user-A');
    mockSessionBox.userId = 'user-B';
    await useTaskStore.getState().fetchTasks();

    expect(useTaskStore.getState().tasks).toEqual([]);
    const outboxOfB = await asyncStorageOutbox.load('user-B');
    expect(outboxOfB.commands).toEqual([]);
    // On sign-out (not deletion), user-A's unsent work remains safely under user-A's own key
    expect((await asyncStorageOutbox.load('user-A')).commands).toHaveLength(1);

    // 3. user-A deletes account -> outbox.v1.user-A and user-scoped keys are removed; device theme stays
    await AsyncStorage.setItem('app_theme_dark', '1');
    await endAccountScope('account_deleted', 'user-A');

    expect(await AsyncStorage.getItem(outboxKey('user-A'))).toBeNull();
    expect(await AsyncStorage.getItem('app_theme_dark')).toBe('1');

    // user-B opening the same device afterwards sees zero data from deleted user-A
    mockSessionBox.userId = 'user-B';
    await useTaskStore.getState().fetchTasks();
    expect(useTaskStore.getState().tasks).toEqual([]);
    expect((await asyncStorageOutbox.load('user-B')).commands).toEqual([]);
    expect((await asyncStorageOutbox.load('user-A')).commands).toEqual([]);
  });

  it('enforces backup ownership, flags incomplete/truncated exports, and reports dry-run collections clearly', () => {
    const collectionsOfB = {
      projects: [{ id: 'proj-1', user_id: 'user-B', name: 'Thesis' }],
      tasks: [
        {
          id: 'task-ok',
          user_id: 'user-B',
          title: 'Write outline',
          project_id: 'proj-1',
          estimated_minutes: 40,
          estimate_source: 'user',
          updated_at: '2026-11-24T10:00:00.000Z',
        },
        {
          id: 'task-orphan',
          user_id: 'user-B',
          title: 'Missing project ref',
          project_id: 'proj-missing',
          estimated_minutes: 15,
        },
      ],
      habits: [{ id: 'hab-1', user_id: 'user-B', name: 'Water', status: 'active', xp: 120, tier: 'pro' }],
      habit_logs: [{ id: 'log-1', user_id: 'user-B', habit_id: 'hab-1', completed_at: '2026-11-24', xp: 10 }],
      webhooks: [{ id: 'wh-1', user_id: 'user-B', url: 'https://example.com/hook' }],
    };

    const manifestOfB = buildManifest('user-B', '2026-11-24T12:00:00.000Z', collectionsOfB);
    const validText = JSON.stringify({
      format_version: BACKUP_FORMAT_VERSION,
      truncated: [],
      failed: [],
      manifest: manifestOfB,
      ...collectionsOfB,
    });

    // Cross-account restore is refused: user-A cannot import user-B's backup
    const wrongUserCheck = verifyBackupText(validText, 'user-A');
    expect(wrongUserCheck.ok).toBe(false);

    // Truncated or failed collection visibility: never counted as complete or silently restored
    expect(isBackupComplete({ truncated: [], failed: [] })).toBe(true);
    expect(isBackupComplete({ truncated: ['tasks'], failed: [] })).toBe(false);
    expect(isBackupComplete({ truncated: [], failed: [{ collection: 'notes', error: 'timeout' }] })).toBe(false);

    const truncatedText = JSON.stringify({
      format_version: BACKUP_FORMAT_VERSION,
      truncated: ['tasks'],
      manifest: manifestOfB,
      ...collectionsOfB,
    });
    expect(verifyBackupText(truncatedText, 'user-B').ok).toBe(false);

    // Dry-run for user-B preserves task duration, flags orphans, strips authority fields, and surfaces non-restorable collections
    const verified = verifyBackupText(validText, 'user-B');
    expect(verified.ok).toBe(true);
    if (!verified.ok) return;

    const dryRun = planRestore({
      userId: 'user-B',
      file: verified.collections,
      existing: {},
    });

    const tasksPlan = dryRun.collections.find((c) => c.name === 'tasks')!;
    expect(tasksPlan.insert).toHaveLength(1);
    expect(tasksPlan.insert[0]).toMatchObject({
      id: 'task-ok',
      estimated_minutes: 40,
      estimate_source: 'user',
    });
    expect(tasksPlan.orphans).toEqual(['task-orphan']);

    const habitsPlan = dryRun.collections.find((c) => c.name === 'habits')!;
    expect(habitsPlan.stripped.sort()).toEqual(['tier', 'xp']);
    expect(habitsPlan.insert[0]).not.toHaveProperty('xp');

    const notices = planNotices(dryRun);
    expect(notices.some((n) => n.startsWith('habit_logs: 1'))).toBe(true);
    expect(notices.some((n) => n.startsWith('webhooks: 1'))).toBe(true);

    const summaryLines = planSummary(dryRun);
    expect(summaryLines.some((l) => l.startsWith('tasks:'))).toBe(true);
    expect(summaryLines.some((l) => l.startsWith('habit_logs:'))).toBe(true);
  });
});
