/**
 * `focus_tasks` reads.  (Phase 1 repository layer, plan §5 Rule 4)
 */
import type { TableRow } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { requireComplete, selectAllPages } from './pagedSelect';
import {
  currentUserId,
  deleteOwned,
  fetchOwnedRow,
  updateOwned,
  updateOwnedVersioned,
  type RepoResult,
} from './shared';

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

export type FocusTaskProgress = {
  id: string;
  completed: boolean | null;
  estimated_pomodoros: number | null;
  completed_pomodoros: number | null;
  total_focus_seconds: number | null;
  updated_at: string | null;
};

export const FOCUS_TASK_PROGRESS_COLUMNS =
  'id,completed,estimated_pomodoros,completed_pomodoros,total_focus_seconds,updated_at';

export const MAX_PROGRESS_ATTEMPTS = 3;

export function fetchFocusTaskProgress(id: string): Promise<RepoResult<FocusTaskProgress | null>> {
  return fetchOwnedRow<FocusTaskProgress>({
    table: 'focus_tasks',
    id,
    columns: FOCUS_TASK_PROGRESS_COLUMNS,
  });
}

/** Koşullu artış: taze okur, sürüm kaymışsa yeniden dener; mutlak değer yazmaz. */
export async function addFocusTaskProgress(input: {
  id: string;
  pomodoros: number;
  seconds: number;
  expectedUserId?: string;
}): Promise<RepoResult<FocusTaskProgress>> {
  const addP = Math.max(0, Math.round(input.pomodoros));
  const addS = Math.max(0, Math.round(input.seconds));
  for (let attempt = 1; attempt <= MAX_PROGRESS_ATTEMPTS; attempt++) {
    const cur = await fetchFocusTaskProgress(input.id);
    if (!cur.ok) return cur;
    if (!cur.data) return { ok: false, error: 'Odak görevi bulunamadı.' };
    const res = await updateOwnedVersioned<FocusTaskProgress>({
      table: 'focus_tasks',
      id: input.id,
      columns: FOCUS_TASK_PROGRESS_COLUMNS,
      baseVersion: cur.data.updated_at,
      expectedUserId: input.expectedUserId,
      patch: {
        completed_pomodoros: (cur.data.completed_pomodoros ?? 0) + addP,
        total_focus_seconds: (cur.data.total_focus_seconds ?? 0) + addS,
      },
    });
    if (!res.ok) return res;
    if (res.data.row) return { ok: true, data: res.data.row };
    if (!res.data.exists) return { ok: false, error: 'Odak görevi bulunamadı.' };
  }
  return {
    ok: false,
    error: 'Görev ilerlemesi eşzamanlı güncelleme yüzünden yazılamadı.',
    code: 'CAS_EXHAUSTED',
  };
}

/** Teslim edilen oturum satırından kredi: yalnız tamamlanmış çalışma oturumu ve görev kimliği varsa. */
export function creditOf(row: Record<string, unknown>): { taskId: string; seconds: number } | null {
  if (row.mode !== 'work' || row.completed !== true) return null;
  if (typeof row.task_id !== 'string' || row.task_id.length === 0) return null;
  const s = Number(row.completed_seconds);
  return { taskId: row.task_id, seconds: Number.isFinite(s) && s > 0 ? Math.round(s) : 0 };
}

/** Asla throw etmez; kredi gerekmiyorsa null döner. */
export async function creditFocusTaskForSession(
  row: Record<string, unknown>,
): Promise<RepoResult<FocusTaskProgress> | null> {
  const credit = creditOf(row);
  if (!credit) return null;
  try {
    return await addFocusTaskProgress({ id: credit.taskId, pomodoros: 1, seconds: credit.seconds });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Görev ilerlemesi yazılamadı.' };
  }
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
  return { ok: true, data: data ?? [] };
}
