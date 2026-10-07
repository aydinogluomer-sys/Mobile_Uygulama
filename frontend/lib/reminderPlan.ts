/**
 * R04.01 / R04.02 — which habit reminders should be pending right now.
 *
 * KD-04: every habit used to get ONE repeating DAILY trigger at its time,
 * whatever its schedule -- a Mon/Thu habit was reminded on Tuesday, a "3 a
 * week" already met on Wednesday kept ringing until Sunday, a paused or
 * queued (`waiting`) habit rang too, and a day already logged rang anyway.
 *
 * Here the plan is a list of ONE-OFF reminders for the next `horizonDays`,
 * each asked of the same schedule engine every screen uses:
 *   - only `active` habits (not `waiting`, not the legacy undated pause)
 *   - only days the habit is eligible on (schedule, date range, dated
 *     pause / holiday, the goal version in force that day -- R01)
 *   - not a day whose count period is already met before it
 *   - not today if today already has a log (done / partial / skip / miss)
 *   - only the habit's own weekdays when it set a day group (R04.02)
 *   - not inside quiet hours (R04.02)
 *   - not in the past
 * The nearest `maxPending` are kept: the OS caps pending notifications (iOS
 * at 64), and the later days are planned on the next reconcile instead of
 * being dropped silently -- `dropped` says how many are waiting for room.
 *
 * Pure: no I/O, no clock; `now` is passed in.
 */
import { addDaysLocal, startOfWeekLocal, ymd } from './date';
import { isCountBasedSchedule, isEligibleOn, periodStatus, weekdayIndex } from './habitSchedule';
import type { Habit } from './supabase';

export type ReminderSettings = {
  /** 'HH:mm' or null = no quiet hours. A window may cross midnight (22:00 -> 07:00). */
  quietStart: string | null;
  quietEnd: string | null;
  /** Show "Hatırlatıcı" instead of the habit's name on the lock screen. */
  hideTitles: boolean;
};

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { quietStart: null, quietEnd: null, hideTitles: false };

export type PlannedReminder = {
  /** Stable identity of this reminder -- the reconcile key. */
  key: string;
  habitId: string;
  /** Local day, YYYY-MM-DD. */
  day: string;
  time: string;
  at: Date;
};

export type ReminderPlan = { reminders: PlannedReminder[]; dropped: number };

export type PlanLog = { habit_id: string; completed_at: string; state: string };

export function parseTime(time: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time).trim());
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const minutesOf = (t: { hour: number; minute: number }) => t.hour * 60 + t.minute;

/** Is `time` inside the quiet window? Start inclusive, end exclusive; crosses midnight if start > end. */
export function inQuietHours(time: string, s: Pick<ReminderSettings, 'quietStart' | 'quietEnd'>): boolean {
  const t = parseTime(time), a = s.quietStart ? parseTime(s.quietStart) : null, b = s.quietEnd ? parseTime(s.quietEnd) : null;
  if (!t || !a || !b) return false;
  const x = minutesOf(t), lo = minutesOf(a), hi = minutesOf(b);
  if (lo === hi) return false;
  return lo < hi ? x >= lo && x < hi : x >= lo || x < hi;
}

/** The reminder times a habit asked for: `times` if set, else the single `time`. Valid, unique, sorted. */
export function reminderTimes(h: Pick<Habit, 'reminders'>): string[] {
  const r = h.reminders;
  if (!r || !r.enabled) return [];
  const raw = r.times && r.times.length > 0 ? r.times : [r.time];
  const ok = raw.map((t) => { const p = parseTime(t); return p ? `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` : null; })
    .filter((t): t is string => t !== null);
  return Array.from(new Set(ok)).sort();
}

/** Weekday indexes (0 = Monday) the reminder is limited to; empty = every eligible day. */
export function reminderDays(h: Pick<Habit, 'reminders'>): number[] {
  const r = h.reminders;
  return (r?.days ?? []).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
}

export const reminderKey = (habitId: string, day: string, time: string) => `h:${habitId}:${day}:${time}`;

/** The earliest day whose logs a plan needs: the week or month containing `now`, whichever starts first. */
export function planLogsSince(now: Date): string {
  const week = startOfWeekLocal(now);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  return ymd(week < month ? week : month);
}

