import { ENTITY_POLICIES } from '../../lib/outboxEngine';
import { memoryOutboxStorage, namespacedOutboxKey, OUTBOX_VERSION, parseStored, type OutboxStorage } from '../../lib/outboxStorage';
import { createStorageLock, createTabBus, type LockManagerLike } from '../../lib/tabCoordination';
import { createOutboxChannel } from '../../services/outboxChannel';

function makeNamespacedMemoryStorage(ns: string): OutboxStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    async load(userId) {
      return parseStored(raw.get(namespacedOutboxKey(ns, userId)) ?? null, userId).state;
    },
    async save(state) {
      raw.set(namespacedOutboxKey(ns, state.userId), JSON.stringify({ v: OUTBOX_VERSION, state }));
    },
  };
}

function createFakeMultiTabRig() {
  const held = new Set<string>();
  const waiters = new Map<string, (() => void)[]>();
  const requestedLocks: string[] = [];

  const locks: LockManagerLike = {
    async request(name, opts, cb) {
      requestedLocks.push(name);
      if (opts.ifAvailable && held.has(name)) {
        return cb(null);
      }
      if (held.has(name)) {
        await new Promise<void>((resolve) => {
          const list = waiters.get(name) ?? [];
          list.push(resolve);
          waiters.set(name, list);
        });
      }
      held.add(name);
      try {
        return await cb({ name });
      } finally {
        held.delete(name);
        const list = waiters.get(name);
        const next = list?.shift();
        if (list && list.length === 0) waiters.delete(name);
        next?.();
      }
    },
  };

  const peers = new Set<{ onmessage: ((ev: { data: unknown }) => void) | null; closed: boolean }>();
  class FakeBC {
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    closed = false;
    constructor() {
      peers.add(this);
    }
    postMessage(data: unknown) {
      if (this.closed) return;
      for (const p of peers) {
        if (p !== this && !p.closed) p.onmessage?.({ data });
      }
    }
    close() {
      this.closed = true;
      peers.delete(this);
    }
  }

  const makeTabs = () => ({
    lock: createStorageLock({ locks }),
    bus: createTabBus({ BroadcastChannelCtor: FakeBC as unknown as typeof BroadcastChannel, target: null }),
  });

  return { makeTabs, requestedLocks };
}

describe('F46 (5.2-j) — multi-tab outbox coordination vs negative control (SYN-10)', () => {
  it('(-) NEGATIVE CONTROL: without attachTabs, concurrent writes from two channel instances overwrite each other on shared storage', async () => {
    const shared = memoryOutboxStorage();
    const tabA = createOutboxChannel({
      storage: shared,
      transports: { note: async () => ({ kind: 'offline' }) },
      currentUserId: async () => 'u1',
      policies: ENTITY_POLICIES,
    });
    const tabB = createOutboxChannel({
      storage: shared,
      transports: { note: async () => ({ kind: 'offline' }) },
      currentUserId: async () => 'u1',
      policies: ENTITY_POLICIES,
    });

    // Both tabs load empty initial state before either writes
    await tabA.ensure();
    await tabB.ensure();

    await tabA.write({ entity: 'note', entityId: 'note-1', kind: 'create', payload: { title: 'Note 1' } });
    await tabB.write({ entity: 'note', entityId: 'note-2', kind: 'create', payload: { title: 'Note 2' } });

    const onDisk = await shared.load('u1');
    // Without multi-tab lock + merge, Tab B's stale memory snapshot overwrote Note 1!
    expect(onDisk.commands.map((c) => c.entityId)).toEqual(['note-2']);
  });

  it('(+) WITH attachTabs: concurrent writes preserve both commands, concurrent flushes deliver each command ONCE, and settled/discarded commands never resurrect', async () => {
    const shared = makeNamespacedMemoryStorage('core');
    const { makeTabs, requestedLocks } = createFakeMultiTabRig();
    let online = false;
    const delivered: string[] = [];

    const makeChannel = (uidRef: { id: string | null }) =>
      createOutboxChannel({
        storage: shared,
        namespace: 'core',
        policies: ENTITY_POLICIES,
        currentUserId: async () => uidRef.id,
        transports: {
          note: async (cmd) => {
            if (!online) return { kind: 'offline' };
            await new Promise((r) => setTimeout(r, 15));
            delivered.push(cmd.entityId);
            return { kind: 'applied' };
          },
        },
      });

    const uidA = { id: 'u1' as string | null };
    const uidB = { id: 'u1' as string | null };
    const tabA = makeChannel(uidA);
    const tabB = makeChannel(uidB);
    const detachA = tabA.attachTabs(makeTabs());
    const detachB = tabB.attachTabs(makeTabs());

    await tabA.ensure();
    await tabB.ensure();

    await Promise.all([
      tabA.write({ entity: 'note', entityId: 'note-1', kind: 'create', payload: { title: 'Note 1' } }),
      tabB.write({ entity: 'note', entityId: 'note-2', kind: 'create', payload: { title: 'Note 2' } }),
    ]);

    // Wait past RELOAD_DEBOUNCE_MS (60ms) so sibling tab reload completes
    await new Promise((r) => setTimeout(r, 90));

    const diskAfterWrites = await shared.load('u1');
    expect(diskAfterWrites.commands.map((c) => c.entityId).sort()).toEqual(['note-1', 'note-2']);
    expect(tabA.state()?.commands.map((c) => c.entityId).sort()).toEqual(['note-1', 'note-2']);
    expect(tabB.state()?.commands.map((c) => c.entityId).sort()).toEqual(['note-1', 'note-2']);

    // Concurrent flushes from both tabs -> flush lock ensures each command is delivered ONCE!
    online = true;
    await Promise.all([tabA.flush(), tabB.flush()]);
    expect(delivered.sort()).toEqual(['note-1', 'note-2']);

    // Stale memory in Tab B writing a 3rd note does NOT resurrect settled note-1 or note-2
    online = false;
    await tabB.write({ entity: 'note', entityId: 'note-3', kind: 'create', payload: { title: 'Note 3' } });
    const afterThird = await shared.load('u1');
    expect(afterThird.commands.map((c) => c.entityId)).toEqual(['note-3']);

    // Tab A reloads, discards note-3; Tab B writing note-4 does NOT resurrect discarded note-3
    await tabA.reloadFromStorage();
    const note3OpId = tabA.state()!.commands[0].operationId;
    await tabA.discard(note3OpId);
    await tabB.write({ entity: 'note', entityId: 'note-4', kind: 'create', payload: { title: 'Note 4' } });
    expect((await shared.load('u1')).commands.map((c) => c.entityId)).toEqual(['note-4']);

    // Account A vs Account B lock names include <uid>
    uidB.id = 'u2';
    tabB.reset();
    await tabB.write({ entity: 'note', entityId: 'u2-note', kind: 'create', payload: { title: 'U2' } });
    expect(requestedLocks).toContain('aderyth-outbox-write:core:u1');
    expect(requestedLocks).toContain('aderyth-outbox-write:core:u2');

    detachA();
    detachB();
  });
});
