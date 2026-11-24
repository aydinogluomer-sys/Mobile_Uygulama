/**
 * R02.03–R02.06 / F46 — a generic, durable outbox for all offline writes and side effects.
 *
 * Pure: no I/O, no clock (time is passed in), no store. Persistence is an
 * adapter (`lib/outboxStorage.ts`); delivery is the runner's job
 * (`services/outboxRunner.ts`). Every function returns a new state.
 */

export type OutboxKind = 'create' | 'update' | 'delete';
export type OutboxStatus = 'pending' | 'dead' | 'conflict';

export type EntityPolicy = {
  coalesce: 'merge' | 'replace';
  conflict: 'last-writer-wins' | 'versioned' | 'content-cas' | 'none';
  maxPending?: number;
  dedupeTtlMs?: number;
};

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
  /** F46 (SYN-10): per-command monotonic revision so multi-tab merges keep the newer transition. */
  rev?: number;
};

export type OutboxState = {
  userId: string;
  commands: OutboxCommand[];
  nextSeq: number;
  /** entity|id -> seq of the delete that tombstoned it. */
  tombstones: Record<string, number>;
  /** entity|id -> ms epoch when the server confirmed the delete. Optional; absent on older blobs. */
  confirmedDeletes?: Record<string, number>;
  /** F46: operationId -> ms epoch when settled/discarded/cancelled (prevents cross-tab resurrection & dedupes effects). */
  settled?: Record<string, number>;
  /** Set by an `auth` failure; cleared when credentials are refreshed. */
  authBlocked: boolean;
};

export const MAX_ATTEMPTS = 6;
export const SETTLED_KEEP = 300;
export const SETTLED_MAX_AGE_MS = 14 * 24 * 3600_000;

