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
import { clearSending, emptyOutbox, type OutboxState } from './outbox';

export const OUTBOX_VERSION = 1;
export const outboxKey = (userId: string) => `outbox.v1.${userId}`;
/**
 * R02.03 — a second outbox per account for the other core records (journal,
 * notes, recovery plans, focus sessions). Its own key, so the task outbox
 * and this one never overwrite each other's blob.
 */
export const namespacedOutboxKey = (ns: string, userId: string) => `outbox.v1.${ns}.${userId}`;

export interface OutboxStorage {
  load(userId: string): Promise<OutboxState>;
  save(state: OutboxState): Promise<void>;
}

type Stored = { v: number; state: OutboxState };

/**
 * Parse a stored blob. A blob from another version, another account, or
 * that does not parse is NOT discarded silently: it is left where it is and
 * reported, and an empty outbox is used in its place -- a later build that
 * understands it can still recover it.
 */
export function parseStored(raw: string | null, userId: string): { state: OutboxState; problem: string | null } {
  if (!raw) return { state: emptyOutbox(userId), problem: null };
  let o: Stored;
  try { o = JSON.parse(raw); } catch { return { state: emptyOutbox(userId), problem: 'unreadable' }; }
  if (!o || o.v !== OUTBOX_VERSION || !o.state) return { state: emptyOutbox(userId), problem: 'version' };
  if (o.state.userId !== userId) return { state: emptyOutbox(userId), problem: 'account' };
  if (!Array.isArray(o.state.commands)) return { state: emptyOutbox(userId), problem: 'shape' };
  // A command saved mid-delivery was interrupted by the app dying: send it again.
  return { state: clearSending({ ...emptyOutbox(userId), ...o.state }), problem: null };
}

export const asyncStorageOutbox: OutboxStorage = {
  async load(userId) {
    const raw = await AsyncStorage.getItem(outboxKey(userId));
    return parseStored(raw, userId).state;
  },
  async save(state) {
    const blob: Stored = { v: OUTBOX_VERSION, state };
    await AsyncStorage.setItem(outboxKey(state.userId), JSON.stringify(blob));
  },
};

/** R02.03 — the same contract under `namespacedOutboxKey(ns, …)`. */
export function asyncStorageOutboxNs(ns: string): OutboxStorage {
  return {
    async load(userId) {
      const raw = await AsyncStorage.getItem(namespacedOutboxKey(ns, userId));
      return parseStored(raw, userId).state;
    },
    async save(state) {
      const blob: Stored = { v: OUTBOX_VERSION, state };
      await AsyncStorage.setItem(namespacedOutboxKey(ns, state.userId), JSON.stringify(blob));
    },
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