export function planReminders(params: {
  habits: readonly Habit[];
  /** Logs from `planLogsSince(now)` up to today; null = unknown (period checks are skipped, nothing hidden). */
  logs: readonly PlanLog[] | null;
  settings: ReminderSettings;
  now: Date;
  horizonDays?: number;
  maxPending?: number;
}): ReminderPlan {
  const { habits, logs, settings, now } = params;
  const horizon = params.horizonDays ?? 7;
  const max = params.maxPending ?? 56;
  const today = ymd(now);
  const out: PlannedReminder[] = [];

  for (const h of habits) {
    if (h.status !== 'active') continue;
    const times = reminderTimes(h).filter((t) => !inQuietHours(t, settings));
    if (times.length === 0) continue;
    const days = reminderDays(h);
    const mine = logs ? logs.filter((l) => l.habit_id === h.id) : null;
    const loggedToday = mine?.some((l) => l.completed_at.slice(0, 10) === today) ?? false;

    for (let i = 0; i < horizon; i++) {
      const date = addDaysLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate()), i);
      const day = ymd(date);
      if (day === today && loggedToday) continue;
      if (days.length > 0 && !days.includes(weekdayIndex(date))) continue;
      if (!isEligibleOn(h, date)) continue;
      if (mine && isCountBasedSchedule(h)) {
        // Met before this day -> nothing left to remind about in this period.
        const before = mine.filter((l) => l.completed_at.slice(0, 10) < day);
        if (periodStatus(h, before as never, date, { asOf: date }).status === 'satisfied') continue;
      }
      for (const time of times) {
        const p = parseTime(time)!;
        const at = new Date(date.getFullYear(), date.getMonth(), date.getDate(), p.hour, p.minute, 0, 0);
        if (at.getTime() <= now.getTime()) continue;
        out.push({ key: reminderKey(h.id, day, time), habitId: h.id, day, time, at });
      }
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));
  return { reminders: out.slice(0, max), dropped: Math.max(0, out.length - max) };
}

/**
 * Classify a scheduled OS notification by its data. Ours carry
 * `{ kind: 'habit', key }`; the pre-R04 DAILY triggers carry only
 * `{ habitId }`; recovery reminders carry `{ recoveryId }`; snoozes
 * `{ kind: 'snooze' }`. Anything unrecognised is left alone.
 */
export function classifyScheduled(data: Record<string, unknown> | null | undefined): { kind: 'habit' | 'legacy-habit' | 'other'; key: string | null } {
  if (!data) return { kind: 'other', key: null };
  if (data.kind === 'habit' && typeof data.key === 'string') return { kind: 'habit', key: data.key };
  if (data.kind === undefined && typeof data.habitId === 'string') return { kind: 'legacy-habit', key: null };
  return { kind: 'other', key: null };
}

/**
 * The reconcile diff: what to cancel (ours and no longer wanted, duplicates,
 * and every legacy DAILY habit trigger) and what to add. Recovery reminders,
 * snoozes and anything unrecognised are never touched.
 */
export function reconcile(
  scheduled: readonly { identifier: string; data: Record<string, unknown> | null | undefined }[],
  wanted: readonly PlannedReminder[],
): { cancel: string[]; add: PlannedReminder[] } {
  const want = new Set(wanted.map((w) => w.key));
  const have = new Set<string>();
  const cancel: string[] = [];
  for (const s of scheduled) {
    const c = classifyScheduled(s.data);
    if (c.kind === 'other') continue;
    if (c.kind === 'legacy-habit') { cancel.push(s.identifier); continue; }
    if (c.key && want.has(c.key) && !have.has(c.key)) have.add(c.key);
    else cancel.push(s.identifier);
  }
  return { cancel, add: wanted.filter((w) => !have.has(w.key)) };
}

export const MAX_REMINDER_TIMES = 4;

/**
 * R04.02 — a reminder edit, checked: 1..4 distinct valid times, weekdays
 * 0..6. The first time is also written to `time`, so a build that only
 * knows the single time still reminds at it.
 */
export function buildReminderConfig(enabled: boolean, times: readonly string[], days: readonly number[]):
  { ok: true; config: NonNullable<Habit['reminders']> } | { ok: false; reason: string } {
  const norm = times.map((t) => {
    const p = parseTime(t);
    return p ? `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}` : null;
  });
  if (norm.length === 0 || norm.some((t) => t === null)) return { ok: false, reason: 'Saatleri SS:DD biçiminde gir.' };
  if (new Set(norm).size !== norm.length) return { ok: false, reason: 'Aynı saat iki kez olamaz.' };
  const valid = (norm as string[]).sort();
  if (valid.length > MAX_REMINDER_TIMES) return { ok: false, reason: `Günde en fazla ${MAX_REMINDER_TIMES} hatırlatıcı.` };
  const ds = Array.from(new Set(days)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (ds.length !== new Set(days).size) return { ok: false, reason: 'Geçersiz gün.' };
  return { ok: true, config: { enabled, time: valid[0], times: valid, ...(ds.length > 0 && ds.length < 7 ? { days: ds } : {}) } };
}