/**
 * F05 (SYN-03): a transient server failure waits longer each time (5 s, 10 s, 20 s ... at most
 * 15 min) and becomes `dead` only after 72 hours of nothing but transient failures.
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

function boundSettledMap(entries: [string, number][], now: number): Record<string, number> | undefined {
  const fresh = entries.filter(([, ts]) => now - ts < SETTLED_MAX_AGE_MS);
  if (fresh.length === 0) return undefined;
  const kept = fresh.length <= SETTLED_KEEP
    ? fresh
    : fresh.sort((a, b) => b[1] - a[1]).slice(0, SETTLED_KEEP);
  return Object.fromEntries(kept);
}

function recordSettled(
  current: Record<string, number> | undefined,
  ids: readonly string[],
  now: number,
): Record<string, number> | undefined {
  if (ids.length === 0) return current;
  const merged: Record<string, number> = { ...(current ?? {}) };
  for (const id of ids) {
    const prev = merged[id];
    merged[id] = prev !== undefined && prev > now ? prev : now;
  }
  return boundSettledMap(Object.entries(merged), now);
}

export function pruneSettled(state: OutboxState, now: number): OutboxState {
  if (!state.settled) return state;
  const entries = Object.entries(state.settled);
  const expired = entries.some(([, ts]) => now - ts >= SETTLED_MAX_AGE_MS);
  if (!expired && entries.length <= SETTLED_KEEP) return state;
  const next = boundSettledMap(entries, now);
  if (next === undefined) {
    const { settled: _omitted, ...rest } = state;
    return rest;
  }
  return { ...state, settled: next };
}

function withSettled(state: OutboxState, settled: Record<string, number> | undefined): OutboxState {
  if (settled === undefined) {
    if (state.settled === undefined) return state;
    const { settled: _omitted, ...rest } = state;
    return rest;
  }
  return { ...state, settled };
}

export type EnqueueInput = {
  operationId: string;
  entity: string;
  entityId: string;
  kind: OutboxKind;
  payload?: Record<string, unknown>;
  baseVersion?: string | null;
  dependsOn?: string[];
  policy?: EntityPolicy;
};

export type EnqueueResult =
  | { ok: true; state: OutboxState; effect: 'queued' | 'merged' | 'duplicate' | 'cancelled' | 'dropped_tombstoned' }
  | { ok: false; reason: 'id_reused' | 'wrong_account' };

export function enqueue(state0: OutboxState, input: EnqueueInput, userId: string, now: number): EnqueueResult {
  if (userId !== state0.userId) return { ok: false, reason: 'wrong_account' };
  const state = pruneSettled(pruneConfirmedTombstones(state0, now), now);
  const payload = input.payload ?? {};

  const settledAt = state.settled?.[input.operationId];
  if (settledAt !== undefined && input.policy?.dedupeTtlMs !== undefined) {
    if (now - settledAt < input.policy.dedupeTtlMs) {
      return { ok: true, state, effect: 'duplicate' };
    }
  }

  const same = state.commands.find((c) => c.operationId === input.operationId);
  if (same) {
    const identical = same.entity === input.entity && same.entityId === input.entityId
      && same.kind === input.kind && stableJson(same.payload) === stableJson(payload);
    return identical ? { ok: true, state, effect: 'duplicate' } : { ok: false, reason: 'id_reused' };
  }

  const k = key(input.entity, input.entityId);
  if (state.tombstones[k] !== undefined && input.kind !== 'delete') {
    if (input.kind === 'create' && state.confirmedDeletes?.[k] !== undefined) {
      // Server CONFIRMED the delete; recreating the same id (undo, restore) is legitimate.
      return enqueue(clearTombstones(state, input.entity, [input.entityId]), input, userId, now);
    }
    return { ok: true, state, effect: 'dropped_tombstoned' };
  }

  // Pending and NOT in flight: only these can still be merged into under `merge` policy.
  const forEntity = state.commands.filter(
    (c) => c.entity === input.entity && c.entityId === input.entityId && c.status === 'pending' && !c.sending,
  );

  if (input.kind === 'create') {
    const priorCreate = [...forEntity].reverse().find((c) => c.kind === 'create');
    if (priorCreate) {
      const mergedPayload = input.policy?.coalesce === 'replace' ? payload : { ...priorCreate.payload, ...payload };
      const merged: OutboxCommand = {
        ...priorCreate,
        payload: mergedPayload,
        rev: (priorCreate.rev ?? 1) + 1,
      };
      return {
        ok: true,
        effect: 'merged',
        state: { ...state, commands: state.commands.map((c) => (c === priorCreate ? merged : c)) },
      };
    }
  }

  if (input.kind === 'update') {
    if (input.policy?.coalesce === 'replace') {
      // `replace` coalesces into a pending OR dead (never conflict, never sending) command for the same entity,
      // replacing its payload wholesale and resetting failure counters.
      const replaceTarget = [...state.commands]
        .reverse()
        .find(
          (c) =>
            c.entity === input.entity &&
            c.entityId === input.entityId &&
            !c.sending &&
            (c.status === 'pending' || c.status === 'dead') &&
            (c.kind === 'create' || c.kind === 'update'),
        );
      if (replaceTarget) {
        const replaced: OutboxCommand = {
          ...replaceTarget,
          payload,
          status: 'pending',
          attempts: 0,
          readyAt: 0,
          lastError: undefined,
          retryableCount: undefined,
          firstRetryableAt: undefined,
          ...(input.baseVersion !== undefined ? { baseVersion: input.baseVersion } : {}),
          rev: (replaceTarget.rev ?? 1) + 1,
        };
        return {
          ok: true,
          effect: 'merged',
          state: { ...state, commands: state.commands.map((c) => (c === replaceTarget ? replaced : c)) },
        };
      }
    } else {
      // Merge into a pending create or update of the same entity -- not yet sent.
      const target = [...forEntity].reverse().find((c) => c.kind === 'create' || c.kind === 'update');
      if (target) {
        const merged: OutboxCommand = {
          ...target,
          payload: { ...target.payload, ...payload },
          rev: (target.rev ?? 1) + 1,
        };
        return {
          ok: true,
          effect: 'merged',
          state: { ...state, commands: state.commands.map((c) => (c === target ? merged : c)) },
        };
      }
    }
  }

  if (input.kind === 'delete') {
    // User's delete intent supersedes ALL non-sending predecessors (pending, dead, conflict).
    const superseded = state.commands.filter((c) => c.entity === input.entity && c.entityId === input.entityId && !c.sending);
    const pendingCreate = superseded.find((c) => c.kind === 'create');
    const dropped = new Set(superseded.map((c) => c.operationId));
    if (pendingCreate) {
      // Server NEVER saw this entity: cascade-drop dependent commands (e.g. objective create -> key result).
      for (let grew = true; grew;) {
        grew = false;
        for (const c of state.commands) {
          if (!dropped.has(c.operationId) && !c.sending && c.dependsOn.some((d) => dropped.has(d))) {
            dropped.add(c.operationId);
            grew = true;
          }
        }
      }
    }
    const others = state.commands.filter((c) => !dropped.has(c.operationId));
    const settledAfterDrop = recordSettled(state.settled, [...dropped, ...(pendingCreate ? [input.operationId] : [])], now);
    if (pendingCreate) {
      // Never reached the server: do NOT add a tombstone (there is no server row to hide).
      return {
        ok: true,
        effect: 'cancelled',
        state: withSettled({ ...state, commands: others, nextSeq: state.nextSeq + 1 }, settledAfterDrop),
      };
    }
    const tombstones = pruneTombstones({ ...state.tombstones, [k]: state.nextSeq });
    const confirmedDeletes = state.confirmedDeletes?.[k] !== undefined
      ? Object.fromEntries(Object.entries(state.confirmedDeletes).filter(([ck]) => ck !== k))
      : state.confirmedDeletes;
    const del = makeCommand(state, input, payload, userId, now);
    const baseNext: OutboxState = {
      ...state,
      commands: [...others, del],
      tombstones,
      ...(confirmedDeletes !== undefined ? { confirmedDeletes } : {}),
      nextSeq: state.nextSeq + 1,
    };
    return {
      ok: true,
      effect: 'queued',
      state: withSettled(baseNext, settledAfterDrop),
    };
  }

  const cmd = makeCommand(state, input, payload, userId, now);
  let commands = [...state.commands, cmd];
  const maxPending = input.policy?.maxPending;
  if (maxPending !== undefined && maxPending > 0) {
    const pendingOfEntity = commands.filter((c) => c.entity === input.entity && c.status === 'pending' && !c.sending);
    if (pendingOfEntity.length > maxPending) {
      const dropCount = pendingOfEntity.length - maxPending;
      const oldestIds = new Set(
        [...pendingOfEntity]
          .sort((a, b) => a.seq - b.seq)
          .slice(0, dropCount)
          .map((c) => c.operationId),
      );
      commands = commands.filter((c) => !oldestIds.has(c.operationId));
    }
  }
  return { ok: true, effect: 'queued', state: { ...state, commands, nextSeq: state.nextSeq + 1 } };
}

export type ReplaceResult =
  | { ok: true; state: OutboxState; effect: 'queued' | 'merged' | 'duplicate' | 'cancelled' | 'dropped_tombstoned' }
  | { ok: false; reason: 'not_found' | 'id_reused' | 'wrong_account' };

/**
 * F46 (REP-12, INT-17): atomically drops `oldOperationId` (recording it in `settled` so another tab
 * cannot resurrect the old conflict command) and enqueues `input` in a single pure transition.
 */
