/**
 * R01.07 — "Aynı tarih fixture'larını bütün tüketicilerde doğrula; şema
 * değişikliği eklemeli olsun, eski kayıt sayımları uzlaşsın."
 * R01 kabul: "DST/gece yarısı/Şubat tüm ekranlarda aynıdır."
 *
 * One set of habits × one set of dates, asked of every consumer that decides
 * "is this a day for that habit": Today's list, the reminder planner, the
 * report's due-day average, the recovery backlog and the capacity day load.
 * They must all give the canonical answer (`isEligibleOn`) -- at 00:00:30,
 * noon and 23:59:30 local, across month ends, 29 February in leap and
 * non-leap years, New Year, and the EU DST-change days.
 *
 * Environment note: default Jest runs pin TZ=Europe/Istanbul (no DST since 2016);
 * real northern/southern DST zones (`America/New_York`, `Pacific/Auckland`, `UTC`)
 * are exercised by `dstMatrix.test.ts` and `npm run test:tz` (which also runs this
 * suite across all four zones).
 */
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));

import type { Habit, FrequencyConfig } from '../../lib/supabase';
import { isEligibleOn, carriesDayLoad } from '../../lib/habitSchedule';
import { planReminders, DEFAULT_REMINDER_SETTINGS } from '../../lib/reminderPlan';
import { habitAveragePercent } from '../../lib/reportMetrics';
import { recoveryBacklog } from '../../lib/recoveryBacklog';
import { addDaysLocal, ymd, parseLocalDate } from '../../lib/date';
import { selectTodayHabits } from '../../app/tabs/today';
import { blocksOn, layoutDayStrip, nextBlockInfo } from '../../lib/nextBlock';
import { planTaskReminders } from '../../lib/taskReminderPlan';

function habit(id: string, fc: FrequencyConfig): Habit {
  return {
    id, user_id: 'u1', name: id, behavior_type: 'positive', tracking_type: 'boolean', status: 'active',
    frequency_config: fc, created_at: '2020-01-01T00:00:00Z', end_condition: null, target_direction: null,
    reminders: { enabled: true, time: '09:00', times: ['09:00'] },
  } as unknown as Habit;
}

const DAY_HABITS: Habit[] = [
  habit('daily', { kind: 'daily' }),
  habit('tue-thu-sun', { kind: 'weekly', days: [1, 3, 6] }),
  habit('every3', { kind: 'daily', interval_days: 3, range_start: '2026-01-01' }),
  habit('m31-last', { kind: 'monthly', month_days: [31], short_month: 'last_day' }),
  habit('m29to31-skip', { kind: 'monthly', month_days: [29, 30, 31], short_month: 'skip' }),
  habit('feb29-feb28', { kind: 'yearly', month: 2, day: 29, leap_day: 'feb28' }),
  habit('feb29-mar1', { kind: 'yearly', month: 2, day: 29, leap_day: 'mar1' }),
  habit('ranged', { kind: 'daily', range_start: '2026-03-01', range_end: '2026-03-29' }),
];

const DATES = [
  '2025-12-31', '2026-01-01',                 // New Year midnight
  '2026-01-31', '2026-02-28', '2026-03-01',   // month end, non-leap February
  '2026-03-29', '2026-03-30',                 // EU spring DST change
  '2026-04-30', '2026-05-01',
  '2026-10-25', '2026-10-26',                 // EU autumn DST change
  '2027-02-28', '2027-03-01',
  '2028-02-28', '2028-02-29', '2028-03-01',   // leap year
];
const HOURS: [number, number, number][] = [[0, 0, 30], [12, 0, 0], [23, 59, 30]];
const at = (ds: string, [h, m, s]: [number, number, number]) => { const d = parseLocalDate(ds)!; return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, s); };

describe('R01.07 — every consumer agrees with the canonical day, at every hour of the fixture days', () => {
  for (const h of DAY_HABITS) {
    for (const ds of DATES) {
      it(`${h.id} on ${ds}`, () => {
        const canonical = isEligibleOn(h, parseLocalDate(ds)!);
        for (const hms of HOURS) {
          const when = at(ds, hms);
          // the canonical answer does not depend on the hour
          expect(isEligibleOn(h, when)).toBe(canonical);
          // Today
          expect(selectTodayHabits([h], when).length === 1).toBe(canonical);
          // capacity: the day's load
          expect(carriesDayLoad(h, [], when)).toBe(canonical);
        }
        // reminders: planned from the previous evening, for this local day
        const prev = addDaysLocal(parseLocalDate(ds)!, -1);
        const plan = planReminders({ habits: [h], logs: [], settings: DEFAULT_REMINDER_SETTINGS, now: new Date(prev.getFullYear(), prev.getMonth(), prev.getDate(), 20, 0), horizonDays: 3 });
        expect(plan.reminders.some((r) => r.day === ds)).toBe(canonical);
        // reports: a done log counts on a due day and nowhere else (null = no due day in range, F13 INT-06)
        const pct = habitAveragePercent({ habits: [h], logs: [{ habit_id: h.id, completed_at: ds, state: 'done', value: null }], start: ds, end: ds });
        expect(pct).toBe(canonical ? 100 : null);
        // recovery: the next morning, an unlogged due day is in the backlog
        const next = at(ymd(addDaysLocal(parseLocalDate(ds)!, 1)), [0, 0, 30]);
        const backlog = recoveryBacklog({ habits: [h], today: next, doneSet: new Set(), partialSet: new Set(), missedSet: new Set(), lookback: 1 });
        expect(backlog.some((e) => e.date === ds)).toBe(canonical);
      });
    }
  }
});

