/**
 * R04.03 — acting on a reminder without opening the habit list.
 *
 *   done     log the habit done for the reminder's day (yes/no habits only)
 *   measure  open the app to enter an amount (measurable habits): an amount
 *            is never invented from a notification (KD-12)
 *   snooze   remind again in 10 minutes, once
 *   skip     log the day as `skip` -- the same excused day the app writes
 *
 * The same response can be delivered twice (a cold start replays the last
 * response, a double tap). `handledKey` identifies one response; the caller
 * keeps the keys it has handled and never acts on one twice -- and the log
 * itself is one row per habit per day, so even a missed dedupe cannot make
 * a second record.
 *
 * Pure: parses what the OS hands over into a decision.
 */
export const CATEGORY_BINARY = 'habit-binary';
export const CATEGORY_MEASURE = 'habit-measure';
export const SNOOZE_MINUTES = 10;

export type ReminderAction =
  | { kind: 'done'; habitId: string; day: string }
  | { kind: 'measure'; habitId: string; day: string }
  | { kind: 'snooze'; habitId: string; day: string }
  | { kind: 'skip'; habitId: string; day: string }
  | { kind: 'open'; habitId: string; day: string };

/** The OS response, reduced to what matters (expo-notifications' NotificationResponse). */
export type ResponseLike = {
  actionIdentifier: string;
  notification: { request: { identifier: string; content: { data?: Record<string, unknown> | null } } };
};

/** The default tap (no action button) -- expo's DEFAULT_ACTION_IDENTIFIER. */
export const DEFAULT_ACTION = 'expo.modules.notifications.actions.DEFAULT';

export function parseAction(r: ResponseLike): ReminderAction | null {
  const d = r.notification.request.content.data ?? {};
  const habitId = typeof d.habitId === 'string' ? d.habitId : null;
  const day = typeof d.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.day) ? d.day : null;
  if (!habitId || !day) return null;
  switch (r.actionIdentifier) {
    case 'done': return { kind: 'done', habitId, day };
    case 'measure': return { kind: 'measure', habitId, day };
    case 'snooze': return { kind: 'snooze', habitId, day };
    case 'skip': return { kind: 'skip', habitId, day };
    case DEFAULT_ACTION: return { kind: 'open', habitId, day };
    default: return null;
  }
}

/** One response = one notification + one action. */
export function handledKey(r: ResponseLike): string {
  return `${r.notification.request.identifier}|${r.actionIdentifier}`;
}

/** Keep the most recent handled keys only. */
export const MAX_HANDLED = 200;
export function rememberHandled(list: readonly string[], key: string): string[] {
  return [key, ...list.filter((k) => k !== key)].slice(0, MAX_HANDLED);
}

export type HandledOutcome = 'logged' | 'skipped' | 'snoozed' | 'opened' | 'duplicate' | 'ignored' | 'failed';

/** Yalnız işlemin gerçekten tamamlandığı sonuçlar "işlendi" kaydı yazar (DOM-14). */
export function shouldRecordHandled(outcome: HandledOutcome): boolean {
  return outcome === 'logged' || outcome === 'skipped' || outcome === 'snoozed' || outcome === 'opened';
}
