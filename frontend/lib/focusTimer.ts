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
import { isSmallStep, type SmallStep } from './smallStart';

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
  /** F16 — epoch ms the session was paused, when paused; omitted while running. */
  pausedAt?: number;
  /** R03.03 — the small step this session is, if it is one. */
  step?: SmallStep;
};

const PHASES: readonly FocusPhase[] = ['work', 'shortBreak', 'longBreak'];
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function isTimerClock(x: unknown): x is TimerClock {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false;
  const c = x as Record<string, unknown>;
  if (!isNum(c.plannedSeconds) || c.plannedSeconds < 0) return false;
  if (!isNum(c.accumulatedMs) || c.accumulatedMs < 0) return false;
  if (c.runningSince !== null && !isNum(c.runningSince)) return false;
  return true;
}

export function snapshotOf(params: {
  phase: FocusPhase;
  clock: TimerClock;
  sessionStartedAt: string;
  sessionsCompleted: number;
  now: number;
  step?: SmallStep | null;
  pausedAt?: number | null;
}): SessionSnapshot {
  return {
    ...(params.step ? { step: params.step } : {}),
    ...(isNum(params.pausedAt) ? { pausedAt: params.pausedAt } : {}),
    v: SESSION_SNAPSHOT_VERSION,
    phase: params.phase,
    clock: params.clock,
    sessionStartedAt: params.sessionStartedAt,
    sessionsCompleted: params.sessionsCompleted,
    lastSeenAt: params.now,
  };
}

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
  if (o.pausedAt !== undefined && !isNum(o.pausedAt)) return null;
  const c = o.clock;
  if (!isTimerClock(c) || c.plannedSeconds <= 0) return null;
  if (o.step !== undefined && !isSmallStep(o.step)) return null;
  return {
    ...(o.step !== undefined ? { step: o.step as SmallStep } : {}),
    ...(o.pausedAt !== undefined ? { pausedAt: o.pausedAt } : {}),
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

// ---------------------------------------------------------------------------
// F16 — wall-clock end, snapshot freshness, safe progress, honest session span
// ---------------------------------------------------------------------------

/** Saklanan oturum anlık görüntüsünün en çok yaşı (son görülme / duraklatma anından): 12 saat. */
export const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
/** Yarım kalan emek olarak saklanacak en kısa etkin süre (saniye). Altı yanlışlıkla dokunuştur. */
export const MIN_PARTIAL_SECONDS = 60;
/** Uygulamadan bu kadar (ms) uzakta kalmak "geri döndü" sayılır; bildirim çekmecesi dokunuşu sayılmaz. */
export const AWAY_MIN_MS = 10_000;
/** OS bitiş bildiriminin gecikme payı (ms): ön plandaki tick önce iptal edebilsin. */
export const FOCUS_END_GRACE_MS = 2_000;

/** Yaş, duraklatılmış oturumda duraklatma anından (`pausedAt`), değilse son görülme anından (`lastSeenAt`) ölçülür. */
export function isSnapshotFresh(s: Pick<SessionSnapshot, 'lastSeenAt' | 'pausedAt'>, now: number): boolean {
  return now - (s.pausedAt ?? s.lastSeenAt) <= SESSION_MAX_AGE_MS;
}

/** Çalışan saatin plana ulaşacağı an (epoch ms); duraklatılmışsa null. */
export function expectedEndMs(c: TimerClock): number | null {
  if (c.runningSince === null) return null;
  return c.runningSince + Math.max(0, c.plannedSeconds * 1000 - c.accumulatedMs);
}

/** Halka dolumu 0..1. Toplam <= 0 veya sayı değilse 0 (NaN ve Infinity yok). */
export function progressFraction(totalSeconds: number, secondsLeft: number): number {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0 || !Number.isFinite(secondsLeft)) return 0;
  return Math.min(1, Math.max(0, (totalSeconds - secondsLeft) / totalSeconds));
}

/** Oturum satırının zaman aralığı: bitiş verilmezse şimdi, başlangıç verilmezse bitişten etkin süre kadar geri; başlangıç bitişi aşmaz. */
export function sessionSpan(p: {
  startedAtIso?: string;
  endedAtIso?: string;
  completedSeconds: number;
  now: number;
}): { startedAt: string; endedAt: string } {
  const parsedEnd = p.endedAtIso !== undefined ? Date.parse(p.endedAtIso) : Number.NaN;
  const endMs = Number.isFinite(parsedEnd) ? parsedEnd : p.now;
  const parsedStart = p.startedAtIso !== undefined ? Date.parse(p.startedAtIso) : Number.NaN;
  const secs = Number.isFinite(p.completedSeconds) ? Math.max(0, p.completedSeconds) : 0;
  let startMs = Number.isFinite(parsedStart) ? parsedStart : endMs - secs * 1000;
  if (startMs > endMs) startMs = endMs;
  return {
    startedAt: new Date(startMs).toISOString(),
    endedAt: new Date(endMs).toISOString(),
  };
}
