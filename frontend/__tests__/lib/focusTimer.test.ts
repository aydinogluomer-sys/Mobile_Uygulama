/**
 * R05.03 / KD-03 — the focus clock is the sum of its running segments.
 */
import {
  startClock, pauseClock, resumeClock, activeMs, completedSeconds, remainingSeconds,
  clockFromRemaining, snapshotOf, parseSnapshot, restoredClock, SESSION_SNAPSHOT_VERSION,
  SESSION_MAX_AGE_MS, MIN_PARTIAL_SECONDS, AWAY_MIN_MS, FOCUS_END_GRACE_MS,
  isSnapshotFresh, expectedEndMs, progressFraction, sessionSpan,
} from '../../lib/focusTimer';

const T0 = 1_800_000_000_000;
const MIN = 60_000;

describe('KD-03 — running segments', () => {
  it('a fresh session shows the full plan', () => {
    const c = startClock(1500, T0);
    expect(remainingSeconds(c, T0)).toBe(1500);
    expect(completedSeconds(c, T0)).toBe(0);
  });

  it('20 minutes of work with a 5-minute pause in it is 20 minutes of focus, not 25', () => {
    let c = startClock(1800, T0);
    c = pauseClock(c, T0 + 10 * MIN);
    c = resumeClock(c, T0 + 15 * MIN);
    const end = T0 + 25 * MIN;
    expect(completedSeconds(c, end)).toBe(20 * 60);
    expect(remainingSeconds(c, end)).toBe(10 * 60);
  });

  it('a paused clock does not move', () => {
    const c = pauseClock(startClock(1500, T0), T0 + MIN);
    expect(activeMs(c, T0 + 60 * MIN)).toBe(MIN);
  });

  it('pause on a paused clock and resume on a running one change nothing', () => {
    const running = startClock(1500, T0);
    expect(resumeClock(running, T0 + MIN)).toBe(running);
    const paused = pauseClock(running, T0 + MIN);
    expect(pauseClock(paused, T0 + 5 * MIN)).toBe(paused);
  });

  it('time is read from the clock, so missed ticks lose nothing', () => {
    const c = startClock(1500, T0);
    // a JS thread that slept 7 minutes still shows 7 minutes gone
    expect(remainingSeconds(c, T0 + 7 * MIN)).toBe(1500 - 420);
  });

  it('never reports more focus than planned, never a negative countdown', () => {
    const c = startClock(300, T0);
    expect(completedSeconds(c, T0 + 60 * MIN)).toBe(300);
    expect(remainingSeconds(c, T0 + 60 * MIN)).toBe(0);
  });

  it('a clock rebuilt from the screen is paused at what was shown', () => {
    const c = clockFromRemaining(1500, 900);
    expect(c.runningSince).toBeNull();
    expect(completedSeconds(c, T0)).toBe(600);
  });
});

describe('KD-03 — snapshot survives an app kill', () => {
  const snap = (clock: ReturnType<typeof startClock>, lastSeenAt: number) =>
    snapshotOf({ phase: 'work', clock, sessionStartedAt: new Date(T0).toISOString(), sessionsCompleted: 2, now: lastSeenAt });

  it('round-trips through JSON', () => {
    const s = snap(pauseClock(startClock(1500, T0), T0 + MIN), T0 + MIN);
    expect(parseSnapshot(JSON.stringify(s))).toEqual(s);
  });

  it('a session killed while running comes back paused at lastSeenAt; the dead time is not focus', () => {
    const s = snap(startClock(1500, T0), T0 + 8 * MIN);   // last heartbeat at 8 min
    const c = restoredClock(s);
    expect(c.runningSince).toBeNull();
    expect(completedSeconds(c, T0 + 90 * MIN)).toBe(8 * 60);
  });

  it('a paused session comes back exactly as it was', () => {
    const paused = pauseClock(startClock(1500, T0), T0 + 3 * MIN);
    expect(restoredClock(snap(paused, T0 + 3 * MIN))).toEqual(paused);
  });

  it('anything malformed or from another version is dropped, not half-restored', () => {
    const good = snap(startClock(1500, T0), T0);
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('{not json')).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...good, v: SESSION_SNAPSHOT_VERSION + 1 }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...good, phase: 'nap' }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...good, clock: { ...good.clock, plannedSeconds: 0 } }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...good, clock: { ...good.clock, accumulatedMs: -1 } }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...good, clock: { ...good.clock, runningSince: 'x' } }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...good, lastSeenAt: undefined }))).toBeNull();
  });
});

