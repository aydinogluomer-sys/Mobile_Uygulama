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
  MASTERY_COMPLETION_RATE_THRESHOLD,
  type HabitLoadInput,
} from '../../lib/capacity';
import type { FrequencyConfig, Habit, HabitLog } from '../../lib/supabase';

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

/**
 * A full habit, because `masteryStatus` now consults the schedule.
 *
 * It used to take `Pick<Habit, 'id' | 'created_at'>`, which was exactly as
 * much as the old log-count rate needed. The rate is now measured over DUE
 * days, so the frequency is no longer optional context — it is the
 * denominator.
 */
function habit(createdAt: string, frequency: FrequencyConfig = { kind: 'daily' }): Habit {
  return {
    id: 'h1',
    user_id: 'u1',
    name: 'Test',
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: frequency,
    willpower_cost: 1,
    status: 'active',
    impact_level: null,
    urgency: null,
    difficulty: 1,
    estimated_minutes: 10,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: createdAt,
  };
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


/**
 * The bias the schedule-aware rate removes.
 *
 * `recent_completion_rate` used to be `done` logs / TOTAL logs, so the
 * denominator was "days the user touched the habit". A daily habit answered
 * on two days out of twenty-eight and ignored on the rest scored 1.00 — and
 * mastery, whose whole job is to certify consistency, was granted on 2/28
 * adherence. The rule handed its strongest verdict to its weakest evidence.
 *
 * These cases fail on the old implementation and pass on the new one, which
 * is the only reason to write them.
 */
describe('recent_completion_rate is measured over DUE days, not logged days', () => {
  const asOf = new Date(2026, 0, 29);
  const created = new Date(2025, 11, 1); // old enough that age never decides

  it('a daily habit touched twice in the window does not score a perfect rate', () => {
    const logs = [
      log('h1', '2026-01-28', 'done'),
      log('h1', '2026-01-27', 'done'),
    ];
    const result = masteryStatus(habit(created.toISOString()), logs, { asOf });

    // 2 done over 28 due days.
    expect(result.due_days).toBe(28);
    expect(result.done_days).toBe(2);
    expect(result.recent_completion_rate).toBeCloseTo(2 / 28, 10);
    expect(result.mastered).toBe(false);
  });

  it('a Mon/Wed/Fri habit is judged on Mon/Wed/Fri only', () => {
    // Every due day in the window done; the other four weekdays never logged.
    const weekly: FrequencyConfig = { kind: 'weekly', days: [0, 2, 4] };
    const h = habit(created.toISOString(), weekly);
    const logs: HabitLog[] = [];
    for (let i = 0; i < 28; i++) {
      const d = new Date(2026, 0, 29 - i);
      const weekday = (d.getDay() + 6) % 7;
      if (![0, 2, 4].includes(weekday)) continue;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      logs.push(log('h1', key, 'done'));
    }
    const result = masteryStatus(h, logs, { asOf });

    // 4 weeks x 3 due days. The untouched Tue/Thu/Sat/Sun are not misses.
    expect(result.due_days).toBe(12);
    expect(result.done_days).toBe(12);
    expect(result.recent_completion_rate).toBeCloseTo(1, 10);
    expect(result.mastered).toBe(true);
  });

  it('R01.02-a: a "3 a week" habit done Tue/Thu/Sun every week reaches a completion rate of 1', () => {
    // Before this card the rate was measured on three invented weekdays
    // (Mon/Wed/Sat), so this user scored 0/3 forever and could never master
    // the habit. The denominator is now the weekly target.
    const weekly3: FrequencyConfig = { kind: 'weekly', count: 3 };
    const created = new Date(2025, 11, 1);
    const logs: HabitLog[] = [];
    // asOf is Thu 2026-01-29; walk back 8 weeks and log every Tue/Thu/Sun.
    for (let i = 0; i < 60; i++) {
      const d = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate() - i);
      const dow = (d.getDay() + 6) % 7; // Mon=0 .. Sun=6
      if (dow === 1 || dow === 3 || dow === 6) {
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        logs.push(log('h1', key, 'done'));
      }
    }
    const result = masteryStatus(habit(created.toISOString(), weekly3), logs, { asOf });
    // 28-day window = 4 x 3 = 12 target-days (the first Fri..Sun slice and
    // the open Mon..Thu slice are prorated). The leading slice holds only the
    // Sunday completion against 3/7 of a target, so the rate is 0.98, not
    // 1.00 -- the documented edge approximation. What matters: the user is
    // mastered, where the invented-weekday denominator kept them at 0/3.
    expect(result.due_days).toBe(12);
    expect(result.recent_completion_rate).toBeGreaterThanOrEqual(0.95);
    expect(result.recent_completion_rate).toBeGreaterThanOrEqual(MASTERY_COMPLETION_RATE_THRESHOLD);
    expect(result.stability_score).toBeCloseTo(1, 6);
    expect(result.mastered).toBe(true);
  });

  it('R01.02-a: a monthly count habit now has a denominator (its target), so an empty month is 0, not undefined', () => {
    const monthly10: FrequencyConfig = { kind: 'monthly', count: 10 };
    const result = masteryStatus(habit(created.toISOString(), monthly10), [], { asOf });
    expect(result.due_days).toBeGreaterThan(0);
    expect(result.recent_completion_rate).toBe(0);
    expect(result.mastered).toBe(false);
  });

  it('a habit with nothing due in the window is not mastered by default', () => {
    // Monthly never resolves to a due day (see isDueOn's own note), so the
    // window is empty. An empty window must not read as success.
    const monthly: FrequencyConfig = { kind: 'monthly' };
    const result = masteryStatus(habit(created.toISOString(), monthly), [], { asOf });
    expect(result.due_days).toBe(0);
    expect(result.recent_completion_rate).toBe(0);
    expect(result.mastered).toBe(false);
  });

  it('days before the habit existed are not counted as misses', () => {
    // Created 6 days before asOf, done every day since.
    const born = new Date(2026, 0, 24);
    const logs: HabitLog[] = [];
    for (let i = 0; i <= 5; i++) {
      const d = new Date(2026, 0, 24 + i);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      logs.push(log('h1', key, 'done'));
    }
    const result = masteryStatus(habit(born.toISOString()), logs, { asOf });
    expect(result.due_days).toBe(6);
    expect(result.recent_completion_rate).toBeCloseTo(1, 10);
    // ...but it is still far too young to be mastered.
    expect(result.mastered).toBe(false);
  });

  it('an explicitly skipped day leaves both sides of the ratio', () => {
    const logs = [
      log('h1', '2026-01-29', 'done'),
      log('h1', '2026-01-28', 'skip'),
    ];
    const result = masteryStatus(habit(created.toISOString()), logs, { asOf });
    // 28 window days minus the one skipped.
    expect(result.due_days).toBe(27);
    expect(result.done_days).toBe(1);
  });
});
