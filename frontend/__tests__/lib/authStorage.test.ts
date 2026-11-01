import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { authStorage, splitIntoUtf8Chunks, toSecureKey } from '../../lib/authStorage';

describe('authStorage (hardware-backed SecureStore adapter)', () => {
  const originalOS = Platform.OS;

  beforeEach(async () => {
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

    expect(SecureStore.setItemAsync).toHaveBeenCalledWith(
      key,
      session,
      expect.objectContaining({
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      }),
    );
    expect(await AsyncStorage.getItem(key)).toBeNull();
    expect(await authStorage.getItem(key)).toBe(session);
  });

  it('transparently chunks and reassembles large (>4 KB) UTF-8 session payloads and cleans up trailing chunks on shrink', async () => {
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

    // Overwrite with compact payload -> all previous chunk keys must be purged.
    const compact = JSON.stringify({ access_token: 'short' });
    await authStorage.setItem(key, compact);
    expect(await authStorage.getItem(key)).toBe(compact);

    const safeKey = toSecureKey(key);
    expect(await SecureStore.getItemAsync(`${safeKey}.__chunks`)).toBeNull();
    expect(await SecureStore.getItemAsync(`${safeKey}.__chunk_0`)).toBeNull();
    expect(await SecureStore.getItemAsync(`${safeKey}.__chunk_3`)).toBeNull();
  });

  it('migrates legacy plaintext AsyncStorage sessions into SecureStore on first read and deletes plaintext copy', async () => {
    const key = 'sb-kbcuolhjjnmhjaarxxmu-auth-token';
    const legacyPayload = JSON.stringify({ access_token: 'legacy-jwt', refresh_token: 'legacy-ref' });
    await AsyncStorage.setItem(key, legacyPayload);

    const read1 = await authStorage.getItem(key);
    expect(read1).toBe(legacyPayload);

    // Plaintext copy in AsyncStorage must now be gone, and SecureStore holds it.
    expect(await AsyncStorage.getItem(key)).toBeNull();
    expect(await SecureStore.getItemAsync(key)).toBe(legacyPayload);
  });

  it('removes both single/chunked SecureStore entries and any residual AsyncStorage entry on removeItem', async () => {
    const key = 'sb-kbcuolhjjnmhjaarxxmu-auth-token';
    const big = 'x'.repeat(4200);
    await authStorage.setItem(key, big);
    await AsyncStorage.setItem(key, 'stale');

    await authStorage.removeItem(key);

    expect(await authStorage.getItem(key)).toBeNull();
    expect(await AsyncStorage.getItem(key)).toBeNull();
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

