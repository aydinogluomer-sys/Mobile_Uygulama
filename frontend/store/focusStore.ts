import { create } from 'zustand';
import { AppState } from 'react-native';
import { accountEpoch, registerAccountScoped, registerAccountStorage } from '../lib/accountScope';
import { currentUser } from '../lib/session';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  addTask as repoInsertFocusTask,
  completeTask as repoCompleteFocusTask,
  completeWorkPhase,
  listOpenTasks as fetchOpenFocusTasks,
  recordPartialWorkPhase,
  removeTask as repoDeleteFocusTask,
} from '../services/focusService';
import { haptic } from '../lib/haptics';
import { buildEvent, emitEvent, type AnalyticsEventName } from '../lib/analytics';
import { cancelFocusEnd, scheduleFocusEnd, type FocusEndKind } from '../lib/notifications';
// R05.03 / KD-03 / F16 — the timer is running segments, not a decrementing counter.
import {
  AWAY_MIN_MS,
  FOCUS_END_GRACE_MS,
  MIN_PARTIAL_SECONDS,
  SESSION_MAX_AGE_MS,
  clockFromRemaining,
  completedSeconds as clockCompletedSeconds,
  expectedEndMs,
  isSnapshotFresh,
  parseSnapshot,
  pauseClock,
  remainingSeconds,
  restoredClock,
  resumeClock,
  snapshotOf,
  startClock,
  type SessionSnapshot,
  type TimerClock,
} from '../lib/focusTimer';
// R03.03 — a small step is a focus session of its own, separate from its task.
import { validateSmallStep, type SmallStep, type SmallStepParent, type SmallStepDraft } from '../lib/smallStart';
import {
  EMPTY_TALLY,
  classifyAway as classifyAwayTally,
  focusIntentKey,
  normalizeIntent,
  parseIntent,
  recordAway,
  serializeIntent,
  type InterruptionCause,
  type InterruptionTally,
} from '../lib/focusRitual';

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
  pauseInBackground: boolean;
  intentPrompt: boolean;
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
  pauseInBackground: false,
  intentPrompt: true,
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
  'autoStartBreaks',
  'autoStartPomodoros',
  'pauseInBackground',
  'intentPrompt',
  'requireTaskBeforeStart',
  'autoCheckTasks',
  'soundOnFinish',
  'notifyOnFinish',
  'enableLocalReports',
  'showFocusChart',
  'showRanking',
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
  return Math.max(1, Math.round(minutes[phase])) * 60;
}

export type CompletedSession = {
  taskTitle: string | null;
  seconds: number;
  sessionNumber: number;
  intent?: string | null;
  interruptions?: number;
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

export type FocusTaskResult = { ok: true } | { ok: false; error: string };

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
  /** F16 — epoch ms the open session was paused; null while running or idle. */
  pausedAt: number | null;
  /** F16 — shown once when abandoned effort (>= 60s) was saved as partial focus. */
  lastPartial: { seconds: number } | null;
  /** F33 (PS-11) — one-line pre-focus intent for the active work session. */
  intent: string | null;
  /** F33 (PS-15) — compassionate away/return tally for the active work session. */
  interruptions: InterruptionTally;
  settings: FocusSettings;

  // Tamamlanan seans sinyali (UI 'Seans Tamamlandı' raporunu açar)
  justCompleted: CompletedSession | null;
  clearJustCompleted: () => void;

  // Ritual actions (F33)
  setIntent: (text: string | null) => Promise<void>;
  loadLastIntent: () => Promise<string | null>;
  classifyAway: (cause: InterruptionCause | null) => void;

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
  /** F16 — app left foreground. */
  onBackground: () => void;
  /** F16 — app returned to foreground: reconciles clock; returns `{ awayMs }` if >= 10s (F33 seam). */
  onForeground: () => { awayMs: number } | null;

  // Task actions
  fetchFocusTasks: () => Promise<FocusTaskResult>;
  addFocusTask: (title: string, estimatedPomodoros?: number) => Promise<FocusTaskResult>;
  removeFocusTask: (id: string) => Promise<FocusTaskResult>;
  completeFocusTask: (id: string) => Promise<FocusTaskResult>;
  selectTask: (id: string | null) => void;
};

