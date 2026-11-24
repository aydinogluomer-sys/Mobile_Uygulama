/**
 * E03 (F4 — REC-03, REC-04, REC-05) — Version-checked batch commit, failed-only retry,
 * and receipt-verified undo for Light Day ("Hafif Gün") and Day Replan ("Günü Toparla").
 *
 * Guarantees:
 * - Single in-flight promise per `operationId` (`inFlightOperations`) so double taps never write twice.
 * - Account epoch / `userId` and local calendar day (`localDayKey`) verified before start and at each step;
 *   account switches or midnight rollovers abort remaining mutations (`overall: 'aborted'`).
 * - Task mutations verify `expectedVersion` before writing and honour server CAS conflicts (`status: 'conflict'`).
 * - Offline outbox writes report `'pending'` honestly (§7.1), never `'committed'`.
 * - `retryFailedDayPlanItems` re-runs only failed items, leaving already applied items untouched (`REC-03`).
 * - `undoDayPlanCommit` reverts only `undoable: true` items whose current version still matches the receipt's
 *   `newVersion` / `appliedAtVersion`, reporting post-commit edits in `skippedConflictIds` (`REC-04`).
 */
import { accountEpoch, registerAccountScoped } from '../lib/accountScope';
import { addDaysLocal, parseLocalDate, todayLocal, ymd } from '../lib/date';
import { buildDayBoundarySnapshot } from '../lib/dayBoundaryContract';
import { newOperationId } from '../lib/outbox';
import { habitLogEntityId, outboxEngine, type SettleReport } from '../lib/outboxEngine';
import { currentUser } from '../lib/session';
import type { HabitLog, RecoveryPlan } from '../lib/supabase';
import {
  classifyRepoFailure,
  guardAccountResponse,
  mapCommandToSyncOutcome,
  type SyncOutcomeStatus,
} from '../lib/syncOutcomes';
import type { Task } from '../lib/taskTypes';
import { deleteOwnedIfPresent } from '../repositories/shared';
import { fetchTaskRow } from '../repositories/taskRepository';
import { useLogStore } from '../store/logStore';
import { useRecoveryStore } from '../store/recoveryStore';
import { useTaskStore } from '../store/taskStore';
import { coreOutbox } from './coreOutbox';
import { RECOVERY_PLAN_ENTITY } from './recoveryService';

export type PlanMutationItem = {
  itemId: string;
  entity: 'task' | 'habit' | 'recovery_plan';
  targetId: string;
  title: string;
  expectedVersion: string | null;
  action: 'postpone_tomorrow' | 'release_someday' | 'update_time_block' | 'skip_today' | 'do_not_recover';
  taskPatch?: {
    due_date?: string | null;
    list_type?: 'inbox' | 'this_week' | 'someday';
    time_block_start?: string | null;
    time_block_end?: string | null;
  };
  priorTaskSnapshot?: {
    due_date: string | null;
    list_type: 'inbox' | 'this_week' | 'someday';
    time_block_start: string | null;
    time_block_end: string | null;
  };
  priorHabitLogState?: 'done' | 'partial' | 'skip' | 'miss' | null;
  note?: string;
};

export type PlanItemCommitResult = {
  itemId: string;
  entity: PlanMutationItem['entity'];
  targetId: string;
  status: SyncOutcomeStatus;
  newVersion: string | null;
  appliedAtVersion: string | null;
  error?: string;
  undoable: boolean;
};

export type DayPlanCommitReceipt = {
  operationId: string;
  userId: string;
  localDayKey: string;
  committedAtIso: string;
  items: (PlanItemCommitResult & { mutation: PlanMutationItem })[];
};

export type DayPlanCommitResult = {
  operationId: string;
  localDayKey: string;
  overall: 'committed' | 'pending' | 'partial' | 'conflict' | 'aborted';
  results: PlanItemCommitResult[];
  retryableItemIds: string[];
  receipt: DayPlanCommitReceipt | null;
};

export type CommitDayPlanInput = {
  operationId?: string;
  localDayKey: string;
  items: readonly PlanMutationItem[];
  ianaZone?: string | null;
};

export type DayPlanItemUndoOutcome =
  | 'undone'
  | 'pending'
  | 'conflict_skipped'
  | 'not_applied'
  | 'failed';

export type DayPlanItemUndoResult = {
  itemId: string;
  entity: PlanMutationItem['entity'];
  targetId: string;
  outcome: DayPlanItemUndoOutcome;
  status: SyncOutcomeStatus | 'skipped';
  error?: string;
};

export type DayPlanUndoResult = {
  operationId: string;
  overall: 'undone' | 'pending' | 'partial' | 'conflict' | 'noop' | 'aborted';
  undoneItemIds: string[];
  skippedConflictIds: string[];
  skippedUnappliedIds: string[];
  failedItemIds: string[];
  results: DayPlanItemUndoResult[];
};

export type DayPlanExecutionContext = {
  userId: string;
  localDayKey: string;
  now: Date;
};

export type DayPlanCommitDeps = {
  now?: () => Date;
  resolveUserId?: () => Promise<string | null>;
  resolveLocalDayKey?: (now: Date, ianaZone?: string | null) => string;
  executeItem?: (
    item: PlanMutationItem,
    ctx: DayPlanExecutionContext,
  ) => Promise<{ result: PlanItemCommitResult; enrichedMutation?: PlanMutationItem }>;
  undoItem?: (
    entry: PlanItemCommitResult & { mutation: PlanMutationItem },
    ctx: DayPlanExecutionContext,
  ) => Promise<DayPlanItemUndoResult>;
};

export type RetryFailedDayPlanOptions = DayPlanCommitDeps & {
  operationId?: string;
  localDayKey?: string;
  ianaZone?: string | null;
  items?: readonly PlanMutationItem[];
  includeConflicts?: boolean;
};

const MAX_REMEMBERED_OPERATIONS = 100;

const inFlightOperations = new Map<string, Promise<DayPlanCommitResult>>();
const inFlightUndos = new Map<string, Promise<DayPlanUndoResult>>();
const completedOperations = new Map<string, { userId: string; result: DayPlanCommitResult }>();
const operationMutations = new Map<string, Map<string, PlanMutationItem>>();
const capturedRecoverySnapshots = new Map<string, RecoveryPlan>();

function resetDayPlanCommitState(): void {
  inFlightOperations.clear();
  inFlightUndos.clear();
  completedOperations.clear();
  operationMutations.clear();
  capturedRecoverySnapshots.clear();
}

