/**
 * Capacity Engine V1 tests (Plan §10).  (Phase 1, CODER-B, task W4)
 *
 * Pure domain tests -- no I/O, no Supabase, no store. Fixtures build the
 * minimal `HabitLoadInput`/`HabitLog` shape each function actually reads.
 */
import {
  habitLoad,
  habitLoadPoints,
  dailyLoad,
  LOAD_BANDS,
  bandFor,
  capacityAdvice,
  canActivate,
  masteryStatus,
  MASTERY_MIN_AGE_DAYS,
  type HabitLoadInput,
} from '../../lib/capacity';
import type { Habit, HabitLog } from '../../lib/supabase';

function habitInput(overrides: Partial<HabitLoadInput> = {}): HabitLoadInput {
  return {
    difficulty: 1,
    estimated_minutes: 15,
    frequency_config: { kind: 'daily' },
    impact_level: null,
    ...overrides,
  };
}

function log(habitId: string, completedAt: string, state: HabitLog['state'] = 'done'): HabitLog {
  return {
    id: `${habitId}-${completedAt}`,
    habit_id: habitId,
    user_id: 'u1',
    completed_at: completedAt,
    value: null,
    is_completed: state === 'done',
    state,
    xp: null,
    created_at: `${completedAt}T08:00:00.000Z`,
  };
}

// ---------------------------------------------------------------------------
// habitLoad -- ordering (plan-verbatim)
// ---------------------------------------------------------------------------

