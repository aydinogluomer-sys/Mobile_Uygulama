/**
 * F03 — the loggable-day window of the client (lib/date.ts) and its fit inside the
 * server's (migration 038, fn_habit_log_guard).
 *
 * The client allows today and the previous 14 LOCAL days; the server refuses a log
 * outside [CURRENT_DATE - 15, CURRENT_DATE + 1] in UTC. The server window is read
 * from the migration file itself, so a change on either side that breaks the
 * "client inside server" property turns this file red.
 *
 * jest pins TZ to Europe/Istanbul (jest.setup.js), a zone without DST since 2016:
 * the DST cases below therefore check the property that makes DST irrelevant (the
 * window is counted in calendar days on `YYYY-MM-DD` strings, never in hours).
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  LOGGABLE_DAYS_AHEAD,
  LOGGABLE_DAYS_BACK,
  daysBetweenLocal,
  isLoggableDay,
  loggableDayRange,
  parseLocalDate,
} from '../../lib/date';
import { RECOVERY_LOOKBACK } from '../../lib/recoveryBacklog';

const NOW = new Date(2026, 7, 4, 12, 0, 0); // 4 Aug 2026, local noon

const migration = readFileSync(
  join(__dirname, '..', '..', '..', 'supabase', 'migrations', '038_xp_streak_integrity.sql'),
  'utf8',
);
const serverConstant = (name: string): number => {
  const m = new RegExp(`${name} constant integer := (\\d+);`).exec(migration);
  if (!m) throw new Error(`038 does not declare ${name}`);
  return Number(m[1]);
};

describe('loggableDayRange', () => {
  it('is today and the previous 14 days (inclusive)', () => {
    expect(loggableDayRange(NOW)).toEqual({ earliest: '2026-07-21', latest: '2026-08-04' });
  });

  it('crosses a month end in a common year', () => {
    expect(loggableDayRange(new Date(2026, 2, 1))).toEqual({ earliest: '2026-02-15', latest: '2026-03-01' });
  });

  it('counts 29 February in a leap year', () => {
    expect(loggableDayRange(new Date(2024, 2, 1)).earliest).toBe('2024-02-16');
  });

  it('crosses a year end', () => {
    expect(loggableDayRange(new Date(2026, 0, 5))).toEqual({ earliest: '2025-12-22', latest: '2026-01-05' });
  });

  it.each([
    ['last Sunday of March (EU clocks forward)', new Date(2026, 2, 29, 12)],
    ['last Sunday of October (EU clocks back)', new Date(2026, 9, 25, 12)],
  ])('spans exactly 14 calendar days on %s', (_label, now) => {
    const { earliest, latest } = loggableDayRange(now);
    expect(daysBetweenLocal(parseLocalDate(earliest)!, parseLocalDate(latest)!)).toBe(14);
  });

  it('gives the same day just after midnight and just before the next one', () => {
    expect(loggableDayRange(new Date(2026, 7, 4, 0, 0, 1))).toEqual(loggableDayRange(new Date(2026, 7, 4, 23, 59, 59)));
  });
});

describe('isLoggableDay', () => {
  it('accepts today, yesterday and the 14th day back', () => {
    expect(isLoggableDay('2026-08-04', NOW)).toBe(true);
    expect(isLoggableDay('2026-08-03', NOW)).toBe(true);
    expect(isLoggableDay('2026-07-21', NOW)).toBe(true);
  });

  it('accepts a Date as well as a YYYY-MM-DD string', () => {
    expect(isLoggableDay(new Date(2026, 7, 4, 23, 59), NOW)).toBe(true);
    expect(isLoggableDay(new Date(2026, 6, 21, 0, 0), NOW)).toBe(true);
  });

  it('refuses tomorrow and the 15th day back', () => {
    expect(isLoggableDay('2026-08-05', NOW)).toBe(false);
    expect(isLoggableDay('2026-07-20', NOW)).toBe(false);
    expect(isLoggableDay(new Date(2026, 7, 5, 0, 0), NOW)).toBe(false);
  });

  it('refuses what is not a real YYYY-MM-DD day', () => {
    // '2026-07-32' and '2026-08-00' sort INSIDE the window as strings: only the real-date check refuses them
    for (const bad of ['2026-02-30', '2026-07-32', '2026-08-00', '', 'bugün', '2026-8-4', '2026-08-04T00:00:00', ' 2026-08-04']) {
      expect({ bad, ok: isLoggableDay(bad, NOW) }).toEqual({ bad, ok: false });
    }
  });

  it('refuses an invalid Date, and anything when the clock itself is invalid', () => {
    expect(isLoggableDay(new Date('x'), NOW)).toBe(false);
    expect(isLoggableDay('2026-08-04', new Date('x'))).toBe(false);
  });

  it('reads the device clock when no clock is injected', () => {
    jest.useFakeTimers({ now: NOW });
    try {
      expect(isLoggableDay('2026-08-04')).toBe(true);
      expect(isLoggableDay('2026-07-20')).toBe(false);
      expect(loggableDayRange()).toEqual({ earliest: '2026-07-21', latest: '2026-08-04' });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('the client window fits the recovery screen and sits inside the server window', () => {
  it('equals the recovery look-back, so every make-up day the recovery screen offers can be saved', () => {
    expect(LOGGABLE_DAYS_BACK).toBe(RECOVERY_LOOKBACK);
    expect(LOGGABLE_DAYS_AHEAD).toBe(0);
  });

  it('the server keeps exactly one day of timezone tolerance on each side (read from 038)', () => {
    expect(serverConstant('c_days_back')).toBe(LOGGABLE_DAYS_BACK + 1);
    expect(serverConstant('c_days_ahead')).toBe(LOGGABLE_DAYS_AHEAD + 1);
  });

  /**
   * Pure day arithmetic: an instant `t` (minutes since the epoch, UTC) seen by a device at
   * offset `o` hours. The device's local day is floor((t + o*60) / 1440); the server's
   * CURRENT_DATE is floor(t / 1440). Every day the client accepts must be one the server accepts.
   * Returns the offending cases and how many (instant, offset, day) cases were checked.
   */
  const outsideServer = (server: { back: number; ahead: number }, client: { back: number; ahead: number }) => {
    const base = Math.floor(Date.UTC(2026, 7, 4) / 60000);
    const violations: string[] = [];
    let checked = 0;
    for (let offset = -12; offset <= 14; offset++) {
      for (let minute = 0; minute < 2 * 1440; minute += 60) {
        const t = base + minute;
        const localDay = Math.floor((t + offset * 60) / 1440);
        const serverDay = Math.floor(t / 1440);
        for (let day = localDay - client.back; day <= localDay + client.ahead; day++) {
          checked++;
          if (day < serverDay - server.back || day > serverDay + server.ahead) {
            violations.push(`offset ${offset} minute ${minute} day ${day - serverDay}`);
          }
        }
      }
    }
    return { violations, checked };
  };

  it('for every offset from UTC-12 to UTC+14 and every hour of two days', () => {
    const server = { back: serverConstant('c_days_back'), ahead: serverConstant('c_days_ahead') };
    const { violations, checked } = outsideServer(server, { back: LOGGABLE_DAYS_BACK, ahead: LOGGABLE_DAYS_AHEAD });
    expect(checked).toBe(27 * 48 * (LOGGABLE_DAYS_BACK + LOGGABLE_DAYS_AHEAD + 1));
    expect(violations).toEqual([]);
  });

  it('the same arithmetic finds the gaps when the server keeps no tolerance (negative control)', () => {
    const tight = outsideServer({ back: LOGGABLE_DAYS_BACK, ahead: LOGGABLE_DAYS_AHEAD }, { back: LOGGABLE_DAYS_BACK, ahead: LOGGABLE_DAYS_AHEAD });
    // east of UTC the local day runs ahead of the server's; west of it, behind
    expect(tight.violations.some((v) => v.endsWith('day 1'))).toBe(true);
    expect(tight.violations.some((v) => v.endsWith('day -15'))).toBe(true);
  });
});
