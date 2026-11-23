/**
 * Editöryel "Bugün" anlatısı — gerçek günlük veriden sakin, serif başlık üretir.
 * Atlas dil sistemi: anlatısal başlık + vurgu (em) + alt-metin. Saf/deterministik fonksiyon.
 * İlham: personal-os-v2 (8).html · atl-bugun-hero.
 */
import { t } from './i18n';

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
    return t('today.narrative.sub.focused', { count: focusSessions });
  }
  if (hour < 12) return t('today.narrative.sub.morning');
  if (hour < 18) return t('today.narrative.sub.afternoon');
  return t('today.narrative.sub.evening');
}

export const OVERDUE_CALM_LIMIT = 5;

/** Önceliklendirme: gecikmiş > bugünkü görev > kalan alışkanlık > tamamlandı. */
export function buildTodayNarrative(input: NarrativeInput): TodayNarrative {
  const { hour, overdueCount, todayTaskCount, remainingHabits, totalHabits, focusSessions } = input;
  const sub = timeSub(hour, focusSessions);

  if (overdueCount > OVERDUE_CALM_LIMIT) {
    return {
      lead: t('today.narrative.calm.lead'),
      emphasis: t('today.narrative.calm.emphasis'),
      tail: t('today.narrative.calm.tail'),
      sub,
    };
  }
  if (overdueCount > 0) {
    return {
      lead: t('today.narrative.overdue.lead'),
      emphasis: t('today.narrative.overdue.emphasis', { count: overdueCount }),
      tail: t('today.narrative.overdue.tail'),
      sub,
    };
  }
  if (todayTaskCount > 0) {
    return {
      lead: t('today.narrative.tasks.lead'),
      emphasis: t('today.narrative.tasks.emphasis', { count: todayTaskCount }),
      tail: t('today.narrative.tasks.tail'),
      sub,
    };
  }
  if (remainingHabits > 0) {
    return {
      lead: t('today.narrative.habits.lead'),
      emphasis: t('today.narrative.habits.emphasis', { count: remainingHabits }),
      tail: t('today.narrative.habits.tail'),
      sub,
    };
  }
  if (totalHabits > 0) {
    return {
      lead: t('today.narrative.done.lead'),
      emphasis: t('today.narrative.done.emphasis'),
      tail: t('today.narrative.done.tail'),
      sub,
    };
  }
  return {
    lead: t('today.narrative.fresh.lead'),
    emphasis: t('today.narrative.fresh.emphasis'),
    tail: t('today.narrative.fresh.tail'),
    sub,
  };
}
