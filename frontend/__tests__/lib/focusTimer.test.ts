/**
 * R05.03 / KD-03 — the focus clock is the sum of its running segments.
 */
import {
  startClock, pauseClock, resumeClock, activeMs, completedSeconds, remainingSeconds,
  clockFromRemaining, snapshotOf, parseSnapshot, restoredClock, SESSION_SNAPSHOT_VERSION,
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
