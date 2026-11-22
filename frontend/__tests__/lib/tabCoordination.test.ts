import {
  createStorageLock,
  createTabBus,
  createWebTabDeps,
  LOCK_BUSY,
  type LockManagerLike,
  type TabMessage,
} from '../../lib/tabCoordination';

function makeFakeLockManager(): LockManagerLike {
  const held = new Set<string>();
  const queues = new Map<string, (() => void)[]>();

  return {
    async request(name, opts, cb) {
      if (opts.ifAvailable && held.has(name)) {
        return cb(null);
      }
      if (held.has(name)) {
        await new Promise<void>((resolve) => {
          const list = queues.get(name) ?? [];
          list.push(resolve);
          queues.set(name, list);
        });
      }
      held.add(name);
      try {
        return await cb({ name });
      } finally {
        held.delete(name);
        const list = queues.get(name);
        const next = list?.shift();
        if (list && list.length === 0) queues.delete(name);
        next?.();
      }
    },
  };
}

function makeFakeBroadcastChannelHub() {
  const peers = new Map<string, Set<FakeBC>>();
  class FakeBC {
    name: string;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    closed = false;
    constructor(name: string) {
      this.name = name;
      let set = peers.get(name);
      if (!set) {
        set = new Set();
        peers.set(name, set);
      }
      set.add(this);
    }
    postMessage(data: unknown) {
      if (this.closed) return;
      for (const peer of peers.get(this.name) ?? []) {
        if (peer !== this && !peer.closed) {
          peer.onmessage?.({ data });
        }
      }
    }
    close() {
      this.closed = true;
      peers.get(this.name)?.delete(this);
    }
  }
  return FakeBC as unknown as typeof BroadcastChannel;
}

describe('F46 (5.2-d) — web multi-tab lock & broadcast coordination (lib/tabCoordination.ts)', () => {
  it('(+) serialises same-named jobs via LockManagerLike, returns LOCK_BUSY on ifAvailable contention, and lets distinct names run concurrently', async () => {
    const lock = createStorageLock({ locks: makeFakeLockManager() });
    const events: string[] = [];
    let releaseFirst!: () => void;
    const gate = new Promise<void>((r) => {
      releaseFirst = r;
    });

    const p1 = lock('k1', async () => {
      events.push('1-start');
      await gate;
      events.push('1-end');
      return 'one';
    });

    await Promise.resolve();
    // Contended ifAvailable returns LOCK_BUSY immediately
    await expect(lock('k1', async () => 'skipped', { ifAvailable: true })).resolves.toBe(LOCK_BUSY);

    // Distinct lock name does NOT wait on k1
    await expect(lock('k2', async () => 'other')).resolves.toBe('other');

    const p2 = lock('k1', async () => {
      events.push('2-run');
      return 'two';
    });

    releaseFirst();
    await expect(p1).resolves.toBe('one');
    await expect(p2).resolves.toBe('two');
    expect(events).toEqual(['1-start', '1-end', '2-run']);
  });

  it('(+) falls back to in-process FIFO lock when navigator.locks is absent', async () => {
    const lock = createStorageLock({ locks: null });
    const order: number[] = [];
    let unblock!: () => void;
    const wait = new Promise<void>((r) => {
      unblock = r;
    });

    const first = lock('fifo', async () => {
      order.push(1);
      await wait;
      order.push(2);
      return 'a';
    });
    await Promise.resolve();
    await expect(lock('fifo', async () => 'busy', { ifAvailable: true })).resolves.toBe(LOCK_BUSY);

    const second = lock('fifo', async () => {
      order.push(3);
      return 'b';
    });
    unblock();
    await Promise.all([first, second]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('(+) createTabBus delivers to sibling instances, filters own messages, and (-) stops after close()', () => {
    const Ctor = makeFakeBroadcastChannelHub();
    const busA = createTabBus({ BroadcastChannelCtor: Ctor, target: null })!;
    const busB = createTabBus({ BroadcastChannelCtor: Ctor, target: null })!;
    expect(busA.id).not.toBe(busB.id);

    const seenA: TabMessage[] = [];
    const seenB: TabMessage[] = [];
    busA.subscribe((m) => seenA.push(m));
    busB.subscribe((m) => seenB.push(m));

    busA.post({ type: 'outbox-changed', storageKey: 'outbox.v1.u1' });
    expect(seenA).toEqual([]);
    expect(seenB).toEqual([{ type: 'outbox-changed', storageKey: 'outbox.v1.u1', from: busA.id }]);

    busB.close();
    busA.post({ type: 'outbox-changed', storageKey: 'outbox.v1.u1' });
    expect(seenB).toHaveLength(1);
    busA.close();
  });

  it('(+) storage event fallback filters non-outbox keys and relays outbox.v1.* changes', () => {
    const listeners = new Set<(ev: { key?: string | null }) => void>();
    const fakeWin = {
      addEventListener: (_type: string, fn: unknown) => {
        listeners.add(fn as (ev: { key?: string | null }) => void);
      },
      removeEventListener: (_type: string, fn: unknown) => {
        listeners.delete(fn as (ev: { key?: string | null }) => void);
      },
    } as unknown as Pick<Window, 'addEventListener' | 'removeEventListener'>;

    const bus = createTabBus({ BroadcastChannelCtor: null, target: fakeWin })!;
    const received: string[] = [];
    bus.subscribe((m) => received.push(m.storageKey));

    for (const fn of listeners) {
      fn({ key: 'unrelated_theme_key' });
      fn({ key: 'outbox.v1.core.u1' });
    }
    expect(received).toEqual(['outbox.v1.core.u1']);

    bus.close();
    expect(listeners.size).toBe(0);
  });

  it('(-) createWebTabDeps returns null on native / SSR when window or navigator is absent', () => {
    const g = globalThis as Record<string, unknown>;
    const prevWin = g.window;
    const prevDoc = g.document;
    try {
      delete g.window;
      delete g.document;
      expect(createWebTabDeps()).toBeNull();
    } finally {
      if (prevWin !== undefined) g.window = prevWin;
      if (prevDoc !== undefined) g.document = prevDoc;
    }
  });
});
