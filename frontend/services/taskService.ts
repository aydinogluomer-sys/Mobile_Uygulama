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
  insertTaskRow, updateTaskVersioned, deleteTaskIfPresent, fetchTaskRow,
} from '../repositories/taskRepository';
import type { DeliveryOutcome, OutboxCommand } from '../lib/outbox';
import { classifyFailure } from './outboxRunner';
import type { Cursor } from '../repositories/shared';
import { notify } from './webhookService';

export const listTasks = (cursor?: Cursor | null, limit?: number) => fetchTasksPage(cursor, limit);
export const searchTasks = (q: string, limit?: number) => repoSearch(q, limit);
export const createTask = (input: Partial<Task>) => repoInsert(input);
export const patchTask = (id: string, patch: Partial<Task>) => repoUpdate(id, patch);
export const removeTask = (id: string) => repoDelete(id);

/**
 * Sets completion, keeping `completed`, `status` and `completed_at`
 * consistent — the invariant, in one place.
 */
export function completionPatch(completed: boolean, now: Date = new Date()): Partial<Task> {
  return {
    completed,
    status: completed ? 'completed' : 'pending',
    completed_at: completed ? now.toISOString() : null,
  } as Partial<Task>;
}

export async function setCompleted(id: string, completed: boolean) {
  const res = await repoUpdate(id, completionPatch(completed));
  // Only for a write the database accepted, and only in the completing
  // direction -- un-ticking a task is not a completion event.
  if (res.ok && completed) {
    notify('task_completed', { task_id: id, title: res.data?.title ?? null });
  }
  return res;
}

/** Archiving is a status change, not a delete — the row stays for reports. */
export const archiveTask = (id: string) =>
  repoUpdate(id, { status: 'cancelled' } as Partial<Task>);

export const moveToList = (id: string, listType: Task['list_type']) =>
  repoUpdate(id, { list_type: listType } as Partial<Task>);

/** The ADHD splitter's bulk insert. */
export const createSubtasks = (rows: Parameters<typeof insertSplitTasks>[0]) => insertSplitTasks(rows);

// ── R02.03 — the task transport for the outbox ─────────────────────────────

/** The columns a locally created task is inserted with (its id is client-made). */
export function newTaskRow(id: string, input: Partial<Task>, now: Date = new Date()): Partial<Task> & { id: string } {
  return {
    id,
    title: input.title ?? '',
    status: input.status ?? 'pending',
    priority: input.priority ?? 'none',
    list_type: input.list_type ?? 'inbox',
    due_date: input.due_date ?? null,
    project_id: input.project_id ?? null,
    description: input.description ?? null,
    notes_text: input.notes_text ?? null,
    completed: false,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  } as Partial<Task> & { id: string };
}

/**
 * Deliver one task command. Every branch is safe to repeat:
 *  create  23505 on the primary key = this very create already landed
 *  update  absolute values, checked against the version they were made on;
 *          a moved version is a CONFLICT (never applied over someone else's
 *          edit), a missing row is GONE
 *  delete  a row that is already gone counts as deleted
 * A completion that lands fires the same webhook `setCompleted` does.
 */
/**
 * Does the server row already carry every value of the payload? Timestamps
 * are compared as instants (Postgres returns its own format).
 */
export function alreadyHolds(row: Record<string, unknown> | object, payload: Record<string, unknown>): boolean {
  const r = row as Record<string, unknown>;
  return Object.keys(payload).every((k) => {
    const a = payload[k];
    const b = r[k];
    if (a === b) return true;
    if (a == null || b == null) return a == null && b == null;
    if (typeof a === 'string' && typeof b === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(a) && /^\d{4}-\d{2}-\d{2}T/.test(b)) {
      return Date.parse(a) === Date.parse(b);
    }
    return false;
  });
}

export async function deliverTaskCommand(cmd: OutboxCommand): Promise<DeliveryOutcome> {
  if (cmd.kind === 'create') {
    const res = await insertTaskRow({ ...(cmd.payload as Partial<Task>), id: cmd.entityId }, cmd.userId);
    if (res.ok) return { kind: 'applied', version: res.data.updated_at ?? null };
    if (res.code === '23505') return { kind: 'applied' };
    return classifyFailure(res);
  }
  if (cmd.kind === 'update') {
    const patch = { ...(cmd.payload as Partial<Task>), updated_at: new Date().toISOString() };
    const res = await updateTaskVersioned(cmd.entityId, patch, cmd.baseVersion, cmd.userId);
    if (!res.ok) return classifyFailure(res);
    if (!res.data.exists) return { kind: 'gone' };
    if (!res.data.row) {
      // The version moved. If the server already holds exactly these values,
      // the move was THIS command landing before the app could record it (a
      // crash, a lost response): it is applied, not a conflict with ourselves.
      const cur = await fetchTaskRow(cmd.entityId);
      if (!cur.ok) return classifyFailure(cur);
      if (!cur.data) return { kind: 'gone' };
      if (alreadyHolds(cur.data, cmd.payload)) return { kind: 'applied', version: cur.data.updated_at ?? null };
      return { kind: 'conflict', error: 'Bu görev başka bir yerde değiştirilmiş.' };
    }
    if ((cmd.payload as Partial<Task>).completed === true) {
      notify('task_completed', { task_id: cmd.entityId, title: res.data.row.title ?? null });
    }
    return { kind: 'applied', version: res.data.row.updated_at ?? null };
  }
  const res = await deleteTaskIfPresent(cmd.entityId, cmd.userId);
  if (!res.ok) return classifyFailure(res);
  return { kind: 'applied' };
}