describe('habitLoad -- plan worked example: vitamin < meditasyon < gym', () => {
  const vitamin = habitInput({ difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' } });
  const meditasyon = habitInput({ difficulty: 3, estimated_minutes: 20, frequency_config: { kind: 'daily' } });
  const gym = habitInput({ difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' } });

  it('ranks 5 dk vitamin (düşük) < 20 dk meditasyon (orta) < 90 dk gym (yüksek)', () => {
    const v = habitLoad(vitamin);
    const m = habitLoad(meditasyon);
    const g = habitLoad(gym);
    expect(v).toBeLessThan(m);
    expect(m).toBeLessThan(g);
  });

  it('the 90-minute daily, difficulty-5 habit saturates duration at exactly 1.0', () => {
    // difficulty_weight(5) = 1.0, frequency_weight(daily) = 1.0,
    // duration_weight(90) = ln(91)/ln(91) = 1.0 by construction -- so this
    // specific habit's load is exactly 1.0, and its points are exactly
    // HABIT_POINTS_SCALE (18). Pinned here so a future change to the curve
    // is forced to re-examine the "74 + 18 -> 92" test below too.
    expect(habitLoad(gym)).toBeCloseTo(1.0, 10);
    expect(habitLoadPoints(gym)).toBeCloseTo(18, 10);
  });

  it('duration does not scale linearly -- doubling past the reference barely moves the weight', () => {
    const at90 = habitLoad(habitInput({ difficulty: 5, estimated_minutes: 90 }));
    const at180 = habitLoad(habitInput({ difficulty: 5, estimated_minutes: 180 }));
    // Linear would have doubled it (2.0). The saturating curve keeps it well short.
    expect(at180).toBeLessThan(at90 * 1.3);
    expect(at180).toBeGreaterThan(at90); // still monotonically increasing
  });
});

// ---------------------------------------------------------------------------
// LOAD_BANDS / bandFor -- exact boundaries (plan-verbatim)
// ---------------------------------------------------------------------------

describe('bandFor -- exact band boundaries: 0-40 / 41-70 / 71-85 / 86-100', () => {
  it.each([
    [0, 'dusuk'],
    [40, 'dusuk'],
    [41, 'dengeli'],
    [70, 'dengeli'],
    [71, 'yuksek'],
    [85, 'yuksek'],
    [86, 'asiri'],
    [100, 'asiri'],
  ] as const)('bandFor(%i) === %s', (n, expected) => {
    expect(bandFor(n)).toBe(expected);
  });

  it('LOAD_BANDS covers 0-100 with no gaps and no overlaps', () => {
    const sorted = [...LOAD_BANDS].sort((a, b) => a.min - b.min);
    expect(sorted[0].min).toBe(0);
    expect(sorted[sorted.length - 1].max).toBe(100);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].min).toBe(sorted[i - 1].max + 1);
    }
  });
});

// ---------------------------------------------------------------------------
// capacityAdvice -- the "74 + 18 -> 92" worked example (plan-verbatim)
// ---------------------------------------------------------------------------

describe('capacityAdvice -- plan worked example: current 74 + this habit 18 -> projected 92', () => {
  // difficulty 5, 90 min, daily -- habitLoad exactly 1.0, points exactly 18 (see above).
  const heavyIncoming = habitInput({ difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' } });

  it('projects 74 + 18 = 92, an "aşırı" band', () => {
    const advice = capacityAdvice({ currentLoad: 74, incomingHabit: heavyIncoming });
    expect(advice.incomingPoints).toBeCloseTo(18, 10);
    expect(advice.projected).toBe(92);
  });

  it('produces the exact verdict and CTAs the plan specifies', () => {
    const advice = capacityAdvice({ currentLoad: 74, incomingHabit: heavyIncoming });
    expect(advice.verdict).toBe('unsustainable');
    expect(advice.message).toBe('Bu rutini şimdi başlatmak sürdürülebilir olmayabilir.');
    expect(advice.ctas).toEqual(['Kuyruğa al', 'Düşük yoğunlukla başla', 'Yine de etkinleştir']);
  });

  it('does not fire the unsustainable verdict for a light day', () => {
    const advice = capacityAdvice({ currentLoad: 10, incomingHabit: habitInput({ difficulty: 1, estimated_minutes: 5 }) });
    expect(advice.verdict).toBe('safe');
    expect(advice.message).not.toBe('Bu rutini şimdi başlatmak sürdürülebilir olmayabilir.');
  });
});

// ---------------------------------------------------------------------------
// canActivate -- max-capacity rule replaces the fixed 3-slot rule
// ---------------------------------------------------------------------------

describe('canActivate -- 5 easy habits can be allowed while 3 heavy ones are too many', () => {
  const easy = habitInput({ difficulty: 1, estimated_minutes: 5, frequency_config: { kind: 'daily' } });
  const heavy = habitInput({ difficulty: 5, estimated_minutes: 90, frequency_config: { kind: 'daily' } });
  const BASELINE = 32; // representative "already committed" load, same for both scenarios

  it('allows all 5 easy habits stacked from the same baseline', () => {
    let load = BASELINE;
    for (let i = 0; i < 5; i++) {
      expect(canActivate({ currentLoad: load, habit: easy })).toBe(true);
      load += habitLoadPoints(easy);
    }
  });

  it('refuses the 3rd heavy habit stacked from the same baseline, even though the old fixed-3 rule would allow it by count alone', () => {
    let load = BASELINE;
    expect(canActivate({ currentLoad: load, habit: heavy })).toBe(true); // 1st: 32 -> 50
    load += habitLoadPoints(heavy);
    expect(canActivate({ currentLoad: load, habit: heavy })).toBe(true); // 2nd: 50 -> 68
    load += habitLoadPoints(heavy);
    expect(canActivate({ currentLoad: load, habit: heavy })).toBe(false); // 3rd: 68 -> 86, refused
  });

  it('respects a custom ceiling', () => {
    // easy adds ~2.6 points (50 -> ~52.6); heavy adds 18 (50 -> 68).
    expect(canActivate({ currentLoad: 50, habit: easy, ceiling: 53 })).toBe(true);
    expect(canActivate({ currentLoad: 50, habit: heavy, ceiling: 53 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dailyLoad
// ---------------------------------------------------------------------------

describe('dailyLoad', () => {
  it('sums habit/task/focus/overdue contributions and bands the result', () => {
    const result = dailyLoad({
      habits: [habitInput({ difficulty: 3, estimated_minutes: 30 })],
      tasks: [{ estimated_minutes: 20 }, {}],
      focusMinutes: 60,
      overdueCount: 2,
    });
    expect(result.raw).toBeGreaterThan(0);
    expect(result.normalised).toBe(Math.max(0, Math.min(100, Math.round(result.raw))));
    expect(result.band).toBe(bandFor(result.normalised));
  });

  it('clamps normalised to 100 on a wildly overloaded day', () => {
    const habits = Array.from({ length: 10 }, () => habitInput({ difficulty: 5, estimated_minutes: 90 }));
    const result = dailyLoad({ habits, overdueCount: 20 });
    expect(result.raw).toBeGreaterThan(100);
    expect(result.normalised).toBe(100);
    expect(result.band).toBe('asiri');
  });

  it('an empty day normalises to 0, düşük', () => {
    const result = dailyLoad({ habits: [] });
    expect(result).toEqual({ raw: 0, normalised: 0, band: 'dusuk' });
  });
});

// ---------------------------------------------------------------------------
// masteryStatus
// ---------------------------------------------------------------------------

function habit(createdAt: string): Pick<Habit, 'id' | 'created_at'> {
  return { id: 'h1', created_at: createdAt };
}

/** 28 consecutive local days of `state: 'done'` logs, ending on `asOf`. */
function perfectDailyLogs(habitId: string, asOf: Date): HabitLog[] {
  const logs: HabitLog[] = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    logs.push(log(habitId, key, 'done'));
  }
  return logs;
}

describe('masteryStatus -- minimum_age >= 28 days AND recent_completion_rate AND stability_score', () => {
  const asOf = new Date(2026, 0, 29); // 2026-01-29 local

  it(`refuses mastery at ${MASTERY_MIN_AGE_DAYS - 1} days, even with perfect recent completion`, () => {
    const created = new Date(2026, 0, 2); // 2026-01-02 -> age 27 days at asOf
    const logs = perfectDailyLogs('h1', asOf);
    const result = masteryStatus(habit(created.toISOString()), logs, { asOf });
    expect(result.age_days).toBe(27);
    expect(result.mastered).toBe(false);
    expect(result.maintenance).toBe(false);
    expect(result.recent_completion_rate).toBeCloseTo(1, 10);
    expect(result.stability_score).toBeCloseTo(1, 10);
  });

  it(`grants mastery at exactly ${MASTERY_MIN_AGE_DAYS} days once completion and stability are also met`, () => {
    const created = new Date(2026, 0, 1); // 2026-01-01 -> age 28 days at asOf
    const logs = perfectDailyLogs('h1', asOf);
    const result = masteryStatus(habit(created.toISOString()), logs, { asOf });
    expect(result.age_days).toBe(28);
    expect(result.mastered).toBe(true);
    expect(result.maintenance).toBe(true); // mastered habit enters maintenance, does not disappear
  });

  it('refuses mastery when completion rate is low, regardless of age', () => {
    const created = new Date(2025, 11, 1); // long ago
    // 2 done, 8 missed within the window -> a 20% recent completion rate.
    const sparse = [
      log('h1', '2026-01-29', 'done'),
      log('h1', '2026-01-22', 'done'),
      log('h1', '2026-01-15', 'miss'),
      log('h1', '2026-01-16', 'miss'),
      log('h1', '2026-01-17', 'miss'),
      log('h1', '2026-01-08', 'miss'),
      log('h1', '2026-01-09', 'miss'),
      log('h1', '2026-01-10', 'miss'),
      log('h1', '2026-01-03', 'miss'),
      log('h1', '2026-01-04', 'miss'),
    ];
    const result = masteryStatus(habit(created.toISOString()), sparse, { asOf });
    expect(result.age_days).toBeGreaterThanOrEqual(MASTERY_MIN_AGE_DAYS);
    expect(result.recent_completion_rate).toBeLessThan(0.8);
    expect(result.mastered).toBe(false);
  });

  it('refuses mastery when completion is high but bursty (unstable) across weeks', () => {
    const created = new Date(2025, 11, 1);
    // Two perfect weeks, then two entirely unlogged weeks -- high average
    // completion among what IS logged, but not "stable".
    const logs: HabitLog[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() - 27 + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      logs.push(log('h1', key, 'done'));
    }
    const result = masteryStatus(habit(created.toISOString()), logs, { asOf });
    expect(result.stability_score).toBeLessThan(0.7);
    expect(result.mastered).toBe(false);
  });
});
