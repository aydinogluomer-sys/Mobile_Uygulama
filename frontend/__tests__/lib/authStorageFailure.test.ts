/**
 * F06 (SYN-09, TST-08) — the session store when SecureStore fails.
 *
 * `authStorage` holds the Supabase session (access + refresh token) in the Keychain / Keystore.
 * Before F06 every write was parallel chunks followed by a chunk counter, so a write that died
 * half way left old and new chunks mixed under one counter; a write that failed fell back to
 * PLAIN TEXT AsyncStorage; a read error read that plain-text copy; and a later read preferred a
 * stale SecureStore value over the newer plain-text one.
 *
 * Now a value is a generation of parts plus one pointer written LAST (the commit point), with a
 * checksum, the previous generation kept as a fallback, and a journal that lets the next write
 * remove the parts of a write that never committed. A write that SecureStore refuses stays in
 * memory (never AsyncStorage) and is retried; a delete that cannot remove the pointer throws and
 * leaves a tombstone so the session never comes back.
 *
 * "A crash" below is `__resetAuthStorageForTests()`: the module forgets everything it held in
 * memory, exactly what a new process sees; SecureStore keeps what was written.
 *
 * Red baseline (constitution B.4): this file was run against the pre-F06 `lib/authStorage.ts`
 * first and recorded red (see docs/implementation-v3/STATE.md, F06).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
jest.mock('expo-secure-store', () => require('../helpers/secureStoreFake').createSecureStoreModule());

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import * as authStorageModule from '../../lib/authStorage';
import { authStorage, splitIntoUtf8Chunks, toSecureKey } from '../../lib/authStorage';
import { setCrashSink } from '../../lib/crashReporting';

type FailRule = { op: 'set' | 'get' | 'delete' | 'any'; match?: (key: string) => boolean; from?: number; until?: number };
type FakeSecureStore = {
  __resetForTests: () => void;
  __failWhen: (rule: FailRule) => void;
  __clearFailures: () => void;
  __callCount: () => number;
  __snapshot: () => Record<string, string>;
};
const fake = SecureStore as unknown as FakeSecureStore;
const setItemAsync = SecureStore.setItemAsync as unknown as jest.Mock;
const getItemAsync = SecureStore.getItemAsync as unknown as jest.Mock;
const deleteItemAsync = SecureStore.deleteItemAsync as unknown as jest.Mock;

// New in F06; optional so the red baseline could run against the old module.
type F06Exports = {
  flushPendingAuthStorage?: () => Promise<void>;
  checksum?: (value: string) => string;
  AuthStorageWriteError?: new (...args: never[]) => Error;
  __resetAuthStorageForTests?: () => void;
};
const f06 = authStorageModule as unknown as F06Exports;
const crash = () => f06.__resetAuthStorageForTests?.();
const flushPending = () => (f06.flushPendingAuthStorage ? f06.flushPendingAuthStorage() : Promise.resolve());

const KEY = 'sb-kbcuolhjjnmhjaarxxmu-auth-token';
const SAFE = toSecureKey(KEY);

/** A session-shaped value of about `kb` kilobytes, distinct per `tag`. */
function session(tag: string, kb: number, extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    access_token: `${tag}.` + 'a'.repeat(Math.max(0, kb * 1024 - 200)),
    refresh_token: `refresh-${tag}`,
    expires_at: 1_900_000_000,
    user: { id: `user-${tag}` },
    ...extra,
  });
}

const keys = (): string[] => Object.keys(fake.__snapshot()).sort();
const partKeys = (): string[] => keys().filter((k) => k.startsWith(`${SAFE}.__g`));
const pointer = (): { gen: number; count: number; sum: string; prev: { gen: number } | null } | null => {
  const raw = fake.__snapshot()[`${SAFE}.__ptr`];
  return raw ? JSON.parse(raw) : null;
};
const utf8 = (s: string): number => Buffer.byteLength(s, 'utf8');

const sink = jest.fn();
const originalOS = Platform.OS;

