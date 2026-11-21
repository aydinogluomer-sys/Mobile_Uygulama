/**
 * F19 (TST-03) — replay, lost-response, account-guard, offline-durability and
 * permanent-refusal contracts for the six outbox transports added in a2fb9c51:
 * goal, project, reading_item, okr_objective, key_result, life_area_log.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('../../lib/session', () => require('../helpers/fakeCoreServer').session);
jest.mock('../../repositories/goalRepository', () => require('../helpers/fakeCoreServer').goalRepo);
jest.mock('../../repositories/projectRepository', () => require('../helpers/fakeCoreServer').projectRepo);
jest.mock('../../repositories/readingListRepository', () => require('../helpers/fakeCoreServer').readingRepo);
jest.mock('../../repositories/okrRepository', () => require('../helpers/fakeCoreServer').okrRepo);
jest.mock('../../repositories/lifeAreaRepository', () => require('../helpers/fakeCoreServer').lifeAreaRepo);
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn(), getSession: jest.fn() } } }));
/* eslint-enable @typescript-eslint/no-require-imports */

import {
  commitThenLoseResponse,
  goalRepo,
  lifeAreaRepo,
  okrRepo,
  projectRepo,
  readingRepo,
  server,
  type FakeTable,
} from '../helpers/fakeCoreServer';
import { MAX_ATTEMPTS, nextRetryDelayMs, type OutboxCommand } from '../../lib/outbox';
import { memoryOutboxStorage } from '../../lib/outboxStorage';
import { CORE_TRANSPORTS } from '../../services/coreOutbox';
import { createOutboxChannel } from '../../services/outboxChannel';

type TransportRow = {
  entity: keyof typeof CORE_TRANSPORTS;
  table: FakeTable;
  entityId: string;
  createPayload: Record<string, unknown>;
  updatePayload: Record<string, unknown> | null;
  readUpdatedField: () => unknown;
  expectedUpdatedValue: unknown;
  supportsDelete: boolean;
  rowCount: () => number;
  writeSpyTarget: () => { obj: Record<string, unknown>; method: string };
};

const ROWS: TransportRow[] = [
  {
    entity: 'goal',
    table: 'goals',
    entityId: 'g-1',
    createPayload: { kind: 'yearly', title: 'Kitap', progress: 10, year: 2026 },
    updatePayload: { progress: 60 },
    readUpdatedField: () => server.goals.get('g-1')?.progress,
    expectedUpdatedValue: 60,
    supportsDelete: true,
    rowCount: () => server.goals.size,
    writeSpyTarget: () => ({ obj: goalRepo, method: 'insertGoalWithId' }),
  },
  {
    entity: 'project',
    table: 'projects',
    entityId: 'p-1',
    createPayload: { name: 'Tez', color: '#6366f1' },
    updatePayload: { description: 'v2' },
    readUpdatedField: () => server.projects.get('p-1')?.description,
    expectedUpdatedValue: 'v2',
    supportsDelete: true,
    rowCount: () => server.projects.size,
    writeSpyTarget: () => ({ obj: projectRepo, method: 'insertProjectWithId' }),
  },
  {
    entity: 'reading_item',
    table: 'readingItems',
    entityId: 'r-1',
    createPayload: { title: 'Deep Work', type: 'book' },
    updatePayload: { status: 'reading' },
    readUpdatedField: () => server.readingItems.get('r-1')?.status,
    expectedUpdatedValue: 'reading',
    supportsDelete: true,
    rowCount: () => server.readingItems.size,
    writeSpyTarget: () => ({ obj: readingRepo, method: 'insertReadingItemWithId' }),
  },
  {
    entity: 'okr_objective',
    table: 'okrs',
    entityId: 'o-1',
    createPayload: { objective: 'Q4', year: 2026, quarter: 4 },
    updatePayload: null,
    readUpdatedField: () => null,
    expectedUpdatedValue: null,
    supportsDelete: true,
    rowCount: () => server.okrs.size,
    writeSpyTarget: () => ({ obj: okrRepo, method: 'insertObjectiveWithId' }),
  },
  {
    entity: 'key_result',
    table: 'keyResults',
    entityId: 'kr-1',
    createPayload: { okr_id: 'o1', title: 'KR', current_value: 0, target_value: 10 },
    updatePayload: { current_value: 4 },
    readUpdatedField: () => server.keyResults.get('kr-1')?.current_value,
    expectedUpdatedValue: 4,
    supportsDelete: true,
    rowCount: () => server.keyResults.size,
    writeSpyTarget: () => ({ obj: okrRepo, method: 'insertKeyResultWithId' }),
  },
  {
    entity: 'life_area_log',
    table: 'lifeAreaLogs',
    entityId: '2026-10-08',
    createPayload: { saglik: 7 },
    updatePayload: { saglik: 8 },
    readUpdatedField: () => server.lifeAreaLogs.get('2026-10-08|saglik'),
    expectedUpdatedValue: 8,
    supportsDelete: false,
    rowCount: () => server.lifeAreaLogs.size,
    writeSpyTarget: () => ({ obj: lifeAreaRepo, method: 'upsertLifeAreaLogs' }),
  },
];

function makeCmd(over: Partial<OutboxCommand> & Pick<OutboxCommand, 'entity' | 'entityId' | 'kind' | 'payload'>): OutboxCommand {
  return {
    operationId: 'op-1',
    userId: 'u1',
    baseVersion: null,
    dependsOn: [],
    seq: 1,
    attempts: 0,
    status: 'pending',
    readyAt: 0,
    createdAt: 0,
    ...over,
  };
}

