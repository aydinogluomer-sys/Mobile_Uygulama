/**
 * R08.02 — a small, automatic, LOCAL backup rotation and its honest status.
 *
 * - At most `LOCAL_BACKUP_KEEP` copies on the device; the oldest go first,
 *   but the most recent COMPLETE copy is never evicted by newer incomplete
 *   ones (a truncated or partly-failed export does not push out the last
 *   good one).
 * - "Last success" moves only when a COMPLETE copy was written and read back.
 * - It runs when the app is opened (at most once a day). Nothing runs in the
 *   background: if the app was not opened, there is no new copy, and the
 *   status says when the last one really was -- never "yedeklendi" for a day
 *   the OS did not run it.
 *
 * Pure.
 */
export const LOCAL_BACKUP_KEEP = 3;
export const LOCAL_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** After a failed attempt, wait this long before trying again on the next open. */
export const LOCAL_BACKUP_RETRY_MS = 60 * 60 * 1000;
export const LOCAL_BACKUP_MAX_BYTES = 1_000_000;
export const LOCAL_BACKUP_TOTAL_BYTES = 2_400_000;

/** UTF-8 bayt sayısı (`text.length` karakter sayar, Türkçe ve emoji için yanlıştır). */
export const utf8Bytes = (text: string): number => new TextEncoder().encode(text).length;

export type BackupSlot = { key: string; created_at: string; complete: boolean; bytes: number };

export type LocalBackupStatus = {
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  slots: BackupSlot[];
};

export const EMPTY_STATUS: LocalBackupStatus = { lastSuccessAt: null, lastAttemptAt: null, lastError: null, slots: [] };

/** Is a copy due now? */
export function shouldRun(s: LocalBackupStatus, now: Date): boolean {
  const t = now.getTime();
  if (s.lastAttemptAt && s.lastError && t - Date.parse(s.lastAttemptAt) < LOCAL_BACKUP_RETRY_MS) return false;
  if (!s.lastSuccessAt) return true;
  return t - Date.parse(s.lastSuccessAt) >= LOCAL_BACKUP_INTERVAL_MS;
}

/** Add a slot; return what to keep (newest first) and which stored keys to delete. */
export function rotate(slots: readonly BackupSlot[], added: BackupSlot, keep = LOCAL_BACKUP_KEEP): { slots: BackupSlot[]; drop: string[] } {
  const all = [added, ...slots.filter((s) => s.key !== added.key)].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const lastComplete = all.find((s) => s.complete);
  const kept: BackupSlot[] = [];
  for (const s of all) {
    if (kept.length < keep) kept.push(s);
  }
  // the newest complete copy survives even if `keep` newer incomplete ones exist
  if (lastComplete && !kept.includes(lastComplete)) { kept.pop(); kept.push(lastComplete); }
  const keptKeys = new Set(kept.map((s) => s.key));
  return { slots: kept, drop: all.filter((s) => !keptKeys.has(s.key)).map((s) => s.key) };
}

/**
 * Yeni kopya yazılmadan ÖNCE hangi eski kopyalar silinmeli. En yeni TAM kopya korunur (yeni kopya doğrulanana
 * dek tek geçerli yedek odur). Bütçeye sığmak mümkün değilse `fits: false` (yazma yapılmaz).
 */
export function planEviction(
  slots: readonly BackupSlot[],
  incomingBytes: number,
  totalBudget = LOCAL_BACKUP_TOTAL_BYTES,
): { drop: string[]; fits: boolean } {
  const ordered = [...slots].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const protectedKey = ordered.find((s) => s.complete)?.key;
  let total = incomingBytes + ordered.reduce((n, s) => n + s.bytes, 0);
  const drop: string[] = [];
  for (const s of [...ordered].reverse()) {
    if (total <= totalBudget) break;
    if (s.key === protectedKey) continue;
    drop.push(s.key);
    total -= s.bytes;
  }
  return { drop, fits: total <= totalBudget };
}

const ago = (ms: number) => {
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return 'az önce';
  if (h < 48) return `${h} saat önce`;
  return `${Math.floor(h / 24)} gün önce`;
};

/** The one line the settings screen shows. */
export function statusText(s: LocalBackupStatus, now: Date): string {
  const complete = s.slots.filter((x) => x.complete).length;
  const base = s.lastSuccessAt
    ? `Son tam yerel yedek: ${ago(now.getTime() - Date.parse(s.lastSuccessAt))} (cihazda ${complete} tam kopya).`
    : 'Henüz tam bir yerel yedek yok.';
  if (s.lastError && s.lastAttemptAt && (!s.lastSuccessAt || s.lastAttemptAt > s.lastSuccessAt)) {
    return `${base} Son deneme başarısız: ${s.lastError}`;
  }
  return base;
}
