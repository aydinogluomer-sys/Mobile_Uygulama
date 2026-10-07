/**
 * R05.06 — one duration contract for the two places focus time is recorded.
 *
 *  - `tabs/focus` (pomodoro) writes `focus_sessions.completed_seconds`,
 *    measured by `lib/focusTimer.ts`: running segments only.
 *  - `screens/deep-work` writes `deep_work_sessions.duration_minutes`, typed
 *    in by the user after the fact.
 *
 * Both mean the same thing -- ACTIVE focus time. A break is not focus: the
 * pomodoro clock does not run during a pause, a break phase writes no
 * session row at all (`focusStore.advancePhase` records only `work`), and
 * the manual entry asks for time with breaks left out. Neither source
 * awards XP. The two are kept as separate totals on purpose: a user who
 * logs a pomodoro and ALSO types the same hour into deep work would be
 * counted twice by a merged sum.
 *
 * This module is where seconds become minutes and where a typed duration is
 * accepted or refused, so the two screens cannot drift apart again.
 */

/** Longest single manual entry: a working day of focus. Beyond is a typo. */
export const MAX_ENTRY_MINUTES = 12 * 60;

/** Seconds of focus as whole minutes -- nearest minute, never negative. */
export function secondsToMinutes(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.round(seconds / 60);
}

export type ManualMinutes =
  | { ok: true; minutes: number }
  | { ok: false; reason: string };

/**
 * A typed deep-work duration. Whole minutes from 1 to `MAX_ENTRY_MINUTES`;
 * anything else is refused with a reason the screen can show -- never
 * silently clamped or rounded into a different number than the user typed.
 */
export function parseManualMinutes(input: string | number): ManualMinutes {
  const text = String(input).trim();
  if (!/^\d+$/.test(text)) return { ok: false, reason: 'Süreyi tam dakika olarak gir.' };
  const minutes = Number(text);
  if (minutes < 1) return { ok: false, reason: 'Süre en az 1 dakika olmalı.' };
  if (minutes > MAX_ENTRY_MINUTES) return { ok: false, reason: `Tek seans en fazla ${MAX_ENTRY_MINUTES / 60} saat olabilir.` };
  return { ok: true, minutes };
}