export function isDayPlanCommitInFlight(operationId: string): boolean {
  return inFlightOperations.has(operationId);
}

function rememberCompleted(userId: string, opId: string, result: DayPlanCommitResult): void {
  if (result.overall !== 'committed' && result.overall !== 'pending') {
    completedOperations.delete(opId);
    return;
  }
  completedOperations.set(opId, { userId, result });
  if (completedOperations.size > MAX_REMEMBERED_OPERATIONS) {
    const oldest = completedOperations.keys().next().value;
    if (oldest !== undefined) completedOperations.delete(oldest);
  }
}

function rememberMutations(opId: string, items: readonly PlanMutationItem[]): void {
  const byId = operationMutations.get(opId) ?? new Map<string, PlanMutationItem>();
  for (const item of items) {
    byId.set(item.itemId, item);
  }
  operationMutations.set(opId, byId);
  if (operationMutations.size > MAX_REMEMBERED_OPERATIONS) {
    const oldest = operationMutations.keys().next().value;
    if (oldest !== undefined) operationMutations.delete(oldest);
  }
}

function defaultResolveLocalDayKey(now: Date, ianaZone?: string | null): string {
  if (ianaZone) {
    return buildDayBoundarySnapshot(now, ianaZone).localDayKey;
  }
  return todayLocal(now);
}

async function defaultResolveUserId(): Promise<string | null> {
  return (await currentUser())?.id ?? null;
}

function versionsEqual(a: string | null, b: string | null): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (/^\d{4}-\d{2}-\d{2}T/.test(a) && /^\d{4}-\d{2}-\d{2}T/.test(b)) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta === tb;
  }
  return false;
}

function buildTaskPatchForItem(item: PlanMutationItem, localDayKey: string): Partial<Task> {
  const baseDate = parseLocalDate(localDayKey);
  const tomorrow = baseDate ? ymd(addDaysLocal(baseDate, 1)) : localDayKey;

  if (item.taskPatch) {
    const out: Partial<Task> = {};
    if (item.taskPatch.due_date !== undefined) out.due_date = item.taskPatch.due_date;
    if (item.taskPatch.list_type !== undefined) out.list_type = item.taskPatch.list_type;
    if (item.taskPatch.time_block_start !== undefined) out.time_block_start = item.taskPatch.time_block_start;
    if (item.taskPatch.time_block_end !== undefined) out.time_block_end = item.taskPatch.time_block_end;
    if (item.action === 'postpone_tomorrow' && out.due_date === undefined) {
      out.due_date = tomorrow;
    }
    if (item.action === 'release_someday' && out.list_type === undefined) {
      out.list_type = 'someday';
    }
    return out;
  }

  if (item.action === 'postpone_tomorrow') {
    return { due_date: tomorrow, time_block_start: null, time_block_end: null };
  }
  if (item.action === 'release_someday') {
    return { list_type: 'someday', due_date: null, time_block_start: null, time_block_end: null };
  }
  return {};
}

function snapshotOfTask(task: Task): NonNullable<PlanMutationItem['priorTaskSnapshot']> {
  return {
    due_date: task.due_date ?? null,
    list_type: task.list_type,
    time_block_start: task.time_block_start ?? null,
    time_block_end: task.time_block_end ?? null,
  };
}

async function resolveCurrentTask(targetId: string): Promise<
  | { ok: true; task: Task; fromStore: boolean }
  | { ok: false; status: SyncOutcomeStatus; error: string }
> {
  const inStore = useTaskStore.getState().tasks.find((t) => t.id === targetId);
  if (inStore) {
    return { ok: true, task: inStore, fromStore: true };
  }
  const fetched = await fetchTaskRow(targetId);
  if (!fetched.ok) {
    const classified = classifyRepoFailure(fetched);
    return { ok: false, status: classified.status, error: classified.reason };
  }
  if (!fetched.data) {
    return { ok: false, status: 'permanent', error: 'Görev bulunamadı.' };
  }
  return { ok: true, task: fetched.data, fromStore: false };
}

async function discardTaskOutboxCmd(operationId: string | undefined, rollbackTask: Task): Promise<void> {
  if (operationId) {
    await outboxEngine.channel('task')?.discard(operationId);
  }
  useTaskStore.setState((st) => ({
    tasks: st.tasks.map((t) => (t.id === rollbackTask.id ? rollbackTask : t)),
  }));
}

