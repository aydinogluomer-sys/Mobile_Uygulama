/**
 * R07.04 — day / week / month reports of success, AMOUNT and DURATION, all
 * read from the R01 engine (`periodStatus`). No second calculation: this
 * walks the habit's own periods inside the range and adds up what the
 * engine says about each one.
 *
 * The rules come with the engine, not from here:
 *   - an OPEN period (still running at `asOf`) is not a failure -- it is
 *     reported as open, with its progress so far;
 *   - a PAUSED period (dated break / holiday) is out of the count;
 *   - a missing log is "nothing yet" in an open period, unmet in a closed one;
 *   - partial progress is kept as an amount, never rounded to done/undone.
 */
import { periodStatus, type PeriodUnit } from './habitSchedule';
import { addDaysLocal, parseLocalDate, ymd } from './date';
import type { Habit, HabitLog } from './supabase';
import { decimalTR } from './chartText';

export type PeriodReport = {
  unit: PeriodUnit | null;
  periods: { satisfied: number; closedUnmet: number; open: number; paused: number };
  /** periods with progress that did not reach the target (open or closed). */
  partial: number;
  /** sum of `actual` over evaluated periods, in `unit` (days, or the habit's amount/minutes). */
  actual: number;
  /** sum of `target` over evaluated periods. */
  target: number;
  /** satisfied / (satisfied + closedUnmet); null when no period has closed or been met. */
  successRate: number | null;
};

type Log = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'> & { value?: number | null };

export function periodReport(habit: Habit, logs: readonly Log[], range: { start: string; end: string; asOf: Date }): PeriodReport {
  const from = parseLocalDate(range.start);
  const to = parseLocalDate(range.end);
  const out: PeriodReport = { unit: null, periods: { satisfied: 0, closedUnmet: 0, open: 0, paused: 0 }, partial: 0, actual: 0, target: 0, successRate: null };
  if (!from || !to || from > to) return out;
  const mine = logs.filter((l) => l.habit_id === habit.id);
  const seen = new Set<string>();
  for (let d = from; d <= to; d = addDaysLocal(d, 1)) {
    const st = periodStatus(habit, mine, d, { asOf: range.asOf });
    const key = `${ymd(st.periodStart)}|${ymd(st.periodEnd)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (st.status === 'unknown') continue;           // not scheduled / no target: not a period to report
    out.unit = st.unit;
    if (st.status === 'paused') { out.periods.paused += 1; continue; }
    out.actual += st.actual;
    out.target += st.target;
    if (st.status === 'satisfied') out.periods.satisfied += 1;
    else if (st.status === 'closed_unmet') out.periods.closedUnmet += 1;
    else out.periods.open += 1;                       // not_started / in_progress
    if (st.status !== 'satisfied' && st.actual > 0) out.partial += 1;
  }
  const decided = out.periods.satisfied + out.periods.closedUnmet;
  out.successRate = decided === 0 ? null : out.periods.satisfied / decided;
  return out;
}

/** One line for a report row, in the habit's own unit. */
export function periodReportLine(r: PeriodReport, unitLabel: string | null): string {
  const amount = r.unit === 'amount' ? `${trim(r.actual)}/${trim(r.target)} ${unitLabel ?? ''}`.trim() : `${r.periods.satisfied}/${r.periods.satisfied + r.periods.closedUnmet + r.periods.open} dönem`;
  const bits = [amount];
  if (r.periods.open > 0) bits.push(`${r.periods.open} açık`);
  if (r.partial > 0) bits.push(`${r.partial} kısmi`);
  if (r.periods.paused > 0) bits.push(`${r.periods.paused} arada`);
  return bits.join(' · ');
}

// R10.05 — a report line is UI text: Turkish decimal comma.
const trim = (n: number) => decimalTR(n);

export type MeasuredRow = { id: string; name: string; line: string; report: PeriodReport };

/**
 * R07.04 — the review's "Miktar ve süre" rows: every habit the engine
 * measures in an amount (numeric or duration), with its line. Habits with
 * no evaluated period in the range are left out (nothing to report).
 */
export function measuredRows(habits: readonly Habit[], logs: readonly Log[], range: { start: string; end: string; asOf: Date }): MeasuredRow[] {
  return habits
    .map((h) => ({ h, r: periodReport(h, logs, range) }))
    .filter(({ r }) => r.unit === 'amount' && r.periods.satisfied + r.periods.closedUnmet + r.periods.open > 0)
    .map(({ h, r }) => ({ id: h.id, name: h.name, line: periodReportLine(r, h.unit ?? null), report: r }));
}
