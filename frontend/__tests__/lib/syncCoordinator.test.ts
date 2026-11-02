/**
 * F05 (SYN-15) — the sync coordinator: one timer, only while work is waiting and the app is in the
 * foreground; a network success signal flushes shortly after; nothing doubles.
 *
 * Every outside dependency is injected: a manual clock with a timer table (so "how many timers are
 * armed, for how long" is observable, not inferred), a fake AppState, fake signals.
 */
import {
  DEFAULT_IDLE_POLL_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_NETWORK_DEBOUNCE_MS,
  MIN_DELAY_MS,
  nextDelayMs,
  startSyncCoordinator,
  type CoordinatorDeps,
  type Flusher,
} from '../../lib/syncCoordinator';
import type { AppStateStatus } from 'react-native';

type Timer = { id: number; at: number; ms: number; fn: () => void };

function harness(start = 1_000_000) {
  let now = start;
  let seq = 0;
  const timers = new Map<number, Timer>();
  const armed: number[] = [];
  let appListener: ((s: AppStateStatus) => void) | null = null;
  let netListener: (() => void) | null = null;
  let onlineListener: (() => void) | null = null;
  const deps: CoordinatorDeps = {
    now: () => now,
    setTimer: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { id, at: now + ms, ms, fn });
      armed.push(ms);
      return id;
    },
    clearTimer: (h) => { timers.delete(h as number); },
    appState: {
      current: 'active',
      subscribe: (fn) => { appListener = fn; return () => { appListener = null; }; },
    },
    onOnline: (fn) => { onlineListener = fn; return () => { onlineListener = null; }; },
    onNetworkSuccess: (fn) => { netListener = fn; return () => { netListener = null; }; },
  };
  const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  /** Moves the clock and fires every timer that is due, in order. */
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = [...timers.values()].filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      timers.delete(due.id);
      due.fn();
      await settle();
    }
    now = until;
    await settle();
  };
  return {
    deps,
    timers,
    armed,
    advance,
    settle,
    setNow: (t: number) => { now = t; },
    getNow: () => now,
    app: (s: AppStateStatus) => appListener?.(s),
    net: () => netListener?.(),
    online: () => onlineListener?.(),
    listeners: () => ({ app: appListener, net: netListener, online: onlineListener }),
  };
}

/** A flusher whose state the test controls. */
function fakeFlusher(init: { pending: number; nextReadyAt?: number | null; perFlush?: number; name?: string }) {
  const f = {
    name: init.name ?? 'f',
    pendingCount: init.pending,
    next: init.nextReadyAt ?? null,
    perFlush: init.perFlush ?? 0,
    flushes: 0,
    fail: false,
    pending: () => f.pendingCount,
    nextReadyAt: () => f.next,
    flush: jest.fn(async () => {
      f.flushes += 1;
      if (f.fail) throw new Error('boom');
      f.pendingCount = Math.max(0, f.pendingCount - f.perFlush);
    }),
  };
  return f;
}

describe('nextDelayMs (pure)', () => {
  const base = { now: 1_000, idlePollMs: 60_000, maxDelayMs: 900_000, consecutiveStalls: 0 };
  it.each([
    ['nothing waiting -> no timer', { pending: 0, nextReadyAt: null }, null],
    ['nothing waiting even with a time -> no timer', { pending: 0, nextReadyAt: 6_000 }, null],
    ['a deferred item -> until it is due', { pending: 2, nextReadyAt: 6_000 }, 5_000],
    ['a deferred item almost due -> at least MIN_DELAY_MS', { pending: 1, nextReadyAt: 1_010 }, MIN_DELAY_MS],
    ['a far deferred item -> capped', { pending: 1, nextReadyAt: 1_000 + 3_600_000 }, 900_000],
    ['waiting, time unknown -> idle poll', { pending: 3, nextReadyAt: null }, 60_000],
    ['1 stalled round -> 120 s', { pending: 3, nextReadyAt: null, consecutiveStalls: 1 }, 120_000],
    ['2 stalled rounds -> 240 s', { pending: 3, nextReadyAt: null, consecutiveStalls: 2 }, 240_000],
    ['3 stalled rounds -> 480 s', { pending: 3, nextReadyAt: null, consecutiveStalls: 3 }, 480_000],
    ['9 stalled rounds -> still 480 s', { pending: 3, nextReadyAt: null, consecutiveStalls: 9 }, 480_000],
    ['the last round made progress -> go on at once', { pending: 70, nextReadyAt: null, lastRoundProgressed: true }, MIN_DELAY_MS],
    ['a past time before any stall -> at once', { pending: 1, nextReadyAt: 500 }, MIN_DELAY_MS],
    ['a past time after a stall -> the idle backoff, not a 250 ms loop', { pending: 1, nextReadyAt: 500, consecutiveStalls: 1 }, 120_000],
  ])('%s', (_name, input, expected) => {
    expect(nextDelayMs({ ...base, ...input })).toBe(expected);
  });

  it('the idle backoff never exceeds maxDelayMs', () => {
    expect(nextDelayMs({ ...base, maxDelayMs: 100_000, pending: 1, nextReadyAt: null, consecutiveStalls: 3 })).toBe(100_000);
  });

  it('defaults are the documented ones', () => {
    expect(DEFAULT_IDLE_POLL_MS).toBe(60_000);
    expect(DEFAULT_MAX_DELAY_MS).toBe(15 * 60_000);
    expect(DEFAULT_NETWORK_DEBOUNCE_MS).toBe(1_500);
    expect(MIN_DELAY_MS).toBe(250);
  });
});

