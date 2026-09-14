/**
 * L1 tests for habit scheduling.  (task 1E-L1a)
 *
 * AC-H03: a `{kind:'weekly', count:n}` habit with no explicit `days` is due on
 * no day of the year. `isDueOn` falls through to `return false`, so "3 times a
 * week" is never due, never missed, and never counted.
 *
 * Written BEFORE the fix and observed to fail, per R-01. A test that passes
 * against unmodified code is not evidence of anything.
 */
import type { Habit, HabitLog } from '../../lib/supabase';
import {
  isDueOn, weekdayIndex, scheduleKind, windowFor, isWindowSatisfied, streakBroken,
  isEligibleOn, scheduledCompletionRate, periodStatus,
} from '../../lib/habitSchedule';
import { ymd } from '../../lib/date';

/** Minimal positive habit; override what a case cares about. */
function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    user_id: 'u1',
    name: 'test',
    behavior_type: 'positive',
    frequency_config: { kind: 'daily' },
    created_at: '2020-01-01T00:00:00Z',
    end_condition: null,
    target_direction: null,
    ...over,
  } as Habit;
}

// 2026-08-03 is a Monday; the ISO week runs Mon 03 .. Sun 09.
const MON = new Date(2026, 7, 3);
const TUE = new Date(2026, 7, 4);
const WED = new Date(2026, 7, 5);
const THU = new Date(2026, 7, 6);
const FRI = new Date(2026, 7, 7);
const SAT = new Date(2026, 7, 8);
const SUN = new Date(2026, 7, 9);
const WEEK = [MON, TUE, WED, THU, FRI, SAT, SUN];

describe('weekdayIndex', () => {
  it('maps Monday to 0 and Sunday to 6', () => {
    expect(weekdayIndex(MON)).toBe(0);
    expect(weekdayIndex(SUN)).toBe(6);
  });
});

describe('isDueOn — daily', () => {
  it('is due every day', () => {
    const h = habit({ frequency_config: { kind: 'daily' } });
    expect(WEEK.every((d) => isDueOn(h, d))).toBe(true);
  });
});

describe('isDueOn — weekly with explicit days (must not regress)', () => {
  const h = habit({ frequency_config: { kind: 'weekly', days: [0, 2, 4] } });

  it('is due exactly on Mon, Wed, Fri', () => {
    expect(WEEK.map((d) => isDueOn(h, d))).toEqual([true, false, true, false, true, false, false]);
  });
});

describe('AC-H03 — weekly with count and no days', () => {
  const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });

  it('is due on at least `count` days of the ISO week', () => {
    const dueDays = WEEK.filter((d) => isDueOn(h, d)).length;
    expect(dueDays).toBeGreaterThanOrEqual(3);
  });

  it('is due on exactly `count` days — neither never nor every day', () => {
    expect(WEEK.filter((d) => isDueOn(h, d)).length).toBe(3);
  });

  it('count:1 is due on exactly one day', () => {
    const h1 = habit({ frequency_config: { kind: 'weekly', count: 1 } });
    expect(WEEK.filter((d) => isDueOn(h1, d)).length).toBe(1);
  });

  it('count:7 is due every day', () => {
    const h7 = habit({ frequency_config: { kind: 'weekly', count: 7 } });
    expect(WEEK.filter((d) => isDueOn(h7, d)).length).toBe(7);
  });

  it('is deterministic — the same date always gives the same answer', () => {
    expect(isDueOn(h, WED)).toBe(isDueOn(h, WED));
  });

  it('gives the same pattern in every ISO week', () => {
    const nextWeek = WEEK.map((d) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7));
    expect(WEEK.map((d) => isDueOn(h, d))).toEqual(nextWeek.map((d) => isDueOn(h, d)));
  });

  it('weekly with neither days nor count stays conservative (not due)', () => {
    const h0 = habit({ frequency_config: { kind: 'weekly' } });
    expect(WEEK.filter((d) => isDueOn(h0, d)).length).toBe(0);
  });
});

