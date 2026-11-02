import { create } from 'zustand';
import { accountEpoch, registerAccountScoped, registerAccountStorage } from '../lib/accountScope';
import { currentUser } from '../lib/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addTask as repoInsertFocusTask,
  completeTask as repoCompleteFocusTask,
  completeWorkPhase,
  listOpenTasks as fetchOpenFocusTasks,
  removeTask as repoDeleteFocusTask,
} from '../services/focusService';
import { haptic } from '../lib/haptics';
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';
// R05.03 / KD-03 — the timer is running segments, not a decrementing counter.
import {
  startClock, pauseClock, resumeClock, clockFromRemaining, completedSeconds as clockCompletedSeconds,
  remainingSeconds, snapshotOf, parseSnapshot, restoredClock, type TimerClock,
} from '../lib/focusTimer';
// R03.03 — a small step is a focus session of its own, separate from its task.
import { validateSmallStep, type SmallStep, type SmallStepParent, type SmallStepDraft } from '../lib/smallStart';

type Phase = 'work' | 'shortBreak' | 'longBreak';
type Status = 'idle' | 'running' | 'paused';

/**
 * §22 analytics emission seam (task Phase-4 CODER-O) -- see the identical
 * wrapper in `store/habitStore.ts` for the full rationale. In short: run the
 * payload through `buildEvent` (which drops free text by shape, here, at the
 * call site), hand the result to `lib/analytics.ts`'s sink funnel, and never
 * let `buildEvent`'s deliberate throw escape into the user action.
 */
function emitAnalytics(name: AnalyticsEventName, props: Record<string, unknown>): void {
  try {
    emitEvent(buildEvent(name, props));
  } catch {
    /* §22: an analytics failure is never a product failure. */
  }
}

/**
 * The `Phase` literals in the §22 event vocabulary. `buildEvent`'s enum
 * allowlist is lowercase-only, so the camelCase `'shortBreak'`/`'longBreak'`
 * would be silently DROPPED from a payload -- an event with no phase at all.
 * Mapping them here is what keeps the property on the wire.
 */
const PHASE_TOKEN: Record<Phase, string> = {
  work: 'work',
  shortBreak: 'short_break',
  longBreak: 'long_break',
};

/**
 * F04 (STO-13, INT-16): both keys carry the user id, so a paused session or a setting never
 * crosses accounts on a shared device. The bare prefix is the old, unscoped key: it is read
 * once to adopt settings (a session under it is dropped, its owner is unknown).
 */
export const SETTINGS_KEY_PREFIX = 'focus.settings.v1';
/** R05.03 — the session in progress, so an app kill does not lose it. */
export const SESSION_KEY_PREFIX = 'focus.session.v1';
export const sessionKey = (uid: string): string => `${SESSION_KEY_PREFIX}.${uid}`;
export const settingsKey = (uid: string): string => `${SETTINGS_KEY_PREFIX}.${uid}`;
/** How often a running session refreshes its `lastSeenAt` (ms). */
const HEARTBEAT_MS = 15_000;

export const DURATIONS: Record<Phase, number> = {
  work: 25 * 60,
  shortBreak: 5 * 60,
  longBreak: 15 * 60,
};

export type FocusSettings = {
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  presetId: string;
  overlayOpacity: number;
  // Otomasyon
  autoStartBreaks: boolean;
  autoStartPomodoros: boolean;
  longBreakInterval: number;
  // Görev
  requireTaskBeforeStart: boolean;
  autoCheckTasks: boolean;
  // Ses / bildirim
  soundOnFinish: boolean;
  notifyOnFinish: boolean;
  // Genel
  hourFormat: '24h' | '12h';
  // Raporlar
  enableLocalReports: boolean;
  defaultReportRange: 'today' | 'week' | 'month' | 'year';
  showFocusChart: boolean;
  showRanking: boolean;
};

