/**
 * R08.02 — the automatic local backup copy (see lib/backupRotation for the
 * rules). The copy is the same versioned JSON as the shared export, stored in
 * this app's own storage (app sandbox; see R08_BACKUP_PROTECTION.md for what
 * that does and does not protect), and read back + verified before it counts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { buildBackup } from './exportService';
import { verifyBackupText } from '../lib/backupFormat';
import { EMPTY_STATUS, rotate, shouldRun, type LocalBackupStatus } from '../lib/backupRotation';
import { currentUser } from '../lib/session';

export const statusKey = (uid: string) => `backup.local.v1.${uid}.status`;
const slotKey = (uid: string, iso: string) => `backup.local.v1.${uid}.${iso}`;

export async function loadLocalBackupStatus(uid: string): Promise<LocalBackupStatus> {
  try {
    const raw = await AsyncStorage.getItem(statusKey(uid));
    const o = raw ? JSON.parse(raw) : null;
    return o && Array.isArray(o.slots) ? { ...EMPTY_STATUS, ...o } : EMPTY_STATUS;
  } catch { return EMPTY_STATUS; }
}

export type LocalBackupResult = { ok: true; status: LocalBackupStatus; complete: boolean } | { ok: false; error: string; status: LocalBackupStatus };

/** Make a copy now. Success is recorded only for a complete copy that was written and read back. */
export async function runLocalBackup(now: Date = new Date()): Promise<LocalBackupResult> {
  const me = await currentUser();
  if (!me) return { ok: false, error: 'Oturum yok.', status: EMPTY_STATUS };
  const prev = await loadLocalBackupStatus(me.id);
  const attempt = now.toISOString();
  const fail = async (error: string): Promise<LocalBackupResult> => {
    const status = { ...prev, lastAttemptAt: attempt, lastError: error };
    try { await AsyncStorage.setItem(statusKey(me.id), JSON.stringify(status)); } catch { /* status is best effort */ }
    return { ok: false, error, status };
  };
  try {
    const backup = await buildBackup(now, { userId: me.id });
    const text = JSON.stringify(backup);
    const complete = backup.failed.length === 0 && backup.truncated.length === 0;
    const key = slotKey(me.id, attempt);
    await AsyncStorage.setItem(key, text);
    // read back: a copy that cannot be verified is not a backup
    const back = await AsyncStorage.getItem(key);
    if (!back || !verifyBackupText(back, me.id).ok) {
      if (complete) { await AsyncStorage.removeItem(key); return fail('Kopya geri okunup doğrulanamadı.'); }
    }
    const r = rotate(prev.slots, { key, created_at: attempt, complete, bytes: text.length });
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
