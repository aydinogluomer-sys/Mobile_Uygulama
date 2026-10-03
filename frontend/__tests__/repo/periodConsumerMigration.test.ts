/**
 * R01.02-b — the consumer migration, locked.
 *
 * R00 found the window evaluator fully built and tested with ZERO production
 * consumers: every real caller went through `isDueOn`, whose count branch
 * invents fixed weekdays (`countDueDays`). A "3 a week" user working Tue/Thu/Sun
 * was scored against Mon/Wed/Sat -- three phantom misses, three uncredited
 * completions. R01.01-a built `periodStatus`, R01.02-a built `isEligibleOn` and
 * the count-mode denominator, and this card moved the consumers onto them.
 *
 * Source-text invariant, same instrument as `skeletonStates.test.ts`: the thing
 * being guarded is which ORACLE a file reaches for, which is a property of the
 * source, not of any one render. Regexes are anchored to real code lines --
 * mentioning `isDueOn` in a comment must not fail the guard, and must not pass
 * it either.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Call sites only: `isDueOn(` not preceded by a `*` comment marker. */
function callsIsDueOn(src: string): boolean {
  return src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/)/.test(l))
    .some((l) => /\bisDueOn\s*\(/.test(l));
}

// The three screens whose `isDueOn` call fed `dailyLoad({ habits })` -- the
// "how much does this day carry?" question, which `carriesDayLoad` now answers.
const LOAD_SCREENS = [
  'app/screens/weekly-review.tsx',
  'app/screens/monthly-review.tsx',
  'app/screens/insights.tsx',
];

describe('R01.02-b — per-day load goes through the period-aware oracle', () => {
  for (const f of LOAD_SCREENS) {
    it(`${f} asks carriesDayLoad, not isDueOn`, () => {
      const src = read(f);
      expect(src).toMatch(/carriesDayLoad\(/);
      expect(callsIsDueOn(src)).toBe(false);
    });

    it(`${f} feeds it real completions, so an unmet period can be told from a met one`, () => {
      // `carriesDayLoad(h, [], d)` would type-check and silently report every
      // count-based habit as permanently loaded.
      expect(read(f)).toMatch(/carriesDayLoad\([^)]*,\s*(params\.)?(habitLogs|logs)\s*,/);
    });
  }
});

describe('R01.02-b — day-level miss detection excludes count schedules', () => {
  it('recovery.tsx cannot put a count-based habit in a day-keyed backlog', () => {
    const src = read('app/screens/recovery.tsx');
    // Two guards: the backlog loop and `consecutiveMissedDue`. A count schedule
    // has no per-day obligation, so it has no missed DAY either -- its unit is a
    // closed unmet period.
    expect(src).toMatch(/if \(isCountBasedSchedule\(h\)\) continue;/);  // backlog loop
    expect(src).toMatch(/if \(isCountBasedSchedule\(h\)\) return 0;/);  // consecutiveMissedDue
  });
});

/** Call sites only: `isEligibleOn(` not on a comment line. */
function callsIsEligibleOn(src: string): boolean {
  return src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/)/.test(l))
    .some((l) => /\bisEligibleOn\s*\(/.test(l));
}

