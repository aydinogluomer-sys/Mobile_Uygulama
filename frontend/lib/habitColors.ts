import { contrastRatio, habitHues, type HabitHue } from './tokens';

export type { HabitHue };
export { contrastRatio };

export const HABIT_HUES: readonly HabitHue[] = habitHues;
export const MIN_HUE_CONTRAST = 3;

export function isHabitHue(hex: string | null | undefined): boolean {
  if (typeof hex !== 'string' || hex.length === 0) return false;
  const lower = hex.toLowerCase();
  return HABIT_HUES.some((h) => h.hex.toLowerCase() === lower);
}

export function hueLabel(hex: string | null | undefined): string {
  if (hex == null || hex === '') return 'Varsayılan';
  const lower = hex.toLowerCase();
  const found = HABIT_HUES.find((h) => h.hex.toLowerCase() === lower);
  return found ? found.label : 'Özel renk';
}
