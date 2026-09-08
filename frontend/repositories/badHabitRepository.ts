/**
 * `bad_habits` data access.  (plan §8; migration 009_retire_legacy_backend)
 *
 * Replaces `badHabitAPI` in `utils/api.ts`, which called the FastAPI service
 * in `backend/server.py`. That service has no authentication at all and
 * stores every row under `user_id = "default"`, so on it one user's quit
 * list was literally every user's quit list. Here the rows are owner-scoped
 * by RLS and by an explicit filter.
 *
 * The savings arithmetic that used to live in a `/bad-habits/{id}/savings`
 * endpoint is not here — it is derived, not stored, so it belongs in
 * `services/badHabitService.ts` where it can be tested without a database.
 */
import { supabase } from '../lib/supabase';
import {
  currentUserId, deleteOwned, fetchPage, updateOwned,
  type Cursor, type Page, type RepoResult,
} from './shared';

export type BadHabitRow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  quit_date: string;
  cost_per_day: number;
  time_wasted_per_day: number;
  created_at: string;
};

const COLS = 'id,user_id,name,description,quit_date,cost_per_day,time_wasted_per_day,created_at';

export async function fetchBadHabitsPage(
  cursor?: Cursor | null,
  limit?: number,
): Promise<RepoResult<Page<BadHabitRow>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return fetchPage<BadHabitRow>({
    table: 'bad_habits', columns: COLS, orderBy: 'created_at',
    userId: u.userId, cursor, limit,
  });
}

export async function insertBadHabit(input: {
  name: string;
  description?: string | null;
  quitDate?: string;
  costPerDay?: number;
  timeWastedPerDay?: number;
}): Promise<RepoResult<BadHabitRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('bad_habits')
    .insert({
      user_id: u.userId,
      name: input.name,
      description: input.description ?? null,
      quit_date: input.quitDate ?? new Date().toISOString(),
      cost_per_day: input.costPerDay ?? 0,
      time_wasted_per_day: input.timeWastedPerDay ?? 0,
    })
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as BadHabitRow };
}

export async function updateBadHabit(
  id: string,
  patch: Partial<Pick<BadHabitRow, 'name' | 'description' | 'quit_date' | 'cost_per_day' | 'time_wasted_per_day'>>,
): Promise<RepoResult<BadHabitRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<BadHabitRow>({ table: 'bad_habits', id, userId: u.userId, patch, columns: COLS });
}

export async function deleteBadHabit(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'bad_habits', id, userId: u.userId });
}
