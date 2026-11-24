/**
 * F15 (TST-06): 4-zone calendar & DST matrix (`Europe/Istanbul`,
 * `America/New_York`, `Pacific/Auckland`, `UTC`).
 *
 * Exercises component-based local calendar arithmetic, week boundaries, and
 * `habitCreatedDay` stamped vs unstamped `every_n_days` schedules across
 * northern- and southern-hemisphere 23-hour / 25-hour DST transitions.
 */
import {
  addDaysLocal,
  daysBetweenLocal,
  parseLocalDate,
  weekStartYmd,
  ymd,
} from '../../lib/date';
import { habitCreatedDay } from '../../lib/habitCreatedDay';
import { isEligibleOn } from '../../lib/habitSchedule';
import type { FrequencyConfig, Habit } from '../../lib/supabase';
import { TEST_ZONE } from '../helpers/zone';

function utcYmdFromDayIndex(year: number, dayIndex0: number): string {
  const d = new Date(Date.UTC(year, 0, 1 + dayIndex0));
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function makeEvery3Habit(opts: { createdAt: string; createdDay?: unknown }): Habit {
  const fc: FrequencyConfig = {
    kind: 'daily',
    interval_days: 3,
    ...(opts.createdDay !== undefined ? { created_day: opts.createdDay as string } : {}),
  };
  return {
    id: 'h-dst',
    user_id: 'u-dst',
    name: '3 günde bir',
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: fc,
    willpower_cost: 2,
    status: 'active',
    impact_level: 'medium',
    urgency: 'not_urgent',
    difficulty: 3,
    estimated_minutes: 15,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: opts.createdAt,
  };
}

describe(`F15 dstMatrix — active zone (${TEST_ZONE})`, () => {
  it('(+) worker process runs under TEST_ZONE with matching V8 timezone offsets', () => {
    expect(process.env.TZ).toBe(TEST_ZONE);
    const janOffset = new Date(2026, 0, 15, 12, 0, 0).getTimezoneOffset() + 0;
    const augOffset = new Date(2026, 7, 4, 12, 0, 0).getTimezoneOffset() + 0;
    if (TEST_ZONE === 'Europe/Istanbul') {
      expect([janOffset, augOffset]).toEqual([-180, -180]);
    } else if (TEST_ZONE === 'America/New_York') {
      expect([janOffset, augOffset]).toEqual([300, 240]);
    } else if (TEST_ZONE === 'Pacific/Auckland') {
      expect([janOffset, augOffset]).toEqual([-780, -720]);
    } else if (TEST_ZONE === 'UTC') {
      expect([janOffset, augOffset]).toEqual([0, 0]);
    }
  });

  it('(+) all 365 days of 2026 round-trip through parseLocalDate -> ymd without drift', () => {
    for (let i = 0; i < 365; i += 1) {
      const s = utcYmdFromDayIndex(2026, i);
      const parsed = parseLocalDate(s);
      expect(parsed).not.toBeNull();
      expect(ymd(parsed!)).toBe(s);
    }
  });

  it.each([
    // America/New_York spring forward (23h) & fall back (25h)
    ['2026-03-07', '2026-03-08', '2026-03-09'],
    ['2026-10-31', '2026-11-01', '2026-11-02'],
    // Pacific/Auckland autumn fall back (25h) & spring forward (23h)
    ['2026-04-04', '2026-04-05', '2026-04-06'],
    ['2026-09-26', '2026-09-27', '2026-09-28'],
  ])('(+) addDaysLocal(+1/-1) and daysBetweenLocal stay exact across %s -> %s -> %s', (d0, d1, d2) => {
    const p0 = parseLocalDate(d0)!;
    const p1 = parseLocalDate(d1)!;
    const p2 = parseLocalDate(d2)!;

    expect(ymd(addDaysLocal(p0, 1))).toBe(d1);
    expect(ymd(addDaysLocal(p1, 1))).toBe(d2);
    expect(ymd(addDaysLocal(p2, -1))).toBe(d1);
    expect(ymd(addDaysLocal(p1, -1))).toBe(d0);

    expect(daysBetweenLocal(p0, p1)).toBe(1);
    expect(daysBetweenLocal(p1, p2)).toBe(1);
    expect(daysBetweenLocal(p0, p2)).toBe(2);
  });

  it.each([
    ['2026-03-08', '2026-03-02', '2026-03-09', '2026-03-09'],
    ['2026-11-01', '2026-10-26', '2026-11-02', '2026-11-02'],
    ['2026-04-05', '2026-03-30', '2026-04-06', '2026-04-06'],
    ['2026-09-27', '2026-09-21', '2026-09-28', '2026-09-28'],
  ])('(+) weekStartYmd keeps Sunday %s in closing week %s and starts new week on Monday %s', (sun, prevMon, mon, nextMon) => {
    const sunLate = parseLocalDate(sun)!;
    sunLate.setHours(23, 30, 0, 0);
    const monEarly = parseLocalDate(mon)!;
    monEarly.setHours(0, 30, 0, 0);

    expect(weekStartYmd(sunLate)).toBe(prevMon);
    expect(weekStartYmd(monEarly)).toBe(nextMon);
  });

  it('(+) stamped every_n_days (created_day: 2026-03-01, interval 3) produces identical due-day set across March..November', () => {
    const h = makeEvery3Habit({
      createdAt: '2026-02-28T22:30:00.000Z',
      createdDay: '2026-03-01',
    });
    // 2026-03-01 is day index 59 (Jan 31 + Feb 28 = 59). Walk 255 days through Nov 10.
    const expected: string[] = [];
    const actual: string[] = [];
    for (let offset = 0; offset < 255; offset += 1) {
      const dayStr = utcYmdFromDayIndex(2026, 59 + offset);
      if (offset % 3 === 0) expected.push(dayStr);
      if (isEligibleOn(h, parseLocalDate(dayStr)!)) actual.push(dayStr);
    }
    expect(actual).toEqual(expected);
  });

  it('(+) DOM-12 stamped habit (created_day 2026-08-01) is eligible on Aug 1 and Aug 4 in every zone regardless of created_at UTC day', () => {
    const augDays = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'];
    for (const createdAt of ['2026-07-31T23:00:00.000Z', '2026-08-02T03:00:00.000Z']) {
      const stamped = makeEvery3Habit({
        createdAt,
        createdDay: '2026-08-01',
      });
      expect(habitCreatedDay(stamped)).toBe('2026-08-01');
      const eligible = augDays.filter((d) => isEligibleOn(stamped, parseLocalDate(d)!));
      expect(eligible).toEqual(['2026-08-01', '2026-08-04']);
    }
  });

  it('(-) DOM-12 unstamped legacy row shifts anchor by zone, and malformed stamps fall back to created_at', () => {
    const unstamped = makeEvery3Habit({
      createdAt: '2026-07-31T23:00:00.000Z',
    });
    const augDays = ['2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06'];
    const eligible = augDays.filter((d) => isEligibleOn(unstamped, parseLocalDate(d)!));

    const expectedCreated =
      TEST_ZONE === 'Europe/Istanbul' || TEST_ZONE === 'Pacific/Auckland'
        ? '2026-08-01'
        : '2026-07-31';
    const expectedEligible =
      expectedCreated === '2026-08-01'
        ? ['2026-08-01', '2026-08-04']
        : ['2026-08-03', '2026-08-06'];

    expect(habitCreatedDay(unstamped)).toBe(expectedCreated);
    expect(eligible).toEqual(expectedEligible);

    for (const badStamp of ['2026-02-30', 'x']) {
      const malformed = makeEvery3Habit({
        createdAt: '2026-07-31T23:00:00.000Z',
        createdDay: badStamp,
      });
      expect(habitCreatedDay(malformed)).toBe(expectedCreated);
    }
  });
});
