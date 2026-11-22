/**
 * R04.01 / R04.02 / F17 — which habit reminders should be pending right now.
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
 *   - quiet hours (R04.02 / DOM-15): deferred to `quietEnd` when that falls
 *     later on the same local day (spread 5 min apart), otherwise quieted
 *   - Calm-Tech daily cap (DOM-15): fair two-pass selection per day (default 3),
 *     stable across the day by counting already-past and today-logged slots
 *   - reconcile keys carry `@<epoch ms>` (DOM-04) so timezone/DST shifts replace
 *     stale instants cleanly
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
  /** DOM-15 — günlük en çok hatırlatıcı; null = sınırsız. */
  maxPerDay: number | null;
};

export const DEFAULT_MAX_PER_DAY = 3;
export const MAX_PER_DAY_CHOICES: readonly (number | null)[] = [3, 5, 8, null];
export const MAX_PER_DAY_BOUNDS = { min: 1, max: 12 } as const;

export function normaliseMaxPerDay(raw: unknown, fallback: number = DEFAULT_MAX_PER_DAY): number | null {
  if (raw === undefined) return fallback;
  if (raw === null) return null;
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= MAX_PER_DAY_BOUNDS.min && raw <= MAX_PER_DAY_BOUNDS.max ? raw : fallback;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  quietStart: null,
  quietEnd: null,
  hideTitles: false,
  maxPerDay: DEFAULT_MAX_PER_DAY,
};

export type PlannedReminder = {
  /** Stable identity of this reminder -- the reconcile key. */
  key: string;
  habitId: string;
  /** Local day, YYYY-MM-DD. */
  day: string;
  time: string;
  at: Date;
  /** Sessiz saat yüzünden ertelendiyse özgün saat ('HH:mm'). */
  shiftedFrom?: string;
};

export type ReminderPlan = {
  reminders: PlannedReminder[];
  /** Bütçe (maxPending) yüzünden bu geçişe sığmayan; sonraki geçişte planlanır. */
  dropped: number;
  /** Günlük tavan yüzünden hiç planlanmayan. */
  capped: number;
  /** Sessiz saat bitimine ertelenen. */
  deferred: number;
  /** Sessiz saate düşüp aynı gün içinde ertelenemediği için gönderilmeyen. */
  quieted: number;
};

export type PlanLog = { habit_id: string; completed_at: string; state: string };

export const DEFAULT_HORIZON_DAYS = 7;

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

export function shiftOutOfQuiet(time: string, s: Pick<ReminderSettings, 'quietStart' | 'quietEnd'>): string | null {
  const t = parseTime(time);
  if (!t) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const norm = `${pad(t.hour)}:${pad(t.minute)}`;
  if (!inQuietHours(norm, s)) return norm;
  const end = s.quietEnd ? parseTime(s.quietEnd) : null;
  if (!end) return null;
  // Yalnız AYNI GÜN içinde, o saatten sonra biten pencere ertelenebilir (D5).
  return minutesOf(end) > minutesOf(t) ? `${pad(end.hour)}:${pad(end.minute)}` : null;
}

export const SHIFT_STEP_MINUTES = 5;

const byAt = <T extends { at: Date; habitId: string }>(a: T, b: T): number =>
  a.at.getTime() - b.at.getTime() || a.habitId.localeCompare(b.habitId);

export function applyDailyCap<T extends { habitId: string; at: Date }>(day: readonly T[], cap: number | null): { kept: T[]; removed: T[] } {
  const sorted = [...day].sort(byAt);
  if (cap === null || sorted.length <= cap) return { kept: sorted, removed: [] };
  const picked = new Set<T>();
  const seen = new Set<string>();
  for (const c of sorted) {
    if (picked.size >= cap) break;
    if (!seen.has(c.habitId)) { seen.add(c.habitId); picked.add(c); }
  }
  for (const c of sorted) {
    if (picked.size >= cap) break;
    picked.add(c);
  }
  return { kept: sorted.filter((c) => picked.has(c)), removed: sorted.filter((c) => !picked.has(c)) };
}

export function hasReminderHabits(habits: readonly Pick<Habit, 'status' | 'reminders'>[]): boolean {
  return habits.some((h) => h.status === 'active' && !!h.reminders?.enabled);
}

export const IOS_PENDING_LIMIT = 64;
export const HABIT_SLOT_CEILING = 56;
export const HABIT_SLOT_FLOOR = 8;
export const RESERVED_SLOTS = 7;

export function habitSlotBudget(others: number): number {
  const o = Number.isFinite(others) && others > 0 ? Math.floor(others) : 0;
  return Math.max(HABIT_SLOT_FLOOR, Math.min(HABIT_SLOT_CEILING, IOS_PENDING_LIMIT - RESERVED_SLOTS - o));
}

export const REENTRY_KIND = 'reentry';
export const REENTRY_HOUR = 10;

