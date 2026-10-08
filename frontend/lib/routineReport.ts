/**
 * R05.07 — routine sessions in the weekly/monthly report, fed by the SAME
 * effect that wrote everything else: the session's own `summarize()` result,
 * stored with the session when it finished (routineRunnerStore.history).
 *
 * One effect, one count:
 *   - a step's habit was logged ONCE when the step was completed (habit logs
 *     already count it in the habit rate); this report never adds it again --
 *     it only says how many routine steps and minutes there were;
 *   - a timed step whose time ran out is NOT done unless the user marked it
 *     (`timeUp` is a prompt, not a completion), so it is never counted here.
 *
 * Pure; the day of a session is the local day it ENDED.
 */
import { ymd } from './date';
import type { SessionSummary } from './routineRunner';

export type RoutineHistoryEntry = { id: string; templateName: string; startedAt: number; endedAt: number; summary: SessionSummary };

export type RoutineReport = {
  sessions: number;
  stepsDone: number;
  stepsTotal: number;
  skipped: number;
  activeMinutes: number;
  /** distinct habits a routine completed in the range -- already in the habit logs, shown, not re-scored. */
  habitsViaRoutine: number;
  label: string;
};

export function routineReport(history: readonly RoutineHistoryEntry[], start: string, end: string): RoutineReport {
  const inRange = history.filter((h) => { const d = ymd(new Date(h.endedAt)); return d >= start && d <= end; });
  const seen = new Set<string>();
  const habits = new Set<string>();
  let stepsDone = 0, stepsTotal = 0, skipped = 0, activeMs = 0;
  for (const h of inRange) {
    if (seen.has(h.id)) continue; // a session finished twice is still one session
    seen.add(h.id);
    stepsDone += h.summary.done;
    stepsTotal += h.summary.total;
    skipped += h.summary.skipped;
    activeMs += h.summary.activeMs;
    for (const id of h.summary.habitsDone) habits.add(id);
  }
  const sessions = seen.size;
  const activeMinutes = Math.round(activeMs / 60000);
  return {
    sessions, stepsDone, stepsTotal, skipped, activeMinutes, habitsViaRoutine: habits.size,
    label: sessions === 0 ? 'Rutin yok' : `${sessions} rutin · ${stepsDone}/${stepsTotal} adım · ${activeMinutes} dk`,
  };
}
