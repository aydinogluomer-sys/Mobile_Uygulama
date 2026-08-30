/**
 * §24 "crash reporting" — the subsystem is actually REACHED.
 *
 * `lib/crashReporting.ts` and `components/ui/ErrorBoundary.tsx` are fully
 * unit-tested (28 assertions between them, 10 mutations). None of that proves
 * the app ever calls them, and Coder N flagged exactly this: at the time,
 * `installGlobalErrorHandlers()` was called from nowhere — the same inertness
 * that had already been found in the sync queue and the analytics layer,
 * three times in one session. Behavioural tests cannot catch it, because they
 * invoke the module directly and pass whether or not production does.
 *
 * Instrument and defences are borrowed wholesale from
 * `syncLifecycleWired.test.ts`, including its two hard-won lessons:
 * COMMENTS ARE STRIPPED before matching (this repo's files discuss their own
 * function names at length, so a raw `includes` passes with the call deleted),
 * and SCOPE IS ANCHORED to the exact region meant.
 *
 * AC-C01  `installGlobalErrorHandlers()` is called at MODULE scope — not from
 *         inside the component, an effect, or a callback
 * AC-C02  the navigator is wrapped in `<ErrorBoundary>`
 * AC-C03  that boundary carries `resetKeys`, so it cannot latch forever
 * AC-C04  `ErrorBoundary` is exported from the ui barrel
 * AC-C05  the scanner rejects the near-misses it is supposed to reject
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '..', '..');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

const read = (p: string) => stripComments(readFileSync(join(ROOT, p), 'utf8'));

const layout = read('app/_layout.tsx');
const barrel = read('components/ui/index.ts');

/**
 * Everything BEFORE the component declaration — i.e. true module scope.
 *
 * This is the whole point of AC-C01 and it is why the check is a slice rather
 * than a whole-file `includes`. A call to `installGlobalErrorHandlers()`
 * inside the component body or an effect would still make the file "contain"
 * the string while being materially wrong: an effect runs no earlier than
 * after the first render commits, so a throw in this module's own import
 * chain (the supabase client, module-level store setup) or in the first
 * render itself happens BEFORE the handler exists, and is lost. A crash
 * during boot is the crash most worth reporting.
 */
function moduleScope(): string {
  const i = layout.indexOf('export default function RootLayout');
  expect(i).toBeGreaterThan(-1);
  return layout.slice(0, i);
}

/** The component's `return (...)` JSX — not the whole file. */
function renderedTree(): string {
  const i = layout.lastIndexOf('return (');
  expect(i).toBeGreaterThan(-1);
  return layout.slice(i);
}

describe('§24 crash reporting is wired, not inert', () => {
  it('AC-C01 installs global error handlers at module scope', () => {
    expect(moduleScope()).toMatch(/installGlobalErrorHandlers\(\)\s*;/);
  });

  it('AC-C01b the install call is NOT inside the component', () => {
    // The complement of the above. Asserting only "module scope contains it"
    // would still pass if a second, redundant call sat in an effect — and a
    // reader would reasonably conclude the effect one was load-bearing.
    const i = layout.indexOf('export default function RootLayout');
    expect(layout.slice(i)).not.toMatch(/installGlobalErrorHandlers\(/);
  });

  it('AC-C02 wraps the navigator in an ErrorBoundary', () => {
    const tree = renderedTree();
    const open = tree.indexOf('<ErrorBoundary');
    const stack = tree.indexOf('<Stack');
    const close = tree.indexOf('</ErrorBoundary>');
    // Absence-first: -1 would otherwise satisfy `open < stack`.
    expect(open).toBeGreaterThan(-1);
    expect(stack).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(-1);
    expect(open).toBeLessThan(stack);
    expect(stack).toBeLessThan(close);
  });

  it('AC-C03 gives the boundary resetKeys so it cannot latch forever', () => {
    // A boundary with no reset path is a worse outcome than the crash: the
    // user navigates away and back and still sees the fallback, because the
    // boundary above the navigator never re-rendered.
    const tree = renderedTree();
    const open = tree.slice(tree.indexOf('<ErrorBoundary'), tree.indexOf('>', tree.indexOf('<ErrorBoundary')));
    expect(open).toMatch(/resetKeys=\{/);
  });

  it('AC-C04 exports ErrorBoundary from the ui barrel', () => {
    expect(barrel).toMatch(/export \{ default as ErrorBoundary \} from '\.\/ErrorBoundary';/);
  });

  describe('AC-C05 scanner sanity — the defences actually defend', () => {
    it('stripComments removes a call that only appears in a comment', () => {
      const fixture = `
        // installGlobalErrorHandlers();
        /* <ErrorBoundary resetKeys={[1]}> */
        const x = 1;
      `;
      const out = stripComments(fixture);
      expect(out).not.toContain('installGlobalErrorHandlers');
      expect(out).not.toContain('ErrorBoundary');
      expect(out).toContain('const x = 1;');
    });

    it('stripComments keeps a URL intact', () => {
      expect(stripComments('const u = "https://example.com/a";')).toContain('https://example.com/a');
    });

    it('moduleScope really excludes the component body', () => {
      expect(moduleScope()).not.toContain('return (');
    });
  });
});
