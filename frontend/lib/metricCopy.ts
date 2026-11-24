/**
 * F13 — Calm-Tech Turkish copy for insufficient-data states, AI digest
 * guidance, and non-shaming recovery nudges (INT-07, DOM-23).
 */

export const INSUFFICIENT_COPY = Object.freeze({
  rate: 'Bu dönem için henüz yeterli gün yok.',
  weekday: 'En iyi ve en zayıf gün için en az 3 haftalık kayıt gerekir.',
  trend: 'Trend için en az 14 günlük kayıt gerekir.',
  strength: 'En güçlü alışkanlık için en az 10 kayıt gerekir.',
  fragility: 'Oynaklık için en az 3 haftalık veri gerekir.',
  recovery: 'Telafi oranı için en az bir tamamlanmış telafi gerekir.',
} as const);

export const DIGEST_PREAMBLE =
  'Aşağıdaki sayılar yalnızca gözlenen örüntüleri gösterir. Neden-sonuç iddiası kurma, tahmin yürütme ve suçlayıcı dil kullanma. Örnek küçükse bunu açıkça söyle. Verideki örüntüyü sakin bir dille anlat ve küçük, uygulanabilir tek bir öneri ver.';

export const RETURN_NUDGE_TITLE = 'Küçük bir dönüş';

export function returnNudgeOne(name: string, days: number): string {
  return `"${name}" için son ${days} gün boş geçti. İstersen bugün küçük bir adımla yeniden başla.`;
}

export function returnNudgeMany(count: number): string {
  return `${count} alışkanlıkta birkaç gündür kayıt yok. Küçük bir adım, yeniden başlamak için yeter.`;
}

export const BACKLOG_BADGE_PENDING = 'Bekleyen';
export const BACKLOG_BADGE_PARTIAL = 'Kısmi';

export function backlogMoreLabel(hidden: number): string {
  return `Daha fazla göster (${hidden})`;
}

export type InsufficientKind = keyof typeof INSUFFICIENT_COPY;

/**
 * User-facing insufficient-data copy. Returns `INSUFFICIENT_COPY[kind]` when
 * `kind` is given, or falls back to the raw developer `reason` when `kind` is
 * omitted.
 */
export function insufficientText(kind: InsufficientKind | undefined, reason: string): string {
  return kind ? INSUFFICIENT_COPY[kind] : reason;
}
