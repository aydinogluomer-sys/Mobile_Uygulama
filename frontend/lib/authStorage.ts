import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { reportError } from './crashReporting';

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
 *    purging the plaintext copy once the encrypted copy is written.
 * 4. Safely falls back on Web (and SSR where `window` is undefined).
 *
 * ## F06 (SYN-09): a write is atomic, a failure never becomes plain text
 *
 * Before F06 the parts of a value were written in parallel and a part counter after them: a write
 * that died half way left old and new parts under one counter, and a read joined them. A refused
 * write fell back to PLAIN TEXT AsyncStorage, a read error read that copy, and a later read
 * preferred the stale SecureStore value over it.
 *
 * Now, per key (`safeKey` below):
 *
 *   `${safeKey}.__ptr`         {"v":2,"gen":N,"count":K,"sum":"<fnv1a>","prev":{gen,count,sum}|null}
 *   `${safeKey}.__g${N}_${i}`   the parts of generation N, written ONE BY ONE
 *   `${safeKey}.__pending`     "<gen>:<count>" of a write in progress (a journal)
 *
 * The pointer is written last; that single write is the commit point. A read checks the part count
 * and the checksum and falls back to the previous generation, so a torn or tampered write is never
 * returned. The journal lets the next write remove the parts of a write that never committed.
 * Writes to one key run one at a time.
 *
 * A write SecureStore refuses is NOT written anywhere else: the value stays in memory (served by
 * `getItem`), is reported (the error, never the value), and is retried on the next read or write
 * and when the app comes to the foreground (`flushPendingAuthStorage`, wired in app/_layout.tsx).
 * Trade-off, chosen on purpose: if the process dies before the retry, a rotated refresh token is
 * lost and the user may have to sign in again; that is better than a token on disk in plain text.
 *
 * A delete removes the pointer first (the session is gone at that instant) and the parts after it.
 * If the pointer cannot be removed, `removeItem` throws `AuthStorageWriteError('remove')` so the
 * caller (auth-js, the sign-out service) sees it, and a tombstone keeps the session from coming
 * back until the delete succeeds.
 *
 * The schema before F06 (`${safeKey}` alone, or `${safeKey}.__chunks` + `.__chunk_${i}`) is still
 * read and moved to the new one; this module never writes it.
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

/** FNV-1a, 32 bit, over UTF-16 code units; eight lowercase hex digits. Detects a torn or edited value. */
export function checksum(value: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A SecureStore write or delete that did not happen. `op: 'remove'` is the only one that is thrown. */
export class AuthStorageWriteError extends Error {
  readonly op: 'set' | 'remove';

  constructor(op: 'set' | 'remove', cause?: unknown) {
    super(`authStorage ${op} failed${cause instanceof Error ? `: ${cause.message}` : ''}`);
    this.name = 'AuthStorageWriteError';
    this.op = op;
    Object.setPrototypeOf(this, AuthStorageWriteError.prototype);
  }
}

// ---------------------------------------------------------------------------
// keys
// ---------------------------------------------------------------------------

type Generation = { gen: number; count: number; sum: string };
type Pointer = { v: 2 } & Generation & { prev: Generation | null };

const pointerKey = (safeKey: string): string => `${safeKey}.__ptr`;
const partKey = (safeKey: string, gen: number, index: number): string => `${safeKey}.__g${gen}_${index}`;
const journalKey = (safeKey: string): string => `${safeKey}.__pending`;
const legacyCountKey = (safeKey: string): string => `${safeKey}.__chunks`;
const legacyPartKey = (safeKey: string, index: number): string => `${safeKey}.__chunk_${index}`;

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0 && n < 1000;
const isGen = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0;

function parseGeneration(x: unknown): Generation | null {
  if (!x || typeof x !== 'object') return null;
  const g = x as Record<string, unknown>;
  if (!isGen(g.gen) || !isCount(g.count) || typeof g.sum !== 'string') return null;
  return { gen: g.gen, count: g.count, sum: g.sum };
}

function parsePointer(raw: string | null): Pointer | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    if (p?.v !== 2) return null;
    const cur = parseGeneration(p);
    if (!cur) return null;
    return { v: 2, ...cur, prev: parseGeneration(p.prev) };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// module state: one serial queue per key, values SecureStore refused, deletes not yet finished
// ---------------------------------------------------------------------------

const queues = new Map<string, Promise<unknown>>();
const pendingWrites = new Map<string, { key: string; value: string }>();
const tombstones = new Set<string>();

/** Runs `fn` after every earlier operation on the same key has settled. */
function serial<T>(safeKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(safeKey) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.then(() => undefined, () => undefined);
  queues.set(safeKey, tail);
  void tail.then(() => { if (queues.get(safeKey) === tail) queues.delete(safeKey); });
  return run;
}

/** For tests: what a new process sees (SecureStore keeps what was written, memory is gone). */
export function __resetAuthStorageForTests(): void {
  queues.clear();
  pendingWrites.clear();
  tombstones.clear();
}

const get = (k: string) => SecureStore.getItemAsync(k, SECURE_OPTIONS);
const put = (k: string, v: string) => SecureStore.setItemAsync(k, v, SECURE_OPTIONS);
const del = (k: string) => SecureStore.deleteItemAsync(k, SECURE_OPTIONS);
const delQuietly = async (k: string): Promise<void> => { try { await del(k); } catch { /* best effort */ } };

async function readPointer(safeKey: string): Promise<Pointer | null> {
  return parsePointer(await get(pointerKey(safeKey)));
}

async function readGeneration(safeKey: string, g: Generation): Promise<string | null> {
  // Reads may run in parallel; only writes have to be ordered.
  const parts = await Promise.all(Array.from({ length: g.count }, (_, i) => get(partKey(safeKey, g.gen, i))));
  if (parts.some((p) => p === null)) return null;
  const value = parts.join('');
  return checksum(value) === g.sum ? value : null;
}

async function deleteGeneration(safeKey: string, g: { gen: number; count: number }): Promise<void> {
  for (let i = 0; i < g.count; i += 1) await delQuietly(partKey(safeKey, g.gen, i));
}

/** The parts of a write that never reached its pointer, unless the pointer is (or was) that generation. */
async function cleanupJournal(safeKey: string, ptr: Pointer | null): Promise<number> {
  let raw: string | null = null;
  try { raw = await get(journalKey(safeKey)); } catch { return 0; }
  if (!raw) return 0;
  const m = /^(\d+):(\d+)$/.exec(raw);
  const gen = m ? Number(m[1]) : 0;
  const count = m ? Number(m[2]) : 0;
  if (isGen(gen) && isCount(count) && gen !== ptr?.gen && gen !== ptr?.prev?.gen) {
    await deleteGeneration(safeKey, { gen, count });
  }
  await delQuietly(journalKey(safeKey));
  return isGen(gen) ? gen : 0;
}

async function readLegacy(safeKey: string): Promise<string | null> {
  const countRaw = await get(legacyCountKey(safeKey));
  const count = countRaw ? Number.parseInt(countRaw, 10) : 0;
  if (Number.isFinite(count) && count > 0) {
    const parts: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const part = await get(legacyPartKey(safeKey, i));
      if (part === null) return null;
      parts.push(part);
    }
    return parts.join('');
  }
  return get(safeKey);
}

