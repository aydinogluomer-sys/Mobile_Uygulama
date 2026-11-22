/**
 * `tasks` insert.  (Phase 1 repository layer, plan §5 Rule 4)
 *
 * Only the single insert path `ADHDTaskSplitter` needs is covered here --
 * `store/taskStore.ts` owns the rest of the `tasks` table's CRUD and is out
 * of scope for this task (CODER-D territory / the store layer, not touched).
 */
import type { TableInsert, TableUpdate } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import type { Task } from '../lib/taskTypes';
import { likeContains } from './likePattern';
import {
  currentUserId, deleteOwned, fetchPage, isTransportFailure, updateOwned,
  type Cursor, type Page, type RepoResult,
} from './shared';

const TASK_COLS =
  'id,user_id,title,description,category,due_date,time_block_start,time_block_end,completed,completed_at,is_subtask,parent_task_id,created_at,updated_at,list_name,status,priority,list_type,project_id,notes_text,quadrant';

export type SplitTaskInput = {
  title: string;
  description: string;
  status: 'pending';
  priority: Task['priority'];
  due_date: string | null;
  project_id: string | null;
  list_type: Task['list_type'];
  completed: boolean;
};

/**
 * Inserts the ADHD-split subtasks for the current user, attaching `user_id`
 * here rather than trusting the caller to set it.
 */
export async function insertSplitTasks(rows: SplitTaskInput[]): Promise<RepoResult<Task[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const payload = rows.map((row) => ({ ...row, user_id: u.userId }));
  const { data, error } = await supabase.from('tasks').insert(payload).select(TASK_COLS);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as Task[] };
}

// ---------------------------------------------------------------------------
// Full CRUD. (§8 — moved out of store/taskStore.ts)
//
// The store's own calls had the same three problems as every other store's:
// `fetchTasks` was unbounded and unscoped, `updateTask`/`removeTask` matched
// on `id` alone, and `removeTask` discarded its result.
// ---------------------------------------------------------------------------

export async function fetchTasksPage(
  cursor?: Cursor | null,
  limit?: number,
): Promise<RepoResult<Page<Task>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return fetchPage<Task>({
    table: 'tasks', columns: TASK_COLS, orderBy: 'created_at',
    userId: u.userId, cursor, limit,
    // Cancelled tasks are hidden, as the store did with `.neq`.
    not: { status: 'cancelled' },
  });
}

export async function insertTask(input: Partial<Task>): Promise<RepoResult<Task>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('tasks')
    .insert({
      user_id: u.userId,
      title: input.title ?? '',
      status: input.status ?? 'pending',
      priority: input.priority ?? 'none',
      list_type: input.list_type ?? 'inbox',
      due_date: input.due_date ?? null,
      project_id: input.project_id ?? null,
      description: input.description ?? null,
      notes_text: input.notes_text ?? null,
      completed: false,
    })
    .select(TASK_COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as Task };
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<RepoResult<Task>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<Task>({
    table: 'tasks', id, userId: u.userId,
    patch: patch as Record<string, unknown>, columns: TASK_COLS,
  });
}

export async function deleteTask(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'tasks', id, userId: u.userId });
}

/**
 * Server-side title search. (§30)
 *
 * The command palette filtered the in-memory `tasks` array, which searched
 * whatever page happened to be loaded — a design that only looked correct
 * while the store held the entire table. Bounded here rather than by loading
 * everything into memory to filter it.
 */
export async function searchTasks(query: string, limit = 8): Promise<RepoResult<Task[]>> {
  const pattern = likeContains(query);
  if (pattern === null) return { ok: true, data: [] };
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLS)
    .eq('user_id', u.userId)
    .eq('completed', false)
    .ilike('title', pattern)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 25));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as Task[] };
}

// ---------------------------------------------------------------------------
// R02.03 — outbox delivery. Each is safe to repeat: a create carries its
// client-made id (a re-delivery hits the primary key, 23505), an update is
// a set of absolute values checked against the version it was made on, and
// a delete of a row that is already gone reports that rather than failing.
// ---------------------------------------------------------------------------

/**
 * `expectedUserId` is the account the command was made by. If the session now
 * belongs to someone else the write is refused here, before it can land in
 * the wrong account (R02.06) -- the runner checks too; this is the backstop.
 */
function wrongAccount(expected: string | undefined, actual: string): RepoResult<never> | null {
  return expected !== undefined && expected !== actual ? { ok: false, error: 'Oturum başka bir hesaba ait.', status: 401 } : null;
}

export async function insertTaskRow(row: Partial<Task> & { id: string }, expectedUserId?: string): Promise<RepoResult<Task>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const wrong = wrongAccount(expectedUserId, u.userId);
  if (wrong) return wrong;
  const { data, error, status } = await supabase
    .from('tasks')
    .insert({ ...row, title: row.title ?? '', user_id: u.userId } as TableInsert<'tasks'>)
    .select(TASK_COLS)
    .single();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: data as unknown as Task };
}

/** `row` null + `exists` true = the version moved on (conflict); `exists` false = deleted. */
export async function updateTaskVersioned(
  id: string, patch: Partial<Task>, baseVersion: string | null, expectedUserId?: string,
): Promise<RepoResult<{ row: Task | null; exists: boolean }>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const wrong = wrongAccount(expectedUserId, u.userId);
  if (wrong) return wrong;
  let q = supabase.from('tasks').update(patch as TableUpdate<'tasks'>).eq('id', id).eq('user_id', u.userId);
  if (baseVersion !== null) q = q.eq('updated_at', baseVersion);
  const { data, error, status } = await q.select(TASK_COLS).maybeSingle();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  if (data) return { ok: true, data: { row: data as unknown as Task, exists: true } };
  const probe = await supabase.from('tasks').select('id').eq('id', id).eq('user_id', u.userId).maybeSingle();
  if (probe.error) return { ok: false, error: probe.error.message, offline: isTransportFailure(probe.status, probe.error), status: probe.status, code: probe.error.code };
  return { ok: true, data: { row: null, exists: !!probe.data } };
}

/** One task as the server has it now, or null if it is gone. */
export async function fetchTaskRow(id: string): Promise<RepoResult<Task | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase.from('tasks').select(TASK_COLS).eq('id', id).eq('user_id', u.userId).maybeSingle();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: (data ?? null) as unknown as Task | null };
}

export async function deleteTaskIfPresent(id: string, expectedUserId?: string): Promise<RepoResult<{ deleted: boolean }>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const wrong = wrongAccount(expectedUserId, u.userId);
  if (wrong) return wrong;
  const { data, error, status } = await supabase
    .from('tasks').delete().eq('id', id).eq('user_id', u.userId).select('id');
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: { deleted: !!data && data.length > 0 } };
}