async function executeTaskMutation(
  item: PlanMutationItem,
  ctx: DayPlanExecutionContext,
): Promise<{ result: PlanItemCommitResult; enrichedMutation: PlanMutationItem }> {
  const resolved = await resolveCurrentTask(item.targetId);
  if (!resolved.ok) {
    return {
      result: {
        itemId: item.itemId,
        entity: 'task',
        targetId: item.targetId,
        status: resolved.status,
        newVersion: null,
        appliedAtVersion: null,
        error: resolved.error,
        undoable: false,
      },
      enrichedMutation: item,
    };
  }

  const currentTask = resolved.task;
  const currentUpdatedAt = currentTask.updated_at ?? null;

  if (item.expectedVersion !== null && !versionsEqual(currentUpdatedAt, item.expectedVersion)) {
    return {
      result: {
        itemId: item.itemId,
        entity: 'task',
        targetId: item.targetId,
        status: 'conflict',
        newVersion: currentUpdatedAt,
        appliedAtVersion: null,
        error: 'Bu görev başka bir yerde güncellenmiş.',
        undoable: false,
      },
      enrichedMutation: item,
    };
  }

  const priorSnapshot = item.priorTaskSnapshot ?? snapshotOfTask(currentTask);
  const enrichedMutation: PlanMutationItem = {
    ...item,
    priorTaskSnapshot: priorSnapshot,
  };
  const priorTaskCopy: Task = { ...currentTask };
  const patch = buildTaskPatchForItem(item, ctx.localDayKey);

  if (!resolved.fromStore) {
    useTaskStore.setState((st) => ({
      tasks: st.tasks.some((t) => t.id === currentTask.id) ? st.tasks : [currentTask, ...st.tasks],
    }));
  }

  const taskChannel = outboxEngine.channel('task');
  let lastSettle: SettleReport | null = null;
  const unsub = taskChannel
    ? taskChannel.onSettled((report) => {
        if (report.entity === 'task' && report.entityId === item.targetId) {
          lastSettle = report;
        }
      })
    : () => undefined;

  try {
    const taskStore = useTaskStore.getState();
    await taskStore.updateTask(item.targetId, patch);
    await taskStore.flush();
  } finally {
    unsub();
  }

  const box = taskChannel?.state() ?? useTaskStore.getState().outbox;
  if (!box) {
    useTaskStore.setState((st) => ({
      tasks: st.tasks.map((t) => (t.id === priorTaskCopy.id ? priorTaskCopy : t)),
    }));
    return {
      result: {
        itemId: item.itemId,
        entity: 'task',
        targetId: item.targetId,
        status: 'retryable',
        newVersion: null,
        appliedAtVersion: null,
        error: useTaskStore.getState().error ?? 'Oturum bulunamadı.',
        undoable: false,
      },
      enrichedMutation,
    };
  }

  const remainingCmd = [...box.commands]
    .reverse()
    .find((c) => c.entity === 'task' && c.entityId === item.targetId);

  const settleReport = lastSettle as SettleReport | null;

  if (settleReport?.outcome === 'conflict' || remainingCmd?.status === 'conflict') {
    await discardTaskOutboxCmd(remainingCmd?.operationId, priorTaskCopy);
    let serverVersion: string | null = null;
    const latest = await fetchTaskRow(item.targetId);
    if (latest.ok && latest.data) {
      serverVersion = latest.data.updated_at ?? null;
      const freshRow = latest.data;
      useTaskStore.setState((st) => ({
        tasks: st.tasks.map((t) => (t.id === freshRow.id ? freshRow : t)),
      }));
    }
    return {
      result: {
        itemId: item.itemId,
        entity: 'task',
        targetId: item.targetId,
        status: 'conflict',
        newVersion: serverVersion,
        appliedAtVersion: null,
        error: settleReport?.error ?? remainingCmd?.lastError ?? 'Bu görev başka bir yerde değiştirilmiş.',
        undoable: false,
      },
      enrichedMutation,
    };
  }

  if (settleReport?.outcome === 'gone') {
    useTaskStore.setState((st) => ({
      tasks: st.tasks.filter((t) => t.id !== item.targetId),
    }));
    return {
      result: {
        itemId: item.itemId,
        entity: 'task',
        targetId: item.targetId,
        status: 'permanent',
        newVersion: null,
        appliedAtVersion: null,
        error: 'Görev sunucuda silinmiş.',
        undoable: false,
      },
      enrichedMutation,
    };
  }

  if (settleReport?.outcome === 'dead' || remainingCmd?.status === 'dead') {
    await discardTaskOutboxCmd(remainingCmd?.operationId, priorTaskCopy);
    return {
      result: {
        itemId: item.itemId,
        entity: 'task',
        targetId: item.targetId,
        status: 'permanent',
        newVersion: null,
        appliedAtVersion: null,
        error: settleReport?.error ?? remainingCmd?.lastError ?? 'Sunucu değişikliği reddetti.',
        undoable: false,
      },
      enrichedMutation,
    };
  }

  if (
    settleReport?.outcome === 'retryable' ||
    settleReport?.outcome === 'auth' ||
    settleReport?.outcome === 'rejected' ||
    (remainingCmd !== undefined &&
      (box.authBlocked || (remainingCmd.retryableCount ?? 0) > 0 || remainingCmd.attempts > 0))
  ) {
    const errText = settleReport?.error ?? remainingCmd?.lastError ?? 'Geçici bağlantı hatası.';
    await discardTaskOutboxCmd(remainingCmd?.operationId, priorTaskCopy);
    const classified = classifyRepoFailure({ ok: false, error: errText });
    const status: SyncOutcomeStatus =
      classified.category === 'missing_schema' ? 'permanent' : 'retryable';
    return {
      result: {
        itemId: item.itemId,
        entity: 'task',
        targetId: item.targetId,
        status,
        newVersion: null,
        appliedAtVersion: null,
        error: errText,
        undoable: false,
      },
      enrichedMutation,
    };
  }

  // Honest offline vs committed check (§7.1): any command still pending in outbox or `sync.pending > 0`
  // for this task is reported as `'pending'`, never `'committed'`.
  const taskSync = useTaskStore.getState().sync;
  const mappedCmdOutcome = mapCommandToSyncOutcome(remainingCmd ?? null, { authBlocked: box.authBlocked });
  if (mappedCmdOutcome === 'pending' || settleReport?.outcome === 'offline' || (remainingCmd === undefined && taskSync.pending > 0 && settleReport === null)) {
    return {
      result: {
        itemId: item.itemId,
        entity: 'task',
        targetId: item.targetId,
        status: 'pending',
        newVersion: null,
        appliedAtVersion: currentUpdatedAt,
        undoable: true,
      },
      enrichedMutation,
    };
  }

  const afterTask = useTaskStore.getState().tasks.find((t) => t.id === item.targetId);
  return {
    result: {
      itemId: item.itemId,
      entity: 'task',
      targetId: item.targetId,
      status: 'committed',
      newVersion: afterTask?.updated_at ?? currentUpdatedAt,
      appliedAtVersion: currentUpdatedAt,
      undoable: true,
    },
    enrichedMutation,
  };
}

function habitLogVersionOf(log: HabitLog | undefined): string | null {
  if (!log) return null;
  return log.created_at || log.state;
}

