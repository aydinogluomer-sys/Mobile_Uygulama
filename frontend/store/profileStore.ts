import { create } from 'zustand';
import { supabase, Profile, ProfileBadge, LeaderboardRow } from '../lib/supabase';
import {
  fetchBadges as repoFetchBadges,
  fetchOrCreateProfile,
  updateUsername,
} from '../repositories/profileRepository';

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
    set({ loading: true });
    const res = await fetchOrCreateProfile<Profile>();
    if (res.ok) set({ profile: res.data });
    set({ loading: false });
  },

  fetchBadges: async () => {
    const res = await repoFetchBadges<ProfileBadge>();
    if (res.ok) set({ badges: res.data });
  },

  setUsername: async (name) => {
    const res = await updateUsername<Profile>(name);
    if (res.ok) set({ profile: res.data });
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
