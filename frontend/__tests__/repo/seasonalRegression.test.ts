/**
 * Regression fence for plan Rule 8's protected surfaces (Phase 0 QA pass,
 * commit 92becd9 "fix(FAZ 0)").
 *
 * These are repo-invariant / source-scanning tests, not component-rendering
 * tests -- deliberately, matching the established pattern in
 * noUtcDayKeys.test.ts. React Native rendering of these particular screens
 * needs a heavy RN/react-navigation/expo-blur mock stack for no behavioural
 * payoff here: what Rule 8 actually asks to be protected is *that a specific
 * mechanism is wired up* (an import, a prop, a function, a wrapper), which is
 * a property of the source text and is exactly what a source scan verifies
 * cheaply and reliably.
 *
 * Covers:
 *  1. Monthly Review seasonal background (app/screens/monthly-review.tsx)
 *  2. Calendar seasonal background (app/screens/calendar.tsx)
 *  3. MONTH_TAGLINES_TR single source of truth
 *  4. GlassPanel exists and is consumed by at least one screen
 *  5. transparent header (app/screens/_layout.tsx, calendar route)
 *  6. no-raw-entity guard -- locks in the W1 fix (21x react/no-unescaped-entities)
 *     by failing if &quot;/&apos;/&amp; ever lands inside a JS string/template
 *     literal instead of a JSX text node.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function read(relPath: string): string {
  return readFileSync(join(ROOT, relPath), 'utf8');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function rel(absPath: string): string {
  return absPath.slice(ROOT.length + 1).replace(/\\/g, '/');
}

// ---------------------------------------------------------------------------
// 1 & 2 -- seasonal background invariants, shared checker for both screens
// ---------------------------------------------------------------------------

const IMPORTS_MONTH_BACKGROUND = /import\s+MonthBackground\s+from\s+['"][^'"]*\/MonthBackground['"]/;
const RENDERS_ACTIVE_ISFOCUSED = /<MonthBackground[^>]*\bactive=\{isFocused\}/;
const IMPORTS_TAGLINES = /import\s*\{\s*MONTH_TAGLINES_TR\s*\}\s*from\s*['"][^'"]*seasonalMotion\/config['"]/;
const DEFINES_ANIMATE_PAGE = /function\s+animatePage\s*\(/;
const WRAPS_PAGE_STYLE = /<Animated\.View\s+style=\{pageStyle\}>/;
const USES_REDUCED_MOTION_HOOK = /useReducedMotion\s*\(\s*\)/;
const GUARDS_ON_REDUCE_MOTION = /if\s*\(\s*reduceMotion\s*\)/;

function seasonalScreenInvariants(relPath: string) {
  const text = read(relPath);
  return {
    importsMonthBackground: IMPORTS_MONTH_BACKGROUND.test(text),
    rendersActiveIsFocused: RENDERS_ACTIVE_ISFOCUSED.test(text),
    importsTaglines: IMPORTS_TAGLINES.test(text),
    definesAnimatePage: DEFINES_ANIMATE_PAGE.test(text),
    wrapsPageStyle: WRAPS_PAGE_STYLE.test(text),
    honoursReduceMotion: USES_REDUCED_MOTION_HOOK.test(text) && GUARDS_ON_REDUCE_MOTION.test(text),
  };
}

describe.each([
  ['Monthly Review', 'app/screens/monthly-review.tsx'],
  ['Calendar', 'app/screens/calendar.tsx'],
])('Rule 8 -- %s seasonal background (%s)', (_label, relPath) => {
  const r = seasonalScreenInvariants(relPath as string);

  it('imports MonthBackground and renders it with active={isFocused}', () => {
    expect(r.importsMonthBackground).toBe(true);
    expect(r.rendersActiveIsFocused).toBe(true);
  });

  it('imports MONTH_TAGLINES_TR from the seasonalMotion config (not redefined locally)', () => {
    expect(r.importsTaglines).toBe(true);
  });

  it('defines a page-flip animation (animatePage) and wraps content in <Animated.View style={pageStyle}>', () => {
    expect(r.definesAnimatePage).toBe(true);
    expect(r.wrapsPageStyle).toBe(true);
  });

  it('honours reduceMotion before animating (accessibility)', () => {
    expect(r.honoursReduceMotion).toBe(true);
  });
});

it('proves the seasonal-screen checker actually distinguishes present vs. absent', () => {
  // A screen that dropped every wired-up piece must read as all-false, not
  // as an artifact of a too-loose regex matching something unrelated.
  const stripped = seasonalScreenInvariants; // keep TS happy about unused import path
  void stripped;
  expect(IMPORTS_MONTH_BACKGROUND.test("import Something from '../../components/Other';")).toBe(false);
  expect(IMPORTS_MONTH_BACKGROUND.test("import MonthBackground from '../../components/MonthBackground';")).toBe(true);
  expect(RENDERS_ACTIVE_ISFOCUSED.test('<MonthBackground month={month} />')).toBe(false);
  expect(RENDERS_ACTIVE_ISFOCUSED.test('<MonthBackground month={month} active={isFocused} />')).toBe(true);
  expect(WRAPS_PAGE_STYLE.test('<View style={pageStyle}>')).toBe(false);
  expect(WRAPS_PAGE_STYLE.test('<Animated.View style={pageStyle}>')).toBe(true);
});

// ---------------------------------------------------------------------------
// 3 -- MONTH_TAGLINES_TR: exactly one file may define it; everyone else imports
// ---------------------------------------------------------------------------

const SCANNED_DIRS = ['app', 'components', 'lib'];

// Matches only a declaration of the exact identifier MONTH_TAGLINES_TR --
// e.g. `export const MONTH_TAGLINES_TR: string[] = [...]` or
// `const MONTH_TAGLINES_TR = [...]`. Deliberately does NOT match
// `const MONTH_TAGLINES = MONTH_TAGLINES_TR;` (calendar.tsx's local alias):
// the declared name there is MONTH_TAGLINES, not MONTH_TAGLINES_TR, so the
// `const\s+MONTH_TAGLINES_TR` sequence never occurs on that line.
const DEFINES_TAGLINES = /\bconst\s+MONTH_TAGLINES_TR\s*(?::|=)/;
const REFERENCES_TAGLINES = /\bMONTH_TAGLINES_TR\b/;
const IMPORTS_TAGLINES_NAMED = /import\s*\{[^}]*\bMONTH_TAGLINES_TR\b[^}]*\}\s*from\s*['"][^'"]+['"]/;

function scannedFiles(): string[] {
  return SCANNED_DIRS.flatMap((d) => walk(join(ROOT, d)));
}

describe('Rule 8 -- MONTH_TAGLINES_TR is defined in exactly one place', () => {
  it('is declared in exactly one file across app/, components/, lib/, namely seasonalMotion/config', () => {
    const definers = scannedFiles().filter((f) => DEFINES_TAGLINES.test(read(rel(f)))).map(rel);
    expect(definers).toHaveLength(1);
    expect(definers[0]).toMatch(/^components\/seasonalMotion\/config\.tsx?$/);
  });

  it('every other file that references MONTH_TAGLINES_TR imports it (never re-declares it)', () => {
    const files = scannedFiles();
    const consumers = files
      .map(rel)
      .filter((p) => !DEFINES_TAGLINES.test(read(p)) && REFERENCES_TAGLINES.test(read(p)));

    // Meaningfulness guard: if nobody outside the config consumes the
    // constant, the "every consumer imports it" assertion below would pass
    // vacuously. Calendar and Monthly Review are both known consumers.
    expect(consumers.length).toBeGreaterThan(0);

    for (const p of consumers) {
      expect(IMPORTS_TAGLINES_NAMED.test(read(p))).toBe(true);
    }
  });

  it('proves DEFINES_TAGLINES does not fire on the calendar.tsx local alias', () => {
    expect(DEFINES_TAGLINES.test('const MONTH_TAGLINES = MONTH_TAGLINES_TR;')).toBe(false);
    expect(DEFINES_TAGLINES.test('export const MONTH_TAGLINES_TR: string[] = [')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4 -- GlassPanel
// ---------------------------------------------------------------------------

describe('Rule 8 -- GlassPanel', () => {
  it('components/ui/GlassPanel.tsx exists and exports a default GlassPanel component', () => {
    const text = read('components/ui/GlassPanel.tsx');
    expect(/export\s+default\s+function\s+GlassPanel\s*\(/.test(text)).toBe(true);
  });

  it('is imported and rendered by at least one screen', () => {
    const consumers = walk(join(ROOT, 'app'))
      .concat(walk(join(ROOT, 'components')))
      .map(rel)
      .filter((p) => p !== 'components/ui/GlassPanel.tsx')
      .filter((p) => {
        const text = read(p);
        return /import\s+GlassPanel\s+from\s+['"][^'"]*ui\/GlassPanel['"]/.test(text) && /<GlassPanel[\s>]/.test(text);
      });
    expect(consumers.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 5 -- transparent header
//
// The real, current mechanism (found by inspection, not assumed): a shared
// `headerTransparent: true` + custom `headerBackground` options object in
// app/screens/_layout.tsx, spread onto the `calendar` Stack.Screen. There is
// no equivalent applied to `monthly-review` at this commit -- that gap is
// reported separately as a QA finding, not asserted here as a requirement,
// since Rule 8 names "transparent header" as its own protected surface
// (i.e. the pre-existing calendar behaviour), distinct from the "Monthly
// Review seasonal background" item covered above.
// ---------------------------------------------------------------------------

describe('Rule 8 -- transparent header (app/screens/_layout.tsx, calendar route)', () => {
  const text = read('app/screens/_layout.tsx');

  it('defines a headerTransparent:true option with a custom headerBackground', () => {
    expect(/headerTransparent:\s*true/.test(text)).toBe(true);
    expect(/headerBackground:\s*\(\)\s*=>/.test(text)).toBe(true);
  });

  // Both seasonal-background screens must carry it. monthly-review gained the
  // seasonal background in 92becd9 but was initially left on the default opaque
  // header (QA finding F-01), which covered the top strip of its own
  // MonthBackground/heroCover. Asserting both routes keeps them in step.
  it.each([['calendar'], ['monthly-review']])('applies that option to the %s screen', (route) => {
    const m = text.match(/const\s+(\w+)\s*=\s*\{[^}]*headerTransparent:\s*true[^}]*\}/s);
    expect(m).not.toBeNull();
    const optionsName = m ? m[1] : '';
    const screenRe = new RegExp(`Stack\\.Screen\\s+name="${route}"[^\\n]*\\.\\.\\.${optionsName}`);
    expect(screenRe.test(text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6 -- no-raw-entity guard: locks in the W1 fix
//
// &quot; / &apos; / &amp; only render as literal text (a visible bug) when
// they sit inside real JS -- a template literal, or a string literal that is
// itself a JS expression (inside `{}`, or passed as an argument to a call
// that is unambiguously JS territory such as Alert.alert / console.* / throw
// new Error). Bare JSX text (`<Text>A&apos;dan</Text>`, including text split
// around a `{expr}` interpolation, e.g. `&quot;{name}&quot; silindi`) and
// bare JSX attribute string literals (`title="A &quot; B"`) are NOT flagged:
// both are HTML-entity-decoded by the JSX transform itself, same as this
// codebase's real usage today (see app/tabs/habits.tsx, timeline.tsx).
//
// This is deliberately conservative (false negatives over false positives,
// per the brief): multi-line calls, nested template literals, and JS string
// literals outside the listed call names are NOT scanned. It exists to catch
// the exact class of regression W1 could have introduced, not to be a
// general-purpose linter.
// ---------------------------------------------------------------------------

const RAW_ENTITY_IN_JS_STRING: RegExp[] = [
  // entity inside a backtick template literal -- never decoded, regardless of
  // where the literal sits.
  /`[^`\n]*&(?:quot|apos|amp);[^`\n]*`/,
  // entity inside a quoted string literal that is itself a JS expression
  // container's whole content, e.g. `{'A &quot; B'}` or `title={"A &quot; B"}`.
  // Contrast with a *bare* JSX attribute string (`title="A &quot; B"`, no
  // surrounding `{}`), which JSX decodes exactly like JSX text and is safe.
  /\{\s*['"][^'"\n]*&(?:quot|apos|amp);[^'"\n]*['"]\s*\}/,
  // entity inside a quoted string argument to a call that is unambiguously
  // JS-string territory (dialog / log / thrown error) -- never JSX, never
  // decoded.
  /(?:Alert\.alert|\bnotify|\bconfirm|\bactionSheet|console\.(?:log|warn|error|info)|throw new Error|new Error)\([^)]*?['"][^'"\n]*&(?:quot|apos|amp);[^'"\n]*['"]/,
];

function entityViolations(): string[] {
  const hits: string[] = [];
  for (const dir of ['app', 'components']) {
    for (const file of walk(join(ROOT, dir))) {
      const p = rel(file);
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (RAW_ENTITY_IN_JS_STRING.some((re) => re.test(line))) hits.push(`${p}:${i + 1}`);
      });
    }
  }
  return hits;
}

describe('W1 regression guard -- no HTML entity ever lands inside a JS string/template literal', () => {
  it('finds no &quot;/&apos;/&amp; inside a JS string or template literal anywhere in app/ or components/', () => {
    expect(entityViolations()).toEqual([]);
  });

  it('proves the scanner actually fires on the bug pattern and stays silent on real, correct usage', () => {
    const flags = (line: string) => RAW_ENTITY_IN_JS_STRING.some((re) => re.test(line));

    // Real lines from this codebase today (post-W1) -- must NOT be flagged.
    expect(flags("<Text>AI&apos;dan özetlenmiştir</Text>")).toBe(false);
    expect(flags("<Text style={s.tip}>İpucu: bir KR&apos;ye dokun → değeri güncelle</Text>")).toBe(false);
    expect(flags('            &quot;{pendingDelete.habit.name}&quot; silindi')).toBe(false);
    expect(flags('<Text style={s.sectionHint}>Boş bırakırsan &quot;Gizli Savaşçı&quot; görünürsün.</Text>')).toBe(false);

    // The exact class of regression this guard exists to catch.
    expect(flags('const x = `Merhaba &quot; Dünya`;')).toBe(true);
    expect(flags("<Text>{'Merhaba &quot; Dünya'}</Text>")).toBe(true);
    expect(flags('title={"A &quot; B"}')).toBe(true);
    expect(flags('Alert.alert("Başlık", "İçerik &quot; metni")')).toBe(true);
    expect(flags('void notify("Başlık", "İçerik &quot; metni")')).toBe(true);
    expect(flags("void notify('Başlık', 'İçerik')")).toBe(false);
  });

  it('scans a non-trivial number of files', () => {
    const count = ['app', 'components'].reduce((n, d) => n + walk(join(ROOT, d)).length, 0);
    expect(count).toBeGreaterThan(50);
  });
});
