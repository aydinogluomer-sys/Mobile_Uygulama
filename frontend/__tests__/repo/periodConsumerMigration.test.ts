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

describe('R01.02-b — the library consumers no longer reach the count branch', () => {
  // Both files still call `isDueOn` for DAY-based schedules, which is correct
  // and deliberate. What must hold is that a count-based habit returns before
  // the day walk, so `countDueDays` can never see one.
  for (const f of ['lib/reportMetrics.ts', 'lib/behaviorIntelligence.ts']) {
    it(`${f} short-circuits count schedules before any isDueOn day walk`, () => {
      const src = read(f);
      expect(src).toMatch(/isCountBased\(/);
      expect(src).toMatch(/scheduledCompletionRate|periodStatus/);
      // Every `isDueOn` call must be inside a function that has already handled
      // the count case: assert the guard appears before the first call site.
      const firstGuard = src.search(/if \(isCountBased\(/);
      const firstCall = src.split(/\r?\n/).findIndex((l) => !/^\s*(\*|\/\/)/.test(l) && /\bisDueOn\s*\(/.test(l));
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
    // Every file that still calls `isDueOn` must guard count schedules first.
    // habit-detail is the one that used to not, and the reason this is a test.
    const guarded: [string, RegExp][] = [
      ['lib/reportMetrics.ts', /isCountBased\(/],
      ['lib/behaviorIntelligence.ts', /isCountBased\(/],
      ['app/screens/recovery.tsx', /isCountBasedSchedule\(/],
      ['app/screens/habit-detail.tsx', /isCountBasedSchedule\(/],
    ];
    for (const [f, guard] of guarded) {
      const src = read(f);
      expect(callsIsDueOn(src)).toBe(true);   // still a day-based consumer
      expect(src).toMatch(guard);             // but count schedules branch away
    }
  });
});
