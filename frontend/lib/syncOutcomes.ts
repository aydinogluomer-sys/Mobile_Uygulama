/**
 * E06 — Shared sync & write outcome contract, repository failure taxonomy,
 * field-level conflict diffing, and cross-account late-response guard.
 *
 * Pure `lib/` module: zero dependencies on `repositories/`, `services/`, or `store/`.
 */
import { stableJson, type OutboxCommand } from './outbox';
import type { SettleReport } from './outboxEngine';

export type SyncOutcomeStatus = 'pending' | 'committed' | 'conflict' | 'retryable' | 'permanent';

export type SyncFieldDiff = {
  field: string;
  localValue: unknown;
  serverValue: unknown;
};

export type SyncConflictResolution = 'keep_local' | 'accept_server' | 're_edit';

export type RepoFailureCategory =
  | 'network'
  | 'auth'
  | 'missing_schema'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'server';

export type RepoFailureClassification = {
  status: 'retryable' | 'permanent' | 'conflict';
  category: RepoFailureCategory;
  reason: string;
};

const TRANSPORT_MSG_RE =
  /network request failed|failed to fetch|load failed|network error|request timed out|aborted|çevrimdışı/i;
const MISSING_SCHEMA_CODES = new Set(['42703', '42P01', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);
const MISSING_SCHEMA_MSG_RE =
  /does not exist|schema cache|could not find.*(?:column|table|function)|unknown column|undefined column/i;
const VALIDATION_CODES = new Set(['23514', '23502', '23503', '22P02', '22023']);
const CONFLICT_CODES = new Set(['23505', '40001', 'CAS_EXHAUSTED']);
const VOLATILE_DIFF_FIELDS = new Set(['id', 'user_id', 'created_at', 'updated_at']);
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T/;

function isTransientHttpStatus(status: number | undefined): boolean {
  if (typeof status !== 'number') return false;
  return status === 408 || status === 425 || status === 429 || (status >= 500 && status <= 599);
}

/**
 * Classifies a failed repository call so callers never conflate:
 * - lost connectivity (`network` -> `retryable`),
 * - unapplied DB migration / missing column/table/RPC (`missing_schema` -> `permanent`),
 * - deleted / missing server record (`not_found` -> `permanent`),
 * - auth expiry vs RLS refusal (`auth`),
 * - version/unique collisions (`conflict`),
 * - check/constraint errors (`validation`).
 */
export function classifyRepoFailure(res: {
  ok: false;
  offline?: boolean;
  status?: number;
  code?: string;
  error: string;
}): RepoFailureClassification {
  const code = res.code ?? '';
  const status = res.status;
  const reason = res.error;

  const hasPositiveHttpStatus = typeof status === 'number' && status > 0;
  if (res.offline === true || status === 0 || (!hasPositiveHttpStatus && TRANSPORT_MSG_RE.test(reason))) {
    return { status: 'retryable', category: 'network', reason };
  }

  if (code === '42501' || status === 403 || /oturum başka bir hesaba ait/i.test(reason)) {
    return { status: 'permanent', category: 'auth', reason };
  }
  if (status === 401 || code === 'PGRST301' || /jwt|oturum bulunamadı/i.test(reason)) {
    return { status: 'retryable', category: 'auth', reason };
  }

  if (MISSING_SCHEMA_CODES.has(code) || MISSING_SCHEMA_MSG_RE.test(reason)) {
    return { status: 'permanent', category: 'missing_schema', reason };
  }

  if (
    status === 409 ||
    status === 412 ||
    CONFLICT_CODES.has(code) ||
    /conflict|çakışma|başka bir yerde değiştirilmiş/i.test(reason)
  ) {
    return { status: 'conflict', category: 'conflict', reason };
  }

  if (status === 404 || status === 410 || code === 'PGRST116' || /not found|bulunamadı|gone/i.test(reason)) {
    return { status: 'permanent', category: 'not_found', reason };
  }

  if (VALIDATION_CODES.has(code) || status === 400 || status === 422) {
    return { status: 'permanent', category: 'validation', reason };
  }

  if (isTransientHttpStatus(status)) {
    return { status: 'retryable', category: 'server', reason };
  }

  return { status: 'permanent', category: 'server', reason };
}

function valuesMatch(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'string' && typeof b === 'string' && ISO_INSTANT_RE.test(a) && ISO_INSTANT_RE.test(b)) {
    const ta = Date.parse(a);
    const tb = Date.parse(b);
    if (!Number.isNaN(ta) && !Number.isNaN(tb)) return ta === tb;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    return stableJson(a) === stableJson(b);
  }
  return false;
}

/**
 * Field-by-field diff between the user's local write intent and the latest server row.
 * Volatile bookkeeping columns (`id`, `user_id`, `created_at`, `updated_at`) and `undefined`
 * keys omitted from the intent are excluded so only genuine domain disagreements surface.
 */
export function diffConflictingRecord(
  localIntent: Record<string, unknown>,
  serverRow: Record<string, unknown>,
): SyncFieldDiff[] {
  const diffs: SyncFieldDiff[] = [];
  for (const field of Object.keys(localIntent)) {
    if (VOLATILE_DIFF_FIELDS.has(field)) continue;
    const localValue = localIntent[field];
    if (localValue === undefined) continue;
    const serverValue = field in serverRow ? serverRow[field] : undefined;
    if (!valuesMatch(localValue, serverValue)) {
      diffs.push({ field, localValue, serverValue });
    }
  }
  return diffs;
}

/** Maps a single outbox command (or absence once settled) onto `SyncOutcomeStatus`. */
export function mapCommandToSyncOutcome(
  cmd: Pick<OutboxCommand, 'status' | 'retryableCount'> | null | undefined,
  opts?: { authBlocked?: boolean },
): SyncOutcomeStatus {
  if (!cmd) return 'committed';
  if (cmd.status === 'conflict') return 'conflict';
  if (cmd.status === 'dead') return 'permanent';
  if (opts?.authBlocked || (cmd.retryableCount ?? 0) > 0) return 'retryable';
  return 'pending';
}

/** Maps a `SettleReport['outcome']` onto `SyncOutcomeStatus`. */
export function mapSettleToSyncOutcome(outcome: SettleReport['outcome']): SyncOutcomeStatus {
  switch (outcome) {
    case 'applied':
    case 'gone':
      return 'committed';
    case 'conflict':
      return 'conflict';
    case 'dead':
      return 'permanent';
    case 'retryable':
    case 'auth':
    case 'rejected':
      return 'retryable';
    case 'offline':
      return 'pending';
  }
}

/**
 * Drops late async responses belonging to an earlier account epoch or foreign user id
 * so Account A's delayed completion can never mutate Account B's state.
 */
export function guardAccountResponse<T>(params: {
  capturedEpoch: number;
  currentEpoch: number;
  capturedUserId: string;
  activeUserId: string | null;
  apply: () => T;
}): { applied: true; value: T } | { applied: false; reason: 'epoch_changed' | 'account_mismatch' } {
  if (params.capturedEpoch !== params.currentEpoch) {
    return { applied: false, reason: 'epoch_changed' };
  }
  if (!params.activeUserId || params.activeUserId !== params.capturedUserId) {
    return { applied: false, reason: 'account_mismatch' };
  }
  return { applied: true, value: params.apply() };
}