export function replaceCommand(
  state: OutboxState,
  oldOperationId: string,
  input: EnqueueInput,
  userId: string,
  now: number,
): ReplaceResult {
  if (userId !== state.userId) return { ok: false, reason: 'wrong_account' };
  const existing = state.commands.find((c) => c.operationId === oldOperationId);
  if (!existing) return { ok: false, reason: 'not_found' };
  const withoutOld = withSettled(
    {
      ...state,
      commands: state.commands.filter((c) => c.operationId !== oldOperationId),
    },
    recordSettled(state.settled, [oldOperationId], now),
  );
  return enqueue(withoutOld, input, userId, now);
}

/**
 * F46 (SYN-10): pure multi-tab reconciliation of `local` memory and `disk` snapshot.
 */
export function mergeOutboxStates(
  local: OutboxState,
  disk: OutboxState,
  now: number,
  opts?: { authFrom?: 'local' | 'disk' },
): OutboxState {
  if (local.userId !== disk.userId) return local;

  const rawSettled: Record<string, number> = {};
  for (const [id, ts] of Object.entries(disk.settled ?? {})) {
    rawSettled[id] = ts;
  }
  for (const [id, ts] of Object.entries(local.settled ?? {})) {
    rawSettled[id] = rawSettled[id] !== undefined && rawSettled[id] > ts ? rawSettled[id] : ts;
  }

  const rawTombstones: Record<string, number> = { ...disk.tombstones };
  for (const [tk, seq] of Object.entries(local.tombstones)) {
    rawTombstones[tk] = rawTombstones[tk] !== undefined && rawTombstones[tk] > seq ? rawTombstones[tk] : seq;
  }

  let mergedConfirmed: Record<string, number> | undefined;
  if (local.confirmedDeletes || disk.confirmedDeletes) {
    mergedConfirmed = { ...(disk.confirmedDeletes ?? {}) };
    for (const [ck, ts] of Object.entries(local.confirmedDeletes ?? {})) {
      mergedConfirmed[ck] = mergedConfirmed[ck] !== undefined && mergedConfirmed[ck] > ts ? mergedConfirmed[ck] : ts;
    }
  }

  const byOpId = new Map<string, OutboxCommand>();
  for (const d of disk.commands) {
    byOpId.set(d.operationId, d);
  }
  for (const l of local.commands) {
    const d = byOpId.get(l.operationId);
    if (!d) {
      byOpId.set(l.operationId, l);
    } else {
      const lRev = l.rev ?? 1;
      const dRev = d.rev ?? 1;
      byOpId.set(l.operationId, lRev >= dRev ? l : d);
    }
  }

  const tombstones = pruneTombstones(rawTombstones);
  const surviving = [...byOpId.values()]
    .filter((c) => {
      if (rawSettled[c.operationId] !== undefined) return false;
      const tk = key(c.entity, c.entityId);
      if (tombstones[tk] !== undefined && c.kind !== 'delete') return false;
      return true;
    })
    .sort((a, b) => a.seq - b.seq || a.createdAt - b.createdAt || a.operationId.localeCompare(b.operationId));

  let prevSeq = 0;
  const renumbered = surviving.map((c) => {
    const seq = c.seq <= prevSeq ? prevSeq + 1 : c.seq;
    prevSeq = seq;
    return seq === c.seq ? c : { ...c, seq };
  });

  let maxTombSeq = 0;
  for (const v of Object.values(tombstones)) {
    if (v > maxTombSeq) maxTombSeq = v;
  }
  const nextSeq = Math.max(local.nextSeq, disk.nextSeq, prevSeq + 1, maxTombSeq + 1);
  const authBlocked = (opts?.authFrom ?? 'local') === 'disk' ? disk.authBlocked : local.authBlocked;
  const settled = boundSettledMap(Object.entries(rawSettled), now);

  const assembled: OutboxState = withSettled(
    {
      userId: local.userId,
      commands: renumbered,
      nextSeq,
      tombstones,
      ...(mergedConfirmed !== undefined ? { confirmedDeletes: mergedConfirmed } : {}),
      authBlocked,
    },
    settled,
  );
  return pruneSettled(pruneConfirmedTombstones(assembled, now), now);
}

