/**
 * R05.01 / R05.02 / R05.04 — routine templates, their versions, and a running
 * session's snapshot.
 *
 *   template          a named, editable list of steps ("Sabah", "Akşam").
 *   template version  an IMMUTABLE copy of the steps at one point. Editing a
 *                     template makes a new version; old versions stay, so a
 *                     past session still reads against the steps it ran.
 *   session           a run of ONE version. It copies the steps at start
 *                     (the snapshot); adding, removing, reordering or
 *                     re-timing steps changes the session only. Writing a
 *                     session's steps back to its template is a separate,
 *                     explicit act (`applySessionToTemplate`).
 *
 * The AI routine proposals (`routines` / `routine_items`) are proposal
 * history -- a list of habits that was installed -- and are NOT templates.
 *
 * ## Rules a session keeps
 *  - only the user completes a step; a timed step whose time runs out is
 *    `timeUp`, not done
 *  - a skipped step is not done
 *  - a step already marked can be changed (done <-> skipped <-> open)
 *  - active time is running segments only (lib/focusTimer): a pause is not
 *    activity
 *  - finishing leaves unmarked steps unmarked -- nothing is filled in
 *
 * Pure: no I/O; time is passed in.
 */
import { activeMs, pauseClock, resumeClock, startClock, type TimerClock } from './focusTimer';

export type StepKind = 'timed' | 'check';

export type TemplateStep = {
  id: string;
  title: string;
  kind: StepKind;
  /** Planned length for a timed step, seconds. */
  durationSec?: number;
  /** Optional link: completing this step logs the habit done (R05.07). */
  habitId?: string | null;
};

export type TemplateVersion = { version: number; steps: TemplateStep[]; createdAt: string };

export type RoutineTemplate = {
  id: string;
  name: string;
  /** Built-in templates ship with the app; a user copy is made to edit them. */
  builtIn: boolean;
  versions: TemplateVersion[];
};

export type StepMark = 'done' | 'skipped';

export type StepResult = { mark: StepMark; activeMs: number; at: number };

export type RoutineSession = {
  id: string;
  templateId: string;
  templateVersion: number;
  templateName: string;
  /** The snapshot this session runs -- edited here, never in the template. */
  steps: TemplateStep[];
  /** Whether the snapshot was changed after start (offer "şablona uygula"). */
  edited: boolean;
  index: number;
  status: 'running' | 'paused' | 'finished';
  /** The current step's running segments. */
  clock: TimerClock;
  results: Record<string, StepResult>;
  startedAt: number;
  endedAt: number | null;
};

export const MAX_STEPS = 30;
export const MAX_STEP_SECONDS = 3 * 60 * 60;

export function latestVersion(t: RoutineTemplate): TemplateVersion {
  return t.versions.reduce((a, b) => (b.version > a.version ? b : a));
}

export function versionOf(t: RoutineTemplate, v: number): TemplateVersion | undefined {
  return t.versions.find((x) => x.version === v);
}

function stepClock(step: TemplateStep | undefined, now: number): TimerClock {
  return startClock(step?.kind === 'timed' ? step.durationSec ?? 0 : 0, now);
}

/** Start a session of the template's latest version. */
export function startSession(t: RoutineTemplate, id: string, now: number): RoutineSession {
  const v = latestVersion(t);
  const steps = v.steps.map((s) => ({ ...s }));
  return {
    id, templateId: t.id, templateVersion: v.version, templateName: t.name,
    steps, edited: false, index: 0, status: 'running',
    clock: stepClock(steps[0], now), results: {}, startedAt: now, endedAt: null,
  };
}

export function currentStep(s: RoutineSession): TemplateStep | undefined {
  return s.steps[s.index];
}

/** Running time of the current step, ms. */
export function stepActiveMs(s: RoutineSession, now: number): number {
  return activeMs(s.clock, now);
}

/** A timed step whose plan has elapsed. NOT done -- only the user completes. */
export function timeUp(s: RoutineSession, now: number): boolean {
  const st = currentStep(s);
  if (!st || st.kind !== 'timed' || !st.durationSec) return false;
  return activeMs(s.clock, now) >= st.durationSec * 1000;
}

export function pauseSession(s: RoutineSession, now: number): RoutineSession {
  if (s.status !== 'running') return s;
  return { ...s, status: 'paused', clock: pauseClock(s.clock, now) };
}

