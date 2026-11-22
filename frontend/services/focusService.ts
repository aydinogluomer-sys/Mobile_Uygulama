/**
 * Focus sessions.  (plan §8 service layer)
 *
 * ## The orchestration
 *
 * Finishing a work phase is not one write. It is:
 *
 *   1. record the session,
 *   2. only if that succeeded, credit the selected task with a pomodoro and
 *      the elapsed seconds,
 *   3. auto-complete the task if it has reached its estimate and the setting
 *      is on.
 *
 * The ordering is the rule: the session row is what makes a session real, so
 * a task must not be credited for a session the database rejected. The store
 * ran all three inline and the credit step ignored whether step 1 had worked.
 */
import {
  completeFocusTask,
  fetchOpenFocusTasks,
  insertFocusTask,
  deleteFocusTask,
  setFocusTaskProgress,
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
import { fetchAllFocusTasks } from '../repositories/focusTaskRepository';

export const listOpenTasks = () => fetchOpenFocusTasks();
export const addTask = (title: string, estimatedPomodoros = 1) =>
  insertFocusTask({ title, estimatedPomodoros });
export const removeTask = (id: string) => deleteFocusTask(id);
export const completeTask = (id: string) => completeFocusTask(id);

export type WorkPhaseResult = {
  /** The session row was written. Analytics and crediting depend on this. */
  sessionRecorded: boolean;
  /**
   * R02.03 — the session is kept on the device (core outbox) and will be
   * delivered later, even when `sessionRecorded` is false because the
   * network was down. It is not lost; it is not yet credited or reported.
   */
  sessionQueued?: boolean;
  error?: string;
  /** The task reached its estimate and was auto-completed. */
  taskCompleted: boolean;
};

/**
 * Records a finished work phase and credits the task it belonged to.
 *
 * Returns what actually happened rather than assuming: the caller emits its
 * §22 event only when `sessionRecorded` is true, because a rejected insert
 * leaves no row and must leave no event either.
 */
export async function completeWorkPhase(params: {
  task: FocusTaskRow | undefined;
  plannedSeconds: number;
  completedSeconds: number;
  autoCheckTasks: boolean;
  /** R03.03 — a small step's own title, for a session with no focus task. */
  title?: string | null;
}): Promise<WorkPhaseResult> {
  const now = new Date().toISOString();
  // R02.03 — the session is kept on the device first (core outbox, client id:
  // a re-delivery is the same session), then delivered. "Recorded" means it
  // can no longer be lost, not that the network happened to be up.
  const session = await coreOutbox.write({
    entity: 'focus_session', entityId: newOperationId(), kind: 'create',
    payload: {
      task_id: params.task?.id ?? null,
      task_title: params.task?.title ?? params.title ?? null,
      mode: 'work',
      started_at: now,
      ended_at: now,
      planned_seconds: params.plannedSeconds,
      completed_seconds: params.completedSeconds,
      completed: true,
    },
  });
  if (session.ok) await coreOutbox.flush();
  // Recorded = the server accepted it in this call (the command left the outbox).
  const delivered = session.ok && !(coreOutbox.state()?.commands ?? []).some((c) => c.operationId === session.operationId);

  if (!delivered) {
    // No row, so nothing is credited and nothing is reported. Crediting a
    // task for a session that was rejected is how a pomodoro counter drifts
    // away from the sessions that produced it.
    return session.ok
      ? { sessionRecorded: false, sessionQueued: true, error: 'Oturum cihaza kaydedildi; bağlantı gelince gönderilecek.', taskCompleted: false }
      : { sessionRecorded: false, error: session.error, taskCompleted: false };
  }

  if (!params.task) return { sessionRecorded: true, taskCompleted: false };

  const done = (params.task.completed_pomodoros ?? 0) + 1;
  await setFocusTaskProgress({
    id: params.task.id,
    completedPomodoros: done,
    totalFocusSeconds: (params.task.total_focus_seconds ?? 0) + params.completedSeconds,
  });

  const reachedEstimate = done >= (params.task.estimated_pomodoros ?? 1);
  if (params.autoCheckTasks && reachedEstimate) {
    const closed = await completeFocusTask(params.task.id);
    return { sessionRecorded: true, taskCompleted: closed.ok };
  }

  return { sessionRecorded: true, taskCompleted: false };
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
