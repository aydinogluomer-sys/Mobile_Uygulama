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
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

/**
 * UPDATED for the service layer.
 *
 * `store/habitStore.ts` no longer calls `canActivate` — activation moved to
 * `services/habitService.activateHabit`, which asks
 * `capacityService.evaluateActivation` for a verdict. The INVARIANT is
 * unchanged and is still pinned, one describe block down: the capacity rule
 * must run against the real active-habit set rather than the weak fixed-slot
 * fallback. Only the file that has to satisfy it moved.
 *
 * The three screens still call `canActivate` directly for their disabled
 * states, so they stay here.
 */
const FILES: [string, string][] = [
  ['app/tabs/habits.tsx', join(ROOT, 'app', 'tabs', 'habits.tsx')],
  ['app/tabs/timeline.tsx', join(ROOT, 'app', 'tabs', 'timeline.tsx')],
  ['components/HabitOnboarding.tsx', join(ROOT, 'components', 'HabitOnboarding.tsx')],
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
// Was a fourth private copy of this helper. Its regex happened to be
// CRLF-safe where two of the others were not, which is exactly why the defect
// survived: fixing only the copy that failed would have left the rest broken.
// One implementation now, in `__tests__/helpers/sourceText.ts`.

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

describe('the service, not the store, now applies the capacity rule', () => {
  const service = stripComments(readFileSync(join(ROOT, 'services', 'habitService.ts'), 'utf8'));
  const store = stripComments(readFileSync(join(ROOT, 'store', 'habitStore.ts'), 'utf8'));

  it('activation goes through the service', () => {
    expect(store).toContain('activateHabitOp');
    expect(store).not.toMatch(/canActivate\(/);
  });

  it('the service evaluates capacity before writing', () => {
    const verdictAt = service.indexOf('evaluateActivation(');
    const writeAt = service.indexOf("status: 'active'");
    expect(verdictAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(verdictAt);
  });

  it('the real active-habit set reaches the capacity rule', () => {
    // The whole point of W1: without `activeHabits`, load is under-reported
    // and an activation that should be refused is permitted.
    expect(service).toMatch(/activeHabits: params\.activeHabits/);
    expect(store).toMatch(/activeHabits: habits\.filter\(\(h\) => h\.status === 'active'\)/);
  });

  it('the weak fixed-slot fallback is used only when the set is incomplete', () => {
    expect(store).toMatch(/useCapacityRule: !loading/);
    expect(service).toContain('params.useCapacityRule');
  });

  it('willpower is charged AFTER the status write, never before', () => {
    // Charging first and then failing the write debits a budget for a habit
    // that never activated.
    const writeAt = service.indexOf("status: 'active'");
    const spendAt = service.indexOf('await spend(');
    expect(spendAt).toBeGreaterThan(writeAt);
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
