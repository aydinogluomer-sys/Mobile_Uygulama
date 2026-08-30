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
  fetchFocusSessionsSince,
  insertFocusSession,
} from '../repositories/focusSessionRepository';
import { fetchAllFocusTasks } from '../repositories/focusTaskRepository';

export const listOpenTasks = () => fetchOpenFocusTasks();
export const addTask = (title: string, estimatedPomodoros = 1) =>
  insertFocusTask({ title, estimatedPomodoros });
export const removeTask = (id: string) => deleteFocusTask(id);
export const completeTask = (id: string) => completeFocusTask(id);

export type WorkPhaseResult = {
  /** The session row was written. Analytics and crediting depend on this. */
  sessionRecorded: boolean;
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
}): Promise<WorkPhaseResult> {
  const now = new Date().toISOString();
  const session = await insertFocusSession({
    taskId: params.task?.id ?? null,
    taskTitle: params.task?.title ?? null,
    mode: 'work',
    startedAt: now,
    endedAt: now,
    plannedSeconds: params.plannedSeconds,
    completedSeconds: params.completedSeconds,
  });

  if (!session.ok) {
    // No row, so nothing is credited and nothing is reported. Crediting a
    // task for a session that was rejected is how a pomodoro counter drifts
    // away from the sessions that produced it.
    return { sessionRecorded: false, error: session.error, taskCompleted: false };
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

// Data export / clear, from the focus settings sheet.
export const allSessions = () => fetchAllFocusSessions();
export const allTasks = () => fetchAllFocusTasks();
export const clearAllSessions = () => deleteAllFocusSessions();
