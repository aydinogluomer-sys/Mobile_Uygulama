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
  intentAsk: 'Bu oturumda ne bitmiş olsun?',
  intentHint: 'Tek satır yeter; boş bırakıp atlayabilirsin.',
  intentBreath: 'Bir nefes al, yavaşça ver.',
  intentRecallTitle: 'Niyetin buydu.',
  intentRecallAsk: 'Ne kadarı oldu?',
  intentAnswerYes: 'Evet',
  intentAnswerPartly: 'Biraz',
  intentAnswerNo: 'Bu sefer olmadı',
  intentAckYes: 'Güzel: niyetini tamamladın.',
  intentAckPartly: 'Biraz da ilerlemedir; bir sonraki adımı küçük tut.',
  intentAckNo: 'Olur. Her oturum bir deneme; bir sonrakine yeni bir niyet yazarsın.',
  interruptionAsk: 'Uygulamadan ayrılmıştın. Ne oldu?',
  interruptionNotification: 'Bildirim',
  interruptionSomeone: 'Biri geldi',
  interruptionSelf: 'Kendim kaçtım',
  interruptionSkip: 'Geç',
  flowDailyDoneTitle: 'Bugünlük yeterli',
  flowDailyDoneBody: 'Üç kart bir gün için iyi bir doz. Gerisi yarın; şimdi küçük bir eyleme geç.',
  flowDailyTry: 'Bunu bugün dene',
  flowDailyBack: 'Bugün ekranına dön',
  flowLowEnergyNote: 'Düşük enerji açık: hafif kartlar öne alındı.',
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
