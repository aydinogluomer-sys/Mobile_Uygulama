/**
 * The recovery backlog: past DUE days that were missed or only partly done.
 * (R01.07 — moved out of `app/screens/recovery.tsx` so the same date fixtures
 * that pin Today, reports, capacity and the reminder planner pin this too.)
 *
 * Pure: the clock is a parameter (`today`), never `new Date()`. Days are
 * walked back with `addDaysLocal` and keyed with `ymd` -- the local-day
 * contract of `lib/date.ts` -- so a DST night or a month end is one day here
 * exactly as it is everywhere else.
 */
import type { Habit } from './supabase';
import { addDaysLocal, ymd } from './date';
import { isCountBasedSchedule, isEligibleOn, isMissedOn } from './habitSchedule';

export const RECOVERY_LOOKBACK = 14;

export type BacklogEntry = { habit: Habit; date: string; kind: 'missed' | 'partial' };

export type BacklogInput = {
  habits: readonly Habit[];
  /** today, local; TODAY itself is never in the backlog (it is still "waiting"). */
  today: Date;
  /** `${habitId}|${YYYY-MM-DD}` keys. */
  doneSet: ReadonlySet<string>;
  partialSet: ReadonlySet<string>;
  missedSet: ReadonlySet<string>;
  /** days that already have a make-up plan (`source_date`). */
  plannedKeys?: ReadonlySet<string>;
  lookback?: number;
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Past due days with no completion, newest first. Unlogged days of a NEGATIVE
 * habit are unknown, not missed (`isMissedOn`); a logged failure still counts.
 */
export function recoveryBacklog(p: BacklogInput): BacklogEntry[] {
  const lookback = p.lookback ?? RECOVERY_LOOKBACK;
  const base = startOfDay(p.today);
  const out: BacklogEntry[] = [];
  for (const h of p.habits) {
    if (h.status !== 'active') continue;
    // R01.02-b -- a count schedule ("3 a week") has NO per-day obligation, so it
    // has no missed day either; its unit is a closed unmet PERIOD.
    if (isCountBasedSchedule(h)) continue;
    for (let k = 1; k <= lookback; k++) {
      const dObj = addDaysLocal(base, -k);
      // R01.02-c — day lane: `isEligibleOn` sees every_n_days, month days, yearly dates and the date envelope.
      if (!isEligibleOn(h, dObj)) continue;
      const d = ymd(dObj);
      const key = `${h.id}|${d}`;
      if (p.doneSet.has(key)) continue;
      if (p.plannedKeys?.has(key)) continue;
      const isPartial = p.partialSet.has(key);
      if (!isPartial && !isMissedOn(h, p.missedSet.has(key) ? { state: 'miss' } : undefined)) continue;
      out.push({ habit: h, date: d, kind: isPartial ? 'partial' : 'missed' });
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}

/** Consecutive missed DUE days back from yesterday; a done/partial day ends the run. */
export function consecutiveMissedDue(
  h: Habit,
  p: Pick<BacklogInput, 'today' | 'doneSet' | 'partialSet' | 'lookback'>,
): number {
  // Undefined for a count schedule -- 0 means "no day-level run", not "doing fine".
  if (isCountBasedSchedule(h)) return 0;
  const lookback = p.lookback ?? RECOVERY_LOOKBACK;
  const base = startOfDay(p.today);
  let run = 0;
  for (let k = 1; k <= lookback; k++) {
    const dObj = addDaysLocal(base, -k);
    // R01.02-c — day lane, same predicate as the backlog walk.
    if (!isEligibleOn(h, dObj)) continue;
    const key = `${h.id}|${ymd(dObj)}`;
    if (p.doneSet.has(key) || p.partialSet.has(key)) break;
    run++;
  }
  return run;
}
