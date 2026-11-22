import { parseLocalDate, type Ymd } from './date';
import { moodMeta } from './journalMoods';
import { MONTH_LONG_TR } from './yearGrid';

export const ARCHIVE_PREVIEW_CHARS = 240;

export const DAYS: readonly string[] = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
export const MONTHS: readonly string[] = MONTH_LONG_TR;

export type ArchiveRowModel = {
  id: string;
  date: Ymd;
  day: number;
  dow: string;
  monthLabel: string;
  year: number;
  mood: number | null;
  moodLabel: string | null;
  aiSummary: boolean;
  sourceLabel: string | null;
  preview: string; // <= 240 Unicode code points, newlines normalized to spaces, NO full content
};

export function sourceLabelOf(content: string): string | null {
  const match = content.trim().match(/^\[(.+?)\]/);
  return match ? match[1] : null;
}

export function previewOf(content: string, max = ARCHIVE_PREVIEW_CHARS): string {
  if (!content || max <= 0) return '';
  const singleLine = content.replace(/\r\n|\r|\n/g, ' ');
  const codePoints = Array.from(singleLine);
  return codePoints.length <= max ? singleLine : codePoints.slice(0, max).join('');
}

export function toArchiveRowModel(e: {
  id: string;
  date: string;
  content: string;
  mood: number | null;
  ai_summary: boolean | null;
}): ArchiveRowModel {
  const dt = parseLocalDate(e.date);
  const day = dt ? dt.getDate() : Number(e.date.slice(8, 10)) || 1;
  const dow = dt ? DAYS[dt.getDay()] : '';
  const monthIdx = dt
    ? dt.getMonth()
    : Math.max(0, Math.min(11, (Number(e.date.slice(5, 7)) || 1) - 1));
  const year = dt ? dt.getFullYear() : Number(e.date.slice(0, 4)) || 0;
  const meta = moodMeta(e.mood);

  return {
    id: e.id,
    date: e.date,
    day,
    dow,
    monthLabel: MONTHS[monthIdx],
    year,
    mood: e.mood ?? null,
    moodLabel: meta ? meta.label : null,
    aiSummary: Boolean(e.ai_summary),
    sourceLabel: sourceLabelOf(e.content ?? ''),
    preview: previewOf(e.content ?? ''),
  };
}
