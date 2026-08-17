/**
 * L1 tests for the OAuth redirect_uri allowlist.  (task 1D-006)
 *
 * AC-R01  an empty allowlist permits nothing (fail closed)
 * AC-R02  an exact entry matches only itself
 * AC-R03  a scheme wildcard permits only that scheme
 * AC-R04  prefix confusion is rejected
 * AC-R05  a bare "*" is refused as an allowlist entry
 * AC-R06  both edge functions actually consult the guard
 *
 * supabase/functions/notion-auth/index.ts:47 and spotify-auth/index.ts:97 read
 * redirect_uri straight off the request and interpolate it into the provider's
 * authorize URL. An attacker can therefore ask our own function for a
 * legitimately-signed authorize URL that returns the authorization code to a
 * host they control. The callback branches forward the same unvalidated value
 * to the token endpoint.
 *
 * The matcher is deliberately exact-match rather than prefix-match: a prefix
 * rule that allows "https://atlas.app" also allows "https://atlas.app.evil.com",
 * which is the classic way these allowlists are defeated. AC-R04 pins that.
 *
 * Written BEFORE the module existed and observed to fail, per R-01.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  parseAllowlist,
  isAllowedRedirect,
} from '../../../supabase/functions/_shared/redirectAllowlist';

const FN_DIR = join(__dirname, '..', '..', '..', 'supabase', 'functions');

describe('AC-R01 -- fail closed', () => {
  it('permits nothing when the allowlist is unset', () => {
    expect(parseAllowlist(undefined)).toEqual([]);
    expect(isAllowedRedirect('https://atlas.app/cb', [])).toBe(false);
  });

  it('permits nothing when the allowlist is empty or whitespace', () => {
    expect(parseAllowlist('')).toEqual([]);
    expect(parseAllowlist('  ,  , ')).toEqual([]);
    expect(isAllowedRedirect('https://atlas.app/cb', parseAllowlist(' , '))).toBe(false);
  });

  it('rejects a missing or unparseable candidate', () => {
    const list = parseAllowlist('https://atlas.app/cb');
    expect(isAllowedRedirect('', list)).toBe(false);
    expect(isAllowedRedirect('not a uri', list)).toBe(false);
    expect(isAllowedRedirect('/cb', list)).toBe(false);
  });
});

describe('AC-R02 -- exact entries', () => {
  const list = parseAllowlist('https://atlas.app/notion-callback, atlas://notion-callback');

  it('accepts the exact URIs', () => {
    expect(isAllowedRedirect('https://atlas.app/notion-callback', list)).toBe(true);
    expect(isAllowedRedirect('atlas://notion-callback', list)).toBe(true);
  });

  it('tolerates a trailing slash difference', () => {
    expect(isAllowedRedirect('https://atlas.app/notion-callback/', list)).toBe(true);
  });

  it('rejects a different path on an allowed host', () => {
    expect(isAllowedRedirect('https://atlas.app/other', list)).toBe(false);
  });

  it('rejects a different scheme on an allowed host', () => {
    expect(isAllowedRedirect('http://atlas.app/notion-callback', list)).toBe(false);
  });

  it('rejects a different port on an allowed host', () => {
    expect(isAllowedRedirect('https://atlas.app:8443/notion-callback', list)).toBe(false);
  });
});

describe('AC-R03 -- scheme wildcard, for Expo dev URLs whose host is the machine IP', () => {
  const list = parseAllowlist('exp://*');

  it('accepts any host under the named scheme', () => {
    expect(isAllowedRedirect('exp://192.168.1.5:8081/--/notion-callback', list)).toBe(true);
    expect(isAllowedRedirect('exp://10.0.0.9:19000/--/notion-callback', list)).toBe(true);
  });

  it('does not leak to any other scheme', () => {
    expect(isAllowedRedirect('https://evil.example/cb', list)).toBe(false);
    expect(isAllowedRedirect('exps://evil.example/cb', list)).toBe(false);
  });
});

describe('AC-R04 -- prefix confusion is rejected', () => {
  const list = parseAllowlist('https://atlas.app/cb');

  it('rejects a host that merely starts with an allowed host', () => {
    expect(isAllowedRedirect('https://atlas.app.evil.com/cb', list)).toBe(false);
  });

  it('rejects a userinfo trick pointing at another host', () => {
    expect(isAllowedRedirect('https://atlas.app@evil.com/cb', list)).toBe(false);
  });

  it('rejects an allowed host as a subdomain of an attacker domain', () => {
    expect(isAllowedRedirect('https://evil.com/https://atlas.app/cb', list)).toBe(false);
  });
});

describe('AC-R05 -- a bare wildcard is not an allowlist', () => {
  it('refuses "*" as an entry rather than allowing everything', () => {
    const list = parseAllowlist('*');
    expect(isAllowedRedirect('https://evil.example/cb', list)).toBe(false);
  });

  it('refuses "*://*"', () => {
    const list = parseAllowlist('*://*');
    expect(isAllowedRedirect('https://evil.example/cb', list)).toBe(false);
  });
});

describe('AC-R06 -- the edge functions consult the guard', () => {
  it.each(['notion-auth', 'spotify-auth'])('%s validates redirect_uri', (fn) => {
    const src = readFileSync(join(FN_DIR, fn, 'index.ts'), 'utf8');
    expect(src).toContain('isAllowedRedirect');

    // It must be checked on BOTH branches: `url` builds the authorize link,
    // and `callback` forwards the same value to the token endpoint.
    const checks = src.match(/isAllowedRedirect\(/g) ?? [];
    expect(checks.length).toBeGreaterThanOrEqual(2);
  });
});