describe('isDueOn — guards still hold', () => {
  /**
   * CONTRACT CHANGE. This asserted that a negative habit is due on no day,
   * which meant a habit like "at most 2 cigarettes" was skipped by every
   * due-day report, by the completion average and by the missed-day backlog
   * that feeds recovery — logged faithfully, scored correctly, reported
   * nowhere.
   *
   * `behavior_type` says which direction counts as success; the SCHEDULE
   * comes from `frequency_config`. The two are orthogonal, and the real
   * asymmetry moved to `isMissedOn` / `countsTowardAverage`, which have their
   * own tests below.
   */
  it('a negative habit follows its schedule like any other', () => {
    const h = habit({ behavior_type: 'negative', frequency_config: { kind: 'weekly', count: 3 } });
    expect(WEEK.filter((d) => isDueOn(h, d)).length).toBe(3);
  });

  it('a negative daily habit is due every day', () => {
    const h = habit({ behavior_type: 'negative', frequency_config: { kind: 'daily' } });
    expect(WEEK.every((d) => isDueOn(h, d))).toBe(true);
  });

  it('not due before created_at', () => {
    const h = habit({
      frequency_config: { kind: 'daily' },
      created_at: '2026-08-05T00:00:00Z',
    });
    expect(isDueOn(h, MON)).toBe(false);
    expect(isDueOn(h, WED)).toBe(true);
  });

  it('not due after a date end_condition', () => {
    const h = habit({
      frequency_config: { kind: 'daily' },
      end_condition: { kind: 'date', value: '2026-08-05' },
    });
    expect(isDueOn(h, WED)).toBe(true);
    expect(isDueOn(h, THU)).toBe(false);
  });

  it('count-based habits respect the same guards', () => {
    const h = habit({
      frequency_config: { kind: 'weekly', count: 7 },
      end_condition: { kind: 'date', value: '2026-08-05' },
    });
    expect(isDueOn(h, THU)).toBe(false);
  });
});

describe('isDueOn — monthly is an explicit decision', () => {
  it('is not due on any day, deliberately', () => {
    const h = habit({ frequency_config: { kind: 'monthly' } });
    expect(WEEK.some((d) => isDueOn(h, d))).toBe(false);
  });
});

// =====================================================================================
// V2 — flexible scheduling (task 1-W4, IMPLEMENTATION_V2.md §8.7)
// Appended only. Nothing above this line was changed.
// =====================================================================================

/** Minimal log row shape consumed by windowFor/isWindowSatisfied/streakBroken. */
function mkLog(habitId: string, date: Date, state: HabitLog['state']): Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'> {
  return { habit_id: habitId, completed_at: ymd(date), state };
}

describe('scheduleKind', () => {
  it('defaults to daily', () => {
    expect(scheduleKind(habit({ frequency_config: { kind: 'daily' } }))).toEqual({ kind: 'daily' });
  });

  it('weekly with explicit days is weekly_days', () => {
    const h = habit({ frequency_config: { kind: 'weekly', days: [0, 2, 4] } });
    expect(scheduleKind(h)).toEqual({ kind: 'weekly_days', days: [0, 2, 4] });
  });

  it('weekly with a count and no days is weekly_count', () => {
    const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    expect(scheduleKind(h)).toEqual({ kind: 'weekly_count', count: 3 });
  });

  it('weekly with neither days nor count is weekly_count with count 0 (nothing to satisfy)', () => {
    const h = habit({ frequency_config: { kind: 'weekly' } });
    expect(scheduleKind(h)).toEqual({ kind: 'weekly_count', count: 0 });
  });

  it('monthly with a count is monthly_count', () => {
    const h = habit({ frequency_config: { kind: 'monthly', count: 8 } });
    expect(scheduleKind(h)).toEqual({ kind: 'monthly_count', count: 8 });
  });

  it('monthly with no count is monthly_count with count 0', () => {
    const h = habit({ frequency_config: { kind: 'monthly' } });
    expect(scheduleKind(h)).toEqual({ kind: 'monthly_count', count: 0 });
  });

  it('daily with interval_days > 1 is every_n_days', () => {
    const h = habit({ frequency_config: { kind: 'daily', interval_days: 3 } });
    expect(scheduleKind(h)).toEqual({ kind: 'every_n_days', intervalDays: 3 });
  });

  it('daily with interval_days of 1 (or absent) stays plain daily — existing rows are unaffected', () => {
    expect(scheduleKind(habit({ frequency_config: { kind: 'daily', interval_days: 1 } }))).toEqual({ kind: 'daily' });
    expect(scheduleKind(habit({ frequency_config: { kind: 'daily' } }))).toEqual({ kind: 'daily' });
  });

  it('range_start/range_end produces date_range, regardless of the underlying kind', () => {
    const h = habit({ frequency_config: { kind: 'daily', range_start: '2026-08-05', range_end: '2026-08-07' } });
    expect(scheduleKind(h)).toEqual({ kind: 'date_range', start: '2026-08-05', end: '2026-08-07' });
  });
});

