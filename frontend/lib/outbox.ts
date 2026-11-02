/**
 * R02.03–R02.06 — a generic, durable outbox for core writes.
 *
 * `lib/syncQueue.ts` already does this for ONE entity (habit logs, keyed
 * habit|day). Every other core write -- Today's tasks first -- went straight
 * to the network and simply failed offline. This module is the general form:
 * a persisted, per-account list of commands, each with an `operationId` that
 * makes a re-delivery one effect, an optional entity version for conflict
 * detection, explicit dependencies, and tombstones so a deleted entity cannot
 * be resurrected by a late edit.
 *
 * Pure: no I/O, no clock (time is passed in), no store. Persistence is an
 * adapter (`lib/outboxStorage.ts`); delivery is the runner's job
 * (`services/outboxRunner.ts`). Every function returns a new state.
 *
 * ## Rules, in one place
 *
 *  idempotency   enqueueing an operationId already present with the SAME
 *                payload is a no-op; with a DIFFERENT payload it is refused
 *                (`id_reused`) -- one id, one meaning.
 *  collapse      an update to an entity that already has a pending, not-yet-
 *                sent update merges into it (last write per field wins), so
 *                ten offline edits are one request. A create still pending
 *                absorbs later updates into its payload.
 *  delete        a delete of an entity whose create has not been sent drops
 *                both (it never existed for the server). Otherwise pending
 *                updates for it are dropped and the delete is queued; the id
 *                is tombstoned.
 *  tombstone     a command for a tombstoned entity enqueued AFTER the delete
 *                (a late edit, another device's echo) is dropped -- deleted
 *                things do not come back.
 *  order         by `seq`, except that a command never runs before the
 *                commands it depends on (`dependsOn`), and never before an
 *                earlier command for the same entity.
 *  retry         `offline` costs nothing and retries; `auth` pauses the whole
 *                outbox until credentials are refreshed (no attempts used);
 *                `rejected` uses an attempt with exponential backoff and
 *                becomes `dead` after MAX_ATTEMPTS; `conflict` stops that
 *                command for the user to resolve (never silently applied);
 *                `gone` (the server says the entity no longer exists) drops
 *                updates and counts deletes as applied.
 *  account       the state belongs to ONE user id; the runner refuses to send
 *                a command whose `userId` is not the signed-in account.
 */

export type OutboxKind = 'create' | 'update' | 'delete';
export type OutboxStatus = 'pending' | 'dead' | 'conflict';

export type OutboxCommand = {
  operationId: string;
  userId: string;
  /** Entity type, e.g. 'task'. The runner maps it to a transport. */
  entity: string;
  entityId: string;
  kind: OutboxKind;
  /** Field values to write (create: the row; update: the patch; delete: {}). */
  payload: Record<string, unknown>;
  /** The server version the edit was made against (e.g. updated_at); null = unversioned. */
  baseVersion: string | null;
  dependsOn: string[];
  seq: number;
  attempts: number;
  status: OutboxStatus;
  readyAt: number;
  lastError?: string;
  createdAt: number;
  /**
   * Being delivered right now. A sending command is never a merge target and
   * never cancelled: whatever is in flight is exactly what the server will
   * apply, so later edits queue behind it instead of changing it.
   */
  sending?: boolean;
  /** F05 (SYN-03): transient server failures (408/425/429/5xx) so far; they never spend `attempts`. */
  retryableCount?: number;
  /** F05: when the first transient failure happened (ms epoch); the 72-hour give-up counts from here. */
  firstRetryableAt?: number;
};

export type OutboxState = {
  userId: string;
  commands: OutboxCommand[];
  nextSeq: number;
  /** entity|id -> seq of the delete that tombstoned it. */
  tombstones: Record<string, number>;
  /** Set by an `auth` failure; cleared when credentials are refreshed. */
  authBlocked: boolean;
};

export const MAX_ATTEMPTS = 6;

/**
 * F05 (SYN-03): a transient server failure waits longer each time (5 s, 10 s, 20 s ... at most
 * 15 min) and becomes `dead` only after 72 hours of nothing but transient failures. The same
 * numbers live in `lib/syncQueue.ts` (no import between the two; a test keeps them equal).
 */
