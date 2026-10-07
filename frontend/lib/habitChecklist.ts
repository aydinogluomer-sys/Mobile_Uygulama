/**
 * R01.04 — a habit's checklist: the steps one occurrence is made of.
 *
 *   item   a template step of the habit ("ısın", "3 set", "esne"), required
 *          or optional, ordered. Archived rather than deleted, so a past day
 *          is still read against the steps it actually had.
 *   check  one item ticked on one local day -- the day's INSTANCE of the
 *          checklist. Unticking removes the check.
 *
 * Not task subtasks. A task's subtasks are a one-off breakdown of a single
 * piece of work; a habit's checklist repeats every occurrence and its
 * progress decides that day's log. The two never share a table or a type.
 *
 * The day's log follows from the checks with the same states the rest of
 * the app writes:
 *   every required step ticked            -> done
 *   something ticked, not every required  -> partial
 *   no required steps defined             -> done once any step is ticked
 *   nothing ticked, but the day has a log -> miss (the same "not done" a
 *                                            second tap on Today writes; a
 *                                            log cannot be removed -- R01.03-b)
 *   nothing ticked, no log                -> nothing is written
 * Optional steps never decide the state; they are shown as extra.
 *
 * Pure: no I/O, no clock.
 */
import { ymd } from './date';

export const MAX_CHECKLIST_ITEMS = 12;
export const MAX_ITEM_TITLE = 80;

export type ChecklistItem = {
  id: string;
  habit_id: string;
  title: string;
  required: boolean;
  position: number;
  created_at: string;
  archived_at: string | null;
};

export type ChecklistCheck = {
  item_id: string;
  habit_id: string;
  /** Local date, YYYY-MM-DD. */
  day: string;
};

/** The habit's current steps, in order. */
export function currentItems(items: readonly ChecklistItem[], habitId: string): ChecklistItem[] {
  return items
    .filter((i) => i.habit_id === habitId && i.archived_at === null)
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

/**
 * The steps the habit had ON `day`: created on or before it, not yet archived
 * by then. A step added today does not reach back into last week, and a step
 * archived today still belonged to yesterday.
 */
export function itemsOn(items: readonly ChecklistItem[], habitId: string, day: string): ChecklistItem[] {
  return items
    .filter((i) => i.habit_id === habitId
      && ymd(new Date(i.created_at)) <= day
      && (i.archived_at === null || ymd(new Date(i.archived_at)) > day))
    .sort((a, b) => a.position - b.position || a.created_at.localeCompare(b.created_at));
}

export type ChecklistProgress = {
  requiredTotal: number;
  requiredDone: number;
  optionalTotal: number;
  optionalDone: number;
  /** What the day's log should say; 'none' = nothing ticked. */
  state: 'done' | 'partial' | 'none';
};

export function progressOn(
  items: readonly ChecklistItem[],
  checks: readonly ChecklistCheck[],
  habitId: string,
  day: string,
): ChecklistProgress {
  const its = itemsOn(items, habitId, day);
  const ticked = new Set(checks.filter((c) => c.habit_id === habitId && c.day === day).map((c) => c.item_id));
  const req = its.filter((i) => i.required);
  const opt = its.filter((i) => !i.required);
  const requiredDone = req.filter((i) => ticked.has(i.id)).length;
  const optionalDone = opt.filter((i) => ticked.has(i.id)).length;
  const any = requiredDone + optionalDone > 0;
  let state: ChecklistProgress['state'];
  if (req.length === 0) state = any ? 'done' : 'none';
  else if (requiredDone === req.length) state = 'done';
  else state = any ? 'partial' : 'none';
  return { requiredTotal: req.length, requiredDone, optionalTotal: opt.length, optionalDone, state };
}

/**
 * The log write a tick/untick leads to, given the day's current log state.
 * `null` = write nothing: the log already says it, or there is no log and
 * nothing is ticked.
 */
export function logStepFor(progress: ChecklistProgress, currentLogState: string | undefined): 'done' | 'partial' | 'miss' | null {
  if (progress.state === 'none') return currentLogState && currentLogState !== 'miss' ? 'miss' : null;
  return progress.state === currentLogState ? null : progress.state;
}

export type ItemCheck = { ok: true; title: string } | { ok: false; reason: string };

/** A new step: a short title, within the per-habit limit. */
export function validateItem(title: string, existing: readonly ChecklistItem[], habitId: string): ItemCheck {
  const t = title.trim();
  if (!t) return { ok: false, reason: 'Adıma bir ad ver.' };
  if (t.length > MAX_ITEM_TITLE) return { ok: false, reason: `Adım en fazla ${MAX_ITEM_TITLE} karakter olabilir.` };
  const cur = currentItems(existing, habitId);
  if (cur.length >= MAX_CHECKLIST_ITEMS) return { ok: false, reason: `Bir alışkanlıkta en fazla ${MAX_CHECKLIST_ITEMS} adım olabilir.` };
  if (cur.some((i) => i.title.toLocaleLowerCase('tr') === t.toLocaleLowerCase('tr'))) return { ok: false, reason: 'Bu adım zaten listede.' };
  return { ok: true, title: t };
}

/** Next position at the end of the habit's current list. */
export function nextPosition(items: readonly ChecklistItem[], habitId: string): number {
  const cur = currentItems(items, habitId);
  return cur.length === 0 ? 0 : Math.max(...cur.map((i) => i.position)) + 1;
}

/** "2/3 zorunlu · 1/2 isteğe bağlı" */
export function progressLabel(p: ChecklistProgress): string {
  const parts: string[] = [];
  if (p.requiredTotal > 0) parts.push(`${p.requiredDone}/${p.requiredTotal} zorunlu`);
  if (p.optionalTotal > 0) parts.push(`${p.optionalDone}/${p.optionalTotal} isteğe bağlı`);
  return parts.join(' · ');
}
