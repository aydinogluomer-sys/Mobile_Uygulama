/**
 * R01.02-c A7 — a fixed day-based fixture and every consumer output the card
 * names, in one deterministic object.
 *
 * The expected values in `daySchedulePreservation.test.ts` were produced by
 * running `a7Outputs` against HEAD `fc6ddff`, BEFORE any `isDueOn` ->
 * `isEligibleOn` swap. The swap is only behaviour-neutral for `daily` and
 * `weekly_days` if those numbers survive it unchanged.
 *
 * Window: Mon 2026-08-03 .. Sun 2026-08-30 (four ISO weeks).
 */
import type { Habit, HabitLog } from '../../lib/supabase';
import { addDaysLocal, parseLocalDate, ymd } from '../../lib/date';
import { carriesDayLoad, scheduledCompletionRate } from '../../lib/habitSchedule';
import { habitAveragePercent, summarizeHabitProgress } from '../../lib/reportMetrics';
import {
  currentStreak, habitCompletionRate, longestStreak, weekdayBreakdown,
} from '../../lib/behaviorIntelligence';

export const A7_START = '2026-08-03';
export const A7_END = '2026-08-30';

function habit(over: Partial<Habit>): Habit {
  return {
    user_id: 'u1',
    name: over.id ?? 'h',
    behavior_type: 'positive',
    status: 'active',
    tracking_type: 'boolean',
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    created_at: '2026-07-01T09:00:00',
    end_condition: null,
    color: null,
    ...over,
  } as Habit;
}

export const A7_HABITS: Habit[] = [
  habit({ id: 'daily' }),
  habit({ id: 'mwf', frequency_config: { kind: 'weekly', days: [0, 2, 4] } }),
  // born mid-window, negative: unlogged days are unknown, not zero
  habit({ id: 'neg', behavior_type: 'negative', created_at: '2026-08-05T09:00:00' }),
  // Tue/Thu, ends 2026-08-20
  habit({
    id: 'tt',
    frequency_config: { kind: 'weekly', days: [1, 3] },
    end_condition: { kind: 'date', value: '2026-08-20' },
  } as Partial<Habit>),
];

type Log = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;

function stateFor(id: string, i: number): HabitLog['state'] | null {
  switch (id) {
    case 'daily': if (i === 10) return 'skip'; return i % 4 === 3 ? 'miss' : 'done';
    case 'mwf':   if (i === 16) return 'skip'; if (i >= 7 && i < 14) return 'partial'; return i % 5 === 4 ? null : 'done';
    case 'neg':   if (i % 6 === 0) return null; return i === 13 ? 'miss' : 'done';
    case 'tt':    return i % 3 === 0 ? 'miss' : 'done';
    default:      return null;
  }
}

/** One row per (habit, day) at most; days the habit is not scheduled are logged too, on purpose. */
export const A7_LOGS: Log[] = (() => {
  const start = parseLocalDate(A7_START)!;
  const out: Log[] = [];
  for (let i = 0; i < 28; i++) {
    const d = ymd(addDaysLocal(start, i));
    for (const h of A7_HABITS) {
      const st = stateFor(h.id, i);
      if (st) out.push({ habit_id: h.id, completed_at: d, state: st, value: null });
    }
  }
  return out;
})();

export function a7Outputs(habits: Habit[], logs: Log[]) {
  const start = parseLocalDate(A7_START)!;
  const end = parseLocalDate(A7_END)!;
  const days = Array.from({ length: 28 }, (_, i) => addDaysLocal(start, i));
  const range = { start: A7_START, end: A7_END };
  const per = Object.fromEntries(habits.map((h) => {
    const own = logs.filter((l) => l.habit_id === h.id);
    return [h.id, {
      scheduledCompletionRate: scheduledCompletionRate(h, own, { from: start, to: end }),
      habitCompletionRate: habitCompletionRate(h, own, range),
      currentStreak: currentStreak(h, own, end),
      longestStreak: longestStreak(h, own, { since: start, asOf: end }),
      carriesDayLoad: days.map((d) => (carriesDayLoad(h, own, d) ? '1' : '0')).join(''),
    }];
  }));
  return {
    habitAveragePercent: habitAveragePercent({ habits, logs, start: A7_START, end: A7_END }),
    summarizeHabitProgress: summarizeHabitProgress(habits, logs, A7_START, A7_END)
      .map((r) => ({ id: r.id, percent: r.percent, completedDays: r.completedDays, possibleDays: r.possibleDays })),
    weekdayBreakdown: weekdayBreakdown(habits, logs, range),
    per,
  };
}
