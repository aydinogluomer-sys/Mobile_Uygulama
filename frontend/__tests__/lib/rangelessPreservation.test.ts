/**
 * R01.02-d1 A7 — NO REGRESSION for habits WITHOUT a date range.
 *
 * The card moves the range from a schedule shape into the lifetime envelope.
 * That is only acceptable if nothing without a range moves. `EXPECTED_AT_3524E26`
 * is NOT hand-written: it is `rangelessOutputs(RL_HABITS, RL_LOGS)` serialised by
 * running it against HEAD 3524e26, before any edit to lib/, and pasted verbatim.
 *
 * 8 habits -- daily, weekly_days, weekly_count, monthly_count, every_n_days, a
 * malformed weekly row, a dated end, a negative habit born mid-window -- through
 * isDueOn, isEligibleOn, carriesDayLoad, streakBroken (42-day masks), periodStatus
 * (every day, asOf mid-window), scheduledCompletionRate (with and without since),
 * habitCompletionRate, currentStreak, longestStreak, scheduleKind, plus
 * habitAveragePercent, summarizeHabitProgress and weekdayBreakdown.
 */
import { RL_HABITS, RL_LOGS, rangelessOutputs } from '../helpers/rangelessFixture';

const EXPECTED_AT_3524E26 = {
  "habitAveragePercent": 80,
  "summarizeHabitProgress": [
    {
      "id": "m10",
      "percent": 100,
      "completedDays": 14,
      "possibleDays": 14
    },
    {
      "id": "neg",
      "percent": 96,
      "completedDays": 27,
      "possibleDays": 28
    },
    {
      "id": "n3",
      "percent": 93,
      "completedDays": 13,
      "possibleDays": 14
    },
    {
      "id": "daily",
      "percent": 76,
      "completedDays": 31,
      "possibleDays": 41
    },
    {
      "id": "mwf",
      "percent": 74,
      "completedDays": 14,
      "possibleDays": 17
    },
    {
      "id": "tt-end",
      "percent": 63,
      "completedDays": 5,
      "possibleDays": 8
    },
    {
      "id": "w3",
      "percent": 61,
      "completedDays": 11,
      "possibleDays": 18
    },
    {
      "id": "wbad",
      "percent": 0,
      "completedDays": 0,
      "possibleDays": 0
    }
  ],
  "weekdayBreakdown": [
    {
      "weekday": 0,
      "scheduled": 18,
      "completed": 15,
      "rate": 0.8333333333333334
    },
    {
      "weekday": 1,
      "scheduled": 16,
      "completed": 13,
      "rate": 0.8125
    },
    {
      "weekday": 2,
      "scheduled": 18,
      "completed": 16,
      "rate": 0.8888888888888888
    },
    {
      "weekday": 3,
      "scheduled": 16,
      "completed": 11,
      "rate": 0.6875
    },
    {
      "weekday": 4,
      "scheduled": 19,
      "completed": 14,
      "rate": 0.7368421052631579
    },
    {
      "weekday": 5,
      "scheduled": 13,
      "completed": 11,
      "rate": 0.8461538461538461
    },
    {
      "weekday": 6,
      "scheduled": 13,
      "completed": 10,
      "rate": 0.7692307692307693
    }
  ],
  "per": {
    "daily": {
      "kind": "daily",
      "isDueOn": "111111111111111111111111111111111111111111",
      "isEligibleOn": "111111111111111111111111111111111111111111",
      "carriesDayLoad": "111111111111111111111111111111111111111111",
      "streakBroken": "000100010001000100010001000100010001000100",
      "periodStatus": [
        "2026-07-27|2026-07-27|days|1|1|1|0|satisfied|ok",
        "2026-07-28|2026-07-28|days|1|1|1|0|satisfied|ok",
        "2026-07-29|2026-07-29|days|1|1|1|0|satisfied|ok",
        "2026-07-30|2026-07-30|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-07-31|2026-07-31|days|1|1|1|0|satisfied|ok",
        "2026-08-01|2026-08-01|days|1|1|1|0|satisfied|ok",
        "2026-08-02|2026-08-02|days|1|1|1|0|satisfied|ok",
        "2026-08-03|2026-08-03|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-04|2026-08-04|days|1|1|1|0|satisfied|ok",
        "2026-08-05|2026-08-05|days|1|1|1|0|satisfied|ok",
        "2026-08-06|2026-08-06|days|0|0|0|0|unknown|skipped",
        "2026-08-07|2026-08-07|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-08|2026-08-08|days|1|1|1|0|satisfied|ok",
        "2026-08-09|2026-08-09|days|1|1|1|0|satisfied|ok",
        "2026-08-10|2026-08-10|days|1|1|1|0|satisfied|ok",
        "2026-08-11|2026-08-11|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-12|2026-08-12|days|1|1|1|0|satisfied|ok",
        "2026-08-13|2026-08-13|days|1|1|1|0|satisfied|ok",
        "2026-08-14|2026-08-14|days|1|1|1|0|satisfied|ok",
        "2026-08-15|2026-08-15|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-16|2026-08-16|days|1|1|1|0|satisfied|ok",
        "2026-08-17|2026-08-17|days|1|1|1|0|satisfied|ok",
        "2026-08-18|2026-08-18|days|1|1|1|0|satisfied|ok",
        "2026-08-19|2026-08-19|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-20|2026-08-20|days|1|1|1|0|satisfied|ok",
        "2026-08-21|2026-08-21|days|1|1|1|0|satisfied|ok",
        "2026-08-22|2026-08-22|days|1|1|1|0|satisfied|ok",
        "2026-08-23|2026-08-23|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-24|2026-08-24|days|1|1|1|0|satisfied|ok",
        "2026-08-25|2026-08-25|days|1|1|1|0|satisfied|ok",
        "2026-08-26|2026-08-26|days|1|1|1|0|satisfied|ok",
        "2026-08-27|2026-08-27|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-28|2026-08-28|days|1|1|1|0|satisfied|ok",
        "2026-08-29|2026-08-29|days|1|1|1|0|satisfied|ok",
        "2026-08-30|2026-08-30|days|1|1|1|0|satisfied|ok",
        "2026-08-31|2026-08-31|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-09-01|2026-09-01|days|1|1|1|0|satisfied|ok",
        "2026-09-02|2026-09-02|days|1|1|1|0|satisfied|ok",
        "2026-09-03|2026-09-03|days|1|1|1|0|satisfied|ok",
        "2026-09-04|2026-09-04|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-09-05|2026-09-05|days|1|1|1|0|satisfied|ok",
        "2026-09-06|2026-09-06|days|1|1|1|0|satisfied|ok"
      ],
      "scheduledCompletionRate": {
        "rate": 0.7560975609756098,
        "dueDays": 41,
        "doneDays": 31
      },
      "scheduledCompletionRateSince": {
        "rate": 0.75,
        "dueDays": 28,
        "doneDays": 21
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 0.7560975609756098
      },
      "currentStreak": 3,
      "longestStreak": 3
    },
    "mwf": {
      "kind": "weekly_days",
      "isDueOn": "101010010101001010100101010010101001010100",
      "isEligibleOn": "101010010101001010100101010010101001010100",
      "carriesDayLoad": "101010010101001010100101010010101001010100",
      "streakBroken": "000010000000001000000000000000000000000100",
      "periodStatus": [
        "2026-07-27|2026-07-27|days|1|1|1|0|satisfied|ok",
        "2026-07-28|2026-07-28|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-29|2026-07-29|days|1|1|1|0|satisfied|ok",
        "2026-07-30|2026-07-30|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-31|2026-07-31|days|1|0|0|1|closed_unmet|ok",
        "2026-08-01|2026-08-01|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-02|2026-08-02|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-03|2026-08-03|days|1|1|1|0|satisfied|ok",
        "2026-08-04|2026-08-04|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-05|2026-08-05|days|1|1|1|0|satisfied|ok",
        "2026-08-06|2026-08-06|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-07|2026-08-07|days|1|1|1|0|satisfied|ok",
        "2026-08-08|2026-08-08|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-09|2026-08-09|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-10|2026-08-10|days|1|0|0|1|closed_unmet|ok",
        "2026-08-11|2026-08-11|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-12|2026-08-12|days|0|0|0|0|unknown|skipped",
        "2026-08-13|2026-08-13|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-14|2026-08-14|days|1|1|1|0|satisfied|ok",
        "2026-08-15|2026-08-15|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-16|2026-08-16|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-17|2026-08-17|days|1|1|1|0|satisfied|ok",
        "2026-08-18|2026-08-18|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-19|2026-08-19|days|1|1|1|0|satisfied|ok",
        "2026-08-20|2026-08-20|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-21|2026-08-21|days|1|1|1|0|satisfied|ok",
        "2026-08-22|2026-08-22|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-23|2026-08-23|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-24|2026-08-24|days|1|1|1|0|satisfied|ok",
        "2026-08-25|2026-08-25|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-26|2026-08-26|days|1|1|1|0|satisfied|ok",
        "2026-08-27|2026-08-27|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-28|2026-08-28|days|1|1|1|0|satisfied|ok",
        "2026-08-29|2026-08-29|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-30|2026-08-30|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-31|2026-08-31|days|1|1|1|0|satisfied|ok",
        "2026-09-01|2026-09-01|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-02|2026-09-02|days|1|1|1|0|satisfied|ok",
        "2026-09-03|2026-09-03|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-04|2026-09-04|days|1|0|0|1|not_started|period_not_started",
        "2026-09-05|2026-09-05|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-06|2026-09-06|days|0|0|0|0|unknown|not_scheduled"
      ],
      "scheduledCompletionRate": {
        "rate": 0.6470588235294118,
        "dueDays": 17,
        "doneDays": 11
      },
      "scheduledCompletionRateSince": {
        "rate": 0.8181818181818182,
        "dueDays": 11,
        "doneDays": 9
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 0.8235294117647058
      },
      "currentStreak": 6,
      "longestStreak": 9
    },
    "w3": {
      "kind": "weekly_count",
      "isDueOn": "101001010100101010010101001010100101010010",
      "isEligibleOn": "111111111111111111111111111111111111111111",
      "carriesDayLoad": "111111111111111111111111100011111111111111",
      "streakBroken": "000000000000000000001000000000000010000001",
      "periodStatus": [
        "2026-07-27|2026-08-02|days|3|3|3|0|satisfied|ok",
        "2026-07-27|2026-08-02|days|3|3|3|0|satisfied|ok",
        "2026-07-27|2026-08-02|days|3|3|3|0|satisfied|ok",
        "2026-07-27|2026-08-02|days|3|3|3|0|satisfied|ok",
        "2026-07-27|2026-08-02|days|3|3|3|0|satisfied|ok",
        "2026-07-27|2026-08-02|days|3|3|3|0|satisfied|ok",
        "2026-07-27|2026-08-02|days|3|3|3|0|satisfied|ok",
        "2026-08-03|2026-08-09|days|3|2|2|1|closed_unmet|ok",
        "2026-08-03|2026-08-09|days|3|2|2|1|closed_unmet|ok",
        "2026-08-03|2026-08-09|days|3|2|2|1|closed_unmet|ok",
        "2026-08-03|2026-08-09|days|3|2|2|1|closed_unmet|ok",
        "2026-08-03|2026-08-09|days|3|2|2|1|closed_unmet|ok",
        "2026-08-03|2026-08-09|days|3|2|2|1|closed_unmet|ok",
        "2026-08-03|2026-08-09|days|3|2|2|1|closed_unmet|ok",
        "2026-08-10|2026-08-16|days|3|1|1|2|closed_unmet|ok",
        "2026-08-10|2026-08-16|days|3|1|1|2|closed_unmet|ok",
        "2026-08-10|2026-08-16|days|3|1|1|2|closed_unmet|ok",
        "2026-08-10|2026-08-16|days|3|1|1|2|closed_unmet|ok",
        "2026-08-10|2026-08-16|days|3|1|1|2|closed_unmet|ok",
        "2026-08-10|2026-08-16|days|3|1|1|2|closed_unmet|ok",
        "2026-08-10|2026-08-16|days|3|1|1|2|closed_unmet|ok",
        "2026-08-17|2026-08-23|days|3|4|4|0|satisfied|ok",
        "2026-08-17|2026-08-23|days|3|4|4|0|satisfied|ok",
        "2026-08-17|2026-08-23|days|3|4|4|0|satisfied|ok",
        "2026-08-17|2026-08-23|days|3|4|4|0|satisfied|ok",
        "2026-08-17|2026-08-23|days|3|4|4|0|satisfied|ok",
        "2026-08-17|2026-08-23|days|3|4|4|0|satisfied|ok",
        "2026-08-17|2026-08-23|days|3|4|4|0|satisfied|ok",
        "2026-08-24|2026-08-30|days|3|1|1|2|in_progress|ok",
        "2026-08-24|2026-08-30|days|3|1|1|2|in_progress|ok",
        "2026-08-24|2026-08-30|days|3|1|1|2|in_progress|ok",
        "2026-08-24|2026-08-30|days|3|1|1|2|in_progress|ok",
        "2026-08-24|2026-08-30|days|3|1|1|2|in_progress|ok",
        "2026-08-24|2026-08-30|days|3|1|1|2|in_progress|ok",
        "2026-08-24|2026-08-30|days|3|1|1|2|in_progress|ok",
        "2026-08-31|2026-09-06|days|3|1|1|2|not_started|period_not_started",
        "2026-08-31|2026-09-06|days|3|1|1|2|not_started|period_not_started",
        "2026-08-31|2026-09-06|days|3|1|1|2|not_started|period_not_started",
        "2026-08-31|2026-09-06|days|3|1|1|2|not_started|period_not_started",
        "2026-08-31|2026-09-06|days|3|1|1|2|not_started|period_not_started",
        "2026-08-31|2026-09-06|days|3|1|1|2|not_started|period_not_started",
        "2026-08-31|2026-09-06|days|3|1|1|2|not_started|period_not_started"
      ],
      "scheduledCompletionRate": {
        "rate": 0.6111111111111112,
        "dueDays": 18,
        "doneDays": 11
      },
      "scheduledCompletionRateSince": {
        "rate": 0.5,
        "dueDays": 12,
        "doneDays": 6
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 0.6111111111111112
      },
      "currentStreak": 1,
      "longestStreak": 1
    },
    "m10": {
      "kind": "monthly_count",
      "isDueOn": "000000000000000000000000000000000000000000",
      "isEligibleOn": "111111111111111111111111111111111111111111",
      "carriesDayLoad": "111111111111111111111111111111111100111111",
      "streakBroken": "111110000000000000000000000000000000000000",
      "periodStatus": [
        "2026-07-01|2026-07-31|days|10|2|2|8|closed_unmet|ok",
        "2026-07-01|2026-07-31|days|10|2|2|8|closed_unmet|ok",
        "2026-07-01|2026-07-31|days|10|2|2|8|closed_unmet|ok",
        "2026-07-01|2026-07-31|days|10|2|2|8|closed_unmet|ok",
        "2026-07-01|2026-07-31|days|10|2|2|8|closed_unmet|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-08-01|2026-08-31|days|10|10|10|0|satisfied|ok",
        "2026-09-01|2026-09-30|days|10|2|2|8|not_started|period_not_started",
        "2026-09-01|2026-09-30|days|10|2|2|8|not_started|period_not_started",
        "2026-09-01|2026-09-30|days|10|2|2|8|not_started|period_not_started",
        "2026-09-01|2026-09-30|days|10|2|2|8|not_started|period_not_started",
        "2026-09-01|2026-09-30|days|10|2|2|8|not_started|period_not_started",
        "2026-09-01|2026-09-30|days|10|2|2|8|not_started|period_not_started"
      ],
      "scheduledCompletionRate": {
        "rate": 1,
        "dueDays": 13.612903,
        "doneDays": 13.612903
      },
      "scheduledCompletionRateSince": {
        "rate": 0.989361723177909,
        "dueDays": 9.096774,
        "doneDays": 9
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 1
      },
      "currentStreak": 1,
      "longestStreak": 1
    },
    "n3": {
      "kind": "every_n_days",
      "isDueOn": "011111111111111111111111111111111111111111",
      "isEligibleOn": "010010010010010010010010010010010010010010",
      "carriesDayLoad": "010010010010010010010010010010010010010010",
      "streakBroken": "000000000000010000000000000000000000000000",
      "periodStatus": [
        "2026-07-27|2026-07-27|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-28|2026-07-28|days|1|1|1|0|satisfied|ok",
        "2026-07-29|2026-07-29|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-30|2026-07-30|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-31|2026-07-31|days|1|1|1|0|satisfied|ok",
        "2026-08-01|2026-08-01|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-02|2026-08-02|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-03|2026-08-03|days|1|1|1|0|satisfied|ok",
        "2026-08-04|2026-08-04|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-05|2026-08-05|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-06|2026-08-06|days|1|1|1|0|satisfied|ok",
        "2026-08-07|2026-08-07|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-08|2026-08-08|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-09|2026-08-09|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-10|2026-08-10|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-11|2026-08-11|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-12|2026-08-12|days|1|1|1|0|satisfied|ok",
        "2026-08-13|2026-08-13|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-14|2026-08-14|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-15|2026-08-15|days|1|1|1|0|satisfied|ok",
        "2026-08-16|2026-08-16|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-17|2026-08-17|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-18|2026-08-18|days|1|1|1|0|satisfied|ok",
        "2026-08-19|2026-08-19|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-20|2026-08-20|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-21|2026-08-21|days|1|1|1|0|satisfied|ok",
        "2026-08-22|2026-08-22|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-23|2026-08-23|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-24|2026-08-24|days|1|1|1|0|satisfied|ok",
        "2026-08-25|2026-08-25|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-26|2026-08-26|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-27|2026-08-27|days|1|1|1|0|satisfied|ok",
        "2026-08-28|2026-08-28|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-29|2026-08-29|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-30|2026-08-30|days|1|1|1|0|satisfied|ok",
        "2026-08-31|2026-08-31|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-01|2026-09-01|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-02|2026-09-02|days|1|1|1|0|satisfied|ok",
        "2026-09-03|2026-09-03|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-04|2026-09-04|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-05|2026-09-05|days|1|1|1|0|satisfied|ok",
        "2026-09-06|2026-09-06|days|0|0|0|0|unknown|not_scheduled"
      ],
      "scheduledCompletionRate": {
        "rate": 0.9285714285714286,
        "dueDays": 14,
        "doneDays": 13
      },
      "scheduledCompletionRateSince": {
        "rate": 1,
        "dueDays": 9,
        "doneDays": 9
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 0.9285714285714286
      },
      "currentStreak": 5,
      "longestStreak": 9
    },
    "wbad": {
      "kind": "weekly_count",
      "isDueOn": "000000000000000000000000000000000000000000",
      "isEligibleOn": "000000000000000000000000000000000000000000",
      "carriesDayLoad": "000000000000000000000000000000000000000000",
      "streakBroken": "000000000000000000000000000000000000000000",
      "periodStatus": [
        "2026-07-27|2026-08-02|days|0|0|0|0|unknown|no_target",
        "2026-07-27|2026-08-02|days|0|0|0|0|unknown|no_target",
        "2026-07-27|2026-08-02|days|0|0|0|0|unknown|no_target",
        "2026-07-27|2026-08-02|days|0|0|0|0|unknown|no_target",
        "2026-07-27|2026-08-02|days|0|0|0|0|unknown|no_target",
        "2026-07-27|2026-08-02|days|0|0|0|0|unknown|no_target",
        "2026-07-27|2026-08-02|days|0|0|0|0|unknown|no_target",
        "2026-08-03|2026-08-09|days|0|0|0|0|unknown|no_target",
        "2026-08-03|2026-08-09|days|0|0|0|0|unknown|no_target",
        "2026-08-03|2026-08-09|days|0|0|0|0|unknown|no_target",
        "2026-08-03|2026-08-09|days|0|0|0|0|unknown|no_target",
        "2026-08-03|2026-08-09|days|0|0|0|0|unknown|no_target",
        "2026-08-03|2026-08-09|days|0|0|0|0|unknown|no_target",
        "2026-08-03|2026-08-09|days|0|0|0|0|unknown|no_target",
        "2026-08-10|2026-08-16|days|0|0|0|0|unknown|no_target",
        "2026-08-10|2026-08-16|days|0|0|0|0|unknown|no_target",
        "2026-08-10|2026-08-16|days|0|0|0|0|unknown|no_target",
        "2026-08-10|2026-08-16|days|0|0|0|0|unknown|no_target",
        "2026-08-10|2026-08-16|days|0|0|0|0|unknown|no_target",
        "2026-08-10|2026-08-16|days|0|0|0|0|unknown|no_target",
        "2026-08-10|2026-08-16|days|0|0|0|0|unknown|no_target",
        "2026-08-17|2026-08-23|days|0|0|0|0|unknown|no_target",
        "2026-08-17|2026-08-23|days|0|0|0|0|unknown|no_target",
        "2026-08-17|2026-08-23|days|0|0|0|0|unknown|no_target",
        "2026-08-17|2026-08-23|days|0|0|0|0|unknown|no_target",
        "2026-08-17|2026-08-23|days|0|0|0|0|unknown|no_target",
        "2026-08-17|2026-08-23|days|0|0|0|0|unknown|no_target",
        "2026-08-17|2026-08-23|days|0|0|0|0|unknown|no_target",
        "2026-08-24|2026-08-30|days|0|0|0|0|unknown|no_target",
        "2026-08-24|2026-08-30|days|0|0|0|0|unknown|no_target",
        "2026-08-24|2026-08-30|days|0|0|0|0|unknown|no_target",
        "2026-08-24|2026-08-30|days|0|0|0|0|unknown|no_target",
        "2026-08-24|2026-08-30|days|0|0|0|0|unknown|no_target",
        "2026-08-24|2026-08-30|days|0|0|0|0|unknown|no_target",
        "2026-08-24|2026-08-30|days|0|0|0|0|unknown|no_target",
        "2026-08-31|2026-09-06|days|0|0|0|0|unknown|no_target",
        "2026-08-31|2026-09-06|days|0|0|0|0|unknown|no_target",
        "2026-08-31|2026-09-06|days|0|0|0|0|unknown|no_target",
        "2026-08-31|2026-09-06|days|0|0|0|0|unknown|no_target",
        "2026-08-31|2026-09-06|days|0|0|0|0|unknown|no_target",
        "2026-08-31|2026-09-06|days|0|0|0|0|unknown|no_target",
        "2026-08-31|2026-09-06|days|0|0|0|0|unknown|no_target"
      ],
      "scheduledCompletionRate": {
        "rate": 0,
        "dueDays": 0,
        "doneDays": 0
      },
      "scheduledCompletionRateSince": {
        "rate": 0,
        "dueDays": 0,
        "doneDays": 0
      },
      "habitCompletionRate": {
        "ok": false,
        "reason": "no scheduled (due, non-skip) days for this habit in the given range"
      },
      "currentStreak": 0,
      "longestStreak": 0
    },
    "tt-end": {
      "kind": "weekly_days",
      "isDueOn": "010100001010000101000010100000000000000000",
      "isEligibleOn": "010100001010000101000010100000000000000000",
      "carriesDayLoad": "010100001010000101000010100000000000000000",
      "streakBroken": "000100000000000100000000100000000000000000",
      "periodStatus": [
        "2026-07-27|2026-07-27|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-28|2026-07-28|days|1|1|1|0|satisfied|ok",
        "2026-07-29|2026-07-29|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-30|2026-07-30|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-07-31|2026-07-31|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-01|2026-08-01|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-02|2026-08-02|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-03|2026-08-03|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-04|2026-08-04|days|1|1|1|0|satisfied|ok",
        "2026-08-05|2026-08-05|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-06|2026-08-06|days|1|1|1|0|satisfied|ok",
        "2026-08-07|2026-08-07|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-08|2026-08-08|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-09|2026-08-09|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-10|2026-08-10|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-11|2026-08-11|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-12|2026-08-12|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-13|2026-08-13|days|1|1|1|0|satisfied|ok",
        "2026-08-14|2026-08-14|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-15|2026-08-15|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-16|2026-08-16|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-17|2026-08-17|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-18|2026-08-18|days|1|1|1|0|satisfied|ok",
        "2026-08-19|2026-08-19|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-20|2026-08-20|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-21|2026-08-21|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-22|2026-08-22|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-23|2026-08-23|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-24|2026-08-24|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-25|2026-08-25|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-26|2026-08-26|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-27|2026-08-27|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-28|2026-08-28|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-29|2026-08-29|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-30|2026-08-30|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-31|2026-08-31|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-01|2026-09-01|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-02|2026-09-02|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-03|2026-09-03|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-04|2026-09-04|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-05|2026-09-05|days|0|0|0|0|unknown|not_scheduled",
        "2026-09-06|2026-09-06|days|0|0|0|0|unknown|not_scheduled"
      ],
      "scheduledCompletionRate": {
        "rate": 0.625,
        "dueDays": 8,
        "doneDays": 5
      },
      "scheduledCompletionRateSince": {
        "rate": 0.5,
        "dueDays": 4,
        "doneDays": 2
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 0.625
      },
      "currentStreak": 0,
      "longestStreak": 2
    },
    "neg": {
      "kind": "daily",
      "isDueOn": "000000000111111111111111111111111111111111",
      "isEligibleOn": "000000000111111111111111111111111111111111",
      "carriesDayLoad": "000000000111111111111111111111111111111111",
      "streakBroken": "000000000000110000100000100000100000100000",
      "periodStatus": [
        "2026-07-27|2026-07-27|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-28|2026-07-28|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-29|2026-07-29|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-30|2026-07-30|days|0|0|0|0|unknown|not_scheduled",
        "2026-07-31|2026-07-31|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-01|2026-08-01|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-02|2026-08-02|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-03|2026-08-03|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-04|2026-08-04|days|0|0|0|0|unknown|not_scheduled",
        "2026-08-05|2026-08-05|days|1|1|1|0|satisfied|ok",
        "2026-08-06|2026-08-06|days|1|1|1|0|satisfied|ok",
        "2026-08-07|2026-08-07|days|1|1|1|0|satisfied|ok",
        "2026-08-08|2026-08-08|days|1|0|0|1|closed_unmet|ok",
        "2026-08-09|2026-08-09|days|1|0|0|1|closed_unmet|explicit_miss",
        "2026-08-10|2026-08-10|days|1|1|1|0|satisfied|ok",
        "2026-08-11|2026-08-11|days|1|1|1|0|satisfied|ok",
        "2026-08-12|2026-08-12|days|1|1|1|0|satisfied|ok",
        "2026-08-13|2026-08-13|days|1|1|1|0|satisfied|ok",
        "2026-08-14|2026-08-14|days|1|0|0|1|closed_unmet|ok",
        "2026-08-15|2026-08-15|days|1|1|1|0|satisfied|ok",
        "2026-08-16|2026-08-16|days|1|1|1|0|satisfied|ok",
        "2026-08-17|2026-08-17|days|1|1|1|0|satisfied|ok",
        "2026-08-18|2026-08-18|days|1|1|1|0|satisfied|ok",
        "2026-08-19|2026-08-19|days|1|1|1|0|satisfied|ok",
        "2026-08-20|2026-08-20|days|1|0|0|1|closed_unmet|ok",
        "2026-08-21|2026-08-21|days|1|1|1|0|satisfied|ok",
        "2026-08-22|2026-08-22|days|1|1|1|0|satisfied|ok",
        "2026-08-23|2026-08-23|days|1|1|1|0|satisfied|ok",
        "2026-08-24|2026-08-24|days|1|1|1|0|satisfied|ok",
        "2026-08-25|2026-08-25|days|1|1|1|0|satisfied|ok",
        "2026-08-26|2026-08-26|days|1|0|0|1|not_started|ok",
        "2026-08-27|2026-08-27|days|1|1|1|0|satisfied|ok",
        "2026-08-28|2026-08-28|days|1|1|1|0|satisfied|ok",
        "2026-08-29|2026-08-29|days|1|1|1|0|satisfied|ok",
        "2026-08-30|2026-08-30|days|1|1|1|0|satisfied|ok",
        "2026-08-31|2026-08-31|days|1|1|1|0|satisfied|ok",
        "2026-09-01|2026-09-01|days|1|0|0|1|not_started|period_not_started",
        "2026-09-02|2026-09-02|days|1|1|1|0|satisfied|ok",
        "2026-09-03|2026-09-03|days|1|1|1|0|satisfied|ok",
        "2026-09-04|2026-09-04|days|1|1|1|0|satisfied|ok",
        "2026-09-05|2026-09-05|days|1|1|1|0|satisfied|ok",
        "2026-09-06|2026-09-06|days|1|1|1|0|satisfied|ok"
      ],
      "scheduledCompletionRate": {
        "rate": 0.9642857142857143,
        "dueDays": 28,
        "doneDays": 27
      },
      "scheduledCompletionRateSince": {
        "rate": 1,
        "dueDays": 24,
        "doneDays": 24
      },
      "habitCompletionRate": {
        "ok": true,
        "value": 0.8181818181818182
      },
      "currentStreak": 0,
      "longestStreak": 5
    }
  }
};

