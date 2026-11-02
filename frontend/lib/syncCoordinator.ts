/**
 * F05 (SYN-15) — flushes waiting offline work at the right moment, while the app is in the foreground.
 *
 * Before this, a queued write was retried only at boot and when the app came back to the
 * foreground: a phone that regained signal in the user's hand sent nothing until the app was
 * reopened, and the "it syncs when you are back online" promise was not kept. The coordinator adds
 * the missing triggers without a new native dependency:
 *
 *  - ONE timer (a single `setTimeout`, never an interval). Armed only while work is waiting and the
 *    app is in the foreground. Its delay is `nextDelayMs`: the soonest explicit retry time of a
 *    deferred item, or a light poll that backs off (60 s, 120 s, 240 s, 480 s) while nothing moves,
 *    capped at 15 minutes. With nothing waiting there is no timer at all.
 *  - A network success signal (lib/networkSignal, published by lib/supabase's fetch) and, on the
 *    web, the `online` event: when work is waiting, a flush follows shortly after; a burst of
 *    signals is one flush.
 *
 * The foreground flush itself stays in app/_layout.tsx's AppState listener; coming back to the
 * foreground only re-arms the timer here (no double flush). React is not imported; every outside
 * dependency is injectable for tests.
 */
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { onNetworkSuccess } from './networkSignal';

export type Flusher = {
  name: string;
  /** Work waiting to be sent (status `pending`). */
  pending(): number;
  /** The soonest explicitly deferred retry time (ms epoch) of a waiting item, or null when none is deferred. */
  nextReadyAt(): number | null;
  flush(): Promise<unknown>;
};

export type CoordinatorDeps = {
  now: () => number;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  appState: {
    current: AppStateStatus | null | undefined;
    subscribe: (fn: (s: AppStateStatus) => void) => () => void;
  };
  /** The web `online` event; null on native. */
  onOnline: ((fn: () => void) => () => void) | null;
  /** A successful network answer (lib/networkSignal). */
  onNetworkSuccess: (fn: () => void) => () => void;
};

export type CoordinatorOptions = {
  /** Poll interval while work is waiting but nothing says when it can go. Default 60 000. */
  idlePollMs?: number;
  /** Upper bound of a single wait. Default 15 minutes. */
  maxDelayMs?: number;
  /** Wait after a network success signal before flushing (coalesces a burst). Default 1 500. */
  networkDebounceMs?: number;
  deps?: Partial<CoordinatorDeps>;
};

export type SyncCoordinator = {
  /** Re-plans the timer; does NOT flush (the foreground flush is _layout's). */
  rearm(): void;
  /** One flush round now; a round in flight is joined, never doubled. */
  flushNow(): Promise<void>;
  stop(): void;
};

export const DEFAULT_IDLE_POLL_MS = 60_000;
export const DEFAULT_MAX_DELAY_MS = 15 * 60_000;
export const DEFAULT_NETWORK_DEBOUNCE_MS = 1_500;
export const MIN_DELAY_MS = 250;
/** The idle poll doubles at most this many times (60 s -> 480 s). */
const MAX_STALL_DOUBLINGS = 3;

/**
 * Pure: how long until the next round, or null when no timer is needed.
 *
 *  - nothing waiting                      -> null (no timer)
 *  - the last round moved work and more
 *    is waiting (a runner's batch limit)  -> MIN_DELAY_MS: carry on at once
 *  - an item is deferred to a known time  -> until then (at least MIN_DELAY_MS, at most maxDelayMs)
 *  - otherwise (perhaps offline)          -> idlePollMs * 2^min(stalls, 3), at most maxDelayMs
 *
 * A deferred time already in the past counts only before a stalled round: once a round has moved
 * nothing, a past time no flusher acted on must not turn into a 250 ms loop.
 */
export function nextDelayMs(input: {
  now: number;
  pending: number;
  nextReadyAt: number | null;
  idlePollMs: number;
  maxDelayMs: number;
  consecutiveStalls: number;
  lastRoundProgressed?: boolean;
}): number | null {
  if (!(input.pending > 0)) return null;
  const bounded = (ms: number) => Math.min(input.maxDelayMs, Math.max(MIN_DELAY_MS, ms));
  if (input.lastRoundProgressed) return MIN_DELAY_MS;
  const stalls = Math.min(Math.max(0, input.consecutiveStalls), MAX_STALL_DOUBLINGS);
  if (input.nextReadyAt !== null && (input.nextReadyAt > input.now || stalls === 0)) {
    return bounded(input.nextReadyAt - input.now);
  }
  return bounded(input.idlePollMs * 2 ** stalls);
}

