import {
  CAPACITY_CEILING_DEFAULT,
  MIN_DURATION_MINUTES,
  bandFor,
  canActivate,
  capacityAdvice,
  dailyLoad,
  habitLoad,
  habitLoadPoints,
  type HabitLoadInput,
} from '../../lib/capacity';

function makeHabit(overrides: Partial<HabitLoadInput> = {}): HabitLoadInput {
  return {
    difficulty: 5,
    estimated_minutes: 0,
    frequency_config: { kind: 'daily' },
    impact_level: null,
    ...overrides,
  };
}

describe('capacityRobustness — duration floor & numeric band safety (INT-04, INT-18)', () => {
  const gym = makeHabit({ difficulty: 5, estimated_minutes: 90 });

  it('enforces MIN_DURATION_MINUTES = 1 so zero-minute habits contribute positive, bounded load', () => {
    expect(MIN_DURATION_MINUTES).toBe(1);
    const zeroMin = habitLoad(makeHabit({ difficulty: 5, estimated_minutes: 0 }));
    const oneMin = habitLoad(makeHabit({ difficulty: 5, estimated_minutes: 1 }));
    const ninetyMin = habitLoad(gym);

    expect(zeroMin).toBeGreaterThan(0);
    expect(zeroMin).toBeCloseTo(oneMin, 10);
    expect(zeroMin).toBeLessThan(ninetyMin);

    const mins = [1, 5, 15, 30, 60, 90, 180];
    const loads = mins.map((m) => habitLoad(makeHabit({ estimated_minutes: m })));
    for (let i = 1; i < loads.length; i += 1) {
      expect(loads[i]).toBeGreaterThan(loads[i - 1]);
    }
  });

  it('rounds fractional scores and handles NaN/out-of-range inputs safely in bandFor', () => {
    expect(bandFor(40.5)).toBe('dengeli');
    expect(bandFor(40.4)).toBe('dusuk');
    expect(bandFor(70.5)).toBe('yuksek');
    expect(bandFor(85.5)).toBe('asiri');
    expect(bandFor(Number.NaN)).toBe('dusuk');
    expect(bandFor(Number.POSITIVE_INFINITY)).toBe('dusuk');
    expect(bandFor(-5)).toBe('dusuk');
    expect(bandFor(250)).toBe('asiri');
  });

  it('preserves gym = 18 pts, 74 + 18 = 92 advice, NaN duration safety, and refuses unbounded zero-duration stacking', () => {
    expect(habitLoadPoints(gym)).toBeCloseTo(18, 10);
    expect(capacityAdvice({ currentLoad: 74, incomingHabit: gym }).projected).toBe(92);

    const nanHabit = makeHabit({ estimated_minutes: Number.NaN });
    expect(Number.isFinite(habitLoadPoints(nanHabit))).toBe(true);
    expect(habitLoadPoints(nanHabit)).toBeGreaterThan(0);

    // 12 zero-duration hard daily habits carry real load (>30 pts vs 0 before) and hit the 85 ceiling on a 55-pt day
    const twelveZeroMin = Array.from({ length: 12 }, () => makeHabit({ difficulty: 5, estimated_minutes: 0 }));
    const twelveLoad = dailyLoad({ habits: twelveZeroMin }).raw;
    expect(twelveLoad).toBeGreaterThan(30);
    expect(
      canActivate({
        currentLoad: 55 + twelveLoad,
        habit: makeHabit({ difficulty: 5, estimated_minutes: 0 }),
        ceiling: CAPACITY_CEILING_DEFAULT,
      }),
    ).toBe(false);

    // Even from 0 baseline, stacking zero-duration hard habits hits the 85 ceiling (at 31st habit) instead of stacking forever
    const thirtyZeroMin = Array.from({ length: 30 }, () => makeHabit({ difficulty: 5, estimated_minutes: 0 }));
    const fromZeroLoad = dailyLoad({ habits: thirtyZeroMin }).raw;
    expect(
      canActivate({
        currentLoad: fromZeroLoad,
        habit: makeHabit({ difficulty: 5, estimated_minutes: 0 }),
        ceiling: CAPACITY_CEILING_DEFAULT,
      }),
    ).toBe(false);
  });
});
