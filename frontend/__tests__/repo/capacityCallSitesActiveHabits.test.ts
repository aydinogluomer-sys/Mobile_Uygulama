/**
 * W1 source-level invariant (task Phase-1 CODER-F): every `canActivate(`
 * call site in the four wired files must supply a capacity input that
 * traces back to `activeHabits` -- the plan §10 replacement for the fixed
 * 3-slot rule can only take effect when the caller passes the currently
 * active habits' load, not just a bare willpower cost.
 *
 * Written in the style of `__tests__/repo/rule4NoDirectDbInUi.test.ts`: this
 * is a property of the SOURCE TEXT, the honest instrument for logic embedded
 * inside screen components not under render test here. Genuinely red before
 * W1 -- every call site listed in the task ("grep confirms every UI call
 * site still calls canActivate(cost) with no capacity input") is a bare
 * single-argument call today.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

const FILES: [string, string][] = [
  ['app/tabs/habits.tsx', join(ROOT, 'app', 'tabs', 'habits.tsx')],
  ['app/tabs/timeline.tsx', join(ROOT, 'app', 'tabs', 'timeline.tsx')],
  ['components/HabitOnboarding.tsx', join(ROOT, 'components', 'HabitOnboarding.tsx')],
  ['store/habitStore.ts', join(ROOT, 'store', 'habitStore.ts')],
];

/**
 * Extracts the full argument text of every `canActivate(...)` call in
 * `text`, by paren-balancing from the opening `(` -- robust to nested
 * parens/JSX (e.g. `!(capacityTarget && canActivate(...))`).
 */
function extractCanActivateCalls(text: string): string[] {
  const calls: string[] = [];
  const re = /\bcanActivate\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < text.length && depth > 0) {
      if (text[i] === '(') depth++;
      else if (text[i] === ')') depth--;
      i++;
    }
    calls.push(text.slice(start, i - 1));
  }
  return calls;
}

/**
 * Strips `//` and `/* *\/` comments so a prose mention of "canActivate()"
 * inside a doc comment (this codebase has one, in HabitOnboarding.tsx) can
 * never masquerade as a real call site.
 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * `activeHabits` itself, plus any local variable whose declaration's RHS
 * mentions `activeHabits` (one hop of indirection -- e.g.
 * `store/habitStore.ts`'s `const capacityInput = ... activeHabits ...`).
 * A call site is compliant if its argument text contains ANY of these names.
 */
function tracedIdentifiers(text: string): string[] {
  const names = new Set<string>(['activeHabits']);
  const declRe = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*?activeHabits[^;]*?);/g;
  let m: RegExpExecArray | null;
  while ((m = declRe.exec(text))) names.add(m[1]);
  return [...names];
}

describe('W1 -- canActivate call sites pass activeHabits-derived capacity data', () => {
  it.each(FILES)('%s calls canActivate at least once', (_name, path) => {
    const src = stripComments(readFileSync(path, 'utf8'));
    expect(extractCanActivateCalls(src).length).toBeGreaterThan(0);
  });

  it.each(FILES)('%s: every canActivate( call site references activeHabits (directly, or via a local variable traced back to it)', (_name, path) => {
    const src = stripComments(readFileSync(path, 'utf8'));
    const traced = tracedIdentifiers(src);
    const calls = extractCanActivateCalls(src);
    const missing = calls.filter((c) => !traced.some((name) => new RegExp(`\\b${name}\\b`).test(c)));
    expect(missing).toEqual([]);
  });
});

describe('scanner sanity', () => {
  it('extracts a single-line call correctly', () => {
    expect(extractCanActivateCalls('canActivate(cost, { habit, activeHabits })'))
      .toEqual(['cost, { habit, activeHabits }']);
  });

  it('extracts a legacy single-argument call correctly (the pre-W1 shape)', () => {
    expect(extractCanActivateCalls('canActivate(habitData.willpower_cost)'))
      .toEqual(['habitData.willpower_cost']);
  });

  it('correctly paren-balances a call nested inside other parens', () => {
    expect(extractCanActivateCalls('disabled={!(capacityTarget && canActivate(cost, { activeHabits }))}'))
      .toEqual(['cost, { activeHabits }']);
  });

  it('stripComments removes a prose mention of canActivate() from a comment, without touching a real call', () => {
    const src = "// canActivate()'in ikiziydi\ncanActivate(cost, { activeHabits })";
    expect(extractCanActivateCalls(stripComments(src))).toEqual(['cost, { activeHabits }']);
  });

  it('tracedIdentifiers follows one hop of indirection through a local variable', () => {
    const src = 'const capacityInput = ready ? { habit, activeHabits } : undefined;\ncanActivate(cost, capacityInput)';
    expect(tracedIdentifiers(src)).toEqual(expect.arrayContaining(['activeHabits', 'capacityInput']));
  });
});
