/**
 * F08 (BLD-02) — the one place the public build-time environment is read and validated.
 *
 * Babel/Metro inline ONLY static `process.env.EXPO_PUBLIC_X` member reads, so every value is read
 * one by one in `rawPublicEnv()`; a dynamic `process.env[name]` would be undefined in a release build.
 *
 * Nothing here throws at module load. `inspectPublicEnv` reports the NAMES of what is missing and
 * never a value (the anon key is public, but an error text is the wrong place for any value).
 */
import { CONFIG_MISSING_URL } from './authStorageKey';

export type PublicEnv = {
  readonly supabaseUrl: string;
  readonly supabaseAnonKey: string;
};

export type PublicEnvInput = {
  readonly url?: string;
  readonly anon?: string;
};

export type PublicEnvStatus =
  | { readonly ok: true; readonly env: PublicEnv }
  | { readonly ok: false; readonly missing: readonly string[] };

export const ENV_SUPABASE_URL = 'EXPO_PUBLIC_SUPABASE_URL';
export const ENV_SUPABASE_ANON_KEY = 'EXPO_PUBLIC_SUPABASE_ANON_KEY';

/**
 * Stands in for a missing URL. It is the F06 `CONFIG_MISSING_URL` (lib/authStorageKey.ts) on purpose:
 * the session storage key is derived from the same URL, and the `.invalid` TLD (RFC 2606) never
 * resolves, so no request to it can ever reach a real project.
 */
export const PLACEHOLDER_SUPABASE_URL = CONFIG_MISSING_URL;
export const PLACEHOLDER_SUPABASE_KEY = 'config-missing';

export class MissingPublicEnvError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(`Eksik ortam değişkeni: ${missing.join(', ')}`);
    this.name = 'MissingPublicEnvError';
    this.missing = [...missing];
  }
}

/** Statik erişimlerle ham girdiyi okur (Babel satır içi alma için). */
export function rawPublicEnv(): PublicEnvInput {
  return {
    url: process.env.EXPO_PUBLIC_SUPABASE_URL,
    anon: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/** Fırlatmaz; eksik değişken ADLARINI döndürür, değerleri asla. */
export function inspectPublicEnv(raw: PublicEnvInput = rawPublicEnv()): PublicEnvStatus {
  const url = typeof raw.url === 'string' ? raw.url.trim() : '';
  const anon = typeof raw.anon === 'string' ? raw.anon.trim() : '';
  const missing: string[] = [];
  // the same acceptance rule as supabase-js: an http(s) URL, anything else cannot build a client
  if (!url || !/^https?:\/\//i.test(url)) missing.push(ENV_SUPABASE_URL);
  if (!anon) missing.push(ENV_SUPABASE_ANON_KEY);
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true, env: { supabaseUrl: url, supabaseAnonKey: anon } };
}

/** Fırlatır (yalnız betik/test yolları için). */
export function readPublicEnv(raw: PublicEnvInput = rawPublicEnv()): PublicEnv {
  const status = inspectPublicEnv(raw);
  if (!status.ok) throw new MissingPublicEnvError(status.missing);
  return status.env;
}

/** aiStreamService için: eksikse boş dize döndürür, asla fırlatmaz. */
export function readPublicEnvLoose(): { readonly url: string; readonly anon: string } {
  const raw = rawPublicEnv();
  return { url: raw.url ?? '', anon: raw.anon ?? '' };
}