function defaultDeps(): CoordinatorDeps {
  const web = Platform.OS === 'web'
    && typeof window !== 'undefined'
    && typeof window.addEventListener === 'function';
  return {
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    appState: {
      current: AppState.currentState,
      subscribe: (fn) => {
        const sub = AppState.addEventListener('change', fn);
        return () => sub.remove();
      },
    },
    onOnline: web
      ? (fn) => {
        window.addEventListener('online', fn);
        return () => window.removeEventListener('online', fn);
      }
      : null,
    onNetworkSuccess,
  };
}

/** `unknown` (iOS before its first event) is treated as the foreground: arming then is harmless. */
function isForeground(status: AppStateStatus | null | undefined): boolean {
  return status === 'active' || status === 'unknown' || status == null;
}

export function startSyncCoordinator(flushers: readonly Flusher[], opts: CoordinatorOptions = {}): SyncCoordinator {
  const deps: CoordinatorDeps = { ...defaultDeps(), ...opts.deps };
  const idlePollMs = opts.idlePollMs ?? DEFAULT_IDLE_POLL_MS;
  const maxDelayMs = opts.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const networkDebounceMs = opts.networkDebounceMs ?? DEFAULT_NETWORK_DEBOUNCE_MS;

  let stopped = false;
  let appStatus = deps.appState.current;
  let timer: unknown = null;
  let dueAt = Number.POSITIVE_INFINITY;
  let consecutiveStalls = 0;
  let lastRoundProgressed = false;
  let inFlight: Promise<void> | null = null;

  function totals(): { pending: number; next: number | null } {
    let pending = 0;
    let next: number | null = null;
    for (const f of flushers) {
      try {
        const p = f.pending();
        if (p > 0) pending += p;
      } catch {
        // a broken counter counts as nothing waiting
      }
      try {
        const r = f.nextReadyAt();
        if (r !== null && (next === null || r < next)) next = r;
      } catch {
        // same
      }
    }
    return { pending, next };
  }

  function clearPlanned(): void {
    if (timer !== null) deps.clearTimer(timer);
    timer = null;
    dueAt = Number.POSITIVE_INFINITY;
  }

  /** The single timer: an earlier planned round is kept, a later one is replaced. */
  function planIn(ms: number): void {
    if (stopped || !isForeground(appStatus)) return;
    const at = deps.now() + ms;
    if (timer !== null && dueAt <= at) return;
    clearPlanned();
    dueAt = at;
    timer = deps.setTimer(() => {
      timer = null;
      dueAt = Number.POSITIVE_INFINITY;
      void flushNow();
    }, ms);
  }

  function rearm(): void {
    if (stopped) return;
    clearPlanned();
    if (!isForeground(appStatus)) return;
    const { pending, next } = totals();
    const ms = nextDelayMs({
      now: deps.now(), pending, nextReadyAt: next, idlePollMs, maxDelayMs, consecutiveStalls, lastRoundProgressed,
    });
    if (ms !== null) planIn(ms);
  }

  function flushNow(): Promise<void> {
    if (inFlight) return inFlight;
    if (stopped) return Promise.resolve();
    clearPlanned();
    const round = (async () => {
      const before = totals().pending;
      // every flusher swallows its own failure; one throwing (even synchronously) never stops the others
      await Promise.allSettled(flushers.map((f) => Promise.resolve().then(() => f.flush())));
      const after = totals().pending;
      if (after === 0) {
        consecutiveStalls = 0;
        lastRoundProgressed = false;
      } else if (after < before) {
        consecutiveStalls = 0;
        lastRoundProgressed = true;
      } else {
        consecutiveStalls += 1;
        lastRoundProgressed = false;
      }
    })();
    const settled: Promise<void> = round.finally(() => {
      if (inFlight === settled) inFlight = null;
      rearm();
    });
    inFlight = settled;
    return settled;
  }

  function onSignal(): void {
    if (stopped || !isForeground(appStatus)) return;
    if (totals().pending <= 0) return; // nothing waiting: a signal changes nothing
    planIn(networkDebounceMs);
  }

  const unsubscribers: (() => void)[] = [];
  unsubscribers.push(deps.appState.subscribe((next) => {
    appStatus = next;
    if (isForeground(next)) {
      rearm();
    } else {
      clearPlanned();
      lastRoundProgressed = false;
    }
  }));
  unsubscribers.push(deps.onNetworkSuccess(onSignal));
  if (deps.onOnline) unsubscribers.push(deps.onOnline(onSignal));

  rearm();

  return {
    rearm,
    flushNow,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearPlanned();
      for (const unsub of unsubscribers) {
        try {
          unsub();
        } catch {
          // already gone
        }
      }
    },
  };
}
