/**
 * Habit Detail screen invariants.  (Phase 2, CODER-H, plan §11)
 *
 * Source-level invariant tests, matching the established pattern in
 * rule4NoDirectDbInUi.test.ts / noUtcDayKeys.test.ts / seasonalRegression.test.ts
 * -- this repo has no @testing-library/react-native installed (checked: not in
 * package.json devDependencies), and every one of the three precedent files
 * above deliberately scans source TEXT rather than rendering a component, for
 * the same stated reason: the property under test ("is this mechanism wired
 * up") is a property of the source, not of runtime behaviour that needs a
 * mounted tree to observe.
 *
 * Covers (per this task's brief):
 *  1. the route is registered in app/screens/_layout.tsx and reachable from
 *     the habit list (HabitListView.tsx, the shared row renderer both
 *     app/tabs/habits.tsx and the Stats->List tab consume).
 *  2. all four tab labels exist verbatim: GENEL / GEÇMİŞ / TAKVİM / İÇGÖRÜ.
 *  3. the calendar renders FIVE visually distinct colours for the five
 *     plan-mandated states (full completion / partial / miss / skip / not
 *     scheduled) -- resolved against the REAL lib/tokens.ts colour values,
 *     not just distinct token names (two different token keys that happen to
 *     alias the same hex would be a false pass otherwise).
 *  4. every `{ok:false}` Result from lib/behaviorIntelligence.ts is rendered
 *     via its `.reason`, never silently replaced by a literal `0`.
 *  5. seasonalHeader is still spread onto BOTH `calendar` and
 *     `monthly-review` after this task's own _layout.tsx edit -- a
 *     regression fence for this task's own change, independent of (and in
 *     addition to) seasonalRegression.test.ts's pre-existing coverage of the
 *     same fact.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { colors } from '../../lib/tokens';

const ROOT = join(__dirname, '..', '..');

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

const LAYOUT_PATH = 'app/screens/_layout.tsx';
const SCREEN_PATH = 'app/screens/habit-detail.tsx';
const LIST_VIEW_PATH = 'components/HabitListView.tsx';

// ---------------------------------------------------------------------------
// 1 -- route registration + reachability from the habit list
// ---------------------------------------------------------------------------

describe('Habit Detail -- route registration and reachability', () => {
  it('app/screens/habit-detail.tsx exists', () => {
    expect(() => read(SCREEN_PATH)).not.toThrow();
  });

  it('is registered as a Stack.Screen in app/screens/_layout.tsx', () => {
    const layout = read(LAYOUT_PATH);
    expect(/<Stack\.Screen\s+name="habit-detail"/.test(layout)).toBe(true);
  });

  it('the habit list navigates to it with an id param (router.push pathname + params)', () => {
    const listView = read(LIST_VIEW_PATH);
    expect(/router\.push\(\s*\{\s*pathname:\s*['"]\/screens\/habit-detail['"]/.test(listView)).toBe(true);
    expect(/params:\s*\{\s*id:/.test(listView)).toBe(true);
  });

  it('the screen reads the id param via useLocalSearchParams', () => {
    const screen = read(SCREEN_PATH);
    expect(/useLocalSearchParams/.test(screen)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2 -- four tab labels
// ---------------------------------------------------------------------------

describe('Habit Detail -- four tabs', () => {
  const screen = read(SCREEN_PATH);
  it.each(['GENEL', 'GEÇMİŞ', 'TAKVİM', 'İÇGÖRÜ'])('renders the "%s" tab label', (label) => {
    expect(screen.includes(label)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3 -- five visually distinct calendar-state colours
// ---------------------------------------------------------------------------

/**
 * Matches `stateKey: colors.tokenName` pairs inside the CALENDAR_STATE_COLORS
 * object literal. Deliberately requires the `colors.` prefix (not a bare hex)
 * so the screen keeps using lib/tokens.ts's design-system palette rather than
 * a hardcoded hex -- and so this test can resolve the REAL colour value
 * rather than trusting two different-looking token names not to alias.
 */
const STATE_COLOR_ENTRY = /(\w+)\s*:\s*colors\.(\w+)/g;

function extractCalendarStateColors(screenText: string): { key: string; token: string; hex: string }[] {
  const m = screenText.match(/CALENDAR_STATE_COLORS[^{]*\{([^}]*)\}/s);
  if (!m) return [];
  const body = m[1];
  const out: { key: string; token: string; hex: string }[] = [];
  for (const entryMatch of body.matchAll(STATE_COLOR_ENTRY)) {
    const [, key, token] = entryMatch;
    const hex = (colors as Record<string, string>)[token];
    out.push({ key, token, hex });
  }
  return out;
}

