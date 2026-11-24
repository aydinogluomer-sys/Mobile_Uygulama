import type { Ymd } from './date';
import { moodMeta } from './journalMoods';
import { MONTH_LONG_TR, MONTH_SHORT_TR } from './yearGrid';

export const JOURNAL_FETCH_LIMIT = 365;

export const YEAR_PIXELS_SCOPE_NOTE_DEVICE =
  "Bu cihazdaki check-in'ler ve tüm günlük kayıtların gösterilir.";
export const YEAR_PIXELS_SCOPE_NOTE = YEAR_PIXELS_SCOPE_NOTE_DEVICE;
export const YEAR_PIXELS_TRUNCATED_NOTE = 'Yalnızca son 365 kayıt gösteriliyor.';

export type PixelState = 'mood' | 'empty' | 'future';
export type PixelMood = 1 | 2 | 3 | 4 | 5;

export type PixelCell = {
  date: Ymd;
  day: number;
  state: PixelState;
  mood: PixelMood | null;
};

export type PixelMonth = {
  month: number; // 0..11
  label: string; // 'Oca'
  cells: PixelCell[]; // exact days in month (never padded to 31)
  entryDays: number;
  averageMood: number | null; // 1..5 unrounded float; null when entryDays === 0
};

export type YearPixelsModel = {
  year: number;
  months: PixelMonth[]; // 12
  loggedDays: number;
  distribution: Record<PixelMood, number>;
};

/** Dominant mood: mean valence rounded half-up to nearest integer, clamped to 1..5. */
export function valenceToMood(v: number): PixelMood {
  if (!Number.isFinite(v)) return 3;
  const rounded = Math.round(v);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as PixelMood;
}

/** moods: dailyMoods output (may span multiple years; only entries inside `year` are included). */
export function buildYearPixels(p: {
  year: number;
  moods: readonly { date: string; mood: number | null }[];
  todayYmd: Ymd;
}): YearPixelsModel {
  const yearStr = String(p.year).padStart(4, '0');
  const prefix = `${yearStr}-`;

  const moodByDate = new Map<string, number | null>();
  for (const item of p.moods) {
    if (typeof item.date === 'string' && item.date.startsWith(prefix)) {
      const m = typeof item.mood === 'number' && Number.isFinite(item.mood) ? item.mood : null;
      moodByDate.set(item.date, m);
    }
  }

  const distribution: Record<PixelMood, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let loggedDays = 0;
  const months: PixelMonth[] = [];

  for (let month = 0; month < 12; month++) {
    const daysInMonth = new Date(p.year, month + 1, 0).getDate();
    const monthStr = String(month + 1).padStart(2, '0');
    const cells: PixelCell[] = [];
    let entryDays = 0;
    let valenceSum = 0;

    for (let day = 1; day <= daysInMonth; day++) {
      const date: Ymd = `${yearStr}-${monthStr}-${String(day).padStart(2, '0')}`;
      if (date > p.todayYmd) {
        cells.push({ date, day, state: 'future', mood: null });
        continue;
      }

      const rawMood = moodByDate.get(date) ?? null;
      if (rawMood !== null) {
        const mood = valenceToMood(rawMood);
        cells.push({ date, day, state: 'mood', mood });
        entryDays += 1;
        valenceSum += rawMood;
        loggedDays += 1;
        distribution[mood] += 1;
      } else {
        cells.push({ date, day, state: 'empty', mood: null });
      }
    }

    months.push({
      month,
      label: MONTH_SHORT_TR[month],
      cells,
      entryDays,
      averageMood: entryDays > 0 ? valenceSum / entryDays : null,
    });
  }

  return {
    year: p.year,
    months,
    loggedDays,
    distribution,
  };
}

export function yearPixelsSummaryText(m: YearPixelsModel): string {
  if (m.loggedDays === 0) {
    return `${m.year}: henüz ruh hali kaydı yok.`;
  }
  const moodsOrder: readonly PixelMood[] = [1, 2, 3, 4, 5];
  let bestMood: PixelMood = 3;
  let bestCount = -1;
  for (const k of moodsOrder) {
    if (m.distribution[k] > bestCount) {
      bestCount = m.distribution[k];
      bestMood = k;
    }
  }
  const topLabel = moodMeta(bestMood)?.label ?? 'Orta';
  return `${m.year}: ${m.loggedDays} gün kayıt; en sık ruh hali ${topLabel}.`;
}

export function monthSummaryText(m: PixelMonth): string {
  const monthName = MONTH_LONG_TR[m.month] ?? m.label;
  if (m.entryDays === 0 || m.averageMood === null) {
    return `${monthName}: kayıt yok`;
  }
  const moodLabel = moodMeta(valenceToMood(m.averageMood))?.label ?? 'Orta';
  return `${monthName}: ${m.entryDays} gün kayıt, ortalama ${moodLabel}`;
}