let lastHeartbeat = 0;
/** One `nextPhase` at a time: ticks keep firing while it awaits the write. */
let advancing = false;
let leftAt: number | null = null;
let strictLeftAt: number | null = null;
const armedEnds = new Set<FocusEndKind>();
let endChain: Promise<unknown> = Promise.resolve();
const runEndOp = (fn: () => Promise<unknown>): void => {
  endChain = endChain.then(fn, fn).catch(() => undefined);
};
const kindOf = (phase: Phase): FocusEndKind => (phase === 'work' ? 'work' : 'break');

function syncEndNotice(): void {
  const { status, clock, phase, settings } = useFocusStore.getState();
  const endsAt = status === 'running' && clock ? expectedEndMs(clock) : null;
  if (!settings.notifyOnFinish || endsAt === null || !clock) {
    disarmEnd(kindOf(phase));
    return;
  }
  armedEnds.add(kindOf(phase));
  runEndOp(() =>
    typeof scheduleFocusEnd === 'function'
      ? scheduleFocusEnd({
          phase,
          endsAtMs: endsAt + FOCUS_END_GRACE_MS,
          plannedSeconds: clock.plannedSeconds,
          withSound: settings.soundOnFinish,
        })
      : Promise.resolve(false),
  );
}

function disarmEnd(kind?: FocusEndKind, force = false): void {
  const kinds: FocusEndKind[] = kind ? [kind] : ['work', 'break'];
  for (const k of kinds) {
    if (!force && !armedEnds.has(k)) continue;
    armedEnds.delete(k);
    runEndOp(() => (typeof cancelFocusEnd === 'function' ? cancelFocusEnd(k) : Promise.resolve()));
  }
}

/** >= MIN_PARTIAL_SECONDS çalışılmış açık çalışma oturumunu kısmi odak olarak yazar; yazdığını döner. */
function recordAbandoned(
  st: Pick<FocusStore, 'phase' | 'status' | 'clock' | 'sessionStartedAt' | 'smallStep' | 'selectedTaskId' | 'focusTasks'>,
  endedAtMs: number,
): { seconds: number } | null {
  if (advancing || st.status === 'idle' || st.phase !== 'work' || !st.clock) return null;
  const seconds = clockCompletedSeconds(st.clock, endedAtMs);
  if (seconds < MIN_PARTIAL_SECONDS) return null;
  const task = st.smallStep ? undefined : st.focusTasks.find((t) => t.id === st.selectedTaskId);
  void recordPartialWorkPhase({
    startedAtIso: st.sessionStartedAt ?? new Date(endedAtMs - seconds * 1000).toISOString(),
    endedAtIso: new Date(endedAtMs).toISOString(),
    plannedSeconds: st.clock.plannedSeconds,
    completedSeconds: seconds,
    taskId: task?.id ?? null,
    taskTitle: task?.title ?? st.smallStep?.title ?? null,
  }).catch(() => undefined);
  return { seconds };
}

function recordStaleSnapshot(snap: SessionSnapshot): void {
  const seconds = clockCompletedSeconds(restoredClock(snap), snap.lastSeenAt);
  if (seconds < MIN_PARTIAL_SECONDS) return;
  void recordPartialWorkPhase({
    startedAtIso: snap.sessionStartedAt,
    endedAtIso: new Date(snap.pausedAt ?? snap.lastSeenAt).toISOString(),
    plannedSeconds: snap.clock.plannedSeconds,
    completedSeconds: seconds,
    taskTitle: snap.step?.title ?? null,
  }).catch(() => undefined);
  useFocusStore.setState({ lastPartial: { seconds } });
}

function expireStalePaused(now: number): void {
  const st = useFocusStore.getState();
  if (st.status !== 'paused' || st.pausedAt === null || now - st.pausedAt <= SESSION_MAX_AGE_MS) return;
  const saved = recordAbandoned(st, st.pausedAt);
  disarmEnd(undefined, true);
  clearSession();
  useFocusStore.setState({
    status: 'idle',
    secondsLeft: phaseSeconds(st.settings, st.phase),
    clock: null,
    sessionStartedAt: null,
    smallStep: null,
    pausedAt: null,
    lastPartial: saved,
    intent: null,
    interruptions: EMPTY_TALLY,
  });
}

