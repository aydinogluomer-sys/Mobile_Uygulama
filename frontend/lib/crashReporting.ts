/**
 * Crash / error reporting — plan §24 Phase 4 "crash reporting", §27 DoD
 * "crash monitoring".
 *
 * WHAT WAS THERE BEFORE: nothing. A grep for `Sentry|crashlytics|
 * ErrorBoundary|captureException` across `frontend/` returned zero matches.
 * A single render throw anywhere in the tree unmounts the whole app to a
 * blank screen, and the developer learns nothing — not the screen, not the
 * error, not even that it happened.
 *
 * WHY THERE IS NO SDK HERE. Wiring Sentry (or any hosted equivalent) means
 * committing a vendor dependency plus a DSN pointing at an account that does
 * not exist yet, and it means user error data starts leaving the device the
 * moment someone runs the app. That is an outward-facing decision for the
 * repository owner, not something to smuggle in inside a "Phase 4 polish"
 * commit. What IS a coding deliverable, and what this file is, is the seam:
 * one capture funnel, one swappable sink, and — the part that actually takes
 * design work — a scrubber, so that whatever transport is attached later
 * cannot ship user prose off the device on day one.
 *
 * THE PRIVACY PROBLEM THIS FILE SOLVES, stated plainly:
 *
 * `lib/analytics.ts` had it easy — it builds its own payloads, so it can
 * allowlist value shape and refuse anything prose-like. A crash report cannot
 * do that. Its payload is an `Error` produced by code nobody controls, and
 * error messages routinely embed the offending value:
 *
 *     JSON.parse('Bugün terapistimle konuştuğum şey...')
 *       -> SyntaxError: Unexpected token 'B', "Bugün terapi"... is not valid JSON
 *
 *     PGRST116: JSON object requested, multiple (or no) rows returned
 *       for habits?title=eq.<the user's habit title>
 *
 * So journal text and habit titles arrive *inside the message string*, which
 * §22's "hassas journal metinleri event platformlarına gönderilmemelidir"
 * forbids sending. Shape-allowlisting is impossible here; the message IS the
 * diagnostic. The resolution below is to keep the message but redact the
 * things that carry user content — quoted literals, URL query values, long
 * unbroken prose runs — and to cap length, on the principle that a message
 * whose useful half is its first line loses nothing that matters and stops
 * leaking a whole journal entry.
 *
 * Redaction is deliberately conservative in the direction that costs
 * debuggability rather than privacy: it is better to redact an innocent
 * quoted enum than to ship one sentence of somebody's journal.
 */

/** Where a crash was caught. Kept a closed enum so a sink can group by it. */
export type CrashSource =
  | 'render'            // React render/lifecycle throw, via ErrorBoundary
  | 'unhandled'         // global JS error handler
  | 'unhandled_promise' // rejected promise nobody caught
  | 'manual';           // an explicit reportError() call from a catch block

export type CrashReport = {
  source: CrashSource;
  /** Error class name (`TypeError`, `PostgrestError`, ...). Never user data. */
  name: string;
  /** Scrubbed message. See `scrubMessage`. */
  message: string;
  /** Scrubbed stack, truncated. Absent when the thrown value had none. */
  stack?: string;
  /** Screen/route or component name, when the caller knows it. Enum-shaped only. */
  context?: string;
  timestamp: string;
  /** True when scrubbing actually removed something — makes redaction observable. */
  redacted: boolean;
};

const MAX_MESSAGE_CHARS = 300;
const MAX_STACK_FRAMES = 12;

