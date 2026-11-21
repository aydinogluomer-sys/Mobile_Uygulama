/**
 * L1 tests for focus-report day bucketing.  (task 1B-007)
 *
 * AC-F01  a session started after local midnight counts on the LOCAL day
 * AC-F02  the day chart puts that session in the right bucket
 * AC-F03  the streak counts consecutive LOCAL days
 * AC-F04  the top-day ranking is keyed on the local day
 *
 * focus_sessions.started_at is written by focusStore as new Date().toISOString()
 * -- a full UTC instant. focusReport sliced its first 10 characters to get a
 * day key, then compared that UTC key against LOCAL keys produced by ymd().
 * At UTC+3 every session between 00:00 and 03:00 local therefore landed on the
 * previous day, or in no bucket at all. The same file already read hours with
 * new Date(started_at).getHours() -- local -- so it disagreed with itself.
 *
 * Written BEFORE the fix and observed to fail, per R-01.
 */
import { summary, buckets, ranking, toCSV, type FocusSessionRow } from '../../lib/focusReport';

/** Build a session that started at a given LOCAL wall-clock time. */
function at(y: number, m: number, d: number, h: number, over: Partial<FocusSessionRow> = {}): FocusSessionRow {
  const start = new Date(y, m - 1, d, h, 0, 0);
  return {
    id: `s-${y}${m}${d}-${h}`,
    task_id: null,
    task_title: 'x',
    mode: 'work',
    started_at: start.toISOString(),
    ended_at: new Date(start.getTime() + 25 * 60000).toISOString(),
    planned_seconds: 1500,
    completed_seconds: 1500,
    completed: true,
    ...over,
  };
}

describe('AC-F01 -- daysFocused counts local days', () => {
  it('treats 01:00 and 23:00 on the same local day as ONE day', () => {
    // 2026-08-04 01:00 local is 2026-08-03T22:00Z -- a different UTC date.
    const sessions = [at(2026, 8, 4, 1), at(2026, 8, 4, 23)];
    expect(summary(sessions).daysFocused).toBe(1);
  });

  it('still separates two genuinely different local days', () => {
    expect(summary([at(2026, 8, 4, 1), at(2026, 8, 5, 1)]).daysFocused).toBe(2);
  });

  it('proves the premise: these instants really do straddle a UTC date', () => {
    expect(at(2026, 8, 4, 1).started_at.slice(0, 10)).toBe('2026-08-03');
    expect(at(2026, 8, 4, 23).started_at.slice(0, 10)).toBe('2026-08-04');
  });
});

describe('AC-F02 -- the day chart buckets on the local day', () => {
  it('places a 01:00 session in its own local day, not the day before', () => {
    const now = new Date(2026, 7, 8, 12, 0, 0);       // Saturday 2026-08-08
    const b = buckets([at(2026, 8, 4, 1)], 'week', now);
    const monday = b.find((x) => x.key === '2026-08-03');
    const tuesday = b.find((x) => x.key === '2026-08-04');
    expect(tuesday?.seconds).toBe(1500);
    expect(monday?.seconds).toBe(0);
  });
});

describe('AC-F03 -- the streak walks local days', () => {
  it('counts a 01:00 session as today', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 4, 2, 0, 0));   // 02:00 local, still 08-03 in UTC
    try {
      expect(ranking([at(2026, 8, 4, 1)]).streak).toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('links two consecutive local days that both began after midnight', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 7, 5, 2, 0, 0));
    try {
      expect(ranking([at(2026, 8, 4, 1), at(2026, 8, 5, 1)]).streak).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('AC-F04 -- topDay is a local day', () => {
  it('attributes an after-midnight session to its local date', () => {
    const r = ranking([at(2026, 8, 4, 1)]);
    expect(r.topDay?.date).toBe('2026-08-04');
  });
});

describe('F20 -- 24-hour today buckets, range-independent streak, and CSV formula escape', () => {
  it('buckets("today") emits all 24 hours so after-midnight and late-night sessions match summary totalSeconds', () => {
    const now = new Date(2026, 7, 4, 14, 0, 0);
    const earlyStart = new Date(2026, 7, 4, 2, 30, 0);
    const lateStart = new Date(2026, 7, 4, 23, 15, 0);
    const sessions: FocusSessionRow[] = [
      at(2026, 8, 4, 2, {
        id: 's-0230',
        started_at: earlyStart.toISOString(),
        ended_at: new Date(earlyStart.getTime() + 1800 * 1000).toISOString(),
        completed_seconds: 1800,
      }),
      at(2026, 8, 4, 10, { id: 's-1000', completed_seconds: 1500 }),
      at(2026, 8, 4, 23, {
        id: 's-2315',
        started_at: lateStart.toISOString(),
        ended_at: new Date(lateStart.getTime() + 900 * 1000).toISOString(),
        completed_seconds: 900,
      }),
    ];
    const b = buckets(sessions, 'today', now);
    expect(b).toHaveLength(24);
    expect(b[0].label).toBe('00');
    expect(b[23].label).toBe('23');
    expect(b.find((x) => x.label === '02')?.seconds).toBe(1800);
    expect(b.find((x) => x.label === '10')?.seconds).toBe(1500);
    expect(b.find((x) => x.label === '23')?.seconds).toBe(900);
    const bucketSum = b.reduce((acc, x) => acc + x.seconds, 0);
    expect(bucketSum).toBe(summary(sessions).totalSeconds);
  });

  it('ranking computes streak from streakSessions even when filtered sessions only cover today', () => {
    const now = new Date(2026, 7, 8, 15, 0, 0);
    const fiveDays = [
      at(2026, 8, 4, 10),
      at(2026, 8, 5, 10),
      at(2026, 8, 6, 10),
      at(2026, 8, 7, 10),
      at(2026, 8, 8, 10),
    ];
    const todayOnly = [fiveDays[4]];
    const r = ranking(todayOnly, { streakSessions: fiveDays, now });
    expect(r.streak).toBe(5);
  });

  it('toCSV escapes leading formula characters in task titles', () => {
    const csv = toCSV([
      at(2026, 8, 4, 10, { task_title: "=CMD|' /C calc'!A0" }),
      at(2026, 8, 4, 11, { task_title: '=SUM(A1,A2)' }),
    ]);
    expect(csv).toContain("\n'=CMD|' /C calc'!A0,work,");
    expect(csv).toContain("\n\"'=SUM(A1,A2)\",work,");
  });
});
