import { create } from 'zustand';
import { supabase, Profile, ProfileBadge, LeaderboardRow } from '../lib/supabase';

export type LeaderboardScope = 'global' | 'weekly';

type ProfileStore = {
  profile: Profile | null;
  badges: ProfileBadge[];
  myRank: number | null;
  leaderboard: LeaderboardRow[];
  scope: LeaderboardScope;
  loading: boolean;
  lbLoading: boolean;

  fetchProfile: () => Promise<void>;
  fetchBadges: () => Promise<void>;
  setUsername: (name: string) => Promise<void>;
  fetchLeaderboard: (scope?: LeaderboardScope) => Promise<void>;
  fetchMyRank: () => Promise<void>;
};

export const useProfileStore = create<ProfileStore>((set, get) => ({
  profile: null,
  badges: [],
  myRank: null,
  leaderboard: [],
  scope: 'global',
  loading: false,
  lbLoading: false,

  fetchProfile: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    set({ loading: true });

    let { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    // Profil yoksa (eski kullanıcı / trigger öncesi) oluştur
    if (!data) {
      const { data: inserted } = await supabase
        .from('profiles')
        .insert({ id: user.id, email: user.email })
        .select('*')
        .single();
      data = inserted;
    }

    if (data) set({ profile: data as Profile });
    set({ loading: false });
  },

  fetchBadges: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase
      .from('profile_badges')
      .select('*')
      .eq('user_id', user.id)
      .order('earned_at', { ascending: false });
    if (data) set({ badges: data as ProfileBadge[] });
  },

  setUsername: async (name) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const trimmed = name.trim().slice(0, 24);
    const { data } = await supabase
      .from('profiles')
      .update({ username: trimmed || null })
      .eq('id', user.id)
      .select('*')
      .single();
    if (data) set({ profile: data as Profile });
  },

  fetchLeaderboard: async (scope) => {
    const s = scope ?? get().scope;
    set({ lbLoading: true, scope: s });
    const fn = s === 'weekly' ? 'get_weekly_leaderboard' : 'get_global_leaderboard';
    const { data } = await supabase.rpc(fn, { limit_val: 50 });
    set({ leaderboard: (data as LeaderboardRow[]) ?? [], lbLoading: false });
  },

  fetchMyRank: async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.rpc('get_user_rank', { target_user_id: user.id });
    const row = Array.isArray(data) ? data[0] : null;
    set({ myRank: row?.rank ?? null });
  },
}));