describe('Habit Detail -- five distinct calendar-state colours (plan §11 explicit requirement)', () => {
  const screen = read(SCREEN_PATH);
  const entries = extractCalendarStateColors(screen);
  const EXPECTED_STATES = ['full', 'partial', 'miss', 'skip', 'not_scheduled'];

  it('defines a CALENDAR_STATE_COLORS map with exactly the five plan-mandated state keys', () => {
    expect(entries.map((e) => e.key).sort()).toEqual([...EXPECTED_STATES].sort());
  });

  it('every mapped colour resolves to a real, defined lib/tokens.ts colour (no typo\'d token name)', () => {
    for (const e of entries) {
      expect(typeof e.hex).toBe('string');
      expect(e.hex.length).toBeGreaterThan(0);
    }
  });

  it('all five resolved colours are pairwise distinct -- no two states share a colour', () => {
    const hexes = entries.map((e) => e.hex);
    expect(new Set(hexes).size).toBe(5);
  });

  it('(-) Calm-Tech (F31): miss state colour is neutral and NEVER colors.error', () => {
    const missEntry = entries.find((e) => e.key === 'miss');
    expect(missEntry).toBeDefined();
    expect(missEntry!.token).not.toBe('error');
    expect(missEntry!.hex.toLowerCase()).not.toBe(colors.error.toLowerCase());
  });

  it('proves the extractor actually parses the object literal shape (sanity check)', () => {
    const sample = `
      const CALENDAR_STATE_COLORS: Record<CalendarDayState, string> = {
        full: colors.success,
        partial: colors.warning,
        miss: colors.error,
        skip: colors.info,
        not_scheduled: colors.textGhost,
      };
    `;
    const parsed = extractCalendarStateColors(sample);
    expect(parsed.map((e) => e.key).sort()).toEqual([...EXPECTED_STATES].sort());
    expect(new Set(parsed.map((e) => e.hex)).size).toBe(5);
  });

  it('proves the extractor WOULD catch a real bug -- two states aliased to the same token', () => {
    const buggy = `
      const CALENDAR_STATE_COLORS: Record<CalendarDayState, string> = {
        full: colors.success,
        partial: colors.warning,
        miss: colors.error,
        skip: colors.error,
        not_scheduled: colors.textGhost,
      };
    `;
    const parsed = extractCalendarStateColors(buggy);
    expect(new Set(parsed.map((e) => e.hex)).size).toBe(4); // not 5 -- skip/miss collide
  });
});

// ---------------------------------------------------------------------------
// 4 -- {ok:false} renders .reason, never a fabricated 0
// ---------------------------------------------------------------------------

/**
 * The exact fabrication pattern this guards against: a ternary that renders
 * the real value on the `ok` branch but silently substitutes a literal `0`
 * (string or number) on the failure branch, instead of the Result's own
 * `.reason`. `[^:{}\n]*` keeps the "true" branch match on one line/expression
 * so this cannot accidentally straddle two unrelated ternaries.
 */
const FABRICATED_ZERO_TERNARY = /\.ok\s*\?[^:{}\n]*:\s*['"]?0['"]?/;

describe('Habit Detail -- insufficient-data (Result.ok===false) handling', () => {
  const screen = read(SCREEN_PATH);

  it('references .reason at least once (the insufficient-data branch is actually rendered)', () => {
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

  it('imports behaviorIntelligence and actually CALLS every Result-returning İÇGÖRÜ function (not just references the name)', () => {
    expect(/from\s+['"][^'"]*lib\/behaviorIntelligence['"]/.test(screen)).toBe(true);
    expect(/bestWeekday\s*\(/.test(screen)).toBe(true);
    expect(/worstWeekday\s*\(/.test(screen)).toBe(true);
    expect(/habitFragility\s*\(/.test(screen)).toBe(true);
    // completionTrend must be called at least twice -- plan §11 asks for BOTH
    // a 4-week and a 12-week trend, not one call reused for both.
    expect((screen.match(/completionTrend\s*\(/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(/streakStability\s*\(/.test(screen)).toBe(true);
  });

  it('proves the fabricated-zero scanner actually fires on the bug pattern', () => {
    expect(FABRICATED_ZERO_TERNARY.test('const v = r.ok ? r.value : 0;')).toBe(true);
    expect(FABRICATED_ZERO_TERNARY.test("const v = r.ok ? String(r.value) : '0';")).toBe(true);
  });

  it('proves the scanner stays silent on the correct pattern (explicit reason render, no ternary-to-zero)', () => {
    const correct = "if (!r.ok) { return <Text>{r.reason}</Text>; } return <Text>{r.value}</Text>;";
    expect(FABRICATED_ZERO_TERNARY.test(correct)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5 -- seasonalHeader regression fence for THIS task's own _layout.tsx edit
// ---------------------------------------------------------------------------

describe('Habit Detail -- does not disturb Rule 8 seasonalHeader on calendar/monthly-review', () => {
  const layout = read(LAYOUT_PATH);

  it('still defines the shared seasonalHeader options object (headerTransparent + headerBackground)', () => {
    const m = layout.match(/const\s+(\w+)\s*=\s*\{[^}]*headerTransparent:\s*true[^}]*\}/s);
    expect(m).not.toBeNull();
  });

  it.each(['calendar', 'monthly-review'])('the %s screen still spreads that options object', (route) => {
    const m = layout.match(/const\s+(\w+)\s*=\s*\{[^}]*headerTransparent:\s*true[^}]*\}/s);
    const optionsName = m ? m[1] : '';
    expect(optionsName).not.toBe('');
    const screenRe = new RegExp(`Stack\\.Screen\\s+name="${route}"[^\\n]*\\.\\.\\.${optionsName}`);
    expect(screenRe.test(layout)).toBe(true);
  });

  it('the new habit-detail route does NOT itself carry the seasonal header (it has no seasonal background)', () => {
    const m = layout.match(/Stack\.Screen\s+name="habit-detail"[^/]*\/>/s);
    expect(m).not.toBeNull();
    expect((m as RegExpMatchArray)[0].includes('seasonalHeader')).toBe(false);
  });
});
