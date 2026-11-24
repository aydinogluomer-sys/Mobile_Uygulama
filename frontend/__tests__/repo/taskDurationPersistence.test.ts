/**
 * E19 + E08 — Task duration (`estimated_minutes`, `estimate_source`) persistence across
 * repository, service, and outbox store, plus narrow legacy schema fallback (`42703` / `PGRST204`).
 */
import { resetAccountMemory } from '../../lib/accountScope';
import { memoryOutboxStorage } from '../../lib/outboxStorage';
import { parseQuickAdd, quickAddToTaskInput } from '../../lib/taskQuickAdd';
import type { TaskEstimateSource } from '../../lib/taskTypes';

type SimError = {
  message: string;
  code?: string;
  status?: number;
};

type CallRecord = {
  op: 'select' | 'insert' | 'update' | 'delete';
  cols?: string;
  payload?: unknown;
};

const mockSimDb = {
  activeUserId: 'user-1' as string | null,
  schemaMode: 'full' as 'full' | 'legacy_42703' | 'legacy_pgrst204',
  forcedError: null as SimError | null,
  rows: [] as Record<string, unknown>[],
  calls: [] as CallRecord[],
  seq: 0,
};

function mockNextIso(): string {
  return `2026-11-24T10:00:${String(++mockSimDb.seq).padStart(2, '0')}.000Z`;
}

function mockHasEstimateInCols(cols: string | undefined): boolean {
  if (!cols) return false;
  return /\b(?:estimated_minutes|estimate_source)\b/.test(cols);
}

function mockHasEstimateInPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  if (Array.isArray(payload)) return payload.some(mockHasEstimateInPayload);
  return 'estimated_minutes' in payload || 'estimate_source' in payload;
}

function mockMaybeSchemaOrForcedError(cols: string | undefined, payload?: unknown): {
  data: null;
  error: { message: string; code?: string };
  status?: number;
} | null {
  if (mockSimDb.forcedError) {
    const e = mockSimDb.forcedError;
    return {
      data: null,
      error: { message: e.message, ...(e.code !== undefined ? { code: e.code } : {}) },
      ...(e.status !== undefined ? { status: e.status } : {}),
    };
  }
  if (mockSimDb.schemaMode !== 'full' && (mockHasEstimateInCols(cols) || mockHasEstimateInPayload(payload))) {
    if (mockSimDb.schemaMode === 'legacy_42703') {
      return {
        data: null,
        error: {
          code: '42703',
          message: 'column tasks.estimated_minutes does not exist',
        },
        status: 400,
      };
    }
    return {
      data: null,
      error: {
        code: 'PGRST204',
        message: "Could not find the 'estimate_source' column of 'tasks' in the schema cache",
      },
      status: 400,
    };
  }
  return null;
}

function mockProjectColumns(row: Record<string, unknown>, cols: string | undefined): Record<string, unknown> {
  if (!cols || cols === '*') return { ...row };
  const out: Record<string, unknown> = {};
  for (const rawCol of cols.split(',')) {
    const col = rawCol.trim();
    if (!col) continue;
    if (col in row) {
      out[col] = row[col];
    } else if (mockSimDb.schemaMode === 'full') {
      out[col] = null;
    }
  }
  return out;
}

function mockMatchRow(
  row: Record<string, unknown>,
  eqs: Record<string, unknown>,
  neqs: Record<string, unknown>,
  ilikeTitle: string | null,
): boolean {
  for (const [k, v] of Object.entries(eqs)) {
    if (row[k] !== v) return false;
  }
  for (const [k, v] of Object.entries(neqs)) {
    if (row[k] === v) return false;
  }
  if (ilikeTitle !== null) {
    const plain = ilikeTitle.replace(/^%|%$/g, '').toLowerCase();
    const title = typeof row.title === 'string' ? row.title.toLowerCase() : '';
    if (!title.includes(plain)) return false;
  }
  return true;
}

jest.mock('../../services/webhookService', () => ({
  notify: jest.fn(),
}));

