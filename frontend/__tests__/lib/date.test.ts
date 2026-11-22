/**
 * L1 tests for the canonical date module.  (task 1E-L1a)
 *
 * Covers AC-D01, D03-D08 and AC-H03's date half. Every case pins a clock, so
 * "what happens at 00:30" is a fact rather than a function of when CI runs.
 *
 * TZ is Europe/Istanbul (UTC+3), pinned in jest.setup.js. That zone is chosen
 * because it is the product's zone AND because a positive offset is where the
 * `toISOString()` bug bites: between 00:00 and 03:00 local, UTC is still
 * yesterday.
 */
import {
  ymd, todayLocal, parseLocalDate, startOfWeekLocal,
  weekStartYmd, addDaysLocal, daysBetweenLocal, isSameLocalDay, ymLocal, ymdFromIso,
} from '../../lib/date';
import { describeIstanbul, IS_ISTANBUL, TEST_ZONE } from '../helpers/zone';

describe('TZ is pinned', () => {
  it('runs under TEST_ZONE (Europe/Istanbul by default)', () => {
    expect(process.env.TZ).toBe(TEST_ZONE);
    if (IS_ISTANBUL) {
      // UTC+3 in August. If this fails, every Istanbul-specific assertion below is meaningless.
      expect(new Date(2026, 7, 4, 12, 0, 0).getTimezoneOffset()).toBe(-180);
    }
  });
});

