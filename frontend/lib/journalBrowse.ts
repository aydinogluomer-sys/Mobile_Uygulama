/**
 * R07.03 — browsing the journal: search and a month calendar, over the
 * entries the device holds (pure; no new storage, no attachments).
 *
 * Search is Turkish-aware: "İ/ı" and "I/i" fold the Turkish way, so "ilaç"
 * finds "İLAÇ" and "ırmak" finds "IRMAK"; a #tag in the query also matches
 * the entry's tags.
 */
import { addDaysLocal, parseLocalDate, ymd } from './date';

export type BrowseEntry = { id: string; date: string; content: string; mood: number | null };

const fold = (s: string) => s.toLocaleLowerCase('tr-TR').normalize('NFC');

/** Entries whose text contains every word of the query (any order), newest first. */
export function searchEntries<E extends BrowseEntry>(entries: readonly E[], query: string): E[] {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries
    .filter((e) => { const t = fold(e.content); return words.every((w) => t.includes(w)); })
    .sort((a, b) => b.date.localeCompare(a.date));
}

export type CalendarDay = { date: string; inMonth: boolean; entryId: string | null; mood: number | null };

/**
 * The month as Monday-first weeks (the app's week start), every day of the
 * month present, padded with the neighbouring months' days. A day carries
 * its entry (one per day) when there is one.
 */
export function monthGrid<E extends BrowseEntry>(entries: readonly E[], year: number, month: number): CalendarDay[][] {
  const byDate = new Map(entries.map((e) => [e.date, e] as const));
  const first = new Date(year, month - 1, 1);
  const mondayIndex = (first.getDay() + 6) % 7;
  let cursor = addDaysLocal(first, -mondayIndex);
  const weeks: CalendarDay[][] = [];
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      const ds = ymd(cursor);
      const e = byDate.get(ds);
      week.push({ date: ds, inMonth: cursor.getMonth() === month - 1, entryId: e?.id ?? null, mood: e?.mood ?? null });
      cursor = addDaysLocal(cursor, 1);
    }
    if (w >= 4 && !week.some((x) => x.inMonth)) break;
    weeks.push(week);
  }
  return weeks;
}

/** The previous / next month of a YYYY-MM key. */
export function shiftMonth(ym: string, delta: number): string {
  const d = parseLocalDate(`${ym}-01`) ?? new Date();
  const n = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  return ymd(n).slice(0, 7);
}
