/**
 * New Spotify authorizations do not reach the vulnerable deployed function.
 *
 * ## What is actually wrong out there
 *
 * The `spotify-auth` deployed to production is not this repository's. Probed
 * live against it:
 *
 *     action=url  -> `state` is a bare 36-char UUID, not `<payload>.<sig>`
 *     callback    -> never reads `state`; there is no CSRF check
 *     redirect_uri=https://attacker.example/steal
 *                 -> 200, and the authorize URL it returns points AT IT
 *
 * The third is the one that matters: the deployed function will mint a Spotify
 * authorize URL for ANY redirect target, so a crafted link hands the victim's
 * authorization code to whoever made it. Until the hardened function in
 * `supabase/functions/spotify-auth` is deployed with `OAUTH_STATE_SECRET` and
 * `OAUTH_REDIRECT_ALLOWLIST` set, the honest thing is to not offer the button.
 *
 * ## What this file pins
 *
 * 1. the gate is OFF — so nobody flips it back without this test's diff;
 * 2. `connect()` refuses BEFORE any I/O — no fetch, no browser session. A
 *    disabled button would not be enough, because the store is what any other
 *    caller reaches;
 * 3. `disconnect()` still works, because anyone who connected under the old
 *    build must be able to get out;
 * 4. the refusal is a stated reason, not a silent no-op.
 */
import { SPOTIFY_OAUTH_ENABLED, SPOTIFY_OAUTH_DISABLED_REASON } from '../../lib/featureGates';

// `mock`-prefixed so jest's hoisted factory is allowed to close over it.
const mockOpenAuthSession = jest.fn();

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: (...a: unknown[]) => mockOpenAuthSession(...a),
}));
jest.mock('expo-linking', () => ({
  createURL: (p: string) => `atlas://${p}`,
  parse: () => ({ queryParams: {} }),
}));

let deleted = false;
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 'jwt' } } }),
    },
  },
}));

import { useSpotifyStore } from '../../store/spotifyStore';

const realFetch = global.fetch;
const fetchSpy = jest.fn();

beforeEach(() => {
  deleted = false;
  mockOpenAuthSession.mockReset();
  fetchSpy.mockReset();
  global.fetch = fetchSpy as unknown as typeof fetch;
  useSpotifyStore.setState({ connection: null, status: 'idle', error: null, nowPlaying: null });
});
afterAll(() => { global.fetch = realFetch; });

describe('the gate is closed', () => {
  it('SPOTIFY_OAUTH_ENABLED is false', () => {
    // Turning this on is a deliberate act with four preconditions, listed in
    // `lib/featureGates.ts`. If this line is edited, the reviewer is looking
    // at the evidence that they were met.
    expect(SPOTIFY_OAUTH_ENABLED).toBe(false);
  });

  it('the reason given to the user is a real sentence, not an empty string', () => {
    expect(SPOTIFY_OAUTH_DISABLED_REASON.length).toBeGreaterThan(20);
  });
});

describe('connect() refuses before it touches anything', () => {
  it('makes no network request and opens no browser session', async () => {
    const ok = await useSpotifyStore.getState().connect();

    expect(ok).toBe(false);
    // The whole point: nothing reached the deployed function, and no
    // authorization page was opened. A UI-only gate would fail this.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mockOpenAuthSession).not.toHaveBeenCalled();
  });

  it('says why, instead of failing silently', async () => {
    await useSpotifyStore.getState().connect();
    expect(useSpotifyStore.getState().status).toBe('error');
    expect(useSpotifyStore.getState().error).toBe(SPOTIFY_OAUTH_DISABLED_REASON);
    expect(useSpotifyStore.getState().connection).toBeNull();
  });
});

describe('an account connected under the old build is not trapped', () => {
  it('disconnect still reaches the server and clears on confirmation', async () => {
    fetchSpy.mockImplementation(async () => {
      deleted = true;
      return { ok: true, status: 200, json: async () => ({ success: true }) } as unknown as Response;
    });
    useSpotifyStore.setState({ connection: { displayName: 'Someone', product: 'free' } });

    await useSpotifyStore.getState().disconnect();

    expect(fetchSpy).toHaveBeenCalled();
    expect(deleted).toBe(true);
    expect(useSpotifyStore.getState().connection).toBeNull();
  });
});