describe('windowFor', () => {
  it('weekly_count spans Mon..Sun of the ISO week containing `date`, with targetCount = count', () => {
    const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    const w = windowFor(h, WED);
    expect(w).not.toBeNull();
    expect(ymd(w!.start)).toBe(ymd(MON));
    expect(ymd(w!.end)).toBe(ymd(SUN));
    expect(w!.targetCount).toBe(3);
  });

  it('monthly_count spans the full calendar month containing `date`, with targetCount = count', () => {
    const h = habit({ frequency_config: { kind: 'monthly', count: 8 } });
    const w = windowFor(h, WED); // 2026-08-05
    expect(w).not.toBeNull();
    expect(ymd(w!.start)).toBe('2026-08-01');
    expect(ymd(w!.end)).toBe('2026-08-31');
    expect(w!.targetCount).toBe(8);
  });

  it('non-count-based kinds have no window', () => {
    expect(windowFor(habit({ frequency_config: { kind: 'daily' } }), WED)).toBeNull();
    expect(windowFor(habit({ frequency_config: { kind: 'weekly', days: [0] } }), WED)).toBeNull();
    expect(windowFor(habit({ frequency_config: { kind: 'daily', interval_days: 3 } }), WED)).toBeNull();
  });
});

describe('isWindowSatisfied', () => {
  it('true once the window has enough done/partial logs', () => {
    const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    const logs = [mkLog('h1', WED, 'done'), mkLog('h1', FRI, 'done'), mkLog('h1', SAT, 'done')];
    expect(isWindowSatisfied(h, logs, SUN)).toBe(true);
  });

  it('false when short of the target', () => {
    const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    const logs = [mkLog('h1', WED, 'done'), mkLog('h1', FRI, 'done')];
    expect(isWindowSatisfied(h, logs, SUN)).toBe(false);
  });

  it('skip logs do not count toward the target', () => {
    const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });
    const logs = [mkLog('h1', WED, 'done'), mkLog('h1', FRI, 'done'), mkLog('h1', SAT, 'skip')];
    expect(isWindowSatisfied(h, logs, SUN)).toBe(false);
  });

  it('non-window kinds are vacuously satisfied (this function is not their miss-detector)', () => {
    const h = habit({ frequency_config: { kind: 'daily' } });
    expect(isWindowSatisfied(h, [], WED)).toBe(true);
  });
});

describe('streakBroken — the Gym 3x/week case (plan §8.7 headline example)', () => {
  const h = habit({ frequency_config: { kind: 'weekly', count: 3 } });

  it('missing Monday does NOT break the streak while the week is still on pace', () => {
    // Nothing logged yet, evaluated ON Monday itself: 7 days remain, target is 3.
    expect(streakBroken(h, [], MON)).toBe(false);
  });

  it('Wed + Fri + Sat done (Monday skipped over) satisfies the window and leaves the streak unbroken', () => {
    const logs = [mkLog('h1', WED, 'done'), mkLog('h1', FRI, 'done'), mkLog('h1', SAT, 'done')];
    expect(isWindowSatisfied(h, logs, SUN)).toBe(true);
    expect(streakBroken(h, logs, SUN)).toBe(false);
  });

  it('by contrast, falling genuinely short with no days left DOES break the streak', () => {
    // Only Wednesday done; by Sunday (the window's last day) 3 is no longer reachable.
    const logs = [mkLog('h1', WED, 'done')];
    expect(streakBroken(h, logs, SUN)).toBe(true);
  });

  it('a skip on Monday does not itself break the streak as long as 3 is still reachable', () => {
    const logs = [mkLog('h1', MON, 'skip'), mkLog('h1', WED, 'done'), mkLog('h1', FRI, 'done'), mkLog('h1', SAT, 'done')];
    expect(streakBroken(h, logs, SUN)).toBe(false);
  });
});

