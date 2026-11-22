/**
 * Weekly Review screen invariants.  (Phase 2, CODER-I, plan §12)
 *
 * Source-level invariant tests -- same instrument as `insightsScreen.test.ts`
 * / `habitDetailScreen.test.ts` (see either file's own doc for why a source
 * scan is the right tool here: no @testing-library/react-native in this
 * repo, and the property under test is "is this mechanism wired up", a
 * property of the source text).
 *
 * Covers:
 *  1. the six plan §12 auto-derived metrics are rendered: Toplam tamamlama ·
 *     Habit completion · Task completion · Focus duration · Recovery
 *     completion · Capacity overload days.
 *  2. the three reflection questions use the plan's exact wording.
 *  3. `Capacity overload days` is computed via lib/capacity.ts's `dailyLoad`
 *     (not hand-rolled), `Recovery completion` via
 *     lib/behaviorIntelligence.ts's `recoverySuccessRate`.
 *  4. `{ ok: false }` on `recoveryCompletion` renders `.reason`, never a
 *     fabricated literal `0`.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

const SCREEN_PATH = 'app/screens/weekly-review.tsx';

describe('Weekly Review -- exists and is registered', () => {
  it('app/screens/weekly-review.tsx exists', () => {
    expect(() => read(SCREEN_PATH)).not.toThrow();
  });

  it('is registered as a Stack.Screen in app/screens/_layout.tsx', () => {
    const layout = read('app/screens/_layout.tsx');
    expect(/<Stack\.Screen\s+name="weekly-review"/.test(layout)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §12 -- six auto-derived metrics
// ---------------------------------------------------------------------------

describe('Weekly Review -- six §12 auto-derived metrics', () => {
  const screen = read(SCREEN_PATH);

  it.each([
    ['Toplam tamamlama', 'Toplam Tamamlama'],
    ['Habit completion', 'Alışkanlık Tamamlama'],
    ['Task completion', 'Görev Tamamlama'],
    ['Focus duration', 'Odak Süresi'],
    ['Recovery completion', 'Telafi Tamamlama'],
    ['Capacity overload days', 'Aşırı Yüklenme'],
  ])('plan item "%s" is rendered (as "%s")', (_planItem, renderedLabel) => {
    expect(screen.includes(renderedLabel)).toBe(true);
  });

  it('Capacity overload days is computed via lib/capacity.ts dailyLoad(, not hand-rolled', () => {
    expect(/from\s+['"][^'"]*lib\/capacity['"]/.test(screen)).toBe(true);
    expect(/dailyLoad\s*\(/.test(screen)).toBe(true);
  });

  it('Recovery completion is computed via lib/behaviorIntelligence.ts recoverySuccessRate(', () => {
    expect(/from\s+['"][^'"]*lib\/behaviorIntelligence['"]/.test(screen)).toBe(true);
    expect(/recoverySuccessRate\s*\(/.test(screen)).toBe(true);
  });

  it('fetches recovery plans through the data layer, never a raw supabase call', () => {
    // Recovery reads moved behind `services/reviewService`; the invariant is
    // that the SCREEN never builds the query itself, whichever layer it asks.
    expect(/from\s+['"][^'"]*services\/reviewService['"]/.test(screen)).toBe(true);
    expect(/recoveryForPeriod\s*\(/.test(screen)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// three reflection questions, plan's exact wording
// ---------------------------------------------------------------------------

describe('Weekly Review -- three reflection questions (plan §12 exact wording)', () => {
  const screen = read(SCREEN_PATH);
  it.each(['Bu hafta ne işe yaradı?', 'Nerede zorlandın?', 'Gelecek hafta ne değişmeli?'])(
    'renders the question "%s"',
    (q) => {
      expect(screen.includes(q)).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// {ok:false} renders .reason, never a fabricated 0
//
// Scoped to the behaviorIntelligence-sourced `Result<T>` variable this task
// introduces (`recoveryCompletion`), NOT to every `.ok ?` in the file --
// `logsRes.ok ? ... : 0` / `sessionsRes.ok ? ... : []` are a different,
// pre-existing type (`RepoResult<T>`, a DB-fetch outcome) that predates this
// task and is out of its scope to change (see "DO NOT modify anything under
// frontend/lib/" / "preserve existing content"). A whole-file scan would
// false-positive on that unrelated, legitimate pattern.
// ---------------------------------------------------------------------------

// Non-greedy across the whole line (not `[^:{}\n]*`) because the real true
// branch here is a template literal containing `${...}` -- a brace-excluding
// class would stop before ever reaching the ternary's `:` and silently miss
// the exact bug this exists to catch (verified against a seeded regression,
// see this task's own red-first evidence).
const FABRICATED_ZERO_TERNARY = /\brecoveryCompletion\.ok\s*\?.*?:\s*['"]?0['"]?\b/;

describe('Weekly Review -- insufficient-data (Result.ok===false) handling', () => {
  const screen = read(SCREEN_PATH);

  it('references .reason at least once', () => {
    expect(screen.includes('.reason')).toBe(true);
  });

  it('never substitutes a literal 0 on recoveryCompletion\'s failure branch', () => {
    const lines = screen.split('\n');
    const hits = lines
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => FABRICATED_ZERO_TERNARY.test(l))
      .map(([, n]) => n);
    expect(hits).toEqual([]);
  });

  it('recoveryCompletion.ok branch renders the real value, non-ok branch renders .reason (not a substituted 0)', () => {
    expect(/autoMetrics\.recoveryCompletion\.ok\s*\?[\s\S]{0,120}?:\s*autoMetrics\.recoveryCompletion\.reason/.test(screen)).toBe(true);
  });
});

describe('Weekly Review -- F32 PS-14 time distribution bar & no-fabricated-zero focus source', () => {
  const screen = read(SCREEN_PATH);

  it('imports TimeDistributionBar, buildTimeDistribution, and habitDurationMinutes and renders after AutoMetricTile grid', () => {
    expect(/from\s+['"][^'"]*components\/review\/TimeDistributionBar['"]/.test(screen)).toBe(true);
    expect(/from\s+['"][^'"]*lib\/timeDistribution['"]/.test(screen)).toBe(true);
    expect(/buildTimeDistribution\s*\(/.test(screen)).toBe(true);
    expect(/habitDurationMinutes\s*\(/.test(screen)).toBe(true);

    const gridIdx = screen.lastIndexOf('<AutoMetricTile');
    const barIdx = screen.indexOf('<TimeDistributionBar');
    expect(gridIdx).toBeGreaterThan(0);
    expect(barIdx).toBeGreaterThan(gridIdx);
  });

  it('passes null (never ?? 0 or : 0) for focusMinutes into buildTimeDistribution when sessionsRes fails', () => {
    expect(/focusMinutes:\s*sessionsRes\.ok\s*\?\s*minutes\s*:\s*null/.test(screen)).toBe(true);
    expect(/focusMinutes\s*\?\?\s*0/.test(screen)).toBe(false);
  });
});
