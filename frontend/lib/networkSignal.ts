/**
 * F05 (SYN-15) — "a network response just came back".
 *
 * `lib/supabase.ts` calls `markNetworkSuccess` on every `res.ok` answer; `lib/syncCoordinator` listens
 * and, when work is waiting, flushes it a moment later: the connection is evidently back. That is the
 * reason this file exists instead of a network-state library (no new native dependency).
 *
 * No imports, on purpose: lib/supabase publishes, the coordinator listens, nothing cycles.
 * At most one publication per second; a burst of answers is one signal.
 */

const THROTTLE_MS = 1_000;

let lastPublishedAt = Number.NEGATIVE_INFINITY;
const listeners = new Set<() => void>();

/** Called for every successful (`res.ok`) Supabase answer. Publishes at most once a second. */
export function markNetworkSuccess(now: number = Date.now()): void {
  if (now - lastPublishedAt < THROTTLE_MS) return;
  lastPublishedAt = now;
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch {
      // a listener's failure never reaches the request that happened to succeed
    }
  }
}

export function onNetworkSuccess(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * The fetch lib/supabase hands to its client: every `res.ok` answer publishes the signal. The answer
 * is passed on untouched and a failed request fails exactly as before (no signal). `getFetch` is
 * called per request, so the global `fetch` is read at call time, never at module load.
 */
export function signalOnSuccess(getFetch: () => typeof fetch): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
    getFetch()(input, init).then((res) => {
      if (res.ok) markNetworkSuccess();
      return res;
    })) as typeof fetch;
}

/** Tests: forget the listeners and the throttle. */
export function resetNetworkSignalForTests(): void {
  listeners.clear();
  lastPublishedAt = Number.NEGATIVE_INFINITY;
}
