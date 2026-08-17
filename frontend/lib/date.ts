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