describe('streakBroken — day-based habits (daily/weekly_days) still detect a real miss', () => {
  it('a due day with no log at all is broken', () => {
    const h = habit({ frequency_config: { kind: 'daily' } });
    expect(streakBroken(h, [], WED)).toBe(true);
  });

  it('a due day with a done/partial log is not broken', () => {
    const h = habit({ frequency_config: { kind: 'daily' } });
    expect(streakBroken(h, [mkLog('h1', WED, 'done')], WED)).toBe(false);
    expect(streakBroken(h, [mkLog('h1', WED, 'partial')], WED)).toBe(false);
  });

  it('a non-due day is never broken, logged or not', () => {
    const h = habit({ frequency_config: { kind: 'weekly', days: [0, 2, 4] } }); // Mon/Wed/Fri
    expect(streakBroken(h, [], TUE)).toBe(false);
  });
});

describe('streakBroken — skip creates no streak penalty (§8.5)', () => {
  it('an explicit skip on a due day does not break the streak', () => {
    const h = habit({ frequency_config: { kind: 'daily' } });
    expect(streakBroken(h, [mkLog('h1', WED, 'skip')], WED)).toBe(false);
  });

  it('an explicit miss on the same day WOULD break it — skip is not just "any non-done state"', () => {
    const h = habit({ frequency_config: { kind: 'daily' } });
    expect(streakBroken(h, [mkLog('h1', WED, 'miss')], WED)).toBe(true);
  });
});

describe('streakBroken — every_n_days (§8.7)', () => {
  // Anchored at MON (2026-08-03): due on MON, THU (+3), and so on. Not due Tue/Wed.
  const h = habit({
    frequency_config: { kind: 'daily', interval_days: 3 },
    created_at: `${ymd(MON)}T00:00:00Z`,
  });

  it('is not broken on an off-cycle day, logged or not', () => {
    expect(streakBroken(h, [], TUE)).toBe(false);
    expect(streakBroken(h, [], WED)).toBe(false);
  });

  it('is broken on the anchor day itself with no completion', () => {
    expect(streakBroken(h, [], MON)).toBe(true);
  });

  it('is not broken on the anchor day once logged done', () => {
    expect(streakBroken(h, [mkLog('h1', MON, 'done')], MON)).toBe(false);
  });

  it('is broken again on the next due day (3 days later)', () => {
    const thu = new Date(2026, 7, 6);
    expect(streakBroken(h, [mkLog('h1', MON, 'done')], thu)).toBe(true);
  });
});

describe('streakBroken — date_range (§8.7)', () => {
  const h = habit({
    frequency_config: { kind: 'daily', range_start: '2026-08-05', range_end: '2026-08-07' }, // Wed..Fri
    created_at: '2020-01-01T00:00:00Z',
  });

  it('is never broken before the range starts', () => {
    expect(streakBroken(h, [], MON)).toBe(false);
    expect(streakBroken(h, [], TUE)).toBe(false);
  });

  it('is never broken after the range ends', () => {
    expect(streakBroken(h, [], SAT)).toBe(false);
    expect(streakBroken(h, [], SUN)).toBe(false);
  });

  it('is broken inside the range with no completion', () => {
    expect(streakBroken(h, [], WED)).toBe(true); // 2026-08-05, the range start
    expect(streakBroken(h, [], FRI)).toBe(true); // 2026-08-07, the range end
  });

  it('is not broken inside the range once logged', () => {
    expect(streakBroken(h, [mkLog('h1', WED, 'done')], WED)).toBe(false);
  });
});

// =====================================================================================
// R01.02-a — flexible count scheduling: eligibility vs obligation vs denominator
//
// `isDueOn` is the legacy OBLIGATION predicate (every production caller reads
// `true` as "expected today; no log = miss"). `isEligibleOn` is the canonical
// ELIGIBILITY predicate. They agree everywhere except count-based schedules,
// where obligation per day does not exist -- and that disagreement is the point.
// =====================================================================================