/** Tombstones are kept for the most recent deletes only -- enough to stop late local edits. */
export const MAX_TOMBSTONES = 200;
export const CONFIRMED_TOMBSTONE_GRACE_MS = 5 * 60_000;

export function pruneConfirmedTombstones(state: OutboxState, now: number): OutboxState {
  const confirmed = state.confirmedDeletes;
  if (!confirmed) return state;
  const expired = Object.keys(confirmed).filter((k) => now - confirmed[k] >= CONFIRMED_TOMBSTONE_GRACE_MS);
  if (expired.length === 0) return state;
  const tombstones = { ...state.tombstones };
  const rest = { ...confirmed };
  for (const k of expired) {
    delete tombstones[k];
    delete rest[k];
  }
  return { ...state, tombstones, confirmedDeletes: rest };
}

/** User deliberately brought rows back (backup restore): drop tombstones and unsent deletes for them. */
export function clearTombstones(state: OutboxState, entity: string, ids: readonly string[]): OutboxState {
  const wanted = new Set(ids);
  const keys = ids.map((id) => key(entity, id)).filter((k) => state.tombstones[k] !== undefined || state.confirmedDeletes?.[k] !== undefined);
  const dropDeletes = state.commands.filter((c) => c.entity === entity && c.kind === 'delete' && wanted.has(c.entityId) && !c.sending);
  if (keys.length === 0 && dropDeletes.length === 0) return state;
  const tombstones = { ...state.tombstones };
  const confirmed = { ...(state.confirmedDeletes ?? {}) };
  for (const k of keys) {
    delete tombstones[k];
    delete confirmed[k];
  }
  const gone = new Set(dropDeletes.map((c) => c.operationId));
  return { ...state, tombstones, confirmedDeletes: confirmed, commands: state.commands.filter((c) => !gone.has(c.operationId)) };
}

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
    rev: 1,
  };
}