describe('R01.07 — the fixtures really discriminate (not a vacuous agreement)', () => {
  const E = (id: string, ds: string) => isEligibleOn(DAY_HABITS.find((h) => h.id === id)!, parseLocalDate(ds)!);
  it('month ends and 29 February', () => {
    expect(['2026-01-31', '2026-02-28', '2026-04-30'].map((d) => E('m31-last', d))).toEqual([true, true, true]);
    expect(['2026-02-28', '2026-03-01', '2026-04-30'].map((d) => E('m29to31-skip', d))).toEqual([false, false, true]);
    expect(['2027-02-28', '2027-03-01', '2028-02-28', '2028-02-29'].map((d) => E('feb29-feb28', d))).toEqual([true, false, false, true]);
    expect(['2027-02-28', '2027-03-01', '2028-02-29', '2028-03-01'].map((d) => E('feb29-mar1', d))).toEqual([false, true, true, false]);
  });
  it('the envelope ends on its last day, DST day included', () => {
    expect(['2026-03-29', '2026-03-30'].map((d) => E('ranged', d))).toEqual([true, false]);
  });
  it('weekday map across New Year (Wed 31 Dec 2025, Thu 1 Jan 2026)', () => {
    expect(['2025-12-31', '2026-01-01'].map((d) => E('tue-thu-sun', d))).toEqual([false, true]);
  });
});

describe('R01.07 — a count schedule: Today, reminders and the day load agree on "period met"', () => {
  const weekly3 = habit('weekly3', { kind: 'weekly', count: 3 });
  // ISO week Mon 2026-03-23 .. Sun 2026-03-29 (the DST Sunday); done Mon, Tue, Wed.
  const logs = ['2026-03-23', '2026-03-24', '2026-03-25'].map((d) => ({ habit_id: 'weekly3', completed_at: d, state: 'done', value: null }));
  const week = Array.from({ length: 7 }, (_, i) => addDaysLocal(new Date(2026, 2, 23), i));
  it('shown and loaded Mon..Wed, done from Thu; reminders only Mon..Wed', () => {
    const today = week.map((d) => selectTodayHabits([weekly3], d, logs as never).length === 1);
    const load = week.map((d) => carriesDayLoad(weekly3, logs as never, d));
    expect(today).toEqual([true, true, true, false, false, false, false]);
    expect(load).toEqual(today);
    const plan = planReminders({ habits: [weekly3], logs, settings: DEFAULT_REMINDER_SETTINGS, now: new Date(2026, 2, 22, 20, 0), horizonDays: 8 });
    // the planner sees only logs BEFORE each day; with all three logs known it plans none after Wed
    expect(week.map((d) => plan.reminders.some((r) => r.day === ymd(d)))).toEqual([true, true, true, false, false, false, false]);
  });
  it('the recovery backlog never holds a count schedule day', () => {
    const b = recoveryBacklog({ habits: [weekly3], today: new Date(2026, 2, 30), doneSet: new Set(), partialSet: new Set(), missedSet: new Set() });
    expect(b).toEqual([]);
  });
});

describe('R01.07 — additive schema: old rows count exactly as before', () => {
  it('a log with the new tz field and one without give the same report and load', () => {
    const h = DAY_HABITS[0];
    const old = [{ habit_id: h.id, completed_at: '2026-03-29', state: 'done' as const, value: null }];
    const withTz = [{ ...old[0], tz: 'Europe/Istanbul' }];
    const r = (logs: typeof old) => habitAveragePercent({ habits: [h], logs, start: '2026-03-23', end: '2026-03-29' });
    expect(r(withTz)).toBe(r(old));
    expect(r(old)).toBe(Math.round(100 / 7));
  });
});

describe('F36 — (due_date, time_block_start) cross-consumer instant agreement', () => {
  it.each(DATES)('NextUp, DayTimeStrip and planTaskReminders derive the identical start instant on %s', (ds) => {
    const fixtureTask = {
      id: `tb-${ds}`,
      title: 'Zaman bloğu',
      due_date: `${ds}T00:00:00+00:00`,
      time_block_start: '15:30',
      time_block_end: '16:15',
      completed: false,
      status: 'pending',
      priority: 'medium' as const,
    };

    const blocks = blocksOn([fixtureTask], ds);
    expect(blocks).toHaveLength(1);
    const canonicalStartMs = blocks[0].start.getTime();

    const strip = layoutDayStrip(blocks, at(ds, [12, 0, 0]));
    const stripBlock = strip.items.find((i) => i.kind === 'block');
    expect(stripBlock?.kind === 'block' && stripBlock.block.start.getTime()).toBe(canonicalStartMs);

    const next = nextBlockInfo([fixtureTask], at(ds, [12, 0, 0]));
    expect(next?.block.start.getTime()).toBe(canonicalStartMs);

    const planned = planTaskReminders({
      tasks: [fixtureTask],
      settings: { quietStart: null, quietEnd: null, hideTitles: false },
      support: { taskLeadMin: 30 },
      now: at(ds, [12, 0, 0]),
    });
    expect(planned.reminders).toHaveLength(1);
    expect(planned.reminders[0].at.getTime()).toBe(canonicalStartMs - 30 * 60_000);
  });
});
