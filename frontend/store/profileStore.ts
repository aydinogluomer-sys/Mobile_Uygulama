import { registerAccountScoped } from '../lib/accountScope';
import { createLatest } from '../lib/latestOnly';
import { create } from 'zustand';
import type { Profile, ProfileBadge, LeaderboardRow } from '../lib/supabase';
import {
  fetchBadges as repoFetchBadges,
  fetchOrCreateProfile,
  updateUsername,
  fetchLeaderboard as repoFetchLeaderboard,
  fetchMyRank as repoFetchMyRank,
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

const lbLatest = createLatest();

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
    const run = lbLatest.begin();
    set({ lbLoading: true, scope: s });
    try {
      const res = await repoFetchLeaderboard<LeaderboardRow>(s);
      if (!run.isCurrent()) return;
      // A failed read used to render as an empty board -- indistinguishable
      // from "nobody has any XP yet". The previous list is kept instead.
      if (res.ok) set({ leaderboard: res.data });
    } finally {
      run.done();
      if (lbLatest.pending() === 0) set({ lbLoading: false });
    }
  },

  fetchMyRank: async () => {
    const res = await repoFetchMyRank();
    if (res.ok) set({ myRank: res.data });
  },
}));

// F04: this store belongs to the signed-in account; every account boundary resets it (lib/accountScope.ts).
registerAccountScoped({ name: 'profile', store: useProfileStore });