beforeEach(async () => {
  crash();
  fake.__resetForTests();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  sink.mockClear();
  setCrashSink(sink);
  Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
});

afterEach(() => {
  setCrashSink(null);
  fake.__clearFailures();
});

afterAll(() => {
  Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
});

describe('a write that fails half way', () => {
  it('(+) part 2 refused: the disk still holds the PREVIOUS complete value, and nothing goes to AsyncStorage', async () => {
    const a = session('A', 5);
    const b = session('B', 5);
    expect(splitIntoUtf8Chunks(b).length).toBeGreaterThanOrEqual(3);
    await authStorage.setItem(KEY, a);

    fake.__failWhen({ op: 'set', match: (k) => /(__g\d+_1|__chunk_1)$/.test(k) });
    await expect(authStorage.setItem(KEY, b)).resolves.toBeUndefined();
    // this process still answers with the newest value it was given
    expect(await authStorage.getItem(KEY)).toBe(b);
    fake.__clearFailures();

    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    crash(); // the process dies before anything retries B
    expect(await authStorage.getItem(KEY)).toBe(a);
  });

  it('(+) two half-failed writes in a row: the disk still holds the last COMPLETE value (the pointer is written last)', async () => {
    const a = session('A', 5);
    await authStorage.setItem(KEY, a);

    fake.__failWhen({ op: 'set', match: (k) => /__g\d+_1$/.test(k) });
    await authStorage.setItem(KEY, session('B', 5));
    crash();
    await authStorage.setItem(KEY, session('C', 5));
    fake.__clearFailures();

    crash();
    expect(await authStorage.getItem(KEY)).toBe(a);
  });

  it('(+) SecureStore refuses every write: no throw, the new value is served from memory, never plain text, reported once', async () => {
    const b = session('B', 1);
    fake.__failWhen({ op: 'set' });

    await expect(authStorage.setItem(KEY, b)).resolves.toBeUndefined();
    expect(await authStorage.getItem(KEY)).toBe(b);

    const plain = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('sb-'));
    expect(plain).toEqual([]);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls[0][0]).toMatchObject({ context: 'authStorage.setItem' });
    // the report carries the error, never the session
    expect(JSON.stringify(sink.mock.calls[0][0])).not.toContain('refresh-B');
  });

  it('(+) once SecureStore works again, flushPendingAuthStorage commits it and the pending set is empty', async () => {
    const b = session('B', 3);
    fake.__failWhen({ op: 'set' });
    await authStorage.setItem(KEY, b);
    fake.__clearFailures();

    await flushPending();
    expect(fake.__snapshot()[`${SAFE}.__ptr`]).toBeTruthy();

    // nothing left to flush: a second flush writes nothing
    setItemAsync.mockClear();
    await flushPending();
    expect(setItemAsync).not.toHaveBeenCalled();

    crash();
    expect(await authStorage.getItem(KEY)).toBe(b);
  });

  it('(+) the pointer write refused: the next successful write removes the orphaned parts (journal)', async () => {
    const a = session('A', 4);
    const b = session('B', 5); // more parts than C, so orphans would remain without the journal
    const c = session('C', 1);
    await authStorage.setItem(KEY, a);
    const aParts = splitIntoUtf8Chunks(a).length;

    fake.__failWhen({ op: 'set', match: (k) => k.endsWith('.__ptr') });
    await authStorage.setItem(KEY, b);
    fake.__clearFailures();
    crash(); // B never committed and is gone with the process

    await authStorage.setItem(KEY, c);
    const ptr = pointer();
    expect(ptr).not.toBeNull();
    const expected = [
      `${SAFE}.__ptr`,
      ...Array.from({ length: aParts }, (_, i) => `${SAFE}.__g${ptr!.prev!.gen}_${i}`),
      ...Array.from({ length: ptr!.count }, (_, i) => `${SAFE}.__g${ptr!.gen}_${i}`),
    ].sort();
    expect(keys()).toEqual(expected);
    crash();
    expect(await authStorage.getItem(KEY)).toBe(c);
  });

  it('(+) two concurrent writes (A then B): B wins and every part belongs to one generation', async () => {
    const a = session('A', 5);
    const b = session('B', 4);
    await Promise.all([authStorage.setItem(KEY, a), authStorage.setItem(KEY, b)]);

    crash();
    expect(await authStorage.getItem(KEY)).toBe(b);
    const ptr = pointer();
    expect(ptr).not.toBeNull();
    const current = partKeys().filter((k) => k.startsWith(`${SAFE}.__g${ptr!.gen}_`));
    expect(current).toHaveLength(ptr!.count);
    expect(current.map((k) => fake.__snapshot()[k]).join('')).toBe(b);
  });

  it('(+) a write that starts while another is already committing waits for it (one key, one writer)', async () => {
    const a = session('A', 5);
    const b = session('B', 4);
    await authStorage.setItem(KEY, session('BASE', 2));
    setItemAsync.mockClear();

    const pa = authStorage.setItem(KEY, a);
    // let A get past its start and into SecureStore before B arrives
    for (let i = 0; i < 1000 && setItemAsync.mock.calls.length === 0; i += 1) await Promise.resolve();
    expect(setItemAsync.mock.calls.length).toBeGreaterThan(0);
    const pb = authStorage.setItem(KEY, b);
    await Promise.all([pa, pb]);

    crash();
    expect(await authStorage.getItem(KEY)).toBe(b);
    const ptr = pointer()!;
    expect(ptr.prev).not.toBeNull();
    // A committed in full before B began: B's previous generation is A, readable on its own
    const prevParts = partKeys().filter((k) => k.startsWith(`${SAFE}.__g${ptr.prev!.gen}_`));
    expect(prevParts.map((k) => fake.__snapshot()[k]).join('')).toBe(a);
  });

  it('(+) a 5 KB Turkish value round-trips, and no single SecureStore value exceeds 2048 bytes', async () => {
    const v = JSON.stringify({ refresh_token: 'r', user: { id: 'u' }, note: 'ğüşöçıİĞÜŞÖÇ'.repeat(260) });
    expect(utf8(v)).toBeGreaterThan(5 * 1024);
    await authStorage.setItem(KEY, v);
    for (const call of setItemAsync.mock.calls) expect(utf8(String(call[1]))).toBeLessThanOrEqual(2048);
    crash();
    expect(await authStorage.getItem(KEY)).toBe(v);
  });
});

