/**
 * A failed data fetch must not render as a real measurement.
 *
 * This codebase already settled this question: `willpowerStore.score()` returns
 * `null` rather than a fabricated 100, with a comment stating that a guess
 * presented as a measurement is a bug -- the user sees a number they never
 * earned. The same rule applies to review screens: if the habit-log query
 * fails, "Toplam Tamamlama: 0" claims the user accomplished nothing this week.
 * That is a fabricated answer, not a missing one.
 *
 * `weekly-review.tsx` already applied the rule correctly to `recoveryCompletion`
 * ({ok:false, reason}) and `taskCompletionRate` (null). `totalCompletions` was
 * the one place still substituting 0 on a query failure.
 *
 * Source-text invariant, same instrument as `rule4NoDirectDbInUi.test.ts`.
 * Deliberately WINDOW-based, not line-based: the expressions it inspects are
 * multi-line, and a line-based matcher silently stops finding them the moment
 * the code is reformatted -- passing for the wrong reason.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

/** The `n` characters following the first occurrence of `anchor`. */
function windowAfter(src: string, anchor: string, n = 240): string {
  const i = src.indexOf(anchor);
  return i === -1 ? '' : src.slice(i, i + n);
}

describe('review screens never fabricate a 0 from a failed fetch', () => {
  const src = read('app/screens/weekly-review.tsx');

  it('the completed-log count yields null, not 0, when the fetch fails', () => {
    const w = windowAfter(src, 'const completedLogCount');
    expect(w).not.toBe('');
    expect(w).toMatch(/logsRes\.ok/);
    expect(w).toMatch(/:\s*null/);
    expect(w).not.toMatch(/:\s*0\b/);
  });

  it('totalCompletions is nullable so the UI can distinguish "none" from "unknown"', () => {
    const w = windowAfter(src, 'totalCompletions:', 120);
    expect(w).toMatch(/null/);
  });

  it('the Toplam Tamamlama tile renders a no-data label rather than String(0)', () => {
    const w = windowAfter(src, 'Toplam Tamamlama');
    expect(w).not.toBe('');
    expect(w).toMatch(/!=\s*null|Veri yok/);
  });

  it('scanner sanity -- the window matcher would catch a bare `: 0` failure branch', () => {
    const bad = 'const completedLogCount = logsRes.ok\n  ? logsRes.data.length\n  : 0;';
    const w = windowAfter(bad, 'const completedLogCount');
    expect(w).toMatch(/:\s*0\b/);
  });

  it('F13 INT-06 -- weekly-review.tsx const rate yields null, never 0, when logsRes fails', () => {
    const w = windowAfter(src, 'const rate');
    expect(w).not.toBe('');
    expect(w).toMatch(/logsRes\.ok/);
    expect(w).toMatch(/:\s*null\s*;/);
    expect(w).not.toMatch(/:\s*0\b/);
    expect(windowAfter('const rate = logsRes.ok ? 1 : 0;', 'const rate')).toMatch(/:\s*0\b/);
  });

  it('F13 INT-06 -- monthly-review.tsx const rate yields null, never 0, when logsRes fails', () => {
    const monthlySrc = read('app/screens/monthly-review.tsx');
    const w = windowAfter(monthlySrc, 'const rate');
    expect(w).not.toBe('');
    expect(w).toMatch(/logsRes\.ok/);
    expect(w).toMatch(/:\s*null\s*;/);
    expect(w).not.toMatch(/:\s*0\b/);
  });
});