describe('R01.02-a — isEligibleOn (canonical eligibility)', () => {
  const weekly3 = habit({ frequency_config: { kind: 'weekly', count: 3 } });
  const monthly10 = habit({ frequency_config: { kind: 'monthly', count: 10 } });

  it('weekly count: eligible on every day of the week -- the user picks the days', () => {
    expect(WEEK.map((d) => isEligibleOn(weekly3, d))).toEqual([true, true, true, true, true, true, true]);
  });

  it('weekly count: does NOT fabricate obligation days (the legacy predicate still does)', () => {
    // A1 — Tue/Thu/Sun must be usable. Legacy says Mon/Wed/Sat; canonical says any day.
    expect([TUE, THU, SUN].map((d) => isEligibleOn(weekly3, d))).toEqual([true, true, true]);
    expect([TUE, THU, SUN].map((d) => isDueOn(weekly3, d))).toEqual([false, false, false]);
  });

  it('monthly count: eligible on every day of the month (legacy: never)', () => {
    const sep12 = new Date(2026, 8, 12);
    expect(isEligibleOn(monthly10, sep12)).toBe(true);
    expect(isDueOn(monthly10, sep12)).toBe(false);
  });

  it('count <= 0: no target, so nothing is eligible', () => {
    expect(isEligibleOn(habit({ frequency_config: { kind: 'weekly' } }), TUE)).toBe(false);
    expect(isEligibleOn(habit({ frequency_config: { kind: 'monthly', count: 0 } }), TUE)).toBe(false);
  });

  it('A5 — fixed weekdays: only the configured days, identical to isDueOn', () => {
    const tueThu = habit({ frequency_config: { kind: 'weekly', days: [1, 3] } });
    expect(WEEK.map((d) => isEligibleOn(tueThu, d))).toEqual([false, true, false, true, false, false, false]);
    expect(WEEK.map((d) => isEligibleOn(tueThu, d))).toEqual(WEEK.map((d) => isDueOn(tueThu, d)));
  });

  it('A6 — daily / every-N-days / date-range keep their behaviour', () => {
    const daily = habit();
    expect(WEEK.every((d) => isEligibleOn(daily, d))).toBe(true);

    const every3 = habit({ frequency_config: { kind: 'daily', interval_days: 3 }, created_at: '2026-08-03T00:00:00Z' });
    expect(WEEK.map((d) => isEligibleOn(every3, d))).toEqual([true, false, false, true, false, false, true]);

    const ranged = habit({ frequency_config: { kind: 'daily', range_start: '2026-08-05', range_end: '2026-08-07' } });
    expect(WEEK.map((d) => isEligibleOn(ranged, d))).toEqual([false, false, true, true, true, false, false]);
  });

  it('lifetime guards are shared with isDueOn: not before created_at, not after a dated end', () => {
    const late = habit({ frequency_config: { kind: 'weekly', count: 3 }, created_at: '2026-08-06T00:00:00Z' });
    expect(isEligibleOn(late, TUE)).toBe(false);
    expect(isEligibleOn(late, THU)).toBe(true);
    const ended = habit({ frequency_config: { kind: 'weekly', count: 3 }, end_condition: { kind: 'date', value: '2026-08-05' } as never });
    expect(isEligibleOn(ended, WED)).toBe(true);
    expect(isEligibleOn(ended, THU)).toBe(false);
  });
});

