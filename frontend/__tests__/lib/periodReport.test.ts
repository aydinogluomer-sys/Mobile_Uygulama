/**
 * R07.04 — "Gün/hafta/ay başarı, miktar ve süre raporlarını R01'den üret.
 * Açık dönem, pause, eksik kayıt ve kısmi başarı için ikinci hesap yazma."
 */
import * as fs from 'fs';
import * as path from 'path';
import { periodReport, periodReportLine, measuredRows } from '../../lib/periodReport';
import { periodStatus } from '../../lib/habitSchedule';
import type { Habit } from '../../lib/supabase';

const habit = (over: Partial<Habit> & Record<string, unknown>): Habit => ({
  id: 'h', user_id: 'u1', name: 'x', behavior_type: 'positive', tracking_type: 'numeric', unit: 'bardak', daily_goal: 8,
  target_direction: 'at_least', frequency_config: { kind: 'daily' }, created_at: '2026-01-01T00:00:00Z', end_condition: null, status: 'active', ...over,
} as unknown as Habit);
const log = (date: string, value: number | null, state: 'done' | 'partial' | 'miss' | 'skip' = 'partial') => ({ habit_id: 'h', completed_at: date, state, value });
// week Mon 5 .. Sun 11 October 2026; "now" is Thursday 8th, noon
const WEEK = { start: '2026-10-05', end: '2026-10-11', asOf: new Date(2026, 9, 8, 12) };

it('amount: sums the engine\'s actual/target; the open days are open, not failed; partial is kept', () => {
  const water = habit({});
  const logs = [log('2026-10-05', 8, 'done'), log('2026-10-06', 5), log('2026-10-08', 3)];
  const r = periodReport(water, logs, WEEK);
  expect(r.unit).toBe('amount');
  expect(r.periods).toEqual({ satisfied: 1, closedUnmet: 2, open: 4, paused: 0 }); // Tue 5/8 and Wed (no log) closed unmet; Thu..Sun open
  expect(r.actual).toBe(16);
  expect(r.partial).toBe(2);           // Tue (closed) and Thu (open) have progress below target
  expect(r.successRate).toBeCloseTo(1 / 3);
  expect(periodReportLine(r, 'bardak')).toBe('16/56 bardak · 4 açık · 2 kısmi');
});

it('duration habits report minutes the same way', () => {
  const read = habit({ tracking_type: 'duration', unit: 'dk', daily_goal: 20 });
  const r = periodReport(read, [log('2026-10-05', 10), log('2026-10-06', 20, 'done')], { ...WEEK, asOf: new Date(2026, 9, 12) });
  expect(r.unit).toBe('amount');
  expect([r.actual, r.target, r.periods.satisfied, r.periods.closedUnmet]).toEqual([30, 140, 1, 6]);
  expect(r.partial).toBe(1);
});

it('a paused stretch is out of the count, not a failure', () => {
  const water = habit({ pause_intervals: [{ id: 'p', habit_id: 'h', kind: 'pause', start_date: '2026-10-05', end_date: '2026-10-07' }] });
  const r = periodReport(water, [], WEEK);
  expect(r.periods.paused).toBe(3);
  expect(r.periods.closedUnmet).toBe(0);
});

it('a weekly-count habit is one period for the week, open until it closes', () => {
  const w3 = habit({ tracking_type: 'boolean', unit: null, daily_goal: null, frequency_config: { kind: 'weekly', count: 3 } });
  const r = periodReport(w3, [log('2026-10-05', null, 'done'), log('2026-10-06', null, 'done')], WEEK);
  expect(r.periods).toEqual({ satisfied: 0, closedUnmet: 0, open: 1, paused: 0 });
  expect([r.unit, r.actual, r.target]).toEqual(['days', 2, 3]);
  expect(r.successRate).toBeNull();
});

it('the same numbers as asking the engine day by day (no second calculation)', () => {
  const water = habit({});
  const logs = [log('2026-10-05', 8, 'done'), log('2026-10-06', 5)];
  const r = periodReport(water, logs, WEEK);
  let actual = 0;
  for (let d = 5; d <= 11; d++) actual += periodStatus(water, logs as never, new Date(2026, 9, d), { asOf: WEEK.asOf }).actual;
  expect(r.actual).toBe(actual);
  const src = fs.readFileSync(path.join(__dirname, '../../lib/periodReport.ts'), 'utf8');
  expect(src).not.toMatch(/daily_goal|\.value\b/); // never reads goals or values itself
});

it('the review rows: only habits measured in an amount, each with its own unit', () => {
  const water = habit({});
  const read = habit({ id: 'r', name: 'Okuma', tracking_type: 'duration', unit: 'dk', daily_goal: 20 });
  const walk = habit({ id: 'w', name: 'Yürüyüş', tracking_type: 'boolean', unit: null, daily_goal: null });
  const rows = measuredRows([water, read, walk], [log('2026-10-05', 8, 'done'), { ...log('2026-10-05', 15), habit_id: 'r' }], WEEK);
  expect(rows.map((r) => r.id)).toEqual(['h', 'r']);
  expect(rows[1].line).toMatch(/^15\/140 dk/);
});