function persistSession(
  st: Pick<FocusStore, 'phase' | 'clock' | 'sessionStartedAt' | 'sessionsCompleted' | 'smallStep' | 'pausedAt'>,
): void {
  if (!st.clock || !st.sessionStartedAt) return;
  const now = Date.now();
  lastHeartbeat = now;
  const snap = snapshotOf({
    phase: st.phase,
    clock: st.clock,
    sessionStartedAt: st.sessionStartedAt,
    sessionsCompleted: st.sessionsCompleted,
    now,
    step: st.smallStep,
    pausedAt: st.pausedAt,
  });
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
  pausedAt: null,
  lastPartial: null,
  intent: null,
  interruptions: EMPTY_TALLY,
  settings: { ...DEFAULT_SETTINGS },
  justCompleted: null,
  focusTasks: [],
  selectedTaskId: null,
  loadingTasks: false,

  clearJustCompleted: () => set({ justCompleted: null }),

  setIntent: async (text) => {
    const normalized = normalizeIntent(text ?? '');
    set({ intent: normalized });
    const epoch = accountEpoch();
    try {
      const uid = (await currentUser())?.id;
      if (!uid || epoch !== accountEpoch()) return;
      if (normalized !== null) {
        await AsyncStorage.setItem(
          focusIntentKey(uid),
          serializeIntent(normalized, Date.now()),
        );
      } else {
        await AsyncStorage.removeItem(focusIntentKey(uid));
      }
    } catch {
      /* ignore storage errors */
    }
  },

  loadLastIntent: async () => {
    try {
      const epoch = accountEpoch();
      const user = await currentUser();
      if (!user || epoch !== accountEpoch()) return null;
      const raw = await AsyncStorage.getItem(focusIntentKey(user.id));
      if (epoch !== accountEpoch()) return null;
      return parseIntent(raw)?.text ?? null;
    } catch {
      return null;
    }
  },

  classifyAway: (cause) => {
    set((st) => ({ interruptions: classifyAwayTally(st.interruptions, cause) }));
  },

  updateSettings: (patch) => {
    const prev = get().settings;
    const next = normaliseFocusSettings({ ...prev, ...patch });
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
    if (prev.notifyOnFinish !== next.notifyOnFinish) syncEndNotice();
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
      disarmEnd(undefined, true);
      if (!isSnapshotFresh(snap, Date.now())) {
        await AsyncStorage.removeItem(sessionKey(uid)).catch(() => {});
        clearSession();
        if (snap.phase === 'work') recordStaleSnapshot(snap);
        return;
      }
      const clock = restoredClock(snap);
      const restoredIntent =
        snap.phase === 'work' && !snap.step
          ? parseIntent(await AsyncStorage.getItem(focusIntentKey(uid)))?.text ?? null
          : null;
      if (epoch !== accountEpoch()) return;
      set({
        phase: snap.phase,
        status: 'paused',
        clock,
        secondsLeft: remainingSeconds(clock, Date.now()),
        sessionStartedAt: snap.sessionStartedAt,
        sessionsCompleted: Math.max(get().sessionsCompleted, snap.sessionsCompleted),
        smallStep: snap.step ?? null,
        pausedAt: snap.pausedAt ?? snap.lastSeenAt,
        intent: restoredIntent,
        interruptions: EMPTY_TALLY,
      });
      persistSession(get());
    } catch { /* yoksay */ }
  },

  start: () => {
    const { status, phase, settings, selectedTaskId } = get();
    const isNewSession = status === 'idle';
    if (status === 'running') return;
    const now = Date.now();
    if (isNewSession) {
      // KD-03: `sessionStartedAt` is written ONLY here. A resume keeps it --
      // rewriting it on "Devam Et" made a session report its last segment.
      set({
        status: 'running',
        sessionStartedAt: new Date(now).toISOString(),
        clock: startClock(phaseSeconds(settings, phase), now),
        pausedAt: null,
        lastPartial: null,
        interruptions: EMPTY_TALLY,
      });
    } else {
      const { clock, secondsLeft } = get();
      const base = clock ?? clockFromRemaining(phaseSeconds(settings, phase), secondsLeft);
      set({ status: 'running', clock: resumeClock(base, now), pausedAt: null });
    }
    persistSession(get());
    syncEndNotice();
    if (isNewSession) {
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
    set({
      phase: 'work',
      status: 'running',
      smallStep: check.step,
      clock: startClock(plannedSeconds, now),
      secondsLeft: plannedSeconds,
      sessionStartedAt: new Date(now).toISOString(),
      pausedAt: null,
      lastPartial: null,
      intent: null,
      interruptions: EMPTY_TALLY,
    });
    persistSession(get());
    syncEndNotice();
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
    set({
      status: 'paused',
      clock: paused,
      pausedAt: now,
      ...(paused ? { secondsLeft: remainingSeconds(paused, now) } : {}),
    });
    persistSession(get());
    disarmEnd(kindOf(get().phase));
  },

  reset: () => {
    const st = get();
    const saved = recordAbandoned(st, st.pausedAt ?? Date.now());
    disarmEnd(kindOf(st.phase));
    // KD-03: the configured length, not the 25/5/15 constants.
    set({
      status: 'idle',
      secondsLeft: phaseSeconds(st.settings, st.phase),
      sessionStartedAt: null,
      clock: null,
      smallStep: null,
      pausedAt: null,
      lastPartial: saved,
      intent: null,
      interruptions: EMPTY_TALLY,
    });
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
    const st = get();
    const saved = recordAbandoned(st, st.pausedAt ?? Date.now());
    disarmEnd(kindOf(st.phase));
    set({
      phase,
      secondsLeft: phaseSeconds(st.settings, phase),
      status: 'idle',
      sessionStartedAt: null,
      clock: null,
      smallStep: null,
      pausedAt: null,
      lastPartial: saved,
      intent: null,
      interruptions: EMPTY_TALLY,
    });
    clearSession();
  },

  onBackground: () => {
    const { status, settings } = get();
    if (status !== 'running') {
      leftAt = null;
      strictLeftAt = null;
      return;
    }
    if (settings.pauseInBackground) {
      leftAt = null;
      strictLeftAt = Date.now();
      get().pause();
      return;
    }
    strictLeftAt = null;
    leftAt = Date.now();
    persistSession(get());
  },

  onForeground: () => {
    const now = Date.now();
    const away = leftAt !== null ? now - leftAt : 0;
    const strictAway = strictLeftAt !== null ? now - strictLeftAt : 0;
    leftAt = null;
    strictLeftAt = null;
    expireStalePaused(now);
    const awayForTally = away > 0 ? away : strictAway;
    if (
      awayForTally >= AWAY_MIN_MS &&
      get().phase === 'work' &&
      get().sessionStartedAt !== null
    ) {
      set({ interruptions: recordAway(get().interruptions, awayForTally) });
    }
    get().tick();
    return away >= AWAY_MIN_MS ? { awayMs: away } : null;
  },

  fetchFocusTasks: async () => {
    set({ loadingTasks: true });
    const res = await fetchOpenFocusTasks();
    if (!res.ok) {
      set({ loadingTasks: false });
      return { ok: false, error: res.error };
    }
    set({ focusTasks: res.data as FocusTask[], loadingTasks: false });
    return { ok: true };
  },

  addFocusTask: async (title, estimatedPomodoros = 1) => {
    const trimmed = title.trim();
    if (!trimmed) return { ok: false, error: 'Başlık boş olamaz.' };
    const res = await repoInsertFocusTask(trimmed, estimatedPomodoros);
    if (!res.ok) return { ok: false, error: res.error };
    set((s) => ({ focusTasks: [...s.focusTasks, res.data as FocusTask] }));
    return { ok: true };
  },

  removeFocusTask: async (id) => {
    const res = await repoDeleteFocusTask(id);
    if (!res.ok) return { ok: false, error: res.error };
    set((s) => ({
      focusTasks: s.focusTasks.filter((t) => t.id !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
    }));
    return { ok: true };
  },

  completeFocusTask: async (id) => {
    const res = await repoCompleteFocusTask(id);
    if (!res.ok) return { ok: false, error: res.error };
    set((s) => ({
      focusTasks: s.focusTasks.filter((t) => t.id !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
    }));
    return { ok: true };
  },

  selectTask: (id) => set({ selectedTaskId: id }),
}));