export const RETRYABLE_GIVE_UP_MS = 72 * 3600_000;
const RETRYABLE_BASE_MS = 5_000;
const RETRYABLE_MAX_MS = 15 * 60_000;

export function retryableDelayMs(n: number): number {
  return Math.min(RETRYABLE_MAX_MS, RETRYABLE_BASE_MS * 2 ** (Math.max(1, n) - 1));
}

export function emptyOutbox(userId: string): OutboxState {
  return { userId, commands: [], nextSeq: 1, tombstones: {}, authBlocked: false };
}

const key = (entity: string, id: string) => `${entity}|${id}`;

/** Stable JSON for payload comparison (key order independent). */
export function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`).join(',')}}`;
}

export type EnqueueInput = {
  operationId: string;
  entity: string;
  entityId: string;
  kind: OutboxKind;
  payload?: Record<string, unknown>;
  baseVersion?: string | null;
  dependsOn?: string[];
};

export type EnqueueResult =
  | { ok: true; state: OutboxState; effect: 'queued' | 'merged' | 'duplicate' | 'cancelled' | 'dropped_tombstoned' }
  | { ok: false; reason: 'id_reused' | 'wrong_account' };

export function enqueue(state: OutboxState, input: EnqueueInput, userId: string, now: number): EnqueueResult {
  if (userId !== state.userId) return { ok: false, reason: 'wrong_account' };
  const payload = input.payload ?? {};

  const same = state.commands.find((c) => c.operationId === input.operationId);
  if (same) {
    const identical = same.entity === input.entity && same.entityId === input.entityId
      && same.kind === input.kind && stableJson(same.payload) === stableJson(payload);
    return identical ? { ok: true, state, effect: 'duplicate' } : { ok: false, reason: 'id_reused' };
  }

  const k = key(input.entity, input.entityId);
  if (state.tombstones[k] !== undefined && input.kind !== 'delete') {
    return { ok: true, state, effect: 'dropped_tombstoned' };
  }

  // Pending and NOT in flight: only these can still be changed.
  const forEntity = state.commands.filter((c) => c.entity === input.entity && c.entityId === input.entityId && c.status === 'pending' && !c.sending);

  if (input.kind === 'update') {
    // Merge into a pending create or update of the same entity -- not yet sent.
    const target = [...forEntity].reverse().find((c) => c.kind === 'create' || c.kind === 'update');
    if (target) {
      const merged: OutboxCommand = { ...target, payload: { ...target.payload, ...payload } };
      return { ok: true, effect: 'merged', state: { ...state, commands: state.commands.map((c) => (c === target ? merged : c)) } };
    }
  }

  if (input.kind === 'delete') {
    const pendingCreate = forEntity.find((c) => c.kind === 'create');
    const others = state.commands.filter((c) => !forEntity.includes(c));
    const tombstones = pruneTombstones({ ...state.tombstones, [k]: state.nextSeq });
    if (pendingCreate) {
      // Never reached the server: nothing to delete there.
      return { ok: true, effect: 'cancelled', state: { ...state, commands: others, tombstones, nextSeq: state.nextSeq + 1 } };
    }
    const del = makeCommand(state, input, payload, userId, now);
    return { ok: true, effect: 'queued', state: { ...state, commands: [...others, del], tombstones, nextSeq: state.nextSeq + 1 } };
  }

  const cmd = makeCommand(state, input, payload, userId, now);
  return { ok: true, effect: 'queued', state: { ...state, commands: [...state.commands, cmd], nextSeq: state.nextSeq + 1 } };
}

/** Tombstones are kept for the most recent deletes only -- enough to stop late local edits. */
export const MAX_TOMBSTONES = 200;
function pruneTombstones(t: Record<string, number>): Record<string, number> {
  const entries = Object.entries(t);
  if (entries.length <= MAX_TOMBSTONES) return t;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_TOMBSTONES));
}

function makeCommand(state: OutboxState, input: EnqueueInput, payload: Record<string, unknown>, userId: string, now: number): OutboxCommand {
  return {
    operationId: input.operationId,
    userId,
    entity: input.entity,
    entityId: input.entityId,
    kind: input.kind,
    payload,
    baseVersion: input.baseVersion ?? null,
    dependsOn: input.dependsOn ?? [],
    seq: state.nextSeq,
    attempts: 0,
    status: 'pending',
    readyAt: 0,
    createdAt: now,
  };
}

