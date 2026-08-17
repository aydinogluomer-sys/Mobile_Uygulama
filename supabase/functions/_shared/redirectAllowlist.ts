/**
 * OAuth `redirect_uri` allowlist.  (task 1D-006)
 *
 * Both OAuth functions read `redirect_uri` off the request and interpolate it
 * into the provider's authorize URL. Unvalidated, that lets anyone ask our own
 * function for a legitimately-formed authorize link that delivers the
 * authorization code to a host they control. The callback branches forward the
 * same value to the token endpoint, so it must be checked there too.
 *
 * Deliberately dependency-free and Deno-free so the frontend jest suite can
 * exercise it directly. Nothing here touches Deno.env; the caller passes the
 * parsed list in.
 */

/** An entry meaning "any URI using this scheme", written `scheme://*`. */
const SCHEME_WILDCARD = /^([a-z][a-z0-9+.-]*):\/\/\*$/i;

/**
 * Split the configured allowlist.
 *
 * Entries that would allow everything are dropped rather than honoured: a
 * misconfigured `*` should fail closed, not open. `parseAllowlist` returning
 * `[]` means "permit nothing", which is what `isAllowedRedirect` enforces.
 */
export function parseAllowlist(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((entry) => entry !== '*' && entry !== '*://*');
}

function parse(uri: string): URL | null {
  if (!uri) return null;
  try {
    const u = new URL(uri);
    // A URL with no scheme is not absolute, and a relative redirect is never
    // something we hand to an OAuth provider.
    return u.protocol ? u : null;
  } catch {
    return null;
  }
}

/** Compare paths ignoring a single trailing slash, which providers vary on. */
function samePath(a: string, b: string): boolean {
  const norm = (p: string) => (p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p);
  return norm(a) === norm(b);
}

/**
 * Is `uri` one of ours?
 *
 * Matching is exact on scheme + host + port + path, never a prefix. A prefix
 * rule that allows `https://atlas.app` also allows `https://atlas.app.evil.com`,
 * which is the standard way these allowlists are defeated.
 *
 * The one loosening is `scheme://*`, needed because an Expo development
 * redirect is `exp://<the dev machine's IP>:<port>/--/callback` and the host
 * is not knowable in advance. It is scheme-scoped and opt-in per environment.
 */
export function isAllowedRedirect(uri: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;

  const candidate = parse(uri);
  if (!candidate) return false;

  // Credentials in the authority are a redirect-confusion vector
  // (`https://atlas.app@evil.com`), and no legitimate redirect carries them.
  if (candidate.username || candidate.password) return false;

  for (const entry of allowlist) {
    const wildcard = SCHEME_WILDCARD.exec(entry);
    if (wildcard) {
      if (candidate.protocol === `${wildcard[1].toLowerCase()}:`) return true;
      continue;
    }

    const allowed = parse(entry);
    if (!allowed) continue;

    if (
      candidate.protocol === allowed.protocol &&
      candidate.hostname === allowed.hostname &&
      candidate.port === allowed.port &&
      samePath(candidate.pathname, allowed.pathname)
    ) {
      return true;
    }
  }

  return false;
}
