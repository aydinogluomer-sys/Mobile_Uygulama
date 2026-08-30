import { colors } from '../lib/tokens';
// Günlük ruh hali ölçeği — journal, journal-archive ve journal-reader paylaşır.
export type Mood = { value: number; emoji: string; label: string; color: string };

export const MOODS: Mood[] = [
  { value: 1, emoji: '😔', label: 'Zor', color: colors.error },
  { value: 2, emoji: '😕', label: 'Yorgun', color: '#f97316' },
  { value: 3, emoji: '😐', label: 'Orta', color: colors.warning },
  { value: 4, emoji: '🙂', label: 'İyi', color: '#84cc16' },
  { value: 5, emoji: '😄', label: 'Harika', color: colors.success },
];

export function moodMeta(value: number | null | undefined): Mood | undefined {
  if (value == null) return undefined;
  return MOODS.find((m) => m.value === value);
}
