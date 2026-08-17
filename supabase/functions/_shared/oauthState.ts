/**
 * Signed stateless OAuth `state`.  (task 1D-005, decision D-02)
 *
 * `notion-auth` and `spotify-auth` mint a `state` with crypto.randomUUID(),
 * hand it to the client, and then never look at it again -- the callback
 * branches do not read it at all. There is no CSRF protection on account
 * linking, and nothing to compare against even if the callback wanted to check.
 * `notionSessionStore.ts:88-97` compares it in the CLIENT, which is not a
 * control: in a CSRF scenario the client is the attacker's.
 *
 * Shape:
 *
 *     state = base64url(payloadJson) + "." + base64url(HMAC-SHA256(payloadJson, secret))
 *     payload = { v: 1, nonce, exp, uid? }
 *
 * `uid` is OPTIONAL by design (finding N-03): `notion-auth` serves two flows
 * through one endpoint. Integration linking has an authenticated user to bind
 * to; "sign in with Notion" does not, because the user does not exist yet.
 * `verifyState` requires the two sides to AGREE -- a uid-bound state presented
 * without a uid is rejected, and vice versa, so the login path cannot be used
 * to bypass the binding on the link path.
 *
 * ── KNOWN LIMIT, stated rather than implied ──────────────────────────────
 * A signed stateless token is REPLAYABLE until it expires. Single-use requires
 * server-side storage, which is what `plan/01`'s original `oauth_states` table
 * would have given. That needs a migration, which needs `1A-002B`, which is
 * blocked on H-15. Keep the TTL short. Revisit in Phase 1D once the schema
 * chain opens. `__tests__/edge/oauthState.test.ts` AC-O10 pins this as current
 * intended behaviour so it is visible rather than inferred from a missing test.
 *
 * Deliberately dependency-free and Deno-free -- Web Crypto exists in both Deno
 * and Node 18+ -- so the frontend jest suite can exercise it directly. There is
 * no Deno and no local stack on the execution machine, so a pure module is the
 * only part of an edge function that can be tested here at all.
 */

const VERSION = 1;
const DEFAULT_TTL_SECONDS = 600;

export type StatePayload = {
  v: number;
  nonce: string;
  exp: number;
  uid?: string;
};

export type VerifyFailure =
  | 'no_secret'
  | 'malformed'
  | 'bad_signature'
  | 'expired'
  | 'uid_mismatch'
  | 'bad_version';

export type VerifyResult =
  | { ok: true; payload: StatePayload }
  | { ok: false; reason: VerifyFailure };

// ── encoding ───────────────────────────────────────────────────────────────

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array | null {
  if (!/^[A-Za-z0-9\-_]+$/.test(s)) return null;
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

const enc = new TextEncoder();
const dec = new TextDecoder();

// ── signing ────────────────────────────────────────────────────────────────

async function hmac(secret: string, data: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return new Uint8Array(sig);
}

/** Constant-time comparison. A length check alone leaks nothing useful here,
 *  but an early-exit byte compare would leak the matching prefix length. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Mint a signed state.
 *
 * Throws when the secret is absent. Failing closed is the point: a deployment
 * without `OAUTH_STATE_SECRET` must refuse to start an OAuth flow rather than
 * issue an unforgeable-looking token that anyone can forge.
 */
export async function mintState(
  secret: string,
  opts: { uid?: string; ttlSeconds?: number } = {},
): Promise<string> {
  if (!secret) throw new Error('OAUTH_STATE_SECRET tanımlı değil — OAuth akışı başlatılamaz.');

  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);

  const payload: StatePayload = {
    v: VERSION,
    nonce: toBase64Url(nonceBytes),
    exp: Math.floor(Date.now() / 1000) + (opts.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  if (opts.uid) payload.uid = opts.uid;

  const body = enc.encode(JSON.stringify(payload));
  const sig = await hmac(secret, body);
  return `${toBase64Url(body)}.${toBase64Url(sig)}`;
}

/**
 * Verify a state.
 *
 * The signature is checked BEFORE the payload is trusted for anything, and
 * expiry before `uid`, so a malformed or forged token never reaches the
 * comparison logic.
 *
 * `expected.uid` and the payload's `uid` must agree in both directions: a
 * uid-bound state presented without a uid is rejected, and a uid-less state
 * presented with one is rejected. Without that symmetry the login flow (which
 * legitimately has no uid) would be a bypass for the link flow's binding.
 */
export async function verifyState(
  secret: string,
  state: string,
  expected: { uid?: string } = {},
): Promise<VerifyResult> {
  if (!secret) return { ok: false, reason: 'no_secret' };
  if (!state) return { ok: false, reason: 'malformed' };

  const parts = state.split('.');
  if (parts.length !== 2) return { ok: false, reason: 'malformed' };

  const body = fromBase64Url(parts[0]);
  const sig = fromBase64Url(parts[1]);
  if (!body || !sig) return { ok: false, reason: 'malformed' };

  const expectedSig = await hmac(secret, body);
  if (!equalBytes(sig, expectedSig)) return { ok: false, reason: 'bad_signature' };

  let payload: StatePayload;
  try {
    payload = JSON.parse(dec.decode(body)) as StatePayload;
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  if (payload.v !== VERSION) return { ok: false, reason: 'bad_version' };
  if (typeof payload.exp !== 'number') return { ok: false, reason: 'malformed' };
  if (payload.exp < Math.floor(Date.now() / 1000)) return { ok: false, reason: 'expired' };

  if ((payload.uid ?? null) !== (expected.uid ?? null)) {
    return { ok: false, reason: 'uid_mismatch' };
  }

  return { ok: true, payload };
}