export function reentryTime(now: Date, horizonDays: number, s: Pick<ReminderSettings, 'quietStart' | 'quietEnd'>): Date {
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const pad = (n: number) => String(n).padStart(2, '0');
  const wanted = `${pad(REENTRY_HOUR)}:00`;
  const sameDay = shiftOutOfQuiet(wanted, s);
  const endP = s.quietEnd ? parseTime(s.quietEnd) : null;
  const time = sameDay ?? (endP ? `${pad(endP.hour)}:${pad(endP.minute)}` : wanted);
  const p = parseTime(time)!;
  let offset = Math.max(0, horizonDays - 1) + (sameDay === null ? 1 : 0);
  for (let guard = 0; guard < 3; guard++, offset++) {
    const d = addDaysLocal(base, offset);
    const at = new Date(d.getFullYear(), d.getMonth(), d.getDate(), p.hour, p.minute, 0, 0);
    if (at.getTime() > now.getTime()) return at;
  }
  const d = addDaysLocal(base, offset);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), p.hour, p.minute, 0, 0);
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

export function reminderKey(habitId: string, day: string, time: string, at: Date): string {
  return `h:${habitId}:${day}:${time}@${at.getTime()}`;
}

/** The earliest day whose logs a plan needs: the week or month containing `now`, whichever starts first. */
export function planLogsSince(now: Date): string {
  const week = startOfWeekLocal(now);
  const month = new Date(now.getFullYear(), now.getMonth(), 1);
  return ymd(week < month ? week : month);
}

type Candidate = { habitId: string; day: string; time: string; at: Date; shiftedFrom?: string; logged: boolean };
const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const atOf = (date: Date, time: string): Date => {
  const p = parseTime(time)!;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), p.hour, p.minute, 0, 0);
};

function spreadShifted(day: Candidate[]): void {
  const taken = new Set(day.filter((c) => !c.shiftedFrom).map((c) => c.at.getTime()));
  for (const c of day.filter((x) => x.shiftedFrom).sort(byAt)) {
    let t = c.at.getTime();
    while (taken.has(t)) t += SHIFT_STEP_MINUTES * 60_000;
    taken.add(t);
    c.at = new Date(t);
  }
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
  const horizon = params.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const max = params.maxPending ?? HABIT_SLOT_CEILING;
  const cap = settings.maxPerDay === undefined ? DEFAULT_MAX_PER_DAY : settings.maxPerDay;
  const today = ymd(now);
  const byDay = new Map<string, Candidate[]>();
  let quieted = 0;

  for (const h of habits) {
    if (h.status !== 'active') continue;
    const times = reminderTimes(h);
    if (times.length === 0) continue;
    const days = reminderDays(h);
    const mine = logs ? logs.filter((l) => l.habit_id === h.id) : null;
    const loggedToday = mine?.some((l) => l.completed_at.slice(0, 10) === today) ?? false;

    for (let i = 0; i < horizon; i++) {
      const date = addDaysLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate()), i);
      const day = ymd(date);
      if (days.length > 0 && !days.includes(weekdayIndex(date))) continue;
      if (!isEligibleOn(h, date)) continue;
      if (mine && isCountBasedSchedule(h)) {
        // Met before this day -> nothing left to remind about in this period.
        const before = mine.filter((l) => l.completed_at.slice(0, 10) < day);
        if (periodStatus(h, before as never, date, { asOf: date }).status === 'satisfied') continue;
      }
      for (const time of times) {
        const placed = shiftOutOfQuiet(time, settings);
        if (placed === null) {
          if (atOf(date, time).getTime() > now.getTime()) quieted += 1;
          continue;
        }
        const c: Candidate = { habitId: h.id, day, time: placed, at: atOf(date, placed), logged: day === today && loggedToday };
        if (placed !== time) c.shiftedFrom = time;
        const list = byDay.get(day) ?? [];
        list.push(c);
        byDay.set(day, list);
      }
    }
  }

  let capped = 0, deferred = 0;
  const out: PlannedReminder[] = [];
  for (const list of byDay.values()) {
    spreadShifted(list);
    const { kept, removed } = applyDailyCap(list, cap);
    capped += removed.filter((c) => c.at.getTime() > now.getTime() && !c.logged).length;
    for (const c of kept) {
      if (c.at.getTime() <= now.getTime() || c.logged) continue;
      const time = c.shiftedFrom ? hhmm(c.at) : c.time;
      if (c.shiftedFrom) deferred += 1;
      out.push({
        key: reminderKey(c.habitId, c.day, time, c.at),
        habitId: c.habitId,
        day: c.day,
        time,
        at: c.at,
        ...(c.shiftedFrom ? { shiftedFrom: c.shiftedFrom } : {}),
      });
    }
  }

  out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.key.localeCompare(b.key));
  return { reminders: out.slice(0, max), dropped: Math.max(0, out.length - max), capped, deferred, quieted };
}

/**
 * Classify a scheduled OS notification by its data. Ours carry
 * `{ kind: 'habit', key }` with `@epoch`; pre-F17 keys without `@` and pre-R04
 * DAILY triggers carrying only `{ habitId }` are `legacy-habit`; recovery
 * reminders, snoozes, re-entry nudges and focus-end alerts are `other`.
 */
export function classifyScheduled(data: Record<string, unknown> | null | undefined): { kind: 'habit' | 'legacy-habit' | 'other'; key: string | null } {
  if (!data) return { kind: 'other', key: null };
  if (data.kind === 'habit' && typeof data.key === 'string') {
    // DOM-04: mutlak an ('@epoch') taşımayan anahtar eski biçimdir: bir kez iptal edilip yeniden kurulur.
    return data.key.includes('@') ? { kind: 'habit', key: data.key } : { kind: 'legacy-habit', key: null };
  }
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
