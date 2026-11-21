/**
 * Weekly/Monthly AI-insight digest tests.  (Phase 3, CODER-L, plan §13 / Gate D)
 *
 * Pure domain tests -- no I/O, no Supabase, no store, no raw log rows
 * anywhere in this file. Covers: an `{ok:false}` metric is NEVER emitted as
 * a number (omitted instead, with a real reason); `formatDigestForPrompt`
 * is deterministic; the digest's own TYPE shape structurally cannot carry a
 * raw log row.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  weeklyDigest, monthlyDigest, formatDigestForPrompt, slugify, MAX_HABIT_ENTRIES,
  type WeeklyDigestInput, type MonthlyDigestInput, type NamedHabitRate,
} from '../../lib/insightDigest';
import { MIN_WEEKDAY_SAMPLES, type Result, type Trend, type WeekdayStat } from '../../lib/behaviorIntelligence';

function ok<T>(value: T): Result<T> { return { ok: true, value }; }
function insufficient(reason = 'not enough data'): Result<never> { return { ok: false, reason }; }

/** F13 (INT-07): `distinctDates` defaults to `scheduled` (one habit, one date per habit-day). */
function weekdayStat(weekday: number, scheduled: number, completed: number, distinctDates = scheduled): WeekdayStat {
  return { weekday, scheduled, completed, distinctDates, rate: scheduled > 0 ? completed / scheduled : 0 };
}

/** Full 7-day weekday stat array, every day clearing MIN_WEEKDAY_SAMPLES,
 *  with a distinct, easy-to-assert rate per day. */
function fullWeekdayStats(): WeekdayStat[] {
  const rates = [1.0, 0.8, 0.6, 0.4, 0.2, 0.9, 0.1]; // Mon..Sun
  return rates.map((r, weekday) => weekdayStat(weekday, MIN_WEEKDAY_SAMPLES, Math.round(r * MIN_WEEKDAY_SAMPLES)));
}

const trend: Trend = { direction: 'improving', magnitude: 0.12, weeksUsed: 4, weeksRequested: 4, partialWindow: false };

function baseWeeklyInput(overrides: Partial<WeeklyDigestInput> = {}): WeeklyDigestInput {
  return {
    activeHabitCount: 3,
    weekCompletionRate: 72,
    weekOverWeekTrend: ok(trend),
    weekdayStats: fullWeekdayStats(),
    strongestHabit: ok({ habitName: 'Yürüyüş', strength: 85 }),
    mostFragileHabit: ok({ habitName: 'Meditasyon', volatility: 0.4 }),
    recoverySuccess: ok(0.8),
    habitCompletionRates30d: [{ habitName: 'Yürüyüş', rate: ok(0.72) }],
    capacityLoadToday: 55,
    overloadDaysThisWeek: 1,
    focusMinutesThisWeek: 120,
    ...overrides,
  };
}

