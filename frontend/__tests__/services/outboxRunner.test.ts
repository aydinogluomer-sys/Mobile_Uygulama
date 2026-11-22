/**
 * R02.04 — delivering the outbox, and keeping it per account (R02.06).
 */
import { emptyOutbox, enqueue, type OutboxState, type DeliveryOutcome } from '../../lib/outbox';
import { flushOutbox, classifyFailure, type OutboxIO } from '../../services/outboxRunner';
import { memoryOutboxStorage, parseStored, outboxKey } from '../../lib/outboxStorage';

const A = 'user-a';
const now = () => 1_000;
function withOps(user: string, ids: string[]): OutboxState {
  let s = emptyOutbox(user);
  for (const id of ids) {
    const r = enqueue(s, { operationId: id, entity: 'task', entityId: id, kind: 'create', payload: { title: id } }, user, 0);
    if (!r.ok) throw new Error();
    s = r.state;
  }
  return s;
}
/** A live holder, like the store. `saves` records the command count at each write. */
function holder(initial: OutboxState): OutboxIO & { state: OutboxState; saves: number[] } {
  const h = {
    state: initial,
    saves: [] as number[],
    get: () => h.state,
    set: (next: OutboxState) => { h.state = next; h.saves.push(next.commands.length); },
  };
  return h;
}

describe('flushOutbox', () => {
  it('sends in order and empties on success, writing the state at every step', async () => {
    const sent: string[] = [];
    const h = holder(withOps(A, ['a', 'b', 'c']));
    const r = await flushOutbox(h, { task: async (c) => { sent.push(c.operationId); return { kind: 'applied' }; } }, { currentUserId: async () => A, now });
    expect(sent).toEqual(['a', 'b', 'c']);
    // mark-sending + settle per command
    expect(h.saves).toEqual([3, 2, 2, 1, 1, 0]);
    expect(r).toEqual({ sent: 3, stoppedBy: 'done' });
  });

  it('an edit made while a request is out is kept, not merged into it or lost', async () => {
    const h = holder(withOps(A, ['a']));
    await flushOutbox(h, {
      task: async (c) => {
        // the user edits the same task while its create is in flight
        const r = enqueue(h.get(), { operationId: 'edit', entity: 'task', entityId: c.entityId, kind: 'update', payload: { title: 'edited' } }, A, 0);
        if (r.ok) h.set(r.state);
        return { kind: 'offline' };
      },
    }, { currentUserId: async () => A, now });
    expect(h.state.commands.map((c) => c.operationId)).toEqual(['a', 'edit']);
    expect(h.state.commands[0].payload).toEqual({ title: 'a' });
    expect(h.state.commands[0].sending).toBe(false);
  });

  it('stops at the first offline; nothing after it is tried', async () => {
    const sent: string[] = [];
    const h = holder(withOps(A, ['a', 'b']));
    const r = await flushOutbox(h, { task: async (c) => { sent.push(c.operationId); return { kind: 'offline' }; } }, { currentUserId: async () => A, now });
    expect(sent).toEqual(['a']);
    expect(r.stoppedBy).toBe('offline');
    expect(h.state.commands).toHaveLength(2);
  });

  it('stops on auth and stays paused', async () => {
    const h = holder(withOps(A, ['a', 'b']));
    const r = await flushOutbox(h, { task: async () => ({ kind: 'auth' }) as DeliveryOutcome }, { currentUserId: async () => A, now });
    expect(r.stoppedBy).toBe('auth');
    expect(h.state.authBlocked).toBe(true);
  });

  it('never sends A\'s work while B is signed in, or while signed out', async () => {
    const t = jest.fn(async () => ({ kind: 'applied' }) as DeliveryOutcome);
    expect((await flushOutbox(holder(withOps(A, ['a'])), { task: t }, { currentUserId: async () => 'user-b', now })).stoppedBy).toBe('account');
    expect((await flushOutbox(holder(withOps(A, ['a'])), { task: t }, { currentUserId: async () => null, now })).stoppedBy).toBe('account');
    expect(t).not.toHaveBeenCalled();
  });

  it('an account switch in the middle of a flush stops it before the next command', async () => {
    let who: string | null = A;
    const sent: string[] = [];
    const h = holder(withOps(A, ['a', 'b']));
    await flushOutbox(h, {
      task: async (c) => { sent.push(c.operationId); who = 'user-b'; return { kind: 'applied' }; },
    }, { currentUserId: async () => who, now });
    expect(sent).toEqual(['a']);
    expect(h.state.commands.map((c) => c.operationId)).toEqual(['b']);
  });

  it('a throwing transport uses an attempt instead of retrying forever', async () => {
    const h = holder(withOps(A, ['a']));
    await flushOutbox(h, { task: async () => { throw new Error('boom'); } }, { currentUserId: async () => A, now });
    expect(h.state.commands[0]).toMatchObject({ attempts: 1, lastError: 'boom' });
  });

  it('an unknown entity is skipped (skippedUnknown), not rejected, spending zero attempts', async () => {
    const h = holder(withOps(A, ['a']));
    const r = await flushOutbox(h, {}, { currentUserId: async () => A, now });
    expect(r).toEqual({ sent: 0, stoppedBy: 'done', skippedUnknown: 1 });
    expect(h.state.commands[0]).toMatchObject({ attempts: 0, status: 'pending' });
  });

  it('respects the per-flush limit', async () => {
    const r = await flushOutbox(holder(withOps(A, ['a', 'b', 'c'])), { task: async () => ({ kind: 'applied' }) }, { currentUserId: async () => A, now, limit: 2 });
    expect(r).toEqual({ sent: 2, stoppedBy: 'limit' });
  });
});

describe('classifyFailure', () => {
  it('transport failure is offline, 401/JWT is auth, the rest is rejected', () => {
    expect(classifyFailure({ error: 'Network request failed', offline: true })).toEqual({ kind: 'offline' });
    expect(classifyFailure({ error: 'x', status: 401 })).toEqual({ kind: 'auth' });
    expect(classifyFailure({ error: 'JWT expired' })).toEqual({ kind: 'auth' });
    expect(classifyFailure({ error: 'x', code: 'PGRST301' })).toEqual({ kind: 'auth' });
    expect(classifyFailure({ error: 'violates check' })).toEqual({ kind: 'rejected', error: 'violates check' });
  });
});

describe('outbox storage — per account', () => {
  it('each account has its own key; B never loads A\'s commands', async () => {
    const st = memoryOutboxStorage();
    await st.save(withOps(A, ['a']));
    expect((await st.load('user-b')).commands).toHaveLength(0);
    expect((await st.load(A)).commands).toHaveLength(1);
    expect([...st.raw.keys()]).toEqual([outboxKey(A)]);
  });

  it('a command saved mid-delivery is sendable again after a restart', async () => {
    const st = memoryOutboxStorage();
    const s = withOps(A, ['a']);
    await st.save({ ...s, commands: [{ ...s.commands[0], sending: true }] });
    expect((await st.load(A)).commands[0].sending).toBe(false);
  });

  it('a blob for another account, version or shape is not used -- and is reported', () => {
    const blob = (state: unknown, v = 1) => JSON.stringify({ v, state });
    expect(parseStored(blob(withOps(A, ['a'])), 'user-b').problem).toBe('account');
    expect(parseStored(blob(withOps(A, ['a']), 2), A).problem).toBe('version');
    expect(parseStored('{nope', A).problem).toBe('unreadable');
    expect(parseStored(blob({ userId: A, commands: 'x' }), A).problem).toBe('shape');
    expect(parseStored(null, A)).toEqual({ state: emptyOutbox(A), problem: null });
  });
});
