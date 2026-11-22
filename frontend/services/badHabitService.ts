/**
 * Quit tracking, and what abstaining has saved.  (plan §8)
 *
 * The service exists for the arithmetic, not for the CRUD. `GET
 * /bad-habits/{id}/savings` on the retired FastAPI service computed it
 * server-side from a row anyone could read; it is derived from two numbers
 * and a date, so it belongs somewhere it can be tested without a database.
 *
 * ## The legacy formula, and the two ways it went wrong
 *
 *     days_since_quit = (utcnow() - quit_date).days
 *     money_saved     = days_since_quit * cost_per_day
 *
 * Python's `timedelta.days` floors toward negative infinity, so a quit date
 * in the future produced a NEGATIVE day count and a negative saving — the
 * report told a user who had scheduled a quit for next week that they had
 * lost money by not having started. Nothing clamped it on the way to the UI
 * either. `daysSinceQuit` floors at zero instead: before the date arrives
 * there is no elapsed time to price, which is a real answer rather than a
 * sign error.
 *
 * Whole days are kept deliberately. The inputs are "per day" rates, so
 * crediting a fraction of a day claims a precision the user never gave.
 */
import {
  fetchBadHabitsPage,
  insertBadHabit,
  type BadHabitRow,
} from '../repositories/badHabitRepository';
import type { Cursor } from '../repositories/shared';

export type Savings = {
  daysSinceQuit: number;
  moneySaved: number;
  timeSavedMinutes: number;
  timeSavedHours: number;
};

const MS_PER_DAY = 86_400_000;

/**
 * Whole days elapsed since the quit date, never negative.
 *
 * A future quit date means the attempt has not started, which is zero days,
 * not a debt. An unparseable or absent date is also zero — a report that
 * silently reads NaN is worse than one that reads nothing.
 */
export function daysSinceQuit(quitDate: string, now: Date = new Date()): number {
  const started = new Date(quitDate).getTime();
  if (!Number.isFinite(started)) return 0;
  const elapsed = now.getTime() - started;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;
  return Math.floor(elapsed / MS_PER_DAY);
}

export function savingsFor(
  habit: Pick<BadHabitRow, 'quit_date' | 'cost_per_day' | 'time_wasted_per_day'>,
  now: Date = new Date(),
): Savings {
  const days = daysSinceQuit(habit.quit_date, now);
  // The column is numeric(12,2); PostgREST can hand a numeric back as a
  // string, and `'12.50' * 3` is 37.5 in JS but `'12.50' + 3` is '12.503'.
  // Coercing once here keeps every caller off that edge.
  const cost = Number(habit.cost_per_day) || 0;
  const minutes = Number(habit.time_wasted_per_day) || 0;
  const timeSavedMinutes = days * minutes;
  return {
    daysSinceQuit: days,
    moneySaved: Math.round(days * cost * 100) / 100,
    timeSavedMinutes,
    timeSavedHours: Math.round((timeSavedMinutes / 60) * 10) / 10,
  };
}

export const listBadHabits = (cursor?: Cursor | null, limit?: number) =>
  fetchBadHabitsPage(cursor, limit);

export const createBadHabit = (input: Parameters<typeof insertBadHabit>[0]) =>
  insertBadHabit(input);
