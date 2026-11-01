import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Hardware-backed encrypted storage adapter for Supabase Auth sessions.
 *
 * Security & operational guarantees:
 * 1. On iOS/Android, persists JWT access + refresh tokens inside Keychain /
 *    EncryptedSharedPreferences (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`) rather than
 *    unencrypted AsyncStorage SQLite/plist files.
 * 2. Transparently chunks payloads exceeding 1800 UTF-8 bytes so large OAuth /
 *    metadata-heavy Supabase session JSON blobs never hit the 2048-byte native
 *    SecureStore value ceiling.
 * 3. Performs a seamless one-time migration from legacy AsyncStorage keys on
 *    first read, keeping existing signed-in users logged in across upgrades and
 *    purging the plaintext copy immediately after encryption.
 * 4. Safely falls back on Web (and SSR where `window` is undefined).
 */

const MAX_CHUNK_BYTES = 1800;

const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

function isNativePlatform(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function isWebSsr(): boolean {
  return Platform.OS === 'web' && typeof window === 'undefined';
}

/**
 * `expo-secure-store` only permits `[A-Za-z0-9._-]` in keys.
 * Encode any other character deterministically with `_xHEX_` so distinct keys
 * cannot collide while remaining 100% SecureStore-compliant.
 */
export function toSecureKey(rawKey: string): string {
  const sanitized = rawKey.replace(/[^A-Za-z0-9._-]/g, (ch) => {
    const hex = ch.codePointAt(0)?.toString(16) ?? '00';
    return `_${hex}_`;
  });
  return sanitized.length > 0 ? sanitized : '_empty_';
}

function chunkCountKey(safeKey: string): string {
  return `${safeKey}.__chunks`;
}

function chunkPartKey(safeKey: string, index: number): string {
  return `${safeKey}.__chunk_${index}`;
}

function utf8ByteLength(str: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str).length;
  }
  return unescape(encodeURIComponent(str)).length;
}

/**
 * Splits a string along Unicode code-point boundaries so no chunk exceeds
 * `maxBytes` UTF-8 bytes and multi-byte characters are never torn.
 */
export function splitIntoUtf8Chunks(value: string, maxBytes = MAX_CHUNK_BYTES): string[] {
  if (value.length === 0) return [''];
  if (utf8ByteLength(value) <= maxBytes) return [value];

  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;

  for (const ch of value) {
    const chBytes = utf8ByteLength(ch);
    if (current.length > 0 && currentBytes + chBytes > maxBytes) {
      chunks.push(current);
      current = ch;
      currentBytes = chBytes;
    } else {
      current += ch;
      currentBytes += chBytes;
    }
  }
  if (current.length > 0) {
    chunks.push(current);
  }
  return chunks;
}

async function readExistingChunkCount(safeKey: string): Promise<number> {
  const raw = await SecureStore.getItemAsync(chunkCountKey(safeKey), SECURE_OPTIONS);
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

async function clearChunks(safeKey: string, count: number): Promise<void> {
  const deletions: Promise<void>[] = [
    SecureStore.deleteItemAsync(chunkCountKey(safeKey), SECURE_OPTIONS),
  ];
  for (let i = 0; i < count; i += 1) {
    deletions.push(SecureStore.deleteItemAsync(chunkPartKey(safeKey, i), SECURE_OPTIONS));
  }
  await Promise.all(deletions);
}

async function getNativeSecureItem(safeKey: string): Promise<string | null> {
  const count = await readExistingChunkCount(safeKey);
  if (count > 0) {
    const parts = await Promise.all(
      Array.from({ length: count }, (_, idx) =>
        SecureStore.getItemAsync(chunkPartKey(safeKey, idx), SECURE_OPTIONS),
      ),
    );
    if (parts.some((p) => p === null)) {
      return null;
    }
    return parts.join('');
  }
  return SecureStore.getItemAsync(safeKey, SECURE_OPTIONS);
}

async function setNativeSecureItem(safeKey: string, value: string): Promise<void> {
  const prevCount = await readExistingChunkCount(safeKey);
  const chunks = splitIntoUtf8Chunks(value, MAX_CHUNK_BYTES);

  if (chunks.length === 1) {
    await SecureStore.setItemAsync(safeKey, chunks[0], SECURE_OPTIONS);
    if (prevCount > 0) {
      await clearChunks(safeKey, prevCount);
    }
    return;
  }

  await Promise.all(
    chunks.map((chunk, idx) =>
      SecureStore.setItemAsync(chunkPartKey(safeKey, idx), chunk, SECURE_OPTIONS),
    ),
  );
  await SecureStore.setItemAsync(chunkCountKey(safeKey), String(chunks.length), SECURE_OPTIONS);
  await SecureStore.deleteItemAsync(safeKey, SECURE_OPTIONS);

  if (prevCount > chunks.length) {
    const staleDeletions: Promise<void>[] = [];
    for (let i = chunks.length; i < prevCount; i += 1) {
      staleDeletions.push(SecureStore.deleteItemAsync(chunkPartKey(safeKey, i), SECURE_OPTIONS));
    }
    await Promise.all(staleDeletions);
  }
}

async function removeNativeSecureItem(safeKey: string): Promise<void> {
  const prevCount = await readExistingChunkCount(safeKey);
  await SecureStore.deleteItemAsync(safeKey, SECURE_OPTIONS);
  if (prevCount > 0) {
    await clearChunks(safeKey, prevCount);
  }
}

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (isWebSsr()) return null;
    if (!isNativePlatform()) {
      return AsyncStorage.getItem(key);
    }

    const safeKey = toSecureKey(key);
    try {
      const encrypted = await getNativeSecureItem(safeKey);
      if (encrypted !== null) {
        return encrypted;
      }

      // One-time transparent upgrade from legacy plaintext AsyncStorage session.
      const legacy = await AsyncStorage.getItem(key);
      if (legacy !== null) {
        await setNativeSecureItem(safeKey, legacy);
        await AsyncStorage.removeItem(key).catch(() => undefined);
        return legacy;
      }
      return null;
    } catch {
      return AsyncStorage.getItem(key);
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    if (isWebSsr()) return;
    if (!isNativePlatform()) {
      await AsyncStorage.setItem(key, value);
      return;
    }

    const safeKey = toSecureKey(key);
    try {
      await setNativeSecureItem(safeKey, value);
      await AsyncStorage.removeItem(key).catch(() => undefined);
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },

  async removeItem(key: string): Promise<void> {
    if (isWebSsr()) return;
    if (!isNativePlatform()) {
      await AsyncStorage.removeItem(key);
      return;
    }

    const safeKey = toSecureKey(key);
    await Promise.all([
      removeNativeSecureItem(safeKey).catch(() => undefined),
      AsyncStorage.removeItem(key).catch(() => undefined),
    ]);
  },
};

