/**
 * R05.01 / R05.02 / R05.04 / F34 — routine templates, their versions, and a
 * running session's snapshot.
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
import { activeMs, isTimerClock, pauseClock, resumeClock, startClock, type TimerClock } from './focusTimer';

export type StepKind = 'timed' | 'check';
export type PartOfDay = 'morning' | 'afternoon' | 'evening';

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
  partOfDay?: PartOfDay;
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

export type SessionSummary = {
  total: number;
  done: number;
  skipped: number;
  open: number;
  activeMs: number;
  /** Habits whose step was completed -- each logged once. */
  habitsDone: string[];
};

export type HistoryEntry = {
  id: string;
  templateName: string;
  startedAt: number;
  endedAt: number;
  summary: SessionSummary;
};

export type HabitLogPlan = { write: string[]; stale: string[] };

export type RunnerEta =
  | { kind: 'exact'; at: number; remainingMs: number }
  | { kind: 'partial'; timedRemainingMs: number; unknownSteps: number }
  | { kind: 'steps_only'; unknownSteps: number }
  | { kind: 'done' };

export type RunnerClockView = {
  now: number;
  elapsedMs: number;
  remainingMs: number | null;
  timeUp: boolean;
  eta: RunnerEta;
};

export type TemplateSuggestion = { templateId: string; reason: 'active' | 'part_of_day' };

export type SavedBlob = {
  v: 1;
  templates: RoutineTemplate[];
  session: RoutineSession | null;
  logged: string[];
  history: HistoryEntry[];
  savedAt: number;
  activeTemplateId?: string | null;
};

export type ParsedSaved = {
  saved: SavedBlob;
  dropped: { templates: number; session: boolean; history: number };
};

export const MAX_STEPS = 30;
export const MAX_STEP_SECONDS = 3 * 60 * 60;
const MAX_HISTORY_ENTRIES = 30;

export function latestVersion(t: RoutineTemplate): TemplateVersion | undefined {
  if (!Array.isArray(t.versions) || t.versions.length === 0) return undefined;
  return t.versions.reduce((a, b) => (b.version > a.version ? b : a));
}

export function isUsableTemplate(t: RoutineTemplate): boolean {
  const v = latestVersion(t);
  return Boolean(v && Array.isArray(v.steps) && v.steps.length > 0);
}

export function versionOf(t: RoutineTemplate, v: number): TemplateVersion | undefined {
  return t.versions.find((x) => x.version === v);
}

function stepClock(step: TemplateStep | undefined, now: number): TimerClock {
  return startClock(step?.kind === 'timed' ? step.durationSec ?? 0 : 0, now);
}

/** Start a session of the template's latest version, or null when unusable. */
export function startSession(t: RoutineTemplate, id: string, now: number): RoutineSession | null {
  const v = latestVersion(t);
  if (!v || !Array.isArray(v.steps) || v.steps.length === 0) return null;
  const steps = v.steps.map((s) => ({ ...s }));
  return {
    id,
    templateId: t.id,
    templateVersion: v.version,
    templateName: t.name,
    steps,
    edited: false,
    index: 0,
    status: 'running',
    clock: stepClock(steps[0], now),
    results: {},
    startedAt: now,
    endedAt: null,
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

export function completeStep(s: RoutineSession, now: number): RoutineSession {
  return markCurrent(s, 'done', now);
}

export function skipStep(s: RoutineSession, now: number): RoutineSession {
  return markCurrent(s, 'skipped', now);
}

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
    if (!Number.isInteger(s) || s < 10 || s > MAX_STEP_SECONDS) {
      return { ok: false, reason: 'Süre 10 saniye ile 3 saat arasında olmalı.' };
    }
  }
  return { ok: true };
}

export function addStep(s: RoutineSession, id: string, d: StepDraft): RoutineSession {
  if (s.status === 'finished' || s.steps.length >= MAX_STEPS || !validateStep(d).ok) return s;
  const step: TemplateStep = {
    id,
    title: d.title.trim(),
    kind: d.kind,
    ...(d.kind === 'timed' ? { durationSec: d.durationSec } : {}),
    habitId: d.habitId ?? null,
  };
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
  return {
    ...s,
    steps,
    edited: true,
    index: cur === undefined ? s.index : Math.max(0, steps.findIndex((x) => x.id === cur)),
  };
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
  const next = (latestVersion(t)?.version ?? 0) + 1;
  const steps = s.steps.map((x) => ({ ...x }));
  return { ...t, versions: [...t.versions, { version: next, steps, createdAt: nowIso }] };
}

