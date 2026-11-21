/**
 * R02.03 — one durable, per-account outbox as a reusable channel.
 *
 * `store/taskStore.ts` grew the pattern for tasks: the local change IS the
 * outbox command (one atomic save), the screen shows it at once, delivery is
 * attempted after. This is that pattern without the task specifics, so the
 * other core records (journal entries, notes, recovery plans, focus
 * sessions) get the same guarantees instead of a direct write that is lost
 * the moment the network is:
 *
 *   - a change is saved on the device BEFORE any request (or reported if it
 *     could not be);
 *   - every command has an operationId and a client-made entity id, so a
 *     re-delivery is one effect on the server;
 *   - a command carries the server version it was made against; a moved
 *     version is a `conflict`, not a silent overwrite (R02.05);
 *   - commands belong to one account and are only ever sent as that account
 *     (R02.06); another account's outbox stays saved under its own key.
 *
 * The channel holds the live state; it never hands out a copy that a delivery
 * could overwrite (see services/outboxRunner).
 */
import {
  emptyOutbox, enqueue, summary, newOperationId, retry as retryCommand, discard as discardCommand, clearAuthBlock, clearTombstones as clearTombstonesIn,
  type EnqueueInput, type OutboxCommand, type OutboxState, type OutboxSummary,
} from '../lib/outbox';
import type { OutboxStorage } from '../lib/outboxStorage';
import { flushOutbox, type Transport } from './outboxRunner';

export type WriteResult = { ok: true; operationId: string; savedOnDevice: boolean } | { ok: false; error: string };

export type OutboxChannel = {
  /** The live outbox of the signed-in account (loads it on first use). */
  ensure(): Promise<OutboxState | null>;
  /** Enqueue a change, save it on the device, then try to deliver. */
  write(input: Omit<EnqueueInput, 'operationId'>): Promise<WriteResult>;
  flush(): Promise<void>;
  state(): OutboxState | null;
  sync(): OutboxSummary;
  subscribe(fn: (s: OutboxState | null) => void): () => void;
  /**
   * Called after the server applied a command, with the version it now holds
   * (null when the table has none). A store records it as the base of the
   * next edit, so its own earlier change is never reported as a conflict.
   */
  onApplied(fn: (cmd: OutboxCommand, version: string | null) => void): () => void;
  retry(operationId: string, baseVersion: string | null): Promise<void>;
  discard(operationId: string): Promise<void>;
  clearTombstones(entity: string, ids: readonly string[]): Promise<void>;
  authRefreshed(): Promise<void>;
  /** Signed out / switched account: forget the in-memory copy (the saved one stays). */
  reset(): void;
};

export function createOutboxChannel(opts: {
  storage: OutboxStorage;
  transports: Record<string, Transport>;
  currentUserId: () => Promise<string | null>;
  now?: () => number;
}): OutboxChannel {
  const now = opts.now ?? (() => Date.now());
  let box: OutboxState | null = null;
  let inFlight: Promise<void> | null = null;
  /**
   * R02.06 — bumped by `reset()` (sign-out, account switch, account deleted).
   * A delivery or load that began before the reset must not publish or SAVE
   * afterwards: that would write a deleted account's commands back onto the
   * device, or show one account's queue to the next.
   */
  let gen = 0;
  const listeners = new Set<(s: OutboxState | null) => void>();
  const appliedListeners = new Set<(cmd: OutboxCommand, version: string | null) => void>();
  const transports: Record<string, Transport> = Object.fromEntries(Object.entries(opts.transports).map(([entity, t]) => [entity, async (cmd: OutboxCommand) => {
    const outcome = await t(cmd);
    if (outcome.kind === 'applied') {
      for (const l of appliedListeners) { try { l(cmd, outcome.version ?? null); } catch { /* never breaks delivery */ } }
    }
    return outcome;
  }]));

  const publish = (next: OutboxState | null) => {
    box = next;
    for (const l of listeners) { try { l(next); } catch { /* a listener never breaks a write */ } }
  };

  async function ensure(): Promise<OutboxState | null> {
    const uid = await opts.currentUserId();
    if (!uid) return null;
    if (box && box.userId === uid) return box;
    const g = gen;
    const loaded = await opts.storage.load(uid);
    if (g !== gen) return null;
    // Someone may have loaded (and changed) it while this was reading.
    if (box && box.userId === uid) return box;
    publish(loaded);
    return loaded;
  }

  async function save(): Promise<boolean> {
    if (!box) return false;
    try { await opts.storage.save(box); return true; } catch { return false; }
  }

  async function runFlush(): Promise<void> {
    const start = await ensure();
    if (!start || start.commands.length === 0) return;
    const g = gen;
    await flushOutbox({
      get: () => (g === gen ? (box ?? start) : { ...start, commands: [] }),
      set: async (next) => { if (g !== gen) return; publish(next); await save(); },
    }, transports, { currentUserId: opts.currentUserId, now });
  }

  const channel: OutboxChannel = {
    ensure,
    async write(input) {
      const live = await ensure();
      if (!live) return { ok: false, error: 'Oturum bulunamadı.' };
      // Enqueue on the LIVE state and publish before any await, so a delivery
      // in flight never overwrites this change with an older snapshot.
      const operationId = newOperationId();
      const res = enqueue(box ?? live, { ...input, operationId }, live.userId, now());
      if (!res.ok) return { ok: false, error: 'Değişiklik kaydedilemedi.' };
      publish(res.state);
      const savedOnDevice = await save();
      void channel.flush();
      // A merge folds this change into an earlier unsent command: that one carries it now.
      const carrier = res.effect === 'merged'
        ? [...res.state.commands].reverse().find((c) => c.entity === input.entity && c.entityId === input.entityId)?.operationId
        : operationId;
      return { ok: true, operationId: carrier ?? operationId, savedOnDevice };
    },
    async flush() {
      while (inFlight) await inFlight;
      inFlight = runFlush();
      try { await inFlight; } finally { inFlight = null; }
    },
    state: () => box,
    sync: () => summary(box ?? emptyOutbox('')),
    subscribe(fn) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    onApplied(fn) { appliedListeners.add(fn); return () => { appliedListeners.delete(fn); }; },
    async retry(operationId, baseVersion) {
      if (!box) return;
      publish(retryCommand(box, operationId, baseVersion));
      await save();
      void channel.flush();
    },
    async discard(operationId) {
      if (!box) return;
      publish(discardCommand(box, operationId));
      await save();
    },
    async clearTombstones(entity, ids) {
      const live = await ensure();
      if (!live || !box) return;
      const next = clearTombstonesIn(box, entity, ids);
      if (next === box) return;
      publish(next);
      await save();
    },
    async authRefreshed() {
      if (box?.authBlocked) { publish(clearAuthBlock(box)); await save(); }
      void channel.flush();
    },
    reset() { gen += 1; publish(null); },
  };
  return channel;
}