describe('ymd', () => {
  it('renders the LOCAL calendar date', () => {
    expect(ymd(new Date(2026, 7, 4, 12, 0, 0))).toBe('2026-08-04');
  });

  it('pads single-digit month and day', () => {
    expect(ymd(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });

  it('AC-D01 — at 00:30 local it is TODAY, not yesterday', () => {
    const at0030 = new Date(2026, 7, 4, 0, 30, 0);
    expect(ymd(at0030)).toBe('2026-08-04');
  });

  describeIstanbul('AC-D01 (Europe/Istanbul UTC+3)', () => {
    it('pins the UTC truncation defect at 00:30 Istanbul', () => {
      // The defect: toISOString() here yields 2026-08-03T21:30Z -> "2026-08-03".
      const at0030 = new Date(2026, 7, 4, 0, 30, 0);
      expect(ymd(at0030)).toBe('2026-08-04');
      expect(at0030.toISOString().slice(0, 10)).toBe('2026-08-03'); // the bug, pinned
    });
  });

  it('at 23:30 local it is still today', () => {
    expect(ymd(new Date(2026, 7, 4, 23, 30, 0))).toBe('2026-08-04');
  });

  it('holds across a month boundary at 00:30', () => {
    expect(ymd(new Date(2026, 8, 1, 0, 30, 0))).toBe('2026-09-01');
  });

  it('holds across a year boundary at 00:30', () => {
    expect(ymd(new Date(2027, 0, 1, 0, 30, 0))).toBe('2027-01-01');
  });
});

describe('todayLocal', () => {
  it('accepts an injectable clock', () => {
    expect(todayLocal(new Date(2026, 7, 4, 0, 30, 0))).toBe('2026-08-04');
    expect(todayLocal(new Date(2026, 7, 4, 23, 30, 0))).toBe('2026-08-04');
  });

  it('defaults to now and returns a well-formed date', () => {
    expect(todayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('parseLocalDate', () => {
  it('parses to LOCAL midnight, not UTC midnight', () => {
    const d = parseLocalDate('2026-08-04')!;
    expect(d).not.toBeNull();
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(7);
    expect(d.getDate()).toBe(4);
    expect(d.getHours()).toBe(0);
  });

  it('round-trips with ymd', () => {
    for (const s of ['2026-01-01', '2026-08-04', '2026-12-31']) {
      expect(ymd(parseLocalDate(s)!)).toBe(s);
    }
  });

  it('rejects malformed input instead of guessing', () => {
    for (const s of ['', '2026-8-4', '04/08/2026', 'yesterday', '2026-13-01']) {
      expect(parseLocalDate(s)).toBeNull();
    }
  });

  it('rejects a date that does not exist rather than rolling it over', () => {
    // new Date(2026, 1, 30) silently becomes 2 March.
    expect(parseLocalDate('2026-02-30')).toBeNull();
  });

  it('accepts a real leap day', () => {
    expect(ymd(parseLocalDate('2028-02-29')!)).toBe('2028-02-29');
  });
});

describe('startOfWeekLocal', () => {
  it('returns Monday for a mid-week date', () => {
    // 2026-08-04 is a Tuesday.
    expect(ymd(startOfWeekLocal(new Date(2026, 7, 4, 12, 0)))).toBe('2026-08-03');
  });

  it('AC-D08 — Sunday 22:00 belongs to the week that is CLOSING', () => {
    // The defect: a Sunday-start week put this session in the next week.
    const sunday2200 = new Date(2026, 7, 9, 22, 0, 0);
    expect(sunday2200.getDay()).toBe(0);
    expect(ymd(startOfWeekLocal(sunday2200))).toBe('2026-08-03');
  });

  it('is idempotent on a Monday', () => {
    const monday = new Date(2026, 7, 3, 0, 0, 0);
    expect(ymd(startOfWeekLocal(monday))).toBe('2026-08-03');
    expect(ymd(startOfWeekLocal(startOfWeekLocal(monday)))).toBe('2026-08-03');
  });

  it('normalises to local midnight', () => {
    const s = startOfWeekLocal(new Date(2026, 7, 4, 23, 59, 59));
    expect(s.getHours()).toBe(0);
    expect(s.getMinutes()).toBe(0);
  });

  it('weekStartYmd agrees', () => {
    expect(weekStartYmd(new Date(2026, 7, 9, 22, 0))).toBe('2026-08-03');
  });
});

describe('addDaysLocal', () => {
  it('crosses a month boundary', () => {
    expect(ymd(addDaysLocal(new Date(2026, 7, 31, 12, 0), 1))).toBe('2026-09-01');
  });

  it('goes backwards', () => {
    expect(ymd(addDaysLocal(new Date(2026, 8, 1, 12, 0), -1))).toBe('2026-08-31');
  });

  it('normalises to local midnight', () => {
    expect(addDaysLocal(new Date(2026, 7, 4, 23, 59), 0).getHours()).toBe(0);
  });
});

describe('daysBetweenLocal / isSameLocalDay', () => {
  it('ignores time of day', () => {
    const a = new Date(2026, 7, 4, 23, 59, 59);
    const b = new Date(2026, 7, 5, 0, 0, 1);
    expect(daysBetweenLocal(a, b)).toBe(1);
  });

  it('is zero within one day and signed across', () => {
    expect(daysBetweenLocal(new Date(2026, 7, 4, 1, 0), new Date(2026, 7, 4, 23, 0))).toBe(0);
    expect(daysBetweenLocal(new Date(2026, 7, 5), new Date(2026, 7, 4))).toBe(-1);
  });

  it('isSameLocalDay tracks the local day, not the UTC one', () => {
    // Both are 2026-08-04 locally; in UTC the first is still 2026-08-03.
    expect(isSameLocalDay(new Date(2026, 7, 4, 0, 30), new Date(2026, 7, 4, 23, 30))).toBe(true);
    expect(isSameLocalDay(new Date(2026, 7, 4, 23, 59), new Date(2026, 7, 5, 0, 1))).toBe(false);
  });
});

describe('ymLocal', () => {
  it('returns the local month, not the UTC one', () => {
    // 2026-09-01 01:00 local is 2026-08-31T22:00Z -- still August in UTC.
    expect(ymLocal(new Date(2026, 8, 1, 1, 0))).toBe('2026-09');
  });

  it('agrees with ymd by construction', () => {
    for (const d of [new Date(2026, 0, 1, 0, 30), new Date(2026, 11, 31, 23, 30), new Date(2026, 7, 4, 12)]) {
      expect(ymLocal(d)).toBe(ymd(d).slice(0, 7));
    }
  });

  it('pads single-digit months', () => {
    expect(ymLocal(new Date(2026, 2, 9))).toBe('2026-03');
  });
});

describe('ymdFromIso', () => {
  describeIstanbul('Europe/Istanbul UTC+3 boundary', () => {
    it('maps a stored UTC instant onto the LOCAL day it happened', () => {
      // 2026-08-03T22:00Z is 2026-08-04 01:00 in Istanbul.
      expect(ymdFromIso('2026-08-03T22:00:00.000Z')).toBe('2026-08-04');
      // The naive truncation gets this wrong, which is the whole point.
      expect('2026-08-03T22:00:00.000Z'.split('T')[0]).toBe('2026-08-03');
    });
  });

  it('leaves an instant that does not cross the boundary alone', () => {
    expect(ymdFromIso('2026-08-04T09:00:00.000Z')).toBe('2026-08-04');
  });

  it('round-trips whatever ymd produced', () => {
    const d = new Date(2026, 7, 4, 1, 0);
    expect(ymdFromIso(d.toISOString())).toBe(ymd(d));
  });

  it("returns '' for absent or unparseable input, so callers need no null branch", () => {
    expect(ymdFromIso(null)).toBe('');
    expect(ymdFromIso(undefined)).toBe('');
    expect(ymdFromIso('')).toBe('');
    expect(ymdFromIso('not a date')).toBe('');
  });

  it("sorts '' below every real key, so a missing date never lands inside a range", () => {
    expect('' >= '2026-08-01').toBe(false);
  });
});
