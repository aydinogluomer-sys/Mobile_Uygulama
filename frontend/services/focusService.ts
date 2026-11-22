/**
 * Focus sessions.  (plan §8 service layer + F16)
 *
 * ## The orchestration
 *
 * Finishing a work phase is:
 *
 *   1. record the session with honest `started_at` and `ended_at` bounds,
 *   2. credit the selected task on first server delivery inside `coreOutbox`
 *      (so offline sessions also credit once on replay, INT-09),
 *   3. read fresh task progress and auto-complete the task if it reached its
 *      estimate and the setting is on (REP-11).
 */
import {
  completeFocusTask,
  fetchAllFocusTasks,
  fetchFocusTaskProgress,
  fetchOpenFocusTasks,
  insertFocusTask,
  deleteFocusTask,
  type FocusTaskRow,
} from '../repositories/focusTaskRepository';
import {
  deleteAllFocusSessions,
  fetchAllFocusSessions,
  fetchFocusSessionsBetween,
  fetchFocusSessionsSince,
} from '../repositories/focusSessionRepository';
import { coreOutbox } from './coreOutbox';
import { newOperationId } from '../lib/outbox';
import { MIN_PARTIAL_SECONDS, sessionSpan } from '../lib/focusTimer';

export const listOpenTasks = () => fetchOpenFocusTasks();
export const addTask = (title: string, estimatedPomodoros = 1) =>
  insertFocusTask({ title, estimatedPomodoros });
export const removeTask = (id: string) => deleteFocusTask(id);
export const completeTask = (id: string) => completeFocusTask(id);

export type WorkPhaseResult = {
  /** The session row was written. Analytics and auto-completion depend on this. */
  sessionRecorded: boolean;
  /**
   * R02.03 / F16 — the session is kept on the device (core outbox) and will be
   * delivered and credited once when the network returns.
   */
  sessionQueued?: boolean;
  error?: string;
  /** The task reached its estimate and was auto-completed. */
  taskCompleted: boolean;
  /** Oturum yazıldı ama görev sayacı okunamadı/bulunamadı (otomatik tamamlama atlandı). */
  creditError?: string;
};

/**
 * Records a finished work phase and checks fresh task progress for auto-completion.
 */
export async function completeWorkPhase(params: {
  task: FocusTaskRow | undefined;
  plannedSeconds: number;
  completedSeconds: number;
  autoCheckTasks: boolean;
  /** R03.03 — a small step's own title, for a session with no focus task. */
  title?: string | null;
  /** Oturumun ilk başlama anı (ISO). Yoksa bitişten etkin süre kadar geri hesaplanır. */
  startedAtIso?: string;
  /** Gerçek bitiş anı (ISO). Yoksa şimdi. */
  endedAtIso?: string;
}): Promise<WorkPhaseResult> {
  const span = sessionSpan({
    startedAtIso: params.startedAtIso,
    endedAtIso: params.endedAtIso,
    completedSeconds: params.completedSeconds,
    now: Date.now(),
  });
  const session = await coreOutbox.write({
    entity: 'focus_session',
    entityId: newOperationId(),
    kind: 'create',
    payload: {
      task_id: params.task?.id ?? null,
      task_title: params.task?.title ?? params.title ?? null,
      mode: 'work',
      started_at: span.startedAt,
      ended_at: span.endedAt,
      planned_seconds: params.plannedSeconds,
      completed_seconds: params.completedSeconds,
      completed: true,
    },
  });
  if (session.ok) await coreOutbox.flush();
  const delivered = session.ok && !(coreOutbox.state()?.commands ?? []).some((c) => c.operationId === session.operationId);

  if (!delivered) {
    return session.ok
      ? { sessionRecorded: false, sessionQueued: true, error: 'Oturum cihaza kaydedildi; bağlantı gelince gönderilecek.', taskCompleted: false }
      : { sessionRecorded: false, error: session.error, taskCompleted: false };
  }

  if (!params.task) return { sessionRecorded: true, taskCompleted: false };

  // Kredi, satırın ilk yazımında coreOutbox taşıyıcısında uygulandı (INT-09). Burada yalnız taze okuma:
  // otomatik tamamlama kararı ekran anlık görüntüsüne değil sunucudaki sayaçlara dayanır (REP-11).
  let fresh: Awaited<ReturnType<typeof fetchFocusTaskProgress>>;
  try {
    fresh = await fetchFocusTaskProgress(params.task.id);
  } catch (e) {
    return {
      sessionRecorded: true,
      taskCompleted: false,
      creditError: e instanceof Error ? e.message : 'Görev okunamadı.',
    };
  }
  if (!fresh.ok) return { sessionRecorded: true, taskCompleted: false, creditError: fresh.error };
  if (!fresh.data) return { sessionRecorded: true, taskCompleted: false, creditError: 'Odak görevi bulunamadı.' };

  const reachedEstimate = (fresh.data.completed_pomodoros ?? 0) >= (fresh.data.estimated_pomodoros ?? 1);
  if (params.autoCheckTasks && reachedEstimate && !fresh.data.completed) {
    const closed = await completeFocusTask(params.task.id);
    return { sessionRecorded: true, taskCompleted: closed.ok };
  }

  return { sessionRecorded: true, taskCompleted: false };
}

export type PartialResult = { recorded: boolean; queued?: boolean; error?: string };

export async function recordPartialWorkPhase(p: {
  startedAtIso: string;
  endedAtIso: string;
  plannedSeconds: number;
  completedSeconds: number;
  taskId?: string | null;
  taskTitle?: string | null;
}): Promise<PartialResult> {
  const seconds = Math.min(Math.round(p.completedSeconds), Math.round(p.plannedSeconds));
  if (!Number.isFinite(seconds) || seconds < MIN_PARTIAL_SECONDS) return { recorded: false };
  const span = sessionSpan({
    startedAtIso: p.startedAtIso,
    endedAtIso: p.endedAtIso,
    completedSeconds: seconds,
    now: Date.now(),
  });
  const w = await coreOutbox.write({
    entity: 'focus_session',
    entityId: newOperationId(),
    kind: 'create',
    payload: {
      task_id: p.taskId ?? null,
      task_title: p.taskTitle ?? null,
      mode: 'work',
      started_at: span.startedAt,
      ended_at: span.endedAt,
      planned_seconds: p.plannedSeconds,
      completed_seconds: seconds,
      completed: false,
    },
  });
  if (!w.ok) return { recorded: false, error: w.error };
  await coreOutbox.flush();
  const queued = (coreOutbox.state()?.commands ?? []).some((c) => c.operationId === w.operationId);
  return queued ? { recorded: false, queued: true } : { recorded: true };
}

/** Sessions since a date — the focus report and the completion modal. */
export const sessionsSince = (params: Parameters<typeof fetchFocusSessionsSince>[0]) =>
  fetchFocusSessionsSince(params);

/** F15: Sessions within a local-day range [startYmd, endYmd] (inclusive local days). */
export const sessionsBetween = (params: Parameters<typeof fetchFocusSessionsBetween>[0]) =>
  fetchFocusSessionsBetween(params);

// Data export / clear, from the focus settings sheet.
export const allSessions = () => fetchAllFocusSessions();
export const allTasks = () => fetchAllFocusTasks();
export const clearAllSessions = () => deleteAllFocusSessions();
