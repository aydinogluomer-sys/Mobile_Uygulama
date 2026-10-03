/**
 * R01.06-a — Bugün asks the canonical calendar, locked.
 *
 * Before this card `app/tabs/today.tsx` made ZERO calls to the schedule oracle:
 * every active habit was a "remaining step" every day. Source-text invariant,
 * same instrument as `periodConsumerMigration.test.ts`. Regexes are anchored to
 * real code lines -- a word in a comment must neither pass nor fail the guard.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

/** Source with comment lines (`//`, ` *`, `/*`) dropped. */
function codeLines(src: string): string[] {
  return src.split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
}

const TODAY = 'app/tabs/today.tsx';

describe('R01.06-a — today.tsx asks the schedule oracle', () => {
  const code = codeLines(read(TODAY));

  it('calls isEligibleOn on a real code line', () => {
    expect(code.some((l) => /\bisEligibleOn\s*\(\s*h\s*,\s*date\s*\)/.test(l))).toBe(true);
  });

  it('derives todayHabits through the selector', () => {
    expect(code.some((l) => /const todayHabits = selectTodayHabits\(/.test(l))).toBe(true);
  });

  it('does not reach for carriesDayLoad (needs period logs this screen does not load)', () => {
    expect(code.some((l) => /\bcarriesDayLoad\b/.test(l))).toBe(false);
  });

  it('has an explicit fail-open branch for ambiguous schedules', () => {
    expect(code.some((l) => /isEligibleOn\(h, date\) \|\| isScheduleAmbiguous\(h\)/.test(l))).toBe(true);
  });

  it('uses activeHabits.length nowhere as a day-surface denominator', () => {
    // The only legitimate use is telling "no habits at all" from "none today",
    // which goes through `todayHabitCopy(..., activeHabits.length)`.
    const uses = code.filter((l) => /\bactiveHabits\.length\b/.test(l));
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatch(/todayHabitCopy\(habitSummary, activeHabits\.length\)/);
    // And the list renders the scheduled set, not every active habit.
    expect(code.some((l) => /\bactiveHabits\.(slice|map)\(/.test(l))).toBe(false);
    expect(code.some((l) => /\btodayHabits\.slice\(/.test(l))).toBe(true);
  });

  it('counts completions from the scheduled set, not from every active habit', () => {
    expect(code.some((l) => /const completedHabits = todayHabits\.filter\(/.test(l))).toBe(true);
    expect(code.some((l) => /summarizeTodayHabits\(todayHabits, completedHabits\)/.test(l))).toBe(true);
  });

  it('feeds the narrative the scheduled total', () => {
    expect(code.some((l) => /totalHabits:\s*habitSummary\.total/.test(l))).toBe(true);
  });

  it('does not call getDay() for the schedule (weekday index lives in habitSchedule)', () => {
    // `now.getDay()` remains for the eyebrow label only.
    const getDay = code.filter((l) => /\.getDay\(\)/.test(l));
    for (const l of getDay) expect(l).toMatch(/DAYS\[/);
  });
});

describe('R01.06-a — A7: nothing becomes unreachable', () => {
  it('habits.tsx still lists every active habit, unfiltered by schedule', () => {
    const code = codeLines(read('app/tabs/habits.tsx'));
    expect(code.some((l) => /const activeHabits = habits\.filter\(\(h\) => h\.status === 'active'\);/.test(l))).toBe(true);
    expect(code.some((l) => /\bisEligibleOn\b|\bselectTodayHabits\b/.test(l))).toBe(false);
  });
});