export const DEFAULT_SETTINGS: FocusSettings = {
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  presetId: 'default',
  overlayOpacity: 0,
  autoStartBreaks: false,
  autoStartPomodoros: false,
  longBreakInterval: 4,
  requireTaskBeforeStart: false,
  autoCheckTasks: false,
  soundOnFinish: true,
  notifyOnFinish: false,
  hourFormat: '24h',
  enableLocalReports: true,
  defaultReportRange: 'week',
  showFocusChart: true,
  showRanking: true,
};

/** The same bounds as the Stepper controls of `components/focus/FocusSettingsModal.tsx`. */
export const FOCUS_SETTING_BOUNDS = {
  workMinutes: [1, 120],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 60],
  longBreakInterval: [2, 12],
  overlayOpacity: [0, 1],
} as const;

const BOOLEAN_SETTINGS = [
  'autoStartBreaks', 'autoStartPomodoros', 'requireTaskBeforeStart', 'autoCheckTasks',
  'soundOnFinish', 'notifyOnFinish', 'enableLocalReports', 'showFocusChart', 'showRanking',
] as const;

/**
 * F04 (INT-16): stored settings are untrusted input. `{"workMinutes":"abc"}` used to spread into
 * the store and make `phaseSeconds` return NaN. Numbers outside the Stepper range are clamped
 * (minutes rounded), anything of the wrong type falls back to its default, unknown keys are dropped.
 */
export function normaliseFocusSettings(raw: unknown): FocusSettings {
  const out: FocusSettings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const key of Object.keys(FOCUS_SETTING_BOUNDS) as (keyof typeof FOCUS_SETTING_BOUNDS)[]) {
    const v = r[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    const [lo, hi] = FOCUS_SETTING_BOUNDS[key];
    const clamped = Math.min(hi, Math.max(lo, v));
    out[key] = key === 'overlayOpacity' ? clamped : Math.round(clamped);
  }
  for (const key of BOOLEAN_SETTINGS) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean;
  }
  if (r.hourFormat === '24h' || r.hourFormat === '12h') out.hourFormat = r.hourFormat;
  if (r.defaultReportRange === 'today' || r.defaultReportRange === 'week' || r.defaultReportRange === 'month' || r.defaultReportRange === 'year') {
    out.defaultReportRange = r.defaultReportRange;
  }
  if (typeof r.presetId === 'string') out.presetId = r.presetId;
  return out;
}

/** The configured length of one phase, in seconds. */
export function phaseSeconds(s: FocusSettings, phase: Phase): number {
  const minutes: Record<Phase, number> = {
    work: s.workMinutes,
    shortBreak: s.shortBreakMinutes,
    longBreak: s.longBreakMinutes,
  };
  return minutes[phase] * 60;
}

export type CompletedSession = {
  taskTitle: string | null;
  seconds: number;
  sessionNumber: number;
};

export type FocusTask = {
  id: string;
  user_id: string;
  title: string;
  completed: boolean;
  selected: boolean;
  estimated_pomodoros: number;
  completed_pomodoros: number;
  total_focus_seconds: number;
  color: string;
  created_at: string;
};

type FocusStore = {
  // Timer state
  phase: Phase;
  status: Status;
  secondsLeft: number;
  sessionsCompleted: number;
  sessionStartedAt: string | null;
  /** R05.03 — the session's running segments; null when no session is open. */
  clock: TimerClock | null;
  /** R03.03 — set while the open session is a small step. */
  smallStep: SmallStep | null;
  settings: FocusSettings;

  // Tamamlanan seans sinyali (UI 'Seans Tamamlandı' raporunu açar)
  justCompleted: CompletedSession | null;
  clearJustCompleted: () => void;

  // Focus tasks
  focusTasks: FocusTask[];
  selectedTaskId: string | null;
  loadingTasks: boolean;

  // Settings
  updateSettings: (s: Partial<FocusSettings>) => void;
  loadSettings: () => Promise<void>;
  /** R05.03 — bring back a session the app was killed in, paused. */
  restoreSession: () => Promise<void>;

  // Timer actions
  start: () => void;
  /**
   * R03.03 — start a small step as a focus session of its own length. Refused
   * (false) while another session is open or when the draft is not a step.
   */
  startSmallStep: (parent: SmallStepParent, draft: SmallStepDraft) => boolean;
  pause: () => void;
  reset: () => void;
  tick: () => void;
  nextPhase: () => Promise<void>;
  setPhase: (phase: Phase) => void;

  // Task actions
  fetchFocusTasks: () => Promise<void>;
  addFocusTask: (title: string, estimatedPomodoros?: number) => Promise<void>;
  removeFocusTask: (id: string) => Promise<void>;
  completeFocusTask: (id: string) => Promise<void>;
  selectTask: (id: string | null) => void;
};

