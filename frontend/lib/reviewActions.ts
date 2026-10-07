/**
 * R07.06 — the weekly review's "what changes next week" becomes an action,
 * not only a sentence.
 *
 *   task         a task for next week, created through the task outbox (it
 *                exists the moment it is chosen, offline too)
 *   habit_edit   open the habit to change its schedule, goal or take a break
 *                -- the change itself is the habit screen's, versioned (R01.05)
 *
 * The chosen action is kept with the week it was chosen in, and the next
 * week's review shows it again with whether it happened (a task: completed
 * or not). Kept on the device per account until the server table exists
 * (migration 031, not applied).
 *
 * Pure.
 */
import { addDaysLocal, parseLocalDate, startOfWeekLocal, ymd } from './date';

export type NextAction =
  | { weekKey: string; kind: 'task'; taskId: string; label: string; createdAt: string }
  | { weekKey: string; kind: 'habit_edit'; habitId: string; label: string; createdAt: string };

export const reviewActionsKey = (userId: string) => `review.actions.v1.${userId}`;
export const MAX_ACTIONS = 60;

/** Monday of the week after the week that starts `weekStart` (YYYY-MM-DD). */
export function nextWeekMonday(weekStart: string): string {
  const d = parseLocalDate(weekStart) ?? new Date();
  return ymd(addDaysLocal(startOfWeekLocal(d), 7));
}

/** A title for the task from what the user wrote: the first non-empty line, trimmed, at most 120 chars. */
export function taskTitleFrom(nextWeekText: string): string {
  const line = String(nextWeekText ?? '').split(/\r?\n/).map((l) => l.replace(/^[-•\s]+/, '').trim()).find((l) => l.length > 0) ?? '';
  return line.length > 120 ? `${line.slice(0, 119)}…` : line;
}

export function upsertAction(list: readonly NextAction[], a: NextAction): NextAction[] {
  return [a, ...list.filter((x) => x.weekKey !== a.weekKey)].slice(0, MAX_ACTIONS);
}

export function actionFor(list: readonly NextAction[], weekKey: string): NextAction | undefined {
  return list.find((x) => x.weekKey === weekKey);
}

/** The week key of the week before `weekKey` (keys are the week's Monday). */
export function previousWeekKey(weekKey: string): string {
  const d = parseLocalDate(weekKey) ?? new Date();
  return ymd(addDaysLocal(d, -7));
}

/** How last week's action turned out, in words. */
export function actionOutcome(a: NextAction, ctx: { taskCompleted?: (id: string) => boolean | undefined }): string {
  if (a.kind === 'task') {
    const done = ctx.taskCompleted?.(a.taskId);
    return done === undefined ? `${a.label} — görev bulunamadı` : done ? `${a.label} — yapıldı` : `${a.label} — henüz yapılmadı`;
  }
  return `${a.label} — alışkanlık ekranında düzenlemek için seçilmişti`;
}
