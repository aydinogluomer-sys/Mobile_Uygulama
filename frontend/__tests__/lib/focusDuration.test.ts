/**
 * R05.06 — the shared focus duration contract.
 */
import { secondsToMinutes, parseManualMinutes, MAX_ENTRY_MINUTES } from '../../lib/focusDuration';
import { fmtDuration } from '../../lib/focusReport';
import { focusMinutesFromSessions } from '../../lib/reportMetrics';

describe('R05.06 — seconds to minutes', () => {
  it('rounds to the nearest minute', () => {
    expect(secondsToMinutes(0)).toBe(0);
    expect(secondsToMinutes(29)).toBe(0);
    expect(secondsToMinutes(30)).toBe(1);
    expect(secondsToMinutes(1500)).toBe(25);
    expect(secondsToMinutes(1529)).toBe(25);
  });

  it('never negative, never NaN', () => {
    expect(secondsToMinutes(-60)).toBe(0);
    expect(secondsToMinutes(Number.NaN)).toBe(0);
    expect(secondsToMinutes(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('the report and the review read the same minutes from the same seconds', () => {
    const sessions = [{ completed_seconds: 1200 }, { completed_seconds: 1529 }];
    const total = 1200 + 1529;
    expect(focusMinutesFromSessions(sessions)).toBe(secondsToMinutes(total));
    expect(fmtDuration(total)).toBe(`${secondsToMinutes(total)}d`);
  });
});

describe('R05.06 — a typed deep-work duration', () => {
  it('accepts whole minutes in range', () => {
    expect(parseManualMinutes('1')).toEqual({ ok: true, minutes: 1 });
    expect(parseManualMinutes(' 90 ')).toEqual({ ok: true, minutes: 90 });
    expect(parseManualMinutes(String(MAX_ENTRY_MINUTES))).toEqual({ ok: true, minutes: MAX_ENTRY_MINUTES });
    expect(parseManualMinutes(45)).toEqual({ ok: true, minutes: 45 });
  });

  it('refuses instead of clamping or rounding into another number', () => {
    for (const bad of ['', '0', '-5', '12.5', '1e3', 'abc', '60dk', String(MAX_ENTRY_MINUTES + 1)]) {
      const r = parseManualMinutes(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason.length).toBeGreaterThan(0);
    }
  });

  it('parseInt-style prefixes are not read as numbers', () => {
    // the old screen used parseInt: '60dk' -> 60, '1.5' -> 1
    expect(parseManualMinutes('60dk').ok).toBe(false);
    expect(parseManualMinutes('1.5').ok).toBe(false);
  });
});
