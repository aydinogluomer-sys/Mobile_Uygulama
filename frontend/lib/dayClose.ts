import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerAccountStorage } from './accountScope';
import { addDaysLocal, parseLocalDate, ymd, type Ymd } from './date';

/** Yerel saat bu değerden önceyse kapanış önceki takvim gününe sayılır. */
export const DAY_ROLLOVER_HOUR = 4;
/** Modalda en çok gösterilen görev satırı. */
export const CLOSE_LIST_LIMIT = 5;
/** Kayıttaki sayaçların üst sınırı (bozuk kaydı elemek için). */
export const MAX_RECORD_COUNT = 999;

export const dayCloseKey = (userId: string): string => `aderyth:day_close:v1:${userId}`;

export type DayCloseRecord = {
  v: 1;
  /** Kapatılan günün YEREL tarihi (closingDayFor). */
  date: Ymd;
  /** Yarına taşınan görev sayısı. Bırakılanlar sayılmaz. */
  movedCount: number;
  /** Kapanış anında bugün için hafifletilmiş (skip) ritüel sayısı. */
  easedCount: number;
  /** ISO an; yalnız tanılama, arayüzde gösterilmez. */
  closedAt: string;
};

export type CloseDecision = 'tomorrow' | 'release';
export type CloseListType = 'inbox' | 'this_week' | 'someday';

export type CloseTaskLike = {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low' | 'none';
  due_date?: string | null;
  created_at?: string;
  completed: boolean;
  status: string;
};

export type MovePatch = { due_date: string | null; list_type?: 'someday' };

export const DAY_CLOSE_COPY = {
  moodPrompt: 'Bugün nasıldı?',
  tasksTitle: 'Açık kalanlar',
  tomorrow: 'Yarına',
  release: 'Bırak',
  tomorrowDone: 'Yarına bıraktın, sorun değil.',
  releaseDone: 'Bir Gün listesinde bekliyor; silinmedi.',
  undo: 'Geri al',
  moveAll: 'Bunları yarına taşı',
  moreHidden: 'Geri kalanlar Görevler ekranında bekliyor.',
  empty: 'Açık kalan iş yok.',
  waitingForSync: 'Eşitlenince uygulanacak.',
} as const;

const PRIORITY_RANK: Readonly<Record<CloseTaskLike['priority'], number>> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

const COUNT_WORDS: readonly string[] = [
  '',
  'bir',
  'iki',
  'üç',
  'dört',
  'beş',
  'altı',
  'yedi',
  'sekiz',
  'dokuz',
  'on',
];

function priorityRank(priority: CloseTaskLike['priority']): number {
  return PRIORITY_RANK[priority] ?? 3;
}

function isValidCount(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_RECORD_COUNT
  );
}

function clampCount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(MAX_RECORD_COUNT, Math.max(0, Math.floor(value)));
}

/** 04:00 kuralı: 00:00-03:59 arası önceki günün kapanışıdır. */
export function closingDayFor(now: Date): Ymd {
  return now.getHours() < DAY_ROLLOVER_HOUR ? ymd(addDaysLocal(now, -1)) : ymd(now);
}

/** Takvim günü aritmetiği (addDaysLocal); ay, yıl ve artık gün sınırlarında doğru. */
export function dayAfter(day: Ymd): Ymd {
  const parsed = parseLocalDate(day);
  if (!parsed) return day;
  return ymd(addDaysLocal(parsed, 1));
}

/** due_date değerinin gün kısmı (ilk 10 karakter); boş ya da bozuksa ''. */
export function dueDayOf(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length < 10) return '';
  const head = value.slice(0, 10);
  return parseLocalDate(head) !== null ? head : '';
}

/** Aday kümesi: gün kısmı <= closingDay, açık, iptal değil. Sıra: öncelik, due gün artan, created_at artan. Girdiyi değiştirmez. */
export function selectCloseCandidates<T extends CloseTaskLike>(
  tasks: readonly T[],
  closingDay: Ymd,
): T[] {
  const candidates = tasks.filter((t) => {
    if (t.completed || t.status === 'cancelled') return false;
    const due = dueDayOf(t.due_date);
    return due !== '' && due <= closingDay;
  });

  return [...candidates].sort((a, b) => {
    const pDiff = priorityRank(a.priority) - priorityRank(b.priority);
    if (pDiff !== 0) return pDiff;
    const dueA = dueDayOf(a.due_date);
    const dueB = dueDayOf(b.due_date);
    if (dueA !== dueB) return dueA < dueB ? -1 : 1;
    const createdA = a.created_at ?? '';
    const createdB = b.created_at ?? '';
    if (createdA !== createdB) return createdA < createdB ? -1 : 1;
    return 0;
  });
}

