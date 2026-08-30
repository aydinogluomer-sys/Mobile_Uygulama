/**
 * `goals` data access.  (plan §5 Rule 4)
 *
 * Replaces the direct calls in `store/goalStore.ts`.
 *
 * `kind` is constrained by `goals_kind_check` to `yearly|quarterly|monthly`
 * — verified against the live constraint rather than inferred from the store,
 * which typed it loosely enough that an invalid value would only fail at
 * insert time.
 */
import { supabase } from '../lib/supabase';
import {
  currentUserId, deleteOwned, fetchPage, updateOwned,
  type Cursor, type Page, type RepoResult,
} from './shared';

export type GoalKind = 'yearly' | 'quarterly' | 'monthly';

export type GoalRow = {
  id: string;
  user_id: string;
  kind: GoalKind;
  title: string;
  progress: number;
  year: number | null;
  quarter: number | null;
  month: number | null;
  archived: boolean;
  created_at: string;
};

const COLS = 'id,user_id,kind,title,progress,year,quarter,month,archived,created_at';

export async function fetchGoalsPage(
  cursor?: Cursor | null,
  limit?: number,
  opts?: { includeArchived?: boolean },
): Promise<RepoResult<Page<GoalRow>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return fetchPage<GoalRow>({
    table: 'goals', columns: COLS, orderBy: 'created_at',
    userId: u.userId, cursor, limit,
    match: opts?.includeArchived ? undefined : { archived: false },
  });
}

export async function insertGoal(input: {
  kind: GoalKind;
  title: string;
  /** Starting progress. Clamped to the live 0..100 check, as updates are. */
  progress?: number;
  year?: number | null;
  quarter?: number | null;
  month?: number | null;
}): Promise<RepoResult<GoalRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('goals')
    .insert({
      user_id: u.userId,
      kind: input.kind,
      title: input.title,
      progress: Math.max(0, Math.min(100, Math.round(input.progress ?? 0))),
      year: input.year ?? null,
      quarter: input.quarter ?? null,
      month: input.month ?? null,
      archived: false,
    })
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as GoalRow };
}

export async function updateGoalProgress(id: string, progress: number): Promise<RepoResult<GoalRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  // `goals_progress_check` is 0..100 live; clamping here turns a constraint
  // violation into a sane value rather than a failed write the UI ignored.
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  return updateOwned<GoalRow>({
    table: 'goals', id, userId: u.userId, patch: { progress: clamped }, columns: COLS,
  });
}

export async function archiveGoal(id: string): Promise<RepoResult<GoalRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<GoalRow>({
    table: 'goals', id, userId: u.userId, patch: { archived: true }, columns: COLS,
  });
}

export async function deleteGoal(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'goals', id, userId: u.userId });
}
