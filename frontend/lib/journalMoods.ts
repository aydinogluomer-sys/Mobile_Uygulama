// Günlük ruh hali ölçeği — journal, journal-archive ve journal-reader paylaşır.
export type Mood = { value: number; emoji: string; label: string; color: string };

export const MOODS: Mood[] = [
  { value: 1, emoji: '😔', label: 'Zor', color: '#C76A6A' },
  { value: 2, emoji: '😕', label: 'Yorgun', color: '#f97316' },
  { value: 3, emoji: '😐', label: 'Orta', color: '#D4A84A' },
  { value: 4, emoji: '🙂', label: 'İyi', color: '#84cc16' },
  { value: 5, emoji: '😄', label: 'Harika', color: '#87A678' },
];

export function moodMeta(value: number | null | undefined): Mood | undefined {
  if (value == null) return undefined;
  return MOODS.find((m) => m.value === value);
}