function baseMonthlyInput(overrides: Partial<MonthlyDigestInput> = {}): MonthlyDigestInput {
  return {
    activeHabitCount: 3,
    monthCompletionRate: 68,
    trend4w: ok(trend),
    trend12w: ok({ ...trend, magnitude: -0.05, direction: 'declining' }),
    strongestHabit: ok({ habitName: 'Yürüyüş', strength: 85 }),
    mostFragileHabit: ok({ habitName: 'Meditasyon', volatility: 0.4 }),
    recoverySuccess: ok(0.8),
    habitCompletionRates30d: [{ habitName: 'Yürüyüş', rate: ok(0.72) }],
    overloadDaysThisMonth: 3,
    focusMinutesThisMonth: 480,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Plan §13's worked example, reproduced
// ---------------------------------------------------------------------------

describe('weeklyDigest -- plan §13\'s worked example shape', () => {
  it('produces walking_completion_30d, a per-weekday completion, weekend_completion and recovery_success', () => {
    const digest = weeklyDigest(baseWeeklyInput({
      habitCompletionRates30d: [{ habitName: 'Yürüyüş', rate: ok(0.72) }],
    }));
    expect(digest.entries.yuruyus_completion_30d).toBe(72);
    expect(digest.entries.monday_completion).toBe(100);
    expect(digest.entries.recovery_success).toBe(80);
    expect(typeof digest.entries.weekend_completion).toBe('number');
  });

  it('slugify transliterates Turkish characters so "Yürüyüş" becomes a stable ascii key', () => {
    expect(slugify('Yürüyüş')).toBe('yuruyus');
    expect(slugify('Su İç')).toBe('su_ic');
    expect(slugify('!!!')).toBe('habit');
  });
});

// ---------------------------------------------------------------------------
// The "never fabricate a missing metric" rule
// ---------------------------------------------------------------------------

describe('weeklyDigest -- an {ok:false} metric is omitted, never emitted as 0', () => {
  it('omits week_completion_rate when recoverySuccess/trend/etc are insufficient -- each with its own reason, no numeric 0 anywhere', () => {
    const digest = weeklyDigest(baseWeeklyInput({
      weekOverWeekTrend: insufficient('only 1 week of data'),
      strongestHabit: insufficient('no habit has enough logs'),
      mostFragileHabit: insufficient('no habit has enough weekly history'),
      recoverySuccess: insufficient('no recovery plan has a resolved status yet'),
      habitCompletionRates30d: [{ habitName: 'Yeni Alışkanlık', rate: insufficient('no scheduled days yet') }],
    }));

    expect(digest.entries.week_over_week_trend).toBeUndefined();
    expect(digest.entries.recovery_success).toBeUndefined();
    expect(Object.keys(digest.entries).some((k) => k.endsWith('_strength'))).toBe(false);
    expect(Object.keys(digest.entries).some((k) => k.endsWith('_volatility'))).toBe(false);
    expect(Object.keys(digest.entries).some((k) => k.endsWith('_completion_30d'))).toBe(false);

    // Never a fabricated 0 hiding where the real value would have been.
    expect(digest.entries.week_over_week_trend).not.toBe(0);
    expect(digest.entries.recovery_success).not.toBe(0);

    const reasons = digest.omittedMetrics.map((m) => m.key);
    expect(reasons).toEqual(expect.arrayContaining([
      'week_over_week_trend', 'strongest_habit_strength', 'most_fragile_habit_volatility', 'recovery_success',
    ]));
    for (const m of digest.omittedMetrics) {
      expect(typeof m.reason).toBe('string');
      expect(m.reason.length).toBeGreaterThan(0);
    }
  });

  it('omits week_completion_rate specifically when there are zero active habits (never a fabricated 0%)', () => {
    const digest = weeklyDigest(baseWeeklyInput({ activeHabitCount: 0, weekCompletionRate: 0 }));
    expect(digest.entries.week_completion_rate).toBeUndefined();
    expect(digest.omittedMetrics.some((m) => m.key === 'week_completion_rate')).toBe(true);
  });

  it('a weekday seen on fewer than 3 distinct dates is omitted, not rendered at a misleading rate', () => {
    const stats = fullWeekdayStats();
    // F13 (INT-07): 5 habit-days but ONE calendar date (five habits on a single Monday).
    stats[0] = weekdayStat(0, 5, 5, 1);
    const digest = weeklyDigest(baseWeeklyInput({ weekdayStats: stats }));
    expect(digest.entries.monday_completion).toBeUndefined();
    expect(digest.omittedMetrics.find((m) => m.key === 'monday_completion')?.reason).toMatch(/distinct date/);
  });

  it('weekend_completion is omitted when the combined Sat+Sun sample is too small', () => {
    const stats = fullWeekdayStats();
    stats[5] = weekdayStat(5, 0, 0);
    stats[6] = weekdayStat(6, 0, 0);
    const digest = weeklyDigest(baseWeeklyInput({ weekdayStats: stats }));
    expect(digest.entries.weekend_completion).toBeUndefined();
    expect(digest.omittedMetrics.some((m) => m.key === 'weekend_completion')).toBe(true);
  });

  it('the always-real counters (capacity load, overload days, focus minutes) are still present at a genuine 0 -- that is an earned fact, not a guess', () => {
    const digest = weeklyDigest(baseWeeklyInput({ capacityLoadToday: 0, overloadDaysThisWeek: 0, focusMinutesThisWeek: 0 }));
    expect(digest.entries.capacity_load_today).toBe(0);
    expect(digest.entries.overload_days_this_week).toBe(0);
    expect(digest.entries.focus_minutes_this_week).toBe(0);
  });
});

describe('monthlyDigest -- same never-fabricate-a-0 rule', () => {
  it('omits month_completion_rate at zero active habits', () => {
    const digest = monthlyDigest(baseMonthlyInput({ activeHabitCount: 0, monthCompletionRate: 0 }));
    expect(digest.entries.month_completion_rate).toBeUndefined();
    expect(digest.omittedMetrics.some((m) => m.key === 'month_completion_rate')).toBe(true);
  });

  it('omits trend_4w/trend_12w independently when either is insufficient', () => {
    const digest = monthlyDigest(baseMonthlyInput({
      trend4w: insufficient('only 1 week of data'),
    }));
    expect(digest.entries.trend_4w).toBeUndefined();
    expect(typeof digest.entries.trend_12w).toBe('number');
  });

  it('has no per-weekday keys at all -- monthly digest deliberately excludes that concept', () => {
    const digest = monthlyDigest(baseMonthlyInput());
    const weekdayKeyPattern = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday)_completion$|^weekend_completion$/;
    expect(Object.keys(digest.entries).some((k) => weekdayKeyPattern.test(k))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Per-habit key collisions
// ---------------------------------------------------------------------------

describe('weeklyDigest -- per-habit key collisions are disambiguated, not silently overwritten', () => {
  it('two different habits slugifying to the same base key both survive with distinct suffixed keys', () => {
    const rates: NamedHabitRate[] = [
      { habitName: 'Su İç', rate: ok(0.5) },
      { habitName: 'SU-iç', rate: ok(0.9) },
    ];
    const digest = weeklyDigest(baseWeeklyInput({ habitCompletionRates30d: rates }));
    expect(digest.entries.su_ic_completion_30d).toBe(50);
    expect(digest.entries.su_ic_completion_30d_2).toBe(90);
  });

  it('caps per-habit entries at MAX_HABIT_ENTRIES', () => {
    const rates: NamedHabitRate[] = Array.from({ length: MAX_HABIT_ENTRIES + 5 }, (_, i) => ({
      habitName: `Habit ${i}`,
      rate: ok(0.5),
    }));
    const digest = weeklyDigest(baseWeeklyInput({ habitCompletionRates30d: rates }));
    const count = Object.keys(digest.entries).filter((k) => k.endsWith('_completion_30d')).length;
    expect(count).toBe(MAX_HABIT_ENTRIES);
  });

  it('the same habit appearing as both strongest AND in the 30d list produces two distinct keys, not one overwritten value', () => {
    const digest = weeklyDigest(baseWeeklyInput({
      strongestHabit: ok({ habitName: 'Yürüyüş', strength: 91 }),
      habitCompletionRates30d: [{ habitName: 'Yürüyüş', rate: ok(0.72) }],
    }));
    expect(digest.entries.yuruyus_strength).toBe(91);
    expect(digest.entries.yuruyus_completion_30d).toBe(72);
  });
});

// ---------------------------------------------------------------------------
// formatDigestForPrompt -- deterministic, plan §13's literal "key = value"
// ---------------------------------------------------------------------------

describe('formatDigestForPrompt', () => {
  it('renders one "key = value" line per entry', () => {
    const digest = weeklyDigest(baseWeeklyInput());
    const text = formatDigestForPrompt(digest);
    const lines = text.split('\n');
    expect(lines.length).toBe(Object.keys(digest.entries).length);
    for (const line of lines) {
      expect(line).toMatch(/^[a-z0-9_]+ = -?\d+$/);
    }
  });

  it('is deterministic -- same digest in, byte-identical string out, across repeated calls', () => {
    const digest = weeklyDigest(baseWeeklyInput());
    const a = formatDigestForPrompt(digest);
    const b = formatDigestForPrompt(weeklyDigest(baseWeeklyInput()));
    expect(a).toBe(b);
  });

  it('never mentions an omitted metric -- only entries reach the prompt text', () => {
    const digest = weeklyDigest(baseWeeklyInput({ recoverySuccess: insufficient('no data') }));
    const text = formatDigestForPrompt(digest);
    expect(text).not.toMatch(/recovery_success/);
    expect(digest.omittedMetrics.some((m) => m.key === 'recovery_success')).toBe(true);
  });

  it('snapshot -- a fixed digest renders a fixed, reviewable string', () => {
    const digest = weeklyDigest({
      activeHabitCount: 1,
      weekCompletionRate: 72,
      weekOverWeekTrend: insufficient('x'),
      weekdayStats: [],
      strongestHabit: insufficient('x'),
      mostFragileHabit: insufficient('x'),
      recoverySuccess: ok(0.8),
      habitCompletionRates30d: [],
      capacityLoadToday: 40,
      overloadDaysThisWeek: 0,
      focusMinutesThisWeek: 60,
    });
    expect(formatDigestForPrompt(digest)).toBe(
      [
        'week_completion_rate = 72',
        'recovery_success = 80',
        'capacity_load_today = 40',
        'overload_days_this_week = 0',
        'focus_minutes_this_week = 60',
      ].join('\n'),
    );
  });
});

// ---------------------------------------------------------------------------
// No raw log rows -- structural proof, not just a runtime check
// ---------------------------------------------------------------------------

describe('Digest shape -- structurally cannot carry a raw log row', () => {
  it('every entry value is a plain finite number -- never an object, array, or log-shaped record', () => {
    const digest = weeklyDigest(baseWeeklyInput());
    for (const [key, value] of Object.entries(digest.entries)) {
      expect(typeof value).toBe('number');
      expect(Number.isFinite(value)).toBe(true);
      expect(key).not.toMatch(/habit_id|completed_at|^state$/);
    }
  });

  it('the digest object itself has no property that could hold a log array (only "period", "entries", "omittedMetrics")', () => {
    const digest = weeklyDigest(baseWeeklyInput());
    expect(Object.keys(digest).sort()).toEqual(['entries', 'omittedMetrics', 'period']);
  });

  it('WeeklyDigestInput/MonthlyDigestInput have no field literally named after a raw log row shape', () => {
    // habitCompletionRates30d entries are { habitName, rate: Result<number> } --
    // structurally incapable of holding { habit_id, completed_at, state }.
    const rate: NamedHabitRate = { habitName: 'x', rate: ok(0.5) };
    expect(Object.keys(rate).sort()).toEqual(['habitName', 'rate']);
    expect('habit_id' in rate).toBe(false);
    expect('completed_at' in rate).toBe(false);
    expect('state' in rate).toBe(false);
  });

  it('lib/insightDigest.ts imports no I/O module (no supabase, no repositories, no React)', () => {
    const src = readFileSync(join(__dirname, '..', '..', 'lib', 'insightDigest.ts'), 'utf8');
    expect(src).not.toMatch(/from ['"].*supabase['"]/);
    expect(src).not.toMatch(/from ['"].*repositories/);
    expect(src).not.toMatch(/from ['"]react/);
    expect(src).not.toMatch(/supabase\s*\.\s*(from|rpc|functions)\s*\(/);
  });
});
