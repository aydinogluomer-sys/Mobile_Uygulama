/**
 * F06 (SYN-02, SYN-23) — an expired access token without a connection is still a signed-in user.
 *
 * auth-js 2.107 answers `getSession()` with `{ session: null, error: AuthRetryableFetchError }` when
 * the token is near expiry and the refresh cannot reach the server, after retrying for ~25 s. The
 * app read that as "signed out": the login screen at boot, "Oturum bulunamadı." for every local
 * write. Covered here:
 *
 *   authStorageKey       the key equals supabase-js's own default (or every user is signed out)
 *   readStoredSession    the persisted session, shape-checked, never throwing
 *   currentUser          live -> live; unreachable auth server -> stored; anything else -> null
 *   resolveBootSession   the seven rows of the boot decision table, with the 8 s bound
 *   bindAuthAutoRefresh  the refresh ticker follows AppState
 *   currentUserId        the repository side: offline is `offline: true`, not a refusal
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { Session } from '@supabase/supabase-js';
import { stripComments } from '../helpers/sourceText';

const mockGetSession = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: { auth: { getSession: (...a: unknown[]) => mockGetSession(...a) } },
}));

import { createClient } from '@supabase/supabase-js';
import { authStorage } from '../../lib/authStorage';
import * as authStorageModule from '../../lib/authStorage';
import {
  AUTH_STORAGE_KEY, AUTH_STORAGE_KEY_FALLBACK, CONFIG_MISSING_URL, deriveAuthStorageKey,
} from '../../lib/authStorageKey';
import { currentUser, getSessionBounded, isRetryableAuthError, readStoredSession, LOCAL_USER_TIMEOUT_MS } from '../../lib/session';
import { BOOT_SESSION_TIMEOUT_MS, BOOT_WATCHDOG_MS, resolveBootSession } from '../../lib/bootSession';
import { bindAuthAutoRefresh, type AppStateLike } from '../../lib/authLifecycle';
import { currentUserId } from '../../repositories/shared';
import * as SecureStore from 'expo-secure-store';

const FRONTEND = join(__dirname, '..', '..');
const fakeStore = SecureStore as unknown as { __resetForTests(): void; __failWhen(r: { op: string }): void; __clearFailures(): void };
const reset = (authStorageModule as unknown as { __resetAuthStorageForTests: () => void }).__resetAuthStorageForTests;

const RETRYABLE = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 };
const PERMANENT = { name: 'AuthApiError', message: 'Invalid Refresh Token: Refresh Token Not Found', code: 'invalid_grant', status: 400 };

function sessionOf(id: string, email: string | null = `${id}@example.com`): Session {
  return {
    access_token: `at-${id}`, refresh_token: `rt-${id}`, expires_at: 1_700_000_000, expires_in: 3600,
    token_type: 'bearer', user: { id, email } as Session['user'],
  } as Session;
}
async function store(s: Session | string): Promise<void> {
  await authStorage.setItem(AUTH_STORAGE_KEY, typeof s === 'string' ? s : JSON.stringify(s));
}
const never = () => new Promise<never>(() => undefined);

beforeEach(async () => {
  jest.useRealTimers();
  mockGetSession.mockReset();
  reset();
  fakeStore.__resetForTests();
});

afterEach(() => {
  jest.useRealTimers();
  fakeStore.__clearFailures();
});

// ---------------------------------------------------------------------------
describe('authStorageKey: the session key never moves', () => {
  it('(+) the project URL gives the supabase-js default key', () => {
    expect(deriveAuthStorageKey('https://kbcuolhjjnmhjaarxxmu.supabase.co')).toBe('sb-kbcuolhjjnmhjaarxxmu-auth-token');
  });

  it('(+) it equals what a real supabase-js client computes, for every URL shape we use', () => {
    for (const url of [
      'https://kbcuolhjjnmhjaarxxmu.supabase.co', 'https://kbcuolhjjnmhjaarxxmu.supabase.co/',
      'HTTPS://KBCUOLHJJNMHJAARXXMU.SUPABASE.CO', 'http://127.0.0.1:54321', CONFIG_MISSING_URL,
    ]) {
      const client = createClient(url, 'anon', { auth: { persistSession: false, autoRefreshToken: false } });
      const libraryKey = (client.auth as unknown as { storageKey: string }).storageKey;
      expect({ url, key: deriveAuthStorageKey(url) }).toEqual({ url, key: libraryKey });
    }
  });

  it('(-) an empty or invalid URL gives the fallback, which is the key of the placeholder URL', () => {
    for (const bad of ['', '   ', undefined, null, 'not a url', 'ftp://x.supabase.co', 'kbcuolhjjnmhjaarxxmu.supabase.co']) {
      expect(deriveAuthStorageKey(bad)).toBe(AUTH_STORAGE_KEY_FALLBACK);
    }
    expect(AUTH_STORAGE_KEY_FALLBACK).toBe('sb-config-missing-auth-token');
    expect(deriveAuthStorageKey(CONFIG_MISSING_URL)).toBe(AUTH_STORAGE_KEY_FALLBACK);
  });

  it('the module value follows EXPO_PUBLIC_SUPABASE_URL', () => {
    expect(AUTH_STORAGE_KEY).toBe(deriveAuthStorageKey(process.env.EXPO_PUBLIC_SUPABASE_URL));
  });

  it('source gate: the installed supabase-js still derives the default key with this formula', () => {
    // The minified UMD build spells it `r.hostname`; the CJS/ESM builds (what Node, Jest and Metro load) keep the names.
    for (const f of ['index.cjs', 'index.mjs']) {
      const src = readFileSync(join(FRONTEND, 'node_modules', '@supabase', 'supabase-js', 'dist', f), 'utf8');
      expect({ f, found: src.includes('sb-${baseUrl.hostname.split(".")[0]}-auth-token') }).toEqual({ f, found: true });
    }
  });

  it('lib/supabase passes the key explicitly and lib/session reads under the same constant', () => {
    const supa = stripComments(readFileSync(join(FRONTEND, 'lib', 'supabase.ts'), 'utf8'));
    expect(supa).toMatch(/storageKey:\s*AUTH_STORAGE_KEY\b/);
    expect(supa).toMatch(/storage:\s*authStorage\b/);
    const session = stripComments(readFileSync(join(FRONTEND, 'lib', 'session.ts'), 'utf8'));
    expect(session).toContain('authStorage.getItem(AUTH_STORAGE_KEY)');
  });
});

// ---------------------------------------------------------------------------
describe('readStoredSession', () => {
  it('(+) a valid persisted session comes back', async () => {
    await store(sessionOf('u-stored'));
    const s = await readStoredSession();
    expect(s?.user.id).toBe('u-stored');
    expect(s?.refresh_token).toBe('rt-u-stored');
  });

  it('(-) nothing stored, corrupt JSON, no user id, no refresh token -> null', async () => {
    await expect(readStoredSession()).resolves.toBeNull();
    await store('{not json');
    await expect(readStoredSession()).resolves.toBeNull();
    await store(JSON.stringify({ ...sessionOf('x'), user: {} }));
    await expect(readStoredSession()).resolves.toBeNull();
    await store(JSON.stringify({ ...sessionOf('x'), refresh_token: '' }));
    await expect(readStoredSession()).resolves.toBeNull();
    await store('null');
    await expect(readStoredSession()).resolves.toBeNull();
  });

  it('(-) a storage read error -> null, never a throw', async () => {
    await store(sessionOf('u-stored'));
    reset();
    fakeStore.__failWhen({ op: 'get' });
    await expect(readStoredSession()).resolves.toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe('currentUser', () => {
  it('(+) a live session is the answer; the stored copy is not consulted', async () => {
    await store(sessionOf('u-stored'));
    mockGetSession.mockResolvedValue({ data: { session: sessionOf('u-live') }, error: null });
    await expect(currentUser()).resolves.toEqual({ id: 'u-live', email: 'u-live@example.com' });
  });

  it('(+) the refresh could not reach the server (AuthRetryableFetchError) -> the stored user', async () => {
    await store(sessionOf('u-stored', null));
    mockGetSession.mockResolvedValue({ data: { session: null }, error: RETRYABLE });
    await expect(currentUser()).resolves.toEqual({ id: 'u-stored', email: null });
  });

  it('(+) getSession never answers -> the stored user after 2 s, and no timer is left behind', async () => {
    await store(sessionOf('u-stored'));
    jest.useFakeTimers();
    mockGetSession.mockImplementation(never);
    expect(LOCAL_USER_TIMEOUT_MS).toBe(2_000); // not auth-js's own ~25 s of refresh retries
    const p = currentUser();
    await jest.advanceTimersByTimeAsync(2_000 - 1);
    let settled = false;
    void p.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ id: 'u-stored', email: 'u-stored@example.com' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('(-) unreachable and nothing stored -> null', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: RETRYABLE });
    await expect(currentUser()).resolves.toBeNull();
  });

  it('(-) a permanent error (invalid_grant) -> null, even with a stored session', async () => {
    await store(sessionOf('u-stored'));
    mockGetSession.mockResolvedValue({ data: { session: null }, error: PERMANENT });
    await expect(currentUser()).resolves.toBeNull();
  });

  it('(-) a clean "no session" -> null, even with a stored session', async () => {
    await store(sessionOf('u-stored'));
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(currentUser()).resolves.toBeNull();
  });

  it('(-) getSession rejects -> null', async () => {
    await store(sessionOf('u-stored'));
    mockGetSession.mockRejectedValue(new Error('SecureStore unavailable'));
    await expect(currentUser()).resolves.toBeNull();
  });

  it('isRetryableAuthError is the name check', () => {
    expect(isRetryableAuthError(RETRYABLE)).toBe(true);
    expect(isRetryableAuthError(Object.assign(new Error('x'), { name: 'AuthRetryableFetchError' }))).toBe(true);
    for (const other of [PERMANENT, new Error('Failed to fetch'), null, undefined, 'AuthRetryableFetchError']) {
      expect(isRetryableAuthError(other)).toBe(false);
    }
  });

  it('getSessionBounded clears its timer on every path', async () => {
    jest.useFakeTimers();
    mockGetSession.mockResolvedValueOnce({ data: { session: sessionOf('a') }, error: null });
    await getSessionBounded();
    mockGetSession.mockRejectedValueOnce(new Error('x'));
    await getSessionBounded();
    mockGetSession.mockImplementationOnce(() => { throw new Error('sync'); });
    await expect(getSessionBounded()).resolves.toMatchObject({ rejected: true });
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('resolveBootSession: the decision table', () => {
  const stored = sessionOf('u-stored');
  const readStored = jest.fn(async () => stored as Session | null);
  beforeEach(() => { readStored.mockClear(); readStored.mockImplementation(async () => stored); });

  const run = (getSession: () => Promise<unknown>, timeoutMs?: number) =>
    resolveBootSession({ getSession: getSession as never, readStored, timeoutMs });

  it('the bounds are 8 s for getSession and 12 s for the watchdog', () => {
    expect(BOOT_SESSION_TIMEOUT_MS).toBe(8_000);
    expect(BOOT_WATCHDOG_MS).toBe(12_000);
  });

  it('1 a live session with a user -> live / ok, nothing read from storage', async () => {
    const live = sessionOf('u-live');
    await expect(run(async () => ({ data: { session: live }, error: null }))).resolves.toEqual({ session: live, source: 'live', reason: 'ok' });
    expect(readStored).not.toHaveBeenCalled();
  });

  it('2 a timeout with a stored session -> stored / timeout-stored, after exactly 8 s', async () => {
    jest.useFakeTimers();
    const p = run(never);
    await jest.advanceTimersByTimeAsync(BOOT_SESSION_TIMEOUT_MS - 1);
    expect(readStored).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    await expect(p).resolves.toEqual({ session: stored, source: 'stored', reason: 'timeout-stored' });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('3 a timeout with nothing stored -> none / no-session', async () => {
    jest.useFakeTimers();
    readStored.mockImplementation(async () => null);
    const p = run(never);
    await jest.advanceTimersByTimeAsync(BOOT_SESSION_TIMEOUT_MS);
    await expect(p).resolves.toEqual({ session: null, source: 'none', reason: 'no-session' });
  });

  it('4 AuthRetryableFetchError with a stored session -> stored / retryable-stored', async () => {
    await expect(run(async () => ({ data: { session: null }, error: RETRYABLE }))).resolves.toEqual({ session: stored, source: 'stored', reason: 'retryable-stored' });
  });

  it('5 a permanent error -> none / permanent-error, storage not read', async () => {
    await expect(run(async () => ({ data: { session: null }, error: PERMANENT }))).resolves.toEqual({ session: null, source: 'none', reason: 'permanent-error' });
    expect(readStored).not.toHaveBeenCalled();
  });

  it('6 null without an error -> none / no-session, storage not read', async () => {
    await expect(run(async () => ({ data: { session: null }, error: null }))).resolves.toEqual({ session: null, source: 'none', reason: 'no-session' });
    expect(readStored).not.toHaveBeenCalled();
  });

  it('7 a rejected getSession -> none / storage-error, storage not read', async () => {
    await expect(run(async () => { throw new Error('keychain locked'); })).resolves.toEqual({ session: null, source: 'none', reason: 'storage-error' });
    expect(readStored).not.toHaveBeenCalled();
  });

  it('a stored read that throws is "no session", never a throw', async () => {
    readStored.mockImplementation(async () => { throw new Error('x'); });
    await expect(run(async () => ({ data: { session: null }, error: RETRYABLE }))).resolves.toEqual({ session: null, source: 'none', reason: 'no-session' });
  });

  it('the timer is cleared on every path (no open handle after a fast answer)', async () => {
    jest.useFakeTimers();
    await run(async () => ({ data: { session: null }, error: null }));
    await run(async () => { throw new Error('x'); });
    await run(async () => ({ data: { session: sessionOf('a') }, error: null }));
    expect(jest.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
describe('bindAuthAutoRefresh: the refresh ticker follows the foreground', () => {
  function fakes(initial: AppStateLike['currentState']) {
    const listeners = new Set<(s: AppStateLike['currentState']) => void>();
    const appState: AppStateLike = {
      currentState: initial,
      addEventListener: (_t, l) => { listeners.add(l); return { remove: () => { listeners.delete(l); } }; },
    };
    const client = { auth: { startAutoRefresh: jest.fn(async () => undefined), stopAutoRefresh: jest.fn(async () => undefined) } };
    const emit = (s: AppStateLike['currentState']) => { for (const l of [...listeners]) l(s); };
    return { appState, client, emit, listeners };
  }

  it('(+) active at set-up starts once; background stops; active starts again and runs onActive', () => {
    const { appState, client, emit } = fakes('active');
    const onActive = jest.fn();
    bindAuthAutoRefresh(client, appState, onActive);
    expect(client.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(onActive).not.toHaveBeenCalled();

    emit('background');
    expect(client.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    emit('active');
    expect(client.auth.startAutoRefresh).toHaveBeenCalledTimes(2);
    expect(onActive).toHaveBeenCalledTimes(1);
    emit('active'); // a repeated event is not a transition
    expect(onActive).toHaveBeenCalledTimes(1);
    expect(client.auth.startAutoRefresh).toHaveBeenCalledTimes(2);
  });

  it('(+) set up in the background: the ticker is stopped until the app is active', () => {
    const { appState, client, emit } = fakes('background');
    bindAuthAutoRefresh(client, appState);
    expect(client.auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
    expect(client.auth.startAutoRefresh).not.toHaveBeenCalled();
    emit('active');
    expect(client.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
  });

  it('(+) iOS "unknown" before the first event counts as the foreground', () => {
    const { appState, client } = fakes('unknown');
    bindAuthAutoRefresh(client, appState);
    expect(client.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(client.auth.stopAutoRefresh).not.toHaveBeenCalled();
  });

  it('(-) the returned function removes the listener and does not stop the ticker', () => {
    const { appState, client, emit, listeners } = fakes('active');
    const onActive = jest.fn();
    const unbind = bindAuthAutoRefresh(client, appState, onActive);
    unbind();
    expect(listeners.size).toBe(0);
    expect(client.auth.stopAutoRefresh).not.toHaveBeenCalled();
    emit('background');
    emit('active');
    expect(client.auth.stopAutoRefresh).not.toHaveBeenCalled();
    expect(client.auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(onActive).not.toHaveBeenCalled();
  });

  it('a rejected start/stop or a throwing onActive does not escape', async () => {
    const { appState, client, emit } = fakes('active');
    client.auth.startAutoRefresh.mockRejectedValue(new Error('x'));
    client.auth.stopAutoRefresh.mockRejectedValue(new Error('y'));
    bindAuthAutoRefresh(client, appState, () => { throw new Error('z'); });
    expect(() => { emit('background'); emit('active'); }).not.toThrow();
    await Promise.resolve();
  });
});

// ---------------------------------------------------------------------------
describe('currentUserId (repositories/shared.ts)', () => {
  it('(+) AuthRetryableFetchError -> offline, with a sentence about the connection', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: RETRYABLE });
    await expect(currentUserId()).resolves.toEqual({
      ok: false, offline: true, error: 'Çevrimdışısın; oturum bağlantı gelince yenilenecek.',
    });
  });

  it('(+) getSession hangs -> offline after 2 s', async () => {
    jest.useFakeTimers();
    mockGetSession.mockImplementation(never);
    const p = currentUserId();
    await jest.advanceTimersByTimeAsync(LOCAL_USER_TIMEOUT_MS);
    await expect(p).resolves.toMatchObject({ ok: false, offline: true });
  });

  it('(-) a clean "no session" -> "Oturum bulunamadı." without an offline flag', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });
    const r = await currentUserId();
    expect(r).toEqual({ ok: false, error: 'Oturum bulunamadı.' });
    expect('offline' in r).toBe(false);
  });

  it('(-) a permanent error -> its message, not offline', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: PERMANENT });
    const r = await currentUserId();
    expect(r).toEqual({ ok: false, error: PERMANENT.message });
    expect('offline' in r).toBe(false);
  });

  it('(-) a rejected getSession is a failure value, never a throw into the repository', async () => {
    mockGetSession.mockRejectedValue(new Error('keychain locked'));
    await expect(currentUserId()).resolves.toEqual({ ok: false, error: 'keychain locked' });
  });

  it('(+) a session -> its user id', async () => {
    mockGetSession.mockResolvedValue({ data: { session: sessionOf('u9') }, error: null });
    await expect(currentUserId()).resolves.toEqual({ ok: true, userId: 'u9' });
  });
});

// ---------------------------------------------------------------------------
describe('lib/supabase without a configuration (SYN-23)', () => {
  type SupabaseModule = typeof import('../../lib/supabase');
  const env = { url: process.env.EXPO_PUBLIC_SUPABASE_URL, key: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY };
  let loaded: SupabaseModule | null = null;

  function loadActual(): SupabaseModule {
    let mod: SupabaseModule | null = null;
    jest.isolateModules(() => { mod = jest.requireActual('../../lib/supabase') as SupabaseModule; });
    loaded = mod;
    return mod!;
  }

  afterEach(async () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = env.url;
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = env.key;
    if (loaded) {
      const auth = loaded.supabase.auth as unknown as { initializePromise?: Promise<unknown>; stopAutoRefresh: () => Promise<void> };
      await auth.initializePromise?.catch(() => undefined);
      await auth.stopAutoRefresh().catch(() => undefined);
      loaded = null;
    }
  });

  it('(-) no URL: the module still loads (createClient does not throw) and names the missing configuration', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    const mod = loadActual();
    expect(mod.SUPABASE_CONFIG_ERROR).toBe('EXPO_PUBLIC_SUPABASE_URL ve EXPO_PUBLIC_SUPABASE_ANON_KEY tanımlı değil.');
    expect((mod.supabase.auth as unknown as { storageKey: string }).storageKey).toBe(AUTH_STORAGE_KEY_FALLBACK);
  });

  it('(-) no anon key: the same', () => {
    delete process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
    expect(loadActual().SUPABASE_CONFIG_ERROR).not.toBeNull();
  });

  it('(+) configured: no error, and the client keeps the session under the derived (default) key', () => {
    const mod = loadActual();
    expect(mod.SUPABASE_CONFIG_ERROR).toBeNull();
    expect((mod.supabase.auth as unknown as { storageKey: string }).storageKey)
      .toBe(deriveAuthStorageKey(process.env.EXPO_PUBLIC_SUPABASE_URL));
  });
});
