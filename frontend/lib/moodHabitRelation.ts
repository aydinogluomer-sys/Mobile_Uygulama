/**
 * R07.05 — how the user's mood looked on days they did a habit versus days
 * they did not. A description of what was recorded together, NOT a cause:
 * the card says so in its own words.
 *
 * A day counts only when BOTH are known for it:
 *   - a mood was recorded that day (journal mood 1..5), and
 *   - the habit's day has an answer: done/partial = did; an explicit miss,
 *     or no log for a positive habit on an eligible day = did not.
 *     A `skip` is excused and left out; a negative habit with no log is
 *     unknown and left out (the same rule the completion rate uses).
 * Days the habit was not eligible (schedule, break, holiday, range) are out.
 *
 * Too little data is said, not hidden behind a number: fewer than
 * `MIN_DAYS` paired days in all, or fewer than `MIN_PER_GROUP` on either
 * side, is `insufficient`.
 */
import { addDaysLocal, ymd } from './date';
import { isEligibleOn } from './habitSchedule';
import type { Habit } from './supabase';

export const MIN_DAYS = 14;
export const MIN_PER_GROUP = 5;

export type MoodDay = { date: string; mood: number | null };
export type RelationLog = { habit_id: string; completed_at: string; state: string };

export type MoodHabitRelation =
  | { ok: true; habitId: string; didMean: number; didNotMean: number; diff: number; didDays: number; didNotDays: number }
  | { ok: false; habitId: string; reason: string; didDays: number; didNotDays: number };

export function moodHabitRelation(params: {
  habit: Habit;
  logs: readonly RelationLog[];
  moods: readonly MoodDay[];
  from: Date;
  to: Date;
}): MoodHabitRelation {
  const { habit, logs, moods, from, to } = params;
  const moodBy = new Map<string, number>();
  for (const m of moods) if (typeof m.mood === 'number' && m.mood >= 1 && m.mood <= 5) moodBy.set(m.date, m.mood);
  const logBy = new Map<string, string>();
  for (const l of logs) if (l.habit_id === habit.id) logBy.set(l.completed_at.slice(0, 10), l.state);

  const did: number[] = [];
  const didNot: number[] = [];
  for (let d = from; ymd(d) <= ymd(to); d = addDaysLocal(d, 1)) {
    const day = ymd(d);
    const mood = moodBy.get(day);
    if (mood === undefined) continue;
    if (!isEligibleOn(habit, d)) continue;
    const st = logBy.get(day);
    if (st === 'skip') continue;
    if (st === 'done' || st === 'partial') did.push(mood);
    else if (st === 'miss') didNot.push(mood);
    else if (habit.behavior_type !== 'negative') didNot.push(mood);
  }

  const base = { habitId: habit.id, didDays: did.length, didNotDays: didNot.length };
  const total = did.length + didNot.length;
  if (total < MIN_DAYS) return { ok: false, ...base, reason: `Yetersiz veri: ruh hali ve alışkanlığın birlikte kayıtlı olduğu ${total} gün var, en az ${MIN_DAYS} gerekir.` };
  if (did.length < MIN_PER_GROUP || didNot.length < MIN_PER_GROUP) {
    return { ok: false, ...base, reason: `Yetersiz veri: karşılaştırma için iki tarafta da en az ${MIN_PER_GROUP} gün gerekir (${did.length} / ${didNot.length}).` };
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const didMean = mean(did), didNotMean = mean(didNot);
  return { ok: true, ...base, didMean, didNotMean, diff: didMean - didNotMean };
}

/** The card's sentence. Says "birlikte", never "because". */
export function relationSentence(name: string, r: MoodHabitRelation): string {
  if (!r.ok) return r.reason;
  const f = (x: number) => x.toFixed(1).replace('.', ',');
  return `${name} yaptığın günlerde ruh halin ortalama ${f(r.didMean)}, yapmadığın günlerde ${f(r.didNotMean)} `
    + `(${r.didDays} / ${r.didNotDays} gün). Bu yalnız birlikte görülmedir; birinin diğerine yol açtığını göstermez.`;
}