describe('R01.02-d1 A7 — range-less outputs are unchanged from 3524e26', () => {
  const now = rangelessOutputs(RL_HABITS, RL_LOGS);

  it('habitAveragePercent', () => {
    expect(now.habitAveragePercent).toBe(EXPECTED_AT_3524E26.habitAveragePercent);
  });

  it('summarizeHabitProgress', () => {
    expect(now.summarizeHabitProgress).toEqual(EXPECTED_AT_3524E26.summarizeHabitProgress);
  });

  it('weekdayBreakdown', () => {
    expect(now.weekdayBreakdown).toEqual(EXPECTED_AT_3524E26.weekdayBreakdown);
  });

  for (const id of Object.keys(EXPECTED_AT_3524E26.per) as (keyof typeof EXPECTED_AT_3524E26.per)[]) {
    it(`${id}: every per-habit output`, () => {
      expect(now.per[id]).toEqual(EXPECTED_AT_3524E26.per[id]);
    });
  }

  it('the fixture really carries no date range', () => {
    for (const h of RL_HABITS) {
      const fc = h.frequency_config as Record<string, unknown>;
      expect(fc.range_start).toBeUndefined();
      expect(fc.range_end).toBeUndefined();
    }
  });

  it('the fixture covers all five shapes', () => {
    const kinds = new Set(Object.values(EXPECTED_AT_3524E26.per).map((p) => p.kind));
    expect([...kinds].sort()).toEqual(['daily', 'every_n_days', 'monthly_count', 'weekly_count', 'weekly_days']);
  });
});
