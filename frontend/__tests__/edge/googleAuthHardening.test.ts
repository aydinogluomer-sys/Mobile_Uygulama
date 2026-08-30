/**
 * The canonical `google-auth` must be hardened the way this repo already
 * hardened its other OAuth functions, and must fail closed when unconfigured.
 *
 * ## Background
 *
 * `googleCalendarStore.ts` called `google-auth` with four actions. The
 * function existed only under `backend/supabase/functions/` — not canonical,
 * not deployed — and wrote to `google_calendar_integrations`, which did not
 * exist on the live project. Every action 404'd while the UI presented the
 * integration as available.
 *
 * The `backend/` copy was not adopted as-is. It carried the two defects
 * `_shared/oauthState.ts` and `_shared/redirectAllowlist.ts` were written to
 * fix, and which `spotify-auth`'s canonical source already uses:
 *
 *   - it minted `state` with `crypto.randomUUID()` and never verified it, so
 *     account linking had no CSRF protection and nothing to compare against;
 *   - it interpolated an unvalidated `redirect_uri` into Google's authorize
 *     URL and forwarded it to the token endpoint, so anyone could obtain a
 *     genuine Google authorize link delivering the code to a host they own.
 *
 * These assertions exist because "we used the shared helper" is the kind of
 * thing that silently regresses when a function is rewritten or re-copied
 * from the older tree.
 */
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const REPO = join(__dirname, '..', '..', '..');
const SRC = join(REPO, 'supabase', 'functions', 'google-auth', 'index.ts');

describe('google-auth — exists in the canonical tree', () => {
  it('is present under supabase/functions, not only under backend/', () => {
    expect(existsSync(SRC)).toBe(true);
  });
});

describe('google-auth — OAuth hardening', () => {
  const fn = stripComments(readFileSync(SRC, 'utf8'));

  it('validates redirect_uri against the shared allowlist', () => {
    expect(fn).toContain("from '../_shared/redirectAllowlist.ts'");
    expect(fn).toContain('isAllowedRedirect');
    // Both the authorize URL and the token exchange take a redirect_uri, and
    // both must be checked — checking only the first still hands the code to
    // an attacker-chosen host at exchange time.
    expect((fn.match(/isAllowedRedirect\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('mints AND verifies a signed state, rather than a bare random one', () => {
    expect(fn).toContain("from '../_shared/oauthState.ts'");
    expect(fn).toContain('mintState(');
    expect(fn).toContain('verifyState(');
    expect(fn).not.toContain('crypto.randomUUID()');
  });

  it('verifies state BEFORE exchanging the code', () => {
    // An authorization code sent to Google before the state is checked has
    // already been burned — the check has to precede the exchange to mean
    // anything.
    const verifyAt = fn.indexOf('verifyState(');
    const exchangeAt = fn.indexOf('oauth2.googleapis.com/token');
    expect(verifyAt).toBeGreaterThan(-1);
    expect(exchangeAt).toBeGreaterThan(verifyAt);
  });

  it('binds the state to the authenticated user', () => {
    expect(fn).toMatch(/mintState\(STATE_SECRET,\s*\{\s*uid:/);
    expect(fn).toMatch(/verifyState\([^)]*\{\s*uid:/);
  });
});

describe('google-auth — fails closed when unconfigured', () => {
  const fn = stripComments(readFileSync(SRC, 'utf8'));

  it('reads secrets with a real default, not a TypeScript-only assertion', () => {
    // `Deno.env.get('X')!` does nothing at runtime: a missing secret became
    // the literal string "undefined" inside a real Google URL.
    expect(fn).not.toMatch(/GOOGLE_CLIENT_ID = Deno\.env\.get\([^)]*\)!/);
    expect(fn).toMatch(/GOOGLE_CLIENT_ID = Deno\.env\.get\([^)]*\) \?\? ''/);
    expect(fn).toMatch(/GOOGLE_CLIENT_SECRET = Deno\.env\.get\([^)]*\) \?\? ''/);
  });

  it('has no hardcoded client id or secret fallback', () => {
    // The deployed spotify-auth carries literal Spotify credentials as `??`
    // fallbacks. Nothing of that shape may appear here.
    expect(fn).not.toMatch(/GOOGLE_CLIENT_(ID|SECRET) = [^;]*\?\? '[A-Za-z0-9]{8,}'/);
  });

  it('reports configuration state so the client can present it as unavailable', () => {
    expect(fn).toContain('isConfigured');
    expect(fn).toMatch(/configured: false/);
  });

  it('refuses to start a flow when unconfigured', () => {
    // The `url` branch must bail before building an authorize URL.
    const urlBranch = fn.slice(fn.indexOf("action === 'url'"), fn.indexOf("action === 'callback'"));
    expect(urlBranch).toMatch(/if \(!isConfigured\(\)\)/);
    expect(urlBranch).toMatch(/503/);
  });
});

describe('google-auth — token storage is server-only', () => {
  const fn = stripComments(readFileSync(SRC, 'utf8'));

  it('touches google_calendar_integrations only through the service role', () => {
    // The table is RLS-enabled with zero policies by design (it holds a Google
    // refresh token), so a user-scoped client would silently read nothing.
    for (const m of fn.matchAll(/(\w+)\s*\n?\s*\.from\('google_calendar_integrations'\)/g)) {
      expect(m[1]).toBe('admin');
    }
    expect(fn).toContain('SUPABASE_SERVICE_KEY');
  });

  it('verifies the caller before every table access', () => {
    const firstUser = fn.indexOf('getUser(req)');
    const firstTable = fn.indexOf("from('google_calendar_integrations')");
    expect(firstUser).toBeGreaterThan(-1);
    expect(firstTable).toBeGreaterThan(firstUser);
  });
});