/**
 * WHY THERE IS NO "LOOKS LIKE PROSE" RULE HERE.
 *
 * The first version of this file had one: redact any run of 3+
 * space-separated words. It was written from the assumption that user text
 * can be recognised by shape. Its own tests disproved that immediately — it
 * redacted `undefined is not an object` and
 * `JSON object requested from habits`, i.e. it destroyed the diagnostic value
 * of essentially every real error message while adding no protection the
 * rules below do not already provide. A word-count heuristic cannot separate
 * an English error sentence from a Turkish journal sentence, because the
 * distinguishing property is not shape — it is POSITION.
 *
 * User content does not float free in an error message; it arrives inside a
 * delimiter, because that is how it got interpolated in the first place:
 *
 *   - quoted by the runtime — Hermes/V8 quote the offending value in
 *     `JSON.parse` / `Unexpected token` messages;
 *   - quoted by our own code — every interpolating throw in this repo does
 *     it, e.g. `lib/recovery.ts:153`'s `invalid fromDate "${fromDate}"`;
 *   - in a URL query value — PostgREST puts filter values there.
 *
 * So the rules are structural and high-precision, and the length cap is the
 * backstop for anything unanticipated.
 *
 * KNOWN GAP, stated rather than papered over: a message that interpolates
 * user text with NO delimiter (`throw new Error('kaydedilemedi: ' + title)`)
 * is not redacted beyond the length cap. The right fix for that is at the
 * throw site, not here — a scrubber cannot reliably recover structure that
 * the thrower discarded. No such call site exists in this repo today; if one
 * is added, quote the value.
 */
/** Anything inside single, double or back quotes — the classic "offending value" slot. */
const QUOTED_RE = /(["'`])(?:(?!\1)[\s\S])*?\1/g;
/** `?title=...&note=...` — PostgREST puts filter VALUES in the query string. */
const QUERY_VALUE_RE = /([?&][A-Za-z_][\w.]*=)[^&\s]+/g;
/** Emails and bearer-ish tokens, which are never acceptable in a report. */
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;
const TOKEN_RE = /\b(?:ey[A-Za-z0-9_-]{10,}|sk-[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._-]{10,})/g;

const REDACTED = '[redacted]';

/**
 * Strips user content out of an error message while keeping its diagnostic
 * spine (the error class, the operation, the code).
 *
 * Order runs most-specific first (tokens and emails before the general
 * quoted-literal rule), so that a token which happens to sit inside quotes is
 * still recognised as a token rather than being folded into an anonymous
 * quoted blob. Each rule's guarantee then holds independently of the others.
 */
export function scrubMessage(raw: string): { text: string; redacted: boolean } {
  if (!raw) return { text: '', redacted: false };
  let out = raw
    .replace(TOKEN_RE, REDACTED)
    .replace(EMAIL_RE, REDACTED)
    .replace(QUERY_VALUE_RE, `$1${REDACTED}`)
    .replace(QUOTED_RE, REDACTED);

  let redacted = out !== raw;
  if (out.length > MAX_MESSAGE_CHARS) {
    out = `${out.slice(0, MAX_MESSAGE_CHARS)}…`;
    redacted = true;
  }
  return { text: out, redacted };
}

/**
 * Keeps the top frames and drops absolute filesystem paths.
 *
 * A stack's value is almost entirely in its first frames; the tail is
 * framework noise. Absolute paths are dropped because on a developer machine
 * they contain the OS user name (`C:\Users\<name>\...`) — personal data
 * riding along in something nobody thinks of as a payload.
 */
export function scrubStack(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw
    .split('\n')
    .slice(0, MAX_STACK_FRAMES)
    .map((line) =>
      // R06.05 — a stack's first line repeats the error MESSAGE ("Error: …"),
      // so it gets the same scrubbing; otherwise a quoted value redacted from
      // `message` would ride along in `stack`.
      scrubMessage(line).text
        // Windows paths may contain spaces (`C:\Users\Trade Bilisim\...`), so
        // the character class must NOT exclude them — an earlier version did,
        // and stopped at the space, leaving the OS user name in the report.
        // Greedy to the last separator on the line strips the directory and
        // keeps `file.ts:line:col`, which is the part worth having.
        .replace(/[A-Za-z]:[\\/][^\n)]*[\\/]/g, '')
        .replace(/\/(?:Users|home)\/[^\s/)]+\/[^\s)]*?([^/\s)]+\/)/g, '$1'),
    )
    .join('\n');
}

/**
 * Normalises anything JavaScript allows to be thrown.
 *
 * `throw 'boom'`, `throw null` and `throw {code:'X'}` are all legal and all
 * reach an error handler. A reporter that assumes `err.message` exists
 * crashes inside the crash handler — the one place a crash is least
 * recoverable.
 */
