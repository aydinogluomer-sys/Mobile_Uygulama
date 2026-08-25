/**
 * `tasks` insert.  (Phase 1 repository layer, plan §5 Rule 4)
 *
 * Only the single insert path `ADHDTaskSplitter` needs is covered here --
 * `store/taskStore.ts` owns the rest of the `tasks` table's CRUD and is out
 * of scope for this task (CODER-D territory / the store layer, not touched).
 */
import { supabase } from '../lib/supabase';
import type { Task } from '../store/taskStore';
import { currentUserId, RepoResult } from './shared';

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
