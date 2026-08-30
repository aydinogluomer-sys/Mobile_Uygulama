/**
 * `focus_tasks` reads.  (Phase 1 repository layer, plan §5 Rule 4)
 */
import { supabase } from '../lib/supabase';
import { currentUserId, deleteOwned, updateOwned, type RepoResult } from './shared';

export type FocusTaskRow = {
  id: string;
  user_id: string;
  title: string | null;
  completed: boolean | null;
  estimated_pomodoros: number | null;
  completed_pomodoros: number | null;
  total_focus_seconds: number | null;
  created_at: string;
};

/**
 * Every column, oldest task first -- source for `FocusSettingsModal`'s full
 * data export (JSON/CSV/Excel).
 */
export async function fetchAllFocusTasks(): Promise<RepoResult<FocusTaskRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('focus_tasks')
    .select('*')
    .eq('user_id', u.userId)
    .order('created_at', { ascending: true })
    // Export reads the whole collection by design; the cap keeps "whole"
    // finite, for the same reason as the session export.
    .limit(2000);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as FocusTaskRow[] };
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
    .select('*')
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as FocusTaskRow };
}

export async function completeFocusTask(id: string): Promise<RepoResult<FocusTaskRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<FocusTaskRow>({
    table: 'focus_tasks', id, userId: u.userId, patch: { completed: true },
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
  });
}

/** Open (incomplete) focus tasks for the current user, newest last. */
export async function fetchOpenFocusTasks(limit = 100): Promise<RepoResult<FocusTaskRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('focus_tasks')
    .select('*')
    .eq('user_id', u.userId)
    .eq('completed', false)
    .order('created_at', { ascending: true })
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as unknown as FocusTaskRow[] };
}
