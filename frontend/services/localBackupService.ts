/**
 * R08.02 / F20 (SYN-11) — the automatic local backup copy (see lib/backupRotation
 * for the rules). Enforces a per-copy and total UTF-8 byte budget BEFORE writing
 * to AsyncStorage so outbox queues are never starved, and reads back + verifies
 * before counting a copy as complete.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { verifyBackupText } from '../lib/backupFormat';
import {
  EMPTY_STATUS,
  LOCAL_BACKUP_MAX_BYTES,
  planEviction,
  rotate,
  shouldRun,
  utf8Bytes,
  type LocalBackupStatus,
} from '../lib/backupRotation';
import { currentUser } from '../lib/session';
import { buildBackup, isBackupComplete } from './exportService';

export const statusKey = (uid: string) => `backup.local.v1.${uid}.status`;
const slotKey = (uid: string, iso: string) => `backup.local.v1.${uid}.${iso}`;

export async function loadLocalBackupStatus(uid: string): Promise<LocalBackupStatus> {
  try {
    const raw = await AsyncStorage.getItem(statusKey(uid));
    const o = raw ? JSON.parse(raw) : null;
    return o && Array.isArray(o.slots) ? { ...EMPTY_STATUS, ...o } : EMPTY_STATUS;
  } catch {
    return EMPTY_STATUS;
  }
}

export type LocalBackupResult =
  | { ok: true; status: LocalBackupStatus; complete: boolean }
  | { ok: false; error: string; status: LocalBackupStatus };

/** Make a copy now. Success is recorded only for a complete copy that was written and read back. */
export async function runLocalBackup(now: Date = new Date()): Promise<LocalBackupResult> {
  const me = await currentUser();
  if (!me) return { ok: false, error: 'Oturum yok.', status: EMPTY_STATUS };
  const prev = await loadLocalBackupStatus(me.id);
  const attempt = now.toISOString();
  let currentSlots = prev.slots;
  const fail = async (error: string): Promise<LocalBackupResult> => {
    const status = { ...prev, slots: currentSlots, lastAttemptAt: attempt, lastError: error };
    try {
      await AsyncStorage.setItem(statusKey(me.id), JSON.stringify(status));
    } catch {
      /* status is best effort */
    }
    return { ok: false, error, status };
  };
  const key = slotKey(me.id, attempt);
  try {
    const backup = await buildBackup(now, { userId: me.id });
    const text = JSON.stringify(backup);
    const bytes = utf8Bytes(text);
    if (bytes > LOCAL_BACKUP_MAX_BYTES) {
      return fail("Yedek yerel depo için çok büyük; Ayarlar'dan dışa aktararak paylaş.");
    }
    const ev = planEviction(prev.slots, bytes);
    if (!ev.fits) {
      return fail("Cihaz depolamasında yedek için yer yok; Ayarlar'dan dışa aktararak paylaş.");
    }
    if (ev.drop.length) {
      await AsyncStorage.multiRemove(ev.drop);
      currentSlots = prev.slots.filter((s) => !ev.drop.includes(s.key));
    }
    const complete = isBackupComplete(backup);
    await AsyncStorage.setItem(key, text);
    // read back: a copy that cannot be verified is not a backup
    const back = await AsyncStorage.getItem(key);
    if (!back || back !== text || (complete && !verifyBackupText(back, me.id).ok)) {
      await AsyncStorage.removeItem(key);
      return fail('Kopya geri okunup doğrulanamadı.');
    }
    const r = rotate(currentSlots, { key, created_at: attempt, complete, bytes });
    if (r.drop.length) await AsyncStorage.multiRemove(r.drop);
    const status: LocalBackupStatus = {
      slots: r.slots,
      lastAttemptAt: attempt,
      lastSuccessAt: complete ? attempt : prev.lastSuccessAt,
      lastError: complete ? null : `Kopya eksik (${[...backup.truncated, ...backup.failed.map((f) => f.collection)].join(', ')}).`,
    };
    await AsyncStorage.setItem(statusKey(me.id), JSON.stringify(status));
    return { ok: true, status, complete };
  } catch (e) {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      /* ignore cleanup failure */
    }
    return fail(e instanceof Error ? e.message : 'Yerel yedek yazılamadı (cihaz depolaması dolu olabilir).');
  }
}

/** On app open: a copy if one is due. Never in the background. */
export async function maybeRunDailyLocalBackup(now: Date = new Date()): Promise<LocalBackupResult | null> {
  const me = await currentUser();
  if (!me) return null;
  const status = await loadLocalBackupStatus(me.id);
  if (!shouldRun(status, now)) return null;
  return runLocalBackup(now);
}

/** The newest COMPLETE local copy, for the restore check. */
export async function latestCompleteLocalBackup(): Promise<{ text: string; created_at: string } | null> {
  const me = await currentUser();
  if (!me) return null;
  const status = await loadLocalBackupStatus(me.id);
  const slot = status.slots.find((s) => s.complete);
  if (!slot) return null;
  const text = await AsyncStorage.getItem(slot.key);
  return text ? { text, created_at: slot.created_at } : null;
}
