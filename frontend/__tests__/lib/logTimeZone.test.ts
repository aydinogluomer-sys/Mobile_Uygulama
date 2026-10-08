/**
 * R01.06 — "Yerel gün ve timezone kaydı tek sözleşmeden gelsin."
 *
 * One contract (`lib/date.ts` `localDayStamp`) gives both the local day a log
 * is keyed by and the IANA zone it was written in. The zone is captured at
 * TAP time and travels with the queued intent, so an offline log replayed
 * after a flight still records the zone the user was in. It reaches the wire
 * only behind LOG_TIMEZONE_ENABLED (false until migration 033 is applied),
 * so no write names a column that does not exist yet.
 */
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));
import { localDayStamp, deviceTimeZone, todayLocal } from '../../lib/date';
import { toPatch } from '../../services/habitLogService';
import { LOG_TIMEZONE_ENABLED } from '../../lib/featureGates';
import * as fs from 'fs';
import * as path from 'path';

describe('R01.06 — the local-day + zone contract', () => {
  it('the day is the LOCAL calendar day, the zone is the device zone', () => {
    const late = new Date(2026, 2, 29, 23, 30); // 23:30 local on a DST-change day in Europe
    const s = localDayStamp(late);
    expect(s.date).toBe('2026-03-29');
    expect(s.date).toBe(todayLocal(late));
    expect(s.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it('just after local midnight is the NEW day, not the UTC one', () => {
    expect(localDayStamp(new Date(2026, 0, 1, 0, 5)).date).toBe('2026-01-01');
    expect(localDayStamp(new Date(2025, 11, 31, 23, 55)).date).toBe('2025-12-31');
  });

  it('a runtime without Intl zones yields null, never a guessed zone', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({ resolvedOptions: () => ({ timeZone: undefined }) }) as any);
    try {
      expect(deviceTimeZone()).toBeNull();
      expect(localDayStamp(new Date(2026, 5, 1)).tz).toBeNull();
    } finally { spy.mockRestore(); }
  });

  it('an over-long or empty zone string is dropped (the column CHECK is 1..64)', () => {
    const spy = jest.spyOn(Intl, 'DateTimeFormat').mockImplementation(() => ({ resolvedOptions: () => ({ timeZone: 'x'.repeat(65) }) }) as any);
    try { expect(deviceTimeZone()).toBeNull(); } finally { spy.mockRestore(); }
  });

  it('toPatch carries the tap-time zone, and only when the intent has one', () => {
    expect(toPatch({ state: 'done', tz: 'Europe/Istanbul' })).toMatchObject({ tz: 'Europe/Istanbul' });
    expect('tz' in toPatch({ state: 'done' })).toBe(false); // old queued ops replay unchanged
  });
});

describe('R01.06 — the migration is written, not applied', () => {
  const raw = (p: string) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
  it('033 adds one nullable, bounded column and says it is not applied', () => {
    const sql = raw('../supabase/migrations/033_habit_log_timezone.sql');
    expect(sql).toMatch(/STATUS: WRITTEN, NOT APPLIED/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS tz text;/);
    expect(sql).toMatch(/char_length\(tz\) BETWEEN 1 AND 64/);
    expect(sql).not.toMatch(/UPDATE|DELETE|DROP TABLE|DROP COLUMN/i);
    expect(raw('../supabase/migrations/README.md')).toMatch(/\| 033 \| `033_habit_log_timezone\.sql` \| \*\*NOT APPLIED\*\*/);
  });
  it('the gate that guards the wire is false', () => {
    expect(LOG_TIMEZONE_ENABLED).toBe(false);
  });
});

describe('R01.06 — one source for the zone', () => {
  it('only lib/date.ts asks the runtime for the zone', () => {
        const root = path.join(__dirname, '../..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(e.name) && /resolvedOptions\(\)\.timeZone/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p).split(path.sep).join('/'));
      }
    };
    for (const d of ['app', 'components', 'lib', 'services', 'store', 'repositories', 'hooks']) if (fs.existsSync(path.join(root, d))) walk(path.join(root, d));
    expect(hits).toEqual(['lib/date.ts']);
  });
});