/**
 * The commands that may be sent now, in order. A command waits for every
 * command it depends on, and for every earlier command of the same entity,
 * that is still in the outbox -- whatever its status.
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
  return {
    ...state,
    commands: state.commands.map((c) =>
      c.operationId === operationId ? { ...c, sending: true, rev: (c.rev ?? 1) + 1 } : c,
    ),
  };
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

function confirmDelete(next: OutboxState, cmd: OutboxCommand, now: number): OutboxState {
  if (cmd.kind !== 'delete') return next;
  const k = key(cmd.entity, cmd.entityId);
  if (next.tombstones[k] === undefined) return next;
  return { ...next, confirmedDeletes: { ...(next.confirmedDeletes ?? {}), [k]: now } };
}

export function settle(state: OutboxState, operationId: string, outcome: DeliveryOutcome, now: number): OutboxState {
  const cmd = state.commands.find((c) => c.operationId === operationId);
  if (!cmd) return state;
  const rest = state.commands.filter((c) => c.operationId !== operationId);
  const replace = (patch: Partial<OutboxCommand>) => ({
    ...state,
    commands: state.commands.map((c) =>
      c === cmd ? { ...c, sending: false, rev: (c.rev ?? 1) + 1, ...patch } : c,
    ),
  });

  switch (outcome.kind) {
    case 'applied': {
      const v = outcome.version ?? null;
      const commands = v === null
        ? rest
        : rest.map((c) =>
            c.entity === cmd.entity && c.entityId === cmd.entityId && c.kind !== 'create'
              ? { ...c, baseVersion: v, rev: (c.rev ?? 1) + 1 }
              : c,
          );
      const nextSettled = recordSettled(state.settled, [operationId], now);
      return pruneSettled(
        pruneConfirmedTombstones(confirmDelete(withSettled({ ...state, commands }, nextSettled), cmd, now), now),
        now,
      );
    }
    case 'offline':
      return replace({}); // costs nothing; tried again on the next flush
    case 'auth':
      return { ...replace({}), authBlocked: true };
    case 'gone': {
      const nextSettled = recordSettled(state.settled, [operationId], now);
      return pruneSettled(
        pruneConfirmedTombstones(confirmDelete(withSettled({ ...state, commands: rest }, nextSettled), cmd, now), now),
        now,
      );
    }
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
      ? {
          ...c,
          status: 'pending',
          attempts: 0,
          readyAt: 0,
          lastError: undefined,
          retryableCount: undefined,
          firstRetryableAt: undefined,
          ...(baseVersion !== undefined ? { baseVersion } : {}),
          rev: (c.rev ?? 1) + 1,
        }
      : c)),
  };
}

/** The user chose to discard a command (their local change is given up; recorded in settled so another tab does not resurrect it). */
export function discard(state: OutboxState, operationId: string, now: number = Date.now()): OutboxState {
  const nextSettled = recordSettled(state.settled, [operationId], now);
  return withSettled(
    { ...state, commands: state.commands.filter((c) => c.operationId !== operationId) },
    nextSettled,
  );
}

/**
 * F05 (SYN-15): the soonest explicit `readyAt` of a pending command not in flight, or null.
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
 * change disappear before it is delivered.
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