// ---------------------------------------------------------------------------
// R05.07 / INT-14 — what the session amounts to & habit-log reconciliation
// ---------------------------------------------------------------------------

export function summarize(s: RoutineSession): SessionSummary {
  let done = 0;
  let skipped = 0;
  let active = 0;
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
  return {
    total: s.steps.length,
    done,
    skipped,
    open: s.steps.length - done - skipped,
    activeMs: active,
    habitsDone,
  };
}

export function planHabitLogs(s: RoutineSession, logged: readonly string[]): HabitLogPlan {
  const desired = summarize(s).habitsDone;
  const write = desired.filter((h) => !logged.includes(h));
  const seen = new Set<string>();
  const stale: string[] = [];
  for (const h of logged) {
    if (seen.has(h)) continue;
    seen.add(h);
    if (!desired.includes(h)) stale.push(h);
  }
  return { write, stale };
}

/**
 * The habit logs a completion leads to, given the ones already written for
 * this session: each linked habit once, never twice.
 */
export function habitLogsToWrite(s: RoutineSession, alreadyLogged: readonly string[]): string[] {
  return planHabitLogs(s, alreadyLogged).write;
}

export function staleLogs(
  s: RoutineSession,
  logged: readonly string[],
  dismissed: readonly string[],
): string[] {
  return planHabitLogs(s, logged).stale.filter((h) => !dismissed.includes(h));
}

// ---------------------------------------------------------------------------
// Built-in templates (R05.08 + PS-30 partOfDay)
// ---------------------------------------------------------------------------

const makeBuiltInStep = (id: string, title: string, minutes?: number): TemplateStep =>
  minutes
    ? { id, title, kind: 'timed', durationSec: minutes * 60, habitId: null }
    : { id, title, kind: 'check', habitId: null };

