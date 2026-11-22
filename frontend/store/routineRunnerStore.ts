/**
 * R05.02 / F34 — the routine runner's state: templates, the running session,
 * active template preference, and a short history, kept ON THIS DEVICE per
 * account.
 *
 * Device-local on purpose, for now: the server tables for templates and
 * sessions are migration 030, written and NOT applied while the database is
 * frozen (S1/S2). Until it runs, a session survives an app kill here and the
 * built-in templates are always available; a user's own template copies and
 * active routine choice live on this device only, and the screen says so.
 *
 * The one server effect a session has goes through the existing habit-log
 * path: completing or marking a step linked to a (non-measurable) habit logs
 * it done for today, once per session through a single-writer reconciler
 * (`reconcileLogs`), guarded by `accountEpoch()`.
 */
import { accountEpoch, registerAccountScoped, registerAccountStorage } from '../lib/accountScope';
import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  BUILT_IN_TEMPLATES,
  addStep as addStepOp,
  applySessionToTemplate,
  backStep,
  completeStep,
  editMark,
  finishSession,
  isUsableTemplate,
  moveStep as moveStepOp,
  parseSaved,
  pauseSession,
  planHabitLogs,
  removeStep as removeStepOp,
  resumeSession,
  setDuration as setDurationOp,
  skipStep,
  startSession,
  summarize,
  type HistoryEntry,
  type RoutineSession,
  type RoutineTemplate,
  type SavedBlob,
  type StepDraft,
  type StepMark,
} from '../lib/routineRunner';
import { newOperationId } from '../lib/outbox';
import { currentUser } from '../lib/session';
import { useLogStore } from './logStore';
import { useHabitStore } from './habitStore';
import { isMeasurableTracking } from '../lib/habitEngine';

export type { HistoryEntry } from '../lib/routineRunner';

export const RUNNER_KEY = (userId: string) => `routine.v1.${userId}`;
export const RUNNER_BAD_KEY = (userId: string) => `${RUNNER_KEY(userId)}.bad`;

const MAX_HISTORY = 30;
const CORRUPT_STORAGE_ERROR = 'Cihazdaki rutin verisinin bir kısmı okunamadı; sağlam kısım yüklendi.';

