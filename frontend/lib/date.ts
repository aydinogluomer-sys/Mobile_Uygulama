/**
 * Canonical calendar-date module.  (task 1B-001)
 *
 * THE ONLY PLACE A CALENDAR DATE IS DERIVED.
 *
 * Every function here is pure and takes an injectable clock, so behaviour at
 * 00:30 and 23:30 is testable without touching the system time.
 *
 * ## Why this module exists
 *
 * A calendar date is a *local* notion. `toISOString()` renders UTC, so
 * `new Date().toISOString().slice(0, 10)` answers "what is the date in
 * Greenwich", not "what date is it for this user". At UTC+3 that is the
 * PREVIOUS day between 00:00 and 03:00 local — every night, for three hours.
 *
 * That single mistake is the root of the date-cluster defects across habits,
 * tasks, focus, journal, life areas and deep work.  **No function in this
 * module may use `toISOString()` to derive a calendar date.**
 *
 * The mirror-image trap is parsing: `new Date('2026-08-04')` is specified to
 * parse as UTC midnight, so in a negative-offset zone it yields the day
 * before.  `parseLocalDate` constructs from explicit components instead.
 */

/** `YYYY-MM-DD` in the LOCAL calendar. Never UTC. */
export type Ymd = string;

/**
 * Local `YYYY-MM-DD` for a Date.
 *
 * Uses `getFullYear`/`getMonth`/`getDate`, which are local-time accessors.
 */
export function ymd(d: Date): Ymd {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Today's local calendar date.
 *
 * @param now injectable clock — pass a fixed Date in tests.
 */
export function todayLocal(now: Date = new Date()): Ymd {
  return ymd(now);
}

/**
 * R01.06 — the device's IANA zone (e.g. `Europe/Istanbul`), or `null` when the
 * runtime cannot say. Never guessed: a wrong zone is worse than none. Bounded
 * to 1..64 characters, the same as the `habit_logs.tz` CHECK (migration 033).
 */
export function deviceTimeZone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.length >= 1 && tz.length <= 64 ? tz : null;
  } catch {
    return null;
  }
}

/**
 * R01.06 — THE contract for "which day is this, and where was it written".
 * The day is the local calendar day (never UTC); the zone is recorded beside
 * it, captured at the same instant, so a log made while travelling can be
 * told apart from a clock or DST error later.
 */
export function localDayStamp(now: Date = new Date()): { date: Ymd; tz: string | null } {
  return { date: todayLocal(now), tz: deviceTimeZone() };
}

/**
 * Parse `YYYY-MM-DD` into a Date at LOCAL midnight.
 *
 * `new Date('2026-08-04')` would parse as UTC midnight; west of Greenwich that
 * is the previous local day. Constructing from components avoids it entirely.
 *
 * Returns `null` for anything that is not a well-formed, real date — including
 * `'2026-02-30'`, which the Date constructor would silently roll into March.
 */
export function parseLocalDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  // reject roll-over: new Date(2026, 1, 30) silently becomes 2 March
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) {
    return null;
  }
  return d;
}

/**
 * Start of the ISO week (Monday) at LOCAL midnight.
 *
 * Monday-based because the product presents weeks that way — `DOW_TR` begins
 * with `Pzt`. Sunday is the END of a week here, not the start: a session at
 * Sunday 22:00 belongs to the week that is closing, not the one beginning.
 */
export function startOfWeekLocal(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = x.getDay();            // 0 = Sunday … 6 = Saturday
  const daysSinceMonday = (dow + 6) % 7;
  x.setDate(x.getDate() - daysSinceMonday);
  return x;
}

/**
 * The LOCAL day key of a stored UTC instant.
 *
 * Columns like `tasks.completed_at` and `focus_sessions.started_at` hold a full
 * ISO instant. `iso.split('T')[0]` truncates it to the day *in Greenwich*,
 * which at UTC+3 is yesterday for anything logged between 00:00 and 03:00
 * local -- and that key is then compared against local keys built by `ymd`.
 * Parse the instant first, then ask what local day it fell on.
 *
 * Returns `''` for a missing or unparseable value, so callers can keep using a
 * plain string comparison without a null branch.
 */
export function ymdFromIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : ymd(d);
}

/**
 * The local `YYYY-MM` month key of `d`.
 *
 * Derived from `ymd` rather than rebuilt, so the month key and the day key can
 * never disagree about which month a local instant falls in.
 */
export function ymLocal(d: Date = new Date()): string {
  return ymd(d).slice(0, 7);
}

/** Convenience: the local `YYYY-MM-DD` of this week's Monday. */
export function weekStartYmd(d: Date = new Date()): Ymd {
  return ymd(startOfWeekLocal(d));
}

/** `n` days from `d`, preserving local midnight. Negative `n` goes back. */
export function addDaysLocal(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** Whole local days between two dates, ignoring time of day. */
export function daysBetweenLocal(a: Date, b: Date): number {
  const A = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const B = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();
  return Math.round((B - A) / 86_400_000);
}

/** True when both dates fall on the same local calendar day. */
export function isSameLocalDay(a: Date, b: Date): boolean {
  return ymd(a) === ymd(b);
}

// ---------------------------------------------------------------------------
// Loggable days (F03, migration 038)
//
// The server refuses a habit log whose day lies outside
// [CURRENT_DATE - 15, CURRENT_DATE + 1] (UTC). The client allows today and the
// previous 14 local days: every local day of UTC-12..UTC+14 is at most one day
// away from the UTC day, so this window always sits inside the server's. Days are
// compared as `YYYY-MM-DD` strings (lexical order is calendar order), never as
// timestamps, so a 23- or 25-hour DST day cannot shift the edge.
// ---------------------------------------------------------------------------

/** Earliest loggable day, in days before the device-local today. Server accepts CURRENT_DATE - 15 (one day of timezone tolerance). Equals RECOVERY_LOOKBACK (lib/recoveryBacklog.ts). */
export const LOGGABLE_DAYS_BACK = 14;
/** Server accepts CURRENT_DATE + 1; the client never writes a future day. */
export const LOGGABLE_DAYS_AHEAD = 0;

export interface LoggableRange {
  readonly earliest: Ymd;
  readonly latest: Ymd;
}

/** Inclusive range of days the user may log, as local YYYY-MM-DD. */
export function loggableDayRange(now: Date = new Date()): LoggableRange {
  return {
    earliest: ymd(addDaysLocal(now, -LOGGABLE_DAYS_BACK)),
    latest: ymd(addDaysLocal(now, LOGGABLE_DAYS_AHEAD)),
  };
}

/** True when `day` (a Ymd string or a Date) lies inside loggableDayRange(now). Malformed strings are not loggable. */
export function isLoggableDay(day: Ymd | Date, now: Date = new Date()): boolean {
  let key: Ymd;
  if (day instanceof Date) {
    if (Number.isNaN(day.getTime())) return false;
    key = ymd(day);
  } else {
    if (typeof day !== 'string' || parseLocalDate(day) === null) return false;
    key = day;
  }
  if (Number.isNaN(now.getTime())) return false;
  const { earliest, latest } = loggableDayRange(now);
  return earliest <= key && key <= latest;
}
