/**
 * R05.02 — the routine runner's state: templates, the running session and a
 * short history, kept ON THIS DEVICE per account.
 *
 * Device-local on purpose, for now: the server tables for templates and
 * sessions are migration 030, written and NOT applied while the database is
 * frozen (S1/S2). Until it runs, a session survives an app kill here and the
 * built-in templates are always available; a user's own template copies live
 * on this device only, and the screen says so.
 *
 * The one server effect a session has goes through the existing habit-log
 * path: completing a step linked to a (non-measurable) habit logs it done for
 * today, once per session (R05.07). Nothing else is written, and no XP is
 * awarded by the routine itself.
 */
import { registerAccountScoped } from '../lib/accountScope';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BUILT_IN_TEMPLATES, addStep as addStepOp, applySessionToTemplate, backStep, completeStep, editMark,
  finishSession, habitLogsToWrite, moveStep as moveStepOp, pauseSession, removeStep as removeStepOp,
  resumeSession, setDuration as setDurationOp, skipStep, startSession, summarize,
  type RoutineSession, type RoutineTemplate, type SessionSummary, type StepDraft, type StepMark,
} from '../lib/routineRunner';
import { newOperationId } from '../lib/outbox';
import { currentUser } from '../lib/session';
import { useLogStore } from './logStore';
import { useHabitStore } from './habitStore';
import { isMeasurableTracking } from '../lib/habitEngine';

export const RUNNER_KEY = (userId: string) => `routine.v1.${userId}`;
const MAX_HISTORY = 30;

export type HistoryEntry = { id: string; templateName: string; startedAt: number; endedAt: number; summary: SessionSummary };

type Saved = { v: 1; templates: RoutineTemplate[]; session: RoutineSession | null; logged: string[]; history: HistoryEntry[]; savedAt: number };

type RunnerStore = {
  userId: string | null;
  /** The user's own templates (copies of built-ins, edited). */
  templates: RoutineTemplate[];
  session: RoutineSession | null;
  /** Habits this session already logged -- never twice. */
  logged: string[];
  history: HistoryEntry[];
  error: string | null;
  hydrate: () => Promise<void>;
  allTemplates: () => RoutineTemplate[];
  start: (templateId: string) => boolean;
  pause: () => void;
  resume: () => void;
  complete: () => Promise<void>;
  skip: () => void;
  back: () => void;
  mark: (stepId: string, mark: StepMark | null) => void;
  finish: () => void;
  discard: () => void;
  addStep: (d: StepDraft) => void;
  removeStep: (stepId: string) => void;
  moveStep: (stepId: string, delta: -1 | 1) => void;
  setDuration: (stepId: string, sec: number) => void;
  /** Explicit: write the session's steps to its template as a new version (a copy for a built-in). */
  applyToTemplate: () => void;
  /** Called by the screen while a session runs: saves, so an app kill loses at most this gap. */
  heartbeat: () => void;
};

