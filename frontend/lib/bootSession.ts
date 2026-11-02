/**
 * F06 (SYN-02, SYN-23) — "which session do we start with", as a pure, testable decision.
 *
 * ## The defect
 *
 * With an expired access token and no connection, `supabase.auth.getSession()` tries to refresh,
 * fails with `AuthRetryableFetchError` and answers `{ session: null, error }` (auth-js 2.107,
 * GoTrueClient.__loadSession). The root layout read that as "signed out" and sent a signed-in user
 * to the login screen; every local write was refused with "Oturum bulunamadı."; and auth-js keeps
 * retrying the refresh for about 25 seconds, so a cold start could hang on it.
 *
 * ## The rule
 *
 * `getSession` races a timeout. A live session wins. When the answer is "no session" only because
 * the auth server could not be reached (a timeout or a retryable fetch error), the session stored
 * on the device is used: it may be expired, so network calls are still refused, but the app opens
 * on the user's own data and local writes (outbox, read cache) keep working. auth-js keeps trying
 * in the background and emits TOKEN_REFRESHED when the network is back, or SIGNED_OUT when the
 * refresh token is really dead. A permanent error, or a clean "no session", is "no session".
 *
 * No imports beyond types: this module is also used by `repositories/shared.ts`, and many tests
 * mock `lib/session` with only `currentUser`.
 */
import type { Session } from '@supabase/supabase-js';

export const BOOT_SESSION_TIMEOUT_MS = 8_000;
export const BOOT_WATCHDOG_MS = 12_000;
/** How long a local "who is signed in" read waits for auth-js before using the stored session. */
export const LOCAL_USER_TIMEOUT_MS = 2_000;

export type BootSessionSource = 'live' | 'stored' | 'none';
export type BootSession = {
  session: Session | null;
  source: BootSessionSource;
  /** For diagnosis only; never shown to the user. */
  reason: 'ok' | 'no-session' | 'timeout-stored' | 'retryable-stored' | 'permanent-error' | 'storage-error';
};

type GetSessionResult = { data: { session: Session | null }; error: unknown };

export type BootSessionDeps = {
  getSession: () => Promise<GetSessionResult>;
  readStored: () => Promise<Session | null>;
  timeoutMs?: number;
};

export type BoundedSession = {
  session: Session | null;
  error: unknown;
  timedOut: boolean;
  /** `getSession` itself rejected (or threw): the storage could not be read. */
  rejected: boolean;
};

/**
 * `AuthRetryableFetchError`: the auth server was not reached (offline, DNS, 502/503/504). Checked by
 * name, so a plain `{ name }` object from a test or a serialised error counts as well as the class
 * (`isAuthRetryableFetchError` is the same name check behind an `__isAuthError` flag).
 */
export function isRetryableAuthError(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AuthRetryableFetchError';
}

/** `getSession` against `timeoutMs`. The timer is cleared on every path. Never throws. */
export async function boundSession(
  getSession: () => Promise<GetSessionResult>,
  timeoutMs: number,
): Promise<BoundedSession> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), timeoutMs); });
  try {
    let pending: Promise<GetSessionResult>;
    try {
      pending = Promise.resolve(getSession());
    } catch (e) {
      return { session: null, error: e, timedOut: false, rejected: true };
    }
    const outcome = await Promise.race([
      pending.then((r) => ({ kind: 'ok' as const, r }), (e: unknown) => ({ kind: 'rejected' as const, e })),
      timeout,
    ]);
    if (outcome === 'timeout') return { session: null, error: null, timedOut: true, rejected: false };
    if (outcome.kind === 'rejected') return { session: null, error: outcome.e, timedOut: false, rejected: true };
    const session = outcome.r?.data?.session ?? null;
    return { session, error: outcome.r?.error ?? null, timedOut: false, rejected: false };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * The boot decision (karar tablosu, implementation.md F06 adım 13):
 *
 *   getSession                       stored     result
 *   session with a user              -          live   / ok
 *   timeout                          present    stored / timeout-stored
 *   timeout                          absent     none   / no-session
 *   AuthRetryableFetchError          present    stored / retryable-stored
 *   permanent error (invalid_grant)  not read   none   / permanent-error
 *   null, no error                   not read   none   / no-session
 *   rejected promise                 not read   none   / storage-error
 *
 * Never throws.
 */
export async function resolveBootSession(deps: BootSessionDeps): Promise<BootSession> {
  const b = await boundSession(deps.getSession, deps.timeoutMs ?? BOOT_SESSION_TIMEOUT_MS);
  if (b.session?.user?.id) return { session: b.session, source: 'live', reason: 'ok' };
  if (b.rejected) return { session: null, source: 'none', reason: 'storage-error' };
  if (b.timedOut || isRetryableAuthError(b.error)) {
    let stored: Session | null = null;
    try { stored = await deps.readStored(); } catch { stored = null; }
    if (stored?.user?.id) {
      return { session: stored, source: 'stored', reason: b.timedOut ? 'timeout-stored' : 'retryable-stored' };
    }
    return { session: null, source: 'none', reason: 'no-session' };
  }
  if (b.error) return { session: null, source: 'none', reason: 'permanent-error' };
  return { session: null, source: 'none', reason: 'no-session' };
}
