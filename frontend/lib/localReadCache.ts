// WEB CONTRACT (F49 / GAP2-12): imported in the web bundle; SQLite is reached solely via lib/sqliteDriver.ts (returns null on web) and native branches stay behind isNativePlatform() / Platform.OS !== 'web' (proven by webBundleImports.test.ts and sqliteWebBoundary.test.ts).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
// expo-sqlite is reached only through the platform seam: importing it here
// put its wasm worker into the web bundle and broke `expo export --platform web`.
import { loadSqlite, type SQLiteDatabase } from './sqliteDriver';

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

export type PruneOptions = {
  maxAgeMs: number;
  keepLatestPerPrefix?: Record<string, number>;
};

export const READ_CACHE_MEMORY_MAX = 200;

const DB_NAME = 'aderyth_read_cache.db';
const WEB_PREFIX = 'aderyth.rcache.v1';

const memoryCache = new Map<string, { payload: string; updatedAt: number }>();
let dbPromise: Promise<SQLiteDatabase> | null = null;

function rememberInMemory(key: string, entry: { payload: string; updatedAt: number }): void {
  memoryCache.delete(key);
  memoryCache.set(key, entry);
  if (memoryCache.size > READ_CACHE_MEMORY_MAX) {
    memoryCache.delete(memoryCache.keys().next().value as string);
  }
}

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