type RunnerStore = {
  userId: string | null;
  /** The user's own templates (copies of built-ins, edited). */
  templates: RoutineTemplate[];
  session: RoutineSession | null;
  /** Habits this session already logged -- never twice. */
  logged: string[];
  history: HistoryEntry[];
  /** Device-local preferred routine template id (PS-30). */
  activeTemplateId: string | null;
  /** Memory-only list of stale habit IDs dismissed by the user in this session (INT-14). */
  staleDismissed: string[];
  error: string | null;
  hydrate: () => Promise<void>;
  allTemplates: () => RoutineTemplate[];
  start: (templateId: string) => boolean;
  setActive: (templateId: string | null) => void;
  dismissStale: (habitId: string) => void;
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

let writing = false;
let again = false;

export const useRoutineRunnerStore = create<RunnerStore>((set, get) => {
  const now = () => Date.now();

  function persist() {
    const { userId, templates, session, logged, history, activeTemplateId } = get();
    if (!userId) return;
    const blob: SavedBlob = {
      v: 1,
      templates,
      session,
      logged,
      history,
      savedAt: now(),
      activeTemplateId,
    };
    AsyncStorage.setItem(RUNNER_KEY(userId), JSON.stringify(blob)).catch(() => {
      set({ error: 'Rutin cihaza kaydedilemedi.' });
    });
  }

  function update(next: Partial<RunnerStore>) {
    set(next);
    persist();
  }

  async function reconcileLogs(): Promise<void> {
    if (writing) {
      again = true;
      return;
    }
    writing = true;
    const epoch = accountEpoch();
    try {
      do {
        again = false;
        const s = get().session;
        if (!s) break;
        const sid = s.id;
        const habits = useHabitStore.getState().habits;
        for (const id of planHabitLogs(s, get().logged).write) {
          const h = habits.find((x) => x.id === id);
          if (!h || isMeasurableTracking(h.tracking_type)) continue;
          const res = await useLogStore.getState().logHabit({
            habitId: id,
            date: new Date(),
            state: 'done',
          });
          if (epoch !== accountEpoch() || get().session?.id !== sid) return;
          if (res.ok) {
            if (!get().logged.includes(id)) {
              update({ logged: get().logged.concat(id) });
            }
          } else {
            set({ error: `"${h.name}" kaydedilemedi: ${res.error}` });
          }
        }
      } while (again);
    } finally {
      writing = false;
      again = false;
    }
  }

  return {
    userId: null,
    templates: [],
    session: null,
    logged: [],
    history: [],
    activeTemplateId: null,
    staleDismissed: [],
    error: null,

    hydrate: async () => {
      const epoch = accountEpoch();
      const user = await currentUser();
      if (epoch !== accountEpoch()) return;
      if (!user) {
        set({
          userId: null,
          templates: [],
          session: null,
          logged: [],
          history: [],
          activeTemplateId: null,
          staleDismissed: [],
          error: null,
        });
        return;
      }
      if (get().userId === user.id) return;

      let raw: string | null = null;
      try {
        raw = await AsyncStorage.getItem(RUNNER_KEY(user.id));
      } catch {
        if (epoch !== accountEpoch()) return;
        set({
          userId: user.id,
          templates: [],
          session: null,
          logged: [],
          history: [],
          activeTemplateId: null,
          staleDismissed: [],
          error: null,
        });
        return;
      }
      if (epoch !== accountEpoch()) return;

      if (!raw) {
        set({
          userId: user.id,
          templates: [],
          session: null,
          logged: [],
          history: [],
          activeTemplateId: null,
          staleDismissed: [],
          error: null,
        });
        return;
      }

      const parsed = parseSaved(raw);
      const hasDropped =
        parsed !== null &&
        (parsed.dropped.templates > 0 || parsed.dropped.session || parsed.dropped.history > 0);

      if (parsed === null || hasDropped) {
        try {
          const badKey = RUNNER_BAD_KEY(user.id);
          const existingBad = await AsyncStorage.getItem(badKey);
          if (!existingBad) {
            await AsyncStorage.setItem(badKey, raw);
          }
        } catch {
          /* best-effort quarantine */
        }
        if (epoch !== accountEpoch()) return;
      }

      if (parsed === null) {
        set({
          userId: user.id,
          templates: [],
          session: null,
          logged: [],
          history: [],
          activeTemplateId: null,
          staleDismissed: [],
          error: CORRUPT_STORAGE_ERROR,
        });
        return;
      }

      const { saved } = parsed;
      const usableOwn = saved.templates.filter(isUsableTemplate);
      const allUsable = [...BUILT_IN_TEMPLATES, ...usableOwn];
      const s0 = saved.session;
      const session =
        s0 && s0.status === 'running'
          ? pauseSession(s0, Math.max(s0.clock.runningSince ?? 0, saved.savedAt))
          : s0;
      const activeTemplateId =
        saved.activeTemplateId && allUsable.some((t) => t.id === saved.activeTemplateId)
          ? saved.activeTemplateId
          : null;

      set({
        userId: user.id,
        templates: usableOwn,
        session,
        logged: saved.logged,
        history: saved.history,
        activeTemplateId,
        staleDismissed: [],
        error: hasDropped ? CORRUPT_STORAGE_ERROR : null,
      });
    },

    allTemplates: () => [...BUILT_IN_TEMPLATES, ...get().templates.filter(isUsableTemplate)],

    start: (templateId) => {
      if (get().session && get().session!.status !== 'finished') return false;
      const t = get().allTemplates().find((x) => x.id === templateId);
      if (!t) return false;
      const s = startSession(t, newOperationId(), now());
      if (!s) return false;
      update({ session: s, logged: [], staleDismissed: [], error: null });
      return true;
    },

    setActive: (templateId) => {
      if (templateId === null) {
        update({ activeTemplateId: null });
        return;
      }
      const usable = get().allTemplates().some((t) => t.id === templateId && isUsableTemplate(t));
      if (!usable) return;
      update({ activeTemplateId: templateId });
    },

    dismissStale: (habitId) => {
      if (!habitId || get().staleDismissed.includes(habitId)) return;
      set({ staleDismissed: get().staleDismissed.concat(habitId) });
    },

    pause: () => {
      const s = get().session;
      if (s) update({ session: pauseSession(s, now()) });
    },

    resume: () => {
      const s = get().session;
      if (s) update({ session: resumeSession(s, now()) });
    },

    complete: async () => {
      const s = get().session;
      if (!s) return;
      update({ session: completeStep(s, now()) });
      await reconcileLogs();
    },

    skip: () => {
      const s = get().session;
      if (s) update({ session: skipStep(s, now()) });
    },

    back: () => {
      const s = get().session;
      if (s) update({ session: backStep(s, now()) });
    },

    mark: (stepId, m) => {
      const s = get().session;
      if (!s) return;
      update({ session: editMark(s, stepId, m, now()) });
      void reconcileLogs();
    },

    finish: () => {
      const s = get().session;
      // R10.02 — an already finished session is not recorded again.
      if (!s || s.status === 'finished') return;
      const done = finishSession(s, now());
      const entry: HistoryEntry = {
        id: done.id,
        templateName: done.templateName,
        startedAt: done.startedAt,
        endedAt: done.endedAt!,
        summary: summarize(done),
      };
      update({ session: done, history: [entry, ...get().history].slice(0, MAX_HISTORY) });
    },

    discard: () => update({ session: null, logged: [], staleDismissed: [] }),
    heartbeat: () => persist(),

    addStep: (d) => {
      const s = get().session;
      if (s) update({ session: addStepOp(s, newOperationId(), d) });
    },
    removeStep: (id) => {
      const s = get().session;
      if (s) update({ session: removeStepOp(s, id, now()) });
    },
    moveStep: (id, delta) => {
      const s = get().session;
      if (s) update({ session: moveStepOp(s, id, delta) });
    },
    setDuration: (id, sec) => {
      const s = get().session;
      if (s) update({ session: setDurationOp(s, id, sec) });
    },

    applyToTemplate: () => {
      const s = get().session;
      if (!s || !s.edited) return;
      const nowIso = new Date().toISOString();
      const own = get().templates.find((t) => t.id === s.templateId);
      if (own) {
        update({
          templates: get().templates.map((t) => (t.id === own.id ? applySessionToTemplate(own, s, nowIso) : t)),
          session: { ...s, edited: false },
        });
        return;
      }
      // A built-in is never changed: the edit becomes the user's own copy, inheriting partOfDay.
      const srcPartOfDay = get().allTemplates().find((t) => t.id === s.templateId)?.partOfDay;
      const copy: RoutineTemplate = {
        id: newOperationId(),
        name: `${s.templateName} (benim)`,
        builtIn: false,
        ...(srcPartOfDay ? { partOfDay: srcPartOfDay } : {}),
        versions: [{ version: 1, createdAt: nowIso, steps: s.steps.map((x) => ({ ...x })) }],
      };
      update({ templates: [...get().templates, copy], session: { ...s, edited: false } });
    },
  };
});

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'routineRunner', store: useRoutineRunnerStore });
registerAccountStorage({
  name: 'routineRunner',
  transient: false,
  keysFor: (userId) => [RUNNER_KEY(userId), RUNNER_BAD_KEY(userId)],
});