async function executeHabitMutation(
  item: PlanMutationItem,
  ctx: DayPlanExecutionContext,
): Promise<{ result: PlanItemCommitResult; enrichedMutation: PlanMutationItem }> {
  const existingLog = useLogStore.getState().getLogForHabit(item.targetId, ctx.localDayKey);
  const currentVersion = habitLogVersionOf(existingLog);

  if (
    item.expectedVersion !== null &&
    currentVersion !== item.expectedVersion &&
    (existingLog?.state ?? null) !== item.expectedVersion
  ) {
    return {
      result: {
        itemId: item.itemId,
        entity: 'habit',
        targetId: item.targetId,
        status: 'conflict',
        newVersion: currentVersion,
        appliedAtVersion: null,
        error: 'Alışkanlık kaydı başka bir yerde güncellenmiş.',
        undoable: false,
      },
      enrichedMutation: item,
    };
  }

  const priorState =
    item.priorHabitLogState !== undefined ? item.priorHabitLogState : (existingLog?.state ?? null);
  const enrichedMutation: PlanMutationItem = {
    ...item,
    priorHabitLogState: priorState,
  };

  const parsedDate = parseLocalDate(ctx.localDayKey);
  if (!parsedDate) {
    return {
      result: {
        itemId: item.itemId,
        entity: 'habit',
        targetId: item.targetId,
        status: 'permanent',
        newVersion: null,
        appliedAtVersion: null,
        error: 'Geçersiz tarih anahtarı.',
        undoable: false,
      },
      enrichedMutation,
    };
  }

  const logRes = await useLogStore.getState().logHabit({
    habitId: item.targetId,
    date: parsedDate,
    state: 'skip',
    ...(item.note !== undefined ? { note: item.note } : {}),
  });

  if (!logRes.ok) {
    const status: SyncOutcomeStatus = logRes.offline
      ? 'pending'
      : logRes.retryable
        ? 'retryable'
        : classifyRepoFailure({ ok: false, error: logRes.error, offline: logRes.offline }).status;
    return {
      result: {
        itemId: item.itemId,
        entity: 'habit',
        targetId: item.targetId,
        status,
        newVersion: null,
        appliedAtVersion: null,
        error: logRes.error,
        undoable: false,
      },
      enrichedMutation,
    };
  }

  const syncStatus = useLogStore.getState().getSyncStatusFor(item.targetId, ctx.localDayKey);
  if (syncStatus === 'dead') {
    return {
      result: {
        itemId: item.itemId,
        entity: 'habit',
        targetId: item.targetId,
        status: 'permanent',
        newVersion: null,
        appliedAtVersion: null,
        error: 'Alışkanlık kaydı gönderilemedi.',
        undoable: false,
      },
      enrichedMutation,
    };
  }

  if (syncStatus === 'pending' || logRes.log.id.startsWith('pending-')) {
    return {
      result: {
        itemId: item.itemId,
        entity: 'habit',
        targetId: item.targetId,
        status: 'pending',
        newVersion: null,
        appliedAtVersion: currentVersion,
        undoable: true,
      },
      enrichedMutation,
    };
  }

  return {
    result: {
      itemId: item.itemId,
      entity: 'habit',
      targetId: item.targetId,
      status: 'committed',
      newVersion: habitLogVersionOf(logRes.log) ?? 'skip',
      appliedAtVersion: currentVersion,
      undoable: true,
    },
    enrichedMutation,
  };
}

async function executeRecoveryMutation(
  item: PlanMutationItem,
): Promise<{ result: PlanItemCommitResult; enrichedMutation: PlanMutationItem }> {
  const existingPlan = useRecoveryStore.getState().plans.find((p) => p.id === item.targetId);
  const currentVersion = existingPlan ? existingPlan.status : null;

  if (
    item.expectedVersion !== null &&
    currentVersion !== item.expectedVersion &&
    (existingPlan?.created_at ?? null) !== item.expectedVersion
  ) {
    return {
      result: {
        itemId: item.itemId,
        entity: 'recovery_plan',
        targetId: item.targetId,
        status: 'conflict',
        newVersion: currentVersion,
        appliedAtVersion: null,
        error: 'Telafi planı başka bir yerde değiştirilmiş.',
        undoable: false,
      },
      enrichedMutation: item,
    };
  }

  if (existingPlan) {
    capturedRecoverySnapshots.set(item.targetId, { ...existingPlan });
  }

  let lastSettle: SettleReport | null = null;
  const unsub = coreOutbox.onSettled((report) => {
    if (report.entity === RECOVERY_PLAN_ENTITY && report.entityId === item.targetId) {
      lastSettle = report;
    }
  });

  try {
    await useRecoveryStore.getState().skipPlan(item.targetId);
  } finally {
    unsub();
  }

  const box = coreOutbox.state();
  const remainingCmd = box
    ? [...box.commands].reverse().find((c) => c.entity === RECOVERY_PLAN_ENTITY && c.entityId === item.targetId)
    : undefined;
  const settleReport = lastSettle as SettleReport | null;

  if (settleReport?.outcome === 'dead' || remainingCmd?.status === 'dead') {
    if (remainingCmd) await coreOutbox.discard(remainingCmd.operationId);
    return {
      result: {
        itemId: item.itemId,
        entity: 'recovery_plan',
        targetId: item.targetId,
        status: 'permanent',
        newVersion: null,
        appliedAtVersion: null,
        error: settleReport?.error ?? remainingCmd?.lastError ?? 'Telafi planı güncellenemedi.',
        undoable: false,
      },
      enrichedMutation: item,
    };
  }

  if (
    settleReport?.outcome === 'retryable' ||
    settleReport?.outcome === 'auth' ||
    settleReport?.outcome === 'rejected'
  ) {
    if (remainingCmd) await coreOutbox.discard(remainingCmd.operationId);
    if (existingPlan) {
      useRecoveryStore.setState((s) => ({
        plans: s.plans.some((p) => p.id === existingPlan.id) ? s.plans : [...s.plans, existingPlan],
      }));
    }
    return {
      result: {
        itemId: item.itemId,
        entity: 'recovery_plan',
        targetId: item.targetId,
        status: 'retryable',
        newVersion: null,
        appliedAtVersion: null,
        error: settleReport?.error ?? remainingCmd?.lastError ?? 'Telafi planı gönderilemedi.',
        undoable: false,
      },
      enrichedMutation: item,
    };
  }

  const mapped = mapCommandToSyncOutcome(remainingCmd ?? null, { authBlocked: box?.authBlocked });
  if (mapped === 'pending' || settleReport?.outcome === 'offline') {
    return {
      result: {
        itemId: item.itemId,
        entity: 'recovery_plan',
        targetId: item.targetId,
        status: 'pending',
        newVersion: null,
        appliedAtVersion: currentVersion ?? 'planned',
        undoable: true,
      },
      enrichedMutation: item,
    };
  }

  return {
    result: {
      itemId: item.itemId,
      entity: 'recovery_plan',
      targetId: item.targetId,
      status: 'committed',
      newVersion: 'cancelled',
      appliedAtVersion: currentVersion ?? 'planned',
      undoable: true,
    },
    enrichedMutation: item,
  };
}

async function defaultExecuteItem(
  item: PlanMutationItem,
  ctx: DayPlanExecutionContext,
): Promise<{ result: PlanItemCommitResult; enrichedMutation?: PlanMutationItem }> {
  if (item.entity === 'task') {
    return executeTaskMutation(item, ctx);
  }
  if (item.entity === 'habit') {
    return executeHabitMutation(item, ctx);
  }
  return executeRecoveryMutation(item);
}

