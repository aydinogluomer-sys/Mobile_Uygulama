/**
 * `tasks` repository (Phase 1 + R02.03 outbox delivery + E19 duration persistence + E08 narrow schema fallback).
 */
import { registerAccountScoped } from '../lib/accountScope';
import type { TableInsert, TableUpdate } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import type { Task, TaskEstimateSource } from '../lib/taskTypes';
import { likeContains } from './likePattern';
import {
  currentUserId,
  deleteOwned,
  fetchPage,
  isTransportFailure,
  updateOwned,
  type Cursor,
  type Page,
  type RepoResult,
} from './shared';

export const LEGACY_TASK_COLS =
  'id,user_id,title,description,category,due_date,time_block_start,time_block_end,completed,completed_at,is_subtask,parent_task_id,created_at,updated_at,list_name,status,priority,list_type,project_id,notes_text,quadrant';

export const TASK_COLS = `${LEGACY_TASK_COLS},estimated_minutes,estimate_source`;

export type TaskSchemaCapability = 'full' | 'legacy_no_estimate' | 'unknown';

type TaskDbInsert = TableInsert<'tasks'> & {
  estimated_minutes?: number | null;
  estimate_source?: string | null;
};

type TaskDbUpdate = TableUpdate<'tasks'> & {
  estimated_minutes?: number | null;
  estimate_source?: string | null;
};

export type SplitTaskInput = {
  title: string;
  description: string;
  status: 'pending';
  priority: Task['priority'];
  due_date: string | null;
  project_id: string | null;
  list_type: Task['list_type'];
  completed: boolean;
  parent_task_id: string | null;
  is_subtask: boolean;
  estimated_minutes?: number | null;
  estimate_source?: TaskEstimateSource | null;
};

const VALID_ESTIMATE_SOURCES: ReadonlySet<string> = new Set<TaskEstimateSource>([
  'user',
  'ai',
  'block',
  'default',
]);

export const INVALID_TASK_ESTIMATE_ERROR = 'Geçersiz süre tahmini (1-1440 dk olmalı).';

let schemaCapability: TaskSchemaCapability = 'unknown';

export function getTaskSchemaCapability(): TaskSchemaCapability {
  return schemaCapability;
}

export function resetTaskSchemaCapability(): void {
  schemaCapability = 'unknown';
}

function toTask(raw: unknown): Task {
  return raw as Task;
}

function toTaskList(raw: unknown): Task[] {
  return (Array.isArray(raw) ? raw : []) as Task[];
}

