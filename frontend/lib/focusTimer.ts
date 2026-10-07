/**
 * R05.03 / KD-03 — the focus timer as time segments, not as a countdown.
 *
 * The old timer decremented `secondsLeft` once per `setInterval` tick and
 * measured the finished session as `now - sessionStartedAt`, where
 * `sessionStartedAt` was rewritten on every resume. So:
 *  - a pause/resume restarted the measurement and the session reported only
 *    its last segment;
 *  - a pause that never resumed into a new segment counted as focus time;
 *  - a JS thread that slept (backgrounded, throttled) lost ticks and the
 *    countdown ran slow;
 *  - an app kill lost the session outright.
 *
 * Here the clock is the sum of the RUNNING segments: `accumulatedMs` closed
 * segments plus the open one since `runningSince`. A pause closes the open
 * segment, a resume opens a new one, and nothing in between is counted --
 * a 20-minute session with a 5-minute pause in it is 20 minutes of focus,
 * not 25. The interval only asks the clock what time it is; it is not the
 * source of truth.
 *
 * Pure: every function takes `now` (epoch ms) and returns a new value.
 */

export type TimerClock = {
  /** The phase's planned length, fixed when the session starts. */
  plannedSeconds: number;
  /** Closed running segments, in ms. */
  accumulatedMs: number;
  /** Epoch ms the open segment began; null while paused. */
  runningSince: number | null;
};

/** A new session, already running from `now`. */
export function startClock(plannedSeconds: number, now: number): TimerClock {
  return { plannedSeconds: Math.max(0, plannedSeconds), accumulatedMs: 0, runningSince: now };
}

/**
 * A clock rebuilt from what a screen shows -- for a paused session that
 * predates the segment model (no clock to resume). Paused.
 */
export function clockFromRemaining(plannedSeconds: number, secondsLeft: number): TimerClock {
  const elapsed = Math.min(plannedSeconds, Math.max(0, plannedSeconds - secondsLeft));
  return { plannedSeconds, accumulatedMs: elapsed * 1000, runningSince: null };
}

/** Running time so far: closed segments plus the open one. */
export function activeMs(c: TimerClock, now: number): number {
  const open = c.runningSince === null ? 0 : Math.max(0, now - c.runningSince);
  return c.accumulatedMs + open;
}

/** Close the open segment. A paused clock is returned as it is. */
export function pauseClock(c: TimerClock, now: number): TimerClock {
  if (c.runningSince === null) return c;
  return { ...c, accumulatedMs: activeMs(c, now), runningSince: null };
}

/** Open a new segment. A running clock is returned as it is. */
export function resumeClock(c: TimerClock, now: number): TimerClock {
  if (c.runningSince !== null) return c;
  return { ...c, runningSince: now };
}

/** Whole seconds of focus so far, never past the plan. */
export function completedSeconds(c: TimerClock, now: number): number {
  return Math.min(c.plannedSeconds, Math.floor(activeMs(c, now) / 1000));
}

/** What the countdown shows. Rounds up so a fresh session shows the full plan. */
export function remainingSeconds(c: TimerClock, now: number): number {
  return Math.max(0, c.plannedSeconds - Math.floor(activeMs(c, now) / 1000));
}

// ---------------------------------------------------------------------------
// Persistence -- the session survives an app kill
// ---------------------------------------------------------------------------

export const SESSION_SNAPSHOT_VERSION = 1;

export type FocusPhase = 'work' | 'shortBreak' | 'longBreak';

export type SessionSnapshot = {
  v: typeof SESSION_SNAPSHOT_VERSION;
  phase: FocusPhase;
  clock: TimerClock;
  sessionStartedAt: string;
  sessionsCompleted: number;
  /**
   * The last moment the app was known to be alive with this session. A
   * snapshot written while running is restored up to here and no further:
   * the time between the app dying and coming back is not focus.
   */
  lastSeenAt: number;
};

export function snapshotOf(params: {
  phase: FocusPhase;
  clock: TimerClock;
  sessionStartedAt: string;
  sessionsCompleted: number;
  now: number;
}): SessionSnapshot {
  return {
    v: SESSION_SNAPSHOT_VERSION,
    phase: params.phase,
    clock: params.clock,
    sessionStartedAt: params.sessionStartedAt,
    sessionsCompleted: params.sessionsCompleted,
    lastSeenAt: params.now,
  };
}

const PHASES: readonly FocusPhase[] = ['work', 'shortBreak', 'longBreak'];
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Parse a stored snapshot. Anything malformed or from another version is
 * `null` -- a session that cannot be read is dropped, never half-restored.
 */
export function parseSnapshot(raw: string | null): SessionSnapshot | null {
  if (!raw) return null;
  let o: any;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || o.v !== SESSION_SNAPSHOT_VERSION) return null;
  if (!PHASES.includes(o.phase)) return null;
  if (typeof o.sessionStartedAt !== 'string') return null;
  if (!isNum(o.sessionsCompleted) || o.sessionsCompleted < 0) return null;
  if (!isNum(o.lastSeenAt)) return null;
  const c = o.clock;
  if (!c || !isNum(c.plannedSeconds) || c.plannedSeconds <= 0) return null;
  if (!isNum(c.accumulatedMs) || c.accumulatedMs < 0) return null;
  if (c.runningSince !== null && !isNum(c.runningSince)) return null;
  return {
    v: SESSION_SNAPSHOT_VERSION,
    phase: o.phase,
    clock: { plannedSeconds: c.plannedSeconds, accumulatedMs: c.accumulatedMs, runningSince: c.runningSince },
    sessionStartedAt: o.sessionStartedAt,
    sessionsCompleted: o.sessionsCompleted,
    lastSeenAt: o.lastSeenAt,
  };
}

/**
 * The clock a restored session continues with: always PAUSED, so the user
 * resumes it on purpose. A segment that was open when the app died is closed
 * at `lastSeenAt` -- what was seen running counts, the gap after it does not.
 */
export function restoredClock(s: SessionSnapshot): TimerClock {
  const c = s.clock;
  if (c.runningSince === null) return c;
  const end = Math.max(c.runningSince, s.lastSeenAt);
  return pauseClock(c, end);
}
