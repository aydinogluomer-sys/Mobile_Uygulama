/**
 * `projects` data access.  (plan §5 Rule 4, §13 pagination)
 *
 * Replaces the direct calls in `store/projectStore.ts`. Same three
 * corrections as `noteRepository`: the list query had no user filter and no
 * bound, the mutations were keyed on `id` alone, and every result was
 * discarded.
 */
import { supabase } from '../lib/supabase';
import {
  currentUserId, deleteOwned, fetchPage, updateOwned,
  type Cursor, type Page, type RepoResult,
} from './shared';

export type ProjectRow = {
  id: string;
  user_id: string;
  name: string;
  color: string | null;
  description: string | null;
  status: string;
  created_at: string;
};

const COLS = 'id,user_id,name,color,description,status,created_at';

export async function fetchProjectsPage(
  cursor?: Cursor | null,
  limit?: number,
  opts?: { includeArchived?: boolean },
): Promise<RepoResult<Page<ProjectRow>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return fetchPage<ProjectRow>({
    table: 'projects', columns: COLS, orderBy: 'created_at',
    userId: u.userId, cursor, limit,
    // Archiving is a soft delete, so the default list EXCLUDES archived —
    // it does not include only `active`. `completed` projects are still
    // shown, which is what the store did with `.neq('status','archived')`.
    not: opts?.includeArchived ? undefined : { status: 'archived' },
  });
}

export async function insertProject(input: {
  name: string;
  color?: string | null;
  description?: string | null;
}): Promise<RepoResult<ProjectRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: u.userId,
      name: input.name,
      color: input.color ?? null,
      description: input.description ?? null,
      status: 'active',
    })
    .select(COLS)
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: data as unknown as ProjectRow };
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<ProjectRow, 'name' | 'color' | 'description' | 'status'>>,
): Promise<RepoResult<ProjectRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return updateOwned<ProjectRow>({ table: 'projects', id, userId: u.userId, patch, columns: COLS });
}

/** Soft delete — the store archived rather than removed, and that stands. */
export async function archiveProject(id: string): Promise<RepoResult<ProjectRow>> {
  return updateProject(id, { status: 'archived' });
}

export async function deleteProject(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'projects', id, userId: u.userId });
}