describe.each(ROWS)('coreOutbox transport replay contract — $entity', (row) => {
  let clock = 1_000_000;
  const makeChannel = () =>
    createOutboxChannel({
      storage: memoryOutboxStorage(),
      transports: CORE_TRANSPORTS,
      currentUserId: async () => server.user,
      now: () => clock,
    });

  beforeEach(() => {
    server.reset();
    clock = 1_000_000;
  });

  it('re-delivering create five times produces applied five times and a single server row', async () => {
    const transport = CORE_TRANSPORTS[row.entity];
    const cmd = makeCmd({ entity: row.entity, entityId: row.entityId, kind: 'create', payload: row.createPayload });
    for (let i = 0; i < 5; i += 1) {
      const outcome = await transport(cmd);
      expect(outcome.kind).toBe('applied');
    }
    expect(row.rowCount()).toBe(1);
  });

  it('commitThenLoseResponse: first delivery sees offline after server commits, second settles applied with 1 row', async () => {
    const transport = CORE_TRANSPORTS[row.entity];
    const cmd = makeCmd({ entity: row.entity, entityId: row.entityId, kind: 'create', payload: row.createPayload });
    commitThenLoseResponse(row.table, 1);

    const first = await transport(cmd);
    expect(first.kind).toBe('offline');
    expect(row.rowCount()).toBe(1);

    const second = await transport(cmd);
    expect(second.kind).toBe('applied');
    expect(row.rowCount()).toBe(1);
  });

  it('handles update replay (applied twice without self-conflict, or rejected if unsupported)', async () => {
    const transport = CORE_TRANSPORTS[row.entity];
    await transport(makeCmd({ entity: row.entity, entityId: row.entityId, kind: 'create', payload: row.createPayload }));

    const upd = makeCmd({
      operationId: 'op-upd',
      entity: row.entity,
      entityId: row.entityId,
      kind: 'update',
      payload: row.updatePayload ?? { unsupported: true },
    });

    if (row.updatePayload === null) {
      expect((await transport(upd)).kind).toBe('rejected');
      return;
    }

    expect((await transport(upd)).kind).toBe('applied');
    expect((await transport(upd)).kind).toBe('applied');
    expect(row.readUpdatedField()).toBe(row.expectedUpdatedValue);
  });

  it('handles delete replay (applied twice with 0 rows left, or rejected if unsupported)', async () => {
    const transport = CORE_TRANSPORTS[row.entity];
    await transport(makeCmd({ entity: row.entity, entityId: row.entityId, kind: 'create', payload: row.createPayload }));

    const del = makeCmd({
      operationId: 'op-del',
      entity: row.entity,
      entityId: row.entityId,
      kind: 'delete',
      payload: {},
    });

    if (!row.supportsDelete) {
      expect((await transport(del)).kind).toBe('rejected');
      expect(row.rowCount()).toBe(1);
      return;
    }

    expect((await transport(del)).kind).toBe('applied');
    expect((await transport(del)).kind).toBe('applied');
    expect(row.rowCount()).toBe(0);
  });

  it('refuses delivery with auth when command userId differs from signed-in session', async () => {
    server.user = 'u1';
    const transport = CORE_TRANSPORTS[row.entity];
    const foreign = makeCmd({
      userId: 'u2',
      entity: row.entity,
      entityId: row.entityId,
      kind: 'create',
      payload: row.createPayload,
    });
    const outcome = await transport(foreign);
    expect(outcome.kind).toBe('auth');
    expect(row.rowCount()).toBe(0);
  });

  it('survives 8 offline flushes without spending attempts (dead=0, pending=1) and delivers once online', async () => {
    const ch = makeChannel();
    server.online = false;
    await ch.write({ entity: row.entity, entityId: row.entityId, kind: 'create', payload: row.createPayload });

    for (let i = 0; i < 8; i += 1) {
      clock += 60_000;
      await ch.flush();
    }
    expect(ch.sync()).toMatchObject({ pending: 1, dead: 0 });
    expect(row.rowCount()).toBe(0);

    server.online = true;
    clock += 60_000;
    await ch.flush();
    expect(ch.sync()).toMatchObject({ pending: 0, dead: 0 });
    expect(row.rowCount()).toBe(1);
  });

  it('marks command dead after MAX_ATTEMPTS permanent 4xx server refusals without inserting', async () => {
    const ch = makeChannel();
    server.refuse = { status: 422, error: 'check violation' };
    await ch.write({ entity: row.entity, entityId: row.entityId, kind: 'create', payload: row.createPayload });
    await ch.flush();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      clock += nextRetryDelayMs(attempt) + 1_000;
      await ch.flush();
    }
    expect(ch.sync()).toMatchObject({ pending: 0, dead: 1 });
    expect(row.rowCount()).toBe(0);
  });

  it('healthy create makes a single repository write call and drains the queue', async () => {
    const { obj, method } = row.writeSpyTarget();
    const spy = jest.spyOn(obj as Record<string, (...args: unknown[]) => unknown>, method);
    try {
      const ch = makeChannel();
      await ch.write({ entity: row.entity, entityId: row.entityId, kind: 'create', payload: row.createPayload });
      await ch.flush();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(ch.state()?.commands ?? []).toHaveLength(0);
      expect(row.rowCount()).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