function toRepoFailure(error: { message: string; code?: string }, status?: number): RepoResult<never> {
  const offline = isTransportFailure(status, error);
  return {
    ok: false,
    error: error.message,
    ...(offline || status !== undefined ? { offline } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(error.code !== undefined ? { code: error.code } : {}),
  };
}

/**
 * E19 duration & source validator:
 * - `estimated_minutes === undefined`: leaves duration untouched (omitted from patch).
 * - `estimated_minutes === null`: explicitly clears duration to `null` (and `estimate_source` to `null` when omitted).
 * - Integer `1..1440`: accepted.
 * - Any other value (`0`, negative, `> 1440`, `NaN`, fractional): rejected with `400` / `23514`.
 */
export function validateTaskEstimate(input: {
  estimated_minutes?: unknown;
  estimate_source?: unknown;
}): RepoResult<{ estimated_minutes?: number | null; estimate_source?: TaskEstimateSource | null }> {
  const rawMinutes = input.estimated_minutes;
  const rawSource = input.estimate_source;

  if (rawSource !== undefined && rawSource !== null) {
    if (typeof rawSource !== 'string' || !VALID_ESTIMATE_SOURCES.has(rawSource)) {
      return { ok: false, error: INVALID_TASK_ESTIMATE_ERROR, status: 400, code: '23514' };
    }
  }
  const typedSource = rawSource as TaskEstimateSource | null | undefined;

  if (rawMinutes === undefined) {
    return {
      ok: true,
      data: typedSource !== undefined ? { estimate_source: typedSource } : {},
    };
  }

  if (rawMinutes === null) {
    return {
      ok: true,
      data: {
        estimated_minutes: null,
        estimate_source: typedSource === undefined ? null : typedSource,
      },
    };
  }

  if (typeof rawMinutes === 'number' && Number.isInteger(rawMinutes) && rawMinutes >= 1 && rawMinutes <= 1440) {
    return {
      ok: true,
      data: {
        estimated_minutes: rawMinutes,
        ...(typedSource !== undefined ? { estimate_source: typedSource } : {}),
      },
    };
  }

  return { ok: false, error: INVALID_TASK_ESTIMATE_ERROR, status: 400, code: '23514' };
}

/**
 * E08 narrow schema detection: recognizes only missing `estimated_minutes` / `estimate_source`
 * column errors (`42703` / `PGRST204` / column-missing message). Never matches auth (`401`/`42501`)
 * or transport (`offline` / status `0`) failures.
 */
export function isMissingTaskEstimateColumnError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as {
    code?: unknown;
    message?: unknown;
    error?: unknown;
    details?: unknown;
    hint?: unknown;
    status?: unknown;
    offline?: unknown;
  };
  const status = typeof e.status === 'number' ? e.status : undefined;
  const code = typeof e.code === 'string' ? e.code : '';

  if (e.offline === true || status === 0 || status === 401 || status === 403) return false;
  if (code === '42501' || code === 'PGRST301' || code === '23505' || code === '23514') return false;
  if (isTransportFailure(status, error)) return false;

  const text = [e.message, e.error, e.details, e.hint]
    .filter((v): v is string => typeof v === 'string')
    .join(' ');

  const mentionsEstimate = /\b(?:estimated_minutes|estimate_source)\b/i.test(text);
  if (
    mentionsEstimate &&
    (code === '42703' ||
      code === 'PGRST204' ||
      /does not exist|schema cache|could not find|unknown column|undefined column|bulunamad/i.test(text))
  ) {
    return true;
  }

  if (code === '42703' || code === 'PGRST204') {
    const otherCol = /\bcolumn\s+['"]?(?:tasks\.)?([a-z0-9_]+)['"]?/i.exec(text)?.[1];
    if (!otherCol || otherCol === 'estimated_minutes' || otherCol === 'estimate_source') {
      return true;
    }
  }

  return false;
}

async function runWithTaskSchema<T>(
  attempt: (cols: string, useLegacy: boolean) => Promise<RepoResult<T>>,
): Promise<RepoResult<T>> {
  if (schemaCapability === 'legacy_no_estimate') {
    return attempt(LEGACY_TASK_COLS, true);
  }
  const first = await attempt(TASK_COLS, false);
  if (first.ok) {
    schemaCapability = 'full';
    return first;
  }
  if (isMissingTaskEstimateColumnError(first)) {
    schemaCapability = 'legacy_no_estimate';
    return attempt(LEGACY_TASK_COLS, true);
  }
  return first;
}

/**
 * Inserts the ADHD-split subtasks for the current user, attaching `user_id`
 * here rather than trusting the caller to set it.
 */
export async function insertSplitTasks(rows: SplitTaskInput[]): Promise<RepoResult<Task[]>> {
  const u = await currentUserId();
  if (!u.ok) return u;

  const fullPayload: TaskDbInsert[] = [];
  const legacyPayload: TaskDbInsert[] = [];
  for (const row of rows) {
    const est = validateTaskEstimate(row);
    if (!est.ok) return est;
    const { estimated_minutes: _em, estimate_source: _es, ...rest } = row;
    const base: TaskDbInsert = { ...rest, user_id: u.userId };
    legacyPayload.push(base);
    fullPayload.push({ ...base, ...est.data });
  }

  return runWithTaskSchema(async (cols, useLegacy) => {
    const insertRows: TableInsert<'tasks'>[] = useLegacy ? legacyPayload : fullPayload;
    const { data, error, status } = await supabase
      .from('tasks')
      .insert(insertRows)
      .select(cols);
    if (error) return toRepoFailure(error, status);
    return { ok: true, data: toTaskList(data) };
  });
}

// ---------------------------------------------------------------------------
// Full CRUD. (§8 — moved out of store/taskStore.ts)
// ---------------------------------------------------------------------------

export async function fetchTasksPage(
  cursor?: Cursor | null,
  limit?: number,
): Promise<RepoResult<Page<Task>>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return runWithTaskSchema((cols) =>
    fetchPage<Task>({
      table: 'tasks',
      columns: cols,
      orderBy: 'created_at',
      userId: u.userId,
      cursor,
      limit,
      not: { status: 'cancelled' },
    }),
  );
}

