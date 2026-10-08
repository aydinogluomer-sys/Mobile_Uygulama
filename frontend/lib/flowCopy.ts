/**
 * R03.07 — the three short in-flow explanations, in one place:
 * "ilk adımı seç", "yükü hafiflet", "mola sonrası dön".
 *
 * Plain guidance, never a clinical claim: no diagnosis, therapy or treatment
 * words, no promise about health. Rendered with the app's existing text and
 * accessibility system (no separate content platform). Pinned by
 * __tests__/lib/flowCopy.test.ts.
 */
import { addDaysLocal, parseLocalDate, ymd } from './date';
import type { PauseInterval } from './habitPauses';

export const FLOW_COPY = {
  firstStep: 'İlk adımı seç: şimdi yapabileceğin, bitişi belli tek bir şey.',
  lighten: 'Bugün kenara koyacaklarını seç. Bu yalnız bugünü etkiler: hedeflerin ve takvimin değişmez, tamamlama oranın düşmez, serin bozulmaz — ama bugün uzamaz da.',
  afterBreakTitle: 'Aradan dönüş',
  afterBreak: 'Aradan döndün. Hepsini birden değil, bugün bir tanesini küçük başlat; gerisi takvimde yerinde duruyor.',
  afterFocusBreak: 'Moladan dönüş: kaldığın işe tek bir küçük adımla gir — ilk dakikayı seç, gerisi gelir.',
} as const;

/**
 * A dated break or holiday that ended in the last `withinDays` days (and none
 * is running today). Returns the one that ended most recently, or null.
 */
export function recentlyEndedBreak(pauses: readonly PauseInterval[], today: string, withinDays = 2): PauseInterval | null {
  const t = parseLocalDate(today);
  if (!t) return null;
  if (pauses.some((p) => p.start_date <= today && (p.end_date === null || p.end_date >= today))) return null;
  const earliest = ymd(addDaysLocal(t, -withinDays));
  const ended = pauses.filter((p) => p.end_date !== null && p.end_date < today && p.end_date >= earliest);
  if (ended.length === 0) return null;
  return [...ended].sort((a, b) => (a.end_date! < b.end_date! ? 1 : -1))[0];
}

/** Back on a work phase after at least one finished pomodoro, not yet started. */
export function isBackFromFocusBreak(s: { phase: string; status: string; sessionsCompleted: number }): boolean {
  return s.phase === 'work' && s.status === 'idle' && s.sessionsCompleted > 0;
}