async function deleteLegacy(safeKey: string): Promise<void> {
  let count = 0;
  try {
    const raw = await get(legacyCountKey(safeKey));
    const n = raw ? Number.parseInt(raw, 10) : 0;
    count = Number.isFinite(n) && n > 0 ? n : 0;
  } catch { /* best effort */ }
  await delQuietly(safeKey);
  await delQuietly(legacyCountKey(safeKey));
  for (let i = 0; i < count; i += 1) await delQuietly(legacyPartKey(safeKey, i));
}

/**
 * Writes `value` as a new generation and flips the pointer to it. Throws if any write before the
 * pointer (the commit point) fails; the previous generation is then still the stored value.
 */
async function commit(safeKey: string, key: string, value: string): Promise<void> {
  const ptr = await readPointer(safeKey);
  const journalGen = await cleanupJournal(safeKey, ptr);
  const gen = Math.max(ptr?.gen ?? 0, journalGen) + 1;
  const parts = splitIntoUtf8Chunks(value, MAX_CHUNK_BYTES);
  const sum = checksum(value);

  await put(journalKey(safeKey), `${gen}:${parts.length}`);
  for (let i = 0; i < parts.length; i += 1) await put(partKey(safeKey, gen, i), parts[i]);
  const next: Pointer = {
    v: 2, gen, count: parts.length, sum,
    prev: ptr ? { gen: ptr.gen, count: ptr.count, sum: ptr.sum } : null,
  };
  await put(pointerKey(safeKey), JSON.stringify(next));

  // committed; everything below is best effort
  if (ptr?.prev && ptr.prev.gen !== gen) await deleteGeneration(safeKey, ptr.prev);
  await delQuietly(journalKey(safeKey));
  if (!ptr) await deleteLegacy(safeKey);
  await AsyncStorage.removeItem(key).catch(() => undefined);
}

/** Commits the pending value of `safeKey` if there is one. Never throws. */
async function tryFlush(safeKey: string): Promise<void> {
  const pending = pendingWrites.get(safeKey);
  if (!pending) return;
  try {
    await commit(safeKey, pending.key, pending.value);
    if (pendingWrites.get(safeKey) === pending) pendingWrites.delete(safeKey);
  } catch {
    // still pending; reported once when it was first refused
  }
}

/** Removes the stored session of `safeKey`. Throws `AuthStorageWriteError('remove')` if the pointer stays. */
async function deleteAll(safeKey: string, key: string): Promise<void> {
  let ptr: Pointer | null = null;
  try { ptr = await readPointer(safeKey); } catch { /* the pointer delete below decides */ }
  try {
    await del(pointerKey(safeKey));
  } catch (e) {
    throw new AuthStorageWriteError('remove', e);
  }
  // the session is gone; leftovers are no longer a session
  if (ptr) {
    await deleteGeneration(safeKey, ptr);
    if (ptr.prev) await deleteGeneration(safeKey, ptr.prev);
  }
  await cleanupJournal(safeKey, null);
  await deleteLegacy(safeKey);
  await AsyncStorage.removeItem(key).catch(() => undefined);
}