export async function insertTask(input: Partial<Task>): Promise<RepoResult<Task>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const est = validateTaskEstimate(input);
  if (!est.ok) return est;

  const legacyBody: TaskDbInsert = {
    user_id: u.userId,
    title: input.title ?? '',
    status: input.status ?? 'pending',
    priority: input.priority ?? 'none',
    list_type: input.list_type ?? 'inbox',
    due_date: input.due_date ?? null,
    time_block_start: input.time_block_start ?? null,
    time_block_end: input.time_block_end ?? null,
    parent_task_id: input.parent_task_id ?? null,
    is_subtask: input.is_subtask ?? false,
    project_id: input.project_id ?? null,
    description: input.description ?? null,
    notes_text: input.notes_text ?? null,
    completed: input.completed ?? false,
    ...(input.quadrant !== undefined ? { quadrant: input.quadrant } : {}),
  };
  const fullBody: TaskDbInsert = { ...legacyBody, ...est.data };

  return runWithTaskSchema(async (cols, useLegacy) => {
    const insertBody: TableInsert<'tasks'> = useLegacy ? legacyBody : fullBody;
    const { data, error, status } = await supabase
      .from('tasks')
      .insert(insertBody)
      .select(cols)
      .single();
    if (error) return toRepoFailure(error, status);
    return { ok: true, data: toTask(data) };
  });
}

export async function updateTask(id: string, patch: Partial<Task>): Promise<RepoResult<Task>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const est = validateTaskEstimate(patch);
  if (!est.ok) return est;
  const { estimated_minutes: _em, estimate_source: _es, ...restPatch } = patch;
  const legacyPatch: Record<string, unknown> = { ...restPatch };
  const fullPatch: Record<string, unknown> = { ...restPatch, ...est.data };

  return runWithTaskSchema((cols, useLegacy) =>
    updateOwned<Task>({
      table: 'tasks',
      id,
      userId: u.userId,
      patch: useLegacy ? legacyPatch : fullPatch,
      columns: cols,
    }),
  );
}

export async function deleteTask(id: string): Promise<RepoResult<true>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return deleteOwned({ table: 'tasks', id, userId: u.userId });
}

/**
 * Server-side title search. (§30)
 */
export async function searchTasks(query: string, limit = 8): Promise<RepoResult<Task[]>> {
  const pattern = likeContains(query);
  if (pattern === null) return { ok: true, data: [] };
  const u = await currentUserId();
  if (!u.ok) return u;
  return runWithTaskSchema(async (cols) => {
    const { data, error, status } = await supabase
      .from('tasks')
      .select(cols)
      .eq('user_id', u.userId)
      .eq('completed', false)
      .ilike('title', pattern)
      .order('created_at', { ascending: false })
      .limit(Math.min(limit, 25));
    if (error) return toRepoFailure(error, status);
    return { ok: true, data: toTaskList(data) };
  });
}

// ---------------------------------------------------------------------------
// R02.03 — outbox delivery.
// ---------------------------------------------------------------------------

