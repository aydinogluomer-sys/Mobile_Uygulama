/**
 * F46 (SYN-10) — Multi-tab storage lock and change broadcast on the web.
 *
 * Pure browser/injected primitives: imports nothing from `react-native` and degrades cleanly to
 * `null` on native or SSR where `window`/`navigator` DOM APIs are absent.
 */

export const LOCK_BUSY: unique symbol = Symbol('LOCK_BUSY');

export type StorageLock = <T>(
  name: string,
  fn: () => Promise<T>,
  opts?: { ifAvailable?: boolean },
) => Promise<T | typeof LOCK_BUSY>;

export type LockManagerLike = {
  request: (
    name: string,
    opts: { ifAvailable?: boolean },
    cb: (lock: unknown | null) => Promise<unknown>,
  ) => Promise<unknown>;
};

export function createStorageLock(deps?: { locks?: LockManagerLike | null }): StorageLock {
  const locks = deps?.locks ?? null;
  if (locks && typeof locks.request === 'function') {
    return async <T>(
      name: string,
      fn: () => Promise<T>,
      opts?: { ifAvailable?: boolean },
    ): Promise<T | typeof LOCK_BUSY> => {
      let ran = false;
      let value!: T;
      const raw = await locks.request(name, { ifAvailable: Boolean(opts?.ifAvailable) }, async (lock) => {
        if (opts?.ifAvailable && !lock) return LOCK_BUSY;
        ran = true;
        value = await fn();
        return value;
      });
      if (raw === LOCK_BUSY || (!ran && opts?.ifAvailable)) return LOCK_BUSY;
      return value;
    };
  }

  const counts = new Map<string, number>();
  const tails = new Map<string, Promise<void>>();

  return async <T>(
    name: string,
    fn: () => Promise<T>,
    opts?: { ifAvailable?: boolean },
  ): Promise<T | typeof LOCK_BUSY> => {
    const active = counts.get(name) ?? 0;
    if (opts?.ifAvailable && active > 0) return LOCK_BUSY;
    counts.set(name, active + 1);
    const prev = tails.get(name) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    const done = run.then(
      () => undefined,
      () => undefined,
    );
    tails.set(name, done);
    try {
      return await run;
    } finally {
      const left = (counts.get(name) ?? 1) - 1;
      if (left <= 0) {
        counts.delete(name);
        if (tails.get(name) === done) tails.delete(name);
      } else {
        counts.set(name, left);
      }
    }
  };
}

export type TabMessage = { type: 'outbox-changed'; storageKey: string; from: string };

export type TabBus = {
  readonly id: string;
  post(msg: Omit<TabMessage, 'from'>): void;
  subscribe(fn: (m: TabMessage) => void): () => void;
  close(): void;
};

const TAB_BUS_CHANNEL = 'aderyth-outbox-v1';
const TAB_STORAGE_SIGNAL = '__aderyth_tab_bus__:';

function isTabMessage(x: unknown): x is TabMessage {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  return o.type === 'outbox-changed' && typeof o.storageKey === 'string' && typeof o.from === 'string';
}

function makeBusId(): string {
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createTabBus(deps?: {
  BroadcastChannelCtor?: typeof BroadcastChannel | null;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null;
  storage?: Pick<Storage, 'setItem' | 'removeItem'> | null;
}): TabBus | null {
  const id = makeBusId();
  const subs = new Set<(m: TabMessage) => void>();
  let closed = false;

  const dispatch = (candidate: unknown) => {
    if (closed || !isTabMessage(candidate) || candidate.from === id) return;
    for (const fn of subs) {
      try {
        fn({ type: 'outbox-changed', storageKey: candidate.storageKey, from: candidate.from });
      } catch {
        /* never let one subscriber break others */
      }
    }
  };

  const Ctor = deps?.BroadcastChannelCtor ?? null;
  if (typeof Ctor === 'function') {
    const bc = new Ctor(TAB_BUS_CHANNEL);
    bc.onmessage = (ev: MessageEvent) => {
      dispatch(ev?.data);
    };
    return {
      id,
      post(msg) {
        if (closed) return;
        const full: TabMessage = { ...msg, from: id };
        try {
          bc.postMessage(full);
        } catch {
          /* ignore closed/cloned errors */
        }
      },
      subscribe(fn) {
        if (!closed) subs.add(fn);
        return () => {
          subs.delete(fn);
        };
      },
      close() {
        if (closed) return;
        closed = true;
        subs.clear();
        bc.onmessage = null;
        try {
          bc.close();
        } catch {
          /* ignore */
        }
      },
    };
  }

  const target = deps?.target ?? null;
  if (target && typeof target.addEventListener === 'function' && typeof target.removeEventListener === 'function') {
    const onStorage = (ev: Event) => {
      const se = ev as { key?: string | null; newValue?: string | null };
      if (!se || typeof se.key !== 'string') return;
      if (se.key.startsWith(TAB_STORAGE_SIGNAL)) {
        if (typeof se.newValue !== 'string' || !se.newValue) return;
        try {
          dispatch(JSON.parse(se.newValue));
        } catch {
          /* ignore malformed storage payloads */
        }
        return;
      }
      if (se.key.startsWith('outbox.v1.')) {
        dispatch({ type: 'outbox-changed', storageKey: se.key, from: 'storage-event' });
      }
    };
    target.addEventListener('storage', onStorage);
    let defaultStorage: Pick<Storage, 'setItem' | 'removeItem'> | null = null;
    if (deps?.storage === undefined && typeof window !== 'undefined' && window) {
      try {
        defaultStorage = (window as { localStorage?: Pick<Storage, 'setItem' | 'removeItem'> }).localStorage ?? null;
      } catch {
        defaultStorage = null;
      }
    }
    const backingStorage = deps?.storage ?? defaultStorage;

    return {
      id,
      post(msg) {
        if (closed || !backingStorage) return;
        const payload = JSON.stringify({ ...msg, from: id, nonce: `${Date.now()}-${Math.random()}` });
        try {
          backingStorage.setItem(`${TAB_STORAGE_SIGNAL}${msg.storageKey}`, payload);
        } catch {
          /* quota or private-mode refusal */
        }
      },
      subscribe(fn) {
        if (!closed) subs.add(fn);
        return () => {
          subs.delete(fn);
        };
      },
      close() {
        if (closed) return;
        closed = true;
        subs.clear();
        target.removeEventListener('storage', onStorage);
      },
    };
  }

  return null;
}

export type TabDeps = { lock: StorageLock; bus: TabBus | null };

export function createWebTabDeps(): TabDeps | null {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return null;
  if (!window || !navigator || typeof window.addEventListener !== 'function') return null;
  const navLocks = (navigator as { locks?: LockManagerLike }).locks ?? null;
  const lock = createStorageLock({ locks: navLocks });
  const bus = createTabBus({
    BroadcastChannelCtor: typeof BroadcastChannel === 'function' ? BroadcastChannel : null,
    target: window,
  });
  return { lock, bus };
}

export const RELOAD_DEBOUNCE_MS = 60;
