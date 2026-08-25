/**
 * L1 tests for the Habit Strength Engine V2.  (task 1-W4, IMPLEMENTATION_V2.md §10)
 *
 * TZ is Europe/Istanbul (jest.setup.js), matching date.test.ts/habitSchedule.test.ts.
 * `asOf` is always pinned explicitly so results do not depend on when the suite runs.
 */
import { habitStrength, type StrengthLog } from '../../lib/habitStrength';
import { addDaysLocal, ymd } from '../../lib/date';

const ASOF = new Date(2026, 7, 25); // 2026-08-25, a Tuesday

/** `n` days before ASOF, as a local YYYY-MM-DD string. */
function daysAgo(n: number): string {
  return ymd(addDaysLocal(ASOF, -n));
}

function log(daysBack: number, state: StrengthLog['state'], ratio?: number): StrengthLog {
  return { completed_at: daysAgo(daysBack), state, ...(ratio != null ? { ratio } : {}) };
}

describe('habitStrength — basics', () => {
  it('a habit with zero logs and no since returns 0 (nothing to infer from)', () => {
    expect(habitStrength([], { asOf: ASOF })).toBe(0);
  });

  it('a perfectly-kept habit over its full life scores 100', () => {
    const since = addDaysLocal(ASOF, -89);
    const logs: StrengthLog[] = [];
    for (let i = 0; i <= 89; i++) logs.push(log(i, 'done'));
    expect(habitStrength(logs, { asOf: ASOF, since })).toBe(100);
  });

  it('a habit that always misses (but exists, with no logs) scores 0', () => {
    const since = addDaysLocal(ASOF, -89);
    expect(habitStrength([], { asOf: ASOF, since })).toBe(0);
  });
});

describe('habitStrength — bucket re-normalisation for a young habit', () => {
  it('a 3-day-old habit with a perfect record scores 100, not capped at the recent-bucket weight (50)', () => {
    // Habit born 2 days before ASOF -> today + 2 days back = 3 days of history.
    const since = addDaysLocal(ASOF, -2);
    const logs: StrengthLog[] = [log(0, 'done'), log(1, 'done'), log(2, 'done')];
    // If this function were deleted (or returned bucket.weight * rate without
    // re-normalising by weightSum), a young habit would be capped at 50 here.
    expect(habitStrength(logs, { asOf: ASOF, since })).toBe(100);
  });

  it('a 3-day-old habit with a mixed record is judged only on its own days, not diluted by nonexistent history', () => {
    const since = addDaysLocal(ASOF, -2);
    // 2 done, 1 miss out of 3 -> rate 2/3 -> weightSum only has the `recent` bucket
    // (0.50), so the re-normalised score equals the recent bucket's own rate.
    const logs: StrengthLog[] = [log(0, 'done'), log(1, 'miss'), log(2, 'done')];
    expect(habitStrength(logs, { asOf: ASOF, since })).toBe(Math.round((2 / 3) * 100));
  });

  it('without `since`, the earliest log date is used as the inferred habit start', () => {
    // No `since` passed: only 2 logs exist, both within the last 3 days -> inference
    // should behave the same as passing since = the earliest log's date.
    const logs: StrengthLog[] = [log(0, 'done'), log(2, 'done')];
    // Expected days: day0 and day2 both count (day1 counts too, as a real miss,
    // since it falls within [earliest-log .. asOf]).
    // credit = 2 (done) + 0 (day1 missing) = 2, expected = 3 -> rate 2/3.
    expect(habitStrength(logs, { asOf: ASOF })).toBe(Math.round((2 / 3) * 100));
  });

  it('an old habit (90+ days) uses all three buckets without re-normalisation', () => {
    const since = addDaysLocal(ASOF, -200);
    const logs: StrengthLog[] = [];
    for (let i = 0; i <= 89; i++) logs.push(log(i, 'done'));
    // All three buckets have full expected-day counts and a 100% rate each ->
    // weightSum = 1.0 exactly, so re-normalisation is a no-op here.
    expect(habitStrength(logs, { asOf: ASOF, since })).toBe(100);
  });
});