let lastHeartbeat = 0;
/** One `nextPhase` at a time: ticks keep firing while it awaits the write. */
let advancing = false;

function persistSession(st: Pick<FocusStore, 'phase' | 'clock' | 'sessionStartedAt' | 'sessionsCompleted' | 'smallStep'>): void {
  if (!st.clock || !st.sessionStartedAt) return;
  const now = Date.now();
  lastHeartbeat = now;
  const snap = snapshotOf({ phase: st.phase, clock: st.clock, sessionStartedAt: st.sessionStartedAt, sessionsCompleted: st.sessionsCompleted, now, step: st.smallStep });
  const payload = JSON.stringify(snap);
  // F04: under the signed-in user's key; a write that resolves after an account boundary is dropped.
  const epoch = accountEpoch();
  void (async () => {
    const uid = (await currentUser())?.id;
    if (!uid || epoch !== accountEpoch()) return;
    await AsyncStorage.setItem(sessionKey(uid), payload);
  })().catch(() => {});
}

function clearSession(): void {
  void (async () => {
    const uid = (await currentUser())?.id;
    if (!uid) return;
    await AsyncStorage.removeItem(sessionKey(uid));
  })().catch(() => {});
}

/** F04: the user's settings key, adopting the old unscoped key once (the `lib/syncQueue.ts` migration pattern). */
async function readSettings(uid: string): Promise<FocusSettings | null> {
  const own = await AsyncStorage.getItem(settingsKey(uid));
  if (own) return normaliseFocusSettings(JSON.parse(own));
  const legacy = await AsyncStorage.getItem(SETTINGS_KEY_PREFIX);
  if (!legacy) return null;
  const adopted = normaliseFocusSettings(JSON.parse(legacy));
  await AsyncStorage.setItem(settingsKey(uid), JSON.stringify(adopted));
  await AsyncStorage.removeItem(SETTINGS_KEY_PREFIX);
  return adopted;
}

