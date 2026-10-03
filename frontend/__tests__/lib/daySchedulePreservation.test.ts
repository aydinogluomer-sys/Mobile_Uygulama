/**
 * R01.02-c A7 — no regression for daily / weekly_days.
 *
 * The card swaps every day-lane `isDueOn` call for `isEligibleOn`. That is
 * only safe if, for daily and weekly_days habits, every consumer output is
 * byte-for-byte what it was before. `EXPECTED_AT_FC6DDFF` below is NOT
 * hand-written: it is `a7Outputs(A7_HABITS, A7_LOGS)` serialised by running
 * it against HEAD fc6ddff, before the swap, and pasted verbatim.
 *
 * Covers habitAveragePercent, summarizeHabitProgress, scheduledCompletionRate,
 * habitCompletionRate, weekdayBreakdown, currentStreak, longestStreak and
 * carriesDayLoad (28-day mask) for: daily, Mon/Wed/Fri, a negative habit born
 * mid-window, and a Tue/Thu habit with a dated end condition.
 */
import { A7_HABITS, A7_LOGS, a7Outputs } from '../helpers/a7DayBasedFixture';

const EXPECTED_AT_FC6DDFF = {
  "habitAveragePercent": 77,
  "summarizeHabitProgress": [
    {
      "id": "neg",
      "percent": 95,
      "completedDays": 21,
      "possibleDays": 22
    },
    {
      "id": "daily",
      "percent": 74,
      "completedDays": 20,
      "possibleDays": 27
    },
    {
      "id": "mwf",
      "percent": 68,
      "completedDays": 9,
      "possibleDays": 11
    },
    {
      "id": "tt",
      "percent": 67,
      "completedDays": 4,
      "possibleDays": 6
    }
  ],
  "weekdayBreakdown": [
    {
      "weekday": 0,
      "scheduled": 11,
      "completed": 9,
      "rate": 0.8181818181818182
    },
    {
      "weekday": 1,
      "scheduled": 10,
      "completed": 8,
      "rate": 0.8
    },
    {
      "weekday": 2,
      "scheduled": 11,
      "completed": 10,
      "rate": 0.9090909090909091
    },
    {
      "weekday": 3,
      "scheduled": 10,
      "completed": 7,
      "rate": 0.7
    },
    {
      "weekday": 4,
      "scheduled": 12,
      "completed": 9,
      "rate": 0.75
    },
    {
      "weekday": 5,
      "scheduled": 8,
      "completed": 6,
      "rate": 0.75
    },
    {
      "weekday": 6,
      "scheduled": 8,
      "completed": 5,
      "rate": 0.625
    }
  ],
  "per": {
    "daily": {
      "scheduledCompletionRate": {
        "rate": 0.7407407407407407,
        "dueDays": 27,
        "doneDays": 20
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 0.7407407407407407
      },
      "currentStreak": 0,
      "longestStreak": 3,
      "carriesDayLoad": "1111111111111111111111111111"
    },
    "mwf": {
      "scheduledCompletionRate": {
        "rate": 0.5454545454545454,
        "dueDays": 11,
        "doneDays": 6
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 0.8181818181818182
      },
      "currentStreak": 4,
      "longestStreak": 4,
      "carriesDayLoad": "1010100101010010101001010100"
    },
    "neg": {
      "scheduledCompletionRate": {
        "rate": 0.9545454545454546,
        "dueDays": 22,
        "doneDays": 21
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 0.8076923076923077
      },
      "currentStreak": 3,
      "longestStreak": 5,
      "carriesDayLoad": "0011111111111111111111111111"
    },
    "tt": {
      "scheduledCompletionRate": {
        "rate": 0.6666666666666666,
        "dueDays": 6,
        "doneDays": 4
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 0.6666666666666666
      },
      "currentStreak": 1,
      "longestStreak": 2,
      "carriesDayLoad": "0101000010100001010000000000"
    }
  }
};

describe('R01.02-c A7 — day-based consumer outputs are unchanged from fc6ddff', () => {
  const now = a7Outputs(A7_HABITS, A7_LOGS);

  it('habitAveragePercent', () => {
    expect(now.habitAveragePercent).toBe(EXPECTED_AT_FC6DDFF.habitAveragePercent);
  });

  it('summarizeHabitProgress', () => {
    expect(now.summarizeHabitProgress).toEqual(EXPECTED_AT_FC6DDFF.summarizeHabitProgress);
  });

  it('weekdayBreakdown', () => {
    expect(now.weekdayBreakdown).toEqual(EXPECTED_AT_FC6DDFF.weekdayBreakdown);
  });

  for (const id of Object.keys(EXPECTED_AT_FC6DDFF.per) as (keyof typeof EXPECTED_AT_FC6DDFF.per)[]) {
    it(`${id}: completion rates, streaks and day-load mask`, () => {
      expect(now.per[id]).toEqual(EXPECTED_AT_FC6DDFF.per[id]);
    });
  }

  it('the fixture really is day-based only (no interval_days / range keys)', () => {
    for (const h of A7_HABITS) {
      const fc = h.frequency_config as Record<string, unknown>;
      expect(fc.interval_days).toBeUndefined();
      expect(fc.range_start).toBeUndefined();
      expect(fc.range_end).toBeUndefined();
      expect(fc.count).toBeUndefined();
    }
  });
});
