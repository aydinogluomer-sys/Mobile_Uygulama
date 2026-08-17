import { create } from 'zustand';
import { supabase, WillpowerState } from '../lib/supabase';
import { todayLocal } from '../lib/date';

type WillpowerStore = {
  state: WillpowerState | null;
  loading: boolean;
  /** Does the cached row belong to a day that is no longer today? */
  isStale: () => boolean;
  fetchToday: () => Promise<void>;
  canActivate: (cost: number) => boolean;
  score: () => number;
  spend: (cost: number) => Promise<void>;
  refund: (cost: number) => Promise<void>;
};

export const useWillpowerStore = create<WillpowerStore>((set, get) => ({
  state: null,
  loading: false,

  /**
   * The store caches exactly one willpower_state row and nothing invalidated
   * it. Leave the app open past local midnight and every read below is
   * yesterday's.
   *
   * An empty cache counts as stale: "we do not have today's budget" is the
   * same situation whether we never fetched it or fetched it a day ago.
   */
  isStale: () => {
    const s = get().state;
    return !s || s.state_date !== todayLocal();
  },

  fetchToday: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const today = todayLocal();
    set({ loading: true });

    const { data } = await supabase
      .from('willpower_state')
      .select('*')
      .eq('user_id', user.id)
      .eq('state_date', today)
      .single();

    if (data) {
      set({ state: data as WillpowerState });
    } else {
      const newState = {
        user_id: user.id,
        state_date: today,
        daily_budget: 15,
        used: 0,
        focus_capacity: 3,
        active_count: 0,
      };
      const { data: inserted } = await supabase
        .from('willpower_state')
        .upsert(newState)
        .select()
        .single();
      if (inserted) set({ state: inserted as WillpowerState });
    }
    set({ loading: false });
  },

  // Gates a write, so it fails CLOSED: without today's real row we cannot know
  // the budget, and authorising from yesterday's numbers is how a user who
  // spent everything yesterday gets locked out of a fresh day.
  canActivate: (cost) => {
    if (get().isStale()) return false;
    const s = get().state;
    if (!s) return false;
    return s.active_count < s.focus_capacity && s.used + cost <= s.daily_budget;
  },

  // Only displays a number, so it fails OPEN. This looks inconsistent with
  // canActivate above and is deliberate: a new local day starts with the
  // budget untouched, so "full" is what the database is about to say. Showing
  // yesterday's depleted score instead would be actively wrong.
  score: () => {
    if (get().isStale()) return 100;
    const s = get().state;
    if (!s || s.daily_budget === 0) return 100;
    return Math.round(((s.daily_budget - s.used) / s.daily_budget) * 100);
  },

  spend: async (cost) => {
    // Roll over FIRST. The UPDATE below filters on the cached state_date, so
    // spending after midnight without this writes to yesterday's row: today's
    // budget never records the spend and yesterday's history is rewritten.
    if (get().isStale()) await get().fetchToday();

    const s = get().state;
    // Rollover failed (no session, request failed). Write nothing rather than
    // charge the wrong day.
    if (!s || s.state_date !== todayLocal()) return;

    const updates = { used: s.used + cost, active_count: s.active_count + 1 };
    await supabase
      .from('willpower_state')
      .update(updates)
      .eq('user_id', s.user_id)
      .eq('state_date', s.state_date);
    set({ state: { ...s, ...updates } });
  },

  refund: async (cost) => {
    if (get().isStale()) await get().fetchToday();

    const s = get().state;
    if (!s || s.state_date !== todayLocal()) return;

    const updates = {
      used: Math.max(0, s.used - cost),
      active_count: Math.max(0, s.active_count - 1),
    };
    await supabase
      .from('willpower_state')
      .update(updates)
      .eq('user_id', s.user_id)
      .eq('state_date', s.state_date);
    set({ state: { ...s, ...updates } });
  },
}));
