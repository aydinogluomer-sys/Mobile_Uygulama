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
 */
import { supabase } from './supabase';

export type LocalUser = { id: string; email: string | null };

/** The signed-in user from the local session, or null. Never throws. */
export async function currentUser(): Promise<LocalUser | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user;
    if (!user?.id) return null;
    return { id: user.id, email: user.email ?? null };
  } catch {
    // A storage read that fails is "not signed in" as far as a render guard
    // is concerned; it must not take the screen down.
    return null;
  }
}

export async function isSignedIn(): Promise<boolean> {
  return (await currentUser()) !== null;
}