function computeOverallStatus(
  results: readonly PlanItemCommitResult[],
  aborted: boolean,
): DayPlanCommitResult['overall'] {
  if (aborted) return 'aborted';
  if (results.length === 0) return 'committed';

  let committedCount = 0;
  let pendingCount = 0;
  let conflictCount = 0;
  let failedOtherCount = 0;

  for (const r of results) {
    if (r.status === 'committed') committedCount += 1;
    else if (r.status === 'pending') pendingCount += 1;
    else if (r.status === 'conflict') conflictCount += 1;
    else failedOtherCount += 1;
  }

  const succeededCount = committedCount + pendingCount;
  const failedCount = conflictCount + failedOtherCount;

  if (failedCount === 0) {
    return pendingCount > 0 ? 'pending' : 'committed';
  }
  if (succeededCount > 0) {
    return 'partial';
  }
  if (conflictCount > 0 && failedOtherCount === 0) {
    return 'conflict';
  }
  if (conflictCount > 0) {
    return 'conflict';
  }
  return 'partial';
}

async function runCommitBatch(
  operationId: string,
  localDayKey: string,
  itemsToExecute: readonly PlanMutationItem[],
  preservedByItemId: ReadonlyMap<string, PlanItemCommitResult & { mutation: PlanMutationItem }>,
  orderedAllItems: readonly PlanMutationItem[],
  ianaZone: string | null | undefined,
  deps: DayPlanCommitDeps | undefined,
): Promise<DayPlanCommitResult> {
  const resolveNow = deps?.now ?? (() => new Date());
  const resolveDayKey = deps?.resolveLocalDayKey ?? defaultResolveLocalDayKey;
  const resolveUser = deps?.resolveUserId ?? defaultResolveUserId;
  const executeItem = deps?.executeItem ?? defaultExecuteItem;

  const capturedEpoch = accountEpoch();
  const startNow = resolveNow();

  if (parseLocalDate(localDayKey) === null || resolveDayKey(startNow, ianaZone) !== localDayKey) {
    return {
      operationId,
      localDayKey,
      overall: 'aborted',
      results: [...preservedByItemId.values()].map(({ mutation: _m, ...r }) => r),
      retryableItemIds: [],
      receipt: null,
    };
  }

  const startUserId = await resolveUser();
  if (!startUserId || accountEpoch() !== capturedEpoch) {
    return {
      operationId,
      localDayKey,
      overall: 'aborted',
      results: [],
      retryableItemIds: [],
      receipt: null,
    };
  }

  const cached = completedOperations.get(operationId);
  if (cached && cached.userId === startUserId && preservedByItemId.size === 0) {
    return cached.result;
  }

  rememberMutations(operationId, orderedAllItems);

  const executedEntries = new Map<string, PlanItemCommitResult & { mutation: PlanMutationItem }>(
    preservedByItemId,
  );
  let aborted = false;
  let accountInvalidated = false;

  for (const item of itemsToExecute) {
    if (accountEpoch() !== capturedEpoch) {
      aborted = true;
      accountInvalidated = true;
      break;
    }
    const stepUserId = await resolveUser();
    if (!stepUserId || stepUserId !== startUserId || accountEpoch() !== capturedEpoch) {
      aborted = true;
      accountInvalidated = true;
      break;
    }
    const stepNow = resolveNow();
    if (resolveDayKey(stepNow, ianaZone) !== localDayKey) {
      aborted = true;
      break;
    }

    const stepOutcome = await executeItem(item, {
      userId: startUserId,
      localDayKey,
      now: stepNow,
    });

    const postStepUser = await resolveUser();
    const guarded = guardAccountResponse({
      capturedEpoch,
      currentEpoch: accountEpoch(),
      capturedUserId: startUserId,
      activeUserId: postStepUser,
      apply: () => stepOutcome,
    });

    if (!guarded.applied) {
      aborted = true;
      accountInvalidated = true;
      break;
    }

    const finalMutation = guarded.value.enrichedMutation ?? item;
    rememberMutations(operationId, [finalMutation]);
    executedEntries.set(item.itemId, {
      ...guarded.value.result,
      mutation: finalMutation,
    });
  }

  if (accountInvalidated) {
    return {
      operationId,
      localDayKey,
      overall: 'aborted',
      results: [...executedEntries.values()].map(({ mutation: _m, ...r }) => r),
      retryableItemIds: [],
      receipt: null,
    };
  }

  const orderedEntries: (PlanItemCommitResult & { mutation: PlanMutationItem })[] = [];
  for (const item of orderedAllItems) {
    const found = executedEntries.get(item.itemId);
    if (found) orderedEntries.push(found);
  }

  const results: PlanItemCommitResult[] = orderedEntries.map(({ mutation: _m, ...res }) => res);
  const overall = computeOverallStatus(results, aborted);
  const retryableItemIds = aborted
    ? []
    : results.filter((r) => r.status === 'retryable').map((r) => r.itemId);

  const hasAnyUndoable = orderedEntries.some((entry) => entry.undoable);
  const receipt: DayPlanCommitReceipt | null = hasAnyUndoable
    ? {
        operationId,
        userId: startUserId,
        localDayKey,
        committedAtIso: resolveNow().toISOString(),
        items: orderedEntries,
      }
    : null;

  const finalResult: DayPlanCommitResult = {
    operationId,
    localDayKey,
    overall,
    results,
    retryableItemIds,
    receipt,
  };

  rememberCompleted(startUserId, operationId, finalResult);
  return finalResult;
}

/**
 * Applies an approved Light Day / Day Replan batch under a shared `operationId`.
 * Concurrent calls with the same `operationId` share the single in-flight execution.
 */
export function commitDayPlan(
  input: CommitDayPlanInput,
  deps?: DayPlanCommitDeps,
): Promise<DayPlanCommitResult> {
  const operationId =
    typeof input.operationId === 'string' && input.operationId.trim().length > 0
      ? input.operationId.trim()
      : newOperationId();

  const existing = inFlightOperations.get(operationId);
  if (existing) return existing;

  const emptyPreserved = new Map<string, PlanItemCommitResult & { mutation: PlanMutationItem }>();
  const run = runCommitBatch(
    operationId,
    input.localDayKey,
    input.items,
    emptyPreserved,
    input.items,
    input.ianaZone,
    deps,
  ).finally(() => {
    if (inFlightOperations.get(operationId) === run) {
      inFlightOperations.delete(operationId);
    }
  });

  inFlightOperations.set(operationId, run);
  return run;
}

