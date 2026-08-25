/**
 * `focus_tasks` reads.  (Phase 1 repository layer, plan §5 Rule 4)
 */
import { supabase } from '../lib/supabase';
import { currentUserId, RepoResult } from './shared';

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
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as FocusTaskRow[] };
}
