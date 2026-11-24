import { readFileSync } from 'fs';
import { join } from 'path';
import { emptyOutbox, enqueue, MAX_ATTEMPTS, settle, summary, type OutboxState } from '../../lib/outbox';
import {
  createOutboxEngine,
  ENTITY_LABELS_TR,
  ENTITY_POLICIES,
  habitLogEntityId,
  parseHabitLogEntityId,
  planLegacyMigration,
  safeUserIdOf,
  WEBHOOK_DEAD_REASON,
  WEBHOOK_EVENT_ENTITY,
  webhookOperationId,
   writeThrough,
  type EngineChannel,
} from '../../lib/outboxEngine';
import { emptyQueueState, enqueue as legacyEnqueue } from '../../lib/syncQueue';
import { CORE_TRANSPORTS } from '../../services/coreOutbox';
import { stripComments } from '../helpers/sourceText';

function makeFakeChannel(initial: OutboxState | null = null, flushImpl?: () => Promise<void>): EngineChannel & { setBox: (s: OutboxState | null) => void } {
  let box = initial;
  const subs = new Set<(s: OutboxState | null) => void>();
  return {
    setBox(s) {
      box = s;
      for (const fn of subs) fn(box);
    },
    ensure: async () => box,
    state: () => box,
    sync: () => summary(box ?? emptyOutbox('')),
    subscribe: (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    retry: async () => undefined,
    discard: async () => undefined,
    authRefreshed: async () => undefined,
    reset: () => {
      box = null;
    },
    write: async (input) => {
      const cur = box ?? emptyOutbox('u1');
      const opId = `op-${cur.nextSeq}`;
      const res = enqueue(cur, { ...input, operationId: opId }, cur.userId, 1_000);
      if (!res.ok) return { ok: false, error: res.reason };
      box = res.state;
      for (const fn of subs) fn(box);
      return { ok: true, operationId: opId, savedOnDevice: true };
    },
    replace: async () => ({ ok: true, operationId: 'rep', savedOnDevice: true }),
    flush: flushImpl ?? (async () => undefined),
    onSettled: () => () => undefined,
    reloadFromStorage: async () => undefined,
    nextReadyAt: () => 5_000,
    attachTabs: () => () => undefined,
  };
}

describe('F46 (5.2-b) — unified outbox engine, writeThrough, ENTITY_POLICIES & migration planner', () => {
  it('(+) register replaces channel with same id, summaryAll aggregates 4 channels, and subscribeAll notifies', () => {
    const engine = createOutboxEngine();
    let notifies = 0;
    engine.subscribeAll(() => {
      notifies += 1;
    });

    const oldTask = makeFakeChannel(emptyOutbox('u1'));
    const newTask = makeFakeChannel(emptyOutbox('u1'));
    const habit = makeFakeChannel(emptyOutbox('u1'));
    engine.register('task', oldTask);
    engine.register('task', newTask);
    engine.register('habit', habit);

    // Updating replaced channel no longer fires engine listeners
    oldTask.setBox(emptyOutbox('u1'));
    expect(notifies).toBe(0);

    const r1 = enqueue(emptyOutbox('u1'), { operationId: 't1', entity: 'task', entityId: '1', kind: 'create' }, 'u1', 100);
    const r2 = enqueue(emptyOutbox('u1'), { operationId: 'h1', entity: 'habit_log', entityId: 'h1|2026-08-04', kind: 'update' }, 'u1', 100);
    if (r1.ok) newTask.setBox(r1.state);
    if (r2.ok) habit.setBox(r2.state);

    expect(notifies).toBe(2);
    const all = engine.summaryAll();
    expect(all.pending).toBe(2);
    expect(all.channels.task.pending).toBe(1);
    expect(all.channels.habit.pending).toBe(1);
    expect(all.channels.core.pending).toBe(0);
    expect(all.channels.effect.pending).toBe(0);
  });

  it('(+) flushAll isolates a throwing channel into errors[id] while still flushing all siblings; flushers() matches Flusher contract', async () => {
    const engine = createOutboxEngine();
    const flushed: string[] = [];
    engine.register('habit', makeFakeChannel(emptyOutbox('u1'), async () => { flushed.push('habit'); }));
    engine.register('task', makeFakeChannel(emptyOutbox('u1'), async () => { throw new Error('task failed'); }));
    engine.register('core', makeFakeChannel(emptyOutbox('u1'), async () => { flushed.push('core'); }));
    engine.register('effect', makeFakeChannel(emptyOutbox('u1'), async () => { flushed.push('effect'); }));

    const res = await engine.flushAll();
    expect(flushed).toEqual(['habit', 'core', 'effect']);
    expect(res.errors).toEqual({ task: 'task failed' });

    const flushers = engine.flushers();
    expect(flushers.map((f) => f.name)).toEqual(['habit', 'task', 'core', 'effect']);
    expect(flushers[0].nextReadyAt()).toBe(5_000);
  });

  it('(+) listIssues surfaces dead & conflict commands from all four channels with Turkish labels and calm webhook reason', () => {
    const engine = createOutboxEngine();
    let coreState = emptyOutbox('u1');
    const cRes = enqueue(coreState, { operationId: 'n-conf', entity: 'note', entityId: 'n1', kind: 'update' }, 'u1', 10);
    if (cRes.ok) coreState = settle(cRes.state, 'n-conf', { kind: 'conflict', error: 'moved' }, 20);

    let effState = emptyOutbox('u1');
    const eRes = enqueue(effState, { operationId: 'w-dead', entity: WEBHOOK_EVENT_ENTITY, entityId: 'w1', kind: 'update' }, 'u1', 10);
    if (eRes.ok) {
      effState = eRes.state;
      for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
        effState = settle(effState, 'w-dead', { kind: 'rejected', error: 'HTTP 404' }, 20);
      }
    }

    engine.register('core', makeFakeChannel(coreState));
    engine.register('effect', makeFakeChannel(effState));

    const issues = engine.listIssues();
    expect(issues).toEqual([
      expect.objectContaining({ channel: 'core', status: 'conflict', label: ENTITY_LABELS_TR.note }),
      expect.objectContaining({
        channel: 'effect',
        status: 'dead',
        label: 'Otomasyon bildirimi',
        reason: WEBHOOK_DEAD_REASON,
      }),
    ]);
  });

  it('(+) writeThrough handles online, offline -> outbox (idempotent repeat + savedOnDevice:false), userId throw, and (-) does NOT queue non-offline errors', async () => {
    const ch = makeFakeChannel(emptyOutbox('u1'));

    // 1. Online success
    const onlineOk = await writeThrough({
      channel: ch,
      entity: 'goal',
      entityId: 'g1',
      kind: 'create',
      payload: { title: 'H1' },
      online: async () => ({ ok: true, data: { id: 'g1', title: 'H1' } }),
      userId: async () => 'u1',
    });
    expect(onlineOk).toEqual({ ok: true, via: 'online', row: { id: 'g1', title: 'H1' }, userId: 'u1' });
    expect(ch.state()?.commands).toHaveLength(0);

    // 2. Non-offline permanent failure -> NOT queued
    const rejected = await writeThrough({
      channel: ch,
      entity: 'goal',
      entityId: 'g2',
      kind: 'create',
      payload: { title: 'Bad' },
      online: async () => ({ ok: false, error: 'RLS violation', offline: false }),
      userId: async () => 'u1',
    });
    expect(rejected).toEqual({ ok: false, error: 'RLS violation' });
    expect(ch.state()?.commands).toHaveLength(0);

    // 3. Offline -> queued; second call on same entityId merges to 1 command
    const off1 = await writeThrough({
      channel: ch,
      entity: 'goal',
      entityId: 'g3',
      kind: 'create',
      payload: { title: 'First', progress: 0 },
      online: async () => ({ ok: false, error: 'Network down', offline: true }),
      userId: async () => {
        throw new Error('session failed');
      },
    });
    expect(off1).toMatchObject({ ok: true, via: 'outbox', savedOnDevice: true, userId: null });
    const off2 = await writeThrough({
      channel: ch,
      entity: 'goal',
      entityId: 'g3',
      kind: 'update',
      payload: { progress: 50 },
      online: async () => ({ ok: true, data: { id: 'g3', title: 'should-not-run' } }),
      userId: async () => 'u1',
    });
    expect(off2).toMatchObject({ ok: true, via: 'outbox' });
    expect(ch.state()?.commands).toHaveLength(1);
    expect(ch.state()?.commands[0].payload).toEqual({ title: 'First', progress: 50 });

    // 4. savedOnDevice: false propagates
    const unsavedCh: EngineChannel = {
      ...ch,
      write: async () => ({ ok: true, operationId: 'unsaved-1', savedOnDevice: false }),
    };
    const unsaved = await writeThrough({
      channel: unsavedCh,
      entity: 'goal',
      entityId: 'g4',
      kind: 'create',
      online: async () => ({ ok: false, error: 'offline', offline: true }),
      userId: () => safeUserIdOf(async () => {
        throw new Error('boom');
      }),
    });
    expect(unsaved).toEqual({ ok: true, via: 'outbox', operationId: 'unsaved-1', savedOnDevice: false, userId: null });
  });

  it('(+) ENTITY_POLICIES covers every CORE_TRANSPORTS entity plus task/habit_log/webhook_event, and versioned entities use baseVersion', () => {
    const expected = [...Object.keys(CORE_TRANSPORTS), 'task', 'habit_log', 'webhook_event'];
    for (const entity of expected) {
      expect(ENTITY_POLICIES[entity]).toBeDefined();
    }
    const root = join(__dirname, '..', '..');
    const taskSvc = stripComments(readFileSync(join(root, 'services/taskService.ts'), 'utf8'));
    const coreSvc = stripComments(readFileSync(join(root, 'services/coreOutbox.ts'), 'utf8'));
    expect(ENTITY_POLICIES.task.conflict).toBe('versioned');
    expect(ENTITY_POLICIES.note.conflict).toBe('versioned');
    expect(taskSvc).toContain('cmd.baseVersion');
    expect(coreSvc).toContain('cmd.baseVersion');
  });

  it('(+) habitLogEntityId/parseHabitLogEntityId round-trips, planLegacyMigration is lossless & idempotent, webhookOperationId varies per webhook, and (-) engine never imports services', () => {
    expect(parseHabitLogEntityId(habitLogEntityId('hab-1', '2026-08-04'))).toEqual({
      habitId: 'hab-1',
      date: '2026-08-04',
    });
    expect(parseHabitLogEntityId('bozuk')).toBeNull();
    expect(parseHabitLogEntityId('a|b|2026-08-04')).toBeNull();
    expect(parseHabitLogEntityId('hab|not-a-date')).toBeNull();

    expect(webhookOperationId('habit_completed', 'h1|2026-08-04', 'w1')).not.toBe(
      webhookOperationId('habit_completed', 'h1|2026-08-04', 'w2'),
    );

    // Legacy migration: unstamped adopted, foreign skipped, dead -> MAX_ATTEMPTS, current wins, idempotent
    let legacy = legacyEnqueue(emptyQueueState(), 'h-pending', '2026-08-04', { state: 'done' }, { id: 'op-pend' }).state;
    legacy = legacyEnqueue(legacy, 'h-dead', '2026-08-04', { state: 'miss' }, { id: 'op-dead', userId: 'u1' }).state;
    legacy = {
      ...legacy,
      ops: [
        ...legacy.ops.map((o) => (o.id === 'op-dead' ? { ...o, status: 'dead' as const, attempts: 5 } : { ...o, attempts: 9 })),
        {
          id: 'op-foreign',
          habitId: 'h-foreign',
          date: '2026-08-04',
          intent: { state: 'done' },
          attempts: 0,
          status: 'pending',
          seq: 99,
          createdAt: 1,
          updatedAt: 1,
          userId: 'other-user',
        },
      ],
    };

    const curRes = enqueue(
      emptyOutbox('u1'),
      { operationId: 'cur-1', entity: 'habit_log', entityId: habitLogEntityId('h-current', '2026-08-04'), kind: 'update', payload: { intent: { state: 'partial' } } },
      'u1',
      50,
    );
    const current = curRes.ok ? curRes.state : emptyOutbox('u1');

    const m1 = planLegacyMigration({
      userId: 'u1',
      legacy,
      quarantined: [],
      current,
    });
    expect(m1.skippedForeign).toBe(1);
    expect(m1.adopted).toBe(2);
    expect(m1.next.commands.map((c) => c.operationId)).toEqual(['cur-1', 'op-pend', 'op-dead']);
    expect(m1.next.commands.find((c) => c.operationId === 'op-pend')?.attempts).toBe(MAX_ATTEMPTS - 1);
    expect(m1.next.commands.find((c) => c.operationId === 'op-dead')?.attempts).toBe(MAX_ATTEMPTS);

    // Running planLegacyMigration a second time produces zero duplicates
    const m2 = planLegacyMigration({
      userId: 'u1',
      legacy,
      quarantined: [],
      current: m1.next,
    });
    expect(m2.adopted).toBe(0);
    expect(m2.next.commands).toHaveLength(3);

    const engineSrc = stripComments(readFileSync(join(__dirname, '..', '..', 'lib/outboxEngine.ts'), 'utf8'));
    expect(engineSrc).not.toContain("from '../services");
    expect(engineSrc).not.toContain('from "../services');
  });
});
