/**
 * `willpower_state` data access.  (plan §5 Rule 4; F14 REP-08, REP-09, STO-15)
 *
 * Keyed on `(user_id, state_date)` — one row per user per day.
 * - `fetchOrCreateWillpowerState` coalesces concurrent reads per `${userId}|${date}`
 *   and upserts with `{ onConflict: 'user_id,state_date', ignoreDuplicates: true }`
 *   followed by an explicit-column `select` so concurrent cold-start reads never
 *   clobber an already-spent row.
 * - `spendWillpower` invokes the atomic `spend_willpower` RPC (migration 042)
 *   and remembers `PGRST202`/`42883` for the session so pre-042 deployments fall
 *   back cleanly without repeating a missing-RPC round trip.
 */
import { registerAccountScoped } from '../lib/accountScope';
import type { TableRow } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { currentUserId, isTransportFailure, type RepoResult } from './shared';

export type WillpowerStateRow = TableRow<'willpower_state'>;

export const WILLPOWER_STATE_COLUMNS =
  'user_id,state_date,daily_budget,used,focus_capacity,active_count';

const DEFAULTS = { daily_budget: 15, used: 0, focus_capacity: 3, active_count: 0 };

export type SpendWillpowerInput = {
  day: string;
  amount: number;
  activeDelta?: number;
  clamp?: boolean;
};

export type WillpowerRpcKind =
  | 'budget_exceeded'
  | 'invalid'
  | 'missing_rpc'
  | 'unauthenticated'
  | 'unknown';

export type SpendWillpowerResult =
  | { ok: true; data: WillpowerStateRow }
  | { ok: false; error: string; kind: WillpowerRpcKind; offline?: boolean };

const inFlightReads = new Map<string, Promise<RepoResult<WillpowerStateRow>>>();
let rpcMissing = false;

export function resetWillpowerRepositoryMemory(): void {
  inFlightReads.clear();
  rpcMissing = false;
}

async function runFetchOrCreate(
  userId: string,
  date: string,
): Promise<RepoResult<WillpowerStateRow>> {
  try {
    const up = await supabase
      .from('willpower_state')
      .upsert(
        { user_id: userId, state_date: date, ...DEFAULTS },
        { onConflict: 'user_id,state_date', ignoreDuplicates: true },
      );
    if (up.error) {
      const offline = isTransportFailure(up.status, up.error);
      return offline
        ? { ok: false, error: up.error.message, offline: true }
        : { ok: false, error: up.error.message };
    }

    const selected = await supabase
      .from('willpower_state')
      .select(WILLPOWER_STATE_COLUMNS)
      .eq('user_id', userId)
      .eq('state_date', date)
      .maybeSingle();
    if (selected.error) {
      const offline = isTransportFailure(selected.status, selected.error);
      return offline
        ? { ok: false, error: selected.error.message, offline: true }
        : { ok: false, error: selected.error.message };
    }
    if (!selected.data) {
      return { ok: false, error: 'İrade durumu bulunamadı.' };
    }
    return { ok: true, data: selected.data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const offline = isTransportFailure(null, err);
    return offline ? { ok: false, error: msg, offline: true } : { ok: false, error: msg };
  }
}

/** Today's row, creating it idempotently with table defaults if the day is new. */
export async function fetchOrCreateWillpowerState(
  date: string,
): Promise<RepoResult<WillpowerStateRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;

  const key = `${u.userId}|${date}`;
  const existingPromise = inFlightReads.get(key);
  if (existingPromise) return existingPromise;

  const p = runFetchOrCreate(u.userId, date).finally(() => {
    inFlightReads.delete(key);
  });
  inFlightReads.set(key, p);
  return p;
}

export async function spendWillpower(
  input: SpendWillpowerInput,
): Promise<SpendWillpowerResult> {
  if (rpcMissing || typeof supabase?.rpc !== 'function') {
    rpcMissing = true;
    return { ok: false, kind: 'missing_rpc', error: 'spend_willpower RPC mevcut değil.' };
  }

  try {
    const res = await supabase.rpc('spend_willpower', {
      p_day: input.day,
      p_amount: input.amount,
      ...(input.activeDelta !== undefined ? { p_active_delta: input.activeDelta } : {}),
      ...(input.clamp !== undefined ? { p_clamp: input.clamp } : {}),
    });

    if (res.error) {
      const code = res.error.code ?? '';
      const msg = res.error.message ?? 'İrade güncellenemedi.';
      if (code === 'PGRST202' || code === '42883') {
        rpcMissing = true;
        return { ok: false, kind: 'missing_rpc', error: msg };
      }
      if (code === 'P0001' && /willpower_budget_exceeded/i.test(msg)) {
        return { ok: false, kind: 'budget_exceeded', error: msg };
      }
      if (code === '22023') {
        return { ok: false, kind: 'invalid', error: msg };
      }
      if (code === '42501') {
        return { ok: false, kind: 'unauthenticated', error: msg };
      }
      const offline = isTransportFailure(res.status, res.error);
      return offline
        ? { ok: false, kind: 'unknown', error: msg, offline: true }
        : { ok: false, kind: 'unknown', error: msg };
    }

    const row = Array.isArray(res.data) ? res.data[0] : res.data;
    if (!row) {
      return { ok: false, kind: 'unknown', error: 'İrade durumu bulunamadı.' };
    }
    return { ok: true, data: row };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const offline = isTransportFailure(null, err);
    return offline
      ? { ok: false, kind: 'unknown', error: msg, offline: true }
      : { ok: false, kind: 'unknown', error: msg };
  }
}

export async function updateWillpowerState(
  date: string,
  patch: Partial<Pick<WillpowerStateRow, 'used' | 'active_count' | 'daily_budget' | 'focus_capacity'>>,
): Promise<RepoResult<WillpowerStateRow>> {
  const u = await currentUserId();
  if (!u.ok) return u;
  const { data, error, status } = await supabase
    .from('willpower_state')
    .update(patch)
    .eq('user_id', u.userId)
    .eq('state_date', date)
    .select(WILLPOWER_STATE_COLUMNS)
    .maybeSingle();
  if (error) {
    const offline = isTransportFailure(status, error);
    return offline
      ? { ok: false, error: error.message, offline: true }
      : { ok: false, error: error.message };
  }
  if (!data) return { ok: false, error: 'İrade durumu bulunamadı.' };
  return { ok: true, data };
}

registerAccountScoped({
  name: 'willpowerRepository',
  onReset: resetWillpowerRepositoryMemory,
});