/**
 * The commands that may be sent now, in order. A command waits for every
 * command it depends on, and for every earlier command of the same entity,
 * that is still in the outbox -- whatever its status. A dead or conflicted
 * predecessor therefore holds its dependants back rather than letting them
 * run against a state the server never reached.
 */
export function ready(state: OutboxState, now: number): OutboxCommand[] {
  if (state.authBlocked) return [];
  const present = new Set(state.commands.map((c) => c.operationId));
  const sorted = [...state.commands].sort((a, b) => a.seq - b.seq);
  const out: OutboxCommand[] = [];
  for (const c of sorted) {
    if (c.status !== 'pending' || c.sending || c.readyAt > now) continue;
    if (c.dependsOn.some((d) => present.has(d))) continue;
    const earlier = sorted.find((p) => p.seq < c.seq && p.entity === c.entity && p.entityId === c.entityId);
    if (earlier) continue;
    out.push(c);
  }
  return out;
}

/** Mark a command as in flight (see `OutboxCommand.sending`). */
export function markSending(state: OutboxState, operationId: string): OutboxState {
  return { ...state, commands: state.commands.map((c) => (c.operationId === operationId ? { ...c, sending: true } : c)) };
}

/** After a crash nothing is in flight any more: every command is sendable again. */
export function clearSending(state: OutboxState): OutboxState {
  return state.commands.some((c) => c.sending)
    ? { ...state, commands: state.commands.map((c) => (c.sending ? { ...c, sending: false } : c)) }
    : state;
}

export type DeliveryOutcome =
  | { kind: 'applied'; version?: string | null }
  | { kind: 'offline' }
  | { kind: 'auth' }
  | { kind: 'rejected'; error: string }
  | { kind: 'conflict'; error: string }
  | { kind: 'gone' }
  /** F05: the server answered with a transient failure (408/425/429/5xx); try again later, free of charge. */
  | { kind: 'retryable'; error?: string; retryAfterMs?: number };

export function nextRetryDelayMs(attempts: number): number {
  return Math.min(60 * 60_000, 2_000 * 2 ** Math.max(0, attempts - 1));
}

/**
 * Apply what happened to one delivery. `applied` (and `gone` for a delete)
 * removes the command; the new server version, if any, becomes the base of
 * later commands for the same entity, so a follow-up edit is checked against
 * the version this one produced.
 */
export function settle(state: OutboxState, operationId: string, outcome: DeliveryOutcome, now: number): OutboxState {
  const cmd = state.commands.find((c) => c.operationId === operationId);
  if (!cmd) return state;
  const rest = state.commands.filter((c) => c.operationId !== operationId);
  const replace = (patch: Partial<OutboxCommand>) => ({ ...state, commands: state.commands.map((c) => (c === cmd ? { ...c, sending: false, ...patch } : c)) });

  switch (outcome.kind) {
    case 'applied': {
      const v = outcome.version ?? null;
      const commands = v === null ? rest : rest.map((c) => (c.entity === cmd.entity && c.entityId === cmd.entityId && c.kind !== 'create' ? { ...c, baseVersion: v } : c));
      return { ...state, commands };
    }
    case 'offline':
      return replace({}); // costs nothing; tried again on the next flush
    case 'auth':
      return { ...replace({}), authBlocked: true };
    case 'gone':
      // The entity is not on the server: an update has nothing to land on, a
      // delete is already true. Either way the command is finished.
      return { ...state, commands: rest };
    case 'conflict':
      return replace({ status: 'conflict', lastError: outcome.error });
    case 'retryable': {
      const retryableCount = (cmd.retryableCount ?? 0) + 1;
      const firstRetryableAt = cmd.firstRetryableAt ?? now;
      if (now - firstRetryableAt >= RETRYABLE_GIVE_UP_MS) {
        return replace({ retryableCount, firstRetryableAt, status: 'dead', lastError: outcome.error ?? cmd.lastError });
      }
      return replace({
        retryableCount,
        firstRetryableAt,
        readyAt: now + (outcome.retryAfterMs ?? retryableDelayMs(retryableCount)),
        lastError: outcome.error ?? cmd.lastError,
      });
    }
    case 'rejected': {
      const attempts = cmd.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) return replace({ attempts, status: 'dead', lastError: outcome.error });
      return replace({ attempts, readyAt: now + nextRetryDelayMs(attempts), lastError: outcome.error });
    }
  }
}

