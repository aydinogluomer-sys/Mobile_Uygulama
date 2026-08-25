/**
 * Insights screen invariants.  (Phase 2, CODER-I, plan §11)
 *
 * Source-level invariant tests, matching the established pattern in
 * `habitDetailScreen.test.ts` / `rule4NoDirectDbInUi.test.ts` /
 * `noUtcDayKeys.test.ts` / `seasonalRegression.test.ts` -- this repo has no
 * @testing-library/react-native installed, and every precedent file scans
 * source TEXT rather than rendering a component, for the same stated reason:
 * the property under test ("is this mechanism wired up") is a property of
 * the source, not of runtime behaviour that needs a mounted tree to observe.
 *
 * Covers (per CODER-I's brief):
 *  1. the route is registered in app/screens/_layout.tsx and reachable from
 *     the drawer (components/Drawer.tsx).
 *  2. all six plan §11 sections are present (Hafta / Ay / Alışkanlıklar /
 *     Kapasite / Telafi / Odak).
 *  3. the hero's week-over-week delta and weekday warning are actually
 *     COMPUTED via lib/behaviorIntelligence.ts's completionTrend/
 *     worstWeekday (not hand-rolled arithmetic) -- asserts the functions are
 *     CALLED, not just imported.
 *  4. every `{ ok: false }` Result is rendered via its `.reason`, never a
 *     fabricated literal `0`.
 *  5. morningEveningDifference is never called -- it is permanently
 *     unsupported by the schema (see lib/behaviorIntelligence.ts's own doc)
 *     and plan §11 excludes it from this screen.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

const LAYOUT_PATH = 'app/screens/_layout.tsx';
const DRAWER_PATH = 'components/Drawer.tsx';
const SCREEN_PATH = 'app/screens/insights.tsx';

// ---------------------------------------------------------------------------
// 1 -- route registration + reachability from the drawer
// ---------------------------------------------------------------------------

describe('Insights -- route registration and reachability', () => {
  it('app/screens/insights.tsx exists', () => {
    expect(() => read(SCREEN_PATH)).not.toThrow();
  });

  it('is registered as a Stack.Screen in app/screens/_layout.tsx', () => {
    const layout = read(LAYOUT_PATH);
    expect(/<Stack\.Screen\s+name="insights"/.test(layout)).toBe(true);
  });

  it('is reachable from the drawer (components/Drawer.tsx) with route "/screens/insights"', () => {
    const drawer = read(DRAWER_PATH);
    expect(drawer.includes("route: '/screens/insights'")).toBe(true);
  });

  it('the drawer entry sits inside the ALIŞKANLIKLAR group (plan says "check how existing entries are added and follow it")', () => {
    const drawer = read(DRAWER_PATH);
    const groupMatch = drawer.match(/title:\s*'ALIŞKANLIKLAR'[\s\S]*?\],\s*\},/);
    expect(groupMatch).not.toBeNull();
    expect((groupMatch as RegExpMatchArray)[0].includes("/screens/insights")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2 -- six plan §11 sections
// ---------------------------------------------------------------------------

describe('Insights -- six §11 sections (Hafta · Ay · Alışkanlıklar · Kapasite · Telafi · Odak)', () => {
  const screen = read(SCREEN_PATH);
  it.each(['HAFTA', 'AY', 'ALIŞKANLIKLAR', 'KAPASİTE', 'TELAFİ', 'ODAK'])('renders a SectionHeader titled "%s"', (title) => {
    const re = new RegExp(`<SectionHeader\\s+title="${title}"`);
    expect(re.test(screen)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3 -- hero block: delta + weekday warning sourced from behaviorIntelligence
// ---------------------------------------------------------------------------

describe('Insights -- hero delta + weekday warning come from lib/behaviorIntelligence.ts, not hand-rolled', () => {
  const screen = read(SCREEN_PATH);

  it('imports lib/behaviorIntelligence', () => {
    expect(/from\s+['"][^'"]*lib\/behaviorIntelligence['"]/.test(screen)).toBe(true);
  });

  it('actually CALLS completionTrend( for the week-over-week delta', () => {
    expect(/completionTrend\s*\(/.test(screen)).toBe(true);
  });

  it('actually CALLS worstWeekday( for the "Dikkat: ..." warning', () => {
    expect(/worstWeekday\s*\(/.test(screen)).toBe(true);
  });

  it('actually CALLS strongestHabit( for "En güçlü: ..."', () => {
    expect(/strongestHabit\s*\(/.test(screen)).toBe(true);
  });

  it('the hero renders the literal "Dikkat:" warning prefix and "önceki haftaya göre" delta suffix', () => {
    expect(screen.includes('Dikkat:')).toBe(true);
    expect(screen.includes('önceki haftaya göre')).toBe(true);
  });

  it('never calls morningEveningDifference -- permanently unsupported by the schema (plan §11 excludes it)', () => {
    expect(/morningEveningDifference\s*\(/.test(screen)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4 -- {ok:false} renders .reason, never a fabricated 0
// ---------------------------------------------------------------------------

/** Same fabrication pattern habitDetailScreen.test.ts guards against. */
const FABRICATED_ZERO_TERNARY = /\.ok\s*\?[^:{}\n]*:\s*['"]?0['"]?/;

describe('Insights -- insufficient-data (Result.ok===false) handling', () => {
  const screen = read(SCREEN_PATH);

  it('references .reason at least once (an insufficient-data branch is actually rendered)', () => {
    expect(screen.includes('.reason')).toBe(true);
  });

  it('never substitutes a literal 0 on a Result\'s failure branch (no ".ok ? ... : 0" pattern anywhere)', () => {
    const lines = screen.split('\n');
    const hits = lines
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => FABRICATED_ZERO_TERNARY.test(l))
      .map(([, n]) => n);
    expect(hits).toEqual([]);
  });

  it('proves the fabricated-zero scanner actually fires on the bug pattern', () => {
    expect(FABRICATED_ZERO_TERNARY.test('const v = r.ok ? r.value : 0;')).toBe(true);
  });
});
