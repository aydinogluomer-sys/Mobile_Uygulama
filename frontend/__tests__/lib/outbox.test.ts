/**
 * R02.03–R02.06 — the generic outbox's rules.
 */
import {
  emptyOutbox, enqueue, ready, settle, retry, discard, summary, overlay, hasPending, clearAuthBlock,
  stableJson, newOperationId, MAX_ATTEMPTS, MAX_TOMBSTONES, nextRetryDelayMs,
  nextReadyAt, retryableDelayMs, RETRYABLE_GIVE_UP_MS, markSending,
  CONFIRMED_TOMBSTONE_GRACE_MS, clearTombstones, pruneConfirmedTombstones,
  SETTLED_KEEP, SETTLED_MAX_AGE_MS, pruneSettled, replaceCommand, mergeOutboxStates,
  type OutboxState, type EnqueueInput, type EntityPolicy,
} from '../../lib/outbox';

const U = 'user-a';
const T0 = 1_000_000;
let n = 0;
const op = (over: Partial<EnqueueInput> = {}): EnqueueInput => ({
  operationId: `op-${++n}`, entity: 'task', entityId: 't1', kind: 'update', payload: { title: 'x' }, ...over,
});
function q(state: OutboxState, input: EnqueueInput): OutboxState {
  const r = enqueue(state, input, U, T0);
  if (!r.ok) throw new Error(r.reason);
  return r.state;
}

