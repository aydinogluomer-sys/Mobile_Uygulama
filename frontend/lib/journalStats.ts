// Günlük yazılarının "raporu" — saf hesap, arşiv başlığında kullanılır.
import type { JournalEntry } from '../store/journalStore';
import { ymd, ymLocal, startOfWeekLocal } from './date';

export type JournalStats = {
  total: number;       // toplam kayıt
  streak: number;      // ardışık günlük yazma serisi (bugünden/dünden geriye)
  thisMonth: number;   // bu ayki kayıt sayısı
  aiCount: number;     // AI'dan özetlenen kayıt sayısı
  moodAvg: number | null;
};


export type InsightPeriod = 'weekly' | 'monthly' | 'yearly';

// Dönem penceresi: önbellek anahtarı, etiket ve "bu tarih bu döneme girer mi" testi.
// weekly: bu haftanın Pazartesi'si · monthly: 'YYYY-MM' · yearly: 'YYYY'
export function periodWindow(
  period: InsightPeriod,
  now: Date = new Date(),
): { key: string; label: string; match: (dateStr: string) => boolean } {
  if (period === 'monthly') {
    const ym = ymLocal(now);
    return { key: ym, label: 'Bu ay', match: (d) => d.startsWith(ym) };
  }
  if (period === 'yearly') {
    const y = `${now.getFullYear()}`;
    return { key: y, label: 'Bu yıl', match: (d) => d.startsWith(`${y}-`) };
  }
  // weekly — Pazartesi başlangıçlı hafta
  const start = ymd(startOfWeekLocal(now));
  const end = ymd(now);
  return { key: start, label: 'Bu hafta', match: (d) => d >= start && d <= end };
}

export function computeJournalStats(
  entries: JournalEntry[],
  now: Date = new Date(),
): JournalStats {
  const total = entries.length;
  const aiCount = entries.filter((e) => e.ai_summary).length;

  const moods = entries.map((e) => e.mood).filter((m): m is number => m != null);
  const moodAvg = moods.length ? moods.reduce((a, b) => a + b, 0) / moods.length : null;

  const ym = ymLocal(now);
  const thisMonth = entries.filter((e) => e.date.startsWith(ym)).length;

  // Seri: bugünden geriye ardışık kayıtlı günler. Bugün boşsa dünden başla.
  const dateSet = new Set(entries.map((e) => e.date));
  const cursor = new Date(now);
  if (!dateSet.has(ymd(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (dateSet.has(ymd(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return { total, streak, thisMonth, aiCount, moodAvg };
}
