/**
 * Pins "today" for a whole test file, and nothing else.
 *
 * ## Why this file exists (F03)
 *
 * Since migration 038 the store refuses a habit log whose day is not today or one of the
 * previous 14 local days (`isLoggableDay`, lib/date.ts). The store suites log a fixed calendar
 * day (`new Date(2026, 7, 4)` and friends) so that their expectations can name it; with a real
 * clock that day drifts out of the window and every write is refused before it starts. The fix
 * is to pin the clock, never to rewrite the expectations.
 *
 * Only `Date` is faked. Timers, microtasks, `nextTick` and `setImmediate` stay real, so the
 * store's serialise chain, its awaited queue persistence and any `setTimeout` in a test behave
 * exactly as they did before.
 */
const ALL_BUT_DATE = [
  'hrtime',
  'nextTick',
  'performance',
  'queueMicrotask',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'requestIdleCallback',
  'cancelIdleCallback',
  'setImmediate',
  'clearImmediate',
  'setInterval',
  'clearInterval',
  'setTimeout',
  'clearTimeout',
] as const;

/** Call at the top level of a test file: `new Date()` returns `now` for every test in it. */
export function pinToday(now: Date): void {
  beforeAll(() => {
    jest.useFakeTimers({ now, doNotFake: [...ALL_BUT_DATE] });
  });
  afterAll(() => {
    jest.useRealTimers();
  });
}