describe('reads', () => {
  it('(-) a corrupted current generation falls back to the previous one; both corrupted is null', async () => {
    const a = session('A', 3);
    const b = session('B', 3);
    await authStorage.setItem(KEY, a);
    await authStorage.setItem(KEY, b);
    const ptr = pointer()!;

    await SecureStore.setItemAsync(`${SAFE}.__g${ptr.gen}_0`, 'tampered');
    crash();
    expect(await authStorage.getItem(KEY)).toBe(a);

    await SecureStore.setItemAsync(`${SAFE}.__g${ptr.prev!.gen}_1`, 'tampered too');
    crash();
    expect(await authStorage.getItem(KEY)).toBeNull();
  });

  it('(-) a SecureStore READ error is null, never the plain-text AsyncStorage copy', async () => {
    await AsyncStorage.setItem(KEY, session('PLAIN', 1));
    fake.__failWhen({ op: 'get' });
    expect(await authStorage.getItem(KEY)).toBeNull();
  });

  it('(-) the legacy chunk schema is read and moved to the new one', async () => {
    const v = session('LEGACY', 4);
    const parts = splitIntoUtf8Chunks(v);
    await SecureStore.setItemAsync(`${SAFE}.__chunks`, String(parts.length));
    for (let i = 0; i < parts.length; i += 1) await SecureStore.setItemAsync(`${SAFE}.__chunk_${i}`, parts[i]);

    expect(await authStorage.getItem(KEY)).toBe(v);
    expect(fake.__snapshot()[`${SAFE}.__ptr`]).toBeTruthy();
    expect(keys().filter((k) => /__chunks?(_\d+)?$/.test(k))).toEqual([]);
    crash();
    expect(await authStorage.getItem(KEY)).toBe(v);
  });

  it('(-) the legacy single value is returned even when the move fails, and the legacy key is NOT deleted', async () => {
    const v = session('OLD', 1);
    await SecureStore.setItemAsync(SAFE, v);
    fake.__failWhen({ op: 'set' });

    expect(await authStorage.getItem(KEY)).toBe(v);
    fake.__clearFailures();
    expect(fake.__snapshot()[SAFE]).toBe(v);
    expect(fake.__snapshot()[`${SAFE}.__ptr`]).toBeUndefined();
  });

  it('(-) SecureStore and AsyncStorage both hold a session: the later expires_at wins', async () => {
    const stale = session('STALE', 1, { expires_at: 1_800_000_000 });
    const fresh = session('FRESH', 1, { expires_at: 1_800_003_600 });
    await SecureStore.setItemAsync(SAFE, stale);
    await AsyncStorage.setItem(KEY, fresh);

    expect(await authStorage.getItem(KEY)).toBe(fresh);
    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    crash();
    expect(await authStorage.getItem(KEY)).toBe(fresh);
  });

  it('(-) ... and when either one cannot be parsed, SecureStore wins', async () => {
    await SecureStore.setItemAsync(SAFE, 'not-json');
    await AsyncStorage.setItem(KEY, session('FRESH', 1));
    expect(await authStorage.getItem(KEY)).toBe('not-json');
  });
});

