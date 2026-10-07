/**
 * R02.04 — delivering the outbox.
 *
 * Sends ready commands one at a time, in order, through the transport
 * registered for their entity, and settles each outcome. Stops at the first
 * `offline` (the network is down; trying the rest would only fail the same
 * way) and at `auth` (credentials must be refreshed first). A command whose
 * `userId` is not the signed-in account is never sent.
 *
 * ## Live state, not a snapshot
 *
 * The user keeps working while a delivery is in flight. The runner therefore
 * never holds its own copy of the outbox: every step reads the CURRENT state
 * through `io.get()` and writes through `io.set()`. A command is marked
 * `sending` before its request goes out, so a local edit made meanwhile
 * queues behind it instead of being merged into a request that has already
 * left (and then discarded with it when it settles).
 *
 * No I/O of its own beyond the transports and the `io` it is handed.
 */
import { markSending, ready, settle, type DeliveryOutcome, type OutboxCommand, type OutboxState } from '../lib/outbox';

export type Transport = (cmd: OutboxCommand) => Promise<DeliveryOutcome>;

export type OutboxIO = {
  get: () => OutboxState;
  /**
   * Replace the state. Awaited after every step so the caller can persist it:
   * a crash between the server applying a command and the outbox being saved
   * would otherwise re-send it -- harmless (every transport is idempotent)
   * but avoidable.
   */
  set: (next: OutboxState) => void | Promise<void>;
};

export type FlushResult = { sent: number; stoppedBy: 'done' | 'offline' | 'auth' | 'account' | 'limit' };

export async function flushOutbox(
  io: OutboxIO,
  transports: Record<string, Transport>,
  ctx: {
    /**
     * Who is signed in NOW. Asked again before EVERY command, not once per
     * flush: a flush that started under account A can still be running when
     * A signs out and B signs in, and the repository resolves the user at
     * request time -- so a stale answer would write A's work into B's account.
     */
    currentUserId: () => Promise<string | null>;
    now: () => number;
    limit?: number;
  },
): Promise<FlushResult> {
  const limit = ctx.limit ?? 50;
  let sent = 0;
  for (;;) {
    if (sent >= limit) return { sent, stoppedBy: 'limit' };
    const signedIn = await ctx.currentUserId();
    const live = io.get();
    if (!signedIn || live.userId !== signedIn) return { sent, stoppedBy: 'account' };
    const next = ready(live, ctx.now())[0];
    if (!next) return { sent, stoppedBy: live.authBlocked ? 'auth' : 'done' };
    if (next.userId !== signedIn) return { sent, stoppedBy: 'account' };
    await io.set(markSending(live, next.operationId));

    const t = transports[next.entity];
    let outcome: DeliveryOutcome;
    if (!t) outcome = { kind: 'rejected', error: `no transport for ${next.entity}` };
    else {
      // A throw is a bug, not a lost connection: it uses an attempt, so a
      // deterministic failure ends as `dead` instead of retrying forever.
      try { outcome = await t(next); } catch (e) { outcome = { kind: 'rejected', error: e instanceof Error ? e.message : 'transport threw' }; }
    }
    await io.set(settle(io.get(), next.operationId, outcome, ctx.now()));
    sent += 1;
    if (outcome.kind === 'offline') return { sent, stoppedBy: 'offline' };
    if (outcome.kind === 'auth') return { sent, stoppedBy: 'auth' };
  }
}

/**
 * Turn a repository failure into an outcome. Only an explicit transport
 * failure is `offline` (see repositories/shared.isTransportFailure); a 401 or
 * an expired JWT is `auth`; anything else the server said is `rejected`.
 */
export function classifyFailure(err: { error: string; offline?: boolean; status?: number; code?: string }): DeliveryOutcome {
  if (err.offline) return { kind: 'offline' };
  if (err.status === 401 || err.code === 'PGRST301' || /jwt/i.test(err.error)) return { kind: 'auth' };
  return { kind: 'rejected', error: err.error };
}