function isMutationArray(
  arg: readonly PlanMutationItem[] | RetryFailedDayPlanOptions | undefined,
): arg is readonly PlanMutationItem[] {
  return Array.isArray(arg);
}

/**
 * REC-03 — Re-runs ONLY the failed items of a previous `DayPlanCommitResult`,
 * preserving already `'committed'` and `'pending'` items without touching them again.
 */
export function retryFailedDayPlanItems(
  previousResult: DayPlanCommitResult,
  itemsOrOptions?: readonly PlanMutationItem[] | RetryFailedDayPlanOptions,
  maybeDeps?: DayPlanCommitDeps,
): Promise<DayPlanCommitResult> {
  const opts: RetryFailedDayPlanOptions = isMutationArray(itemsOrOptions)
    ? { ...(maybeDeps ?? {}), items: itemsOrOptions }
    : (itemsOrOptions ?? {});

  const operationId = opts.operationId ?? previousResult.operationId;
  const existing = inFlightOperations.get(operationId);
  if (existing) return existing;

  const localDayKey = opts.localDayKey ?? previousResult.localDayKey;
  const storedMap = operationMutations.get(previousResult.operationId) ?? new Map<string, PlanMutationItem>();

  const receiptMap = new Map<string, PlanItemCommitResult & { mutation: PlanMutationItem }>();
  for (const entry of previousResult.receipt?.items ?? []) {
    receiptMap.set(entry.itemId, entry);
  }

  const providedMap = new Map<string, PlanMutationItem>();
  for (const m of opts.items ?? []) {
    providedMap.set(m.itemId, m);
  }

  const orderedAllItems: PlanMutationItem[] = [];
  for (const prev of previousResult.results) {
    const candidate =
      providedMap.get(prev.itemId) ??
      receiptMap.get(prev.itemId)?.mutation ??
      storedMap.get(prev.itemId);
    if (candidate) orderedAllItems.push(candidate);
  }
  for (const m of opts.items ?? []) {
    if (!orderedAllItems.some((x) => x.itemId === m.itemId)) {
      orderedAllItems.push(m);
    }
  }

  const preserved = new Map<string, PlanItemCommitResult & { mutation: PlanMutationItem }>();
  const toRetry: PlanMutationItem[] = [];

  for (const item of orderedAllItems) {
    const prev = previousResult.results.find((r) => r.itemId === item.itemId);
    if (!prev) {
      toRetry.push(item);
      continue;
    }
    if (prev.status === 'committed' || prev.status === 'pending') {
      const priorMutation = receiptMap.get(item.itemId)?.mutation ?? item;
      preserved.set(item.itemId, { ...prev, mutation: priorMutation });
      continue;
    }
    if (prev.status === 'permanent') {
      preserved.set(item.itemId, { ...prev, mutation: item });
      continue;
    }
    // `retryable` or `conflict` -> eligible for retry without touching succeeded siblings
    toRetry.push(item);
  }

  const run = runCommitBatch(
    operationId,
    localDayKey,
    toRetry,
    preserved,
    orderedAllItems,
    opts.ianaZone,
    opts,
  ).finally(() => {
    if (inFlightOperations.get(operationId) === run) {
      inFlightOperations.delete(operationId);
    }
  });

  inFlightOperations.set(operationId, run);
  return run;
}

async function undoTaskEntry(
  entry: PlanItemCommitResult & { mutation: PlanMutationItem },
): Promise<DayPlanItemUndoResult> {
  const snap = entry.mutation.priorTaskSnapshot;
  if (!snap) {
    return {
      itemId: entry.itemId,
      entity: 'task',
      targetId: entry.targetId,
      outcome: 'not_applied',
      status: 'skipped',
    };
  }

  const resolved = await resolveCurrentTask(entry.targetId);
  if (!resolved.ok) {
    if (resolved.status === 'permanent') {
      return {
        itemId: entry.itemId,
        entity: 'task',
        targetId: entry.targetId,
        outcome: 'conflict_skipped',
        status: 'conflict',
        error: resolved.error,
      };
    }
    return {
      itemId: entry.itemId,
      entity: 'task',
      targetId: entry.targetId,
      outcome: 'failed',
      status: resolved.status,
      error: resolved.error,
    };
  }

  const currentTask = resolved.task;
  const currentVersion = currentTask.updated_at ?? null;
  const expectedAtUndo = entry.newVersion ?? entry.appliedAtVersion;

  if (expectedAtUndo !== null && !versionsEqual(currentVersion, expectedAtUndo)) {
    return {
      itemId: entry.itemId,
      entity: 'task',
      targetId: entry.targetId,
      outcome: 'conflict_skipped',
      status: 'conflict',
      error: 'Görev plan uygulandıktan sonra değiştirilmiş; üzerine yazılmadı.',
    };
  }

  if (!resolved.fromStore) {
    useTaskStore.setState((st) => ({
      tasks: st.tasks.some((t) => t.id === currentTask.id) ? st.tasks : [currentTask, ...st.tasks],
    }));
  }

  const taskBeforeUndo: Task = { ...currentTask };
  const restorePatch: Partial<Task> = {
    due_date: snap.due_date,
    list_type: snap.list_type,
    time_block_start: snap.time_block_start,
    time_block_end: snap.time_block_end,
  };

  const taskChannel = outboxEngine.channel('task');
  let lastSettle: SettleReport | null = null;
  const unsub = taskChannel
    ? taskChannel.onSettled((report) => {
        if (report.entity === 'task' && report.entityId === entry.targetId) {
          lastSettle = report;
        }
      })
    : () => undefined;

  try {
    const taskStore = useTaskStore.getState();
    await taskStore.updateTask(entry.targetId, restorePatch);
    await taskStore.flush();
  } finally {
    unsub();
  }

  const box = taskChannel?.state() ?? useTaskStore.getState().outbox;
  const remainingCmd = box
    ? [...box.commands].reverse().find((c) => c.entity === 'task' && c.entityId === entry.targetId)
    : undefined;
  const settleReport = lastSettle as SettleReport | null;

  if (settleReport?.outcome === 'conflict' || remainingCmd?.status === 'conflict') {
    await discardTaskOutboxCmd(remainingCmd?.operationId, taskBeforeUndo);
    const latest = await fetchTaskRow(entry.targetId);
    if (latest.ok && latest.data) {
      const freshRow = latest.data;
      useTaskStore.setState((st) => ({
        tasks: st.tasks.map((t) => (t.id === freshRow.id ? freshRow : t)),
      }));
    }
    return {
      itemId: entry.itemId,
      entity: 'task',
      targetId: entry.targetId,
      outcome: 'conflict_skipped',
      status: 'conflict',
      error: 'Görev başka bir cihazda değiştirilmiş; üzerine yazılmadı.',
    };
  }

  if (
    settleReport?.outcome === 'dead' ||
    settleReport?.outcome === 'retryable' ||
    settleReport?.outcome === 'auth' ||
    settleReport?.outcome === 'rejected' ||
    remainingCmd?.status === 'dead'
  ) {
    await discardTaskOutboxCmd(remainingCmd?.operationId, taskBeforeUndo);
    return {
      itemId: entry.itemId,
      entity: 'task',
      targetId: entry.targetId,
      outcome: 'failed',
      status: 'retryable',
      error: settleReport?.error ?? remainingCmd?.lastError ?? 'Geri alma tamamlanamadı.',
    };
  }

  const mapped = mapCommandToSyncOutcome(remainingCmd ?? null, { authBlocked: box?.authBlocked });
  if (mapped === 'pending' || settleReport?.outcome === 'offline') {
    return {
      itemId: entry.itemId,
      entity: 'task',
      targetId: entry.targetId,
      outcome: 'pending',
      status: 'pending',
    };
  }

  return {
    itemId: entry.itemId,
    entity: 'task',
    targetId: entry.targetId,
    outcome: 'undone',
    status: 'committed',
  };
}

