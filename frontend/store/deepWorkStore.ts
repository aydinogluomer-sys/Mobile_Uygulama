import { registerAccountScoped } from '../lib/accountScope';
import { createLatest } from '../lib/latestOnly';
import { create } from 'zustand';
import {
  deleteDeepWorkSession,
  fetchDeepWorkSince,
  insertDeepWorkSession,
  type DeepWorkRow,
} from '../repositories/deepWorkRepository';
import { todayLocal, weekStartYmd } from '../lib/date';

export type DeepWorkSession = DeepWorkRow;

/**
 * Deep work sessions.
 *
 * Direct calls moved to `repositories/deepWorkRepository`. The list is
 * windowed by date rather than paginated on purpose: both consumers
 * (`todayMinutes`, `weekMinutes`) are sums over a period, and a partial page
 * would produce a partial total that still reads as a total.
 *
 * `removeSession` previously deleted by `id` alone and dropped the row from
 * local state whether or not the delete succeeded.
 */
type DeepWorkStore = {
  sessions: DeepWorkSession[];
  loading: boolean;
  error: string | null;
  loadSessions: (days?: number) => Promise<void>;
  addSession: (subject: string, minutes: number, date?: string) => Promise<boolean>;
  removeSession: (id: string) => Promise<boolean>;
  todayMinutes: () => number;
  weekMinutes: () => number;
};

const loadLatest = createLatest();

export const useDeepWorkStore = create<DeepWorkStore>((set, get) => ({
  sessions: [],
  loading: false,
  error: null,

  loadSessions: async (days = 30) => {
    const run = loadLatest.begin();
    set({ loading: true, error: null });
    try {
      const res = await fetchDeepWorkSince(days);
      if (!run.isCurrent()) return;
      if (!res.ok) { set({ loading: false, error: res.error }); return; }
      set({ sessions: res.data, loading: false });
    } finally {
      run.done();
      if (loadLatest.pending() === 0 && get().loading) set({ loading: false });
    }
  },

  addSession: async (subject, minutes, date) => {
    const res = await insertDeepWorkSession({ subject, minutes, date: date ?? todayLocal() });
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({ sessions: [res.data, ...s.sessions], error: null }));
    return true;
  },

  removeSession: async (id) => {
    const res = await deleteDeepWorkSession(id);
    if (!res.ok) { set({ error: res.error }); return false; }
    set((s) => ({ sessions: s.sessions.filter((x) => x.id !== id), error: null }));
    return true;
  },

  todayMinutes: () => {
    const today = todayLocal();
    return get().sessions
      .filter((s) => s.date === today)
      .reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  },

  weekMinutes: () => {
    const start = weekStartYmd();
    return get().sessions
      .filter((s) => s.date >= start)
      .reduce((sum, s) => sum + (s.duration_minutes || 0), 0);
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'deepWork', store: useDeepWorkStore });
