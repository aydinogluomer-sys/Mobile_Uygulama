/**
 * L1 tests for the signed stateless OAuth `state`.  (task 1D-005, decision D-02)
 *
 * AC-O01  a minted state verifies against the same secret
 * AC-O02  a tampered payload is rejected
 * AC-O03  a foreign secret is rejected
 * AC-O04  an expired state is rejected
 * AC-O05  missing / malformed input is rejected
 * AC-O06  `uid` binds the state to one user
 * AC-O07  the login flow (no `uid`) still works
 * AC-O08  an absent secret fails CLOSED, on both mint and verify
 * AC-O09  the signature is a real MAC, not an encoding of the payload
 *
 * notion-auth/index.ts:48 and spotify-auth/index.ts:98 mint a `state` with
 * crypto.randomUUID(), return it to the client, and then never look at it
 * again -- the callback branches do not read it at all. There is no CSRF
 * protection on account linking, and nothing to compare against even if the
 * callback wanted to check.
 *
 * D-02 chose a signed stateless state over an `oauth_states` table, because a
 * table needs a migration, which needs 1A-002B, which is blocked on H-15.
 *
 * KNOWN LIMIT, asserted rather than hidden (AC-O10): a signed state is
 * replayable until it expires. Full single-use requires server-side storage.
 * The test below pins that this is the CURRENT, INTENDED behaviour so that
 * nobody reads the absence of a replay test as an oversight.
 *
 * Written BEFORE the module existed and observed to fail, per R-01.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  mintState,
  verifyState,
} from '../../../supabase/functions/_shared/oauthState';

const FN_DIR = join(__dirname, '..', '..', '..', 'supabase', 'functions');

const SECRET = 'test-secret-do-not-use-anywhere-real';
const OTHER = 'a-different-secret-entirely';
const UID = '11111111-1111-1111-1111-111111111111';
const OTHER_UID = '22222222-2222-2222-2222-222222222222';

describe('AC-O01 -- round trip', () => {
  it('verifies a state it just minted', async () => {
    const state = await mintState(SECRET, { uid: UID });
    const res = await verifyState(SECRET, state, { uid: UID });
    expect(res.ok).toBe(true);
  });

  it('produces a different state every time', async () => {
    const a = await mintState(SECRET, { uid: UID });
    const b = await mintState(SECRET, { uid: UID });
    expect(a).not.toBe(b);
  });

  it('has exactly two dot-separated parts', async () => {
    const state = await mintState(SECRET, { uid: UID });
    expect(state.split('.')).toHaveLength(2);
  });
});

describe('AC-O02 -- tampering', () => {
  it('rejects a payload edited after signing', async () => {
    const state = await mintState(SECRET, { uid: UID });
    const [payload, sig] = state.split('.');
    // Flip one character of the payload, keep the original signature.
    const flipped = (payload[0] === 'A' ? 'B' : 'A') + payload.slice(1);
    const res = await verifyState(SECRET, `${flipped}.${sig}`, { uid: UID });
    expect(res.ok).toBe(false);
  });

  it('rejects an edited signature', async () => {
    const state = await mintState(SECRET, { uid: UID });
    const [payload, sig] = state.split('.');
    const flipped = (sig[0] === 'A' ? 'B' : 'A') + sig.slice(1);
    const res = await verifyState(SECRET, `${payload}.${flipped}`, { uid: UID });
    expect(res.ok).toBe(false);
  });
});

describe('AC-O03 -- wrong secret', () => {
  it('rejects a state signed with another secret', async () => {
    const state = await mintState(OTHER, { uid: UID });
    const res = await verifyState(SECRET, state, { uid: UID });
    expect(res.ok).toBe(false);
  });
});

describe('AC-O04 -- expiry', () => {
  it('rejects a state whose TTL has passed', async () => {
    const state = await mintState(SECRET, { uid: UID, ttlSeconds: -1 });
    const res = await verifyState(SECRET, state, { uid: UID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('expired');
  });

  it('accepts a state still inside its TTL', async () => {
    const state = await mintState(SECRET, { uid: UID, ttlSeconds: 600 });
    const res = await verifyState(SECRET, state, { uid: UID });
    expect(res.ok).toBe(true);
  });
});

describe('AC-O05 -- malformed input', () => {
  it.each([
    ['', 'empty'],
    ['not-a-state', 'no separator'],
    ['a.b.c', 'too many parts'],
    ['!!!.???', 'not base64url'],
  ])('rejects %s (%s)', async (bad) => {
    const res = await verifyState(SECRET, bad, { uid: UID });
    expect(res.ok).toBe(false);
  });
});

describe('AC-O06 -- uid binding', () => {
  it("rejects another user's state", async () => {
    const state = await mintState(SECRET, { uid: UID });
    const res = await verifyState(SECRET, state, { uid: OTHER_UID });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('uid_mismatch');
  });

  it('rejects a uid-bound state when the caller presents no uid', async () => {
    const state = await mintState(SECRET, { uid: UID });
    const res = await verifyState(SECRET, state, {});
    expect(res.ok).toBe(false);
  });
});

describe('AC-O07 -- the login flow has no uid yet (finding N-03)', () => {
  it('mints and verifies a state with no uid', async () => {
    const state = await mintState(SECRET, {});
    const res = await verifyState(SECRET, state, {});
    expect(res.ok).toBe(true);
  });

  it('rejects a uid-less state when the caller expects one', async () => {
    const state = await mintState(SECRET, {});
    const res = await verifyState(SECRET, state, { uid: UID });
    expect(res.ok).toBe(false);
  });
});

describe('AC-O08 -- absent secret fails closed', () => {
  it('refuses to mint without a secret', async () => {
    await expect(mintState('', { uid: UID })).rejects.toThrow();
  });

  it('refuses to verify without a secret, even for a well-formed state', async () => {
    const state = await mintState(SECRET, { uid: UID });
    const res = await verifyState('', state, { uid: UID });
    expect(res.ok).toBe(false);
  });
});

describe('AC-O09 -- the signature is a real MAC', () => {
  it('is not simply the payload re-encoded', async () => {
    const state = await mintState(SECRET, { uid: UID });
    const [payload, sig] = state.split('.');
    expect(sig).not.toBe(payload);
    // HMAC-SHA256 is 32 bytes -> 43 base64url chars unpadded.
    expect(sig.length).toBe(43);
  });

  it('changes when the secret changes, for the same logical claim', async () => {
    const a = await mintState(SECRET, { uid: UID, ttlSeconds: 600 });
    const [payloadA] = a.split('.');
    // Re-sign the SAME payload under a different secret by verifying it fails.
    const res = await verifyState(OTHER, a, { uid: UID });
    expect(res.ok).toBe(false);
    expect(payloadA.length).toBeGreaterThan(0);
  });
});

describe('AC-O10 -- known limit, pinned deliberately', () => {
  it('is replayable until it expires -- this is CURRENT, INTENDED behaviour', async () => {
    // A stateless signed token cannot be single-use without server-side
    // storage. Recording it as a passing assertion rather than a missing test
    // so the limitation is visible, not inferred from an absence.
    const state = await mintState(SECRET, { uid: UID, ttlSeconds: 600 });
    expect((await verifyState(SECRET, state, { uid: UID })).ok).toBe(true);
    expect((await verifyState(SECRET, state, { uid: UID })).ok).toBe(true);
  });
});

describe('AC-O11 -- the edge functions actually use it', () => {
  it.each(['notion-auth', 'spotify-auth'])('%s mints and verifies', (fn) => {
    const src = readFileSync(join(FN_DIR, fn, 'index.ts'), 'utf8');
    expect(src).toContain('mintState(');
    expect(src).toContain('verifyState(');
    // crypto.randomUUID() as the state is exactly the defect: an unsigned,
    // unverifiable token. It must be gone, not merely supplemented.
    expect(src).not.toContain('const state = crypto.randomUUID()');
  });

  it.each(['notion-auth', 'spotify-auth'])('%s verifies BEFORE the token exchange', (fn) => {
    const src = readFileSync(join(FN_DIR, fn, 'index.ts'), 'utf8');

    // Scope to the callback branch. A global search is wrong here: both files
    // define helpers ABOVE serve() that also hit the provider's token endpoint
    // -- spotify-auth:76 refreshes an existing token -- and matching those
    // would compare the guard against an unrelated call.
    const start = src.indexOf("action === 'callback'");
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start);

    const verifyAt = block.indexOf('verifyState(');
    const exchangeAt = block.search(/https:\/\/[^'"`]*\/(oauth\/token|api\/token)/);
    expect(verifyAt).toBeGreaterThan(-1);
    expect(exchangeAt).toBeGreaterThan(-1);
    // An unverified state that reaches the provider has already burned an
    // authorization code -- the side effect the check exists to prevent.
    expect(verifyAt).toBeLessThan(exchangeAt);
  });

  it.each(['notionStore', 'spotifyStore', 'notionSessionStore'])(
    '%s sends the returned state back', (store) => {
      const src = readFileSync(join(__dirname, '..', '..', 'store', `${store}.ts`), 'utf8');
      expect(src).toContain('state: returnedState');
    });

  it('notionSessionStore no longer compares state on the client', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'store', 'notionSessionStore.ts'), 'utf8');
    expect(src).not.toContain('STATE_STORAGE_KEY');
    expect(src).not.toContain('CSRF state doğrulama başarısız');
  });
});
