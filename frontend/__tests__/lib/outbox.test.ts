/**
 * R02.03–R02.06 — the generic outbox's rules.
 */
import {
  emptyOutbox, enqueue, ready, settle, retry, discard, summary, overlay, hasPending, clearAuthBlock,
  stableJson, newOperationId, MAX_ATTEMPTS, MAX_TOMBSTONES, nextRetryDelayMs,
  type OutboxState, type EnqueueInput,
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