/** Credentials were refreshed: let the outbox run again. */
export function clearAuthBlock(state: OutboxState): OutboxState {
  return state.authBlocked ? { ...state, authBlocked: false } : state;
}

/** The user chose to retry a dead/conflicted command (e.g. after resolving it). */
export function retry(state: OutboxState, operationId: string, baseVersion?: string | null): OutboxState {
  return {
    ...state,
    commands: state.commands.map((c) => (c.operationId === operationId
      ? { ...c, status: 'pending', attempts: 0, readyAt: 0, lastError: undefined, retryableCount: undefined, firstRetryableAt: undefined, ...(baseVersion !== undefined ? { baseVersion } : {}) }
      : c)),
  };
}

/** The user chose to discard a command (their local change is given up). */
export function discard(state: OutboxState, operationId: string): OutboxState {
  return { ...state, commands: state.commands.filter((c) => c.operationId !== operationId) };
}

/**
 * F05 (SYN-15): the soonest explicit `readyAt` of a pending command not in flight, or null (nothing
 * pending with a later time, or the outbox waits for credentials). The sync coordinator sleeps
 * until then instead of polling.
 */
export function nextReadyAt(state: OutboxState): number | null {
  if (state.authBlocked) return null;
  let soonest: number | null = null;
  for (const c of state.commands) {
    if (c.status !== 'pending' || c.sending || !(c.readyAt > 0)) continue;
    if (soonest === null || c.readyAt < soonest) soonest = c.readyAt;
  }
  return soonest;
}

export type OutboxSummary = { pending: number; dead: number; conflict: number; authBlocked: boolean };

export function summary(state: OutboxState): OutboxSummary {
  let pending = 0, dead = 0, conflict = 0;
  for (const c of state.commands) {
    if (c.status === 'pending') pending += 1;
    else if (c.status === 'dead') dead += 1;
    else conflict += 1;
  }
  return { pending, dead, conflict, authBlocked: state.authBlocked };
}

/** Is there an unsent change for this entity? (For "bekliyor" badges.) */
export function hasPending(state: OutboxState, entity: string, entityId: string): boolean {
  return state.commands.some((c) => c.entity === entity && c.entityId === entityId);
}

/**
 * Overlay unsent changes onto server rows, so a refetch never makes a local
 * change disappear before it is delivered: pending creates are added,
 * pending updates are applied, pending deletes (and tombstones) hide rows.
 */
export function overlay<T extends { id: string }>(state: OutboxState, entity: string, rows: readonly T[]): T[] {
  const mine = [...state.commands].filter((c) => c.entity === entity).sort((a, b) => a.seq - b.seq);
  const byId = new Map(rows.map((r) => [r.id, r] as const));
  const order = rows.map((r) => r.id);
  for (const c of mine) {
    if (c.kind === 'create') {
      if (!byId.has(c.entityId)) order.unshift(c.entityId);
      byId.set(c.entityId, { ...(byId.get(c.entityId) ?? {}), ...(c.payload as object), id: c.entityId } as T);
    } else if (c.kind === 'update') {
      const cur = byId.get(c.entityId);
      if (cur) byId.set(c.entityId, { ...cur, ...(c.payload as object) } as T);
    } else {
      byId.delete(c.entityId);
    }
  }
  for (const k of Object.keys(state.tombstones)) {
    const [e, id] = k.split('|');
    if (e === entity) byId.delete(id);
  }
  return order.filter((id, i) => byId.has(id) && order.indexOf(id) === i).map((id) => byId.get(id)!);
}

/** A v4-shaped id without `crypto.randomUUID` (absent on some Hermes runtimes; see lib/onboarding.newInstallId). */
export function newOperationId(): string {
  const hex = (n: number) => Math.floor(Math.random() * 16 ** n).toString(16).padStart(n, '0');
  const variant = '89ab'[Math.floor(Math.random() * 4)];
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${variant}${hex(3)}-${hex(12)}`;
}