jest.mock('../../lib/session', () => ({
  currentUser: async () => (mockSimDb.activeUserId ? { id: mockSimDb.activeUserId } : null),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: mockSimDb.activeUserId
            ? { user: { id: mockSimDb.activeUserId }, access_token: 'jwt-token' }
            : null,
        },
        error: null,
      }),
    },
    from: (table: string) => {
      if (table !== 'tasks') {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select(cols?: string) {
          const eqs: Record<string, unknown> = {};
          const neqs: Record<string, unknown> = {};
          let ilikeTitle: string | null = null;
          let limitCount: number | null = null;

          const runSelect = () => {
            mockSimDb.calls.push({ op: 'select', cols });
            const err = mockMaybeSchemaOrForcedError(cols);
            if (err) return err;
            let matched = mockSimDb.rows.filter((r) => mockMatchRow(r, eqs, neqs, ilikeTitle));
            matched = [...matched].sort((a, b) =>
              String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
            );
            if (limitCount !== null) matched = matched.slice(0, limitCount);
            return {
              data: matched.map((r) => mockProjectColumns(r, cols)),
              error: null,
              status: 200,
            };
          };

          const builder = {
            eq(c: string, v: unknown) {
              eqs[c] = v;
              return builder;
            },
            neq(c: string, v: unknown) {
              neqs[c] = v;
              return builder;
            },
            is(c: string, v: unknown) {
              eqs[c] = v;
              return builder;
            },
            ilike(c: string, pattern: string) {
              if (c === 'title') ilikeTitle = pattern;
              return builder;
            },
            or() {
              return builder;
            },
            order() {
              return builder;
            },
            limit(n: number) {
              limitCount = n;
              return builder;
            },
            async maybeSingle() {
              const res = runSelect();
              if (res.error) return res;
              return { data: res.data[0] ?? null, error: null, status: 200 };
            },
            async single() {
              const res = runSelect();
              if (res.error) return res;
              return res.data[0]
                ? { data: res.data[0], error: null, status: 200 }
                : { data: null, error: { message: 'Row not found', code: 'PGRST116' }, status: 406 };
            },
            then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
              return Promise.resolve(runSelect()).then(onOk, onErr);
            },
          };
          return builder;
        },

        insert(payload: Record<string, unknown> | Record<string, unknown>[]) {
          return {
            select(cols?: string) {
              const runInsert = () => {
                mockSimDb.calls.push({ op: 'insert', cols, payload });
                const err = mockMaybeSchemaOrForcedError(cols, payload);
                if (err) return err;
                const list = Array.isArray(payload) ? payload : [payload];
                for (const item of list) {
                  if (item.id !== undefined && mockSimDb.rows.some((r) => r.id === item.id)) {
                    return {
                      data: null,
                      error: { message: 'duplicate key value violates unique constraint', code: '23505' },
                      status: 409,
                    };
                  }
                }
                const saved = list.map((item) => {
                  const ts = mockNextIso();
                  const baseRow: Record<string, unknown> = {
                    id: typeof item.id === 'string' ? item.id : `srv-${++mockSimDb.seq}`,
                    created_at: typeof item.created_at === 'string' ? item.created_at : ts,
                    updated_at: typeof item.updated_at === 'string' ? item.updated_at : ts,
                    ...(mockSimDb.schemaMode === 'full' ? { estimated_minutes: null, estimate_source: null } : {}),
                    ...item,
                  };
                  mockSimDb.rows.push(baseRow);
                  return mockProjectColumns(baseRow, cols);
                });
                return {
                  data: Array.isArray(payload) ? saved : saved[0],
                  error: null,
                  status: 201,
                };
              };

              return {
                async single() {
                  return runInsert();
                },
                then(onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) {
                  return Promise.resolve(runInsert()).then(onOk, onErr);
                },
              };
            },
          };
        },

        update(patch: Record<string, unknown>) {
          const eqs: Record<string, unknown> = {};
          const builder = {
            eq(c: string, v: unknown) {
              eqs[c] = v;
              return builder;
            },
            select(cols?: string) {
              return {
                async maybeSingle() {
                  mockSimDb.calls.push({ op: 'update', cols, payload: patch });
                  const err = mockMaybeSchemaOrForcedError(cols, patch);
                  if (err) return err;
                  const idx = mockSimDb.rows.findIndex((r) =>
                    Object.entries(eqs).every(([k, v]) => r[k] === v),
                  );
                  if (idx < 0) return { data: null, error: null, status: 200 };
                  const merged: Record<string, unknown> = {
                    ...mockSimDb.rows[idx],
                    ...patch,
                    updated_at: typeof patch.updated_at === 'string' ? patch.updated_at : mockNextIso(),
                  };
                  mockSimDb.rows[idx] = merged;
                  return { data: mockProjectColumns(merged, cols), error: null, status: 200 };
                },
              };
            },
          };
          return builder;
        },

        delete() {
          const eqs: Record<string, unknown> = {};
          const builder = {
            eq(c: string, v: unknown) {
              eqs[c] = v;
              return builder;
            },
            select() {
              mockSimDb.calls.push({ op: 'delete' });
              const err = mockMaybeSchemaOrForcedError(undefined);
              if (err) return Promise.resolve(err);
              const hits = mockSimDb.rows.filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v));
              mockSimDb.rows = mockSimDb.rows.filter((r) => !hits.includes(r));
              return Promise.resolve({ data: hits.map((h) => ({ id: h.id })), error: null, status: 200 });
            },
          };
          return builder;
        },
      };
    },
  },
}));