describe('R01.02-a — scheduledCompletionRate on count-based schedules', () => {
  const weekly3 = habit({ frequency_config: { kind: 'weekly', count: 3 } });
  const week = { from: MON, to: SUN };

  it('A1 — Tue/Thu/Sun for "3 a week" is 3/3, not 0/3 on invented weekdays', () => {
    const r = scheduledCompletionRate(weekly3, [mkLog('h1', TUE, 'done'), mkLog('h1', THU, 'done'), mkLog('h1', SUN, 'done')], week);
    expect(r.dueDays).toBe(3);
    expect(r.doneDays).toBe(3);
    expect(r.rate).toBe(1);
  });

  it('denominator is the period target (3), never 7 and never a weekday count', () => {
    const r = scheduledCompletionRate(weekly3, [], week);
    expect(r.dueDays).toBe(3);
    expect(r.dueDays).not.toBe(7);
    expect(r.rate).toBe(0);
  });

  it('A2 — three completions on Tuesday are one day of progress', () => {
    const r = scheduledCompletionRate(weekly3, [mkLog('h1', TUE, 'done'), mkLog('h1', TUE, 'done'), mkLog('h1', TUE, 'partial')], week);
    expect(r.doneDays).toBe(1);
    expect(r.rate).toBeCloseTo(1 / 3, 10);
  });

  it('A3 — an open week seen through Friday is prorated, not charged for days that have not happened', () => {
    // Mon..Fri = 5/7 of the week -> share 3 * 5/7; two done -> on pace, no fabricated miss.
    const r = scheduledCompletionRate(weekly3, [mkLog('h1', TUE, 'done'), mkLog('h1', THU, 'done')], { from: MON, to: FRI });
    expect(r.dueDays).toBeCloseTo(3 * 5 / 7, 5);
    expect(r.doneDays).toBe(2);
    expect(r.rate).toBeCloseTo(2 / (3 * 5 / 7), 5);
    expect(r.rate).toBeLessThanOrEqual(1);
  });

  it('over-achievement is capped at 100% per period', () => {
    const r = scheduledCompletionRate(weekly3, WEEK.map((d) => mkLog('h1', d, 'done')), week);
    expect(r.doneDays).toBe(3);
    expect(r.rate).toBe(1);
  });

  it('A4 — monthly "10 a month": denominator 10, not the number of calendar days', () => {
    const monthly10 = habit({ frequency_config: { kind: 'monthly', count: 10 } });
    const sep = (d: number) => new Date(2026, 8, d);
    const full = scheduledCompletionRate(monthly10, [1, 3, 5, 9].map((d) => mkLog('h1', sep(d), 'done')), { from: sep(1), to: sep(30) });
    expect(full.dueDays).toBe(10);
    expect(full.dueDays).not.toBe(30);
    expect(full.doneDays).toBe(4);
    expect(full.rate).toBeCloseTo(0.4, 10);
    // Through the 12th only: 12/30 of the month -> share 4; 4 done -> on pace, open period.
    const open = scheduledCompletionRate(monthly10, [1, 3, 5, 9].map((d) => mkLog('h1', sep(d), 'done')), { from: sep(1), to: sep(12) });
    expect(open.dueDays).toBeCloseTo(10 * 12 / 30, 5);
    expect(open.rate).toBeCloseTo(1, 10);
  });

  it('a range spanning two weeks sums both targets', () => {
    const r = scheduledCompletionRate(weekly3, [mkLog('h1', TUE, 'done'), mkLog('h1', new Date(2026, 7, 11), 'done')], { from: MON, to: new Date(2026, 7, 16) });
    expect(r.dueDays).toBe(6);
    expect(r.doneDays).toBe(2);
  });

  it('`since` prorates the first period from the day the habit existed', () => {
    // Created Thursday: Thu..Sun = 4/7 of the week.
    const r = scheduledCompletionRate(weekly3, [mkLog('h1', THU, 'done'), mkLog('h1', SUN, 'done')], { from: MON, to: SUN, since: THU });
    expect(r.dueDays).toBeCloseTo(3 * 4 / 7, 5);
    expect(r.doneDays).toBeCloseTo(3 * 4 / 7, 5); // 2 done, capped at the share
    expect(r.rate).toBeCloseTo(1, 10);
  });

  it('no target -> nothing due (unchanged contract for callers that read dueDays === 0)', () => {
    expect(scheduledCompletionRate(habit({ frequency_config: { kind: 'monthly' } }), [], week)).toEqual({ rate: 0, dueDays: 0, doneDays: 0 });
  });

  it('day-based schedules are untouched by this card: fixed Tue/Thu still counts due days', () => {
    const tueThu = habit({ frequency_config: { kind: 'weekly', days: [1, 3] } });
    const r = scheduledCompletionRate(tueThu, [mkLog('h1', TUE, 'done')], week);
    expect(r).toEqual({ rate: 0.5, dueDays: 2, doneDays: 1 });
  });

  it('A7 — agrees with periodStatus on the same fixture', () => {
    const logs = [mkLog('h1', TUE, 'done'), mkLog('h1', THU, 'done')];
    const ps = periodStatus(weekly3, logs, WED, { asOf: SUN });
    const r = scheduledCompletionRate(weekly3, logs, week);
    expect(r.dueDays).toBe(ps.target);
    expect(r.doneDays).toBe(ps.counted);
    expect(ps.status).toBe('in_progress');
  });
});
