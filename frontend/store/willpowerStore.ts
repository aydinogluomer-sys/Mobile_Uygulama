import { create } from 'zustand';
import { supabase, WillpowerState } from '../lib/supabase';
import { format } from 'date-fns';

type WillpowerStore = {
  state: WillpowerState | null;
  loading: boolean;
  fetchToday: () => Promise<void>;
  canActivate: (cost: number) => boolean;
  score: () => number;
  spend: (cost: number) => Promise<void>;
  refund: (cost: number) => Promise<void>;
};

export const useWillpowerStore = create<WillpowerStore>((set, get) => ({
  state: null,
  loading: false,

  fetchToday: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const today = format(new Date(), 'yyyy-MM-dd');
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

  canActivate: (cost) => {
    const s = get().state;
    if (!s) return false;
    return s.active_count < s.focus_capacity && s.used + cost <= s.daily_budget;
  },

  score: () => {
    const s = get().state;
    if (!s || s.daily_budget === 0) return 100;
    return Math.round(((s.daily_budget - s.used) / s.daily_budget) * 100);
  },

  spend: async (cost) => {
    const s = get().state;
    if (!s) return;
    const updates = { used: s.used + cost, active_count: s.active_count + 1 };
    await supabase
      .from('willpower_state')
      .update(updates)
      .eq('user_id', s.user_id)
      .eq('state_date', s.state_date);
    set({ state: { ...s, ...updates } });
  },

  refund: async (cost) => {
    const s = get().state;
    if (!s) return;
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
