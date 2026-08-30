/**
 * Capacity-ceiling wiring tests for `willpowerStore.canActivate`.  (task 1-D, W2/W4)
 *
 * AC-C01  a stale reading still refuses activation even when a capacity
 *         input is supplied -- staleness gating must not become
 *         bypassable by the new optional parameter.
 * AC-C02  Plan §10's explicit requirement -- "5 kolay alışkanlığı rahat
 *         taşıyabilirken üç ağır alışkanlık çok fazla olabilir" -- proven
 *         at store level: more easy habits are allowed to accumulate than
 *         heavy ones before `canActivate` starts refusing.
 *
 * Numbers below come straight from `lib/capacity.ts`'s own formulas
 * (difficulty/frequency/duration weights, `HABIT_POINTS_SCALE=18`,
 * `CAPACITY_CEILING_DEFAULT=85`) -- not re-derived here, just exercised
 * through the store's new `canActivate(cost, capacityInput)` seam.
 *
 * NOT covered here: this file does not touch `willpowerRollover.test.ts` or
 * `willpowerDayWatch.test.ts` (existing files, left untouched per the
 * append-only rule) -- it only adds coverage for the new capacity seam.
 */
type Row = {
  user_id: string; state_date: string; daily_budget: number;
  used: number; focus_capacity: number; active_count: number;
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      // The data layer resolves the user id from the LOCAL session -- see
      // `repositories/shared.currentUserId`. Derived from this mock's own
      // getUser so the two can never disagree.
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
       getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => {
        const q = {
          eq() { return q; },
          async single() { return { data: null, error: { code: 'PGRST116', message: 'no rows' } }; },
        };
        return q;
      },
    }),
  },
}));

import { useWillpowerStore } from '../../store/willpowerStore';
import type { HabitLoadInput } from '../../lib/capacity';

const YESTERDAY = '2026-08-03';
const TODAY = '2026-08-04';

/** 2026-08-04 10:00 local -- comfortably "today", no midnight edge involved. */
const DURING_TODAY = new Date(2026, 7, 4, 10, 0, 0);

function row(over: Partial<Row> = {}): Row {
  return {
    user_id: 'u1', state_date: TODAY, daily_budget: 100,
    used: 0, focus_capacity: 3, active_count: 0, ...over,
  };
}

const EASY: HabitLoadInput = { difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' }, impact_level: null };
const HEAVY: HabitLoadInput = { difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' }, impact_level: null };

beforeEach(() => {
  useWillpowerStore.setState({ state: null, loading: false });
  jest.useFakeTimers();
  jest.setSystemTime(DURING_TODAY);
});
afterEach(() => { jest.useRealTimers(); });

describe('AC-C01 -- staleness still gates the capacity-ceiling path', () => {
  it('refuses activation on a stale reading even with a capacity input supplied', () => {
    useWillpowerStore.setState({ state: row({ state_date: YESTERDAY }) as never });
    expect(useWillpowerStore.getState().canActivate(0, { habit: EASY, activeHabits: [] })).toBe(false);
  });
});

describe('AC-C02 -- capacity ceiling allows more easy habits than heavy ones (Plan §10)', () => {
  it('still allows a 5th easy habit to activate', () => {
    useWillpowerStore.setState({ state: row() as never });
    const fourActiveEasy = [EASY, EASY, EASY, EASY];
    expect(useWillpowerStore.getState().canActivate(0, { habit: EASY, activeHabits: fourActiveEasy })).toBe(true);
  });

  it('refuses a 5th heavy habit at the equivalent point', () => {
    useWillpowerStore.setState({ state: row() as never });
    const fourActiveHeavy = [HEAVY, HEAVY, HEAVY, HEAVY];
    expect(useWillpowerStore.getState().canActivate(0, { habit: HEAVY, activeHabits: fourActiveHeavy })).toBe(false);
  });

  it('allows every one of 5 easy habits activating in sequence', () => {
    useWillpowerStore.setState({ state: row() as never });
    let active: HabitLoadInput[] = [];
    for (let i = 0; i < 5; i++) {
      expect(useWillpowerStore.getState().canActivate(0, { habit: EASY, activeHabits: active })).toBe(true);
      active = [...active, EASY];
    }
  });

  it('replaces the fixed 3-slot rule: a 4th easy habit is allowed even though focus_capacity (3) is already exhausted', () => {
    // active_count already at the legacy focus_capacity ceiling -- the OLD
    // fixed-slot rule (`active_count < focus_capacity`) would refuse ANY
    // further activation here, regardless of weight.
    useWillpowerStore.setState({ state: row({ focus_capacity: 3, active_count: 3 }) as never });
    const threeActiveEasy = [EASY, EASY, EASY];
    expect(useWillpowerStore.getState().canActivate(0, { habit: EASY, activeHabits: threeActiveEasy })).toBe(true);
  });

  it('falls back to the legacy fixed-slot rule when no capacity input is supplied (behaviour-preserving default)', () => {
    useWillpowerStore.setState({ state: row({ focus_capacity: 3, active_count: 3 }) as never });
    expect(useWillpowerStore.getState().canActivate(0)).toBe(false); // 3 < 3 is false, exactly as before this change
  });
});
