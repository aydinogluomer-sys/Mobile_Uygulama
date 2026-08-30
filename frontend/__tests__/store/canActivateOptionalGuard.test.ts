/**
 * Regression fence (task Phase-1 CODER-F, W4): `willpowerStore.canActivate`'s
 * capacity parameter must stay OPTIONAL. This is a PROTECTIVE guard, not a
 * fix-proving test -- the parameter is already optional (built by an earlier
 * phase; see `store/willpowerStore.ts`'s `CanActivateCapacityInput` doc) and
 * this file's job is to make sure it STAYS that way. Every one of this
 * task's new W1 call sites falls back to a single-argument call whenever
 * habit data isn't ready yet (see the "loading" guard in
 * habits.tsx/timeline.tsx/HabitOnboarding.tsx/habitStore.ts) -- if a future
 * change ever made the second parameter required, every one of those
 * fallback calls would break.
 *
 * Two halves:
 *  - a compile-time guard: a function type requiring only `(cost: number)`
 *    stops being assignable FROM `canActivate`'s real type the moment its
 *    second parameter becomes required -- `npx tsc --noEmit` (part of the
 *    Definition of Done) catches that even though jest's babel transform
 *    performs no type checking on its own.
 *  - a runtime check that a real single-argument call still works today.
 */
import { useWillpowerStore } from '../../store/willpowerStore';

type CanActivateFn = ReturnType<typeof useWillpowerStore.getState>['canActivate'];

// Compile-time guard -- see file doc above. This assignment only type-checks
// while `capacityInput` remains OPTIONAL on `canActivate`'s real signature.
// If a future edit makes it required, `npx tsc --noEmit` fails here with
// "Type '(cost: number) => boolean' is not assignable to type 'CanActivateFn'".
const _typeGuardCanActivateSingleArgStillAssignable: (cost: number) => boolean =
  null as unknown as CanActivateFn;
void _typeGuardCanActivateSingleArgStillAssignable;

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
  },
}));

describe("canActivate's capacity parameter stays optional", () => {
  it('is still callable with a single argument at runtime, no error', () => {
    useWillpowerStore.setState({
      state: {
        user_id: 'u1', state_date: '2026-01-01', daily_budget: 10, used: 0,
        focus_capacity: 3, active_count: 0,
      } as never,
      loading: false,
    });
    // state_date deliberately does not match "today" (isStale) -- the point
    // here is only that calling with ONE argument compiles and runs without
    // throwing, proving the second parameter is optional, not what it returns.
    expect(() => useWillpowerStore.getState().canActivate(1)).not.toThrow();
    expect(typeof useWillpowerStore.getState().canActivate(1)).toBe('boolean');
  });
});
