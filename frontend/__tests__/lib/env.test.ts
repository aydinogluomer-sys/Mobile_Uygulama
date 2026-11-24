/**
 * F08 (BLD-02) — build-time public environment validation (`lib/env.ts`).
 *
 * Verifies trimming, missing-name reporting without throwing (`inspectPublicEnv`),
 * value-free error messages when throwing (`readPublicEnv`), http(s) URL enforcement,
 * and loose fallback (`readPublicEnvLoose`).
 */
import {
  ENV_SUPABASE_ANON_KEY,
  ENV_SUPABASE_URL,
  inspectPublicEnv,
  MissingPublicEnvError,
  PLACEHOLDER_SUPABASE_KEY,
  PLACEHOLDER_SUPABASE_URL,
  readPublicEnv,
  readPublicEnvLoose,
} from '../../lib/env';

describe('BLD-02 — public environment contract (lib/env.ts)', () => {
  it('(+) returns ok: true with trimmed values when both URL and anon key are valid', () => {
    const raw = {
      url: '  https://example.supabase.co  ',
      anon: '  sb_publishable_test_key  ',
    };
    expect(inspectPublicEnv(raw)).toEqual({
      ok: true,
      env: {
        supabaseUrl: 'https://example.supabase.co',
        supabaseAnonKey: 'sb_publishable_test_key',
      },
    });
    expect(readPublicEnv(raw)).toEqual({
      supabaseUrl: 'https://example.supabase.co',
      supabaseAnonKey: 'sb_publishable_test_key',
    });
    expect(inspectPublicEnv({ url: 'http://127.0.0.1:54321', anon: 'local-anon' }).ok).toBe(true);
  });

  it('(+) readPublicEnvLoose returns strings and never throws even when variables are absent', () => {
    const prevUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const prevAnon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    try {
      delete process.env.EXPO_PUBLIC_SUPABASE_URL;
      delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      expect(readPublicEnvLoose()).toEqual({ url: '', anon: '' });
    } finally {
      if (prevUrl !== undefined) process.env.EXPO_PUBLIC_SUPABASE_URL = prevUrl;
      if (prevAnon !== undefined) process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = prevAnon;
    }
  });

  it('(+) placeholder constants use RFC 2606 .invalid so missing config can never reach a real host', () => {
    expect(PLACEHOLDER_SUPABASE_URL).toMatch(/^https?:\/\/[\w.-]+\.invalid$/);
    expect(PLACEHOLDER_SUPABASE_KEY).toBe('config-missing');
  });

  it('(-) reports only EXPO_PUBLIC_SUPABASE_URL when URL is empty or whitespace', () => {
    expect(inspectPublicEnv({ url: '   ', anon: 'valid-anon' })).toEqual({
      ok: false,
      missing: [ENV_SUPABASE_URL],
    });
  });

  it('(-) reports both variable names when both are missing or blank', () => {
    expect(inspectPublicEnv({})).toEqual({
      ok: false,
      missing: [ENV_SUPABASE_URL, ENV_SUPABASE_ANON_KEY],
    });
    expect(inspectPublicEnv({ url: '', anon: '' })).toEqual({
      ok: false,
      missing: [ENV_SUPABASE_URL, ENV_SUPABASE_ANON_KEY],
    });
  });

  it('(-) treats non-http/https URLs as missing', () => {
    for (const badUrl of ['ftp://example.supabase.co', 'example.supabase.co', 'javascript:alert(1)']) {
      expect(inspectPublicEnv({ url: badUrl, anon: 'valid-anon' })).toEqual({
        ok: false,
        missing: [ENV_SUPABASE_URL],
      });
    }
  });

  it('(-) readPublicEnv throws MissingPublicEnvError naming only variables and NEVER leaking input values', () => {
    const secretAnon = 'sb_secret_NEVER_PRINT_ME_987654';
    const secretBadUrl = 'not-http-NEVER_PRINT_URL_123456';

    let caught: unknown;
    try {
      readPublicEnv({ url: secretBadUrl, anon: secretAnon });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(MissingPublicEnvError);
    const err = caught as MissingPublicEnvError;
    expect(err.missing).toEqual([ENV_SUPABASE_URL]);
    expect(err.message).toContain(ENV_SUPABASE_URL);
    expect(err.message).not.toContain(secretAnon);
    expect(err.message).not.toContain(secretBadUrl);
  });
});