describe('idempotency — one id, one meaning', () => {
  it('the same operation twice is one command', () => {
    const a = op({ kind: 'create' });
    const s1 = q(emptyOutbox(U), a);
    const r = enqueue(s1, a, U, T0);
    expect(r.ok && r.effect).toBe('duplicate');
    expect(r.ok && r.state.commands).toHaveLength(1);
  });

  it('the same id with a different payload is refused', () => {
    const a = op({ kind: 'create' });
    const s1 = q(emptyOutbox(U), a);
    expect(enqueue(s1, { ...a, payload: { title: 'other' } }, U, T0)).toEqual({ ok: false, reason: 'id_reused' });
  });

  it('payload comparison ignores key order', () => {
    expect(stableJson({ a: 1, b: { c: 2, d: 3 } })).toBe(stableJson({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it('another account cannot enqueue into this outbox', () => {
    expect(enqueue(emptyOutbox(U), op(), 'user-b', T0)).toEqual({ ok: false, reason: 'wrong_account' });
  });
});

describe('collapse', () => {
  it('ten offline edits are one request, last value per field', () => {
    let s = q(emptyOutbox(U), op({ payload: { title: 'a', priority: 'low' } }));
    for (let i = 0; i < 9; i++) s = q(s, op({ payload: { title: `t${i}` } }));
    expect(s.commands).toHaveLength(1);
    expect(s.commands[0].payload).toEqual({ title: 't8', priority: 'low' });
  });

  it('a pending create absorbs later updates', () => {
    let s = q(emptyOutbox(U), op({ kind: 'create', payload: { title: 'new', completed: false } }));
    s = q(s, op({ payload: { completed: true } }));
    expect(s.commands).toHaveLength(1);
    expect(s.commands[0]).toMatchObject({ kind: 'create', payload: { title: 'new', completed: true } });
  });
});

describe('delete and tombstones', () => {
  it('deleting something never sent cancels both: the server never hears of it', () => {
    let s = q(emptyOutbox(U), op({ kind: 'create' }));
    const r = enqueue(s, op({ kind: 'delete' }), U, T0);
    expect(r.ok && r.effect).toBe('cancelled');
    s = (r as any).state;
    expect(s.commands).toHaveLength(0);
  });

  it('a delete drops pending updates of the same entity', () => {
    let s = q(emptyOutbox(U), op({ entityId: 't9' }));
    s = q(s, op({ entityId: 't9', kind: 'delete' }));
    expect(s.commands.map((c) => c.kind)).toEqual(['delete']);
  });

  it('a late edit after the delete is dropped -- deleted things do not come back', () => {
    let s = q(emptyOutbox(U), op({ entityId: 't9', kind: 'delete' }));
    const r = enqueue(s, op({ entityId: 't9', payload: { title: 'zombie' } }), U, T0);
    expect(r.ok && r.effect).toBe('dropped_tombstoned');
    s = (r as any).state;
    expect(s.commands).toHaveLength(1);
  });

  it('tombstones are bounded', () => {
    let s = emptyOutbox(U);
    for (let i = 0; i < MAX_TOMBSTONES + 30; i++) s = q(s, op({ entityId: `d${i}`, kind: 'delete' }));
    expect(Object.keys(s.tombstones)).toHaveLength(MAX_TOMBSTONES);
    expect(s.tombstones[`task|d${MAX_TOMBSTONES + 29}`]).toBeDefined();
  });

  it('F19 (SYN-05): confirmed delete keeps tombstone during grace window, then expires it', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'del-1', entityId: 't-del', kind: 'delete' }));
    expect(s.confirmedDeletes).toBeUndefined();

    // Unconfirmed delete also drops a create of the same id
    expect(enqueue(s, op({ entityId: 't-del', kind: 'create', payload: { title: 'premature' } }), U, T0)).toMatchObject({
      ok: true,
      effect: 'dropped_tombstoned',
    });

    s = settle(s, 'del-1', { kind: 'applied' }, T0);
    expect(s.confirmedDeletes?.['task|t-del']).toBe(T0);

    // Within grace window: late update is still dropped
    const beforeGrace = enqueue(s, op({ entityId: 't-del', kind: 'update', payload: { title: 'echo' } }), U, T0 + CONFIRMED_TOMBSTONE_GRACE_MS - 1);
    expect(beforeGrace.ok && beforeGrace.effect).toBe('dropped_tombstoned');

    // After grace window: tombstone is pruned so the id is no longer haunted
    const pruned = pruneConfirmedTombstones(s, T0 + CONFIRMED_TOMBSTONE_GRACE_MS);
    expect(pruned.tombstones['task|t-del']).toBeUndefined();
    expect(pruned.confirmedDeletes?.['task|t-del']).toBeUndefined();

    // Enqueueing after grace window also prunes expired confirmed tombstones
    const afterGrace = enqueue(s, op({ entityId: 't-del', kind: 'update', payload: { title: 'fresh' } }), U, T0 + CONFIRMED_TOMBSTONE_GRACE_MS);
    expect(afterGrace.ok && afterGrace.effect).toBe('queued');
  });

  it('F19 (SYN-05): gone outcome on delete also records confirmedDeletes; create on confirmed tombstone re-queues immediately', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'del-g', entityId: 't-restore', kind: 'delete' }));
    s = settle(s, 'del-g', { kind: 'gone' }, T0);
    expect(s.confirmedDeletes?.['task|t-restore']).toBe(T0);

    // Restoring/recreating with the same id during grace clears tombstone and queues create
    const restored = enqueue(s, op({ entityId: 't-restore', kind: 'create', payload: { title: 'restored' } }), U, T0 + 1_000);
    expect(restored.ok && restored.effect).toBe('queued');
    if (restored.ok) {
      expect(restored.state.tombstones['task|t-restore']).toBeUndefined();
      expect(restored.state.confirmedDeletes?.['task|t-restore']).toBeUndefined();
      expect(overlay(restored.state, 'task', [])).toEqual([{ id: 't-restore', title: 'restored' }]);
    }
  });

  it('F19 (SYN-05): clearTombstones removes tombstones and unsent deletes, but leaves sending deletes untouched', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'd-wait', entityId: 't-1', kind: 'delete' }));
    s = q(s, op({ operationId: 'd-fly', entityId: 't-2', kind: 'delete' }));
    s = markSending(s, 'd-fly');
    s = q(s, op({ operationId: 'd-done', entityId: 't-3', kind: 'delete' }));
    s = settle(s, 'd-done', { kind: 'applied' }, T0);

    const cleared = clearTombstones(s, 'task', ['t-1', 't-2', 't-3']);
    expect(cleared.tombstones['task|t-1']).toBeUndefined();
    expect(cleared.tombstones['task|t-3']).toBeUndefined();
    expect(cleared.confirmedDeletes?.['task|t-3']).toBeUndefined();
    expect(cleared.commands.map((c) => c.operationId)).toEqual(['d-fly']);
    // No-op returns exact same reference
    expect(clearTombstones(cleared, 'task', ['non-existent'])).toBe(cleared);
  });

  it('F19 (SYN-05 / SYN-17): cancelled unsent create leaves NO tombstone; sending create is NOT cancelled', () => {
    const created = q(emptyOutbox(U), op({ operationId: 'c-1', entityId: 'never-sent', kind: 'create' }));
    const cancelled = enqueue(created, op({ entityId: 'never-sent', kind: 'delete' }), U, T0);
    expect(cancelled.ok && cancelled.effect).toBe('cancelled');
    if (cancelled.ok) {
      expect(cancelled.state.commands).toHaveLength(0);
      expect(cancelled.state.tombstones['task|never-sent']).toBeUndefined();
    }

    // In-flight create cannot be cancelled: delete queues behind it
    const flying = markSending(created, 'c-1');
    const queuedBehind = enqueue(flying, op({ operationId: 'd-behind', entityId: 'never-sent', kind: 'delete' }), U, T0);
    expect(queuedBehind.ok && queuedBehind.effect).toBe('queued');
    if (queuedBehind.ok) {
      expect(queuedBehind.state.commands.map((c) => c.operationId)).toEqual(['c-1', 'd-behind']);
    }
  });

  it('F19 (SYN-17): delete supersedes dead create and cascades its dependants without touching unrelated commands', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'obj-c', entity: 'okr_objective', entityId: 'o1', kind: 'create' }));
    s = q(s, op({ operationId: 'kr-c', entity: 'key_result', entityId: 'kr1', kind: 'create', dependsOn: ['obj-c'] }));
    s = q(s, op({ operationId: 'kr-upd', entity: 'key_result', entityId: 'kr2', kind: 'create', dependsOn: ['kr-c'] }));
    s = q(s, op({ operationId: 'other', entity: 'goal', entityId: 'g1', kind: 'create' }));
    for (let i = 0; i < MAX_ATTEMPTS; i++) s = settle(s, 'obj-c', { kind: 'rejected', error: '422' }, T0);
    expect(s.commands.find((c) => c.operationId === 'obj-c')?.status).toBe('dead');

    const r = enqueue(s, op({ entity: 'okr_objective', entityId: 'o1', kind: 'delete' }), U, T0);
    expect(r.ok && r.effect).toBe('cancelled');
    if (r.ok) {
      expect(r.state.commands.map((c) => c.operationId)).toEqual(['other']);
      expect(r.state.tombstones['okr_objective|o1']).toBeUndefined();
    }
  });

  it('F19 (SYN-17): delete supersedes conflicted or dead updates so the delete is immediately ready()', () => {
    // Conflict predecessor
    let sc = q(emptyOutbox(U), op({ operationId: 'u-conf', entityId: 'n1', kind: 'update', payload: { title: 'local' } }));
    sc = settle(sc, 'u-conf', { kind: 'conflict', error: 'moved' }, T0);
    const afterConfDel = q(sc, op({ operationId: 'd-conf', entityId: 'n1', kind: 'delete' }));
    expect(afterConfDel.commands.map((c) => c.operationId)).toEqual(['d-conf']);
    expect(ready(afterConfDel, T0).map((c) => c.operationId)).toEqual(['d-conf']);

    // Dead update predecessor
    let sd = q(emptyOutbox(U), op({ operationId: 'u-dead', entityId: 'n2', kind: 'update', payload: { title: 'bad' } }));
    for (let i = 0; i < MAX_ATTEMPTS; i++) sd = settle(sd, 'u-dead', { kind: 'rejected', error: 'bad' }, T0);
    expect(sd.commands[0].status).toBe('dead');
    const afterDeadDel = q(sd, op({ operationId: 'd-dead', entityId: 'n2', kind: 'delete' }));
    expect(afterDeadDel.commands.map((c) => c.operationId)).toEqual(['d-dead']);
    expect(ready(afterDeadDel, T0).map((c) => c.operationId)).toEqual(['d-dead']);

    // Legacy persisted blob without confirmedDeletes still works
    const legacy: OutboxState = { userId: U, commands: [], nextSeq: 5, tombstones: { 'task|old': 2 }, authBlocked: false };
    expect(pruneConfirmedTombstones(legacy, T0)).toBe(legacy);
    expect(enqueue(legacy, op({ entityId: 'old', kind: 'update' }), U, T0)).toMatchObject({ ok: true, effect: 'dropped_tombstoned' });
  });
});

