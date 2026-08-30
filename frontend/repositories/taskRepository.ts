/**
 * `tasks` insert.  (Phase 1 repository layer, plan §5 Rule 4)
 *
 * Only the single insert path `ADHDTaskSplitter` needs is covered here --
 * `store/taskStore.ts` owns the rest of the `tasks` table's CRUD and is out
 * of scope for this task (CODER-D territory / the store layer, not touched).
 */
import { supabase } from '../lib/supabase';
import type { Task } from '../store/taskStore';
import {
  currentUserId, deleteOwned, fetchPage, updateOwned,
  type Cursor, type Page, type RepoResult,
} from './shared';

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
  const { data, error } = await supabase.from('tasks').insert(payload).select();
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

const TASK_COLS =
  'id,user_id,title,description,category,due_date,time_block_start,time_block_end,' +
  'completed,completed_at,is_subtask,parent_task_id,created_at,updated_at,list_name,' +
  'status,priority,list_type,project_id,notes_text,quadrant';

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
  const u = await currentUserId();
  if (!u.ok) return u;
  const term = query.trim();
  if (!term) return { ok: true, data: [] };
  const safe = term.replace(/[,()%]/g, ' ');
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_COLS)
    .eq('user_id', u.userId)
    .eq('completed', false)
    .ilike('title', `%${safe}%`)
    .order('created_at', { ascending: false })
    .limit(Math.min(limit, 25));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as Task[] };
}
