/**
 * Sentry — the transport `lib/crashReporting.ts` was built to receive.
 *
 * That file already did the hard half. It has one capture funnel
 * (`reportError`), one swappable sink (`setCrashSink`), and a scrubber that
 * removes quoted literals, URL query values, emails and bearer-ish tokens
 * from an error message before anything sees it. Its own doc explains why
 * that scrubber has to exist: a crash payload is an `Error` produced by code
 * nobody controls, and error messages routinely embed the offending value —
 * so a journal entry can arrive inside a `SyntaxError` message. It was left
 * with a console sink because attaching a vendor was the owner's decision.
 *
 * The owner has now decided Sentry. This file is only the sink plus the
 * client configuration; it deliberately adds no second scrubbing philosophy.
 *
 * ## The privacy configuration, and why each line is there
 *
 * Aderyth stores journal text, AI Coach transcripts and habit titles. None of
 * it may leave the device through a crash report. Four independent mechanisms
 * enforce that, so that no single one being wrong is enough to leak:
 *
 *  1. **The funnel.** Everything this sink forwards was already scrubbed and
 *     length-capped by `buildCrashReport`.
 *  2. **`beforeSend`.** Applies the SAME scrubber to every event, including
 *     ones the SDK generates itself (native crashes, its own error handler),
 *     and deletes the containers that carry user content wholesale:
 *     `request` (bodies, headers, URLs — this is where an `Authorization:
 *     Bearer <supabase jwt>` would live), `user`, `extra`, and breadcrumbs.
 *  3. **`beforeBreadcrumb` returns null.** Console, http and navigation
 *     breadcrumbs are the quiet leak in a crash SDK: an http breadcrumb
 *     records the PostgREST URL, and PostgREST puts filter VALUES in the
 *     query string, so `?title=eq.<habit name>` would ride along. Nothing is
 *     worth that here, so no breadcrumb is recorded at all.
 *  4. **No tracing, no replay, no failed-request capture.** Performance spans
 *     carry URLs; session replay carries the screen. Both are off, and the
 *     replay sample rates are pinned at 0 rather than left to a default so
 *     that turning replay on has to be a visible diff.
 *
 * No user identifier is attached either — `event.user` is deleted, which also
 * removes the random installation id the SDK would otherwise set. The cost is
 * that Sentry cannot report "how many users are affected"; the benefit is that
 * a crash report cannot be tied back to an account at all. Reversible in one
 * line if the owner decides otherwise.
 *
 * ## Release and source maps
 *
 * `release` and `dist` are NOT set here on purpose. The SDK derives them from
 * the native build (bundle id, version, build number), and the source-map
 * upload performed by the `@sentry/react-native` config plugin keys on those
 * same native values. Setting them by hand from `expoConfig` is the classic
 * way to end up with unresolved stack traces: the manifest version and the
 * EAS-assigned build number are not the same thing, especially under
 * `appVersionSource: remote`, where the build number does not exist in
 * `app.json` at all.
 *
 * ## Configuration, all external
 *
 * Nothing secret lives in this file or anywhere in the repository.
 *
 *   EXPO_PUBLIC_SENTRY_DSN          the ingest endpoint. Public by design --
 *                                   a DSN is write-only and every shipped
 *                                   app embeds one. `EXPO_PUBLIC_` is the
 *                                   correct prefix precisely because it is
 *                                   inlined into the bundle.
 *   EXPO_PUBLIC_SENTRY_ENVIRONMENT  optional; defaults to production in a
 *                                   release build.
 *   SENTRY_ORG / SENTRY_PROJECT     build-time only, read by sentry-cli.
 *   SENTRY_AUTH_TOKEN               build-time only, an EAS SECRET. Never an
 *                                   `EXPO_PUBLIC_` value and never in git.
 *
 * With no DSN configured, `initCrashReporting()` returns false and the app
 * behaves exactly as it did before Sentry existed: the console sink in
 * development, silence in production. That is the state the repository ships
 * in today, because no Sentry project exists yet
 * (`docs/store/OWNER_DECISIONS.md`).
 */