function sessionExpiry(raw: string): number | null {
  try {
    const v = JSON.parse(raw) as { expires_at?: unknown };
    return typeof v?.expires_at === 'number' && Number.isFinite(v.expires_at) ? v.expires_at : null;
  } catch {
    return null;
  }
}

/** Old builds could leave a session in both places; the one that expires later is the newer one. */
function pickNewer(secure: string | null, plain: string | null): string | null {
  if (secure === null) return plain;
  if (plain === null) return secure;
  const a = sessionExpiry(secure);
  const b = sessionExpiry(plain);
  if (a === null || b === null) return secure;
  return b > a ? plain : secure;
}

async function read(safeKey: string, key: string): Promise<string | null> {
  if (tombstones.has(safeKey)) {
    try {
      await deleteAll(safeKey, key);
      tombstones.delete(safeKey);
    } catch { /* still there: still reads as gone */ }
    return null;
  }

  const pending = pendingWrites.get(safeKey);
  if (pending) {
    await tryFlush(safeKey);
    return pending.value; // the newest value, written or not
  }

  try {
    const ptr = await readPointer(safeKey);
    if (ptr) {
      const current = await readGeneration(safeKey, ptr);
      if (current !== null) return current;
      return ptr.prev ? await readGeneration(safeKey, ptr.prev) : null;
    }

    // Nothing in the new schema: an older build's session, encrypted and/or plain text.
    const secure = await readLegacy(safeKey);
    const plain = await AsyncStorage.getItem(key).catch(() => null);
    const value = pickNewer(secure, plain);
    if (value === null) return null;
    try {
      // On success `commit` also removes the legacy keys and the plain-text copy; on failure both stay.
      await commit(safeKey, key, value);
    } catch {
      // the value is still returned; the old copies are read again next time
    }
    return value;
  } catch {
    // A SecureStore read error. Never the plain-text copy: null is safe for auth-js (it only
    // removes a session it can read and finds invalid).
    return null;
  }
}

/**
 * Retries every value SecureStore refused earlier. Never throws. Called when the app returns to
 * the foreground (app/_layout.tsx, through `bindAuthAutoRefresh`) and before every read and write.
 */
export async function flushPendingAuthStorage(): Promise<void> {
  if (!isNativePlatform()) return;
  await Promise.all([...pendingWrites.keys()].map((safeKey) => serial(safeKey, () => tryFlush(safeKey))));
}

export const authStorage = {
  async getItem(key: string): Promise<string | null> {
    if (isWebSsr()) return null;
    if (!isNativePlatform()) {
      return AsyncStorage.getItem(key);
    }
    const safeKey = toSecureKey(key);
    // Fast path, outside the write queue: nothing of ours is in flight for this key (a write or
    // delete registers itself synchronously, before its first await), so the pointer and the
    // generation it names are a committed value. auth-js reads the session on every getSession().
    if (!pendingWrites.has(safeKey) && !tombstones.has(safeKey)) {
      try {
        const ptr = await readPointer(safeKey);
        if (ptr) {
          const current = await readGeneration(safeKey, ptr);
          if (current !== null) return current;
        }
      } catch {
        return null; // a SecureStore read error: never the plain-text copy
      }
    }
    // Anything else (a pending value, a tombstone, a torn generation, the old schema) is decided in order.
    return serial(safeKey, () => read(safeKey, key));
  },

  async setItem(key: string, value: string): Promise<void> {
    if (isWebSsr()) return;
    if (!isNativePlatform()) {
      await AsyncStorage.setItem(key, value);
      return;
    }

    const safeKey = toSecureKey(key);
    // A new value supersedes an unwritten one and ends an unfinished delete (it overwrites the pointer).
    tombstones.delete(safeKey);
    const entry = { key, value };
    pendingWrites.set(safeKey, entry);
    await serial(safeKey, async () => {
      if (pendingWrites.get(safeKey) !== entry) return; // a later setItem or removeItem took over
      try {
        await commit(safeKey, key, value);
        if (pendingWrites.get(safeKey) === entry) pendingWrites.delete(safeKey);
      } catch (e) {
        // Kept in memory and retried; never written as plain text. The error is reported, not the value.
        reportError(e, 'manual', 'authStorage.setItem');
      }
    });
  },

  async removeItem(key: string): Promise<void> {
    if (isWebSsr()) return;
    if (!isNativePlatform()) {
      await AsyncStorage.removeItem(key);
      return;
    }

    const safeKey = toSecureKey(key);
    pendingWrites.delete(safeKey);
    tombstones.add(safeKey);
    await serial(safeKey, async () => {
      if (!tombstones.has(safeKey)) return; // a setItem after this removeItem already replaced the session
      await deleteAll(safeKey, key);
      tombstones.delete(safeKey);
    });
  },
};