describe('order', () => {
  it('by sequence, one entity at a time, after declared dependencies', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'p', entity: 'project', entityId: 'p1', kind: 'create' }));
    s = q(s, op({ operationId: 'a', entityId: 't1', kind: 'create', dependsOn: ['p'] }));
    s = q(s, op({ operationId: 'b', entityId: 't2', kind: 'create' }));
    expect(ready(s, T0).map((c) => c.operationId)).toEqual(['p', 'b']);
    s = settle(s, 'p', { kind: 'applied' }, T0);
    expect(ready(s, T0).map((c) => c.operationId)).toEqual(['a', 'b']);
  });

  it('a dead predecessor holds its dependants back', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'p', entityId: 'p1', kind: 'create' }));
    s = q(s, op({ operationId: 'a', entityId: 't1', kind: 'create', dependsOn: ['p'] }));
    for (let i = 0; i < MAX_ATTEMPTS; i++) s = settle(s, 'p', { kind: 'rejected', error: 'no' }, T0);
    expect(s.commands.find((c) => c.operationId === 'p')?.status).toBe('dead');
    expect(ready(s, T0 + 10 ** 9)).toEqual([]);
  });
});

describe('settle', () => {
  it('applied removes the command and passes the new version to later edits of the same entity', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'c', entityId: 't5', kind: 'create' }));
    // a later update of t5 queued behind the create (sent separately, e.g. after a dependency)
    s = { ...s, commands: [...s.commands, { ...s.commands[0], operationId: 'u', kind: 'update', seq: 99, baseVersion: 'old' }] };
    s = settle(s, 'c', { kind: 'applied', version: 'v9' }, T0);
    expect(s.commands.map((c) => c.operationId)).toEqual(['u']);
    expect(s.commands[0].baseVersion).toBe('v9');
  });

  it('offline costs nothing', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'o' }));
    s = settle(s, 'o', { kind: 'offline' }, T0);
    expect(s.commands[0]).toMatchObject({ attempts: 0, status: 'pending' });
  });

  it('auth pauses the whole outbox until credentials are refreshed, using no attempts', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'o' }));
    s = settle(s, 'o', { kind: 'auth' }, T0);
    expect(s.authBlocked).toBe(true);
    expect(ready(s, T0)).toEqual([]);
    expect(s.commands[0].attempts).toBe(0);
    expect(ready(clearAuthBlock(s), T0)).toHaveLength(1);
  });

  it('rejected backs off exponentially and ends dead', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'r' }));
    s = settle(s, 'r', { kind: 'rejected', error: 'bad' }, T0);
    expect(s.commands[0].readyAt).toBe(T0 + nextRetryDelayMs(1));
    expect(ready(s, T0)).toEqual([]);
    expect(ready(s, T0 + nextRetryDelayMs(1))).toHaveLength(1);
    for (let i = 1; i < MAX_ATTEMPTS; i++) s = settle(s, 'r', { kind: 'rejected', error: 'bad' }, T0);
    expect(s.commands[0]).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS, lastError: 'bad' });
    expect(nextRetryDelayMs(2)).toBe(2 * nextRetryDelayMs(1));
  });

  it('conflict stops the command for the user; never applied silently', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'c' }));
    s = settle(s, 'c', { kind: 'conflict', error: 'moved' }, T0);
    expect(s.commands[0].status).toBe('conflict');
    expect(ready(s, T0)).toEqual([]);
    expect(summary(s)).toEqual({ pending: 0, dead: 0, conflict: 1, authBlocked: false });
  });

  it('gone finishes the command', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'g' }));
    s = settle(s, 'g', { kind: 'gone' }, T0);
    expect(s.commands).toHaveLength(0);
  });

  it('retry resets a dead/conflicted command, optionally over a new base; discard drops it', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'c', baseVersion: 'v1' }));
    s = settle(s, 'c', { kind: 'conflict', error: 'moved' }, T0);
    s = retry(s, 'c', 'v2');
    expect(s.commands[0]).toMatchObject({ status: 'pending', attempts: 0, baseVersion: 'v2' });
    expect(discard(s, 'c').commands).toHaveLength(0);
  });
});

