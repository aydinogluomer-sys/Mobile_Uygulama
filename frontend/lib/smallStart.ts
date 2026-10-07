/**
 * R03.03 — start small: pick a piece of work, write its first concrete step,
 * choose how long, start.
 *
 * The step and the work it belongs to stay separate things. The step is a
 * focus session with its own title and length; finishing it records that
 * session and nothing else. The parent task is never completed, edited or
 * credited by it -- shrinking the step to two minutes does not shrink the
 * goal. Nothing is earned before the session starts (no XP, no FP): the
 * step is only a plan until the timer runs.
 */

export const SMALL_STEP_MINUTES = [2, 5, 10, 15, 25] as const;
export const DEFAULT_SMALL_STEP_MINUTES = 10;
export const MAX_SMALL_STEP_MINUTES = 60;
export const MAX_STEP_TITLE = 120;

export type SmallStepParent = { kind: 'task'; id: string; title: string };

export type SmallStep = {
  /** The first concrete step, in the user's words. */
  title: string;
  minutes: number;
  /** The work it belongs to. Read, never written, by the step. */
  parent: SmallStepParent;
};

export type SmallStepDraft = { title: string; minutes: number };

/** The sheet's starting point: an empty step the user writes, 10 minutes. */
export function draftFor(_parent: SmallStepParent): SmallStepDraft {
  return { title: '', minutes: DEFAULT_SMALL_STEP_MINUTES };
}

/** A hint for the empty field, made from the parent's title. */
export function stepPlaceholder(parent: SmallStepParent): string {
  const t = parent.title.trim();
  return t ? `"${t.length > 40 ? `${t.slice(0, 39)}…` : t}" için ilk somut adım` : 'İlk somut adım';
}

export type SmallStepCheck = { ok: true; step: SmallStep } | { ok: false; reason: string };

/**
 * Accept a draft as a step to start. The title is required -- "start small"
 * means naming the first thing to do, and a blank step would just be the
 * parent task again under a shorter timer.
 */
export function validateSmallStep(parent: SmallStepParent, draft: SmallStepDraft): SmallStepCheck {
  const title = draft.title.trim();
  if (!title) return { ok: false, reason: 'İlk adımı bir cümleyle yaz.' };
  if (title.length > MAX_STEP_TITLE) return { ok: false, reason: `Adım en fazla ${MAX_STEP_TITLE} karakter olabilir.` };
  if (!Number.isInteger(draft.minutes) || draft.minutes < 1 || draft.minutes > MAX_SMALL_STEP_MINUTES) {
    return { ok: false, reason: `Süre 1 ile ${MAX_SMALL_STEP_MINUTES} dakika arasında olmalı.` };
  }
  return { ok: true, step: { title, minutes: draft.minutes, parent: { ...parent } } };
}

/** Shape check for a step read back from storage. */
export function isSmallStep(x: unknown): x is SmallStep {
  const o = x as SmallStep | null;
  return !!o
    && typeof o.title === 'string' && o.title.trim().length > 0
    && Number.isInteger(o.minutes) && o.minutes >= 1 && o.minutes <= MAX_SMALL_STEP_MINUTES
    && !!o.parent && o.parent.kind === 'task' && typeof o.parent.id === 'string' && typeof o.parent.title === 'string';
}
