/**
 * F15 (REP-10 / INT-25): `localDayStartIso` and `localDayRangeIso` half-open
 * UTC instant intervals for local calendar day windows.
 */
import { localDayRangeIso, localDayStartIso } from '../../lib/date';

const TEST_ZONE = process.env.TEST_TZ || 'Europe/Istanbul';
const IS_ISTANBUL = TEST_ZONE === 'Europe/Istanbul';
const describeIstanbul: typeof describe = IS_ISTANBUL ? describe : describe.skip;

function wallClockInZone(
  instantMs: number,
  zone: string,
): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instantMs));
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = Number(p.value);
  }
  return {
    y: map.year,
    m: map.month,
    d: map.day,
    hh: map.hour,
    mm: map.minute,
    ss: map.second,
  };
}

describe('localDayStartIso & localDayRangeIso (lib/date.ts)', () => {
  it('(+) localDayStartIso returns the exact first instant of the local calendar day', () => {
    expect(typeof localDayStartIso).toBe('function');
    for (const [day, y, m, d, prevY, prevM, prevD] of [
      ['2026-01-01', 2026, 1, 1, 2025, 12, 31],
      ['2026-08-04', 2026, 8, 4, 2026, 8, 3],
      ['2026-11-02', 2026, 11, 2, 2026, 11, 1],
    ] as const) {
      const iso = localDayStartIso(day);
      expect(iso).not.toBeNull();
      const ms = Date.parse(iso!);
      expect(wallClockInZone(ms, TEST_ZONE)).toEqual({
        y,
        m,
        d,
        hh: 0,
        mm: 0,
        ss: 0,
      });
      const before = wallClockInZone(ms - 1, TEST_ZONE);
      expect({ y: before.y, m: before.m, d: before.d }).toEqual({
        y: prevY,
        m: prevM,
        d: prevD,
      });
    }
  });

  it('(+) localDayRangeIso builds a half-open [start 00:00, end + 1 day 00:00) interval', () => {
    expect(typeof localDayRangeIso).toBe('function');
    const range = localDayRangeIso('2026-11-02', '2026-11-08');
    expect(range).not.toBeNull();
    expect(range).toEqual({
      startIso: localDayStartIso('2026-11-02'),
      endExclusiveIso: localDayStartIso('2026-11-09'),
    });
    const endClock = wallClockInZone(Date.parse(range!.endExclusiveIso), TEST_ZONE);
    expect(endClock).toEqual({ y: 2026, m: 11, d: 9, hh: 0, mm: 0, ss: 0 });
  });

  it('(+) handles 23-hour and 25-hour DST days with exact wall-clock duration', () => {
    const nySpring = localDayRangeIso('2026-03-08', '2026-03-08')!;
    const nyAutumn = localDayRangeIso('2026-11-01', '2026-11-01')!;
    const nzAutumn = localDayRangeIso('2026-04-05', '2026-04-05')!;
    const nzSpring = localDayRangeIso('2026-09-27', '2026-09-27')!;

    const spanHours = (r: { startIso: string; endExclusiveIso: string }) =>
      (Date.parse(r.endExclusiveIso) - Date.parse(r.startIso)) / 3_600_000;

    if (TEST_ZONE === 'America/New_York') {
      expect(spanHours(nySpring)).toBe(23);
      expect(spanHours(nyAutumn)).toBe(25);
    } else if (TEST_ZONE === 'Pacific/Auckland') {
      expect(spanHours(nzAutumn)).toBe(25);
      expect(spanHours(nzSpring)).toBe(23);
    } else {
      expect(spanHours(nySpring)).toBe(24);
      expect(spanHours(nyAutumn)).toBe(24);
      expect(spanHours(nzAutumn)).toBe(24);
      expect(spanHours(nzSpring)).toBe(24);
    }
  });

  it('(-) returns null for invalid dates, empty strings, and inverted ranges', () => {
    expect(localDayStartIso('')).toBeNull();
    expect(localDayStartIso('2026-02-30')).toBeNull();
    expect(localDayStartIso('2026-13-01')).toBeNull();
    expect(localDayStartIso('2026-8-4')).toBeNull();

    expect(localDayRangeIso('', '2026-11-08')).toBeNull();
    expect(localDayRangeIso('2026-11-02', '')).toBeNull();
    expect(localDayRangeIso('2026-02-30', '2026-03-02')).toBeNull();
    expect(localDayRangeIso('2026-11-02', '2026-02-30')).toBeNull();
    expect(localDayRangeIso('2026-11-09', '2026-11-08')).toBeNull();
  });

  describeIstanbul('Europe/Istanbul UTC+3 midnight boundary', () => {
    it('(+) maps 2026-11-02 local midnight to 2026-11-01T21:00:00.000Z', () => {
      expect(localDayStartIso('2026-11-02')).toBe('2026-11-01T21:00:00.000Z');
    });

    it('(-) UTC midnight 2026-11-02T00:00:00.000Z is 03:00 in Istanbul and NOT local midnight', () => {
      const utcMidnight = '2026-11-02T00:00:00.000Z';
      expect(wallClockInZone(Date.parse(utcMidnight), 'Europe/Istanbul')).toEqual({
        y: 2026,
        m: 11,
        d: 2,
        hh: 3,
        mm: 0,
        ss: 0,
      });
      expect(localDayStartIso('2026-11-02')).not.toBe(utcMidnight);
    });
  });
});