async function getDb(): Promise<SQLiteDatabase> {
  if (!isNativePlatform()) throw new Error('read_cache_sqlite_native_only');
  if (!dbPromise) {
    dbPromise = (async () => {
      const sqlite = loadSqlite();
      if (!sqlite) throw new Error('expo-sqlite is not available on this platform');
      const db = await sqlite.openDatabaseAsync(DB_NAME);
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
      rememberInMemory(mk, { payload: row.payload, updatedAt: row.updated_at });
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
    rememberInMemory(mk, { payload: envelope.payload, updatedAt });
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
  rememberInMemory(memKey(userId, cacheKey), { payload: serialized, updatedAt });

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

/**
 * F04 (SYN-07): every user's snapshots, for an account deletion. `clearUserReadCache` wipes one
 * user; a deletion also sweeps what earlier accounts on this device left behind, so the promise
 * "this device forgets" holds for the read cache too (note bodies, task titles, habit names).
 */
export async function clearAllReadCache(): Promise<void> {
  memoryCache.clear();

  if (isWebSsr()) return;

  if (isNativePlatform()) {
    try {
      const db = await getDb();
      await db.execAsync('DELETE FROM read_cache;');
    } catch {
      // ignore
    }
  }

  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const matching = allKeys.filter((k) => k.startsWith(`${WEB_PREFIX}:`));
    if (matching.length > 0) {
      await AsyncStorage.multiRemove(matching);
    }
  } catch {
    // ignore
  }
}

export const readCachedSnapshot = getCachedSnapshot;

export async function pruneReadCache(
  userId: string | null | undefined,
  opts: PruneOptions,
): Promise<number> {
  if (!userId || isWebSsr()) return 0;
  const cutoff = Date.now() - opts.maxAgeMs;
  let removed = 0;

  if (isNativePlatform()) {
    try {
      const db = await getDb();
      removed += (
        await db.runAsync('DELETE FROM read_cache WHERE updated_at < ? AND user_id = ?', [cutoff, userId])
      ).changes;
      for (const [prefix, keep] of Object.entries(opts.keepLatestPerPrefix ?? {})) {
        removed += (
          await db.runAsync(
            'DELETE FROM read_cache WHERE substr(cache_key, 1, ?) = ? AND user_id = ? AND cache_key NOT IN ' +
              '(SELECT cache_key FROM read_cache WHERE user_id = ? AND substr(cache_key, 1, ?) = ? ORDER BY updated_at DESC LIMIT ?)',
            [prefix.length, prefix, userId, userId, prefix.length, prefix, keep],
          )
        ).changes;
      }
    } catch {
      /* best effort */
    }
  }

  // L1 memoryCache pruning for this user
  const memPrefix = `${userId}::`;
  for (const [mk, entry] of memoryCache.entries()) {
    if (mk.startsWith(memPrefix) && entry.updatedAt < cutoff) {
      memoryCache.delete(mk);
    }
  }
  for (const [prefix, keep] of Object.entries(opts.keepLatestPerPrefix ?? {})) {
    const fullMemPrefix = `${userId}::${prefix}`;
    const matchingMem = [...memoryCache.entries()]
      .filter(([mk]) => mk.startsWith(fullMemPrefix))
      .sort((a, b) => b[1].updatedAt - a[1].updatedAt);
    for (const [mk] of matchingMem.slice(keep)) {
      memoryCache.delete(mk);
    }
  }

  // AsyncStorage fallback / web pruning
  try {
    const userPrefix = webKey(userId, '');
    const allKeys = await AsyncStorage.getAllKeys();
    const matching = allKeys.filter((k) => k.startsWith(userPrefix));
    if (matching.length > 0) {
      const pairs = await AsyncStorage.multiGet(matching);
      const toRemove = new Set<string>();
      const valid: { fullKey: string; cacheKey: string; updatedAt: number }[] = [];

      for (const [fullKey, raw] of pairs) {
        const cacheKey = fullKey.slice(userPrefix.length);
        if (!raw) {
          toRemove.add(fullKey);
          memoryCache.delete(memKey(userId, cacheKey));
          continue;
        }
        try {
          const parsed = JSON.parse(raw) as { payload?: unknown; updatedAt?: unknown };
          if (
            typeof parsed?.payload !== 'string' ||
            typeof parsed.updatedAt !== 'number' ||
            parsed.updatedAt < cutoff
          ) {
            toRemove.add(fullKey);
            memoryCache.delete(memKey(userId, cacheKey));
          } else {
            valid.push({ fullKey, cacheKey, updatedAt: parsed.updatedAt });
          }
        } catch {
          toRemove.add(fullKey);
          memoryCache.delete(memKey(userId, cacheKey));
        }
      }

      for (const [prefix, keep] of Object.entries(opts.keepLatestPerPrefix ?? {})) {
        const byPrefix = valid
          .filter((e) => e.cacheKey.startsWith(prefix))
          .sort((a, b) => b.updatedAt - a.updatedAt);
        for (const excess of byPrefix.slice(keep)) {
          toRemove.add(excess.fullKey);
          memoryCache.delete(memKey(userId, excess.cacheKey));
        }
      }

      if (toRemove.size > 0) {
        await AsyncStorage.multiRemove([...toRemove]);
        if (!isNativePlatform()) removed += toRemove.size;
      }
    }
  } catch {
    /* best effort */
  }

  return removed;
}

export async function getLatestSnapshot<T>(
  userId: string | null | undefined,
  keyPrefix: string,
): Promise<(CachedSnapshot<T> & { key: string }) | null> {
  if (!userId || !keyPrefix || isWebSsr()) return null;

  if (isNativePlatform()) {
    try {
      const db = await getDb();
      const row = await db.getFirstAsync<{ cache_key: string; payload: string; updated_at: number }>(
        'SELECT cache_key, payload, updated_at FROM read_cache WHERE user_id = ? AND substr(cache_key, 1, ?) = ? ORDER BY updated_at DESC LIMIT 1',
        [userId, keyPrefix.length, keyPrefix],
      );
      if (row) {
        return { key: row.cache_key, data: JSON.parse(row.payload) as T, updatedAt: row.updated_at };
      }
    } catch {
      /* fall through to AsyncStorage */
    }
  }

  try {
    const userPrefix = webKey(userId, '');
    const fullPrefix = webKey(userId, keyPrefix);
    const allKeys = await AsyncStorage.getAllKeys();
    const matching = allKeys.filter((k) => k.startsWith(fullPrefix));
    if (matching.length === 0) return null;

    const pairs = await AsyncStorage.multiGet(matching);
    let best: { key: string; payload: string; updatedAt: number } | null = null;
    for (const [fullKey, raw] of pairs) {
      if (!raw) continue;
      try {
        const parsed = JSON.parse(raw) as { payload?: unknown; updatedAt?: unknown };
        if (typeof parsed?.payload !== 'string') continue;
        const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0;
        if (!best || updatedAt > best.updatedAt) {
          best = { key: fullKey.slice(userPrefix.length), payload: parsed.payload, updatedAt };
        }
      } catch {
        // skip unreadable entry
      }
    }
    if (!best) return null;
    return { key: best.key, data: JSON.parse(best.payload) as T, updatedAt: best.updatedAt };
  } catch {
    return null;
  }
}

/**
 * Synchronous L1 memory reset called on `SIGNED_OUT` / account boundary transitions. The open
 * database handle is closed rather than only forgotten, so a reset does not leak a connection.
 */
export function clearReadCacheMemory(): void {
  memoryCache.clear();
  const p = dbPromise;
  dbPromise = null;
  void p?.then((db) => db.closeAsync()).catch(() => undefined);
}