function wrongAccount(expected: string | undefined, actual: string): RepoResult<never> | null {
  return expected !== undefined && expected !== actual
    ? { ok: false, error: 'Oturum başka bir hesaba ait.', status: 401 }
    : null;
}

export async function insertTaskRow(row: Partial<Task> & { id: string }, expectedUserId?: string): Promise<RepoResult<Task>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const wrong = wrongAccount(expectedUserId, u.userId);
  if (wrong) return wrong;
  const est = validateTaskEstimate(row);
  if (!est.ok) return est;

  const { estimated_minutes: _em, estimate_source: _es, ...restRow } = row;
  const legacyBody: TaskDbInsert = { ...restRow, title: restRow.title ?? '', user_id: u.userId };
  const fullBody: TaskDbInsert = { ...legacyBody, ...est.data };

  return runWithTaskSchema(async (cols, useLegacy) => {
    const insertBody: TableInsert<'tasks'> = useLegacy ? legacyBody : fullBody;
    const { data, error, status } = await supabase
      .from('tasks')
      .insert(insertBody)
      .select(cols)
      .single();
    if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
    return { ok: true, data: toTask(data) };
  });
}

/** `row` null + `exists` true = the version moved on (conflict); `exists` false = deleted. */
export async function updateTaskVersioned(
  id: string, patch: Partial<Task>, baseVersion: string | null, expectedUserId?: string,
): Promise<RepoResult<{ row: Task | null; exists: boolean }>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const wrong = wrongAccount(expectedUserId, u.userId);
  if (wrong) return wrong;
  const est = validateTaskEstimate(patch);
  if (!est.ok) return est;

  const { estimated_minutes: _em, estimate_source: _es, ...restPatch } = patch;
  const legacyBody: TaskDbUpdate = { ...restPatch };
  const fullBody: TaskDbUpdate = { ...legacyBody, ...est.data };

  const updated = await runWithTaskSchema<Task | null>(async (cols, useLegacy) => {
    const updateBody: TableUpdate<'tasks'> = useLegacy ? legacyBody : fullBody;
    let q = supabase
      .from('tasks')
      .update(updateBody)
      .eq('id', id)
      .eq('user_id', u.userId);
    if (baseVersion !== null) q = q.eq('updated_at', baseVersion);
    const { data, error, status } = await q.select(cols).maybeSingle();
    if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
    return { ok: true, data: data ? toTask(data) : null };
  });

  if (!updated.ok) return updated;
  if (updated.data) return { ok: true, data: { row: updated.data, exists: true } };

  const probe = await supabase.from('tasks').select('id').eq('id', id).eq('user_id', u.userId).maybeSingle();
  if (probe.error) return { ok: false, error: probe.error.message, offline: isTransportFailure(probe.status, probe.error), status: probe.status, code: probe.error.code };
  return { ok: true, data: { row: null, exists: !!probe.data } };
}

/** One task as the server has it now, or null if it is gone. */
export async function fetchTaskRow(id: string): Promise<RepoResult<Task | null>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  return runWithTaskSchema<Task | null>(async (cols) => {
    const { data, error, status } = await supabase
      .from('tasks')
      .select(cols)
      .eq('id', id)
      .eq('user_id', u.userId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
    return { ok: true, data: data ? toTask(data) : null };
  });
}

export async function deleteTaskIfPresent(id: string, expectedUserId?: string): Promise<RepoResult<{ deleted: boolean }>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const wrong = wrongAccount(expectedUserId, u.userId);
  if (wrong) return wrong;
  const { data, error, status } = await supabase
    .from('tasks').delete().eq('id', id).eq('user_id', u.userId).select('id');
  if (error) return { ok: false, error: error.message, offline: isTransportFailure(status, error), status, code: error.code };
  return { ok: true, data: { deleted: !!data && data.length > 0 } };
}

registerAccountScoped({
  name: 'taskRepository',
  onReset: resetTaskSchemaCapability,
});
