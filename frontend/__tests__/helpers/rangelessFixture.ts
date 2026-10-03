/**
 * R01.02-d1 A7 — every schedule shape WITHOUT a date range, through every
 * consumer the card names, in one deterministic object.
 *
 * The expected values in `rangelessPreservation.test.ts` were produced by
 * running `rangelessOutputs` against HEAD `3524e26`, BEFORE the range moved
 * from a schedule shape into the lifetime envelope. Moving it is neutral for
 * range-less habits only if these numbers survive unchanged.
 *
 * Window: Mon 2026-07-27 .. Sun 2026-09-06 (six ISO weeks, crosses two month
 * boundaries so monthly periods open and close inside it). Dates are reported
 * as local `YYYY-MM-DD`, never ISO instants, so the JSON is timezone-stable.
 */
import type { Habit, HabitLog } from '../../lib/supabase';
import { addDaysLocal, parseLocalDate, ymd } from '../../lib/date';
import {
  isDueOn, isEligibleOn, carriesDayLoad, scheduledCompletionRate, periodStatus, streakBroken, scheduleKind,
} from '../../lib/habitSchedule';
import { habitAveragePercent, summarizeHabitProgress } from '../../lib/reportMetrics';
import {
  currentStreak, habitCompletionRate, longestStreak, weekdayBreakdown,
} from '../../lib/behaviorIntelligence';

export const RL_START = '2026-07-27';
export const RL_END = '2026-09-06';
const DAYS = 42;

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

export const RL_HABITS: Habit[] = [
  habit({ id: 'daily' }),
  habit({ id: 'mwf', frequency_config: { kind: 'weekly', days: [0, 2, 4] } }),
  habit({ id: 'w3', frequency_config: { kind: 'weekly', count: 3 } }),
  habit({ id: 'm10', frequency_config: { kind: 'monthly', count: 10 } }),
  habit({ id: 'n3', created_at: '2026-07-28T09:00:00', frequency_config: { kind: 'daily', interval_days: 3 } }),
  // malformed weekly (neither days nor count) and a dated end on a day shape
  habit({ id: 'wbad', frequency_config: { kind: 'weekly' } }),
  habit({
    id: 'tt-end',
    frequency_config: { kind: 'weekly', days: [1, 3] },
    end_condition: { kind: 'date', value: '2026-08-20' },
  } as Partial<Habit>),
  // negative, born mid-window
  habit({ id: 'neg', behavior_type: 'negative', created_at: '2026-08-05T09:00:00' }),
];

type Log = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;

function stateFor(id: string, i: number): HabitLog['state'] | null {
  switch (id) {
    case 'daily':  if (i === 10) return 'skip'; return i % 4 === 3 ? 'miss' : 'done';
    case 'mwf':    if (i === 16) return 'skip'; if (i >= 7 && i < 14) return 'partial'; return i % 5 === 4 ? null : 'done';
    case 'w3':     return [1, 3, 6, 8, 9, 15, 22, 23, 24, 25, 33, 40].includes(i) ? 'done' : null;
    case 'm10':    return i % 3 === 0 ? 'done' : i === 20 ? 'miss' : null;
    case 'n3':     return i % 3 === 1 ? (i === 13 ? 'miss' : 'done') : (i === 5 ? 'done' : null);
    case 'wbad':   return i % 7 === 2 ? 'done' : null;
    case 'tt-end': return i % 3 === 0 ? 'miss' : 'done';
    case 'neg':    if (i % 6 === 0) return null; return i === 13 ? 'miss' : 'done';
    default:       return null;
  }
}

export const RL_LOGS: Log[] = (() => {
  const start = parseLocalDate(RL_START)!;
  const out: Log[] = [];
  for (let i = 0; i < DAYS; i++) {
    const d = ymd(addDaysLocal(start, i));
    for (const h of RL_HABITS) {
      const st = stateFor(h.id, i);
      if (st) out.push({ habit_id: h.id, completed_at: d, state: st, value: null });
    }
  }
  return out;
})();

const bits = (xs: boolean[]) => xs.map((b) => (b ? '1' : '0')).join('');

export function rangelessOutputs(habits: Habit[], logs: Log[]) {
  const start = parseLocalDate(RL_START)!;
  const end = parseLocalDate(RL_END)!;
  const days = Array.from({ length: DAYS }, (_, i) => addDaysLocal(start, i));
  const range = { start: RL_START, end: RL_END };
  const asOf = parseLocalDate('2026-08-26')!; // mid-window: some periods open, some closed
  const per = Object.fromEntries(habits.map((h) => {
    const own = logs.filter((l) => l.habit_id === h.id);
    return [h.id, {
      kind: scheduleKind(h).kind,
      isDueOn: bits(days.map((d) => isDueOn(h, d))),
      isEligibleOn: bits(days.map((d) => isEligibleOn(h, d))),
      carriesDayLoad: bits(days.map((d) => carriesDayLoad(h, own, d))),
      streakBroken: bits(days.map((d) => streakBroken(h, own, d))),
      periodStatus: days.map((d) => {
        const s = periodStatus(h, own, d, { asOf });
        return [ymd(s.periodStart), ymd(s.periodEnd), s.unit, s.target, s.counted, s.actual, s.remaining, s.status, s.reason].join('|');
      }),
      scheduledCompletionRate: scheduledCompletionRate(h, own, { from: start, to: end }),
      scheduledCompletionRateSince: scheduledCompletionRate(h, own, { from: start, to: end, since: parseLocalDate('2026-08-10') }),
      habitCompletionRate: habitCompletionRate(h, own, range),
      currentStreak: currentStreak(h, own, asOf),
      longestStreak: longestStreak(h, own, { since: start, asOf: end }),
    }];
  }));
  return {
    habitAveragePercent: habitAveragePercent({ habits, logs, start: RL_START, end: RL_END }),
    summarizeHabitProgress: summarizeHabitProgress(habits, logs, RL_START, RL_END)
      .map((r) => ({ id: r.id, percent: r.percent, completedDays: r.completedDays, possibleDays: r.possibleDays })),
    weekdayBreakdown: weekdayBreakdown(habits, logs, range),
    per,
  };
}
