import { create } from 'zustand';
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

const SETTINGS_KEY = 'focus.settings.v1';

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

/** The configured length of one phase, in seconds. */
function phaseSeconds(s: FocusSettings, phase: Phase): number {
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

  // Timer actions
  start: () => void;
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

export const useFocusStore = create<FocusStore>((set, get) => ({
  phase: 'work',
  status: 'idle',
  secondsLeft: DURATIONS.work,
  sessionsCompleted: 0,
  sessionStartedAt: null,
  settings: { ...DEFAULT_SETTINGS },
  justCompleted: null,
  focusTasks: [],
  selectedTaskId: null,
  loadingTasks: false,

  clearJustCompleted: () => set({ justCompleted: null }),

  updateSettings: (patch) => {
    const next = { ...get().settings, ...patch };
    set({ settings: next });
    // Kalıcı kaydet (yangın-ve-unut)
    AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(next)).catch(() => {});
    // Süreyi güncelle (mevcut seans yoksa)
    if (get().status === 'idle') {
      const d: Record<Phase, number> = {
        work: next.workMinutes * 60,
        shortBreak: next.shortBreakMinutes * 60,
        longBreak: next.longBreakMinutes * 60,
      };
      set({ secondsLeft: d[get().phase] });
    }
  },

  loadSettings: async () => {
    try {
      const raw = await AsyncStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      const next = { ...DEFAULT_SETTINGS, ...saved } as FocusSettings;
      set({ settings: next });
      if (get().status === 'idle') {
        const d: Record<Phase, number> = {
          work: next.workMinutes * 60,
          shortBreak: next.shortBreakMinutes * 60,
          longBreak: next.longBreakMinutes * 60,
        };
        set({ secondsLeft: d[get().phase] });
      }
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
    set({ status: 'running', sessionStartedAt: new Date().toISOString() });
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
  pause: () => set({ status: 'paused' }),

  reset: () => {
    const phase = get().phase;
    set({ status: 'idle', secondsLeft: DURATIONS[phase], sessionStartedAt: null });
  },

  tick: () => {
    const { secondsLeft } = get();
    if (secondsLeft > 0) {
      set({ secondsLeft: secondsLeft - 1 });
    } else {
      get().nextPhase();
    }
  },

  nextPhase: async () => {
    const { phase, sessionsCompleted, sessionStartedAt, selectedTaskId, focusTasks, settings } = get();
    const customDurations: Record<Phase, number> = {
      work: settings.workMinutes * 60,
      shortBreak: settings.shortBreakMinutes * 60,
      longBreak: settings.longBreakMinutes * 60,
    };
    const plannedSeconds = customDurations[phase];
    const completedSeconds = sessionStartedAt
      ? Math.min(plannedSeconds, Math.floor((Date.now() - new Date(sessionStartedAt).getTime()) / 1000))
      : plannedSeconds;

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
      });
      if (auto) get().start();
    }
  },

  setPhase: (phase) => {
    const s = get().settings;
    const d: Record<Phase, number> = {
      work: s.workMinutes * 60,
      shortBreak: s.shortBreakMinutes * 60,
      longBreak: s.longBreakMinutes * 60,
    };
    set({ phase, secondsLeft: d[phase], status: 'idle', sessionStartedAt: null });
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