async function undoHabitEntry(
  entry: PlanItemCommitResult & { mutation: PlanMutationItem },
  ctx: DayPlanExecutionContext,
): Promise<DayPlanItemUndoResult> {
  const currentLog = useLogStore.getState().getLogForHabit(entry.targetId, ctx.localDayKey);
  if (currentLog && currentLog.state !== 'skip') {
    return {
      itemId: entry.itemId,
      entity: 'habit',
      targetId: entry.targetId,
      outcome: 'conflict_skipped',
      status: 'conflict',
      error: 'Alışkanlık kaydı plan sonrasında değiştirilmiş; üzerine yazılmadı.',
    };
  }

  if (
    entry.newVersion !== null &&
    entry.newVersion !== 'skip' &&
    currentLog &&
    !currentLog.id.startsWith('pending-') &&
    currentLog.created_at &&
    !versionsEqual(currentLog.created_at, entry.newVersion)
  ) {
    return {
      itemId: entry.itemId,
      entity: 'habit',
      targetId: entry.targetId,
      outcome: 'conflict_skipped',
      status: 'conflict',
      error: 'Alışkanlık kaydı başka bir cihazda güncellenmiş; üzerine yazılmadı.',
    };
  }

  const priorState = entry.mutation.priorHabitLogState ?? null;
  const parsedDate = parseLocalDate(ctx.localDayKey);
  if (!parsedDate) {
    return {
      itemId: entry.itemId,
      entity: 'habit',
      targetId: entry.targetId,
      outcome: 'failed',
      status: 'permanent',
      error: 'Geçersiz tarih anahtarı.',
    };
  }

  if (priorState !== null) {
    const res = await useLogStore.getState().logHabit({
      habitId: entry.targetId,
      date: parsedDate,
      state: priorState,
    });
    if (!res.ok) {
      return {
        itemId: entry.itemId,
        entity: 'habit',
        targetId: entry.targetId,
        outcome: 'failed',
        status: res.offline ? 'pending' : 'retryable',
        error: res.error,
      };
    }
    const syncStatus = useLogStore.getState().getSyncStatusFor(entry.targetId, ctx.localDayKey);
    const pending = syncStatus === 'pending' || res.log.id.startsWith('pending-');
    return {
      itemId: entry.itemId,
      entity: 'habit',
      targetId: entry.targetId,
      outcome: pending ? 'pending' : 'undone',
      status: pending ? 'pending' : 'committed',
    };
  }

  if (!currentLog) {
    return {
      itemId: entry.itemId,
      entity: 'habit',
      targetId: entry.targetId,
      outcome: 'undone',
      status: 'committed',
    };
  }

  if (currentLog.id.startsWith('pending-')) {
    const eid = habitLogEntityId(entry.targetId, ctx.localDayKey);
    const habitChannel = outboxEngine.channel('habit');
    const pendingCmd = habitChannel?.state()?.commands.find((c) => c.entityId === eid);
    if (pendingCmd) {
      await habitChannel?.discard(pendingCmd.operationId);
    }
    useLogStore.setState((s) => ({
      logs: s.logs.filter((l) => !(l.habit_id === entry.targetId && l.completed_at === ctx.localDayKey)),
    }));
    return {
      itemId: entry.itemId,
      entity: 'habit',
      targetId: entry.targetId,
      outcome: 'undone',
      status: 'committed',
    };
  }

  const deleted = await deleteOwnedIfPresent({
    table: 'habit_logs',
    id: currentLog.id,
    expectedUserId: ctx.userId,
  });
  if (!deleted.ok) {
    return {
      itemId: entry.itemId,
      entity: 'habit',
      targetId: entry.targetId,
      outcome: 'failed',
      status: deleted.offline ? 'retryable' : classifyRepoFailure(deleted).status,
      error: deleted.error,
    };
  }

  useLogStore.setState((s) => ({
    logs: s.logs.filter((l) => !(l.habit_id === entry.targetId && l.completed_at === ctx.localDayKey)),
  }));
  return {
    itemId: entry.itemId,
    entity: 'habit',
    targetId: entry.targetId,
    outcome: 'undone',
    status: 'committed',
  };
}

