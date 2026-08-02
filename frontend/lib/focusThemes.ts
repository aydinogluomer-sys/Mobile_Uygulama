// Odak modu temaları — focus.tsx ve FocusThemeModal paylaşır.
// expo-linear-gradient yüklü olmadığından düz renk + overlay kullanılır.
import { colors } from './tokens';

export type FocusPreset = {
  id: string;
  label: string;
  bg: string;
  cardBg: string;
  accent: string;
};

export const FOCUS_PRESETS: FocusPreset[] = [
  { id: 'default', label: 'Varsayılan', bg: colors.bg, cardBg: colors.surface, accent: colors.primary },
  { id: 'forest', label: 'Orman', bg: '#071a10', cardBg: '#0d2018', accent: '#10b981' },
  { id: 'cosmic', label: 'Kozmik', bg: '#08080f', cardBg: '#0d0d1a', accent: '#8b5cf6' },
  { id: 'warm', label: 'Sıcak', bg: '#141008', cardBg: '#1c160a', accent: '#f59e0b' },
  { id: 'ocean', label: 'Okyanus', bg: '#07121a', cardBg: '#0d1a24', accent: '#06b6d4' },
  { id: 'sunset', label: 'Gün Batımı', bg: '#1a0c10', cardBg: '#241016', accent: '#fb7185' },
  { id: 'midnight', label: 'Gece', bg: '#0a0e1a', cardBg: '#111626', accent: '#60a5fa' },
  { id: 'rose', label: 'Gül', bg: '#190a14', cardBg: '#23101c', accent: '#ec4899' },
  { id: 'mono', label: 'Mono', bg: '#0d0d0d', cardBg: '#181818', accent: '#a1a1aa' },
];

export function presetById(id: string): FocusPreset {
  return FOCUS_PRESETS.find((p) => p.id === id) ?? FOCUS_PRESETS[0];
}

// Zemin koyuluğu (overlay) seviyeleri
export const OVERLAY_LEVELS: { label: string; value: number }[] = [
  { label: 'Yok', value: 0 },
  { label: 'Az', value: 0.15 },
  { label: 'Orta', value: 0.3 },
  { label: 'Çok', value: 0.45 },
];
