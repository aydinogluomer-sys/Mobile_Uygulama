import type { Ymd } from './date';
import { foldTr } from './taskQuickAdd';

export type SmartListKey = 'today' | 'waiting' | 'quick';
export type SmartListDef = { key: SmartListKey; label: string; hint: string; empty: string };

/** Sıra: Bugün, Bekleyenler, 5 dakikalık. Metinlerde "gecikmiş" ve kırmızı yok. */
export const SMART_LISTS: readonly SmartListDef[] = [
  {
    key: 'today',
    label: 'Bugün',
    hint: 'Bugüne planlanan işler',
    empty: 'Bugün için planlanmış iş yok.',
  },
  {
    key: 'waiting',
    label: 'Bekleyenler',
    hint: 'Tarihi geçmiş, seni bekleyen işler',
    empty: 'Bekleyen iş yok.',
  },
  {
    key: 'quick',
    label: '5 dakikalık',
    hint: 'Kısa sürede bitebilecek işler',
    empty: 'Şu an 5 dakikalık iş yok.',
  },
];

export type SmartTaskLike = {
  id: string;
  title: string;
  description?: string | null;
  due_date?: string | null;
  estimated_minutes?: number | null;
  priority: 'high' | 'medium' | 'low' | 'none';
  completed: boolean;
  status: string;
  created_at?: string;
};

/** due_date'in gün kısmı (ilk 10 karakter; `timestamptz` yankısına dayanıklı). */
export function dueDay(value: string | null | undefined): string {
  if (typeof value !== 'string' || value.length < 10) return '';
  const day = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

const QUICK_MINUTE_RE = /(?:^|[^0-9.,])([1-5])\s*(?:dk|dak|dakika)(?:lik)?(?![a-z])/;

/** Başlıkta, açıklamada ya da estimated_minutes alanında 1-5 dakika diyen iş ("5 dk", "5dk", "5 dakikalık", "2 dk"). */
export function isQuickTask(t: Pick<SmartTaskLike, 'title' | 'description' | 'estimated_minutes'>): boolean {
  if (typeof t.estimated_minutes === 'number' && Number.isFinite(t.estimated_minutes)) {
    if (t.estimated_minutes >= 1 && t.estimated_minutes <= 5) return true;
    if (t.estimated_minutes > 5) return false;
  }
  const haystack = foldTr(`${t.title ?? ''} ${t.description ?? ''}`);
  return QUICK_MINUTE_RE.test(haystack);
}

const PRIORITY_RANK: Readonly<Record<SmartTaskLike['priority'], number>> = {
  high: 0,
  medium: 1,
  low: 2,
  none: 3,
};

/**
 * today: gün kısmı === today. waiting: gün kısmı < today. quick: isQuickTask.
 * Hepsi açık (tamamlanmamış, iptal değil). Sıra: öncelik, sonra waiting için en yeni tarih önce.
 * Girdiyi değiştirmez.
 */
export function filterSmartList<T extends SmartTaskLike>(
  key: SmartListKey,
  tasks: readonly T[],
  today: Ymd,
): T[] {
  const filtered = tasks.filter((t) => {
    if (t.completed || t.status === 'cancelled') return false;
    if (key === 'today') return dueDay(t.due_date) === today;
    if (key === 'waiting') {
      const d = dueDay(t.due_date);
      return d.length > 0 && d < today;
    }
    return isQuickTask(t);
  });

  return [...filtered].sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority] ?? 3;
    const pb = PRIORITY_RANK[b.priority] ?? 3;
    if (pa !== pb) return pa - pb;
    if (key === 'waiting') {
      const da = dueDay(a.due_date);
      const db = dueDay(b.due_date);
      if (da !== db) return db.localeCompare(da);
    }
    return 0;
  });
}
