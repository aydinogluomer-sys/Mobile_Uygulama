/**
 * `focus_tasks` reads.  (Phase 1 repository layer, plan §5 Rule 4)
 */
import type { TableRow } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { requireComplete, selectAllPages } from './pagedSelect';
import { currentUserId, deleteOwned, updateOwned, type RepoResult } from './shared';

/** The focus_tasks columns the focus service reads, plus optional export-only columns (selected, color, updated_at). */
export type FocusTaskRow = Pick<
  TableRow<'focus_tasks'>,
  | 'id'
  | 'user_id'
  | 'title'
  | 'completed'
  | 'estimated_pomodoros'
  | 'completed_pomodoros'
  | 'total_focus_seconds'
  | 'created_at'
> &
  Partial<Pick<TableRow<'focus_tasks'>, 'selected' | 'color' | 'updated_at'>>;

export const FOCUS_TASK_COLUMNS =
  'id,user_id,title,completed,selected,estimated_pomodoros,completed_pomodoros,total_focus_seconds,color,created_at,updated_at';

/**
 * Every column, oldest task first -- source for `FocusSettingsModal`'s full
 * data export (JSON/CSV/Excel).
 */
export async function fetchAllFocusTasks(): Promise<RepoResult<FocusTaskRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const r = await selectAllPages<FocusTaskRow>((from, to) =>
    supabase
      .from('focus_tasks')
      .select(FOCUS_TASK_COLUMNS)
      .eq('user_id', u.userId)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  );
  return requireComplete(r, 'Odak görevleri');
}

// ---------------------------------------------------------------------------
// Mutations. (§8 — moved out of store/focusStore.ts, where both were keyed on
// `id` alone and discarded their result.)
// ---------------------------------------------------------------------------

export async function insertFocusTask(input: {
  title: string;
  estimatedPomodoros?: number;
}): Promise<RepoResult<FocusTaskRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('focus_tasks')
    .insert({
      user_id: u.userId,
      title: input.title,
      estimated_pomodoros: Math.max(1, Math.round(input.estimatedPomodoros ?? 1)),
      completed: false,
    })
    .select(FOCUS_TASK_COLUMNS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data };
}

export async function completeFocusTask(id: string): Promise<RepoResult<FocusTaskRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<FocusTaskRow>({
    table: 'focus_tasks', id, userId: u.userId, patch: { completed: true }, columns: FOCUS_TASK_COLUMNS,
  });
}

export async function deleteFocusTask(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'focus_tasks', id, userId: u.userId });
}

/** Bumps the pomodoro counter on a focus task the caller owns. */
export async function setFocusTaskProgress(input: {
  id: string;
  completedPomodoros: number;
  totalFocusSeconds: number;
}): Promise<RepoResult<FocusTaskRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<FocusTaskRow>({
    table: 'focus_tasks', id: input.id, userId: u.userId,
    patch: {
      completed_pomodoros: Math.max(0, Math.round(input.completedPomodoros)),
      total_focus_seconds: Math.max(0, Math.round(input.totalFocusSeconds)),
    },
    columns: FOCUS_TASK_COLUMNS,
  });
}

/** Open (incomplete) focus tasks for the current user, newest last. */
export async function fetchOpenFocusTasks(limit = 100): Promise<RepoResult<FocusTaskRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('focus_tasks')
    .select(FOCUS_TASK_COLUMNS)
    .eq('user_id', u.userId)
    .eq('completed', false)
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as FocusTaskRow[] };
}
