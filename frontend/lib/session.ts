/**
 * "Who is signed in", answered locally.
 *
 * ## The cost this removes
 *
 * Eleven places in the UI asked the same question with
 * `supabase.auth.getUser()`, which in supabase-js v2 ALWAYS issues
 * `GET /auth/v1/user` — a network round trip, every call. Measured against
 * the live project while fixing the same defect in the repository layer:
 *
 *     getUser()      3 calls -> 3 auth requests, 373 ms
 *     getSession()   3 calls -> 0 auth requests,   0 ms
 *
 * `weekly-review.tsx` alone made three of them, and each was used for
 * nothing but `if (!user) return;`. `getSession()` reads the persisted
 * session from storage and only touches the network when it is near expiry.
 *
 * ## Why this is not a weakening
 *
 * None of these call sites were an authorization decision. Each one guards a
 * render path, and is immediately followed by a repository call that resolves
 * the user itself and is subject to RLS on the server. A client that lied
 * here would produce a query the database rejects — the boundary is
 * `auth.uid()` evaluated from the verified JWT, and it has not moved.
 *
 * The guard is kept rather than deleted because it is what lets a screen
 * render zeros instead of stale numbers when nobody is signed in. It is now
 * simply free.
 *
 * ## F06 (SYN-02): offline with an expired token is still "signed in"
 *
 * Near expiry `getSession()` refreshes, and offline that refresh fails: auth-js answers
 * `{ session: null, error: AuthRetryableFetchError }` after retrying for about 25 s. Read as "not
 * signed in", the outbox and the task store refused every local write and the Today read cache was
 * skipped. Now `getSession()` is bounded (2 s), and when the only reason for "no session" is that
 * the auth server could not be reached, the session stored on this device answers. It is used for
 * LOCAL reads and writes only; an expired token is still refused by the server.
 */
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { authStorage } from './authStorage';
import { AUTH_STORAGE_KEY } from './authStorageKey';
import { boundSession, isRetryableAuthError, LOCAL_USER_TIMEOUT_MS, type BoundedSession } from './bootSession';

export type LocalUser = { id: string; email: string | null; createdAt?: string | null };
export type { BoundedSession };
export { isRetryableAuthError, LOCAL_USER_TIMEOUT_MS };

/**
 * The session persisted by auth-js (possibly expired). Invalid, incomplete or unreadable => null.
 * Never throws. Only the shape is checked: a user id and a refresh token.
 */
export async function readStoredSession(): Promise<Session | null> {
  try {
    const raw = await authStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.user?.id !== 'string' || parsed.user.id.length === 0) return null;
    if (typeof parsed.refresh_token !== 'string' || parsed.refresh_token.length === 0) return null;
    return parsed as Session;
  } catch {
    return null;
  }
}

/** `getSession` against `timeoutMs`; the timer is cleared on every path. Never throws. */
export function getSessionBounded(timeoutMs: number = LOCAL_USER_TIMEOUT_MS): Promise<BoundedSession> {
  return boundSession(() => supabase.auth.getSession(), timeoutMs);
}

/**
 * The signed-in user from the local session, or null. Never throws.
 *
 * Live session -> its user. No session because the auth server was out of reach (timeout or a
 * retryable fetch error) -> the stored session's user. Anything else (a permanent error, nothing
 * stored, a storage read that failed) -> null: a read that fails is "not signed in" as far as a
 * render guard is concerned, and it must not take the screen down.
 */
export async function currentUser(): Promise<LocalUser | null> {
  const b = await getSessionBounded();
  const user = b.session?.user;
  if (user?.id) return { id: user.id, email: user.email ?? null, createdAt: user.created_at ?? null };
  if (b.rejected) return null;
  if (b.timedOut || isRetryableAuthError(b.error)) {
    const stored = await readStoredSession();
    const s = stored?.user;
    if (s?.id) return { id: s.id, email: s.email ?? null, createdAt: s.created_at ?? null };
  }
  return null;
}

export async function isSignedIn(): Promise<boolean> {
  return (await currentUser()) !== null;
}
