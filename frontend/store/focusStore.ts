import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { haptic } from '../lib/haptics';

type Phase = 'work' | 'shortBreak' | 'longBreak';
type Status = 'idle' | 'running' | 'paused';

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

  start: () => set({ status: 'running', sessionStartedAt: new Date().toISOString() }),
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

    // Oturum kaydet
    const { data: { user } } = await supabase.auth.getUser();
    if (user && phase === 'work') {
      const selectedTask = focusTasks.find((t) => t.id === selectedTaskId);
      await supabase.from('focus_sessions').insert({
        user_id: user.id,
        task_id: selectedTaskId,
        task_title: selectedTask?.title ?? null,
        mode: phase,
        started_at: sessionStartedAt ?? new Date().toISOString(),
        ended_at: new Date().toISOString(),
        planned_seconds: plannedSeconds,
        completed_seconds: completedSeconds,
        completed: true,
      });

      // Görev sayacını güncelle
      if (selectedTaskId) {
        const newDone = (selectedTask?.completed_pomodoros ?? 0) + 1;
        await supabase
          .from('focus_tasks')
          .update({
            completed_pomodoros: newDone,
            total_focus_seconds: (selectedTask?.total_focus_seconds ?? 0) + completedSeconds,
          })
          .eq('id', selectedTaskId);
        // Tahmini pomodoroya ulaşınca otomatik tamamla
        if (settings.autoCheckTasks && newDone >= (selectedTask?.estimated_pomodoros ?? 1)) {
          await get().completeFocusTask(selectedTaskId);
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
        status: auto ? 'running' : 'idle',
        sessionsCompleted: completed,
        sessionStartedAt: auto ? new Date().toISOString() : null,
        justCompleted: { taskTitle: doneTitle, seconds: completedSeconds, sessionNumber: completed },
      });
    } else {
      const hasTask = !!get().selectedTaskId;
      const auto = settings.autoStartPomodoros && (!settings.requireTaskBeforeStart || hasTask);
      set({
        phase: 'work', secondsLeft: customDurations.work,
        status: auto ? 'running' : 'idle',
        sessionStartedAt: auto ? new Date().toISOString() : null,
      });
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      set({ loadingTasks: false });
      return;
    }
    const { data } = await supabase
      .from('focus_tasks')
      .select('*')
      .eq('completed', false)
      .order('created_at', { ascending: true });
    if (data) set({ focusTasks: data as FocusTask[] });
    set({ loadingTasks: false });
  },

  addFocusTask: async (title, estimatedPomodoros = 1) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !title.trim()) return;
    const { data } = await supabase
      .from('focus_tasks')
      .insert({ user_id: user.id, title: title.trim(), estimated_pomodoros: estimatedPomodoros })
      .select()
      .single();
    if (data) set((s) => ({ focusTasks: [...s.focusTasks, data as FocusTask] }));
  },

  removeFocusTask: async (id) => {
    await supabase.from('focus_tasks').delete().eq('id', id);
    set((s) => ({
      focusTasks: s.focusTasks.filter((t) => t.id !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
    }));
  },

  completeFocusTask: async (id) => {
    await supabase.from('focus_tasks').update({ completed: true }).eq('id', id);
    set((s) => ({
      focusTasks: s.focusTasks.filter((t) => t.id !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
    }));
  },

  selectTask: (id) => set({ selectedTaskId: id }),
}));