describe('overlay — unsent changes survive a refetch', () => {
  const rows = [{ id: 't1', title: 'server', done: false }, { id: 't2', title: 'other', done: false }];
  it('adds pending creates, applies pending updates, hides pending deletes', () => {
    let s = q(emptyOutbox(U), op({ entityId: 'new', kind: 'create', payload: { title: 'local' } }));
    s = q(s, op({ entityId: 't1', payload: { done: true } }));
    s = q(s, op({ entityId: 't2', kind: 'delete' }));
    const out = overlay(s, 'task', rows);
    expect(out.map((r) => r.id)).toEqual(['new', 't1']);
    expect(out[1]).toMatchObject({ title: 'server', done: true });
    expect(hasPending(s, 'task', 't1')).toBe(true);
  });

  it('other entities are untouched', () => {
    const s = q(emptyOutbox(U), op({ entity: 'note', entityId: 't1', kind: 'delete' }));
    expect(overlay(s, 'task', rows)).toHaveLength(2);
  });
});

describe('ids', () => {
  it('operation ids are v4-shaped and distinct', () => {
    const a = newOperationId(), b = newOperationId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});

describe('F05 -- retryable and nextReadyAt', () => {
  it('retryable spends no attempt and defers by the retryable backoff', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'r' }));
    s = settle(s, 'r', { kind: 'retryable', error: 'HTTP 503' }, T0);
    expect(s.commands[0]).toMatchObject({ attempts: 0, status: 'pending', retryableCount: 1, firstRetryableAt: T0, readyAt: T0 + retryableDelayMs(1) });
    expect(ready(s, T0)).toEqual([]);
    expect(ready(s, T0 + retryableDelayMs(1))).toHaveLength(1);
  });

  it('retryable becomes dead only after RETRYABLE_GIVE_UP_MS', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'r' }));
    s = settle(s, 'r', { kind: 'retryable' }, T0);
    s = settle(s, 'r', { kind: 'retryable' }, T0 + RETRYABLE_GIVE_UP_MS);
    expect(s.commands[0].status).toBe('dead');
    expect(summary(s)).toMatchObject({ dead: 1, pending: 0 });
  });

  it('nextReadyAt: null when nothing is deferred, when paused, or while sending', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'a' }));
    s = q(s, op({ operationId: 'b', entityId: 't2' }));
    expect(nextReadyAt(s)).toBeNull();
    s = settle(s, 'a', { kind: 'retryable' }, T0);
    s = settle(s, 'b', { kind: 'rejected', error: 'x' }, T0);
    expect(nextReadyAt(s)).toBe(Math.min(T0 + retryableDelayMs(1), T0 + nextRetryDelayMs(1)));
    expect(nextReadyAt({ ...s, authBlocked: true })).toBeNull();
    expect(nextReadyAt(markSending(markSending(s, 'a'), 'b'))).toBeNull();
  });
});

