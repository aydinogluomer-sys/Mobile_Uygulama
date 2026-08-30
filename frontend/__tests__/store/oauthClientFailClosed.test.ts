/**
 * OAuth client-side fail-closed behaviour for Google Calendar and Spotify.
 *
 * These are BEHAVIOUR tests, not source greps: they drive the real store
 * actions with a stubbed `fetch` and assert on the resulting state. Two
 * defects motivated them, both of which a source-text gate would have been
 * poorly placed to catch because the wrong code looked entirely reasonable.
 *
 * ## 1. The state fallback that defeated CSRF protection
 *
 * `googleCalendarStore.connect()` sent
 *
 *     state: parsed.queryParams?.state ?? state
 *
 * to the callback — falling back to the state the client had just been
 * handed when the provider's callback carried none. The server verifies what
 * the client sends, so that fallback makes verification unconditionally
 * succeed: the value being checked is one the caller supplies, not one that
 * made the round trip through Google. A callback with no state is a failed
 * callback and must be refused.
 *
 * ## 2. Disconnect that reported success it never had
 *
 * Both `googleCalendarStore.disconnect()` and `spotifyStore.disconnect()`
 * discarded the HTTP response and cleared local state unconditionally
 * (Spotify's went further: `catch { /* yoksay *​/ }`). On a 401 or 500 the UI
 * said "not connected" while the OAuth refresh token was still stored
 * server-side — the app asserting a revocation that had not happened, and
 * removing the only affordance to retry it. Notion's store already did this
 * correctly; these two did not.
 */

const mockSession = { access_token: 'test-jwt' };
let mockGetSession = jest.fn(async () => ({ data: { session: mockSession as unknown } }));

jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: (...a: unknown[]) => mockGetSession(...(a as [])) } },
}));

/** WebBrowser returns whatever callback URL a test wants to simulate. */
let mockAuthSessionUrl = 'atlas://google-calendar-callback?code=abc&state=provider-state';
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'success', url: mockAuthSessionUrl })),
}));

jest.mock('expo-linking', () => ({
  createURL: (p: string) => `atlas://${p}`,
  parse: (url: string) => {
    const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const queryParams: Record<string, string> = {};
    for (const pair of q.split('&').filter(Boolean)) {
      const [k, v] = pair.split('=');
      queryParams[k] = decodeURIComponent(v ?? '');
    }
    return { queryParams };
  },
}));

import { useGoogleCalendarStore } from '../../store/googleCalendarStore';
import { useSpotifyStore } from '../../store/spotifyStore';

type StubbedCall = { url: string; body: unknown };
let calls: StubbedCall[] = [];
/** url-substring -> response */
let routes: { match: string; status: number; body: unknown }[] = [];

beforeEach(() => {
  calls = [];
  routes = [];
  mockGetSession = jest.fn(async () => ({ data: { session: mockSession as unknown } }));
  mockAuthSessionUrl = 'atlas://google-calendar-callback?code=abc&state=provider-state';
  useGoogleCalendarStore.setState({ connection: null, status: 'idle', error: null, available: null });
  useSpotifyStore.setState({ connection: null, status: 'idle', error: null, nowPlaying: null });

  global.fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : undefined });
    const route = routes.find((r) => String(url).includes(r.match));
    const { status, body } = route ?? { status: 200, body: {} };
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    } as unknown as Response;
  }) as unknown as typeof fetch;
});

describe('Google connect — OAuth state must come from the provider', () => {
  beforeEach(() => {
    routes = [
      { match: 'action=url', status: 200, body: { url: 'https://accounts.google.com/x', state: 'client-state' } },
      { match: 'action=callback', status: 200, body: { success: true, calendar_id: 'c1', calendar_name: 'Takvim' } },
    ];
  });

  it('forwards the PROVIDER state, never the locally-issued one', async () => {
    mockAuthSessionUrl = 'atlas://google-calendar-callback?code=abc&state=provider-state';
    await useGoogleCalendarStore.getState().connect();
    const cb = calls.find((c) => c.url.includes('action=callback'));
    expect(cb).toBeDefined();
    expect((cb!.body as { state: string }).state).toBe('provider-state');
    // The value the client was handed must never be what it sends back.
    expect((cb!.body as { state: string }).state).not.toBe('client-state');
  });

  it('FAILS CLOSED when the callback carries no state', async () => {
    mockAuthSessionUrl = 'atlas://google-calendar-callback?code=abc';
    const ok = await useGoogleCalendarStore.getState().connect();
    expect(ok).toBe(false);
    expect(useGoogleCalendarStore.getState().status).toBe('error');
    expect(useGoogleCalendarStore.getState().error).toMatch(/state/i);
    // Crucially: the callback must never have been attempted.
    expect(calls.some((c) => c.url.includes('action=callback'))).toBe(false);
    expect(useGoogleCalendarStore.getState().connection).toBeNull();
  });

  it('FAILS CLOSED when the callback carries no code', async () => {
    mockAuthSessionUrl = 'atlas://google-calendar-callback?state=provider-state';
    const ok = await useGoogleCalendarStore.getState().connect();
    expect(ok).toBe(false);
    expect(calls.some((c) => c.url.includes('action=callback'))).toBe(false);
  });

  it('a rejected state on the server leaves the account unlinked', async () => {
    routes = [
      { match: 'action=url', status: 200, body: { url: 'https://accounts.google.com/x' } },
      { match: 'action=callback', status: 400, body: { error: 'OAuth state doğrulanamadı (bad_signature).' } },
    ];
    const ok = await useGoogleCalendarStore.getState().connect();
    expect(ok).toBe(false);
    expect(useGoogleCalendarStore.getState().connection).toBeNull();
    expect(useGoogleCalendarStore.getState().error).toMatch(/state/i);
  });
});

