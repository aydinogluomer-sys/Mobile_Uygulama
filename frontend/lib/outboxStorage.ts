/**
 * R02.03 / R02.06 — where the outbox lives between launches.
 *
 * One AsyncStorage key PER ACCOUNT (`outbox.v1.<userId>`). Account B never
 * loads account A's commands, so signing out, switching accounts or a token
 * expiring cannot send A's work as B -- and A's unsent work is still there
 * when A signs back in (it is never silently deleted).
 *
 * ## The "same transaction" rule, and its honest limit
 *
 * The local change and its outbox command must be saved together or not at
 * all. Here the local change IS the outbox command: screens render server
 * rows overlaid with the unsent commands (`outbox.overlay`), so there is no
 * second local copy to keep in step. One `setItem` of one key is atomic in
 * AsyncStorage, which makes "change + command" one write.
 *
 * What this is NOT is a relational store: no queries, one JSON blob per
 * account, and Android's default AsyncStorage size cap. Moving to SQLite
 * (R02.02) is stop point S7 -- a new native dependency needing the owner's
 * approval and a development build. This adapter is the interface that
 * swap replaces; nothing above it knows which store is underneath.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearSending, emptyOutbox, type OutboxCommand, type OutboxState } from './outbox';

export const OUTBOX_VERSION = 1;
export const OUTBOX_QUARANTINE_SLOTS = 3;
export const outboxKey = (userId: string) => `outbox.v1.${userId}`;
/**
 * R02.03 — a second outbox per account for the other core records (journal,
 * notes, recovery plans, focus sessions). Its own key, so the task outbox
 * and this one never overwrite each other's blob.
 */
export const namespacedOutboxKey = (ns: string, userId: string) => `outbox.v1.${ns}.${userId}`;
export const quarantineKeyFor = (baseKey: string, at: number): string => `${baseKey}.quarantine.${at}`;

export interface OutboxStorage {
  load(userId: string): Promise<OutboxState>;
  save(state: OutboxState): Promise<void>;
}

type Stored = { v: number; state: OutboxState };

export type StoredProblem = 'unreadable' | 'version' | 'account' | 'shape' | 'commands';

export function isValidCommand(c: unknown): c is OutboxCommand {
  if (!c || typeof c !== 'object') return false;
  const o = c as Record<string, unknown>;
  return typeof o.operationId === 'string' && typeof o.userId === 'string'
    && typeof o.entity === 'string' && typeof o.entityId === 'string'
    && (o.kind === 'create' || o.kind === 'update' || o.kind === 'delete')
    && !!o.payload && typeof o.payload === 'object' && !Array.isArray(o.payload)
    && Array.isArray(o.dependsOn) && o.dependsOn.every((d) => typeof d === 'string')
    && typeof o.seq === 'number' && typeof o.attempts === 'number'
    && typeof o.readyAt === 'number' && typeof o.createdAt === 'number'
    && (o.status === 'pending' || o.status === 'dead' || o.status === 'conflict')
    && (o.baseVersion === null || typeof o.baseVersion === 'string');
}

/**
 * Writes raw text into a bounded quarantine slot (at most 3 slots per baseKey;
 * oldest evicted first). Returns `false` if storage refused the write.
 */
export async function quarantineBlob(baseKey: string, raw: string, now: number = Date.now()): Promise<boolean> {
  try {
    const prefix = `${baseKey}.quarantine.`;
    const existing = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix)).sort();
    while (existing.length >= OUTBOX_QUARANTINE_SLOTS) {
      await AsyncStorage.removeItem(existing.shift() as string);
    }
    await AsyncStorage.setItem(quarantineKeyFor(baseKey, now), raw);
    return true;
  } catch {
    return false;
  }
}

/** Combined count of quarantined blobs for this account (outbox + habit syncQueue). */
export async function countQuarantined(userId: string): Promise<number> {
  if (!userId) return 0;
  try {
    return (await AsyncStorage.getAllKeys()).filter((k) => k.includes(userId) && k.includes('.quarantine.')).length;
  } catch {
    return 0;
  }
}

