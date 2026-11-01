/**
 * R01.05 — skip, pause and holiday are three different things, and a goal
 * change takes effect from a date instead of rewriting the past.
 *
 * ## Three ways to not do a habit
 *
 *   skip     ONE day, one habit, logged (`habit_logs.state = 'skip'`).
 *            Out of both sides of the rate, transparent to the streak, 0 XP.
 *            The habit is still on; the day is excused.
 *   pause    A DATE RANGE for one habit (`habit_pauses`, habit_id set). The
 *            habit is not due on those days at all: not in the denominator,
 *            the streak bridges over them, no reminders, a count target
 *            ("3 a week") shrinks with the days it loses.
 *   holiday  A DATE RANGE for EVERY habit (`habit_pauses`, habit_id null).
 *            Same effect as a pause, applied to all of them at once.
 *
 * The legacy `habits.status = 'paused'` is a fourth, older thing: undated and
 * whole-habit, so it also hides the habit's PAST periods. It is read as it
 * always was; new pauses are written as dated intervals instead, which leave
 * history exactly as it happened.
 *
 * ## Goal versions
 *
 * Editing a habit's schedule or daily goal used to overwrite the one config
 * every report reads, so last month's "3 a week" was re-scored as this
 * month's "5 a week". A version row (`habit_goal_versions`) records the
 * config that applies FROM a date; `habitOn(habit, day)` answers with the
 * config that applied ON that day.
 *
 * Both lists are attached to the in-memory `Habit` by the store; they are not
 * `habits` columns and are stripped from every habit write.
 *
 * Pure: no I/O, no clock.
 */
import { addDaysLocal, daysBetweenLocal, parseLocalDate, ymd } from './date';
import type { FrequencyConfig } from './supabase';

export type PauseKind = 'pause' | 'holiday';

export type PauseInterval = {
  id: string;
  /** null = a holiday: every habit. */
  habit_id: string | null;
  kind: PauseKind;
  /** Local date, inclusive. */
  start_date: string;
  /** Local date, inclusive; null = until resumed. */
  end_date: string | null;
};

export type GoalVersion = {
  habit_id: string;
  /** Local date this config starts to apply. */
  effective_from: string;
  frequency_config: FrequencyConfig;
  daily_goal: number | null;
  target_direction: 'at_least' | 'at_most' | null;
};

/** Is `day` inside this interval? */
export function intervalCovers(p: Pick<PauseInterval, 'start_date' | 'end_date'>, day: string): boolean {
  if (day < p.start_date) return false;
  return p.end_date === null || day <= p.end_date;
}

/** Is the habit paused (by its own pause or a holiday) on `date`? */
export function isPausedOn(habit: { pause_intervals?: readonly PauseInterval[] }, date: Date): boolean {
  const list = habit.pause_intervals;
  if (!list || list.length === 0) return false;
  const day = ymd(date);
  return list.some((p) => intervalCovers(p, day));
}

/** How many days of [start, end] the habit is paused. */
export function pausedDaysIn(habit: { pause_intervals?: readonly PauseInterval[] }, start: Date, end: Date): number {
  const list = habit.pause_intervals;
  if (!list || list.length === 0) return 0;
  let n = 0;
  for (let d = start; ymd(d) <= ymd(end); d = addDaysLocal(d, 1)) {
    if (isPausedOn(habit, d)) n += 1;
  }
  return n;
}

/**
 * The intervals that apply to one habit: its own pauses plus every holiday.
 * What the store attaches as `habit.pause_intervals`.
 */
export function intervalsForHabit(habitId: string, all: readonly PauseInterval[]): PauseInterval[] {
  return all.filter((p) => p.habit_id === habitId || p.habit_id === null);
}

/**
 * The habits with their time-off and goal versions attached -- what the store
 * keeps. A habit with neither keeps both fields undefined.
 */
export function attachTimeOff<H extends { id: string }>(
  habits: readonly H[],
  pauses: readonly PauseInterval[],
  versions: readonly GoalVersion[],
): (H & { pause_intervals?: PauseInterval[]; goal_versions?: GoalVersion[] })[] {
  return habits.map((h) => {
    const p = intervalsForHabit(h.id, pauses);
    const v = versions.filter((x) => x.habit_id === h.id);
    const { pause_intervals: _p, goal_versions: _v, ...rest } = h as H & { pause_intervals?: unknown; goal_versions?: unknown };
    return {
      ...(rest as unknown as H),
      ...(p.length ? { pause_intervals: p } : {}),
      ...(v.length ? { goal_versions: v } : {}),
    };
  });
}

