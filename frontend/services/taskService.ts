/**
 * Tasks.  (plan §8 service layer)
 *
 * Completion is the one place with a rule beyond persistence: `completed`
 * and `status` are two columns describing the same fact, and they were
 * previously set independently by whichever screen happened to toggle a task.
 * A task marked `completed: true` while `status` stayed `pending` is a row
 * that reports itself two different ways depending on which column a query
 * reads — and both are read, in different reports.
 */
import type { Task } from '../store/taskStore';
import {
  insertSplitTasks,
  deleteTask as repoDelete,
  fetchTasksPage,
  insertTask as repoInsert,
  searchTasks as repoSearch,
  updateTask as repoUpdate,
} from '../repositories/taskRepository';
import type { Cursor } from '../repositories/shared';

export const listTasks = (cursor?: Cursor | null, limit?: number) => fetchTasksPage(cursor, limit);
export const searchTasks = (q: string, limit?: number) => repoSearch(q, limit);
export const createTask = (input: Partial<Task>) => repoInsert(input);
export const patchTask = (id: string, patch: Partial<Task>) => repoUpdate(id, patch);
export const removeTask = (id: string) => repoDelete(id);

/**
 * Sets completion, keeping `completed`, `status` and `completed_at`
 * consistent — the invariant, in one place.
 */
export function setCompleted(id: string, completed: boolean) {
  return repoUpdate(id, {
    completed,
    status: completed ? 'completed' : 'pending',
    completed_at: completed ? new Date().toISOString() : null,
  } as Partial<Task>);
}

/** Archiving is a status change, not a delete — the row stays for reports. */
export const archiveTask = (id: string) =>
  repoUpdate(id, { status: 'cancelled' } as Partial<Task>);

export const moveToList = (id: string, listType: Task['list_type']) =>
  repoUpdate(id, { list_type: listType } as Partial<Task>);

/** The ADHD splitter's bulk insert. */
export const createSubtasks = (rows: Parameters<typeof insertSplitTasks>[0]) => insertSplitTasks(rows);