import {
  fetchTaskRow,
  fetchTasksPage,
  getTaskSchemaCapability,
  insertSplitTasks,
  insertTask,
  insertTaskRow,
  isMissingTaskEstimateColumnError,
  LEGACY_TASK_COLS,
  resetTaskSchemaCapability,
  searchTasks,
  TASK_COLS,
  updateTask,
  updateTaskVersioned,
  validateTaskEstimate,
} from '../../repositories/taskRepository';
import { alreadyHolds, deliverTaskCommand, newTaskRow } from '../../services/taskService';
import { setTaskOutboxStorage, useTaskStore } from '../../store/taskStore';

beforeEach(() => {
  mockSimDb.activeUserId = 'user-1';
  mockSimDb.schemaMode = 'full';
  mockSimDb.forcedError = null;
  mockSimDb.rows = [];
  mockSimDb.calls = [];
  mockSimDb.seq = 0;
  resetTaskSchemaCapability();
  setTaskOutboxStorage(memoryOutboxStorage());
  useTaskStore.getState().resetForAccount();
});

describe('E19 — end-to-end task duration and estimate_source persistence', () => {
  it('preserves 5-minute quick-add across outbox flush, cold reopen, and a second device read', async () => {
    expect(TASK_COLS).toBe(`${LEGACY_TASK_COLS},estimated_minutes,estimate_source`);
    expect(getTaskSchemaCapability()).toBe('unknown');

    const parsed = parseQuickAdd('Kisa yanit yaz 5dk', {
      now: new Date('2026-11-24T09:00:00Z'),
      projects: [],
    });
    expect(parsed.fields.durationMinutes).toBe(5);
    const taskInput = quickAddToTaskInput(
      parsed.title,
      parsed.fields,
      { priority: 'none', list_type: 'inbox', due_date: null, project_id: null },
      '2026-11-24',
    );
    expect(taskInput.estimated_minutes).toBe(5);

    const storage = memoryOutboxStorage();
    setTaskOutboxStorage(storage);

    const userSource: TaskEstimateSource = 'user';
    const created = await useTaskStore.getState().addTask({
      ...taskInput,
      estimate_source: userSource,
    });
    expect(created).not.toBeNull();
    expect(created?.estimated_minutes).toBe(5);
    expect(created?.estimate_source).toBe('user');

    await useTaskStore.getState().flush();

    expect(getTaskSchemaCapability()).toBe('full');
    expect(mockSimDb.rows).toHaveLength(1);
    expect(mockSimDb.rows[0]).toMatchObject({
      id: created!.id,
      user_id: 'user-1',
      estimated_minutes: 5,
      estimate_source: 'user',
    });

    // Simulate app restart on the first device (in-memory store wiped, reloaded from server + storage)
    useTaskStore.getState().resetForAccount();
    expect(useTaskStore.getState().tasks).toEqual([]);
    await useTaskStore.getState().fetchTasks();
    expect(useTaskStore.getState().tasks[0]).toMatchObject({
      id: created!.id,
      estimated_minutes: 5,
      estimate_source: 'user',
    });

    // Simulate a second device reading directly from the repository with a fresh outbox
    setTaskOutboxStorage(memoryOutboxStorage());
    useTaskStore.getState().resetForAccount();

    const pageOnSecondDevice = await fetchTasksPage(null, 20);
    expect(pageOnSecondDevice.ok).toBe(true);
    if (pageOnSecondDevice.ok) {
      expect(pageOnSecondDevice.data.rows[0]).toMatchObject({
        id: created!.id,
        estimated_minutes: 5,
        estimate_source: 'user',
      });
    }

    const singleOnSecondDevice = await fetchTaskRow(created!.id);
    expect(singleOnSecondDevice).toEqual({
      ok: true,
      data: expect.objectContaining({
        id: created!.id,
        estimated_minutes: 5,
        estimate_source: 'user',
      }),
    });

    const searched = await searchTasks('Kisa');
    expect(searched.ok).toBe(true);
    if (searched.ok) {
      expect(searched.data[0]?.estimated_minutes).toBe(5);
      expect(searched.data[0]?.estimate_source).toBe('user');
    }
  });

  it('updates duration to 25, leaves 25 intact on undefined partial patch, and clears to null cleanly', async () => {
    const ins = await insertTask({
      title: 'Planlama bloku',
      estimated_minutes: 15,
      estimate_source: 'ai',
    });
    expect(ins.ok).toBe(true);
    if (!ins.ok) return;
    expect(ins.data.estimated_minutes).toBe(15);
    expect(ins.data.estimate_source).toBe('ai');

    // Edit duration -> 25 with block source
    const edited = await updateTask(ins.data.id, {
      estimated_minutes: 25,
      estimate_source: 'block',
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect(edited.data.estimated_minutes).toBe(25);
    expect(edited.data.estimate_source).toBe('block');

    // Partial patch without estimated_minutes (undefined) MUST NOT wipe 25 or 'block'
    const renamedOnly = await updateTask(ins.data.id, { title: 'Planlama bloku v2' });
    expect(renamedOnly.ok).toBe(true);
    if (!renamedOnly.ok) return;
    expect(renamedOnly.data.title).toBe('Planlama bloku v2');
    expect(renamedOnly.data.estimated_minutes).toBe(25);
    expect(renamedOnly.data.estimate_source).toBe('block');

    // Versioned outbox partial patch (e.g. toggling priority) also preserves 25
    const verRename = await updateTaskVersioned(
      ins.data.id,
      { priority: 'high' },
      renamedOnly.data.updated_at ?? null,
      'user-1',
    );
    expect(verRename.ok).toBe(true);
    if (!verRename.ok || !verRename.data.row) return;
    expect(verRename.data.row.estimated_minutes).toBe(25);
    expect(verRename.data.row.estimate_source).toBe('block');

    // Explicit null clears both estimated_minutes and estimate_source
    const cleared = await updateTask(ins.data.id, { estimated_minutes: null });
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    expect(cleared.data.estimated_minutes).toBeNull();
    expect(cleared.data.estimate_source).toBeNull();
  });

  it('accepts boundaries 1..1440 and rejects 0, negative, >1440, NaN, fractional, and unknown source with 23514', async () => {
    expect(validateTaskEstimate({ estimated_minutes: 1, estimate_source: 'default' })).toEqual({
      ok: true,
      data: { estimated_minutes: 1, estimate_source: 'default' },
    });
    expect(validateTaskEstimate({ estimated_minutes: 1440 })).toEqual({
      ok: true,
      data: { estimated_minutes: 1440 },
    });
    expect(validateTaskEstimate({})).toEqual({ ok: true, data: {} });

    const invalidMinutes = [0, -10, 1441, 2000, Number.NaN, Number.POSITIVE_INFINITY, 12.5];
    const callsBefore = mockSimDb.calls.length;

    for (const bad of invalidMinutes) {
      const vRes = validateTaskEstimate({ estimated_minutes: bad });
      expect(vRes).toMatchObject({ ok: false, status: 400, code: '23514' });

      const insRes = await insertTask({ title: 'Bad', estimated_minutes: bad });
      expect(insRes).toMatchObject({ ok: false, status: 400, code: '23514' });

      const rowRes = await insertTaskRow({ id: 'bad-id', title: 'Bad', estimated_minutes: bad }, 'user-1');
      expect(rowRes).toMatchObject({ ok: false, status: 400, code: '23514' });

      const updRes = await updateTask('any-id', { estimated_minutes: bad });
      expect(updRes).toMatchObject({ ok: false, status: 400, code: '23514' });

      const verRes = await updateTaskVersioned('any-id', { estimated_minutes: bad }, null, 'user-1');
      expect(verRes).toMatchObject({ ok: false, status: 400, code: '23514' });
    }

    const badSourceRes = validateTaskEstimate({ estimated_minutes: 10, estimate_source: 'guessed' });
    expect(badSourceRes).toMatchObject({ ok: false, status: 400, code: '23514' });

    // None of the invalid inputs hit PostgREST
    expect(mockSimDb.calls).toHaveLength(callsBefore);
  });

  it('alreadyHolds and deliverTaskCommand detect null-vs-25 conflict on full schema while tolerating legacy rows', async () => {
    const rowFromNewTask = newTaskRow('t-new', {
      title: 'Odak',
      estimated_minutes: 30,
      estimate_source: 'ai',
    });
    expect(rowFromNewTask.estimated_minutes).toBe(30);
    expect(rowFromNewTask.estimate_source).toBe('ai');

    // Full-schema row holds null, local payload wants 25 -> NOT equal -> conflict!
    expect(
      alreadyHolds(
        { id: 't1', title: 'Same', estimated_minutes: null, estimate_source: null },
        { title: 'Same', estimated_minutes: 25 },
      ),
    ).toBe(false);

    // Full-schema row holds matching 25 and source -> equal
    expect(
      alreadyHolds(
        { id: 't1', title: 'Same', estimated_minutes: 25, estimate_source: 'user' },
        { title: 'Same', estimated_minutes: 25, estimate_source: 'user' },
      ),
    ).toBe(true);

    // Legacy row without estimate keys -> treated as compatible
    expect(
      alreadyHolds(
        { id: 't1', title: 'Same' },
        { title: 'Same', estimated_minutes: 25, estimate_source: 'user' },
      ),
    ).toBe(true);

    // Real version-mismatch delivery detects conflict when server has estimated_minutes: 10 vs local 45
    const seeded = await insertTaskRow(
      { id: 't-conf', title: 'Task', estimated_minutes: 10, estimate_source: 'user' },
      'user-1',
    );
    expect(seeded.ok).toBe(true);

    const outcome = await deliverTaskCommand({
      operationId: 'op-conf',
      userId: 'user-1',
      entity: 'task',
      entityId: 't-conf',
      kind: 'update',
      payload: { estimated_minutes: 45, estimate_source: 'user' },
      baseVersion: '1999-01-01T00:00:00.000Z',
      dependsOn: [],
      seq: 1,
      attempts: 0,
      status: 'pending',
      readyAt: 0,
      createdAt: 1000,
    });
    expect(outcome.kind).toBe('conflict');
  });
});

describe('E08 — narrow legacy schema fallback vs auth and network errors', () => {
  it('falls back to LEGACY_TASK_COLS on 42703, records legacy_no_estimate, and resets on account boundary', async () => {
    mockSimDb.schemaMode = 'legacy_42703';
    expect(getTaskSchemaCapability()).toBe('unknown');

    const created = await insertTaskRow(
      {
        id: 't-leg-1',
        title: 'Pre-045 server task',
        estimated_minutes: 20,
        estimate_source: 'user',
      },
      'user-1',
    );
    expect(created.ok).toBe(true);
    expect(getTaskSchemaCapability()).toBe('legacy_no_estimate');
    // First attempt used TASK_COLS (failed 42703), second attempt used LEGACY_TASK_COLS and stripped estimate fields
    expect(mockSimDb.calls).toHaveLength(2);
    expect(mockSimDb.calls[0].cols).toBe(TASK_COLS);
    expect(mockSimDb.calls[1].cols).toBe(LEGACY_TASK_COLS);
    expect(mockHasEstimateInPayload(mockSimDb.calls[1].payload)).toBe(false);

    // Subsequent read/update in the same session skips the failing full-schema probe (1 DB call each)
    mockSimDb.calls = [];
    const page = await fetchTasksPage(null, 10);
    expect(page.ok).toBe(true);
    expect(mockSimDb.calls).toHaveLength(1);
    expect(mockSimDb.calls[0].cols).toBe(LEGACY_TASK_COLS);

    mockSimDb.calls = [];
    const upd = await updateTask('t-leg-1', { title: 'Edited on legacy', estimated_minutes: 40 });
    expect(upd.ok).toBe(true);
    expect(mockSimDb.calls).toHaveLength(1);
    expect(mockSimDb.calls[0].cols).toBe(LEGACY_TASK_COLS);
    expect(mockHasEstimateInPayload(mockSimDb.calls[0].payload)).toBe(false);

    const split = await insertSplitTasks([
      {
        title: 'Subtask 1',
        description: 'step',
        status: 'pending',
        priority: 'medium',
        due_date: null,
        project_id: null,
        list_type: 'inbox',
        completed: false,
        parent_task_id: 't-leg-1',
        is_subtask: true,
        estimated_minutes: 10,
        estimate_source: 'ai',
      },
    ]);
    expect(split.ok).toBe(true);

    // Crossing the account boundary resets capability back to 'unknown'
    resetAccountMemory('signed_out');
    expect(getTaskSchemaCapability()).toBe('unknown');
  });

  it('also recognizes PGRST204 schema-cache column errors and avoids unrelated 42703 columns', async () => {
    mockSimDb.schemaMode = 'legacy_pgrst204';
    const res = await insertTask({ title: 'Cache lag task', estimated_minutes: 10, estimate_source: 'user' });
    expect(res.ok).toBe(true);
    expect(getTaskSchemaCapability()).toBe('legacy_no_estimate');

    expect(
      isMissingTaskEstimateColumnError({
        code: '42703',
        message: 'column tasks.unrelated_column does not exist',
        status: 400,
      }),
    ).toBe(false);
  });

  it('NEVER falls back on 42501 RLS permission failure, 401 auth error, or offline transport failure', async () => {
    // 1. 42501 RLS error
    mockSimDb.forcedError = {
      code: '42501',
      message: 'new row violates row-level security policy for table "tasks"',
      status: 403,
    };
    const rlsRes = await insertTaskRow(
      { id: 't-rls', title: 'Blocked', estimated_minutes: 15, estimate_source: 'user' },
      'user-1',
    );
    expect(rlsRes).toMatchObject({
      ok: false,
      status: 403,
      code: '42501',
      offline: false,
    });
    expect(mockSimDb.calls).toHaveLength(1);
    expect(getTaskSchemaCapability()).toBe('unknown');

    // 2. 401 JWT expired error
    mockSimDb.calls = [];
    mockSimDb.forcedError = {
      code: 'PGRST301',
      message: 'JWT expired',
      status: 401,
    };
    const authRes = await fetchTaskRow('t-rls');
    expect(authRes).toMatchObject({
      ok: false,
      status: 401,
      code: 'PGRST301',
      offline: false,
    });
    expect(mockSimDb.calls).toHaveLength(1);
    expect(getTaskSchemaCapability()).toBe('unknown');

    // 3. Offline network transport failure (status 0)
    mockSimDb.calls = [];
    mockSimDb.forcedError = {
      code: '',
      message: 'TypeError: Network request failed',
      status: 0,
    };
    const netRes = await fetchTasksPage(null, 10);
    expect(netRes).toMatchObject({
      ok: false,
      offline: true,
      status: 0,
    });
    expect(mockSimDb.calls).toHaveLength(1);
    expect(getTaskSchemaCapability()).toBe('unknown');
  });
});
