import AsyncStorage from '@react-native-async-storage/async-storage';

export const NOTE_MAX_LENGTH = 280;
export const NOTE_COUNTER_FROM = 240;

/**
 * undefined -> undefined (dokunma);
 * boş/yalnız boşluk/null -> null (sil);
 * aksi: NFC, satır sonları/sekme tek boşluk, kalan denetim karakterleri (\p{C}) ayıklanmış,
 * kırpılmış, en çok 280 kod noktası (vekil çift bölünmez).
 */
export function normalizeNote(raw: string | null | undefined): string | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'string') return null;

  const cleaned = raw
    .normalize('NFC')
    .replace(/[ \t]*[\r\n]+[ \t]*/g, ' ')
    .replace(/\t+/g, ' ')
    .replace(/\p{C}/gu, '')
    .trim();

  if (cleaned.length === 0) return null;

  const cps = Array.from(cleaned);
  if (cps.length <= NOTE_MAX_LENGTH) return cleaned;
  const sliced = cps.slice(0, NOTE_MAX_LENGTH).join('').trimEnd();
  return sliced.length === 0 ? null : sliced;
}

export function previewNote(note: string | null | undefined, max = 80): string {
  const clean = normalizeNote(note ?? null);
  if (!clean) return '';
  const limit = Math.max(1, max);
  const cps = Array.from(clean);
  if (cps.length <= limit) return clean;
  if (limit === 1) return '…';
  return `${cps.slice(0, limit - 1).join('').trimEnd()}…`;
}

export const noteHintKey = (userId: string): string => `habitNote.hint.v1.${userId}`;

export async function readNoteHintSeen(userId: string): Promise<boolean> {
  if (!userId) return true;
  try {
    const val = await AsyncStorage.getItem(noteHintKey(userId));
    return val === '1';
  } catch {
    return false;
  }
}

export async function markNoteHintSeen(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await AsyncStorage.setItem(noteHintKey(userId), '1');
  } catch {
    // best-effort local hint flag
  }
}