describe('the single timer', () => {
  it('arms ONE timer for the soonest deferred item, flushes when it fires, then re-arms', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 2, nextReadyAt: h.getNow() + 5_000 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    expect(h.timers.size).toBe(1);
    expect(h.armed).toEqual([5_000]);

    f.next = null; // the round leaves the work waiting with no known time
    await h.advance(5_000);
    expect(f.flush).toHaveBeenCalledTimes(1);
    expect(h.timers.size).toBe(1); // re-armed
    c.stop();
  });

  it('no timer at all while nothing is waiting', () => {
    const h = harness();
    const f = fakeFlusher({ pending: 0 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    expect(h.timers.size).toBe(0);
    expect(h.armed).toEqual([]);
    c.stop();
  });

  it('going to the background clears the timer and flushes nothing; coming back re-arms without flushing', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 1 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    expect(h.timers.size).toBe(1);

    h.app('background');
    expect(h.timers.size).toBe(0);
    await h.advance(DEFAULT_MAX_DELAY_MS * 2);
    expect(f.flush).not.toHaveBeenCalled();

    h.app('active');
    expect(h.timers.size).toBe(1);
    await h.settle();
    expect(f.flush).not.toHaveBeenCalled(); // the foreground flush belongs to app/_layout.tsx
    c.stop();
  });

  it('no timer is armed when the app starts in the background', () => {
    const h = harness();
    h.deps.appState.current = 'background';
    const f = fakeFlusher({ pending: 4 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    expect(h.timers.size).toBe(0);
    c.stop();
  });

  it('a batch limit drains in rounds: 120 ready commands, 50 per flush, 3 rounds back to back', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 120, perFlush: 50 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    expect(h.armed).toEqual([DEFAULT_IDLE_POLL_MS]); // nothing says when: the idle poll

    await h.advance(DEFAULT_IDLE_POLL_MS); // round 1: 120 -> 70
    expect(f.pendingCount).toBe(70);
    expect(h.armed[h.armed.length - 1]).toBe(MIN_DELAY_MS);
    await h.advance(MIN_DELAY_MS); // round 2: 70 -> 20
    await h.advance(MIN_DELAY_MS); // round 3: 20 -> 0
    expect(f.flush).toHaveBeenCalledTimes(3);
    expect(f.pendingCount).toBe(0);
    expect(h.timers.size).toBe(0); // done: nothing waiting, no timer
    c.stop();
  });

  it('backs off 60 / 120 / 240 / 480 s while nothing moves, never past the cap, and resets on progress', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 3 }); // offline: a flush moves nothing
    const c = startSyncCoordinator([f], { deps: h.deps });
    await h.advance(60_000);
    await h.advance(120_000);
    await h.advance(240_000);
    await h.advance(480_000);
    await h.advance(480_000);
    expect(h.armed).toEqual([60_000, 120_000, 240_000, 480_000, 480_000, 480_000]);
    expect(Math.max(...h.armed)).toBeLessThanOrEqual(DEFAULT_MAX_DELAY_MS);

    f.perFlush = 1; // the connection is back: the next round moves one
    await h.advance(480_000);
    expect(f.pendingCount).toBe(2);
    expect(h.armed[h.armed.length - 1]).toBe(MIN_DELAY_MS);
    f.perFlush = 0; // and stalls again: the backoff starts over from 60 s
    await h.advance(MIN_DELAY_MS);
    expect(h.armed[h.armed.length - 1]).toBe(120_000);
    c.stop();
  });
});