/** The body of `nextPhase`, run under its one-at-a-time guard. */
async function advancePhase(): Promise<void> {
  const set = useFocusStore.setState;
  const get = useFocusStore.getState;
  const {
    phase,
    status,
    clock,
    sessionsCompleted,
    selectedTaskId,
    focusTasks,
    settings,
    smallStep,
    sessionStartedAt,
    intent,
    interruptions,
  } = get();
  const startedAtIso = sessionStartedAt ?? undefined;
  const customDurations: Record<Phase, number> = {
    work: phaseSeconds(settings, 'work'),
    shortBreak: phaseSeconds(settings, 'shortBreak'),
    longBreak: phaseSeconds(settings, 'longBreak'),
  };
  const openClock = status !== 'idle' ? clock : null;
  // The plan the session started with; settings edited mid-session do not
  // move the goalposts of a session already running.
  const plannedSeconds = openClock ? openClock.plannedSeconds : customDurations[phase];
  const nowMs = Date.now();
  const plannedEnd = openClock ? expectedEndMs(openClock) : null;
  const endedMs = plannedEnd !== null ? Math.min(nowMs, plannedEnd) : nowMs;
  const endedAtIso = new Date(endedMs).toISOString();
  // KD-03: running segments only -- pauses are not focus time.
  const completedSeconds = openClock ? clockCompletedSeconds(openClock, nowMs) : plannedSeconds;
  clearSession();
  if (AppState.currentState === 'active') disarmEnd(kindOf(phase));

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
      startedAtIso,
      endedAtIso,
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
      phase: 'work',
      status: 'idle',
      secondsLeft: customDurations.work,
      sessionsCompleted: sessionsCompleted + 1,
      sessionStartedAt: null,
      clock: null,
      smallStep: null,
      pausedAt: null,
      intent: null,
      interruptions: EMPTY_TALLY,
      justCompleted: {
        taskTitle: smallStep.title,
        seconds: completedSeconds,
        sessionNumber: sessionsCompleted + 1,
        intent: intent ?? null,
        interruptions: interruptions.total,
      },
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
      task: selectedTask,
      plannedSeconds,
      completedSeconds,
      autoCheckTasks: settings.autoCheckTasks,
      startedAtIso,
      endedAtIso,
    });

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
      } else if (outcome.sessionQueued) {
        set((s) => ({
          focusTasks: s.focusTasks.map((t) =>
            t.id === selectedTaskId
              ? {
                  ...t,
                  completed_pomodoros: (t.completed_pomodoros ?? 0) + 1,
                  total_focus_seconds: (t.total_focus_seconds ?? 0) + completedSeconds,
                }
              : t,
          ),
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
      phase: next,
      secondsLeft: customDurations[next],
      status: 'idle',
      sessionsCompleted: completed,
      sessionStartedAt: null,
      clock: null,
      pausedAt: null,
      intent: null,
      interruptions: EMPTY_TALLY,
      justCompleted: {
        taskTitle: doneTitle,
        seconds: completedSeconds,
        sessionNumber: completed,
        intent: intent ?? null,
        interruptions: interruptions.total,
      },
    });
    if (auto) get().start();
  } else {
    const hasTask = !!get().selectedTaskId;
    const auto = settings.autoStartPomodoros && (!settings.requireTaskBeforeStart || hasTask);
    set({
      phase: 'work',
      secondsLeft: customDurations.work,
      status: 'idle',
      sessionStartedAt: null,
      clock: null,
      pausedAt: null,
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
    leftAt = null;
    strictLeftAt = null;
    armedEnds.clear();
    if (typeof cancelFocusEnd === 'function') void cancelFocusEnd().catch(() => undefined);
  },
});
// the half-finished session goes on every account boundary; the settings stay under their user's key
registerAccountStorage({ name: 'focus.session', transient: true, keysFor: (uid) => [sessionKey(uid)] });
registerAccountStorage({ name: 'focus.settings', transient: false, keysFor: (uid) => [settingsKey(uid)] });