/** Fields that live only in memory and must never reach a `habits` write. */
export function stripTimeOff<T extends object>(o: T): Omit<T, 'pause_intervals' | 'goal_versions' | 'current_streak' | 'best_streak'> {
  const { pause_intervals: _p, goal_versions: _v, current_streak: _cs, best_streak: _bs, ...rest } = o as T & { pause_intervals?: unknown; goal_versions?: unknown; current_streak?: unknown; best_streak?: unknown };
  return rest as Omit<T, 'pause_intervals' | 'goal_versions' | 'current_streak' | 'best_streak'>;
}

/** Did this patch change what a goal version records? */
export function changesGoal(updates: Partial<Pick<GoalVersion, 'frequency_config' | 'daily_goal' | 'target_direction'>>): boolean {
  return updates.frequency_config !== undefined || updates.daily_goal !== undefined || updates.target_direction !== undefined;
}

/** The interval covering `date`, if any -- for "duraklatıldı · 12 Eki'ye kadar". */
export function activePauseOn(habit: { pause_intervals?: readonly PauseInterval[] }, date: Date): PauseInterval | null {
  const day = ymd(date);
  return habit.pause_intervals?.find((p) => intervalCovers(p, day)) ?? null;
}

/**
 * A count target over a period that loses days to a pause/holiday shrinks in
 * proportion: "3 a week" with 4 of 7 days paused asks for ceil(3 x 3/7) = 2.
 * Rounded UP so a pause never turns a real target into zero while any day
 * is left; all days paused = 0 (the period is paused, not failed).
 */
export function pausedTarget(target: number, periodDays: number, pausedDays: number): number {
  if (target <= 0 || periodDays <= 0) return 0;
  const active = Math.max(0, periodDays - pausedDays);
  if (active === 0) return 0;
  if (pausedDays <= 0) return target;
  return Math.ceil((target * active) / periodDays);
}

// ---------------------------------------------------------------------------
// Validation for a new pause
// ---------------------------------------------------------------------------

export type PauseDraft = { kind: PauseKind; start_date: string; end_date: string | null };
export type PauseCheck = { ok: true } | { ok: false; reason: string };

/**
 * A pause starts today or later -- it never rewrites a day that already
 * happened (that is what a skip log is for) -- and ends on or after its start.
 * It may not overlap another pause of the same habit.
 */
export function validatePause(draft: PauseDraft, today: string, existing: readonly PauseInterval[]): PauseCheck {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.start_date)) return { ok: false, reason: 'Başlangıç tarihi geçersiz.' };
  if (draft.start_date < today) return { ok: false, reason: 'Geçmiş günler duraklatılamaz; tek bir günü atlamak için "atla" kullan.' };
  if (draft.end_date !== null) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.end_date)) return { ok: false, reason: 'Bitiş tarihi geçersiz.' };
    if (draft.end_date < draft.start_date) return { ok: false, reason: 'Bitiş, başlangıçtan önce olamaz.' };
  }
  const end = draft.end_date ?? '9999-12-31';
  const clash = existing.some((p) => p.kind === draft.kind && p.start_date <= end && (p.end_date ?? '9999-12-31') >= draft.start_date);
  if (clash) return { ok: false, reason: draft.kind === 'holiday' ? 'Bu tarihlerde zaten bir tatil var.' : 'Bu tarihlerde zaten bir duraklatma var.' };
  return { ok: true };
}

/**
 * Ending a pause today: the pause covered up to yesterday. A pause that
 * starts today (or later) and is ended today never covered a day -- it is
 * removed instead of being left as an empty interval.
 */
export function endPauseOn(p: PauseInterval, today: string): { action: 'update'; end_date: string } | { action: 'delete' } {
  if (p.start_date >= today) return { action: 'delete' };
  const t = parseLocalDate(today);
  if (!t) return { action: 'delete' };
  return { action: 'update', end_date: ymd(addDaysLocal(t, -1)) };
}

// ---------------------------------------------------------------------------
// What each one does -- the copy the UI shows, from one place
// ---------------------------------------------------------------------------

export type ExcuseKind = 'skip' | PauseKind;

export type ExcuseEffects = {
  title: string;
  span: string;
  target: string;
  rate: string;
  streak: string;
  reminders: string;
};