describe('signals', () => {
  it('a network success while work waits flushes once, 1.5 s later', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 2, perFlush: 2 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    h.net();
    expect(h.armed[h.armed.length - 1]).toBe(DEFAULT_NETWORK_DEBOUNCE_MS);
    await h.advance(1_499);
    expect(f.flush).not.toHaveBeenCalled();
    await h.advance(1);
    expect(f.flush).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it('ten quick signals are one flush', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 2, perFlush: 2 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    for (let i = 0; i < 10; i++) { h.net(); await h.advance(100); }
    await h.advance(DEFAULT_NETWORK_DEBOUNCE_MS);
    expect(f.flush).toHaveBeenCalledTimes(1);
    expect(h.timers.size).toBe(0);
    c.stop();
  });

  it('a signal with nothing waiting does nothing', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 0 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    h.net();
    h.online();
    expect(h.timers.size).toBe(0);
    await h.advance(DEFAULT_MAX_DELAY_MS);
    expect(f.flush).not.toHaveBeenCalled();
    c.stop();
  });

  it('the web online event flushes waiting work', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 1, perFlush: 1 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    h.online();
    await h.advance(DEFAULT_NETWORK_DEBOUNCE_MS);
    expect(f.flush).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it('a signal in the background does nothing', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 1, perFlush: 1 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    h.app('background');
    h.net();
    await h.advance(DEFAULT_MAX_DELAY_MS);
    expect(f.flush).not.toHaveBeenCalled();
    c.stop();
  });
});

describe('rounds never double, failures stay contained, stop is final', () => {
  it('a second flushNow while one is in flight joins it', async () => {
    const h = harness();
    let release!: () => void;
    const f = fakeFlusher({ pending: 1 });
    f.flush.mockImplementation(() => new Promise<void>((r) => { release = () => { f.pendingCount = 0; r(); }; }));
    const c = startSyncCoordinator([f], { deps: h.deps });
    const a = c.flushNow();
    const b = c.flushNow();
    expect(b).toBe(a);
    await h.settle(); // the flusher is called on the next microtask
    expect(c.flushNow()).toBe(a); // still the same round
    release();
    await a;
    expect(f.flush).toHaveBeenCalledTimes(1);
    c.stop();
  });

  it('one flusher rejecting (even synchronously) does not stop the others', async () => {
    const h = harness();
    const bad = fakeFlusher({ pending: 1, name: 'bad' });
    bad.fail = true;
    const sync = fakeFlusher({ pending: 1, name: 'sync' });
    sync.flush.mockImplementation((() => { throw new Error('sync boom'); }) as never);
    const good = fakeFlusher({ pending: 1, perFlush: 1, name: 'good' });
    const c = startSyncCoordinator([bad, sync, good], { deps: h.deps });
    await expect(c.flushNow()).resolves.toBeUndefined();
    expect(good.flush).toHaveBeenCalledTimes(1);
    expect(good.pendingCount).toBe(0);
    c.stop();
  });

  it('after stop() no signal, app event or timer reacts', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 3, perFlush: 1 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    expect(h.timers.size).toBe(1);
    c.stop();
    expect(h.timers.size).toBe(0);
    expect(h.listeners()).toEqual({ app: null, net: null, online: null });
    h.net();
    c.rearm();
    await c.flushNow();
    await h.advance(DEFAULT_MAX_DELAY_MS * 2);
    expect(f.flush).not.toHaveBeenCalled();
    expect(h.timers.size).toBe(0);
  });

  it('every round reads the counts afresh', async () => {
    const h = harness();
    const f = fakeFlusher({ pending: 0 });
    const c = startSyncCoordinator([f], { deps: h.deps });
    expect(h.timers.size).toBe(0);
    f.pendingCount = 5; // work appears later
    c.rearm();
    expect(h.timers.size).toBe(1);
    c.stop();
  });
});

describe('the flusher type is what services/unifiedOutbox implements', () => {
  it('compiles against a plain object', () => {
    const f: Flusher = { name: 'x', pending: () => 0, nextReadyAt: () => null, flush: async () => undefined };
    expect(f.name).toBe('x');
  });
});
