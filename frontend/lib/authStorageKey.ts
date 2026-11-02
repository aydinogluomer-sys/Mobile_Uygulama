/**
 * F06 (SYN-02, SYN-23) — the key the Supabase session is stored under, in one place.
 *
 * supabase-js derives its default storage key from the project URL:
 * `sb-${new URL(url).hostname.split('.')[0]}-auth-token`. `lib/supabase.ts` now passes the key
 * explicitly and `lib/session.ts` reads the stored session under it, so both must agree with that
 * default to the letter: a different key would sign every existing user out on update.
 * `__tests__/lib/sessionOfflineExpiry.test.ts` compares this function with a real supabase-js client
 * and with the formula in the installed library.
 */

/**
 * Stands in for a missing `EXPO_PUBLIC_SUPABASE_URL` (lib/supabase.ts builds its client with it, so
 * the client never throws at module load). Nothing is served there.
 */
export const CONFIG_MISSING_URL = 'http://config-missing.invalid';

function keyFromUrl(url: string | undefined | null): string | null {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  // the same acceptance rule as supabase-js (validateSupabaseUrl): http(s) only
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const ref = new URL(trimmed).hostname.split('.')[0];
    return ref ? `sb-${ref}-auth-token` : null;
  } catch {
    return null;
  }
}

/** The key supabase-js uses for `CONFIG_MISSING_URL`: 'sb-config-missing-auth-token'. */
export const AUTH_STORAGE_KEY_FALLBACK: string = keyFromUrl(CONFIG_MISSING_URL) ?? 'sb-config-missing-auth-token';

/**
 * `https://kbcuolhjjnmhjaarxxmu.supabase.co` -> `sb-kbcuolhjjnmhjaarxxmu-auth-token`.
 * An empty or invalid URL gives AUTH_STORAGE_KEY_FALLBACK. Never throws.
 */
export function deriveAuthStorageKey(url: string | undefined | null): string {
  return keyFromUrl(url) ?? AUTH_STORAGE_KEY_FALLBACK;
}

/** From process.env.EXPO_PUBLIC_SUPABASE_URL (inlined at build time), computed once at module load. */
export const AUTH_STORAGE_KEY: string = deriveAuthStorageKey(process.env.EXPO_PUBLIC_SUPABASE_URL);