export const EXCUSE_EFFECTS: Record<ExcuseKind, ExcuseEffects> = {
  skip: {
    title: 'Atla',
    span: 'Tek gün, tek alışkanlık.',
    target: 'Hedef ve takvim değişmez.',
    rate: 'O gün tamamlama oranının iki tarafından da çıkar; oranın düşmez.',
    streak: 'Serin bozulmaz ama uzamaz da.',
    reminders: 'O günün hatırlatıcısı değişmez.',
  },
  pause: {
    // "Ara ver", not "Duraklat": the existing Duraklat moves a habit from
    // active back to the queue and refunds its willpower -- a different act.
    title: 'Ara ver',
    span: 'Seçtiğin tarihler, yalnız bu alışkanlık.',
    target: '"Haftada N" gibi dönem hedefleri kaybedilen günler oranında küçülür.',
    rate: 'Duraklatılan günler hesaba hiç girmez.',
    streak: 'Seri duraklatmanın üzerinden köprü kurar; bozulmaz, uzamaz.',
    reminders: 'Duraklatma boyunca hatırlatıcı gönderilmez.',
  },
  holiday: {
    title: 'Tatil modu',
    span: 'Seçtiğin tarihler, bütün alışkanlıklar.',
    target: 'Dönem hedefleri kaybedilen günler oranında küçülür.',
    rate: 'Tatil günleri hiçbir alışkanlığın hesabına girmez.',
    streak: 'Bütün seriler tatilin üzerinden köprü kurar.',
    reminders: 'Tatil boyunca alışkanlık hatırlatıcısı gönderilmez.',
  },
};

// ---------------------------------------------------------------------------
// Goal versions
// ---------------------------------------------------------------------------

type Versioned = {
  frequency_config: FrequencyConfig;
  daily_goal: number | null;
  target_direction: 'at_least' | 'at_most' | null;
  goal_versions?: readonly GoalVersion[];
};

/**
 * The habit as it was configured ON `date`. With no versions -- every habit
 * until its first edit after R01.05 -- the habit is returned as it is (same
 * object), so nothing changes for it.
 *
 * Before the first version's date the first version applies: the first row
 * is the baseline the edit wrote for the config that was in force until then.
 */
export function habitOn<H extends Versioned>(habit: H, date: Date): H {
  const vs = habit.goal_versions;
  if (!vs || vs.length === 0) return habit;
  const day = ymd(date);
  let pick: GoalVersion | null = null;
  let earliest: GoalVersion | null = null;
  for (const v of vs) {
    if (!earliest || v.effective_from < earliest.effective_from) earliest = v;
    if (v.effective_from <= day && (!pick || v.effective_from >= pick.effective_from)) pick = v;
  }
  const v = pick ?? earliest!;
  if (
    v.frequency_config === habit.frequency_config
    && v.daily_goal === habit.daily_goal
    && v.target_direction === habit.target_direction
  ) return habit;
  return { ...habit, frequency_config: v.frequency_config, daily_goal: v.daily_goal, target_direction: v.target_direction };
}

/**
 * Split [from, to] at version boundaries, so a rate over a range that spans a
 * goal change scores each part against the goal that applied to it.
 */
export function versionSegments(habit: Versioned, from: Date, to: Date): { from: Date; to: Date }[] {
  const vs = habit.goal_versions;
  const fromY = ymd(from), toY = ymd(to);
  if (!vs || vs.length === 0 || fromY > toY) return [{ from, to }];
  const cuts = Array.from(new Set(vs.map((v) => v.effective_from)))
    .filter((d) => d > fromY && d <= toY)
    .sort();
  const out: { from: Date; to: Date }[] = [];
  let start = from;
  for (const c of cuts) {
    const cd = parseLocalDate(c);
    if (!cd) continue;
    out.push({ from: start, to: addDaysLocal(cd, -1) });
    start = cd;
  }
  out.push({ from: start, to });
  return out.filter((s) => daysBetweenLocal(s.from, s.to) >= 0);
}

/**
 * The version rows a schedule/goal edit writes, effective `today`.
 *
 * The FIRST edit of a habit also writes a baseline row carrying the config
 * that was in force until now, effective from the habit's creation day --
 * otherwise the old config would be lost and the past re-scored against the
 * new one. An edit the same day as the last version replaces it (same
 * `effective_from`; the writer upserts on (habit_id, effective_from)).
 */
export function versionRowsForEdit(
  habit: Versioned & { id: string; created_at: string },
  next: Pick<GoalVersion, 'frequency_config' | 'daily_goal' | 'target_direction'>,
  today: string,
): GoalVersion[] {
  const rows: GoalVersion[] = [];
  const hasVersions = !!habit.goal_versions && habit.goal_versions.length > 0;
  const created = ymd(new Date(habit.created_at));
  if (!hasVersions && created < today) {
    rows.push({
      habit_id: habit.id,
      effective_from: created,
      frequency_config: habit.frequency_config,
      daily_goal: habit.daily_goal,
      target_direction: habit.target_direction,
    });
  }
  rows.push({ habit_id: habit.id, effective_from: today, ...next });
  return rows;
}