export const useFocusStore = create<FocusStore>((set, get) => ({
  phase: 'work',
  status: 'idle',
  secondsLeft: DURATIONS.work,
  sessionsCompleted: 0,
  sessionStartedAt: null,
  clock: null,
  smallStep: null,
  settings: { ...DEFAULT_SETTINGS },
  justCompleted: null,
  focusTasks: [],
  selectedTaskId: null,
  loadingTasks: false,

  clearJustCompleted: () => set({ justCompleted: null }),

  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    // Kalıcı kaydet (yangın-ve-unut) -- F04: kullanıcının kendi anahtarına
    const payload = JSON.stringify(next);
    void (async () => {
      const uid = (await currentUser())?.id;
      if (!uid) return;
      await AsyncStorage.setItem(settingsKey(uid), payload);
    })().catch(() => {});
    // Süreyi güncelle (mevcut seans yoksa). An open session keeps the plan
    // it started with -- its clock carries `plannedSeconds`.
    if (get().status === 'idle') {
      set({ secondsLeft: phaseSeconds(next, get().phase) });
    }
  },

  loadSettings: async () => {
    try {
      const epoch = accountEpoch();
      const uid = (await currentUser())?.id;
      if (!uid) return;
      const next = await readSettings(uid);
      if (!next || epoch !== accountEpoch()) return;
      set({ settings: next });
      if (get().status === 'idle') {
        set({ secondsLeft: phaseSeconds(next, get().phase) });
      }
    } catch { /* yoksay */ }
  },

  restoreSession: async () => {
    try {
      const epoch = accountEpoch();
      const uid = (await currentUser())?.id;
      if (!uid) return;
      // F04: a session saved under the old unscoped key belongs to nobody we can name: drop it, never load it.
      await AsyncStorage.removeItem(SESSION_KEY_PREFIX).catch(() => {});
      const snap = parseSnapshot(await AsyncStorage.getItem(sessionKey(uid)));
      if (!snap || epoch !== accountEpoch()) return;
      // A session already open in memory wins over the stored one.
      if (get().status !== 'idle') return;
      const clock = restoredClock(snap);
      set({
        phase: snap.phase,
        status: 'paused',
        clock,
        secondsLeft: remainingSeconds(clock, Date.now()),
        sessionStartedAt: snap.sessionStartedAt,
        sessionsCompleted: Math.max(get().sessionsCompleted, snap.sessionsCompleted),
        smallStep: snap.step ?? null,
      });
      persistSession(get());
    } catch { /* yoksay */ }
  },

  start: () => {
    const { status, phase, settings, selectedTaskId } = get();
    // `app/tabs/focus.tsx` calls `start()` for BOTH "Başla" and "Devam Et",
    // and `nextPhase` routes its auto-start through here too -- so this is
    // the store's one session-start funnel. A resume ('paused' -> 'running')
    // continues the SAME session, so only an idle -> running transition
    // counts as a start; without this guard every pause/resume pair would
    // report an extra session.
    const isNewSession = status === 'idle';
    if (status === 'running') return;
    const now = Date.now();
    if (isNewSession) {
      // KD-03: `sessionStartedAt` is written ONLY here. A resume keeps it --
      // rewriting it on "Devam Et" made a session report its last segment.
      set({ status: 'running', sessionStartedAt: new Date(now).toISOString(), clock: startClock(phaseSeconds(settings, phase), now) });
    } else {
      const { clock, secondsLeft } = get();
      const base = clock ?? clockFromRemaining(phaseSeconds(settings, phase), secondsLeft);
      set({ status: 'running', clock: resumeClock(base, now) });
    }
    persistSession(get());
    if (isNewSession) {
      // §22 `focus_started`. No task title -- that is user prose; the task's
      // id and a boolean are enough to analyse "started with a target".
      emitAnalytics('focus_started', {
        phase: PHASE_TOKEN[phase],
        planned_seconds: phaseSeconds(settings, phase),
        task_id: selectedTaskId,
        has_task: !!selectedTaskId,
      });
    }
  },
  startSmallStep: (parent, draft) => {
    if (get().status !== 'idle') return false;
    const check = validateSmallStep(parent, draft);
    if (!check.ok) return false;
    const now = Date.now();
    const plannedSeconds = check.step.minutes * 60;
    // The step's own length -- not the configured pomodoro -- and no focus
    // task: the step is not the task and does not credit one.
    set({
      phase: 'work',
      status: 'running',
      smallStep: check.step,
      clock: startClock(plannedSeconds, now),
      secondsLeft: plannedSeconds,
      sessionStartedAt: new Date(now).toISOString(),
    });
    persistSession(get());
    emitAnalytics('focus_started', {
      phase: PHASE_TOKEN.work,
      planned_seconds: plannedSeconds,
      task_id: null,
      has_task: false,
    });
    return true;
  },

  pause: () => {
    const { status, clock } = get();
    if (status !== 'running') return;
    const now = Date.now();
    // KD-03: the pause closes the running segment; the time until "Devam Et"
    // is not focus.
    const paused = clock ? pauseClock(clock, now) : null;
    set({ status: 'paused', clock: paused, ...(paused ? { secondsLeft: remainingSeconds(paused, now) } : {}) });
    persistSession(get());
  },

  reset: () => {
    const { phase, settings } = get();
    // KD-03: the configured length, not the 25/5/15 constants.
    set({ status: 'idle', secondsLeft: phaseSeconds(settings, phase), sessionStartedAt: null, clock: null, smallStep: null });
    clearSession();
  },

  tick: () => {
    const { status, clock } = get();
    if (status !== 'running') return;
    const now = Date.now();
    // The interval only asks the clock; a slept JS thread loses no time.
    const left = clock ? remainingSeconds(clock, now) : Math.max(0, get().secondsLeft - 1);
    if (left > 0) {
      set({ secondsLeft: left });
      if (now - lastHeartbeat >= HEARTBEAT_MS) persistSession(get());
    } else {
      set({ secondsLeft: 0 });
      get().nextPhase();
    }
  },

  nextPhase: async () => {
    if (advancing) return;
    advancing = true;
    try {
      await advancePhase();
    } finally {
      advancing = false;
    }
  },

  setPhase: (phase) => {
    set({ phase, secondsLeft: phaseSeconds(get().settings, phase), status: 'idle', sessionStartedAt: null, clock: null, smallStep: null });
    clearSession();
  },

  fetchFocusTasks: async () => {
    set({ loadingTasks: true });
    const res = await fetchOpenFocusTasks();
    if (!res.ok) { set({ loadingTasks: false }); return; }
    set({ focusTasks: res.data as FocusTask[], loadingTasks: false });
  },

  addFocusTask: async (title, estimatedPomodoros = 1) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    const res = await repoInsertFocusTask(trimmed, estimatedPomodoros);
    if (!res.ok) return;
    set((s) => ({ focusTasks: [...s.focusTasks, res.data as FocusTask] }));
  },

  removeFocusTask: async (id) => {
    const res = await repoDeleteFocusTask(id);
    if (!res.ok) return;
    set((s) => ({
      focusTasks: s.focusTasks.filter((t) => t.id !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
    }));
  },

  completeFocusTask: async (id) => {
    const res = await repoCompleteFocusTask(id);
    // A failed write leaves the task in the list instead of removing it for a
    // completion the server never accepted.
    if (!res.ok) return;
    set((s) => ({
      focusTasks: s.focusTasks.filter((t) => t.id !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
    }));
  },

  selectTask: (id) => set({ selectedTaskId: id }),
}));

