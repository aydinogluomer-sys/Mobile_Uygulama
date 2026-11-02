import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { __resetAuthStorageForTests, authStorage, splitIntoUtf8Chunks, toSecureKey } from '../../lib/authStorage';

// F06 (SYN-09): the expectations follow the atomic schema -- a pointer (`<key>.__ptr`) written last,
// the parts of a generation (`<key>.__g<N>_<i>`), the previous generation kept as a fallback. The
// failure cases live in authStorageFailure.test.ts.
const snapshot = (): Record<string, string> =>
  (SecureStore as unknown as { __snapshot: () => Record<string, string> }).__snapshot();
const utf8 = (s: string): number => Buffer.byteLength(s, 'utf8');

describe('authStorage (hardware-backed SecureStore adapter)', () => {
  const originalOS = Platform.OS;

  beforeEach(async () => {
    __resetAuthStorageForTests();
    await AsyncStorage.clear();
    (SecureStore as unknown as { __resetForTests: () => void }).__resetForTests();
    jest.clearAllMocks();
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
  });

  afterAll(() => {
    Object.defineProperty(Platform, 'OS', { value: originalOS, configurable: true });
  });

  it('stores and retrieves compact session tokens in SecureStore with device-only accessibility', async () => {
    const key = 'sb-kbcuolhjjnmhjaarxxmu-auth-token';
    const session = JSON.stringify({ access_token: 'jwt-123', refresh_token: 'ref-456' });

    await authStorage.setItem(key, session);

    const calls = (SecureStore.setItemAsync as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const [, value, options] of calls) {
      expect(options).toEqual(expect.objectContaining({
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }));
      expect(utf8(String(value))).toBeLessThanOrEqual(2048);
    }
    expect(await SecureStore.getItemAsync(`${key}.__ptr`)).not.toBeNull();
    expect(await AsyncStorage.getItem(key)).toBeNull();
    expect(await authStorage.getItem(key)).toBe(session);
  });

  it('transparently chunks and reassembles large (>4 KB) UTF-8 session payloads and cleans up older generations', async () => {
    const key = 'sb-http://127.0.0.1:54321-auth-token';
    const largeMetadata = 'ğüşöçıİ-'.repeat(600); // > 7 KB multi-byte UTF-8
    const largeSession = JSON.stringify({
      access_token: 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(1600),
      refresh_token: 'refresh_' + 'b'.repeat(900),
      user_metadata: { note: largeMetadata },
    });

    const chunks = splitIntoUtf8Chunks(largeSession);
    expect(chunks.length).toBeGreaterThanOrEqual(4);

    await authStorage.setItem(key, largeSession);
    expect(await authStorage.getItem(key)).toBe(largeSession);

    // Shrink twice: the large generation (g1) is first kept as the fallback, then purged.
    const compact = JSON.stringify({ access_token: 'short' });
    await authStorage.setItem(key, compact);
    expect(await authStorage.getItem(key)).toBe(compact);
    const compact2 = JSON.stringify({ access_token: 'shorter' });
    await authStorage.setItem(key, compact2);
    expect(await authStorage.getItem(key)).toBe(compact2);

    const safeKey = toSecureKey(key);
    const stored = Object.keys(snapshot()).sort();
    expect(stored.filter((k) => k.startsWith(`${safeKey}.__g1_`))).toEqual([]);
    // only the current generation, the previous one and the pointer remain; the old schema is never written
    expect(stored).toEqual([`${safeKey}.__g2_0`, `${safeKey}.__g3_0`, `${safeKey}.__ptr`].sort());
    expect(await SecureStore.getItemAsync(`${safeKey}.__chunks`)).toBeNull();
    expect(await SecureStore.getItemAsync(`${safeKey}.__chunk_0`)).toBeNull();
  });

  it('migrates legacy plaintext AsyncStorage sessions into SecureStore on first read and deletes plaintext copy', async () => {
    const key = 'sb-kbcuolhjjnmhjaarxxmu-auth-token';
    const legacyPayload = JSON.stringify({ access_token: 'legacy-jwt', refresh_token: 'legacy-ref' });
    await AsyncStorage.setItem(key, legacyPayload);

    const read1 = await authStorage.getItem(key);
    expect(read1).toBe(legacyPayload);

    // Plaintext copy in AsyncStorage must now be gone, and SecureStore holds it.
    expect(await AsyncStorage.getItem(key)).toBeNull();
    expect(await SecureStore.getItemAsync(`${key}.__ptr`)).not.toBeNull();
    __resetAuthStorageForTests(); // a new process reads it from SecureStore
    expect(await authStorage.getItem(key)).toBe(legacyPayload);
  });

  it('removes the pointer, every generation and any residual AsyncStorage entry on removeItem', async () => {
    const key = 'sb-kbcuolhjjnmhjaarxxmu-auth-token';
    const big = 'x'.repeat(4200);
    await authStorage.setItem(key, big);
    await authStorage.setItem(key, big + 'y'); // two generations on disk
    await AsyncStorage.setItem(key, 'stale');

    await authStorage.removeItem(key);

    expect(await authStorage.getItem(key)).toBeNull();
    expect(await AsyncStorage.getItem(key)).toBeNull();
    const left = Object.keys(snapshot());
    expect(left.filter((k) => k === `${key}.__ptr` || k.startsWith(`${key}.__g`))).toEqual([]);
  });

  it('delegates to AsyncStorage on web without touching SecureStore', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const key = 'sb-web-auth-token';
    await authStorage.setItem(key, 'web-session');

    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
    expect(await authStorage.getItem(key)).toBe('web-session');

    await authStorage.removeItem(key);
    expect(await authStorage.getItem(key)).toBeNull();
  });
});