export function visibleCandidates<T>(
  sorted: readonly T[],
  limit: number = CLOSE_LIST_LIMIT,
): { rows: T[]; hasMore: boolean } {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : CLOSE_LIST_LIMIT;
  const rows = sorted.slice(0, safeLimit);
  return {
    rows,
    hasMore: sorted.length > rows.length,
  };
}

/** tomorrow: { due_date: <yarın> }. release: { list_type: 'someday', due_date: null } (silme yok). */
export function movePatch(decision: CloseDecision, tomorrow: Ymd): MovePatch {
  if (decision === 'tomorrow') {
    return { due_date: tomorrow };
  }
  return { list_type: 'someday', due_date: null };
}

export function undoPatch(prev: {
  due_date: string | null;
  list_type: CloseListType;
}): { due_date: string | null; list_type: CloseListType } {
  return {
    due_date: prev.due_date,
    list_type: prev.list_type,
  };
}

/** Bozuk, sürümü farklı ya da sınır dışı kayıt null döner. */
export function parseDayClose(raw: string | null): DayCloseRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    if (obj.v !== 1) return null;
    if (typeof obj.date !== 'string' || parseLocalDate(obj.date) === null) return null;
    if (!isValidCount(obj.movedCount) || !isValidCount(obj.easedCount)) return null;
    if (
      typeof obj.closedAt !== 'string' ||
      obj.closedAt.length === 0 ||
      Number.isNaN(Date.parse(obj.closedAt))
    ) {
      return null;
    }
    return {
      v: 1,
      date: obj.date,
      movedCount: obj.movedCount,
      easedCount: obj.easedCount,
      closedAt: obj.closedAt,
    };
  } catch {
    return null;
  }
}

/** Aynı tarih: movedCount toplanır (üst sınır MAX_RECORD_COUNT), easedCount sonuncunun değeridir. Farklı tarih: yeni kayıt. */
export function mergeDayClose(
  prev: DayCloseRecord | null,
  next: Omit<DayCloseRecord, 'v'>,
): DayCloseRecord {
  if (prev && prev.date === next.date) {
    return {
      v: 1,
      date: next.date,
      movedCount: clampCount(prev.movedCount + next.movedCount),
      easedCount: clampCount(next.easedCount),
      closedAt: next.closedAt,
    };
  }
  return {
    v: 1,
    date: next.date,
    movedCount: clampCount(next.movedCount),
    easedCount: clampCount(next.easedCount),
    closedAt: next.closedAt,
  };
}

/** Sabah yankısı. null: gösterme. Rakam içermez (sayılar yazıyla). */
export function dayCloseEchoLine(rec: DayCloseRecord | null, now: Date): string | null {
  if (!rec) return null;
  const today = closingDayFor(now);
  const parsedToday = parseLocalDate(today);
  if (!parsedToday) return null;
  const yesterday = ymd(addDaysLocal(parsedToday, -1));
  if (rec.date !== yesterday) return null;

  const n = clampCount(rec.movedCount);
  if (n <= 0) return 'Dün günü kapattın.';
  if (n <= 10) {
    return `Dün günü kapattın; ${COUNT_WORDS[n]} işi bugüne taşıdın.`;
  }
  return 'Dün günü kapattın; işlerini bugüne taşıdın.';
}

export async function loadDayClose(userId: string): Promise<DayCloseRecord | null> {
  if (!userId) return null;
  try {
    const raw = await AsyncStorage.getItem(dayCloseKey(userId));
    return parseDayClose(raw);
  } catch {
    return null;
  }
}

/** Yazılamazsa false; asla throw etmez. */
export async function saveDayClose(userId: string, rec: DayCloseRecord): Promise<boolean> {
  if (!userId) return false;
  try {
    await AsyncStorage.setItem(dayCloseKey(userId), JSON.stringify(rec));
    return true;
  } catch {
    return false;
  }
}

/** F36 akşam hatırlatıcısı "gün kapatıldıysa o gün iptal" için okuma noktası. */
export async function isDayClosedOn(userId: string, day: Ymd): Promise<boolean> {
  if (!userId || parseLocalDate(day) === null) return false;
  const rec = await loadDayClose(userId);
  return rec !== null && rec.date === day;
}

registerAccountStorage({
  name: 'dayClose',
  transient: false,
  keysFor: (uid) => [dayCloseKey(uid)],
});