describe('removeItem', () => {
  it('(-) the pointer cannot be deleted: it throws AuthStorageWriteError, the session reads as gone, and the retry finishes the delete', async () => {
    await authStorage.setItem(KEY, session('A', 3));
    fake.__failWhen({ op: 'delete', match: (k) => k.endsWith('.__ptr') });

    let thrown: unknown = null;
    await authStorage.removeItem(KEY).catch((e: unknown) => { thrown = e; });
    expect(f06.AuthStorageWriteError).toBeDefined();
    expect(thrown).toBeInstanceOf(f06.AuthStorageWriteError!);
    expect((thrown as { op?: string }).op).toBe('remove');

    expect(await authStorage.getItem(KEY)).toBeNull(); // tombstone, even though the pointer is still there
    fake.__clearFailures();
    expect(await authStorage.getItem(KEY)).toBeNull();
    expect(fake.__snapshot()[`${SAFE}.__ptr`]).toBeUndefined();
    expect(partKeys()).toEqual([]);
  });

  it('a pending (unwritten) value is dropped by removeItem and never written afterwards', async () => {
    fake.__failWhen({ op: 'set' });
    await authStorage.setItem(KEY, session('B', 1));
    fake.__clearFailures();
    await authStorage.removeItem(KEY);
    await flushPending();
    expect(await authStorage.getItem(KEY)).toBeNull();
    expect(fake.__snapshot()[`${SAFE}.__ptr`]).toBeUndefined();
  });
});

describe('platforms and helpers', () => {
  it('(-) web never touches SecureStore', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    await authStorage.setItem(KEY, 'web-session');
    expect(await authStorage.getItem(KEY)).toBe('web-session');
    await authStorage.removeItem(KEY);
    expect(await authStorage.getItem(KEY)).toBeNull();
    expect(setItemAsync).not.toHaveBeenCalled();
    expect(getItemAsync).not.toHaveBeenCalled();
    expect(deleteItemAsync).not.toHaveBeenCalled();
  });

  it('checksum is FNV-1a 32-bit over UTF-16 code units, eight hex digits', () => {
    expect(f06.checksum).toBeDefined();
    const sum = f06.checksum!;
    expect(sum('')).toBe('811c9dc5');
    expect(sum('a')).toBe('e40c292c');
    expect(sum('foobar')).toBe('bf9cf968');
    expect(sum('ğ')).toMatch(/^[0-9a-f]{8}$/);
    expect(sum('ab')).not.toBe(sum('ba'));
  });
});
