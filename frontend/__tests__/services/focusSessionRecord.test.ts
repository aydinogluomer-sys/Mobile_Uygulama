/**
 * F16 (INT-08, REP-11) — `services/focusService` records honest `started_at`/`ended_at`
 * spans, reads fresh task counters for auto-completion, and writes partial work
 * phases (>= 60s, `completed: false`) without crediting tasks.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

type CommandStub = { operationId: string; entity: string; entityId: string; kind: string; payload: Record<string, unknown> };

const mockOutbox = {
  writes: [] as CommandStub[],
  commands: [] as CommandStub[],
  keepQueued: false,
  writeError: null as string | null,
  seq: 0,
};

jest.mock('../../services/coreOutbox', () => ({
  coreOutbox: {
    write: jest.fn(async (input: { entity: string; entityId: string; kind: string; payload: Record<string, unknown> }) => {
      if (mockOutbox.writeError) return { ok: false, error: mockOutbox.writeError };
      const operationId = `op-${++mockOutbox.seq}`;
      const cmd: CommandStub = { operationId, ...input };
      mockOutbox.writes.push(cmd);
      mockOutbox.commands.push(cmd);
      return { ok: true, savedOnDevice: true, operationId };
    }),
    flush: jest.fn(async () => {
      if (!mockOutbox.keepQueued) mockOutbox.commands = [];
    }),
    state: jest.fn(() => ({ commands: mockOutbox.commands })),
  },
}));

const mockTaskRepo = {
  fresh: {
    ok: true,
    data: {
      id: 'ft1',
      completed: false,
      estimated_pomodoros: 3,
      completed_pomodoros: 1,
      total_focus_seconds: 1500,
      updated_at: 'v1',
    },
  } as
    | { ok: true; data: { id: string; completed: boolean | null; estimated_pomodoros: number | null; completed_pomodoros: number | null; total_focus_seconds: number | null; updated_at: string | null } | null }
    | { ok: false; error: string },
  throwOnFetch: false,
  completeOk: true,
  completedIds: [] as string[],
  fetchCalls: 0,
};

jest.mock('../../repositories/focusTaskRepository', () => ({
  fetchFocusTaskProgress: jest.fn(async () => {
    mockTaskRepo.fetchCalls += 1;
    if (mockTaskRepo.throwOnFetch) throw new Error('network exploded');
    return mockTaskRepo.fresh;
  }),
  completeFocusTask: jest.fn(async (id: string) => {
    mockTaskRepo.completedIds.push(id);
    return mockTaskRepo.completeOk ? { ok: true, data: { id } } : { ok: false, error: 'close failed' };
  }),
  fetchOpenFocusTasks: jest.fn(),
  insertFocusTask: jest.fn(),
  deleteFocusTask: jest.fn(),
  fetchAllFocusTasks: jest.fn(),
}));

import { completeWorkPhase, recordPartialWorkPhase } from '../../services/focusService';
import type { FocusTaskRow } from '../../repositories/focusTaskRepository';

const T0 = 1_800_000_000_000;

const staleTask = (overrides: Partial<FocusTaskRow> = {}): FocusTaskRow => ({
  id: 'ft1',
  user_id: 'u1',
  title: 'Mimari belge',
  completed: false,
  estimated_pomodoros: 3,
  completed_pomodoros: 0,
  total_focus_seconds: 0,
  created_at: '2026-10-01T08:00:00.000Z',
  ...overrides,
});

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(T0);
  mockOutbox.writes = [];
  mockOutbox.commands = [];
  mockOutbox.keepQueued = false;
  mockOutbox.writeError = null;
  mockOutbox.seq = 0;
  mockTaskRepo.fresh = {
    ok: true,
    data: {
      id: 'ft1',
      completed: false,
      estimated_pomodoros: 3,
      completed_pomodoros: 1,
      total_focus_seconds: 1500,
      updated_at: 'v1',
    },
  };
  mockTaskRepo.throwOnFetch = false;
  mockTaskRepo.completeOk = true;
  mockTaskRepo.completedIds = [];
  mockTaskRepo.fetchCalls = 0;
});

afterEach(() => jest.restoreAllMocks());

describe('INT-08 — honest session span on completeWorkPhase', () => {
  it('writes distinct started_at and ended_at matching the 25-minute span', async () => {
    const res = await completeWorkPhase({
      task: undefined,
      plannedSeconds: 1500,
      completedSeconds: 1500,
      autoCheckTasks: false,
      title: 'Derin okuma',
      startedAtIso: '2026-11-01T20:40:00.000Z',
      endedAtIso: '2026-11-01T21:05:00.000Z',
    });
    expect(res).toEqual({ sessionRecorded: true, taskCompleted: false });
    expect(mockOutbox.writes).toHaveLength(1);
    const p = mockOutbox.writes[0].payload;
    expect(p.started_at).toBe('2026-11-01T20:40:00.000Z');
    expect(p.ended_at).toBe('2026-11-01T21:05:00.000Z');
    expect(Date.parse(String(p.ended_at)) - Date.parse(String(p.started_at))).toBe(25 * 60_000);
    expect(p.completed).toBe(true);
  });

  it('derives started_at backwards from ended_at when startedAtIso is omitted, and uses now when endedAtIso is omitted', async () => {
    await completeWorkPhase({
      task: undefined,
      plannedSeconds: 1500,
      completedSeconds: 900,
      autoCheckTasks: false,
    });
    const p = mockOutbox.writes[0].payload;
    expect(p.ended_at).toBe(new Date(T0).toISOString());
    expect(p.started_at).toBe(new Date(T0 - 900_000).toISOString());
  });

  it('keeps a midnight-crossing Europe/Istanbul session anchored at its real 23:40 local start (20:40Z)', async () => {
    await completeWorkPhase({
      task: undefined,
      plannedSeconds: 1500,
      completedSeconds: 1500,
      autoCheckTasks: false,
      startedAtIso: '2026-11-01T20:40:00.000Z',
      endedAtIso: '2026-11-01T21:05:00.000Z',
    });
    expect(mockOutbox.writes[0].payload.started_at).toBe('2026-11-01T20:40:00.000Z');
  });
});

describe('REP-11 — auto-completion uses fresh server progress, never stale screen state', () => {
  it('auto-completes when fresh server completed_pomodoros reached estimate even if screen snapshot was 0/3', async () => {
    mockTaskRepo.fresh = {
      ok: true,
      data: {
        id: 'ft1',
        completed: false,
        estimated_pomodoros: 3,
        completed_pomodoros: 3,
        total_focus_seconds: 4500,
        updated_at: 'v3',
      },
    };
    const res = await completeWorkPhase({
      task: staleTask({ completed_pomodoros: 0, estimated_pomodoros: 3 }),
      plannedSeconds: 1500,
      completedSeconds: 1500,
      autoCheckTasks: true,
    });
    expect(res).toEqual({ sessionRecorded: true, taskCompleted: true });
    expect(mockTaskRepo.completedIds).toEqual(['ft1']);
  });

  it('does not auto-complete when fresh server completed_pomodoros is still below estimate', async () => {
    mockTaskRepo.fresh = {
      ok: true,
      data: {
        id: 'ft1',
        completed: false,
        estimated_pomodoros: 3,
        completed_pomodoros: 2,
        total_focus_seconds: 3000,
        updated_at: 'v2',
      },
    };
    const res = await completeWorkPhase({
      task: staleTask({ completed_pomodoros: 2, estimated_pomodoros: 3 }),
      plannedSeconds: 1500,
      completedSeconds: 1500,
      autoCheckTasks: true,
    });
    expect(res).toEqual({ sessionRecorded: true, taskCompleted: false });
    expect(mockTaskRepo.completedIds).toEqual([]);
  });

  it('surfaces creditError without throwing when fresh progress read fails, throws, or returns null', async () => {
    mockTaskRepo.fresh = { ok: false, error: 'read timeout' };
    expect(
      await completeWorkPhase({ task: staleTask(), plannedSeconds: 1500, completedSeconds: 1500, autoCheckTasks: true }),
    ).toEqual({ sessionRecorded: true, taskCompleted: false, creditError: 'read timeout' });

    mockTaskRepo.throwOnFetch = true;
    expect(
      await completeWorkPhase({ task: staleTask(), plannedSeconds: 1500, completedSeconds: 1500, autoCheckTasks: true }),
    ).toEqual({ sessionRecorded: true, taskCompleted: false, creditError: 'network exploded' });

    mockTaskRepo.throwOnFetch = false;
    mockTaskRepo.fresh = { ok: true, data: null };
    expect(
      await completeWorkPhase({ task: staleTask(), plannedSeconds: 1500, completedSeconds: 1500, autoCheckTasks: true }),
    ).toEqual({ sessionRecorded: true, taskCompleted: false, creditError: 'Odak görevi bulunamadı.' });
  });

  it('returns sessionQueued without reading task progress when delivery stays queued offline', async () => {
    mockOutbox.keepQueued = true;
    const res = await completeWorkPhase({
      task: staleTask(),
      plannedSeconds: 1500,
      completedSeconds: 1500,
      autoCheckTasks: true,
    });
    expect(res).toMatchObject({ sessionRecorded: false, sessionQueued: true, taskCompleted: false });
    expect(mockTaskRepo.fetchCalls).toBe(0);
  });
});

describe('F16 (K4) — recordPartialWorkPhase', () => {
  it('records >= 60s work with completed: false and clamps completedSeconds to plannedSeconds', async () => {
    const res = await recordPartialWorkPhase({
      startedAtIso: '2026-11-01T10:00:00.000Z',
      endedAtIso: '2026-11-01T10:20:00.000Z',
      plannedSeconds: 1500,
      completedSeconds: 1200,
      taskId: 'ft1',
      taskTitle: 'Mimari belge',
    });
    expect(res).toEqual({ recorded: true });
    expect(mockOutbox.writes[0].payload).toEqual({
      task_id: 'ft1',
      task_title: 'Mimari belge',
      mode: 'work',
      started_at: '2026-11-01T10:00:00.000Z',
      ended_at: '2026-11-01T10:20:00.000Z',
      planned_seconds: 1500,
      completed_seconds: 1200,
      completed: false,
    });

    const clamped = await recordPartialWorkPhase({
      startedAtIso: '2026-11-01T10:00:00.000Z',
      endedAtIso: '2026-11-01T10:30:00.000Z',
      plannedSeconds: 900,
      completedSeconds: 1400,
    });
    expect(clamped).toEqual({ recorded: true });
    expect(mockOutbox.writes[1].payload.completed_seconds).toBe(900);
    expect(mockOutbox.writes[1].payload.completed).toBe(false);
  });

  it('refuses < 60s partial work without touching coreOutbox', async () => {
    const res = await recordPartialWorkPhase({
      startedAtIso: '2026-11-01T10:00:00.000Z',
      endedAtIso: '2026-11-01T10:00:59.000Z',
      plannedSeconds: 1500,
      completedSeconds: 59,
    });
    expect(res).toEqual({ recorded: false });
    expect(mockOutbox.writes).toHaveLength(0);
  });

  it('returns queued: true when offline, and never mutates task progress directly in focusService.ts', async () => {
    mockOutbox.keepQueued = true;
    const res = await recordPartialWorkPhase({
      startedAtIso: '2026-11-01T10:00:00.000Z',
      endedAtIso: '2026-11-01T10:02:00.000Z',
      plannedSeconds: 1500,
      completedSeconds: 120,
    });
    expect(res).toEqual({ recorded: false, queued: true });
    expect(mockTaskRepo.fetchCalls).toBe(0);

    const svcSrc = stripComments(readFileSync(join(__dirname, '..', '..', 'services', 'focusService.ts'), 'utf8'));
    expect(svcSrc).not.toMatch(/\bsetFocusTaskProgress\b|\baddFocusTaskProgress\b/);
  });
});