describe('Google connect — unavailable is distinct from unconnected', () => {
  it('a 404 marks the integration unavailable rather than idle', async () => {
    routes = [{ match: 'action=status', status: 404, body: {} }];
    await useGoogleCalendarStore.getState().fetchStatus();
    expect(useGoogleCalendarStore.getState().available).toBe(false);
    expect(useGoogleCalendarStore.getState().connection).toBeNull();
  });

  it('configured:false marks the integration unavailable', async () => {
    routes = [{ match: 'action=status', status: 200, body: { configured: false, connected: false } }];
    await useGoogleCalendarStore.getState().fetchStatus();
    expect(useGoogleCalendarStore.getState().available).toBe(false);
  });

  it('a configured, unconnected account is available', async () => {
    routes = [{ match: 'action=status', status: 200, body: { configured: true, connected: false } }];
    await useGoogleCalendarStore.getState().fetchStatus();
    expect(useGoogleCalendarStore.getState().available).toBe(true);
    expect(useGoogleCalendarStore.getState().connection).toBeNull();
  });
});

describe('Google disconnect — local state follows the server, not the request', () => {
  beforeEach(() => {
    useGoogleCalendarStore.setState({
      connection: { calendarId: 'c1', calendarName: 'Takvim' },
      status: 'success', error: null, available: true,
    });
  });

  it('clears the connection on 200', async () => {
    routes = [{ match: 'action=disconnect', status: 200, body: { success: true } }];
    await useGoogleCalendarStore.getState().disconnect();
    expect(useGoogleCalendarStore.getState().connection).toBeNull();
    expect(useGoogleCalendarStore.getState().error).toBeNull();
  });

  it.each([401, 500])('KEEPS the connection and reports the error on %i', async (status) => {
    routes = [{ match: 'action=disconnect', status, body: { error: 'Bağlantı kesilemedi' } }];
    await useGoogleCalendarStore.getState().disconnect();
    // The token is still on the server, so the UI must not claim otherwise.
    expect(useGoogleCalendarStore.getState().connection).not.toBeNull();
    expect(useGoogleCalendarStore.getState().status).toBe('error');
    expect(useGoogleCalendarStore.getState().error).toBeTruthy();
  });

  it('KEEPS the connection when the request throws', async () => {
    global.fetch = jest.fn(async () => { throw new Error('network down'); }) as unknown as typeof fetch;
    await useGoogleCalendarStore.getState().disconnect();
    expect(useGoogleCalendarStore.getState().connection).not.toBeNull();
    expect(useGoogleCalendarStore.getState().status).toBe('error');
  });
});

describe('Spotify disconnect — same contract', () => {
  beforeEach(() => {
    useSpotifyStore.setState({
      connection: { displayName: 'Tester', product: 'premium' },
      status: 'success', error: null, nowPlaying: null,
    });
  });

  it('clears the connection on 200', async () => {
    routes = [{ match: 'action=disconnect', status: 200, body: { success: true } }];
    await useSpotifyStore.getState().disconnect();
    expect(useSpotifyStore.getState().connection).toBeNull();
  });

  it.each([401, 500])('KEEPS the connection and reports the error on %i', async (status) => {
    routes = [{ match: 'action=disconnect', status, body: { error: 'Bağlantı kesilemedi' } }];
    await useSpotifyStore.getState().disconnect();
    expect(useSpotifyStore.getState().connection).not.toBeNull();
    expect(useSpotifyStore.getState().status).toBe('error');
  });
});
