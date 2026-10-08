/**
 * R09.04 — "Bu hafta yorgunum" -> an editable plan to lighten the REST OF THIS
 * WEEK, built from the user's own habits and the capacity engine's own load.
 *
 * - Load is `habitLoadPoints` (difficulty × frequency × duration, the same
 *   number every capacity gate uses) for each day left in the week on which
 *   the habit is alive (date range). So the plan differs per user and per
 *   week: no generic list.
 * - The heaviest habits are suggested first until the remaining load drops by
 *   `LIGHTEN_SHARE`. The user edits the selection; nothing is pre-applied.
 * - A habit already resting on any day left this week is left out: its week
 *   is already lighter, and a second pause would overlap the first.
 * - The ONLY command is a dated pause from today to Sunday. Goals and
 *   schedules are never changed; the pause ends by itself.
 *
 * Pure.
 */
import type { Habit } from './supabase';
import { habitLoadPoints } from './capacity';
import { isWithinRange } from './habitSchedule';
import { isPausedOn, type PauseInterval } from './habitPauses';
import { addDaysLocal, startOfWeekLocal, ymd } from './date';

/** The share of the week's remaining load the suggestion aims to take off. A dial, not a measurement. */
export const LIGHTEN_SHARE = 1 / 3;

export type WeekLightenHabit = Pick<Habit, 'id' | 'name' | 'status' | 'difficulty' | 'estimated_minutes' | 'frequency_config' | 'impact_level'> & {
  pause_intervals?: readonly PauseInterval[];
};

export type WeekLightenRow = { id: string; name: string; daysLeft: number; points: number; suggested: boolean };

export type WeekLightenPlan = {
  /** Today and the week's Sunday, local `YYYY-MM-DD`: the pause interval. */
  from: string;
  until: string;
  /** Load points of the rest of the week, over the candidate habits. */
  total: number;
  rows: WeekLightenRow[];
};

const round1 = (n: number) => Math.round(n * 10) / 10;

export function weekLightenPlan(habits: readonly WeekLightenHabit[], today: Date): WeekLightenPlan {
  const start = addDaysLocal(today, 0);
  const end = addDaysLocal(startOfWeekLocal(today), 6);
  const days: Date[] = [];
  for (let d = start; d <= end; d = addDaysLocal(d, 1)) days.push(d);

  const rows: WeekLightenRow[] = habits
    .filter((h) => h.status === 'active')
    .filter((h) => !days.some((d) => isPausedOn(h, d)))
    .map((h) => {
      const daysLeft = days.filter((d) => isWithinRange(h, d)).length;
      return { id: h.id, name: h.name, daysLeft, points: round1(habitLoadPoints(h) * daysLeft), suggested: false };
    })
    .filter((r) => r.daysLeft > 0 && r.points > 0)
    .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name, 'tr'));

  const total = round1(rows.reduce((s, r) => s + r.points, 0));
  let removed = 0;
  for (const r of rows) {
    if (removed >= total * LIGHTEN_SHARE) break;
    r.suggested = true;
    removed += r.points;
  }
  return { from: ymd(start), until: ymd(end), total, rows };
}

/** The rest-of-week load left if the habits in `paused` rest. */
export function loadAfter(plan: WeekLightenPlan, paused: ReadonlySet<string>): number {
  return round1(plan.rows.filter((r) => !paused.has(r.id)).reduce((s, r) => s + r.points, 0));
}
