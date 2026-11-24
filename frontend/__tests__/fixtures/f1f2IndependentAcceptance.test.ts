/**
 * Phase F1 + F2 Independent QA Acceptance Suite (`f1f2IndependentAcceptance.test.ts`).
 *
 * Verifies end-of-F1 (`DB-02`, `AI-01`, `REL-02` client isolation) and end-of-F2
 * (`E04` 04:00 rollover & 4-zone parity, `E09` weekly-3 period integrity, `E10`
 * load/appointment/XP separation, `Y11` two-account switch & deletion isolation)
 * strictly through existing production contracts without coupling to unmerged
 * parallel feature branches.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

type ServerTaskRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  completed: boolean;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
  completed_at: string | null;
  updated_at: string;
  created_at: string;
  list_type: 'inbox' | 'this_week' | 'someday';
  priority: 'high' | 'medium' | 'low' | 'none';
  due_date: string | null;
  is_subtask: boolean;
  parent_task_id: string | null;
  project_id: string | null;
  notes_text: string | null;
  time_block_start: string | null;
  time_block_end: string | null;
  estimated_minutes?: number | null;
};

type MockRepoFailure = {
  ok: false;
  error: string;
  offline?: boolean;
  status?: number;
  code?: string;
};

type MockRepoResult<T> = { ok: true; data: T } | MockRepoFailure;

const mockServer = {
  rows: new Map<string, ServerTaskRow>(),
  online: true,
  clock: 0,
  insertGate: null as Promise<void> | null,
};

const mockSession: { user: { id: string; email: string | null } | null } = {
  user: { id: 'user-A', email: null },
};

function mockNextTimestamp(): string {
  mockServer.clock += 1;
  return `2026-11-24T10:00:${String(mockServer.clock).padStart(2, '0')}.000Z`;
}

function mockGuardAccount(expectedUserId?: string): MockRepoFailure | null {
  const activeUserId = mockSession.user?.id;
  if (!activeUserId) {
    return { ok: false, error: 'Oturum bulunamadi.', status: 401 };
  }
  if (expectedUserId !== undefined && expectedUserId !== activeUserId) {
    return { ok: false, error: 'Oturum baska bir hesaba ait.', status: 401 };
  }
  return null;
}

function mockGateNetwork<T>(compute: () => T): MockRepoResult<T> {
  if (!mockServer.online) {
    return { ok: false, error: 'Network request failed', offline: true };
  }
  if (!mockSession.user) {
    return { ok: false, error: 'JWT missing', status: 401 };
  }
  return { ok: true, data: compute() };
}

jest.mock('../../lib/notifications', () => ({
  listScheduled: async () => [],
  cancelScheduled: async () => undefined,
}));

jest.mock('../../services/webhookService', () => ({
  notify: jest.fn(),
}));

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => mockSession.user),
}));

jest.mock('../../repositories/taskRepository', () => ({
  fetchTasksPage: jest.fn(async () =>
    mockGateNetwork(() => {
      const uid = mockSession.user?.id ?? '';
      const rows = [...mockServer.rows.values()].filter((r) => r.user_id === uid && r.status !== 'cancelled');
      return { rows, nextCursor: null, hasMore: false };
    }),
  ),
  insertTaskRow: jest.fn(
    async (
      row: Partial<ServerTaskRow> & { id: string },
      expectedUserId?: string,
    ): Promise<MockRepoResult<ServerTaskRow>> => {
      if (mockServer.insertGate) {
        await mockServer.insertGate;
      }
      const mismatch = mockGuardAccount(expectedUserId);
      if (mismatch) return mismatch;
      if (mockServer.online && mockServer.rows.has(row.id)) {
        return { ok: false, error: 'duplicate key', code: '23505', status: 409 };
      }
      return mockGateNetwork(() => {
        const uid = mockSession.user?.id ?? '';
        const ts = mockNextTimestamp();
        const created: ServerTaskRow = {
          id: row.id,
          user_id: uid,
          title: row.title ?? '',
          description: row.description ?? null,
          completed: row.completed ?? false,
          status: row.status ?? 'pending',
          completed_at: row.completed_at ?? null,
          created_at: row.created_at ?? ts,
          updated_at: ts,
          list_type: row.list_type ?? 'inbox',
          priority: row.priority ?? 'none',
          due_date: row.due_date ?? null,
          is_subtask: row.is_subtask ?? false,
          parent_task_id: row.parent_task_id ?? null,
          project_id: row.project_id ?? null,
          notes_text: row.notes_text ?? null,
          time_block_start: row.time_block_start ?? null,
          time_block_end: row.time_block_end ?? null,
          ...(row.estimated_minutes !== undefined ? { estimated_minutes: row.estimated_minutes } : {}),
        };
        mockServer.rows.set(created.id, created);
        return created;
      });
    },
  ),
  updateTaskVersioned: jest.fn(
    async (
      id: string,
      patch: Partial<ServerTaskRow>,
      baseVersion: string | null,
      expectedUserId?: string,
    ): Promise<MockRepoResult<{ row: ServerTaskRow | null; exists: boolean }>> => {
      const mismatch = mockGuardAccount(expectedUserId);
      if (mismatch) return mismatch;
      return mockGateNetwork(() => {
        const current = mockServer.rows.get(id);
        if (!current || current.user_id !== mockSession.user?.id) {
          return { row: null, exists: false };
        }
        if (baseVersion !== null && current.updated_at !== baseVersion) {
          return { row: null, exists: true };
        }
        const updated: ServerTaskRow = {
          ...current,
          ...patch,
          updated_at: mockNextTimestamp(),
        };
        mockServer.rows.set(id, updated);
        return { row: updated, exists: true };
      });
    },
  ),
  fetchTaskRow: jest.fn(async (id: string): Promise<MockRepoResult<ServerTaskRow | null>> =>
    mockGateNetwork(() => {
      const found = mockServer.rows.get(id);
      if (!found || found.user_id !== mockSession.user?.id) return null;
      return found;
    }),
  ),
  deleteTaskIfPresent: jest.fn(
    async (id: string, expectedUserId?: string): Promise<MockRepoResult<{ deleted: boolean }>> => {
      const mismatch = mockGuardAccount(expectedUserId);
      if (mismatch) return mismatch;
      return mockGateNetwork(() => {
        const found = mockServer.rows.get(id);
        if (!found || found.user_id !== mockSession.user?.id) {
          return { deleted: false };
        }
        return { deleted: mockServer.rows.delete(id) };
      });
    },
  ),
  insertTask: jest.fn(),
  updateTask: jest.fn(),
  deleteTask: jest.fn(),
  searchTasks: jest.fn(),
  insertSplitTasks: jest.fn(),
}));

import { accountEpoch, endAccountScope, resetAccountMemory } from '../../lib/accountScope';
import { bandFor, dailyLoad, habitLoadPoints, LOAD_BANDS } from '../../lib/capacity';
import { validateCoachActions } from '../../lib/coachActions';
import { readActionV2 } from '../../lib/coachActionsV2';
import { isValidTimeZone, parseLocalDate, ymd } from '../../lib/date';
import { closingDayFor, DAY_ROLLOVER_HOUR, dayAfter } from '../../lib/dayClose';
import { isWindowSatisfied, periodStatus, streakBroken } from '../../lib/habitSchedule';
import { emptyOutbox, enqueue } from '../../lib/outbox';
import { asyncStorageOutbox, outboxKey, parseStored } from '../../lib/outboxStorage';
import type { Habit, HabitLog } from '../../lib/supabase';
import {
  buildLocalSplitProposal,
  STEP_FAMILIES,
  toSplitTaskInputs,
  validateSubtaskProposal,
  type SubtaskDecompositionProposal,
} from '../../lib/taskDecomposition';
import { setTaskOutboxStorage, useTaskStore } from '../../store/taskStore';
import { buildRecoveryFixture, buildStartFixture } from '../helpers/playbookFixtures';
import { TEST_ZONE, wallClockInZone } from '../helpers/zone';

const taskState = () => useTaskStore.getState();

function buildWeeklyCountHabit(count: number): Habit {
  return {
    id: 'habit-weekly-3-qa',
    user_id: 'user-tz-qa',
    name: 'Kuvvet antrenmanı',
    icon: null,
    color: null,
    status: 'active',
    behavior_type: 'positive',
    tracking_type: 'boolean',
    daily_goal: null,
    unit: null,
    target_direction: null,
    frequency_config: {
      kind: 'weekly',
      count,
      created_day: '2026-11-01',
    },
    willpower_cost: 2,
    impact_level: 'medium',
    urgency: 'not_urgent',
    difficulty: 3,
    estimated_minutes: 30,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: 'health',
    end_condition: null,
    current_streak: 2,
    best_streak: 5,
    created_at: '2026-11-01T09:00:00.000Z',
  };
}

describe('F1 + F2 Independent QA Acceptance Suite', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockServer.rows.clear();
    mockServer.online = true;
    mockServer.clock = 0;
    mockServer.insertGate = null;
    mockSession.user = { id: 'user-A', email: null };
    setTaskOutboxStorage(asyncStorageOutbox);
    resetAccountMemory('signed_out');
  });

  // ---------------------------------------------------------------------------
  // 1. QA-ACC-01 — Hesap geçişi ve silme sonrası sıfır sızıntı (Y11 / REL-02 / DB-02)
  // ---------------------------------------------------------------------------
  describe('QA-ACC-01 — Account switch & deletion zero-leak isolation (Y11 / REL-02 / DB-02)', () => {
    it('(+) clears taskStore on resetAccountMemory("user_changed"), preserves outbox.v1.user-A intact while user-B writes, and prevents cross-account leakage', async () => {
      mockServer.online = false;

      const taskA1 = await taskState().addTask({
        title: 'A — Gizli müşteri teklif bütçesi',
        priority: 'high',
        due_date: '2026-11-24',
      });
      const taskA2 = await taskState().addTask({
        title: 'A — Vergi beyannamesi kontrolü',
        priority: 'medium',
        due_date: '2026-11-25',
      });
      await taskState().flush();

      expect(taskA1).not.toBeNull();
      expect(taskA2).not.toBeNull();
      expect(taskState().tasks).toHaveLength(2);
      expect(taskState().tasks.every((t) => t.user_id === 'user-A')).toBe(true);
      expect(taskState().sync.pending).toBe(2);

      const userAKey = outboxKey('user-A');
      const userBKey = outboxKey('user-B');
      expect(userAKey).toBe('outbox.v1.user-A');
      expect(userBKey).toBe('outbox.v1.user-B');

      const rawUserABeforeSwitch = await AsyncStorage.getItem(userAKey);
      expect(rawUserABeforeSwitch).not.toBeNull();
      const parsedUserABefore = parseStored(rawUserABeforeSwitch, 'user-A');
      expect(parsedUserABefore.problem).toBeNull();
      expect(parsedUserABefore.state.userId).toBe('user-A');
      expect(parsedUserABefore.state.commands).toHaveLength(2);

      // Account switch boundary: resetAccountMemory('user_changed') + user-B session
      const epochBefore = accountEpoch();
      resetAccountMemory('user_changed');
      mockSession.user = { id: 'user-B', email: null };

      expect(accountEpoch()).toBe(epochBefore + 1);
      expect(taskState().tasks).toEqual([]);
      expect(taskState().outbox).toBeNull();
      expect(taskState().sync).toEqual({
        pending: 0,
        dead: 0,
        conflict: 0,
        authBlocked: false,
      });

      // User-B writes offline first, then flushes online
      const taskB1 = await taskState().addTask({
        title: 'B — Kendi market alışverişi',
        priority: 'low',
        due_date: '2026-11-24',
      });
      await taskState().flush();

      expect(taskB1).not.toBeNull();
      expect(taskState().tasks.map((t) => t.title)).toEqual(['B — Kendi market alışverişi']);
      expect(taskState().tasks.every((t) => t.user_id === 'user-B')).toBe(true);

      // outbox.v1.user-A must remain byte-for-byte untouched while outbox.v1.user-B holds B's command
      const rawUserAAfterBWrite = await AsyncStorage.getItem(userAKey);
      expect(rawUserAAfterBWrite).toBe(rawUserABeforeSwitch);

      const rawUserBAfterBWrite = await AsyncStorage.getItem(userBKey);
      expect(rawUserBAfterBWrite).not.toBeNull();
      expect(parseStored(rawUserBAfterBWrite, 'user-B').state.commands.map((c) => c.entityId)).toEqual([
        taskB1!.id,
      ]);

      // Network recovers under user-B: only user-B's task reaches the server; user-A's tasks never leak
      mockServer.online = true;
      await taskState().fetchTasks();
      await taskState().flush();

      expect(taskState().tasks.map((t) => t.title)).toEqual(['B — Kendi market alışverişi']);
      expect([...mockServer.rows.values()].map((r) => ({ user_id: r.user_id, title: r.title }))).toEqual([
        { user_id: 'user-B', title: 'B — Kendi market alışverişi' },
      ]);
      expect(await AsyncStorage.getItem(userAKey)).toBe(rawUserABeforeSwitch);

      // (-) Cross-account storage/outbox guards reject reading or enqueueing A's state as B
      const crossParse = parseStored(rawUserABeforeSwitch, 'user-B');
      expect(crossParse.problem).toBe('account');
      expect(crossParse.state.commands).toEqual([]);
      expect(
        enqueue(
          parsedUserABefore.state,
          { operationId: 'op-cross-account', entity: 'task', entityId: 't-cross', kind: 'create' },
          'user-B',
          Date.now(),
        ),
      ).toEqual({ ok: false, reason: 'wrong_account' });
    });

    it('(+) wipes deleted user-A outbox and aborts in-flight flush without corrupting user-B outbox or leaking into user-B memory', async () => {
      // Seed user-B pending offline work on shared device first
      mockSession.user = { id: 'user-B', email: null };
      mockServer.online = false;
      const keptTaskB = await taskState().addTask({ title: 'B — Cihazda bekleyen görev' });
      await taskState().flush();
      expect(keptTaskB).not.toBeNull();
      const rawUserBSnapshot = await AsyncStorage.getItem(outboxKey('user-B'));
      expect(rawUserBSnapshot).not.toBeNull();

      // Switch to user-A and create pending offline task
      resetAccountMemory('user_changed');
      mockSession.user = { id: 'user-A', email: null };
      const doomedTaskA = await taskState().addTask({ title: 'A — Silinecek hesap görevi' });
      await taskState().flush();
      expect(doomedTaskA).not.toBeNull();
      expect(await AsyncStorage.getItem(outboxKey('user-A'))).not.toBeNull();

      // Start an online flush for user-A and pause mid-flight while user-A deletes their account
      let releaseInsert: () => void = () => undefined;
      mockServer.insertGate = new Promise<void>((resolve) => {
        releaseInsert = resolve;
      });
      mockServer.online = true;

      const inFlight = taskState().flush();
      await Promise.resolve();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      await endAccountScope('account_deleted', 'user-A');
      mockSession.user = { id: 'user-B', email: null };

      expect(taskState().tasks).toEqual([]);
      expect(await AsyncStorage.getItem(outboxKey('user-A'))).toBeNull();
      expect(await AsyncStorage.getItem(outboxKey('user-B'))).toBe(rawUserBSnapshot);

      // Release late network work: must be rejected by account mismatch and never resurrect outbox.v1.user-A
      mockServer.insertGate = null;
      releaseInsert();
      await inFlight;

      expect(await AsyncStorage.getItem(outboxKey('user-A'))).toBeNull();
      expect([...mockServer.rows.values()].filter((r) => r.user_id === 'user-A')).toEqual([]);

      // User-B loads cleanly with only user-B's pending task, flushes to server as user-B, and refetches authoritative user_id
      await taskState().fetchTasks();
      expect(taskState().tasks.map((t) => t.title)).toEqual(['B — Cihazda bekleyen görev']);
      await taskState().flush();
      expect([...mockServer.rows.values()].map((r) => ({ user_id: r.user_id, title: r.title }))).toEqual([
        { user_id: 'user-B', title: 'B — Cihazda bekleyen görev' },
      ]);
      await taskState().fetchTasks();
      expect(taskState().tasks.map((t) => ({ user_id: t.user_id, title: t.title }))).toEqual([
        { user_id: 'user-B', title: 'B — Cihazda bekleyen görev' },
      ]);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. QA-AI-01 — AI sağlayıcı hatasında yerel görev bölücü sürekliliği & şema doğrulaması (AI-01)
  // ---------------------------------------------------------------------------
  describe('QA-AI-01 — Strict coach action V2 schema barrier & local decomposition fallback (AI-01)', () => {
    const today = '2026-11-24';
    const fixedNow = new Date(2026, 10, 24, 9, 30, 0);

    it('(-) refuses out-of-range minutes (0, 999, non-integer), extra fields, and user_id authority injection in readActionV2 and validateCoachActions', () => {
      const validStep = readActionV2(
        {
          type: 'suggest_small_step',
          task_query: 'Teklifi hazırla',
          step: 'Müşteri kapsam başlığını aç',
          minutes: 10,
        },
        today,
        fixedNow,
      );
      expect(validStep).toEqual({
        type: 'suggest_small_step',
        task_query: 'Teklifi hazırla',
        step: 'Müşteri kapsam başlığını aç',
        minutes: 10,
      });

      const zeroMinutes = readActionV2(
        {
          type: 'suggest_small_step',
          task_query: 'Teklifi hazırla',
          step: 'Başlığı yaz',
          minutes: 0,
        },
        today,
        fixedNow,
      );
      expect(typeof zeroMinutes).toBe('string');
      expect(zeroMinutes).toBe('invalid minutes');

      const hugeMinutes = readActionV2(
        {
          type: 'suggest_small_step',
          task_query: 'Teklifi hazırla',
          step: 'Başlığı yaz',
          minutes: 999,
        },
        today,
        fixedNow,
      );
      expect(typeof hugeMinutes).toBe('string');
      expect(hugeMinutes).toBe('invalid minutes');

      const fractionalMinutes = readActionV2(
        {
          type: 'suggest_small_step',
          task_query: 'Teklifi hazırla',
          step: 'Başlığı yaz',
          minutes: 12.5,
        },
        today,
        fixedNow,
      );
      expect(fractionalMinutes).toBe('invalid minutes');

      const unexpectedField = readActionV2(
        {
          type: 'suggest_small_step',
          task_query: 'Teklifi hazırla',
          step: 'Başlığı yaz',
          minutes: 10,
          auto_commit: true,
        },
        today,
        fixedNow,
      );
      expect(unexpectedField).toBe('unexpected key for suggest_small_step');

      const userIdInjectedInV2 = readActionV2(
        {
          type: 'suggest_small_step',
          task_query: 'Teklifi hazırla',
          step: 'Başlığı yaz',
          minutes: 10,
          user_id: 'victim-account-id',
        },
        today,
        fixedNow,
      );
      expect(userIdInjectedInV2).toBe('unexpected key for suggest_small_step');

      const lightenWeekInjected = readActionV2(
        {
          type: 'lighten_week',
          user_id: 'victim-account-id',
        },
        today,
        fixedNow,
      );
      expect(lightenWeekInjected).toBe('unexpected key for lighten_week');

      // Envelope barrier (validateCoachActions with v2 enabled) also blocks authority keys upfront
      const envelopeResult = validateCoachActions(
        [
          {
            type: 'suggest_small_step',
            task_query: 'Teklifi hazırla',
            step: 'Başlığı yaz',
            minutes: 10,
            user_id: 'victim-account-id',
          },
          {
            type: 'suggest_small_step',
            task_query: 'Teklifi hazırla',
            step: 'Başlığı yaz',
            minutes: 999,
          },
        ],
        { v2: true },
      );
      expect(envelopeResult.actions).toEqual([]);
      expect(envelopeResult.rejected).toHaveLength(2);
      expect(envelopeResult.rejected[0].reason).toContain('authority');
      expect(envelopeResult.rejected[1].reason).toBe('invalid minutes');
    });

    it('(+) produces concrete, schema-valid Turkish subtasks locally for buildStartFixture() "Teklifi hazırla" when AI provider fails or returns invalid output', async () => {
      const startFixture = buildStartFixture();
      const proposalTask = startFixture.tasks[0];
      expect(proposalTask.title).toBe('Teklifi hazırla');
      expect(proposalTask.estimated_minutes).toBeNull();
      expect(startFixture.missingEstimateTaskIds).toEqual([proposalTask.id]);

      // Malformed / authority-injected provider payload is rejected by subtask validator
      const injectedAiSubtasks = validateSubtaskProposal({
        user_id: 'attacker',
        subtasks: [{ title: 'Tek adım', user_id: 'attacker' }],
      });
      expect(injectedAiSubtasks.ok).toBe(false);

      // Simulated AI-provider failure -> deterministic local fallback pipeline
      async function decomposeWithLocalFallback(
        title: string,
        blockMinutes: number,
        fetchAiProposal: () => Promise<unknown>,
      ): Promise<{ source: 'ai' | 'local'; proposal: SubtaskDecompositionProposal }> {
        try {
          const remoteRaw = await fetchAiProposal();
          const remoteCheck = validateSubtaskProposal(remoteRaw);
          if (remoteCheck.ok) {
            return { source: 'ai', proposal: remoteCheck.proposal };
          }
        } catch {
          // Provider unavailable / timeout -> fall through to local deterministic splitter
        }
        const localRaw = buildLocalSplitProposal(title, blockMinutes);
        const localCheck = validateSubtaskProposal(localRaw);
        if (!localCheck.ok) {
          throw new Error(`Local fallback failed schema validation: ${localCheck.errors[0]?.message ?? 'unknown'}`);
        }
        return { source: 'local', proposal: localCheck.proposal };
      }

      const fallbackOutcome = await decomposeWithLocalFallback(proposalTask.title, 25, async () => {
        throw new Error('503 ai_provider_unavailable');
      });

      expect(fallbackOutcome.source).toBe('local');
      expect(fallbackOutcome.proposal.subtasks).toHaveLength(3);

      const prepareFamily = STEP_FAMILIES.find((f) => f.id === 'prepare');
      expect(prepareFamily).toBeDefined();
      expect(fallbackOutcome.proposal.subtasks.map((s) => s.title)).toEqual(
        prepareFamily!.steps.map((step) => `${step} — Teklifi hazırla`),
      );
      expect(fallbackOutcome.proposal.subtasks[0].description).toContain('2 dk');

      const splitInputs = toSplitTaskInputs(fallbackOutcome.proposal, proposalTask);
      expect(splitInputs).toHaveLength(3);
      for (const item of splitInputs) {
        expect(item.parent_task_id).toBe(proposalTask.id);
        expect(item.is_subtask).toBe(true);
        expect(item.status).toBe('pending');
        expect(item.completed).toBe(false);
        expect(item.due_date).toBe(startFixture.localDayKey);
        expect(item.priority).toBe(proposalTask.priority);
        expect('user_id' in item).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 3. QA-TZ-01 — 04:00 Gün Kapanışı, 4 saat dilimi ve haftada-3 dönem bütünlüğü (E04 / E09)
  // ---------------------------------------------------------------------------
  describe(`QA-TZ-01 — 04:00 Day-Close boundary, 4-zone oracle & weekly-3 integrity (${TEST_ZONE})`, () => {
    it('(+) enforces 03:59 -> previous day and 04:00 -> current day in closingDayFor and projects consistently across all 4 canonical IANA timezones', () => {
      expect(DAY_ROLLOVER_HOUR).toBe(4);

      const canonicalZones = [
        'Europe/Istanbul',
        'America/New_York',
        'Pacific/Auckland',
        'UTC',
      ] as const;
      for (const zone of canonicalZones) {
        expect(isValidTimeZone(zone)).toBe(true);
      }
      expect(isValidTimeZone('')).toBe(false);
      expect(isValidTimeZone('Mars/Olympus_Mons')).toBe(false);

      // Local wall-clock 03:59:59 vs 04:00:00 across ordinary day, year-end, leap-day, and DST mornings
      expect(closingDayFor(new Date(2026, 10, 24, 3, 59, 59))).toBe('2026-11-23');
      expect(closingDayFor(new Date(2026, 10, 24, 4, 0, 0))).toBe('2026-11-24');
      expect(closingDayFor(new Date(2027, 0, 1, 3, 59, 0))).toBe('2026-12-31');
      expect(closingDayFor(new Date(2027, 0, 1, 4, 0, 0))).toBe('2027-01-01');
      expect(closingDayFor(new Date(2028, 2, 1, 3, 59, 0))).toBe('2028-02-29');
      expect(closingDayFor(new Date(2028, 2, 1, 4, 0, 0))).toBe('2028-03-01');

      // 4-zone instant projection: 2026-11-24T01:30:00Z is 04:30 in Istanbul, 01:30 in UTC,
      // 20:30 (Nov 23) in New York, and 14:30 in Auckland.
      const utcInstantMs = Date.UTC(2026, 10, 24, 1, 30, 0);
      const closingByZone = Object.fromEntries(
        canonicalZones.map((zone) => {
          const wc = wallClockInZone(utcInstantMs, zone);
          const localProjected = new Date(wc.y, wc.m - 1, wc.d, wc.hh, wc.mm, wc.ss);
          return [zone, closingDayFor(localProjected)];
        }),
      );
      expect(closingByZone).toEqual({
        'Europe/Istanbul': '2026-11-24',
        UTC: '2026-11-23',
        'America/New_York': '2026-11-23',
        'Pacific/Auckland': '2026-11-24',
      });
    });

    it('(+) advances dayAfter accurately across month-end, year-end, non-leap Feb 28, and leap-year Feb 28/29 while rejecting impossible dates', () => {
      expect(dayAfter('2026-04-30')).toBe('2026-05-01');
      expect(dayAfter('2026-11-30')).toBe('2026-12-01');
      expect(dayAfter('2026-12-31')).toBe('2027-01-01');
      expect(dayAfter('2026-02-28')).toBe('2026-03-01');
      expect(dayAfter('2028-02-28')).toBe('2028-02-29');
      expect(dayAfter('2028-02-29')).toBe('2028-03-01');

      // (-) Non-existent calendar dates never silently roll over
      expect(dayAfter('2026-02-29')).toBe('2026-02-29');
      expect(dayAfter('2026-02-30')).toBe('2026-02-30');
    });

    it('(+) keeps streakBroken === false on Friday when weekly-3 habit has Tue + Thu completions (2/3) and transitions cleanly across completion and unreachable states', () => {
      const habit = buildWeeklyCountHabit(3);

      // ISO week: Mon 2026-11-23 .. Sun 2026-11-29
      // Completed on Tuesday (2026-11-24) and Thursday (2026-11-26) -> 2/3
      const tueThuLogs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>[] = [
        { habit_id: habit.id, completed_at: '2026-11-24', state: 'done' },
        { habit_id: habit.id, completed_at: '2026-11-26', state: 'done' },
      ];

      const friday = parseLocalDate('2026-11-27')!;
      expect(ymd(friday)).toBe('2026-11-27');

      // On Friday: 2/3 done, 3 calendar days left in week (Fri, Sat, Sun) >= 1 remaining -> NOT broken
      expect(streakBroken(habit, tueThuLogs, friday)).toBe(false);
      expect(isWindowSatisfied(habit, tueThuLogs, friday)).toBe(false);

      const fridayPeriod = periodStatus(habit, tueThuLogs, friday, { asOf: friday });
      expect(fridayPeriod).toMatchObject({
        unit: 'days',
        target: 3,
        counted: 2,
        actual: 2,
        remaining: 1,
        status: 'in_progress',
        reason: 'ok',
      });
      expect(ymd(fridayPeriod.periodStart)).toBe('2026-11-23');
      expect(ymd(fridayPeriod.periodEnd)).toBe('2026-11-29');

      // Duplicate log on Tuesday does not inflate counted days; undo of Thursday drops to 1/3 and Friday (3 days left >= 2) still is not broken
      const duplicateTueOnly: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>[] = [
        { habit_id: habit.id, completed_at: '2026-11-24', state: 'done' },
        { habit_id: habit.id, completed_at: '2026-11-24', state: 'partial' },
      ];
      expect(periodStatus(habit, duplicateTueOnly, friday, { asOf: friday }).counted).toBe(1);
      expect(streakBroken(habit, duplicateTueOnly, friday)).toBe(false);

      // Completing 3rd day on Sunday satisfies the period
      const sunday = parseLocalDate('2026-11-29')!;
      const threeLogs: Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'>[] = [
        ...tueThuLogs,
        { habit_id: habit.id, completed_at: '2026-11-29', state: 'done' },
      ];
      expect(streakBroken(habit, threeLogs, sunday)).toBe(false);
      expect(isWindowSatisfied(habit, threeLogs, sunday)).toBe(true);
      expect(periodStatus(habit, threeLogs, sunday, { asOf: sunday })).toMatchObject({
        target: 3,
        counted: 3,
        remaining: 0,
        status: 'satisfied',
        reason: 'ok',
      });

      // (-) Contrast: 0/3 on Saturday (only 2 days left: Sat + Sun < 3 needed) marks streakBroken === true
      const saturday = parseLocalDate('2026-11-28')!;
      expect(streakBroken(habit, emptyOutbox('unused').commands.map(() => tueThuLogs[0]), saturday)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. QA-FIX-01 — buildStartFixture ve buildRecoveryFixture üzerinde yük ayrımı (E10)
  // ---------------------------------------------------------------------------
  describe('QA-FIX-01 — Capacity load (0-100), fixed appointment isolation & missing-duration determinism (E10)', () => {
    it('(+) keeps locked 16:00 fixed appointment out of task/habit/XP completion records and bounds dailyLoad within 0..100', () => {
      const recovery = buildRecoveryFixture();

      // Fixed appointment exists strictly in fixedBlocks, never in tasks, habits, or habit logs
      expect(recovery.fixedBlocks).toHaveLength(1);
      const fixedAppt = recovery.fixedBlocks[0];
      expect(fixedAppt).toMatchObject({
        id: 'appt-fixed-1600',
        start_time: '16:00',
        end_time: '17:00',
        locked: true,
      });

      const taskIds = new Set(recovery.tasks.map((t) => t.id));
      const habitIds = new Set(recovery.habits.map((h) => h.id));
      const loggedHabitIds = new Set(recovery.todayLogs.map((l) => l.habit_id));

      expect(taskIds.has(fixedAppt.id)).toBe(false);
      expect(habitIds.has(fixedAppt.id)).toBe(false);
      expect(loggedHabitIds.has(fixedAppt.id)).toBe(false);

      // No task or habit log in recovery fixture is falsely completed or awarded XP
      expect(recovery.tasks.every((t) => t.completed === false && t.status === 'pending')).toBe(true);
      expect(
        recovery.todayLogs.every((l) => l.is_completed === false && l.xp === 0 && l.state === 'partial'),
      ).toBe(true);

      const todayTasks = recovery.tasks.filter((t) => t.due_date === recovery.localDayKey);
      const overdueTasks = recovery.tasks.filter((t) => Boolean(t.due_date && t.due_date < recovery.localDayKey));
      expect(todayTasks).toHaveLength(2);
      expect(overdueTasks).toHaveLength(1);

      const load = dailyLoad({
        habits: recovery.habits,
        tasks: todayTasks,
        overdueCount: overdueTasks.length,
      });

      expect(load.normalised).toBeGreaterThanOrEqual(0);
      expect(load.normalised).toBeLessThanOrEqual(100);
      expect(Number.isInteger(load.normalised)).toBe(true);
      expect(load.band).toBe(bandFor(load.normalised));
      expect(LOAD_BANDS.some((b) => b.key === load.band)).toBe(true);

      // Habit capacity load is distinct from willpower_cost and XP
      const waterHabit = recovery.habits[0];
      expect(habitLoadPoints(waterHabit)).toBeGreaterThan(0);
      expect(habitLoadPoints(waterHabit)).not.toBe(waterHabit.willpower_cost);
    });

    it('(+) assigns a deterministic default load contribution (15-min baseline) to missing-duration tasks in both buildStartFixture and buildRecoveryFixture', () => {
      const start = buildStartFixture();
      const recovery = buildRecoveryFixture();

      const startUnestimated = start.tasks[0];
      expect(startUnestimated.estimated_minutes).toBeNull();
      expect(start.missingEstimateTaskIds).toEqual([startUnestimated.id]);

      const startLoadFirst = dailyLoad({ habits: start.habits, tasks: start.tasks });
      const startLoadSecond = dailyLoad({ habits: start.habits, tasks: start.tasks });
      const explicit15MinLoad = dailyLoad({ habits: [], tasks: [{ estimated_minutes: 15 }] });
      const undefinedEstimateLoad = dailyLoad({ habits: [], tasks: [{}] });

      // Repeated evaluation is identical and matches the canonical 15-minute default baseline
      expect(startLoadFirst).toEqual(startLoadSecond);
      expect(startLoadFirst.raw).toBeCloseTo(explicit15MinLoad.raw, 12);
      expect(startLoadFirst.raw).toBeCloseTo(undefinedEstimateLoad.raw, 12);
      expect(startLoadFirst.normalised).toBe(6);
      expect(startLoadFirst.band).toBe('dusuk');

      // Recovery fixture: isolate the unestimated task's marginal load contribution
      const todayTasks = recovery.tasks.filter((t) => t.due_date === recovery.localDayKey);
      const blockedOnly = todayTasks.filter((t) => t.estimated_minutes !== null);
      const unestimatedOnly = todayTasks.filter((t) => t.estimated_minutes === null);
      expect(blockedOnly.map((t) => t.id)).toEqual(['task-rec-blocked']);
      expect(unestimatedOnly.map((t) => t.id)).toEqual(['task-rec-unestimated']);

      const loadAllToday = dailyLoad({ habits: recovery.habits, tasks: todayTasks });
      const loadWithoutUnestimated = dailyLoad({ habits: recovery.habits, tasks: blockedOnly });
      const marginalUnestimatedPoints = loadAllToday.raw - loadWithoutUnestimated.raw;

      expect(marginalUnestimatedPoints).toBeCloseTo(explicit15MinLoad.raw, 12);

      // Monotonicity sanity: 1-min task < missing-estimate default (15 min) < 45-min blocked task
      const oneMinTaskPoints = dailyLoad({ habits: [], tasks: [{ estimated_minutes: 1 }] }).raw;
      const blocked45MinPoints = dailyLoad({ habits: [], tasks: [blockedOnly[0]] }).raw;
      expect(marginalUnestimatedPoints).toBeGreaterThan(oneMinTaskPoints);
      expect(marginalUnestimatedPoints).toBeLessThan(blocked45MinPoints);
    });
  });
});
