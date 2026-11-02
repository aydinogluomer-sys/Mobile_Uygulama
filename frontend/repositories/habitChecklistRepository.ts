/**
 * `habit_checklist_items` + `habit_checklist_checks` data access.  (R01.04)
 *
 * From `supabase/migrations/029_habit_checklists.sql`, WRITTEN BUT NOT
 * APPLIED while the canonical project is frozen. Reads are fail-open on a
 * missing table only (`available: false`, no rows); any other error is an
 * error. Same rule as `habitPauseRepository`.
 */
import { supabase } from '../lib/supabase';
import type { ChecklistCheck, ChecklistItem } from '../lib/habitChecklist';
import { isMissingTable, type Optional } from './habitPauseRepository';
import { currentUserId, isTransportFailure, updateOwned, type RepoResult } from './shared';

const ITEM_COLS = 'id,habit_id,title,required,position,created_at,archived_at';
const CHECK_COLS = 'item_id,habit_id,day';

export async function fetchChecklistItems(): Promise<RepoResult<Optional<ChecklistItem>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('habit_checklist_items')
    .select(ITEM_COLS)
    .eq('user_id', u.userId)
    .order('position', { ascending: true })
    .limit(2000);
  if (isMissingTable(error)) return { ok: true, data: { available: false, rows: [] } };
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error) };
  return { ok: true, data: { available: true, rows: (data ?? []) as unknown as ChecklistItem[] } };
}

/** Checks on or after `sinceDay` -- the screens read today and the recent past. */
export async function fetchChecklistChecks(sinceDay: string): Promise<RepoResult<Optional<ChecklistCheck>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('habit_checklist_checks')
    .select(CHECK_COLS)
    .eq('user_id', u.userId)
    .gte('day', sinceDay)
    .limit(5000);
  if (isMissingTable(error)) return { ok: true, data: { available: false, rows: [] } };
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error) };
  return { ok: true, data: { available: true, rows: (data ?? []) as unknown as ChecklistCheck[] } };
}

export async function insertChecklistItem(input: { habit_id: string; title: string; required: boolean; position: number }): Promise<RepoResult<ChecklistItem>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('habit_checklist_items')
    .insert({ ...input, user_id: u.userId })
    .select(ITEM_COLS)
    .single();
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error) };
  return { ok: true, data: data as unknown as ChecklistItem };
}

export async function patchChecklistItem(id: string, patch: Partial<Pick<ChecklistItem, 'title' | 'required' | 'position' | 'archived_at'>>): Promise<RepoResult<ChecklistItem>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<ChecklistItem>({ table: 'habit_checklist_items', id, userId: u.userId, patch, columns: ITEM_COLS });
}

/** Tick: idempotent on (item_id, day) -- a retried tap lands on the same row. */
export async function insertCheck(check: ChecklistCheck): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { error, status } = await supabase
    .from('habit_checklist_checks')
    .upsert({ ...check, user_id: u.userId }, { onConflict: 'item_id,day', ignoreDuplicates: true });
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error) };
  return { ok: true, data: true };
}

/** Untick. Removing a check that is not there is not an error -- the end state is the same. */
export async function deleteCheck(check: ChecklistCheck): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { error, status } = await supabase
    .from('habit_checklist_checks')
    .delete()
    .eq('user_id', u.userId)
    .eq('item_id', check.item_id)
    .eq('day', check.day);
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error) };
  return { ok: true, data: true };
}
