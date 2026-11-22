/**
 * Editöryel "Bugün" anlatısı — gerçek günlük veriden sakin, serif başlık üretir.
 * Atlas dil sistemi: anlatısal başlık + vurgu (em) + alt-metin. Saf/deterministik fonksiyon.
 * İlham: personal-os-v2 (8).html · atl-bugun-hero.
 */

export type NarrativeInput = {
  /** 0–23 saat (yerel) */
  hour: number;
  overdueCount: number;
  todayTaskCount: number;
  remainingHabits: number;
  totalHabits: number;
  focusSessions: number;
};

export type TodayNarrative = {
  /** vurgudan önceki düz metin */
  lead: string;
  /** clay aksanıyla vurgulanan ifade */
  emphasis: string;
  /** vurgudan sonraki düz metin */
  tail: string;
  /** alt satır — sakin yönlendirme */
  sub: string;
};

function timeSub(hour: number, focusSessions: number): string {
  if (focusSessions > 0) {
    return `Bugün ${focusSessions} odak seansı tamamlandı; ritmi koru.`;
  }
  if (hour < 12) return 'Güne kısa bir odak bloğuyla başla.';
  if (hour < 18) return 'Bir odak bloğu aç ve ilerlemeyi sürdür.';
  return 'Günü sakin bir kapanışla bitir.';
}

export const OVERDUE_CALM_LIMIT = 5;

/** Önceliklendirme: gecikmiş > bugünkü görev > kalan alışkanlık > tamamlandı. */
export function buildTodayNarrative(input: NarrativeInput): TodayNarrative {
  const { hour, overdueCount, todayTaskCount, remainingHabits, totalHabits, focusSessions } = input;
  const sub = timeSub(hour, focusSessions);

  if (overdueCount > OVERDUE_CALM_LIMIT) {
    return {
      lead: 'Birikmiş işler var; ',
      emphasis: 'bugün yalnız birini',
      tail: ' seç.',
      sub,
    };
  }
  if (overdueCount > 0) {
    return {
      lead: 'Bugün önce ',
      emphasis: `${overdueCount} gecikmiş işi`,
      tail: ' sakin biçimde topla.',
      sub,
    };
  }
  if (todayTaskCount > 0) {
    return {
      lead: 'Bugün ',
      emphasis: `${todayTaskCount} planlı görevi`,
      tail: ' net bir akışla bitir.',
      sub,
    };
  }
  if (remainingHabits > 0) {
    return {
      lead: 'Bugün ',
      emphasis: `${remainingHabits} alışkanlık`,
      tail: ' seni bekliyor; hazır olduğunda başla.',
      sub,
    };
  }
  if (totalHabits > 0) {
    return {
      lead: 'Masadaki işler ',
      emphasis: 'tamamlandı',
      tail: ' — sıradaki odağı planla.',
      sub,
    };
  }
  return {
    lead: 'Bugüne ',
    emphasis: 'temiz bir sayfa',
    tail: ' ile başla.',
    sub,
  };
}