export function resumeSession(s: RoutineSession, now: number): RoutineSession {
  if (s.status !== 'paused') return s;
  return { ...s, status: 'running', clock: resumeClock(s.clock, now) };
}

/** Move to step `i`, keeping the session's run/pause state. */
function goTo(s: RoutineSession, i: number, now: number): RoutineSession {
  const index = Math.max(0, Math.min(i, s.steps.length));
  const clock = stepClock(s.steps[index], now);
  return { ...s, index, clock: s.status === 'paused' ? pauseClock(clock, now) : clock };
}

function nextOpenIndex(s: RoutineSession, from: number): number {
  for (let i = from; i < s.steps.length; i++) if (!s.results[s.steps[i].id]) return i;
  return s.steps.length;
}

/** Mark the current step and move to the next one that is still open. */
function markCurrent(s: RoutineSession, mark: StepMark, now: number): RoutineSession {
  const st = currentStep(s);
  if (!st || s.status === 'finished') return s;
  const prev = s.results[st.id]?.activeMs ?? 0;
  const results = { ...s.results, [st.id]: { mark, activeMs: prev + activeMs(s.clock, now), at: now } };
  return goTo({ ...s, results }, nextOpenIndex({ ...s, results }, s.index + 1), now);
}

export function completeStep(s: RoutineSession, now: number): RoutineSession { return markCurrent(s, 'done', now); }
export function skipStep(s: RoutineSession, now: number): RoutineSession { return markCurrent(s, 'skipped', now); }

/** Go back one step. Its mark stays until the user changes it. */
export function backStep(s: RoutineSession, now: number): RoutineSession {
  if (s.index === 0 || s.status === 'finished') return s;
  return goTo(s, s.index - 1, now);
}

/** Change a step's mark after the fact (null = back to open). */
export function editMark(s: RoutineSession, stepId: string, mark: StepMark | null, now: number): RoutineSession {
  const cur = s.results[stepId];
  const results = { ...s.results };
  if (mark === null) delete results[stepId];
  else results[stepId] = { mark, activeMs: cur?.activeMs ?? 0, at: now };
  return { ...s, results };
}

/** Finish: unmarked steps stay unmarked. */
export function finishSession(s: RoutineSession, now: number): RoutineSession {
  if (s.status === 'finished') return s;
  return { ...s, status: 'finished', clock: pauseClock(s.clock, now), endedAt: now };
}

// ---------------------------------------------------------------------------
// R05.04 — editing the running session (the template is untouched)
// ---------------------------------------------------------------------------

export type StepDraft = { title: string; kind: StepKind; durationSec?: number; habitId?: string | null };

export function validateStep(d: StepDraft): { ok: true } | { ok: false; reason: string } {
  const t = d.title.trim();
  if (!t) return { ok: false, reason: 'Adıma bir ad ver.' };
  if (t.length > 80) return { ok: false, reason: 'Adım en fazla 80 karakter olabilir.' };
  if (d.kind === 'timed') {
    const s = d.durationSec ?? 0;
    if (!Number.isInteger(s) || s < 10 || s > MAX_STEP_SECONDS) return { ok: false, reason: 'Süre 10 saniye ile 3 saat arasında olmalı.' };
  }
  return { ok: true };
}

export function addStep(s: RoutineSession, id: string, d: StepDraft): RoutineSession {
  if (s.status === 'finished' || s.steps.length >= MAX_STEPS || !validateStep(d).ok) return s;
  const step: TemplateStep = { id, title: d.title.trim(), kind: d.kind, ...(d.kind === 'timed' ? { durationSec: d.durationSec } : {}), habitId: d.habitId ?? null };
  return { ...s, steps: [...s.steps, step], edited: true };
}

export function removeStep(s: RoutineSession, stepId: string, now: number): RoutineSession {
  const at = s.steps.findIndex((x) => x.id === stepId);
  if (at < 0 || s.status === 'finished' || s.steps.length <= 1) return s;
  const steps = s.steps.filter((x) => x.id !== stepId);
  const results = { ...s.results };
  delete results[stepId];
  const base = { ...s, steps, results, edited: true };
  if (at < s.index) return { ...base, index: s.index - 1 };
  if (at === s.index) return goTo(base, Math.min(s.index, steps.length - 1), now);
  return base;
}

