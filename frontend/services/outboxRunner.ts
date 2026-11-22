/**
 * R02.04 / F46 — delivering the outbox.
 *
 * Sends ready commands one at a time, in order, through the transport
 * registered for their entity, and settles each outcome. Stops at the first
 * `offline` and at `auth`. A command whose `userId` is not the signed-in
 * account is never sent. Commands for an entity with no registered transport
 * are skipped without spending attempts (`skippedUnknown`).
 */
import { markSending, ready, settle, type DeliveryOutcome, type OutboxCommand, type OutboxState } from '../lib/outbox';
import { isTransientStatus } from '../repositories/shared';

export type Transport = (cmd: OutboxCommand) => Promise<DeliveryOutcome>;

export type OutboxIO = {
  get: () => OutboxState;
  set: (next: OutboxState) => void | Promise<void>;
};

export type FlushResult = {
  sent: number;
  stoppedBy: 'done' | 'offline' | 'auth' | 'account' | 'limit' | 'retryable';
  skippedUnknown?: number;
};

export async function flushOutbox(
  io: OutboxIO,
  transports: Record<string, Transport>,
  ctx: {
    currentUserId: () => Promise<string | null>;
    now: () => number;
    limit?: number;
  },
): Promise<FlushResult> {
  const limit = ctx.limit ?? 50;
  let sent = 0;
  let skippedUnknown = 0;
  const skippedIds = new Set<string>();
  const withSkipped = (base: { sent: number; stoppedBy: FlushResult['stoppedBy'] }): FlushResult =>
    skippedUnknown > 0 ? { ...base, skippedUnknown } : base;

  for (;;) {
    if (sent >= limit) return withSkipped({ sent, stoppedBy: 'limit' });
    const signedIn = await ctx.currentUserId();
    const live = io.get();
    if (!signedIn || live.userId !== signedIn) return withSkipped({ sent, stoppedBy: 'account' });
    const next = ready(live, ctx.now()).find((c) => !skippedIds.has(c.operationId));
    if (!next) return withSkipped({ sent, stoppedBy: live.authBlocked ? 'auth' : 'done' });
    if (next.userId !== signedIn) return withSkipped({ sent, stoppedBy: 'account' });

    const t = transports[next.entity];
    if (!t) {
      // Unknown entity (e.g. written by a newer version): leave untouched without spending attempts.
      skippedIds.add(next.operationId);
      skippedUnknown += 1;
      continue;
    }

    await io.set(markSending(live, next.operationId));

    let outcome: DeliveryOutcome;
    try {
      outcome = await t(next);
    } catch (e) {
      outcome = { kind: 'rejected', error: e instanceof Error ? e.message : 'transport threw' };
    }
    await io.set(settle(io.get(), next.operationId, outcome, ctx.now()));
    sent += 1;
    if (outcome.kind === 'offline') return withSkipped({ sent, stoppedBy: 'offline' });
    if (outcome.kind === 'auth') return withSkipped({ sent, stoppedBy: 'auth' });
    // F05: the server is struggling (503, 429 ...): the rest of the queue waits instead of hammering it
    if (outcome.kind === 'retryable') return withSkipped({ sent, stoppedBy: 'retryable' });
  }
}

/**
 * Turn a repository failure into an outcome.
 */
export function classifyFailure(err: { error: string; offline?: boolean; status?: number; code?: string }): DeliveryOutcome {
  if (err.offline) return { kind: 'offline' };
  if (err.status === 401 || err.code === 'PGRST301' || /jwt/i.test(err.error) || err.error === 'Oturum bulunamadı.') return { kind: 'auth' };
  if (isTransientStatus(err.status)) return { kind: 'retryable', error: err.error };
  return { kind: 'rejected', error: err.error };
}