describe('F46 (5.2-a) — EntityPolicy, settled ledger, replaceCommand, mergeOutboxStates', () => {
  const REPLACE_POLICY: EntityPolicy = { coalesce: 'replace', conflict: 'none' };
  const EFFECT_POLICY: EntityPolicy = {
    coalesce: 'replace',
    conflict: 'none',
    maxPending: 3,
    dedupeTtlMs: SETTLED_MAX_AGE_MS,
  };

  it('(+) coalesce: replace replaces payload wholesale, revives dead target, resets counters, and increments rev', () => {
    let s = q(
      emptyOutbox(U),
      op({ operationId: 'h-1', entity: 'habit_log', entityId: 'h1|2026-08-04', payload: { intent: { state: 'partial', value: 2 }, staleField: 'drop-me' }, policy: REPLACE_POLICY }),
    );
    expect(s.commands[0].rev).toBe(1);
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      s = settle(s, 'h-1', { kind: 'rejected', error: 'RLS' }, T0);
    }
    expect(s.commands[0]).toMatchObject({ status: 'dead', attempts: MAX_ATTEMPTS });

    const r = enqueue(
      s,
      op({ operationId: 'h-2', entity: 'habit_log', entityId: 'h1|2026-08-04', payload: { intent: { state: 'done' } }, policy: REPLACE_POLICY }),
      U,
      T0 + 50,
    );
    expect(r.ok && r.effect).toBe('merged');
    if (r.ok) {
      expect(r.state.commands).toHaveLength(1);
      expect(r.state.commands[0].payload).toEqual({ intent: { state: 'done' } }); // wholesale, staleField gone
      expect(r.state.commands[0]).toMatchObject({
        operationId: 'h-1',
        status: 'pending',
        attempts: 0,
        readyAt: 0,
      });
      expect(r.state.commands[0].lastError).toBeUndefined();
      expect(r.state.commands[0].rev).toBeGreaterThan(2);
    }
  });

  it('(-) conflict and sending commands are NEVER coalesced by coalesce: replace', () => {
    let sConf = q(emptyOutbox(U), op({ operationId: 'c1', entity: 'note', entityId: 'n1', payload: { text: 'a' }, policy: REPLACE_POLICY }));
    sConf = settle(sConf, 'c1', { kind: 'conflict', error: 'moved' }, T0);
    const afterConf = q(sConf, op({ operationId: 'c2', entity: 'note', entityId: 'n1', payload: { text: 'b' }, policy: REPLACE_POLICY }));
    expect(afterConf.commands.map((c) => c.operationId)).toEqual(['c1', 'c2']);

    let sFly = q(emptyOutbox(U), op({ operationId: 'f1', entity: 'habit_log', entityId: 'h1|2026-08-04', payload: { v: 1 }, policy: REPLACE_POLICY }));
    sFly = markSending(sFly, 'f1');
    const afterFly = q(sFly, op({ operationId: 'f2', entity: 'habit_log', entityId: 'h1|2026-08-04', payload: { v: 2 }, policy: REPLACE_POLICY }));
    expect(afterFly.commands.map((c) => c.operationId)).toEqual(['f1', 'f2']);
    expect(afterFly.commands[0].payload).toEqual({ v: 1 });
  });

  it('(+) settle(applied/gone), discard, and cancelled delete record operationId in settled; dedupeTtlMs blocks duplicates until TTL expires', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'wh-1', entity: 'webhook_event', entityId: 'wh-1', payload: { a: 1 }, policy: EFFECT_POLICY }));
    s = settle(s, 'wh-1', { kind: 'applied' }, T0);
    expect(s.settled?.['wh-1']).toBe(T0);

    // Within TTL -> duplicate, not re-queued
    const dup = enqueue(
      s,
      op({ operationId: 'wh-1', entity: 'webhook_event', entityId: 'wh-1', payload: { a: 1 }, policy: EFFECT_POLICY }),
      U,
      T0 + SETTLED_MAX_AGE_MS - 1,
    );
    expect(dup.ok && dup.effect).toBe('duplicate');
    if (dup.ok) expect(dup.state.commands).toHaveLength(0);

    // After TTL -> pruned and allowed to queue again
    const afterTtl = enqueue(
      s,
      op({ operationId: 'wh-1', entity: 'webhook_event', entityId: 'wh-1', payload: { a: 1 }, policy: EFFECT_POLICY }),
      U,
      T0 + SETTLED_MAX_AGE_MS + 1,
    );
    expect(afterTtl.ok && afterTtl.effect).toBe('queued');
  });

  it('(+) maxPending drops the oldest pending non-sending command when exceeded', () => {
    let s = emptyOutbox(U);
    for (let i = 1; i <= 4; i += 1) {
      const r = enqueue(
        s,
        op({ operationId: `e-${i}`, entity: 'webhook_event', entityId: `e-${i}`, payload: { i }, policy: EFFECT_POLICY }),
        U,
        T0 + i,
      );
      if (!r.ok) throw new Error('enqueue failed');
      s = r.state;
    }
    expect(s.commands.map((c) => c.operationId)).toEqual(['e-2', 'e-3', 'e-4']);
  });

  it('(+) pruneSettled enforces SETTLED_KEEP = 300 newest and drops entries older than 14 days', () => {
    const big: Record<string, number> = { expired: T0 - SETTLED_MAX_AGE_MS };
    for (let i = 1; i <= SETTLED_KEEP + 20; i += 1) {
      big[`id-${i}`] = T0 - 1_000 + i;
    }
    const pruned = pruneSettled({ ...emptyOutbox(U), settled: big }, T0);
    const keys = Object.keys(pruned.settled ?? {});
    expect(keys).toHaveLength(SETTLED_KEEP);
    expect(pruned.settled?.expired).toBeUndefined();
    expect(pruned.settled?.['id-1']).toBeUndefined();
    expect(pruned.settled?.[`id-${SETTLED_KEEP + 20}`]).toBeDefined();
  });

  it('(+) replaceCommand atomically swaps old command, marks old id settled, and (-) returns not_found when missing', () => {
    let s = q(emptyOutbox(U), op({ operationId: 'conf-1', entity: 'journal_entry', entityId: '2026-08-04', payload: { content: 'mine' } }));
    s = settle(s, 'conf-1', { kind: 'conflict', error: 'cas' }, T0);

    const missing = replaceCommand(s, 'nope', op({ operationId: 'res-1', entity: 'journal_entry', entityId: '2026-08-04' }), U, T0 + 10);
    expect(missing).toEqual({ ok: false, reason: 'not_found' });

    const ok = replaceCommand(
      s,
      'conf-1',
      op({ operationId: 'res-1', entity: 'journal_entry', entityId: '2026-08-04', payload: { content: 'both' } }),
      U,
      T0 + 10,
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.state.commands.map((c) => c.operationId)).toEqual(['res-1']);
      expect(ok.state.settled?.['conf-1']).toBe(T0 + 10);
    }
  });

  it('(+) mergeOutboxStates reconciles multi-tab commands, higher rev wins, settled/tombstones prevent resurrection, seq renumbers, and (-) cross-user refuses to merge', () => {
    const base = emptyOutbox(U);
    const tabA = q(base, op({ operationId: 'op-a', entity: 'note', entityId: 'n-a', kind: 'create', payload: { title: 'A' } }));
    const tabB0 = q(base, op({ operationId: 'op-b', entity: 'note', entityId: 'n-b', kind: 'create', payload: { title: 'B' } }));
    // Both tabs started from nextSeq=1 so both commands have seq=1!
    expect(tabA.commands[0].seq).toBe(1);
    expect(tabB0.commands[0].seq).toBe(1);

    const merged = mergeOutboxStates(tabA, tabB0, T0);
    expect(merged.commands.map((c) => c.operationId)).toEqual(['op-a', 'op-b']);
    expect(merged.commands[0].seq).toBe(1);
    expect(merged.commands[1].seq).toBe(2);
    expect(merged.nextSeq).toBe(3);

    // Higher rev wins on the same operationId
    const tabBUpdated = settle(merged, 'op-a', { kind: 'rejected', error: '422' }, T0 + 5);
    const reconciled = mergeOutboxStates(merged, tabBUpdated, T0 + 5);
    expect(reconciled.commands.find((c) => c.operationId === 'op-a')?.attempts).toBe(1);

    // Settled command in disk is NOT resurrected by stale local memory
    const tabBApplied = settle(reconciled, 'op-a', { kind: 'applied' }, T0 + 10);
    const noResurrect = mergeOutboxStates(reconciled, tabBApplied, T0 + 10);
    expect(noResurrect.commands.map((c) => c.operationId)).toEqual(['op-b']);

    // Tombstone in disk drops non-delete command for that entity in local
    const tabBDiscard = discard(noResurrect, 'op-b', T0 + 20);
    expect(mergeOutboxStates(noResurrect, tabBDiscard, T0 + 20).commands).toEqual([]);

    const withTomb = q(emptyOutbox(U), op({ operationId: 'del-x', entity: 'note', entityId: 'n-x', kind: 'delete' }));
    const staleEdit = q(emptyOutbox(U), op({ operationId: 'upd-x', entity: 'note', entityId: 'n-x', kind: 'update', payload: { title: 'late' } }));
    expect(mergeOutboxStates(staleEdit, withTomb, T0).commands.map((c) => c.operationId)).toEqual(['del-x']);

    // Different userId never merges
    const bRes = enqueue(emptyOutbox('user-b'), op({ operationId: 'b-only' }), 'user-b', T0);
    if (!bRes.ok) throw new Error(bRes.reason);
    expect(mergeOutboxStates(tabA, bRes.state, T0)).toBe(tabA);

    // Legacy persisted blob without rev or settled loads & merges cleanly
    const legacyCmd = { ...tabA.commands[0] };
    delete legacyCmd.rev;
    const legacyState: OutboxState = { userId: U, commands: [legacyCmd], nextSeq: 2, tombstones: {}, authBlocked: false };
    expect(mergeOutboxStates(legacyState, emptyOutbox(U), T0).commands).toHaveLength(1);
  });
});