describe('R01.02-b — the library consumers no longer reach the count branch', () => {
  // R01.02-c moved the day walk from `isDueOn` to `isEligibleOn` (identical for
  // daily/weekly_days, and the only predicate that sees interval_days and date
  // ranges). What R01.02-b pinned still must hold for the new call: a count-based
  // habit returns before the day walk.
  for (const f of ['lib/reportMetrics.ts', 'lib/behaviorIntelligence.ts']) {
    it(`${f} short-circuits count schedules before any day-walk eligibility call`, () => {
      const src = read(f);
      expect(src).toMatch(/isCountBased\(/);
      expect(src).toMatch(/scheduledCompletionRate|periodStatus/);
      // assert the guard appears before the first day-walk call site.
      const firstGuard = src.search(/if \(isCountBased\(/);
      const firstCall = src.split(/\r?\n/).findIndex((l) => !/^\s*(\*|\/\/)/.test(l) && /\bisEligibleOn\s*\(/.test(l));
      expect(firstCall).toBeGreaterThan(-1);
      const firstCallOffset = src.split(/\r?\n/).slice(0, firstCall).join('\n').length;
      expect(firstGuard).toBeGreaterThan(-1);
      expect(firstGuard).toBeLessThan(firstCallOffset);
    });
  }
});

describe('R01.02-b — countDueDays is retained on purpose, not forgotten', () => {
  it('still has exactly one caller: the isDueOn count branch', () => {
    const src = read('lib/habitSchedule.ts');
    const calls = src
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\*|\/\/)/.test(l))
      .filter((l) => /\bcountDueDays\s*\(/.test(l));
    // The definition line plus the single call inside `isDueOn`.
    expect(calls.filter((l) => !/^function /.test(l.trim()))).toHaveLength(1);
  });

  it('records WHY it survives, so the next reader does not delete it blind', () => {
    const src = read('lib/habitSchedule.ts');
    // The reason is the pinned AC-H03 contract, not an unmigrated consumer.
    expect(src).toMatch(/AC-H03/);
    expect(src).toMatch(/owner decision|owner should/);
  });

  it('has no production caller that can pass it a count-based habit', () => {
    // These four files used to call `isDueOn` (R01.02-b asserted that they
    // still did). Since R01.02-c they call `isEligibleOn` on the day lane and
    // `isDueOn` not at all -- and they still guard count schedules first.
    // habit-detail is the one that used to not, and the reason this is a test.
    const guarded: [string, RegExp][] = [
      ['lib/reportMetrics.ts', /isCountBased\(/],
      ['lib/behaviorIntelligence.ts', /isCountBased\(/],
      ['app/screens/recovery.tsx', /isCountBasedSchedule\(/],
      ['app/screens/habit-detail.tsx', /isCountBasedSchedule\(/],
    ];
    for (const [f, guard] of guarded) {
      const src = read(f);
      expect(callsIsDueOn(src)).toBe(false);      // R01.02-c: no direct isDueOn
      expect(callsIsEligibleOn(src)).toBe(true);  // still a day-based consumer
      expect(src).toMatch(guard);                 // but count schedules branch away
    }
  });
});

describe('R01.02-c — the day lane asks isEligibleOn, so interval_days / date ranges are seen', () => {
  // `isDueOn` reads kind/days/count only. Anything that walks days through it
  // treats "every 3 days" as "every day" and ignores range bounds, while
  // streakBroken / isEligibleOn / periodStatus (through `dueOnExtended`) do not:
  // one module, two answers. Each anchored line below is the exact day-lane
  // call; a mention in a comment neither satisfies nor breaks it.
  const DAY_LANE: [string, RegExp[]][] = [
    ['lib/reportMetrics.ts', [
      /^\s*if \(!isEligibleOn\(habit as Habit, dateObj\)\) continue;/,   // habitAveragePercent
      /^\s*if \(!isEligibleOn\(habit, dateObj\)\) continue;/,            // summarizeHabitProgress
    ]],
    ['lib/behaviorIntelligence.ts', [
      /^\s*if \(!isEligibleOn\(habit as Habit, date\)\) continue; \/\/ `as Habit`/, // dueDayStats
      /^\s*if \(!isEligibleOn\(habit as Habit, date\)\) continue;$/,                // weekdayBreakdown
      /^\s*if \(!isEligibleOn\(habit as Habit, cursor\)\) \{/,                      // currentStreak
      /^\s*if \(!isEligibleOn\(habit as Habit, date\)\) continue; \/\/ transparent/, // longestStreak
    ]],
    ['app/screens/recovery.tsx', [
      /^\s*if \(!isEligibleOn\(h, dObj\)\) continue;$/,
    ]],
    ['app/screens/habit-detail.tsx', [
      /^\s*if \(!countBased && !isEligibleOn\(habit, dateObj\)\) return \{ date: d, state: 'not_scheduled'/,
    ]],
    ['lib/habitSchedule.ts', [
      /^\s*if \(!isEligibleOn\(habit, cursor\)\) continue;$/,            // scheduledCompletionRate day branch
      /^\s*return isEligibleOn\(habit, date\);$/,                        // carriesDayLoad day branch
    ]],
  ];

  for (const [f, patterns] of DAY_LANE) {
    it(`${f}: every day-lane call is isEligibleOn`, () => {
      const lines = read(f).split(/\r?\n/);
      for (const re of patterns) expect(lines.some((l) => re.test(l))).toBe(true);
    });
  }

  it('recovery.tsx makes BOTH day walks (backlog + consecutiveMissedDue) through isEligibleOn', () => {
    const lines = read('app/screens/recovery.tsx').split(/\r?\n/);
    expect(lines.filter((l) => /^\s*if \(!isEligibleOn\(h, dObj\)\) continue;$/.test(l))).toHaveLength(2);
  });

  it('inside habitSchedule.ts, isDueOn is called only by dueOnExtended (base guards)', () => {
    const src = read('lib/habitSchedule.ts');
    const start = src.indexOf('function dueOnExtended(');
    const end = src.indexOf('\n}', start);
    expect(start).toBeGreaterThan(-1);
    const calls = src
      .split(/\r?\n/)
      .map((l, i) => ({ l, i }))
      .filter(({ l }) => !/^\s*(\*|\/\/)/.test(l) && /\bisDueOn\s*\(/.test(l) && !/export function isDueOn/.test(l));
    const startLine = src.slice(0, start).split(/\r?\n/).length - 1;
    const endLine = src.slice(0, end).split(/\r?\n/).length;
    expect(calls.length).toBe(3);
    for (const { i } of calls) {
      expect(i).toBeGreaterThanOrEqual(startLine);
      expect(i).toBeLessThanOrEqual(endLine);
    }
  });

  it('dueOnExtended stays private (isEligibleOn is its public door)', () => {
    expect(read('lib/habitSchedule.ts')).not.toMatch(/export function dueOnExtended/);
  });
});