function parseResult(
  state: OutboxState,
  problem: StoredProblem | null,
  rejected: unknown[] = [],
): { state: OutboxState; problem: StoredProblem | null; rejected: unknown[] } {
  if (rejected.length > 0) return { state, problem, rejected };
  const out = { state, problem } as { state: OutboxState; problem: StoredProblem | null; rejected: unknown[] };
  Object.defineProperty(out, 'rejected', { value: rejected, enumerable: false });
  return out;
}

/**
 * Parse a stored blob. A blob from another version, another account, or
 * that does not parse is NOT discarded silently: it is reported so the caller
 * can quarantine it before writing anything new. Individual malformed commands
 * are filtered out and returned in `rejected` while valid commands survive.
 */
export function parseStored(
  raw: string | null,
  userId: string,
): { state: OutboxState; problem: StoredProblem | null; rejected: unknown[] } {
  if (!raw) return parseResult(emptyOutbox(userId), null);
  let o: Stored;
  try { o = JSON.parse(raw); } catch { return parseResult(emptyOutbox(userId), 'unreadable'); }
  if (!o || o.v !== OUTBOX_VERSION || !o.state) return parseResult(emptyOutbox(userId), 'version');
  if (o.state.userId !== userId) return parseResult(emptyOutbox(userId), 'account');
  if (!Array.isArray(o.state.commands)) return parseResult(emptyOutbox(userId), 'shape');
  const valid = o.state.commands.filter(isValidCommand);
  const rejected = o.state.commands.filter((c) => !isValidCommand(c));
  // A command saved mid-delivery was interrupted by the app dying: send it again.
  const state = clearSending({ ...emptyOutbox(userId), ...o.state, commands: valid });
  return parseResult(state, rejected.length > 0 ? 'commands' : null, rejected);
}

const quarantineFailed = new Set<string>();

async function loadGuarded(key: string, userId: string): Promise<OutboxState> {
  const raw = await AsyncStorage.getItem(key);
  const parsed = parseStored(raw, userId);
  if (parsed.problem !== null && raw !== null) {
    if (parsed.problem === 'commands') {
      await quarantineBlob(key, JSON.stringify({ reason: 'commands', commands: parsed.rejected }));
    } else if (await quarantineBlob(key, raw)) {
      await AsyncStorage.removeItem(key);
      quarantineFailed.delete(key);
    } else {
      quarantineFailed.add(key);
    }
  } else if (parsed.problem === null) {
    quarantineFailed.delete(key);
  }
  return parsed.state;
}

async function saveGuarded(key: string, state: OutboxState): Promise<void> {
  // Overwriting a corrupt blob whose quarantine write failed would destroy it: refuse the save.
  // The channel surfaces this as `savedOnDevice: false` (outboxChannel.ts).
  if (quarantineFailed.has(key)) throw new Error('outbox_quarantine_failed');
  const blob: Stored = { v: OUTBOX_VERSION, state };
  await AsyncStorage.setItem(key, JSON.stringify(blob));
}

export const asyncStorageOutbox: OutboxStorage = {
  load: (userId) => loadGuarded(outboxKey(userId), userId),
  save: (state) => saveGuarded(outboxKey(state.userId), state),
};

/** R02.03 — the same contract under `namespacedOutboxKey(ns, …)`. */
export function asyncStorageOutboxNs(ns: string): OutboxStorage {
  return {
    load: (userId) => loadGuarded(namespacedOutboxKey(ns, userId), userId),
    save: (state) => saveGuarded(namespacedOutboxKey(ns, state.userId), state),
  };
}

/** For tests and fixtures: the same contract, in memory. */
export function memoryOutboxStorage(): OutboxStorage & { raw: Map<string, string> } {
  const raw = new Map<string, string>();
  return {
    raw,
    async load(userId) { return parseStored(raw.get(outboxKey(userId)) ?? null, userId).state; },
    async save(state) { raw.set(outboxKey(state.userId), JSON.stringify({ v: OUTBOX_VERSION, state })); },
  };
}