export const useRoutineRunnerStore = create<RunnerStore>((set, get) => {
  function persist() {
    const { userId, templates, session, logged, history } = get();
    if (!userId) return;
    const blob: Saved = { v: 1, templates, session, logged, history, savedAt: Date.now() };
    AsyncStorage.setItem(RUNNER_KEY(userId), JSON.stringify(blob)).catch(() => {
      set({ error: 'Rutin cihaza kaydedilemedi.' });
    });
  }
  function update(next: Partial<RunnerStore>) { set(next); persist(); }
  const now = () => Date.now();

  return {
    userId: null,
    templates: [],
    session: null,
    logged: [],
    history: [],
    error: null,

    hydrate: async () => {
      const user = await currentUser();
      if (!user) { set({ userId: null, templates: [], session: null, logged: [], history: [] }); return; }
      if (get().userId === user.id) return;
      try {
        const raw = await AsyncStorage.getItem(RUNNER_KEY(user.id));
        const o = raw ? (JSON.parse(raw) as Saved) : null;
        if (o && o.v === 1) {
          // A session restored after an app kill continues PAUSED, closed at
          // the last save: what ran until then counts, the time the app was
          // dead does not.
          const s0 = o.session;
          const session = s0 && s0.status === 'running'
            ? pauseSession(s0, Math.max(s0.clock.runningSince ?? 0, o.savedAt ?? 0))
            : s0;
          set({ userId: user.id, templates: o.templates ?? [], session, logged: o.logged ?? [], history: o.history ?? [] });
          return;
        }
      } catch { /* unreadable -> start clean, leave the blob for inspection */ }
      set({ userId: user.id, templates: [], session: null, logged: [], history: [] });
    },

    allTemplates: () => [...BUILT_IN_TEMPLATES, ...get().templates],

    start: (templateId) => {
      if (get().session && get().session!.status !== 'finished') return false;
      const t = get().allTemplates().find((x) => x.id === templateId);
      if (!t) return false;
      update({ session: startSession(t, newOperationId(), now()), logged: [], error: null });
      return true;
    },

    pause: () => { const s = get().session; if (s) update({ session: pauseSession(s, now()) }); },
    resume: () => { const s = get().session; if (s) update({ session: resumeSession(s, now()) }); },

    complete: async () => {
      const s = get().session;
      if (!s) return;
      const next = completeStep(s, now());
      update({ session: next });
      // R05.07 — a linked habit is logged done once per session, through the
      // habit-log path (its own offline queue). Measurable habits are never
      // logged from here: "done" without an amount is the KD-12 contradiction.
      const habits = useHabitStore.getState().habits;
      for (const id of habitLogsToWrite(next, get().logged)) {
        const h = habits.find((x) => x.id === id);
        if (!h || isMeasurableTracking(h.tracking_type)) continue;
        const res = await useLogStore.getState().logHabit({ habitId: id, date: new Date(), state: 'done' });
        if (res.ok) update({ logged: [...get().logged, id] });
        else set({ error: `"${h.name}" kaydedilemedi: ${res.error}` });
      }
    },

    skip: () => { const s = get().session; if (s) update({ session: skipStep(s, now()) }); },
    back: () => { const s = get().session; if (s) update({ session: backStep(s, now()) }); },
    mark: (stepId, mark) => { const s = get().session; if (s) update({ session: editMark(s, stepId, mark, now()) }); },

    finish: () => {
      const s = get().session;
      // R10.02 — an already finished session is not recorded again.
      if (!s || s.status === 'finished') return;
      const done = finishSession(s, now());
      const entry: HistoryEntry = { id: done.id, templateName: done.templateName, startedAt: done.startedAt, endedAt: done.endedAt!, summary: summarize(done) };
      update({ session: done, history: [entry, ...get().history].slice(0, MAX_HISTORY) });
    },

    discard: () => update({ session: null, logged: [] }),
    heartbeat: () => persist(),

    addStep: (d) => { const s = get().session; if (s) update({ session: addStepOp(s, newOperationId(), d) }); },
    removeStep: (id) => { const s = get().session; if (s) update({ session: removeStepOp(s, id, now()) }); },
    moveStep: (id, delta) => { const s = get().session; if (s) update({ session: moveStepOp(s, id, delta) }); },
    setDuration: (id, sec) => { const s = get().session; if (s) update({ session: setDurationOp(s, id, sec) }); },

    applyToTemplate: () => {
      const s = get().session;
      if (!s || !s.edited) return;
      const nowIso = new Date().toISOString();
      const own = get().templates.find((t) => t.id === s.templateId);
      if (own) {
        update({ templates: get().templates.map((t) => (t.id === own.id ? applySessionToTemplate(own, s, nowIso) : t)), session: { ...s, edited: false } });
        return;
      }
      // A built-in is never changed: the edit becomes the user's own copy.
      const copy: RoutineTemplate = {
        id: newOperationId(), name: `${s.templateName} (benim)`, builtIn: false,
        versions: [{ version: 1, createdAt: nowIso, steps: s.steps.map((x) => ({ ...x })) }],
      };
      update({ templates: [...get().templates, copy], session: { ...s, edited: false } });
    },
  };
});

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'routineRunner', store: useRoutineRunnerStore });