export const BUILT_IN_TEMPLATES: readonly RoutineTemplate[] = [
  {
    id: 'builtin-morning',
    name: 'Sabah',
    builtIn: true,
    partOfDay: 'morning',
    versions: [
      {
        version: 1,
        createdAt: '2026-10-07T00:00:00.000Z',
        steps: [
          makeBuiltInStep('m1', 'Bir bardak su'),
          makeBuiltInStep('m2', 'Esneme', 5),
          makeBuiltInStep('m3', 'Günün 3 önceliğini yaz', 5),
        ],
      },
    ],
  },
  {
    id: 'builtin-evening',
    name: 'Akşam',
    builtIn: true,
    partOfDay: 'evening',
    versions: [
      {
        version: 1,
        createdAt: '2026-10-07T00:00:00.000Z',
        steps: [
          makeBuiltInStep('e1', 'Ekranları kapat'),
          makeBuiltInStep('e2', 'Yarını hazırla', 5),
          makeBuiltInStep('e3', 'Kısa günlük notu', 5),
        ],
      },
    ],
  },
  {
    id: 'builtin-work',
    name: 'Çalışma başlangıcı',
    builtIn: true,
    partOfDay: 'afternoon',
    versions: [
      {
        version: 1,
        createdAt: '2026-10-07T00:00:00.000Z',
        steps: [
          makeBuiltInStep('w1', 'Masayı topla'),
          makeBuiltInStep('w2', 'Tek bir işi seç'),
          makeBuiltInStep('w3', 'Odaklı blok', 25),
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// PS-30 — Part-of-day suggestion & active template selection
// ---------------------------------------------------------------------------

/** 05:00-11:59 sabah, 12:00-17:59 öğleden sonra, kalanı (gece dahil) akşam (F27 currentPartOfDay ile özdeş). */
export function runnerPartOfDay(hour: number): PartOfDay {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 18) return 'afternoon';
  return 'evening';
}

export function suggestTemplate(
  templates: readonly RoutineTemplate[],
  hour: number,
  activeId: string | null,
): TemplateSuggestion | null {
  const usable = templates.filter(isUsableTemplate);
  if (usable.length === 0) return null;

  if (activeId) {
    const active = usable.find((t) => t.id === activeId);
    if (active) return { templateId: active.id, reason: 'active' };
  }

  const slot = runnerPartOfDay(hour);
  const slotMatches = usable.filter((t) => t.partOfDay === slot);
  const chosen = slotMatches.find((t) => !t.builtIn) ?? slotMatches[0];
  if (chosen) return { templateId: chosen.id, reason: 'part_of_day' };

  return null;
}

// ---------------------------------------------------------------------------
// INT-19/4 & PRF-24 — Honest ETA & clock view
// ---------------------------------------------------------------------------

export function formatMmSs(ms: number): string {
  if (!Number.isFinite(ms)) return '00:00';
  const t = Math.max(0, Math.round(ms / 1000));
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

export function computeRunnerClock(s: RoutineSession, now: number): RunnerClockView {
  const elapsedMs = stepActiveMs(s, now);
  const st = currentStep(s);
  const remainingMs =
    st && st.kind === 'timed' && st.durationSec
      ? Math.max(0, st.durationSec * 1000 - elapsedMs)
      : null;

  let timedRemainingMs = 0;
  let hasTimedOpen = false;
  let unknownSteps = 0;

  for (let idx = 0; idx < s.steps.length; idx++) {
    const p = s.steps[idx];
    if (s.results[p.id]) continue;
    if (p.kind === 'timed' && p.durationSec && p.durationSec > 0) {
      hasTimedOpen = true;
      if (idx === s.index) {
        timedRemainingMs += Math.max(0, p.durationSec * 1000 - elapsedMs);
      } else {
        timedRemainingMs += p.durationSec * 1000;
      }
    } else {
      unknownSteps += 1;
    }
  }

  let eta: RunnerEta;
  if (!hasTimedOpen && unknownSteps === 0) {
    eta = { kind: 'done' };
  } else if (hasTimedOpen && unknownSteps === 0) {
    eta = { kind: 'exact', at: now + timedRemainingMs, remainingMs: timedRemainingMs };
  } else if (hasTimedOpen && unknownSteps > 0) {
    eta = { kind: 'partial', timedRemainingMs, unknownSteps };
  } else {
    eta = { kind: 'steps_only', unknownSteps };
  }

  return {
    now,
    elapsedMs,
    remainingMs,
    timeUp: timeUp(s, now),
    eta,
  };
}

export function etaLabel(eta: RunnerEta, opts?: { paused?: boolean }): string {
  switch (eta.kind) {
    case 'done':
      return 'Tüm adımlar işaretli';
    case 'steps_only':
      return `${eta.unknownSteps} adım kaldı`;
    case 'partial': {
      const mins = Math.max(0, Math.ceil(eta.timedRemainingMs / 60_000));
      return `Süreli adımlardan yaklaşık ${mins} dk var; ${eta.unknownSteps} adımın süresi belirsiz`;
    }
    case 'exact': {
      const mins = Math.max(0, Math.ceil(eta.remainingMs / 60_000));
      if (opts?.paused) {
        return `yaklaşık ${mins} dk kalan (duraklatıldı)`;
      }
      const d = new Date(eta.at);
      const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      return `Tahmini bitiş ${hhmm} (yaklaşık ${mins} dk kaldı)`;
    }
  }
}

// ---------------------------------------------------------------------------
// INT-19/3 — Piece-by-piece validation of device-local storage
// ---------------------------------------------------------------------------

const BUILT_IN_IDS: ReadonlySet<string> = new Set(BUILT_IN_TEMPLATES.map((t) => t.id));

function isRecord(x: unknown): x is Record<string, unknown> {
  return Boolean(x) && typeof x === 'object' && !Array.isArray(x);
}

function isFiniteNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function isPartOfDay(x: unknown): x is PartOfDay {
  return x === 'morning' || x === 'afternoon' || x === 'evening';
}

function parseStep(x: unknown): TemplateStep | null {
  if (!isRecord(x)) return null;
  if (typeof x.id !== 'string' || x.id.length === 0) return null;
  if (typeof x.title !== 'string') return null;
  if (x.title.trim().length < 1 || x.title.length > 80) return null;
  if (x.kind !== 'timed' && x.kind !== 'check') return null;
  if (x.habitId !== undefined && x.habitId !== null && typeof x.habitId !== 'string') return null;

  if (x.kind === 'timed') {
    if (
      typeof x.durationSec !== 'number' ||
      !Number.isInteger(x.durationSec) ||
      x.durationSec < 10 ||
      x.durationSec > MAX_STEP_SECONDS
    ) {
      return null;
    }
    return {
      id: x.id,
      title: x.title,
      kind: 'timed',
      durationSec: x.durationSec,
      ...(x.habitId !== undefined ? { habitId: x.habitId } : {}),
    };
  }

  return {
    id: x.id,
    title: x.title,
    kind: 'check',
    ...(x.habitId !== undefined ? { habitId: x.habitId } : {}),
  };
}

function parseStepsList(rawSteps: unknown): TemplateStep[] | null {
  if (!Array.isArray(rawSteps) || rawSteps.length === 0 || rawSteps.length > MAX_STEPS) return null;
  const out: TemplateStep[] = [];
  const seenIds = new Set<string>();
  for (const item of rawSteps) {
    const st = parseStep(item);
    if (!st || seenIds.has(st.id)) return null;
    seenIds.add(st.id);
    out.push(st);
  }
  return out;
}

function parseTemplateVersion(x: unknown): TemplateVersion | null {
  if (!isRecord(x)) return null;
  if (typeof x.version !== 'number' || !Number.isInteger(x.version) || x.version < 1) return null;
  if (typeof x.createdAt !== 'string') return null;
  const steps = parseStepsList(x.steps);
  if (!steps) return null;
  return { version: x.version, createdAt: x.createdAt, steps };
}

function parseUserTemplate(x: unknown, seenIds: Set<string>): RoutineTemplate | null {
  if (!isRecord(x)) return null;
  if (typeof x.id !== 'string' || x.id.length === 0) return null;
  if (BUILT_IN_IDS.has(x.id) || seenIds.has(x.id)) return null;
  if (typeof x.name !== 'string' || x.name.trim().length < 1 || x.name.length > 80) return null;
  if (typeof x.builtIn !== 'boolean') return null;
  if (x.partOfDay !== undefined && !isPartOfDay(x.partOfDay)) return null;
  if (!Array.isArray(x.versions) || x.versions.length === 0) return null;

  const versions: TemplateVersion[] = [];
  const seenVersions = new Set<number>();
  for (const rawV of x.versions) {
    const v = parseTemplateVersion(rawV);
    if (!v || seenVersions.has(v.version)) return null;
    seenVersions.add(v.version);
    versions.push(v);
  }

  seenIds.add(x.id);
  return {
    id: x.id,
    name: x.name,
    builtIn: x.builtIn,
    versions,
    ...(x.partOfDay !== undefined ? { partOfDay: x.partOfDay } : {}),
  };
}

function parseSession(x: unknown): RoutineSession | null {
  if (!isRecord(x)) return null;
  if (typeof x.id !== 'string' || x.id.length === 0) return null;
  if (typeof x.templateId !== 'string' || x.templateId.length === 0) return null;
  if (typeof x.templateVersion !== 'number' || !Number.isInteger(x.templateVersion) || x.templateVersion < 1) {
    return null;
  }
  if (typeof x.templateName !== 'string' || x.templateName.trim().length < 1 || x.templateName.length > 80) {
    return null;
  }
  const steps = parseStepsList(x.steps);
  if (!steps) return null;
  if (typeof x.edited !== 'boolean') return null;
  if (typeof x.index !== 'number' || !Number.isInteger(x.index) || x.index < 0 || x.index > steps.length) {
    return null;
  }
  if (x.status !== 'running' && x.status !== 'paused' && x.status !== 'finished') return null;
  if (!isTimerClock(x.clock)) return null;
  if (!isRecord(x.results)) return null;

  const results: Record<string, StepResult> = {};
  for (const [k, rawR] of Object.entries(x.results)) {
    if (!isRecord(rawR)) return null;
    if (rawR.mark !== 'done' && rawR.mark !== 'skipped') return null;
    if (!isFiniteNum(rawR.activeMs) || rawR.activeMs < 0) return null;
    if (!isFiniteNum(rawR.at)) return null;
    results[k] = { mark: rawR.mark, activeMs: rawR.activeMs, at: rawR.at };
  }

  if (!isFiniteNum(x.startedAt)) return null;
  if (x.endedAt !== null && !isFiniteNum(x.endedAt)) return null;

  return {
    id: x.id,
    templateId: x.templateId,
    templateVersion: x.templateVersion,
    templateName: x.templateName,
    steps,
    edited: x.edited,
    index: x.index,
    status: x.status,
    clock: {
      plannedSeconds: x.clock.plannedSeconds,
      accumulatedMs: x.clock.accumulatedMs,
      runningSince: x.clock.runningSince,
    },
    results,
    startedAt: x.startedAt,
    endedAt: x.endedAt,
  };
}

function parseHistoryEntry(x: unknown): HistoryEntry | null {
  if (!isRecord(x)) return null;
  if (typeof x.id !== 'string' || x.id.length === 0) return null;
  if (typeof x.templateName !== 'string' || x.templateName.trim().length < 1 || x.templateName.length > 80) {
    return null;
  }
  if (!isFiniteNum(x.startedAt) || !isFiniteNum(x.endedAt)) return null;
  if (!isRecord(x.summary)) return null;
  const sum = x.summary;
  if (
    typeof sum.total !== 'number' || !Number.isInteger(sum.total) || sum.total < 0 ||
    typeof sum.done !== 'number' || !Number.isInteger(sum.done) || sum.done < 0 ||
    typeof sum.skipped !== 'number' || !Number.isInteger(sum.skipped) || sum.skipped < 0 ||
    typeof sum.open !== 'number' || !Number.isInteger(sum.open) || sum.open < 0 ||
    !isFiniteNum(sum.activeMs) || sum.activeMs < 0 ||
    !Array.isArray(sum.habitsDone) || !sum.habitsDone.every((h): h is string => typeof h === 'string')
  ) {
    return null;
  }
  return {
    id: x.id,
    templateName: x.templateName,
    startedAt: x.startedAt,
    endedAt: x.endedAt,
    summary: {
      total: sum.total,
      done: sum.done,
      skipped: sum.skipped,
      open: sum.open,
      activeMs: sum.activeMs,
      habitsDone: [...sum.habitsDone],
    },
  };
}

export function parseSaved(raw: string | null): ParsedSaved | null {
  if (!raw || typeof raw !== 'string') return null;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsedJson) || parsedJson.v !== 1) return null;

  const dropped = { templates: 0, session: false, history: 0 };

  const templates: RoutineTemplate[] = [];
  if (parsedJson.templates !== undefined) {
    if (!Array.isArray(parsedJson.templates)) {
      dropped.templates += 1;
    } else {
      const seenIds = new Set<string>();
      for (const item of parsedJson.templates) {
        const tpl = parseUserTemplate(item, seenIds);
        if (tpl) templates.push(tpl);
        else dropped.templates += 1;
      }
    }
  }

  let session: RoutineSession | null = null;
  if (parsedJson.session !== null && parsedJson.session !== undefined) {
    const s = parseSession(parsedJson.session);
    if (s) session = s;
    else dropped.session = true;
  }

  const logged: string[] = Array.isArray(parsedJson.logged)
    ? parsedJson.logged.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];

  const validHistory: HistoryEntry[] = [];
  if (parsedJson.history !== undefined) {
    if (!Array.isArray(parsedJson.history)) {
      dropped.history += 1;
    } else {
      for (const item of parsedJson.history) {
        const entry = parseHistoryEntry(item);
        if (entry) validHistory.push(entry);
        else dropped.history += 1;
      }
    }
  }
  const history = validHistory.slice(0, MAX_HISTORY_ENTRIES);

  const savedAt = isFiniteNum(parsedJson.savedAt) ? parsedJson.savedAt : 0;
  const activeTemplateId =
    typeof parsedJson.activeTemplateId === 'string' && parsedJson.activeTemplateId.length > 0
      ? parsedJson.activeTemplateId
      : null;

  return {
    saved: {
      v: 1,
      templates,
      session,
      logged,
      history,
      savedAt,
      activeTemplateId,
    },
    dropped,
  };
}
