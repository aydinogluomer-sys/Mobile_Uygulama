/**
 * Phases F5 & F6 Readiness & Stress Verification (`f5f6PilotAndScaleReadiness.test.ts`).
 *
 * Verifies:
 * 1. `docs/implementation-v3/PILOT_EXECUTION_KIT.md` completeness and evidence honesty (`Y12` & `Y05`):
 *    frozen tasks `G1..G7`, Tur 1 & Tur 2 (`5–8`, >=50% new users in Tur 2, synthetic accounts only),
 *    both primary metrics (`P90` + small-sample warning + explicit recovery denominator),
 *    `PILOT-01..05` gates, and explicit `BLOKE` / `N/R` status without claiming live completion.
 * 2. End-to-end simulated `Y05` multi-step stress flow:
 *    `Account A` queues offline task + «Koru -> Gör -> Uygula» replan -> simulated mid-write OS kill /
 *    app reload -> `Account B` signs in online, writes its own task, and sees ZERO `Account A` data ->
 *    `Account A` signs back in and reconciles cleanly with a single side-effect per command.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

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
  estimate_source?: 'user' | 'ai' | 'block' | 'default' | null;
};

type MockRepoFailure = {
  ok: false;
  error: string;
  offline?: boolean;
  status?: number;
  code?: string;
};

type MockRepoResult<T> = { ok: true; data: T } | MockRepoFailure;

const mockSession: { user: { id: string; email: string | null } | null } = {
  user: { id: 'user-pilot-A', email: null },
};

const mockServer = {
  online: true,
  clock: 0,
  tasks: new Map<string, ServerTaskRow>(),
  insertCountByTaskId: new Map<string, number>(),
  updateCountByTaskId: new Map<string, number>(),
};

function mockNextTimestamp(): string {
  mockServer.clock += 1;
  return `2026-11-24T12:00:${String(mockServer.clock).padStart(2, '0')}.000Z`;
}

function mockGuardAccount(expectedUserId?: string): MockRepoFailure | null {
  const activeUserId = mockSession.user?.id;
  if (!activeUserId) {
    return { ok: false, error: 'Oturum bulunamadı.', status: 401 };
  }
  if (expectedUserId !== undefined && expectedUserId !== activeUserId) {
    return { ok: false, error: 'Oturum başka bir hesaba ait.', status: 401 };
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
  ensurePermission: jest.fn(async () => true),
  scheduleFocusEnd: jest.fn(async () => true),
  cancelFocusEnd: jest.fn(async () => undefined),
  listScheduled: jest.fn(async () => []),
  cancelScheduled: jest.fn(async () => undefined),
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
      const rows = [...mockServer.tasks.values()].filter(
        (r) => r.user_id === uid && r.status !== 'cancelled',
      );
      return { rows, nextCursor: null, hasMore: false };
    }),
  ),
  insertTaskRow: jest.fn(
    async (
      row: Partial<ServerTaskRow> & { id: string },
      expectedUserId?: string,
    ): Promise<MockRepoResult<ServerTaskRow>> => {
      const mismatch = mockGuardAccount(expectedUserId);
      if (mismatch) return mismatch;
      if (mockServer.online && mockServer.tasks.has(row.id)) {
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
          ...(row.estimated_minutes !== undefined
            ? { estimated_minutes: row.estimated_minutes }
            : {}),
          ...(row.estimate_source !== undefined ? { estimate_source: row.estimate_source } : {}),
        };
        mockServer.tasks.set(created.id, created);
        mockServer.insertCountByTaskId.set(
          created.id,
          (mockServer.insertCountByTaskId.get(created.id) ?? 0) + 1,
        );
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
        const current = mockServer.tasks.get(id);
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
        mockServer.tasks.set(id, updated);
        mockServer.updateCountByTaskId.set(
          id,
          (mockServer.updateCountByTaskId.get(id) ?? 0) + 1,
        );
        return { row: updated, exists: true };
      });
    },
  ),
  fetchTaskRow: jest.fn(async (id: string): Promise<MockRepoResult<ServerTaskRow | null>> =>
    mockGateNetwork(() => {
      const found = mockServer.tasks.get(id);
      if (!found || found.user_id !== mockSession.user?.id) return null;
      return found;
    }),
  ),
  deleteTaskIfPresent: jest.fn(
    async (id: string, expectedUserId?: string): Promise<MockRepoResult<{ deleted: boolean }>> => {
      const mismatch = mockGuardAccount(expectedUserId);
      if (mismatch) return mismatch;
      return mockGateNetwork(() => {
        const found = mockServer.tasks.get(id);
        if (!found || found.user_id !== mockSession.user?.id) {
          return { deleted: false };
        }
        return { deleted: mockServer.tasks.delete(id) };
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
import { buildDayPlanPreview, type FixedPlanBlock } from '../../lib/dayPlanPreview';
import { markSending } from '../../lib/outbox';
import {
  asyncStorageOutbox,
  OUTBOX_VERSION,
  outboxKey,
  parseStored,
} from '../../lib/outboxStorage';
import { commitDayPlan, type PlanMutationItem } from '../../services/dayPlanCommitService';
import { setTaskOutboxStorage, useTaskStore } from '../../store/taskStore';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const PILOT_KIT_PATH = join(REPO_ROOT, 'docs', 'implementation-v3', 'PILOT_EXECUTION_KIT.md');

describe('Phases F5 & F6 — Pilot Execution Kit Contract & Simulated Y05 Stress Flow', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    mockServer.online = true;
    mockServer.clock = 0;
    mockServer.tasks.clear();
    mockServer.insertCountByTaskId.clear();
    mockServer.updateCountByTaskId.clear();
    mockSession.user = { id: 'user-pilot-A', email: null };
    setTaskOutboxStorage(asyncStorageOutbox);
    resetAccountMemory('signed_out');
    jest.clearAllMocks();
  });

  // ===========================================================================
  // 1. PILOT_EXECUTION_KIT.md — Y12 & Y05 Contract + Honest Evidence Status
  // ===========================================================================
  describe('Y12 & Y05 — PILOT_EXECUTION_KIT.md completeness and evidence honesty', () => {
    const rawPilotKit = readFileSync(PILOT_KIT_PATH, 'utf8').replace(/\r\n?/g, '\n');
    const strippedSelf = stripComments(readFileSync(__filename, 'utf8'));

    it('(+) documents Tur 1 & Tur 2 (5–8 participants, >=50% new users in Tur 2, candidate SHA lock, synthetic accounts only)', () => {
      expect(strippedSelf.length).toBeGreaterThan(100);
      expect(rawPilotKit).toContain('Tur 1');
      expect(rawPilotKit).toContain('Tur 2');
      expect(rawPilotKit).toMatch(/Tur 1[^\n]*5–8/);
      expect(rawPilotKit).toMatch(/Tur 2[^\n]*5–8/);
      expect(rawPilotKit).toMatch(/en az yarısı yeni kullanıcı/i);
      expect(rawPilotKit).toMatch(/yeni aday SHA kilidi/i);
      expect(rawPilotKit).toMatch(/sentetik test hesabı/i);
      expect(rawPilotKit).toMatch(/kişisel verisi toplanmaz/i);

      // P02 behavioral cohorts present without clinical diagnosis claims
      expect(rawPilotKit).toContain('start_blocked');
      expect(rawPilotKit).toContain('midday_derailed');
      expect(rawPilotKit).toContain('self_planner');
      expect(rawPilotKit).toContain('routine_starter');
    });

    it('(+) documents all 7 frozen tasks (G1..G7), both core product promises, and moderator recording columns', () => {
      const lines = rawPilotKit.split('\n');
      for (const code of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7'] as const) {
        const taskRows = lines.filter((line) => line.startsWith(`| \`${code}\``));
        expect(taskRows.length).toBeGreaterThanOrEqual(2); // definition row + moderator recording sheet row
      }

      // Core promises & required task specifics
      expect(rawPilotKit).toContain('Nereden başlayacağımı bilmiyorum');
      expect(rawPilotKit).toContain('1,5 L');
      expect(rawPilotKit).toContain('Koru → Gör → Uygula');

      // Moderator recording sheet columns
      expect(rawPilotKit).toContain('Yardımsız / Yardımlı / Başarısız');
      expect(rawPilotKit).toContain('Süre (sn)');
      expect(rawPilotKit).toContain('Yanlış Yan Etki (0 olmalı)');
      expect(rawPilotKit).toContain('Gözlem Notu');
    });

    it('(+) defines both primary product metrics (median + P90 w/ small-sample warning, and recovery return rate denominator)', () => {
      expect(rawPilotKit).toMatch(/İlk etkin eyleme kadar süre/i);
      expect(rawPilotKit).toContain('P90');
      expect(rawPilotKit).toMatch(/Medyan/i);
      expect(rawPilotKit).toMatch(/küçük örneklem uyarısı/i);

      expect(rawPilotKit).toMatch(/Plan aksadıktan sonra aynı gün yeniden eyleme geçme oranı/i);
      expect(rawPilotKit).toMatch(/Payda tanımı/i);
      expect(rawPilotKit).toContain('04:00');
    });

    it('(+) documents the Y05 physical-device matrix (Android + iPhone) and PILOT-01..05 gates with explicit BLOKE / N/R honesty', () => {
      // Y05 physical device scenarios
      expect(rawPilotKit).toMatch(/Düşük\/orta sınıf Android/i);
      expect(rawPilotKit).toContain('iPhone');
      expect(rawPilotKit).toMatch(/OS kill/i);
      expect(rawPilotKit).toMatch(/uçak mod/i);
      expect(rawPilotKit).toMatch(/saat dilimi/i);
      expect(rawPilotKit).toMatch(/bildirime geç tıklama/i);
      expect(rawPilotKit).toMatch(/Hesap A → Hesap B/i);

      // PILOT-01..05 gate rows
      const lines = rawPilotKit.split('\n');
      for (const gateId of ['PILOT-01', 'PILOT-02', 'PILOT-03', 'PILOT-04', 'PILOT-05'] as const) {
        const gateRow = lines.find((line) => line.startsWith(`| \`${gateId}\``));
        expect(gateRow).toBeDefined();
        expect(gateRow).toMatch(/BLOKE|N\/R/);
      }

      // Explicit release honesty rule & absence of false live completion claims
      expect(rawPilotKit).toContain('BLOKE');
      expect(rawPilotKit).toContain('N/R');
      expect(rawPilotKit).toContain('Açık P0 canlı/cihaz kapısı varken "yayına hazır" ilan edilmez');
      expect(rawPilotKit).not.toMatch(/yayına hazırdır|canlı pilot tamamlandı|cihaz testi tamamlandı/i);
    });
  });

  // ===========================================================================
  // 2. Y05 — End-to-End Simulated Offline + Replan + App Reload + Account Switch Stress Flow
  // ===========================================================================
  describe('Y05 — Multi-step offline task + replan -> OS kill reload -> Account B isolation -> Account A single-effect reconciliation', () => {
    it('(+) preserves Account A offline task + replan across mid-write app reload, leaks ZERO data to Account B, and reconciles cleanly with single side-effect on return', async () => {
      const localDayKey = '2026-11-24';

      // Step 0: Seed Account A with an existing server-backed task due today (to be replanned offline)
      mockSession.user = { id: 'user-pilot-A', email: null };
      mockServer.online = true;

      const seededRowA: ServerTaskRow = {
        id: 'task-a-server-existing',
        user_id: 'user-pilot-A',
        title: 'A — Öğleden sonra bütçe sunumu hazırlığı',
        description: null,
        completed: false,
        status: 'pending',
        completed_at: null,
        created_at: '2026-11-24T07:00:00.000Z',
        updated_at: '2026-11-24T07:00:00.000Z',
        list_type: 'this_week',
        priority: 'medium',
        due_date: localDayKey,
        is_subtask: false,
        parent_task_id: null,
        project_id: null,
        notes_text: null,
        time_block_start: '16:15',
        time_block_end: '17:00',
        estimated_minutes: 45,
        estimate_source: 'block',
      };
      mockServer.tasks.set(seededRowA.id, { ...seededRowA });

      await useTaskStore.getState().fetchTasks();
      expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual([seededRowA.id]);

      // Step 1: Enter airplane mode -> Account A creates a new offline task AND runs «Koru -> Gör -> Uygula» replan
      mockServer.online = false;

      const offlineCreatedTaskA = await useTaskStore.getState().addTask({
        title: 'A — Çevrimdışı müşteri teklif özeti',
        priority: 'high',
        due_date: localDayKey,
        list_type: 'inbox',
        estimated_minutes: 20,
        estimate_source: 'user',
      });
      expect(offlineCreatedTaskA).not.toBeNull();

      const fixedBlocksA: FixedPlanBlock[] = [
        {
          id: 'appt-a-1600',
          user_id: 'user-pilot-A',
          title: 'Müşteri değerlendirme toplantısı',
          local_day: localDayKey,
          start_time: '16:00',
          end_time: '17:00',
          locked: true,
          source: 'internal_fixed',
        },
      ];

      const previewA = buildDayPlanPreview({
        userId: 'user-pilot-A',
        localDayKey,
        nowLocalMinutes: 15 * 60, // 15:00
        generatedAtIso: '2026-11-24T12:00:00.000Z',
        protectedRef: { entity: 'task', id: offlineCreatedTaskA!.id },
        fixedBlocks: fixedBlocksA,
        tasks: useTaskStore.getState().tasks,
        habits: [],
        todayLogs: [],
        remainingCapacityMinutes: 25,
      });

      // Fixed 16:00 appointment is locked; offlineCreatedTaskA is protected; seededRowA conflicts w/ 16:00 -> postpone_tomorrow
      expect(previewA.lockedItems.map((l) => l.id)).toContain('appt-a-1600');
      expect(previewA.protectedItems.map((p) => p.sourceRef.id)).toEqual([offlineCreatedTaskA!.id]);
      const replanChangeForSeeded = previewA.changes.find(
        (ch) => ch.sourceRef.entity === 'task' && ch.sourceRef.id === seededRowA.id,
      );
      expect(replanChangeForSeeded).toBeDefined();
      expect(replanChangeForSeeded!.action).toBe('postpone_tomorrow');

      const replanMutations: PlanMutationItem[] = [
        {
          itemId: replanChangeForSeeded!.changeId,
          entity: 'task',
          targetId: seededRowA.id,
          title: seededRowA.title,
          expectedVersion: seededRowA.updated_at,
          action: 'postpone_tomorrow',
        },
      ];

      const offlineCommitRes = await commitDayPlan(
        {
          operationId: 'op-y05-offline-replan-a',
          localDayKey,
          ianaZone: 'Europe/Istanbul',
          items: replanMutations,
        },
        { now: () => new Date('2026-11-24T12:05:00.000Z') },
      );

      // Honest offline reporting (§7.1): queued in outbox -> 'pending', NEVER fake 'committed'
      expect(offlineCommitRes.overall).toBe('pending');
      expect(offlineCommitRes.results[0].status).toBe('pending');
      expect(useTaskStore.getState().sync.pending).toBe(2);

      // Server still holds untouched seededRowA (due_date 2026-11-24) and does NOT yet have offlineCreatedTaskA
      expect(mockServer.tasks.has(offlineCreatedTaskA!.id)).toBe(false);
      expect(mockServer.tasks.get(seededRowA.id)?.due_date).toBe('2026-11-24');

      // Step 2: Simulate OS kill mid-write (`sending: true` persisted on disk) -> cold app reload while still offline
      const keyA = outboxKey('user-pilot-A');
      const rawBeforeKill = await AsyncStorage.getItem(keyA);
      expect(rawBeforeKill).not.toBeNull();
      const parsedBeforeKill = parseStored(rawBeforeKill, 'user-pilot-A');
      expect(parsedBeforeKill.state.commands).toHaveLength(2);

      const midFlightCrashedState = markSending(
        parsedBeforeKill.state,
        parsedBeforeKill.state.commands[0].operationId,
      );
      expect(midFlightCrashedState.commands.filter((c) => c.sending)).toHaveLength(1);
      await AsyncStorage.setItem(
        keyA,
        JSON.stringify({ v: OUTBOX_VERSION, state: midFlightCrashedState }),
      );

      // Process dies: wipe Zustand store in-memory state completely
      useTaskStore.setState({
        tasks: [],
        outbox: null,
        tasksLoaded: false,
        cursor: null,
        hasMore: false,
        error: null,
      });

      // Cold boot reload for Account A -> `parseStored` clears stuck `sending: true` back to sendable
      const reloadedOutboxA = await asyncStorageOutbox.load('user-pilot-A');
      expect(reloadedOutboxA.commands).toHaveLength(2);
      expect(reloadedOutboxA.commands.filter((c) => c.sending)).toHaveLength(0);

      // Step 3: Account A signs out / Account B signs in on the same device while network comes back online
      const epochBeforeSwitch = accountEpoch();
      resetAccountMemory('user_changed');
      mockSession.user = { id: 'user-pilot-B', email: null };
      mockServer.online = true;

      expect(accountEpoch()).toBeGreaterThan(epochBeforeSwitch);
      expect(useTaskStore.getState().tasks).toEqual([]);
      expect(useTaskStore.getState().outbox).toBeNull();

      await useTaskStore.getState().fetchTasks();
      await useTaskStore.getState().flush();

      // Account B sees ZERO Account A tasks and ZERO Account A commands were flushed under Account B
      expect(useTaskStore.getState().tasks).toEqual([]);
      expect(mockServer.tasks.has(offlineCreatedTaskA!.id)).toBe(false);
      expect(mockServer.tasks.get(seededRowA.id)?.due_date).toBe('2026-11-24');
      expect(parseStored(await AsyncStorage.getItem(keyA), 'user-pilot-B').problem).toBe('account');

      // Account B creates and syncs its own task cleanly
      const taskB = await useTaskStore.getState().addTask({
        title: 'B — Kendi kişisel alışveriş listesi',
        priority: 'low',
        due_date: localDayKey,
      });
      await useTaskStore.getState().flush();
      expect(taskB).not.toBeNull();
      expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual([taskB!.id]);
      expect(mockServer.tasks.get(taskB!.id)?.user_id).toBe('user-pilot-B');

      // Step 4: Account A signs back in online and reconciles cleanly with a SINGLE side-effect per command
      resetAccountMemory('user_changed');
      mockSession.user = { id: 'user-pilot-A', email: null };

      await useTaskStore.getState().fetchTasks();
      await useTaskStore.getState().authRefreshed();
      await useTaskStore.getState().flush();
      // Second flush proves idempotent no-op once settled
      await useTaskStore.getState().flush();
      await useTaskStore.getState().fetchTasks();

      expect(useTaskStore.getState().sync).toEqual({
        pending: 0,
        dead: 0,
        conflict: 0,
        authBlocked: false,
      });

      // Verify exact single side-effect on server & strict user ownership
      expect(mockServer.insertCountByTaskId.get(offlineCreatedTaskA!.id)).toBe(1);
      expect(mockServer.updateCountByTaskId.get(seededRowA.id)).toBe(1);

      expect(mockServer.tasks.get(offlineCreatedTaskA!.id)).toMatchObject({
        user_id: 'user-pilot-A',
        title: 'A — Çevrimdışı müşteri teklif özeti',
        due_date: '2026-11-24',
        estimated_minutes: 20,
      });
      expect(mockServer.tasks.get(seededRowA.id)).toMatchObject({
        user_id: 'user-pilot-A',
        due_date: '2026-11-25',
        time_block_start: null,
        time_block_end: null,
      });

      // Account A never sees Account B's task
      expect(useTaskStore.getState().tasks.every((t) => t.user_id === 'user-pilot-A')).toBe(true);
      expect(useTaskStore.getState().tasks.some((t) => t.id === taskB!.id)).toBe(false);

      // Bonus Y05/Y11 check: deleting Account A purges outbox.v1.user-pilot-A without touching Account B's storage
      await endAccountScope('account_deleted', 'user-pilot-A');
      expect(await AsyncStorage.getItem(keyA)).toBeNull();
      expect(await AsyncStorage.getItem(outboxKey('user-pilot-B'))).not.toBeNull();
    });
  });
});