describe('habitStrength — skip is excluded from both numerator and denominator', () => {
  it('a skip day does not lower the rate the way a miss would', () => {
    const since = addDaysLocal(ASOF, -6); // exactly the 7-day recent bucket
    const allDone = [0, 1, 2, 3, 4, 5, 6].map((d) => log(d, 'done'));
    const withOneSkip = [0, 1, 2, 3, 4, 5].map((d) => log(d, 'done')).concat(log(6, 'skip'));

    const scoreAllDone = habitStrength(allDone, { asOf: ASOF, since });
    const scoreWithSkip = habitStrength(withOneSkip, { asOf: ASOF, since });

    // Both should be 100: skip removes day 6 from the denominator entirely,
    // leaving 6/6 done, same as a habit that (correctly) never had that day at all.
    expect(scoreAllDone).toBe(100);
    expect(scoreWithSkip).toBe(100);
  });

  it('a skip day is not the same as a miss (a miss would drag the rate down)', () => {
    const since = addDaysLocal(ASOF, -6);
    const withMiss = [0, 1, 2, 3, 4, 5].map((d) => log(d, 'done')).concat(log(6, 'miss'));
    const withSkip = [0, 1, 2, 3, 4, 5].map((d) => log(d, 'done')).concat(log(6, 'skip'));

    expect(habitStrength(withMiss, { asOf: ASOF, since })).toBeLessThan(habitStrength(withSkip, { asOf: ASOF, since }));
  });
});

describe('habitStrength — explicit ratio overrides the coarse state credit', () => {
  it('a partial log with an explicit ratio uses that ratio instead of the 0.5 fallback', () => {
    const since = addDaysLocal(ASOF, -6);
    const logs: StrengthLog[] = [0, 1, 2, 3, 4, 5, 6].map((d) => log(d, 'done'));
    // Replace day 0 with a partial log carrying an exact ratio (e.g. 8000/10000 = 0.8).
    logs[0] = log(0, 'partial', 0.8);
    // credit = 0.8 + 6*1 = 6.8, expected = 7 -> rate 6.8/7.
    expect(habitStrength(logs, { asOf: ASOF, since })).toBe(Math.round((6.8 / 7) * 100));
  });

  it('without an explicit ratio, partial falls back to 0.5 credit', () => {
    const since = addDaysLocal(ASOF, -6);
    const logs: StrengthLog[] = [0, 1, 2, 3, 4, 5, 6].map((d) => log(d, 'done'));
    logs[0] = log(0, 'partial');
    expect(habitStrength(logs, { asOf: ASOF, since })).toBe(Math.round((6.5 / 7) * 100));
  });
});

describe('habitStrength — weighting favours recent days over distant ones', () => {
  it('a habit whose ONLY good bucket is `recent` outscores one whose only good bucket is `mid`, which outscores `long`', () => {
    // Each case leaves the other two buckets with NO logs at all (a real miss,
    // not an absence of data — `since` spans the full 90 days in every case,
    // so every bucket keeps its full expected-day count; none is dropped).
    const since = addDaysLocal(ASOF, -89);

    const recentOnly: StrengthLog[] = [];
    for (let i = 0; i <= 6; i++) recentOnly.push(log(i, 'done'));

    const midOnly: StrengthLog[] = [];
    for (let i = 7; i <= 29; i++) midOnly.push(log(i, 'done'));

    const longOnly: StrengthLog[] = [];
    for (let i = 30; i <= 89; i++) longOnly.push(log(i, 'done'));

    const recentScore = habitStrength(recentOnly, { asOf: ASOF, since });
    const midScore = habitStrength(midOnly, { asOf: ASOF, since });
    const longScore = habitStrength(longOnly, { asOf: ASOF, since });

    expect(recentScore).toBeGreaterThan(midScore);
    expect(midScore).toBeGreaterThan(longScore);
    expect(recentScore).toBe(50); // 0.50 weight x 100% rate in that bucket alone
    expect(midScore).toBe(35);    // 0.35 weight x 100% rate
    expect(longScore).toBe(15);   // 0.15 weight x 100% rate
  });
});
