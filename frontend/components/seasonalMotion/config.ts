// Seasonal Ambient Motion — 12 ay tek source-of-truth config (contract §7)
// Değerler implementation.md'deki "Suggested config" bloklarından birebir alındı.
import type { MonthNameTR, SeasonalMotionConfig, SeasonalMotionIntensity } from './types';

export const DEFAULT_SEASONAL_MOTION_INTENSITY: SeasonalMotionIntensity = 'subtle';

export const MONTH_NAMES_TR: MonthNameTR[] = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/** 0–11 ay indeksini Türkçe ay adına çevirir (sınır dışı değerleri sarmalar). */
export function monthNameFromIndex(index: number): MonthNameTR {
  return MONTH_NAMES_TR[((index % 12) + 12) % 12];
}

/** Ajanda "kapak" başlığı için ay-bazlı mevsim mottosu (mevsim kimliğini güçlendirir). */
export const MONTH_TAGLINES_TR: string[] = [
  'Taze başlangıç, sessiz kış',
  'Kışın sonu, lavanta ayazı',
  'İlkbaharın uyanışı',
  'Tomurcuk ayı, yumuşak bahar',
  'Olgun bahar, dolu çiçek',
  'Yaz başlangıcı, açık gökyüzü',
  'Yazın zirvesi, deniz ışığı',
  'Sıcak Akdeniz, altın otlar',
  'Yazdan güze, sakin sabah',
  'Tam sonbahar, kehribar yapraklar',
  'Geç sonbahar, sis ve dinginlik',
  'Yıl sonu, sıcak ışıklar',
];

export const SEASONAL_MOTION_BY_MONTH: Record<MonthNameTR, SeasonalMotionConfig> = {
  Ocak: {
    month: 'Ocak',
    effects: ['snow', 'iceSparkle'],
    particleCount: { subtle: 14, normal: 24 },
    opacity: { subtle: 0.16, normal: 0.24 },
    speed: 'slow',
    drift: 'slight',
  },
  Şubat: {
    month: 'Şubat',
    effects: ['frostDust', 'softSnow'],
    particleCount: { subtle: 10, normal: 18 },
    opacity: { subtle: 0.14, normal: 0.22 },
    speed: 'verySlow',
    drift: 'diagonalSoft',
  },
  Mart: {
    month: 'Mart',
    effects: ['pollenDrift', 'waterGlint'],
    particleCount: { subtle: 10, normal: 18 },
    opacity: { subtle: 0.13, normal: 0.2 },
    speed: 'slow',
    drift: 'springBreeze',
  },
  Nisan: {
    month: 'Nisan',
    effects: ['petalDrift', 'softLightSpeck'],
    particleCount: { subtle: 8, normal: 15 },
    opacity: { subtle: 0.14, normal: 0.22 },
    speed: 'slow',
    drift: 'gentle',
  },
  Mayıs: {
    month: 'Mayıs',
    effects: ['leafSway', 'bloomShimmer', 'pollenMotes'],
    particleCount: { subtle: 12, normal: 22 },
    opacity: { subtle: 0.12, normal: 0.19 },
    speed: 'slow',
    drift: 'warmBreeze',
  },
  Haziran: {
    month: 'Haziran',
    effects: ['summerAir', 'waterShimmer'],
    particleCount: { subtle: 10, normal: 20 },
    opacity: { subtle: 0.11, normal: 0.18 },
    speed: 'slow',
    drift: 'horizontalSoft',
  },
  Temmuz: {
    month: 'Temmuz',
    effects: ['seaSparkle', 'subtleHeatShimmer'],
    particleCount: { subtle: 12, normal: 24 },
    opacity: { subtle: 0.13, normal: 0.21 },
    speed: 'mediumSlow',
    drift: 'none',
  },
  Ağustos: {
    month: 'Ağustos',
    effects: ['goldenDust', 'oliveSway', 'heatHaze'],
    particleCount: { subtle: 10, normal: 18 },
    opacity: { subtle: 0.12, normal: 0.2 },
    speed: 'verySlow',
    drift: 'dryWarmWind',
  },
  Eylül: {
    month: 'Eylül',
    effects: ['transitionLeafDrift', 'softMist'],
    particleCount: { subtle: 7, normal: 14 },
    opacity: { subtle: 0.12, normal: 0.2 },
    speed: 'slow',
    drift: 'coolBreeze',
  },
  Ekim: {
    month: 'Ekim',
    effects: ['autumnLeafFall', 'amberDust'],
    particleCount: { subtle: 9, normal: 18 },
    opacity: { subtle: 0.15, normal: 0.24 },
    speed: 'slow',
    drift: 'fallBreeze',
  },
  Kasım: {
    month: 'Kasım',
    effects: ['slowFog', 'fineDrizzle'],
    particleCount: { subtle: 8, normal: 16 },
    opacity: { subtle: 0.1, normal: 0.18 },
    speed: 'verySlow',
    drift: 'mistHorizontal',
  },
  Aralık: {
    month: 'Aralık',
    effects: ['softSnow', 'warmLightPulse', 'winterStarSparkle'],
    particleCount: { subtle: 14, normal: 28 },
    opacity: { subtle: 0.16, normal: 0.25 },
    speed: 'slow',
    drift: 'gentleSnow',
  },
};

export function getSeasonalConfig(month: MonthNameTR): SeasonalMotionConfig {
  return SEASONAL_MOTION_BY_MONTH[month];
}
