/**
 * `focus_sessions` reads/deletes.  (Phase 1 repository layer, plan §5 Rule 4)
 */
import { supabase } from '../lib/supabase';
import type { FocusSessionRow } from '../lib/focusReport';
import { currentUserId, RepoResult, insertOwnedWithId } from './shared';

export type ReviewFocusSecondsRow = { completed_seconds: number };
export type FocusSessionFullRow = FocusSessionRow & { user_id: string };

const REPORT_COLS = 'id,task_id,task_title,mode,started_at,ended_at,planned_seconds,completed_seconds,completed';

/**
 * `completed_seconds` only, for a `started_at` date range -- source for
 * `focusMinutesFromSessions` on the weekly and monthly review screens.
 */
export async function fetchFocusSecondsForReview(params: {
  start: string;
  end: string;
}): Promise<RepoResult<ReviewFocusSecondsRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('focus_sessions')
    .select('completed_seconds')
    .eq('user_id', u.userId)
    .gte('started_at', params.start)
    .lte('started_at', `${params.end}T23:59:59`);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as ReviewFocusSecondsRow[] };
}

/**
 * Report-shaped columns since a given ISO instant, newest first -- shared by
 * `FocusSessionCompleteModal` (last week) and `FocusReportModal` (last year).
 */
export async function fetchFocusSessionsSince(params: {
  sinceIso: string;
}): Promise<RepoResult<FocusSessionRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('focus_sessions')
    .select(REPORT_COLS)
    .eq('user_id', u.userId)
    .gte('started_at', params.sinceIso)
    .order('started_at', { ascending: false });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as FocusSessionRow[] };
}

/**
 * Every column, newest session first -- source for `FocusSettingsModal`'s
 * full data export (JSON/CSV/Excel).
 */
export async function fetchAllFocusSessions(): Promise<RepoResult<FocusSessionFullRow[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('focus_sessions')
    .select('*')
    .eq('user_id', u.userId)
    .order('started_at', { ascending: false })
    // Export reads the whole collection by design; the cap keeps "whole"
    // finite. 5000 sessions is far beyond any real account, and an export
    // that can grow without limit is a memory failure waiting for one user.
    .limit(5000);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: (data ?? []) as FocusSessionFullRow[] };
}

/**
 * Deletes every `focus_sessions` row owned by the current user -- backs
 * `FocusSettingsModal`'s "clear report data" action.
 */
export async function deleteAllFocusSessions(): Promise<RepoResult<void>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { error } = await supabase.from('focus_sessions').delete().eq('user_id', u.userId);
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

/**
 * Records one completed focus session. (§8 — moved out of store/focusStore.ts.)
 *
 * `user_id` is attached here rather than trusted from the caller, matching
 * every other write in this layer.
 */
// R02.03 — outbox delivery: a session with a client-made id (re-delivery = 23505 = one session).
export const insertFocusSessionRow = (row: Record<string, unknown> & { id: string }, expectedUserId?: string) =>
  insertOwnedWithId<{ id: string }>({ table: 'focus_sessions', row, columns: 'id', expectedUserId });

export async function insertFocusSession(input: {
  taskId: string | null;
  taskTitle: string | null;
  mode: string;
  startedAt: string;
  endedAt: string;
  plannedSeconds: number;
  completedSeconds: number;
}): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { error } = await supabase.from('focus_sessions').insert({
    user_id: u.userId,
    task_id: input.taskId,
    task_title: input.taskTitle,
    mode: input.mode,
    started_at: input.startedAt,
    ended_at: input.endedAt,
    planned_seconds: input.plannedSeconds,
    completed_seconds: input.completedSeconds,
    completed: true,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: true };
}