function describeThrown(err: unknown): { name: string; message: string; stack?: string } {
  if (err instanceof Error) {
    return { name: err.name || 'Error', message: err.message ?? '', stack: err.stack };
  }
  if (typeof err === 'string') return { name: 'ThrownString', message: err };
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>;
    const message = typeof o.message === 'string' ? o.message : safeStringify(o);
    return { name: typeof o.name === 'string' ? o.name : 'ThrownObject', message };
  }
  return { name: 'ThrownValue', message: String(err) };
}

function safeStringify(o: unknown): string {
  try {
    return JSON.stringify(o) ?? String(o);
  } catch {
    return '[unserialisable]';
  }
}

export function buildCrashReport(
  err: unknown,
  source: CrashSource,
  context?: string,
): CrashReport {
  const { name, message, stack } = describeThrown(err);
  const scrubbed = scrubMessage(message);
  return {
    source,
    name,
    message: scrubbed.text,
    stack: scrubStack(stack),
    // A context string is written by us, not by a user — but it is still
    // constrained to an enum shape so a call site cannot start passing a
    // habit title as "context" and route around the scrubber entirely.
    context: context && /^[A-Za-z][\w./-]{0,63}$/.test(context) ? context : undefined,
    timestamp: new Date().toISOString(),
    redacted: scrubbed.redacted,
  };
}

// ---------------------------------------------------------------------------
// Sink
// ---------------------------------------------------------------------------

export type CrashSink = (report: CrashReport) => void;

/**
 * Default sink: console in development, silence in production.
 *
 * Silence is the correct production default precisely BECAUSE no transport is
 * configured. The alternative — buffering reports for a sink that may never be
 * attached — is an unbounded in-memory list of error objects growing for the
 * life of the process, which is itself a way to crash the app.
 */
const consoleSink: CrashSink = (report) => {
  if (!__DEV__) return;
   
  console.error(`[crash:${report.source}] ${report.name}: ${report.message}`, report.stack ?? '');
};

let sink: CrashSink = consoleSink;

/** Attach a real transport (Sentry, a Supabase table, ...) at app boot. */
export function setCrashSink(next: CrashSink | null): void {
  sink = next ?? consoleSink;
}

/**
 * The single capture funnel. Never throws.
 *
 * A reporter that can throw turns one bug into two and hides the first — and
 * it would do so inside an error handler, where there is nothing left to
 * catch it. Everything here is wrapped for that reason, including the report
 * construction itself.
 */
export function reportError(err: unknown, source: CrashSource = 'manual', context?: string): void {
  try {
    sink(buildCrashReport(err, source, context));
  } catch {
    // Deliberately empty: see above.
  }
}

// ---------------------------------------------------------------------------
// Global handlers
// ---------------------------------------------------------------------------

type ErrorUtilsLike = {
  getGlobalHandler?: () => ((e: unknown, isFatal?: boolean) => void) | undefined;
  setGlobalHandler?: (h: (e: unknown, isFatal?: boolean) => void) => void;
};

let installed = false;

/**
 * Routes React Native's global error handler through `reportError`, once.
 *
 * The previous handler is CHAINED, not replaced. RN's default handler is what
 * shows the red box in development and what terminates cleanly on a fatal in
 * production; dropping it would trade a missing report for a missing crash
 * screen. Idempotent because a second install would otherwise chain to
 * itself and report every error twice.
 */
export function installGlobalErrorHandlers(): () => void {
  if (installed) return () => {};
  installed = true;

  const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
  const prev = eu?.getGlobalHandler?.();

  eu?.setGlobalHandler?.((e: unknown, isFatal?: boolean) => {
    reportError(e, 'unhandled', isFatal ? 'fatal' : 'nonfatal');
    prev?.(e, isFatal);
  });

  return () => {
    if (prev) eu?.setGlobalHandler?.(prev);
    installed = false;
  };
}

/** Test-only: lets a suite assert install-once behaviour from a clean slate. */
export function __resetGlobalHandlersForTest(): void {
  installed = false;
}