describe('F16 — zaman yardımcıları', () => {
  it('exposes the F16 timing thresholds', () => {
    expect(SESSION_MAX_AGE_MS).toBe(12 * 60 * 60 * 1000);
    expect(MIN_PARTIAL_SECONDS).toBe(60);
    expect(AWAY_MIN_MS).toBe(10_000);
    expect(FOCUS_END_GRACE_MS).toBe(2_000);
  });

  it('expectedEndMs computes the wall-clock finish instant and returns null when paused', () => {
    const fresh = startClock(1500, T0);
    expect(expectedEndMs(fresh)).toBe(T0 + 1_500_000);

    const paused = pauseClock(fresh, T0 + 10 * MIN);
    expect(expectedEndMs(paused)).toBeNull();

    const resumed = resumeClock(paused, T0 + 15 * MIN);
    expect(expectedEndMs(resumed)).toBe(T0 + 1_500_000 + 5 * MIN);

    const overElapsed = { plannedSeconds: 60, accumulatedMs: 90_000, runningSince: T0 + 2 * MIN };
    expect(expectedEndMs(overElapsed)).toBe(T0 + 2 * MIN);
  });

  it('isSnapshotFresh measures age from pausedAt when present, otherwise lastSeenAt, and tolerates clock skew', () => {
    expect(isSnapshotFresh({ lastSeenAt: T0 }, T0 + SESSION_MAX_AGE_MS)).toBe(true);
    expect(isSnapshotFresh({ lastSeenAt: T0 }, T0 + SESSION_MAX_AGE_MS + 1)).toBe(false);
    expect(isSnapshotFresh({ lastSeenAt: T0 + 5 * MIN }, T0)).toBe(true);

    // Paused 12h+1ms ago, even if lastSeenAt was refreshed recently -> stale
    expect(
      isSnapshotFresh({ lastSeenAt: T0 + 11 * 60 * MIN, pausedAt: T0 }, T0 + SESSION_MAX_AGE_MS + 1),
    ).toBe(false);
    expect(
      isSnapshotFresh({ lastSeenAt: T0 + 11 * 60 * MIN, pausedAt: T0 }, T0 + SESSION_MAX_AGE_MS),
    ).toBe(true);
  });

  it('snapshotOf and parseSnapshot round-trip optional pausedAt and reject non-numeric pausedAt', () => {
    const c = pauseClock(startClock(1500, T0), T0 + 4 * MIN);
    const withPaused = snapshotOf({
      phase: 'work',
      clock: c,
      sessionStartedAt: new Date(T0).toISOString(),
      sessionsCompleted: 1,
      now: T0 + 4 * MIN,
      pausedAt: T0 + 4 * MIN,
    });
    expect(withPaused.pausedAt).toBe(T0 + 4 * MIN);
    expect(parseSnapshot(JSON.stringify(withPaused))).toEqual(withPaused);

    const withoutPaused = snapshotOf({
      phase: 'work',
      clock: startClock(1500, T0),
      sessionStartedAt: new Date(T0).toISOString(),
      sessionsCompleted: 0,
      now: T0,
      pausedAt: null,
    });
    expect('pausedAt' in withoutPaused).toBe(false);
    expect(parseSnapshot(JSON.stringify(withoutPaused))?.pausedAt).toBeUndefined();

    expect(parseSnapshot(JSON.stringify({ ...withPaused, pausedAt: 'x' }))).toBeNull();
    expect(parseSnapshot(JSON.stringify({ ...withPaused, pausedAt: null }))).toBeNull();
  });

  it('progressFraction stays bounded in [0, 1] and never produces NaN or Infinity', () => {
    expect(progressFraction(1500, 900)).toBeCloseTo(0.4, 6);
    expect(progressFraction(0, 0)).toBe(0);
    expect(progressFraction(-60, 10)).toBe(0);
    expect(progressFraction(Number.NaN, 10)).toBe(0);
    expect(progressFraction(1500, Number.NaN)).toBe(0);
    expect(progressFraction(Number.POSITIVE_INFINITY, 10)).toBe(0);
    expect(progressFraction(1500, 2000)).toBe(0);
    expect(progressFraction(1500, -5)).toBe(1);
  });

  it('sessionSpan builds honest startedAt/endedAt bounds and clamps anomalies', () => {
    const exact = sessionSpan({
      startedAtIso: '2026-11-01T20:40:00.000Z',
      endedAtIso: '2026-11-01T21:05:00.000Z',
      completedSeconds: 1500,
      now: T0,
    });
    expect(exact).toEqual({
      startedAt: '2026-11-01T20:40:00.000Z',
      endedAt: '2026-11-01T21:05:00.000Z',
    });

    const derived = sessionSpan({ completedSeconds: 600, now: T0 });
    expect(derived).toEqual({
      startedAt: new Date(T0 - 600_000).toISOString(),
      endedAt: new Date(T0).toISOString(),
    });

    const clamped = sessionSpan({
      startedAtIso: '2026-11-01T22:00:00.000Z',
      endedAtIso: '2026-11-01T21:00:00.000Z',
      completedSeconds: 300,
      now: T0,
    });
    expect(clamped).toEqual({
      startedAt: '2026-11-01T21:00:00.000Z',
      endedAt: '2026-11-01T21:00:00.000Z',
    });

    const malformed = sessionSpan({
      startedAtIso: 'not-a-date',
      endedAtIso: 'also-bad',
      completedSeconds: -50,
      now: T0,
    });
    expect(malformed).toEqual({
      startedAt: new Date(T0).toISOString(),
      endedAt: new Date(T0).toISOString(),
    });
  });
});