async function undoRecoveryEntry(
  entry: PlanItemCommitResult & { mutation: PlanMutationItem },
): Promise<DayPlanItemUndoResult> {
  const box = coreOutbox.state();
  const laterCompleted = box?.commands.some(
    (c) =>
      c.entity === RECOVERY_PLAN_ENTITY &&
      c.entityId === entry.targetId &&
      c.payload?.status === 'completed',
  );
  if (laterCompleted) {
    return {
      itemId: entry.itemId,
      entity: 'recovery_plan',
      targetId: entry.targetId,
      outcome: 'conflict_skipped',
      status: 'conflict',
      error: 'Telafi planı tamamlanmış; üzerine yazılmadı.',
    };
  }

  const writeRes = await coreOutbox.write({
    entity: RECOVERY_PLAN_ENTITY,
    entityId: entry.targetId,
    kind: 'update',
    payload: { status: 'planned', completed_at: null },
  });
  if (!writeRes.ok) {
    return {
      itemId: entry.itemId,
      entity: 'recovery_plan',
      targetId: entry.targetId,
      outcome: 'failed',
      status: 'retryable',
      error: writeRes.error,
    };
  }
  await coreOutbox.flush();

  const snapshot = capturedRecoverySnapshots.get(entry.targetId);
  if (snapshot) {
    const restoredPlan: RecoveryPlan = { ...snapshot, status: 'planned', completed_at: null };
    useRecoveryStore.setState((s) => ({
      plans: s.plans.some((p) => p.id === snapshot.id)
        ? s.plans
        : [...s.plans, restoredPlan].sort((a, b) =>
            a.target_date.localeCompare(b.target_date),
          ),
    }));
  }

  const afterBox = coreOutbox.state();
  const stillPending = afterBox?.commands.some(
    (c) => c.entity === RECOVERY_PLAN_ENTITY && c.entityId === entry.targetId && c.status === 'pending',
  );
  return {
    itemId: entry.itemId,
    entity: 'recovery_plan',
    targetId: entry.targetId,
    outcome: stillPending ? 'pending' : 'undone',
    status: stillPending ? 'pending' : 'committed',
  };
}

async function defaultUndoItem(
  entry: PlanItemCommitResult & { mutation: PlanMutationItem },
  ctx: DayPlanExecutionContext,
): Promise<DayPlanItemUndoResult> {
  if (entry.entity === 'task') {
    return undoTaskEntry(entry);
  }
  if (entry.entity === 'habit') {
    return undoHabitEntry(entry, ctx);
  }
  return undoRecoveryEntry(entry);
}

/**
 * REC-04 — Receipt-based, version-verified undo.
 * - Never claims an unapplied item (`undoable: false`) was undone (`skippedUnappliedIds`).
 * - Never overwrites an item whose version changed after commit (`skippedConflictIds`).
 * - Stops immediately if the signed-in account changes (`overall: 'aborted'`).
 */
export function undoDayPlanCommit(
  receipt: DayPlanCommitReceipt,
  deps?: DayPlanCommitDeps,
): Promise<DayPlanUndoResult> {
  const existing = inFlightUndos.get(receipt.operationId);
  if (existing) return existing;

  const run = (async (): Promise<DayPlanUndoResult> => {
    const resolveNow = deps?.now ?? (() => new Date());
    const resolveUser = deps?.resolveUserId ?? defaultResolveUserId;
    const undoItem = deps?.undoItem ?? defaultUndoItem;

    const capturedEpoch = accountEpoch();
    const activeUserId = await resolveUser();
    if (!activeUserId || activeUserId !== receipt.userId || accountEpoch() !== capturedEpoch) {
      return {
        operationId: receipt.operationId,
        overall: 'aborted',
        undoneItemIds: [],
        skippedConflictIds: [],
        skippedUnappliedIds: [],
        failedItemIds: [],
        results: [],
      };
    }

    const undoneItemIds: string[] = [];
    const skippedConflictIds: string[] = [];
    const skippedUnappliedIds: string[] = [];
    const failedItemIds: string[] = [];
    const results: DayPlanItemUndoResult[] = [];
    let hasPendingUndo = false;
    let aborted = false;

    for (const entry of receipt.items) {
      if (accountEpoch() !== capturedEpoch) {
        aborted = true;
        break;
      }
      const stepUser = await resolveUser();
      if (!stepUser || stepUser !== receipt.userId || accountEpoch() !== capturedEpoch) {
        aborted = true;
        break;
      }

      if (!entry.undoable || (entry.status !== 'committed' && entry.status !== 'pending')) {
        skippedUnappliedIds.push(entry.itemId);
        results.push({
          itemId: entry.itemId,
          entity: entry.entity,
          targetId: entry.targetId,
          outcome: 'not_applied',
          status: 'skipped',
        });
        continue;
      }

      const itemUndo = await undoItem(entry, {
        userId: receipt.userId,
        localDayKey: receipt.localDayKey,
        now: resolveNow(),
      });

      const postUser = await resolveUser();
      const guarded = guardAccountResponse({
        capturedEpoch,
        currentEpoch: accountEpoch(),
        capturedUserId: receipt.userId,
        activeUserId: postUser,
        apply: () => itemUndo,
      });

      if (!guarded.applied) {
        aborted = true;
        break;
      }

      const outcome = guarded.value;
      results.push(outcome);
      if (outcome.outcome === 'undone') {
        undoneItemIds.push(entry.itemId);
      } else if (outcome.outcome === 'pending') {
        undoneItemIds.push(entry.itemId);
        hasPendingUndo = true;
      } else if (outcome.outcome === 'conflict_skipped') {
        skippedConflictIds.push(entry.itemId);
      } else if (outcome.outcome === 'not_applied') {
        skippedUnappliedIds.push(entry.itemId);
      } else {
        failedItemIds.push(entry.itemId);
      }
    }

    completedOperations.delete(receipt.operationId);

    let overall: DayPlanUndoResult['overall'];
    if (aborted) {
      overall = 'aborted';
    } else if (
      undoneItemIds.length === 0 &&
      skippedConflictIds.length === 0 &&
      failedItemIds.length === 0
    ) {
      overall = 'noop';
    } else if (
      skippedConflictIds.length > 0 &&
      undoneItemIds.length === 0 &&
      failedItemIds.length === 0
    ) {
      overall = 'conflict';
    } else if (skippedConflictIds.length === 0 && failedItemIds.length === 0) {
      overall = hasPendingUndo ? 'pending' : 'undone';
    } else {
      overall = 'partial';
    }

    return {
      operationId: receipt.operationId,
      overall,
      undoneItemIds,
      skippedConflictIds,
      skippedUnappliedIds,
      failedItemIds,
      results,
    };
  })().finally(() => {
    if (inFlightUndos.get(receipt.operationId) === run) {
      inFlightUndos.delete(receipt.operationId);
    }
  });

  inFlightUndos.set(receipt.operationId, run);
  return run;
}

registerAccountScoped({
  name: 'dayPlanCommit',
  onReset: resetDayPlanCommitState,
});
