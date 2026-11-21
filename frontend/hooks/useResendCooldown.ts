import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * F22: the "send again" wait shared by the sign-up, sign-in and recovery screens.
 *
 * The wait is an END TIME, not a counter: a JS timer that stops while the app is in the
 * background cannot make it drift, and the remaining seconds are recomputed from
 * `Date.now()` on every tick and whenever the app becomes active again.
 *
 * With a key (a normalised e-mail address) the end time is kept at module level, so the
 * sign-in and sign-up screens see the same wait for the same address. It lives in memory
 * only: a restart clears it, and the server's own rate limit ("Çok sık denendi") still
 * protects the mailbox.
 */
export const RESEND_COOLDOWN_SECONDS = 60;

export type ResendCooldown = {
  /** 0 = not waiting. */
  remaining: number;
  /** remaining > 0 */
  active: boolean;
  /** Defaults to RESEND_COOLDOWN_SECONDS. */
  start: (seconds?: number) => void;
  clear: () => void;
};

type Window = { end: number; seconds: number };

const windows = new Map<string, Window>();

/** Tests only. */
export function resetResendCooldowns(): void {
  windows.clear();
}

function normaliseKey(key?: string | null): string | null {
  const k = (key ?? '').trim().toLowerCase();
  return k ? k : null;
}

/** Never above the requested length, even if the clock is moved back; never negative. */
function remainingOf(w: Window | null): number {
  if (!w) return 0;
  return Math.min(w.seconds, Math.max(0, Math.ceil((w.end - Date.now()) / 1000)));
}

export function useResendCooldown(key?: string | null): ResendCooldown {
  const k = normaliseKey(key);
  const [local, setLocal] = useState<Window | null>(null);
  const current: Window | null = k ? windows.get(k) ?? null : local;
  const [, setTick] = useState(0);
  const remaining = remainingOf(current);
  const waiting = remaining > 0;

  const refresh = useCallback(() => setTick((n) => n + 1), []);

  // One-second interval only while waiting; cleared on unmount and when the wait ends,
  // so no tick can land outside act() in tests.
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(refresh, 1000);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // Plain functions: the React Compiler memoises them (manual useCallback here could not be
  // preserved by it -- react-hooks/preserve-manual-memoization).
  const start = (seconds: number = RESEND_COOLDOWN_SECONDS) => {
    const w: Window = { end: Date.now() + seconds * 1000, seconds };
    if (k) windows.set(k, w);
    setLocal(w);
    refresh();
  };

  const clear = () => {
    if (k) windows.delete(k);
    setLocal(null);
    refresh();
  };

  return { remaining, active: remaining > 0, start, clear };
}
