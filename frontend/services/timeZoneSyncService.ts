/**
 * F15 (DB2-11): silent background synchronization of the device's IANA time zone
 * to `profiles.time_zone` via `set_profile_time_zone`.
 *
 * Calm-Tech / Kintsugi contract:
 *  - Never blocks boot or logging, never surfaces UI or banners, never throws.
 *  - Memoizes `{ userId, zone }` in memory only (no AsyncStorage key): cold boot
 *    sends at most one lightweight RPC (a server no-op when `IS DISTINCT FROM` is false),
 *    and foreground transitions re-send only when the user actually changed zones.
 *  - If migration 043 is not applied yet (`missing_rpc`), stops trying for the rest
 *    of the session.
 *  - Clears memory on account boundaries via `registerAccountScoped`.
 */
import { registerAccountScoped } from '../lib/accountScope';
import { deviceTimeZone, isValidTimeZone } from '../lib/date';
import { setProfileTimeZone, type ProfileTimeZoneResult } from '../repositories/profileRepository';
import { currentUserId as defaultCurrentUserId } from '../repositories/shared';

export type TimeZoneSyncOutcome =
  | { status: 'synced'; zone: string }
  | { status: 'unchanged'; zone: string }
  | {
      status: 'skipped';
      reason:
        | 'no_zone'
        | 'invalid_zone'
        | 'no_session'
        | 'rpc_missing'
        | 'offline'
        | 'rejected'
        | 'in_flight';
    };

export type TimeZoneSyncDeps = {
  deviceZone: () => string | null;
  currentUserId: () => Promise<{ ok: true; userId: string } | { ok: false; error: string }>;
  push: (zone: string) => Promise<ProfileTimeZoneResult>;
};

let lastSynced: { userId: string; zone: string } | null = null;
let rpcMissing = false;
let inFlight: Promise<TimeZoneSyncOutcome> | null = null;

/** Hesap sınırında ve testlerde bellek notunu temizler (F04 kayıt defterine bağlanır). */
export function resetTimeZoneSyncMemory(): void {
  lastSynced = null;
  rpcMissing = false;
  inFlight = null;
}

registerAccountScoped({
  name: 'profileTimeZoneSync',
  onReset: resetTimeZoneSyncMemory,
});

async function runPush(
  resolved: TimeZoneSyncDeps,
  zone: string,
  userId: string,
): Promise<TimeZoneSyncOutcome> {
  try {
    const res = await resolved.push(zone);
    if (res.ok) {
      if (res.data.stored) {
        lastSynced = { userId, zone };
        return { status: 'synced', zone };
      }
      return { status: 'skipped', reason: 'rejected' };
    }
    if (res.kind === 'missing_rpc') {
      rpcMissing = true;
      return { status: 'skipped', reason: 'rpc_missing' };
    }
    if (res.kind === 'offline') {
      return { status: 'skipped', reason: 'offline' };
    }
    if (res.kind === 'unauthenticated') {
      return { status: 'skipped', reason: 'no_session' };
    }
    return { status: 'skipped', reason: 'rejected' };
  } catch {
    return { status: 'skipped', reason: 'rejected' };
  }
}

/** Aynı (kullanıcı, bölge) çifti oturum boyunca bir kez gönderilir; uçuştaki çağrı paylaşılır. */
export async function syncProfileTimeZone(
  deps?: Partial<TimeZoneSyncDeps>,
): Promise<TimeZoneSyncOutcome> {
  const resolved: TimeZoneSyncDeps = {
    deviceZone: deps?.deviceZone ?? deviceTimeZone,
    currentUserId: deps?.currentUserId ?? defaultCurrentUserId,
    push: deps?.push ?? setProfileTimeZone,
  };

  let rawZone: string | null;
  try {
    rawZone = resolved.deviceZone();
  } catch {
    return { status: 'skipped', reason: 'no_zone' };
  }
  if (rawZone === null) {
    return { status: 'skipped', reason: 'no_zone' };
  }
  if (!isValidTimeZone(rawZone)) {
    return { status: 'skipped', reason: 'invalid_zone' };
  }

  if (inFlight) {
    try {
      await inFlight;
    } catch {
      // never throws
    }
    return { status: 'skipped', reason: 'in_flight' };
  }

  const work = (async (): Promise<TimeZoneSyncOutcome> => {
    let u: { ok: true; userId: string } | { ok: false; error: string };
    try {
      u = await resolved.currentUserId();
    } catch {
      return { status: 'skipped', reason: 'no_session' };
    }
    if (!u.ok) {
      return { status: 'skipped', reason: 'no_session' };
    }
    if (lastSynced && lastSynced.userId === u.userId && lastSynced.zone === rawZone) {
      return { status: 'unchanged', zone: rawZone };
    }
    if (rpcMissing) {
      return { status: 'skipped', reason: 'rpc_missing' };
    }
    return runPush(resolved, rawZone, u.userId);
  })();

  inFlight = work;
  try {
    return await work;
  } finally {
    if (inFlight === work) {
      inFlight = null;
    }
  }
}
