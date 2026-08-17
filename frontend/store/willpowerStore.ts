import { create } from 'zustand';
import { AppState } from 'react-native';
import { supabase, WillpowerState } from '../lib/supabase';
import { todayLocal } from '../lib/date';

type WillpowerStore = {
  state: WillpowerState | null;
  loading: boolean;
  /** Does the cached row belong to a day that is no longer today? */
  isStale: () => boolean;
  fetchToday: () => Promise<void>;
  canActivate: (cost: number) => boolean;
  /** Percentage of today's budget still unspent, or `null` when unknown. */
  score: () => number | null;
  spend: (cost: number) => Promise<void>;
  refund: (cost: number) => Promise<void>;
};


/**
 * Day watcher (task 1C-007, finding N-07).
 *
 * `1C-003` guarded the store's METHODS. It did not guard the `state` FIELD, and
 * every consumer reads that field directly -- today.tsx:279, habits.tsx:191,
 * timeline.tsx:559, WillpowerBand.tsx:27, HabitOnboarding's prop. Nothing
 * re-triggered a fetch when the local day changed, because `fetchToday()` runs
 * on mount and pull-to-refresh only, so an app left open past local midnight
 * kept rendering yesterday's budget.
 *
 * Rather than asking six screens to remember to check, staleness is made
 * impossible to OBSERVE: the moment the local day moves on, the cached row is
 * dropped and refetched. Consumers already guard on `wp && (...)`, so they need
 * no edit.
 *
 * Two triggers, because neither alone is sufficient:
 *   - a timer, for an app sitting in the foreground across midnight;
 *   - AppState -> 'active', because a sleeping phone does not run timers
 *     reliably, and returning to the app is exactly when a stale row would be
 *     read.
 */
let dayWatchStarted = false;

function startDayWatch(check: () => void): void {
  if (dayWatchStarted) return;
  dayWatchStarted = true;
  AppState.addEventListener('change', (status) => {
    if (status === 'active') check();
  });
  const timer = setInterval(check, 60_000);
  // Never keep a bare timer alive on Node/test runners.
  (timer as unknown as { unref?: () => void }).unref?.();
}

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
    // Arm on first use, so a store nobody touches installs no listeners.
    startDayWatch(() => {
      const s = get().state;
      if (s && s.state_date !== todayLocal()) {
        set({ state: null });        // bayat satırı bir daha DIŞARI VERME
        void get().fetchToday();     // ve yerine bugünkünü getir
      }
    });

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

  // Returns `null` when there is no usable reading -- no state, or a row from
  // a day that is no longer today.
  //
  // An earlier version returned 100 here, reasoning that a fresh day starts
  // with a full budget. That was wrong twice over: it is a guess presented as
  // a measurement, and the user sees "100% willpower" they never had. 100 is a
  // real reading (a fresh day, or a zero budget); the ABSENCE of a reading is
  // not 100. Callers render a loading state instead -- plan/01:661.
  score: () => {
    if (get().isStale()) return null;
    const s = get().state;
    if (!s) return null;
    if (s.daily_budget === 0) return 100;
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
