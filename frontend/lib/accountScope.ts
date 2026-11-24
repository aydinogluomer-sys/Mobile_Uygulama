/**
 * The account boundary: one registry of everything that belongs to the signed-in account.
 * (F04; STO-01, SYN-08, STO-03, SYN-07, STO-13, STO-20, STO-22, STO-V02)
 *
 * ## Why this file exists
 *
 * Before it, signing out reset the task store and the core outbox, an effect reset onboarding,
 * and account deletion reset a hand-written list of seven stores. The other account-scoped
 * stores kept the previous account in memory: B could see A's life-area values, A's coach
 * transcript, A's paused focus session, and saving would write A's values into B's account.
 * The native read cache (`read_cache` in expo-sqlite) was never wiped in production.
 *
 * Now every account-scoped store registers itself here (the store imports this module; this
 * module imports no store: `lib` never depends on `store`). Every account boundary -- a sign-out,
 * a different user signing in, an account deletion -- calls `endAccountScope` and nothing else,
 * so there is no second list to forget. `__tests__/repo/accountScopeRegistry.test.ts` fails when a
 * store file is neither registered nor on the explicit device-level allow list.
 *
 * ## What it does NOT touch
 *
 * Outbox keys (`outbox.v1.*`, `atlas_sync_queue_v1:<uid>`) are never removed on sign-out: work
 * the server has not received yet stays on the device and is sent when the same account signs in
 * again. Account deletion sweeps AsyncStorage separately (`services/accountService.ts`).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { clearAllReadCache, clearReadCacheMemory, clearUserReadCache } from './localReadCache';
import { cancelScheduled, listScheduled } from './notifications';

/** Why the account boundary was crossed. `user_changed`: the identity changed without a sign-out first. */
export type AccountResetReason = 'signed_out' | 'user_changed' | 'account_deleted';

/** The narrow face of a Zustand store the registry needs (a `UseBoundStore` is assignable). */
export type ResettableStore<T> = {
  getInitialState: () => T;
  setState: (state: T, replace: true) => void;
};

export type AccountScopedEntry<T = unknown> = {
  /** Unique name; registering the same name again replaces the entry (Fast Refresh safe). */
  name: string;
  /** When given, `setState(getInitialState(), true)`: a full replacement, actions included. */
  store?: ResettableStore<T>;
  /** State outside the store (module-level maps and flags, an outbox channel). Runs AFTER the store reset. */
  onReset?: (reason: AccountResetReason) => void;
};

export type AccountStorageEntry = {
  name: string;
  /** true: removed on sign-out and on an account change (a half-finished focus session). false: kept under its user-scoped key. */
  transient: boolean;
  keysFor: (userId: string) => readonly string[];
};

type StoredAccountScope = {
  name: string;
  resetStore?: () => void;
  onReset?: (reason: AccountResetReason) => void;
};

const scoped = new Map<string, StoredAccountScope>();
const storage = new Map<string, AccountStorageEntry>();
let epoch = 0;

export function registerAccountScoped<T>(entry: AccountScopedEntry<T>): void {
  const store = entry.store;
  scoped.set(entry.name, {
    name: entry.name,
    resetStore: store ? () => { store.setState(store.getInitialState(), true); } : undefined,
    onReset: entry.onReset,
  });
}

export function registerAccountStorage(entry: AccountStorageEntry): void {
  storage.set(entry.name, entry);
}

/** For tests: the registered names, in registration order. */
export function registeredAccountScopes(): readonly string[] {
  return [...scoped.keys()];
}

export function registeredAccountStorage(): readonly string[] {
  return [...storage.keys()];
}

/**
 * +1 on every `resetAccountMemory`. An async action captures `const e = accountEpoch()` before it
 * awaits and drops its result when `e !== accountEpoch()` afterwards: the answer belongs to an
 * account that is no longer on this device.
 */
export function accountEpoch(): number {
  return epoch;
}

/** SYNCHRONOUS. Every entry in its own try/catch; never throws. The epoch moves first, always. */
export function resetAccountMemory(reason: AccountResetReason): void {
  epoch += 1;
  for (const entry of scoped.values()) {
    if (entry.resetStore) {
      try {
        entry.resetStore();
      } catch {
        // one broken store must not keep the others holding the previous account
      }
    }
    if (entry.onReset) {
      try {
        entry.onReset(reason);
      } catch {
        // same
      }
    }
  }
}

/** ASYNC device cleanup: the read cache (L1 and L2), reminders, `transient` keys. Never throws. */
export async function wipeAccountDevice(reason: AccountResetReason, userId: string | null): Promise<void> {
  try { clearReadCacheMemory(); } catch { /* nothing cached */ }
  if (userId) {
    try { await clearUserReadCache(userId); } catch { /* best effort */ }
  }
  if (reason === 'account_deleted') {
    try { await clearAllReadCache(); } catch { /* best effort */ }
  }
  // the previous account's reminders must not fire on this phone (habit reminders, snoozes, recovery plans)
  try { await cancelScheduled((await listScheduled()).map((n) => n.identifier)); } catch { /* nothing scheduled / no permission */ }
  if (userId) {
    const keys: string[] = [];
    for (const entry of storage.values()) {
      if (!entry.transient && reason !== 'account_deleted') continue;
      try { keys.push(...entry.keysFor(userId)); } catch { /* skip a broken entry */ }
    }
    if (keys.length > 0) {
      try { await AsyncStorage.multiRemove(keys); } catch { /* best effort */ }
    }
  }
}

/** `resetAccountMemory` (its synchronous part runs at once) + `wipeAccountDevice`. Idempotent. */
export async function endAccountScope(reason: AccountResetReason, userId: string | null): Promise<void> {
  resetAccountMemory(reason);
  await wipeAccountDevice(reason, userId);
}
