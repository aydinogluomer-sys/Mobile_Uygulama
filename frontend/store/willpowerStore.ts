import { create } from 'zustand';
import { AppState } from 'react-native';
import { supabase, WillpowerState } from '../lib/supabase';
import { todayLocal } from '../lib/date';
import { canActivate as capacityCanActivate, dailyLoad, type HabitLoadInput } from '../lib/capacity';
import {
  fetchOrCreateWillpowerState,
  updateWillpowerState,
} from '../repositories/willpowerRepository';

/**
 * W2 (task 1-D, Phase 1 wiring) seam: `canActivate`'s legacy fixed-slot rule
 * (`active_count < focus_capacity`) is replaced by `capacity.canActivate`'s
 * load-ceiling rule (Plan §10) WHEN the caller supplies the incoming habit's
 * load inputs. `willpowerStore` itself holds no habit data (no habit list,
 * no per-habit difficulty/duration/frequency) and must not fetch it here --
 * that would add I/O to a synchronous decision path. So this is accepted as
 * an OPTIONAL third-ish parameter with a safe default: omit it (as every
 * call site does today) and `canActivate` behaves EXACTLY as before.
 */
export type CanActivateCapacityInput = {
  /** The habit being activated -- required to use the capacity-ceiling rule. */
  habit: HabitLoadInput;
  /** Habits already active today, used to compute today's current load via
   *  `dailyLoad`. Defaults to `[]` (i.e. "no other load known"), which is
   *  the safest assumption available without the store fetching anything. */
  activeHabits?: HabitLoadInput[];
  /** Overrides `capacity.CAPACITY_CEILING_DEFAULT` (85) -- exposed for tests. */
  ceiling?: number;
};

type WillpowerStore = {
  state: WillpowerState | null;
  loading: boolean;
  /** Does the cached row belong to a day that is no longer today? */
  isStale: () => boolean;
  fetchToday: () => Promise<void>;
  canActivate: (cost: number, capacityInput?: CanActivateCapacityInput) => boolean;
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

    const today = todayLocal();
    set({ loading: true });
    const res = await fetchOrCreateWillpowerState(today);
    if (res.ok) set({ state: res.data as WillpowerState });
    set({ loading: false });
  },

  // Gates a write, so it fails CLOSED: without today's real row we cannot know
  // the budget, and authorising from yesterday's numbers is how a user who
  // spent everything yesterday gets locked out of a fresh day.
  //
  // W2 (task 1-D): the fixed "max N active habits" slot rule is replaced by
  // `capacity.canActivate`'s load-ceiling rule (Plan §10 -- "5 kolay
  // alışkanlığı rahat taşıyabilirken üç ağır alışkanlık çok fazla olabilir")
  // WHEN a caller supplies `capacityInput.habit`. The irade BUDGET check
  // (`used + cost <= daily_budget`) is a separate concern from the slot rule
  // and is unconditional -- it still applies either way. When no capacity
  // input is supplied, the legacy fixed-slot check runs exactly as before,
  // so this change is behaviour-preserving for every existing call site.
  canActivate: (cost, capacityInput) => {
    if (get().isStale()) return false;
    const s = get().state;
    if (!s) return false;
    if (s.used + cost > s.daily_budget) return false;

    if (!capacityInput) {
      // Legacy fixed-slot rule -- unchanged default when no habit-load data
      // is supplied (see `CanActivateCapacityInput`'s doc above).
      return s.active_count < s.focus_capacity;
    }
    const currentLoad = dailyLoad({ habits: capacityInput.activeHabits ?? [] }).normalised;
    return capacityCanActivate({ currentLoad, habit: capacityInput.habit, ceiling: capacityInput.ceiling });
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
    const res = await updateWillpowerState(s.state_date, updates);
    // Local state follows the server: showing willpower as spent when the
    // write was rejected would let the user over-commit against a budget the
    // database never debited.
    if (!res.ok) return;
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
    const res = await updateWillpowerState(s.state_date, updates);
    if (!res.ok) return;
    set({ state: { ...s, ...updates } });
  },
}));