/** The body of `nextPhase`, run under its one-at-a-time guard. */
async function advancePhase(): Promise<void> {
  const set = useFocusStore.setState;
  const get = useFocusStore.getState;
  const { phase, status, clock, sessionsCompleted, selectedTaskId, focusTasks, settings, smallStep } = get();
  const customDurations: Record<Phase, number> = {
    work: phaseSeconds(settings, 'work'),
    shortBreak: phaseSeconds(settings, 'shortBreak'),
    longBreak: phaseSeconds(settings, 'longBreak'),
  };
  const openClock = status !== 'idle' ? clock : null;
  // The plan the session started with; settings edited mid-session do not
  // move the goalposts of a session already running.
  const plannedSeconds = openClock ? openClock.plannedSeconds : customDurations[phase];
  // KD-03: running segments only -- pauses are not focus time.
  const completedSeconds = openClock ? clockCompletedSeconds(openClock, Date.now()) : plannedSeconds;
  clearSession();

  // R03.03 — a small step records its own session and nothing else: no focus
  // task is credited or auto-completed, the parent task is not touched, and
  // no break follows. The user goes back to their plan.
  if (smallStep && phase === 'work') {
    const outcome = await completeWorkPhase({
      task: undefined,
      plannedSeconds,
      completedSeconds,
      autoCheckTasks: false,
      title: smallStep.title,
    });
    if (outcome.sessionRecorded) {
      emitAnalytics('focus_completed', {
        phase: PHASE_TOKEN.work,
        planned_seconds: plannedSeconds,
        completed_seconds: completedSeconds,
        session_number: sessionsCompleted + 1,
        task_id: null,
        has_task: false,
      });
    }
    if (settings.soundOnFinish) { try { haptic.success(); } catch { /* yoksay */ } }
    set({
      phase: 'work', status: 'idle', secondsLeft: customDurations.work,
      sessionsCompleted: sessionsCompleted + 1,
      sessionStartedAt: null, clock: null, smallStep: null,
      justCompleted: { taskTitle: smallStep.title, seconds: completedSeconds, sessionNumber: sessionsCompleted + 1 },
    });
    return;
  }

  // Recording the session, crediting the task and auto-completing it are
  // one domain operation with an ordering rule (a task is never credited
  // for a session the database rejected) -- see
  // `services/focusService.completeWorkPhase`.
  if (phase === 'work') {
    const selectedTask = focusTasks.find((t) => t.id === selectedTaskId);
    const outcome = await completeWorkPhase({
      task: selectedTask as never,
      plannedSeconds,
      completedSeconds,
      autoCheckTasks: settings.autoCheckTasks,
    });

    // §22 `focus_completed`. Gated on the session row existing: a rejected
    // insert leaves no row and must leave no event either. `task_title` IS
    // written to the row (the user's own data, their own table) and is
    // deliberately NOT put on the event -- exactly the boundary §22 draws.
    if (outcome.sessionRecorded) {
      emitAnalytics('focus_completed', {
        phase: PHASE_TOKEN[phase],
        planned_seconds: plannedSeconds,
        completed_seconds: completedSeconds,
        session_number: sessionsCompleted + 1,
        task_id: selectedTaskId,
        has_task: !!selectedTaskId,
      });
    }

    if (selectedTaskId) {
      if (outcome.taskCompleted) {
        set((s) => ({
          focusTasks: s.focusTasks.filter((t) => t.id !== selectedTaskId),
          selectedTaskId: null,
        }));
      } else {
        await get().fetchFocusTasks();
      }
    }
  }

  // Bitiş geri bildirimi
  if (settings.soundOnFinish) { try { haptic.success(); } catch { /* yoksay */ } }

  if (phase === 'work') {
    const completed = sessionsCompleted + 1;
    const interval = Math.max(2, settings.longBreakInterval || 4);
    const next: Phase = completed % interval === 0 ? 'longBreak' : 'shortBreak';
    const auto = settings.autoStartBreaks;
    const doneTitle = focusTasks.find((t) => t.id === selectedTaskId)?.title ?? null;
    set({
      phase: next, secondsLeft: customDurations[next],
      status: 'idle',
      sessionsCompleted: completed,
      sessionStartedAt: null,
      clock: null,
      justCompleted: { taskTitle: doneTitle, seconds: completedSeconds, sessionNumber: completed },
    });
    // Auto-start now goes through `start()` instead of inlining
    // `status: 'running'` + a fresh `sessionStartedAt` here. Identical
    // resulting state, but it keeps `start()` the ONE place a session
    // begins -- otherwise an auto-started chain would produce
    // `focus_completed` events with no matching `focus_started`.
    if (auto) get().start();
  } else {
    const hasTask = !!get().selectedTaskId;
    const auto = settings.autoStartPomodoros && (!settings.requireTaskBeforeStart || hasTask);
    set({
      phase: 'work', secondsLeft: customDurations.work,
      status: 'idle',
      sessionStartedAt: null,
      clock: null,
    });
    if (auto) get().start();
  }
}

// F04 (STO-13, INT-16): the timer, the small step and the task list belong to the signed-in account.
// `tick` returns at once on `status: 'idle'`, so the reset also stops a running timer.
registerAccountScoped({
  name: 'focus',
  store: useFocusStore,
  onReset: () => {
    lastHeartbeat = 0;
    advancing = false;
  },
});
// the half-finished session goes on every account boundary; the settings stay under their user's key
registerAccountStorage({ name: 'focus.session', transient: true, keysFor: (uid) => [sessionKey(uid)] });
registerAccountStorage({ name: 'focus.settings', transient: false, keysFor: (uid) => [settingsKey(uid)] });