export function moveStep(s: RoutineSession, stepId: string, delta: -1 | 1): RoutineSession {
  const at = s.steps.findIndex((x) => x.id === stepId);
  const to = at + delta;
  if (at < 0 || to < 0 || to >= s.steps.length || s.status === 'finished') return s;
  const steps = [...s.steps];
  [steps[at], steps[to]] = [steps[to], steps[at]];
  const cur = s.steps[s.index]?.id;
  return { ...s, steps, edited: true, index: Math.max(0, steps.findIndex((x) => x.id === cur)) };
}

/** Change a timed step's length; the current step's clock keeps its elapsed time. */
export function setDuration(s: RoutineSession, stepId: string, durationSec: number): RoutineSession {
  const step = s.steps.find((x) => x.id === stepId);
  if (!step || step.kind !== 'timed' || !validateStep({ ...step, durationSec }).ok || s.status === 'finished') return s;
  const steps = s.steps.map((x) => (x.id === stepId ? { ...x, durationSec } : x));
  const isCurrent = s.steps[s.index]?.id === stepId;
  return { ...s, steps, edited: true, clock: isCurrent ? { ...s.clock, plannedSeconds: durationSec } : s.clock };
}

/**
 * The explicit "şablona uygula": the session's steps become the template's
 * NEXT version. Earlier versions stay -- sessions that ran them still read
 * against them.
 */
export function applySessionToTemplate(t: RoutineTemplate, s: RoutineSession, nowIso: string): RoutineTemplate {
  const next = latestVersion(t).version + 1;
  const steps = s.steps.map((x) => ({ ...x }));
  return { ...t, versions: [...t.versions, { version: next, steps, createdAt: nowIso }] };
}

// ---------------------------------------------------------------------------
// R05.07 — what the session amounts to
// ---------------------------------------------------------------------------

export type SessionSummary = {
  total: number;
  done: number;
  skipped: number;
  open: number;
  activeMs: number;
  /** Habits whose step was completed -- each logged once. */
  habitsDone: string[];
};

export function summarize(s: RoutineSession): SessionSummary {
  let done = 0, skipped = 0, active = 0;
  const habitsDone: string[] = [];
  for (const st of s.steps) {
    const r = s.results[st.id];
    if (!r) continue;
    active += r.activeMs;
    if (r.mark === 'done') {
      done += 1;
      if (st.habitId && !habitsDone.includes(st.habitId)) habitsDone.push(st.habitId);
    } else skipped += 1;
  }
  return { total: s.steps.length, done, skipped, open: s.steps.length - done - skipped, activeMs: active, habitsDone };
}

/**
 * The habit logs a completion leads to, given the ones already written for
 * this session: each linked habit once, never twice.
 */
export function habitLogsToWrite(s: RoutineSession, alreadyLogged: readonly string[]): string[] {
  return summarize(s).habitsDone.filter((h) => !alreadyLogged.includes(h));
}

// ---------------------------------------------------------------------------
// Built-in templates (R05.08: a few, editable by copying)
// ---------------------------------------------------------------------------

const step = (id: string, title: string, minutes?: number): TemplateStep =>
  minutes ? { id, title, kind: 'timed', durationSec: minutes * 60, habitId: null } : { id, title, kind: 'check', habitId: null };

export const BUILT_IN_TEMPLATES: readonly RoutineTemplate[] = [
  {
    id: 'builtin-morning', name: 'Sabah', builtIn: true,
    versions: [{ version: 1, createdAt: '2026-10-07T00:00:00.000Z', steps: [
      step('m1', 'Bir bardak su'),
      step('m2', 'Esneme', 5),
      step('m3', 'Günün 3 önceliğini yaz', 5),
    ] }],
  },
  {
    id: 'builtin-evening', name: 'Akşam', builtIn: true,
    versions: [{ version: 1, createdAt: '2026-10-07T00:00:00.000Z', steps: [
      step('e1', 'Ekranları kapat'),
      step('e2', 'Yarını hazırla', 5),
      step('e3', 'Kısa günlük notu', 5),
    ] }],
  },
  {
    id: 'builtin-work', name: 'Çalışma başlangıcı', builtIn: true,
    versions: [{ version: 1, createdAt: '2026-10-07T00:00:00.000Z', steps: [
      step('w1', 'Masayı topla'),
      step('w2', 'Tek bir işi seç'),
      step('w3', 'Odaklı blok', 25),
    ] }],
  },
];
