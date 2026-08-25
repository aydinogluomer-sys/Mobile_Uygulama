/**
 * Monthly Review screen invariants.  (Phase 2, CODER-I, plan §12)
 *
 * Source-level invariant tests -- same instrument as `weeklyReviewScreen.
 * test.ts` / `habitDetailScreen.test.ts` / `seasonalRegression.test.ts`.
 *
 * Covers:
 *  1. the nine plan §12 blocks are present: Ay özeti · Trend · En iyi habit ·
 *     En sorunlu habit · Capacity trend · Recovery trend · Focus ·
 *     Completed goals · Reflection.
 *  2. Trend/En iyi/En sorunlu are computed via lib/behaviorIntelligence.ts
 *     (completionTrend/strongestHabit/mostFragileHabit), not hand-rolled.
 *  3. `{ ok: false }` on any of the new Result-typed fields renders
 *     `.reason`, never a fabricated literal `0`.
 *  4. REGRESSION FENCE (Rule 8) for this task's own edits: the screen still
 *     carries every protected seasonal-treatment marker, independent of (and
 *     in addition to) `seasonalRegression.test.ts`'s own coverage of the
 *     same facts.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

const SCREEN_PATH = 'app/screens/monthly-review.tsx';
const LAYOUT_PATH = 'app/screens/_layout.tsx';

describe('Monthly Review -- exists and is registered', () => {
  it('app/screens/monthly-review.tsx exists', () => {
    expect(() => read(SCREEN_PATH)).not.toThrow();
  });

  it('is registered as a Stack.Screen in app/screens/_layout.tsx', () => {
    const layout = read(LAYOUT_PATH);
    expect(/<Stack\.Screen\s+name="monthly-review"/.test(layout)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// nine plan §12 blocks
// ---------------------------------------------------------------------------

describe('Monthly Review -- nine §12 blocks', () => {
  const screen = read(SCREEN_PATH);

  it.each([
    ['Ay özeti', 'AY ÖZETİ'],
    ['Trend', 'TREND'],
    ['En iyi habit', 'En İyi Habit'],
    ['En sorunlu habit', 'En Sorunlu Habit'],
    ['Capacity trend', 'KAPASİTE TRENDİ'],
    ['Recovery trend', 'TELAFİ TRENDİ'],
    ['Focus', 'Odak'],
    ['Completed goals', 'TAMAMLANAN HEDEFLER'],
    ['Reflection', 'AYLIK YANSIMA'],
  ])('plan block "%s" is rendered (as "%s")', (_planItem, renderedLabel) => {
    expect(screen.includes(renderedLabel)).toBe(true);
  });
});

describe('Monthly Review -- Trend / En iyi / En sorunlu computed via lib/behaviorIntelligence.ts', () => {
  const screen = read(SCREEN_PATH);

  it('imports lib/behaviorIntelligence', () => {
    expect(/from\s+['"][^'"]*lib\/behaviorIntelligence['"]/.test(screen)).toBe(true);
  });

  it('calls completionTrend( at least twice (4-week AND 12-week, per plan §11/§12)', () => {
    expect((screen.match(/completionTrend\s*\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('calls strongestHabit( for "En iyi habit"', () => {
    expect(/strongestHabit\s*\(/.test(screen)).toBe(true);
  });

  it('calls mostFragileHabit( for "En sorunlu habit" (volatility, not merely lowest completion rate)', () => {
    expect(/mostFragileHabit\s*\(/.test(screen)).toBe(true);
  });

  it('calls recoverySuccessRate( for "Recovery trend"', () => {
    expect(/recoverySuccessRate\s*\(/.test(screen)).toBe(true);
  });

  it('calls dailyLoad( (lib/capacity.ts) for "Capacity trend"', () => {
    expect(/from\s+['"][^'"]*lib\/capacity['"]/.test(screen)).toBe(true);
    expect(/dailyLoad\s*\(/.test(screen)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// {ok:false} renders .reason, never a fabricated 0
//
// Scoped to the behaviorIntelligence-sourced `Result<T>` fields this task
// introduces (analysis.trend4/trend12/strongest/fragile/recoveryThisMonth/
// recoveryPrevMonth), NOT to every `.ok ?` in the file -- `logsRes.ok ?
// ... : 0` / `sessionsRes.ok ? ... : []` are a different, pre-existing type
// (`RepoResult<T>`, a DB-fetch outcome) that predates this task. A
// whole-file scan would false-positive on that unrelated, legitimate
// pattern (see weeklyReviewScreen.test.ts's identical note).
// ---------------------------------------------------------------------------

// Non-greedy across the whole line (not `[^:{}\n]*`) -- a brace-excluding
// class would stop at the first `${` inside a template-literal true branch
// and silently miss the bug (see weeklyReviewScreen.test.ts's identical note).
const FABRICATED_ZERO_TERNARY = /\banalysis\.(trend4|trend12|strongest|fragile|recoveryThisMonth|recoveryPrevMonth)\.ok\s*\?.*?:\s*['"]?0['"]?\b/;

describe('Monthly Review -- insufficient-data (Result.ok===false) handling', () => {
  const screen = read(SCREEN_PATH);

  it('references .reason at least once', () => {
    expect(screen.includes('.reason')).toBe(true);
  });

  it('never substitutes a literal 0 on any analysis.* Result field\'s failure branch', () => {
    const lines = screen.split('\n');
    const hits = lines
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => FABRICATED_ZERO_TERNARY.test(l))
      .map(([, n]) => n);
    expect(hits).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Rule 8 regression fence -- independent of seasonalRegression.test.ts
// ---------------------------------------------------------------------------

describe('Monthly Review -- Rule 8 seasonal treatment untouched by this task\'s own edits', () => {
  const screen = read(SCREEN_PATH);
  const layout = read(LAYOUT_PATH);

  it.each(['MonthBackground', 'active={isFocused}', 'MONTH_TAGLINES_TR', 'animatePage', 'pageStyle', 'reduceMotion'])(
    'monthly-review.tsx still contains "%s"',
    (marker) => {
      expect(screen.includes(marker)).toBe(true);
    },
  );

  it('_layout.tsx still spreads the shared seasonalHeader options object onto BOTH calendar and monthly-review', () => {
    const m = layout.match(/const\s+(\w+)\s*=\s*\{[^}]*headerTransparent:\s*true[^}]*\}/s);
    expect(m).not.toBeNull();
    const optionsName = m ? m[1] : '';
    expect(optionsName).not.toBe('');
    for (const route of ['calendar', 'monthly-review']) {
      const screenRe = new RegExp(`Stack\\.Screen\\s+name="${route}"[^\\n]*\\.\\.\\.${optionsName}`);
      expect(screenRe.test(layout)).toBe(true);
    }
  });
});
