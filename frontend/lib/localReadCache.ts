import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

/**
 * Local-First Read-Through Snapshot Cache (Stale-While-Revalidate).
 *
 * Architecture:
 * - L1: Fast per-session in-memory cache (`userId::cacheKey`) cleared on sign-out.
 * - L2 (iOS/Android): `expo-sqlite` (`aderyth_read_cache.db`, table `read_cache`)
 *   indexed by `(user_id, cache_key)` so collection payloads do not bloat or
 *   contend with AsyncStorage JSON serialization.
 * - L2 (Web / fallback): Account-scoped `AsyncStorage` (`aderyth.rcache.v1:<userId>:<key>`).
 *
 * Multi-tenant safety:
 * - Every read, write, and invalidation requires an explicit non-empty `userId`.
 * - User A can never observe or overwrite User B's cached snapshot.
 */

export type CachedSnapshot<T> = {
  data: T;
  updatedAt: number;
};

const DB_NAME = 'aderyth_read_cache.db';
const WEB_PREFIX = 'aderyth.rcache.v1';

const memoryCache = new Map<string, { payload: string; updatedAt: number }>();
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function isNativePlatform(): boolean {
  return Platform.OS === 'ios' || Platform.OS === 'android';
}

function isWebSsr(): boolean {
  return Platform.OS === 'web' && typeof window === 'undefined';
}

function memKey(userId: string, cacheKey: string): string {
  return `${userId}::${cacheKey}`;
}

function webKey(userId: string, cacheKey: string): string {
  return `${WEB_PREFIX}:${userId}:${cacheKey}`;
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync(DB_NAME);
      await db.execAsync(
        'CREATE TABLE IF NOT EXISTS read_cache (user_id TEXT NOT NULL, cache_key TEXT NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (user_id, cache_key));',
      );
      return db;
    })().catch((err) => {
      dbPromise = null;
      throw err;
    });
  }
  return dbPromise;
}

export async function getCachedSnapshot<T>(
  userId: string | null | undefined,
  cacheKey: string,
): Promise<CachedSnapshot<T> | null> {
  if (!userId || !cacheKey || isWebSsr()) return null;

  const mk = memKey(userId, cacheKey);
  const hit = memoryCache.get(mk);
  if (hit) {
    try {
      return { data: JSON.parse(hit.payload) as T, updatedAt: hit.updatedAt };
    } catch {
      memoryCache.delete(mk);
    }
  }

  if (isNativePlatform()) {
    try {
      const db = await getDb();
      const row = await db.getFirstAsync<{ payload: string; updated_at: number }>(
        'SELECT payload, updated_at FROM read_cache WHERE user_id = ? AND cache_key = ?',
        [userId, cacheKey],
      );
      if (!row) return null;
      const parsed = JSON.parse(row.payload) as T;
      memoryCache.set(mk, { payload: row.payload, updatedAt: row.updated_at });
      return { data: parsed, updatedAt: row.updated_at };
    } catch {
      // Fall through to AsyncStorage fallback if native SQLite is unavailable
    }
  }

  try {
    const raw = await AsyncStorage.getItem(webKey(userId, cacheKey));
    if (!raw) return null;
    const envelope = JSON.parse(raw) as { payload: string; updatedAt: number };
    if (typeof envelope?.payload !== 'string') return null;
    const data = JSON.parse(envelope.payload) as T;
    const updatedAt = typeof envelope.updatedAt === 'number' ? envelope.updatedAt : 0;
    memoryCache.set(mk, { payload: envelope.payload, updatedAt });
    return { data, updatedAt };
  } catch {
    return null;
  }
}

export async function setCachedSnapshot<T>(
  userId: string | null | undefined,
  cacheKey: string,
  data: T,
): Promise<void> {
  if (!userId || !cacheKey || isWebSsr()) return;

  let serialized: string;
  try {
    serialized = JSON.stringify(data);
  } catch {
    return;
  }

  const updatedAt = Date.now();
  memoryCache.set(memKey(userId, cacheKey), { payload: serialized, updatedAt });

  if (isNativePlatform()) {
    try {
      const db = await getDb();
      await db.runAsync(
        'INSERT OR REPLACE INTO read_cache (user_id, cache_key, payload, updated_at) VALUES (?, ?, ?, ?)',
        [userId, cacheKey, serialized, updatedAt],
      );
      return;
    } catch {
      // Fall through to AsyncStorage fallback
    }
  }

  try {
    await AsyncStorage.setItem(
      webKey(userId, cacheKey),
      JSON.stringify({ payload: serialized, updatedAt }),
    );
  } catch {
    // Cache writes are best-effort and never block UI
  }
}

export async function invalidateCachedSnapshot(
  userId: string | null | undefined,
  cacheKey: string,
): Promise<void> {
  if (!userId || !cacheKey || isWebSsr()) return;

  memoryCache.delete(memKey(userId, cacheKey));

  if (isNativePlatform()) {
    try {
      const db = await getDb();
      await db.runAsync('DELETE FROM read_cache WHERE user_id = ? AND cache_key = ?', [
        userId,
        cacheKey,
      ]);
    } catch {
      // ignore
    }
  }

  await AsyncStorage.removeItem(webKey(userId, cacheKey)).catch(() => undefined);
}

export async function clearUserReadCache(userId: string | null | undefined): Promise<void> {
  if (!userId) return;

  const prefix = `${userId}::`;
  for (const k of memoryCache.keys()) {
    if (k.startsWith(prefix)) memoryCache.delete(k);
  }

  if (isWebSsr()) return;

  if (isNativePlatform()) {
    try {
      const db = await getDb();
      await db.runAsync('DELETE FROM read_cache WHERE user_id = ?', [userId]);
    } catch {
      // ignore
    }
  }

  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const userPrefix = `${WEB_PREFIX}:${userId}:`;
    const matching = allKeys.filter((k) => k.startsWith(userPrefix));
    if (matching.length > 0) {
      await AsyncStorage.multiRemove(matching);
    }
  } catch {
    // ignore
  }
}

export const readCachedSnapshot = getCachedSnapshot;

/** Synchronous L1 memory reset called on `SIGNED_OUT` / account boundary transitions. */
export function clearReadCacheMemory(): void {
  memoryCache.clear();
  dbPromise = null;
}