import * as Sentry from '@sentry/react-native';
import { setCrashSink, scrubMessage, type CrashReport } from './crashReporting';

/** Read once at module scope: `process.env.EXPO_PUBLIC_*` is inlined at build time. */
const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

const ENVIRONMENT =
  process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? (__DEV__ ? 'development' : 'production');

let initialised = false;

/**
 * Rebuilds an `Error` from an already-scrubbed report so Sentry can parse and
 * group it. The message and stack are the scrubbed ones; nothing here reaches
 * back for the original.
 */
function errorFromReport(report: CrashReport): Error {
  const e = new Error(report.message);
  e.name = report.name;
  // `scrubStack` strips directory prefixes and caps the frame count. In a
  // release build those paths point at the JS bundle, not a developer's home
  // directory, so source maps still resolve.
  e.stack = report.stack;
  return e;
}

/**
 * Forwards a scrubbed report to Sentry.
 *
 * `unhandled` is deliberately NOT forwarded. That source is the `ErrorUtils`
 * global handler, which the SDK's own `ReactNativeErrorHandlers` integration
 * also wraps — forwarding it would file every uncaught error twice. The
 * sources that only this funnel sees are the ones that matter here: `render`
 * (React swallows those into the ErrorBoundary, so the SDK never sees them),
 * `manual`, and `unhandled_promise`.
 */
const sentrySink = (report: CrashReport): void => {
  if (report.source === 'unhandled') return;
  Sentry.captureException(errorFromReport(report), {
    tags: {
      crash_source: report.source,
      crash_context: report.context ?? 'unknown',
      redacted: String(report.redacted),
    },
  });
};

/**
 * Starts Sentry and attaches it as the crash sink. Idempotent, and never
 * throws — a crash reporter that breaks boot is strictly worse than no crash
 * reporter, so a failure here leaves the app running with the previous sink.
 *
 * Returns whether Sentry is actually active, which the repo guard asserts is
 * false when no DSN is configured.
 */
export function initCrashReporting(): boolean {
  if (initialised) return true;
  if (!DSN) return false;

  try {
    Sentry.init({
      dsn: DSN,
      environment: ENVIRONMENT,

      // Off in development so a developer's red box is not also a network
      // call, and so the console sink stays the dev experience.
      enabled: !__DEV__,

      // --- what is NOT collected ------------------------------------------
      sendDefaultPii: false,
      // Spans carry request URLs; PostgREST puts user values in query strings.
      tracesSampleRate: 0,
      enableAutoPerformanceTracing: false,
      // Would attach failed HTTP requests, headers included.
      enableCaptureFailedRequests: false,
      // Sessions are only useful alongside a user identity, which is not sent.
      enableAutoSessionTracking: false,
      // Pinned rather than defaulted: replay must be a visible diff.
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,

      // A crash SDK's quietest leak. Nothing is worth an http breadcrumb here.
      beforeBreadcrumb: () => null,

      beforeSend(event) {
        // Containers that can hold user content or credentials. `request` is
        // the important one: it is where an Authorization header would be.
        delete event.request;
        delete event.user;
        delete event.extra;
        delete event.server_name;
        event.breadcrumbs = [];

        if (event.message) event.message = scrubMessage(event.message).text;
        for (const value of event.exception?.values ?? []) {
          if (value.value) value.value = scrubMessage(value.value).text;
        }
        return event;
      },
    });

    setCrashSink(sentrySink);
    initialised = true;
    return true;
  } catch {
    // Deliberately empty. See above.
    return false;
  }
}

/** Test-only: lets a suite assert init-once behaviour from a clean slate. */
export function __resetCrashReportingForTest(): void {
  initialised = false;
}

/** Whether a DSN was configured for this build. Used by the repo guard. */
export const SENTRY_DSN_CONFIGURED = DSN.length > 0;
