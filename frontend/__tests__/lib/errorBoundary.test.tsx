/**
 * Plan §24 Phase 4 "crash reporting" — the boundary itself.
 *
 * WHY THIS IS A RENDER TEST AND NOT A SOURCE-TEXT ONE. Every other structural
 * guard in this repo greps production files, and four separate times that
 * instrument has produced a SILENT false pass (a match inside a comment; a
 * match satisfied by a different component in the same file; a body slice cut
 * at the wrong offset). An ErrorBoundary is the worst possible candidate for
 * that instrument: the only thing worth asserting is a *runtime* React
 * behaviour — does a throw during render get caught instead of unmounting the
 * tree — and no amount of reading the file proves it. `getDerivedStateFromError`
 * can be present and correct-looking while the boundary still fails to catch,
 * for reasons (a wrong export shape, a hook-vs-class mistake) that only
 * rendering reveals.
 *
 * This is the first `.test.tsx` in the repo. It uses `react-test-renderer`,
 * which the toolchain already provides, rather than adding a component-testing
 * dependency for a single suite.
 *
 * React logs caught boundary errors to `console.error` by design; that noise is
 * silenced per-test so a genuine unexpected console error stays visible.
 */
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import ErrorBoundary from '../../components/ui/ErrorBoundary';
import { setCrashSink, type CrashReport } from '../../lib/crashReporting';

function Boom({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error('render exploded');
  return <Text>alive</Text>;
}

let consoleSpy: jest.SpyInstance;

beforeEach(() => {
  consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  consoleSpy.mockRestore();
  setCrashSink(null);
});

/**
 * All rendered text, flattened — the honest way to ask "what does the user
 * see?".
 *
 * Walks the serialised output rather than `root.findAllByType(Text)`: the
 * latter returns test INSTANCES whose `children` are more instances, not the
 * strings, so it silently yields `''` for every assertion — a helper that
 * makes every `toContain` fail and every `not.toContain` pass. That asymmetry
 * is worth the comment: the same bug in a suite full of negative assertions
 * would have gone green.
 */
function textOf(tree: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: TestRenderer.ReactTestRendererJSON | string | null): void => {
    if (node == null) return;
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    (node.children ?? []).forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out.join(' ');
}

describe('ErrorBoundary', () => {
  it('renders children untouched when nothing throws', () => {
    // The counter-assertion: a boundary that always showed its fallback would
    // pass every "catches the throw" test below.
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary>
          <Boom explode={false} />
        </ErrorBoundary>,
      );
    });
    expect(textOf(tree)).toContain('alive');
    expect(textOf(tree)).not.toContain('ters gitti');
  });

  it('catches a render throw and shows the fallback instead of unmounting', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary>
          <Boom explode />
        </ErrorBoundary>,
      );
    });
    const text = textOf(tree);
    expect(text).toContain('Bir şeyler ters gitti');
    expect(text).toContain('Tekrar dene');
    expect(text).not.toContain('alive');
  });

  it('reports the caught error through the crash funnel', () => {
    const seen: CrashReport[] = [];
    setCrashSink((r) => seen.push(r));
    act(() => {
      TestRenderer.create(
        <ErrorBoundary context="today">
          <Boom explode />
        </ErrorBoundary>,
      );
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].source).toBe('render');
    expect(seen[0].context).toBe('today');
    expect(seen[0].name).toBe('Error');
  });

  it('recovers when resetKeys change — the boundary must not latch forever', () => {
    // The failure this guards against is worse than the crash: navigate away
    // and back, and a latched boundary still shows the fallback because the
    // boundary above the navigator never re-rendered.
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary resetKeys={['a']}>
          <Boom explode />
        </ErrorBoundary>,
      );
    });
    expect(textOf(tree)).toContain('ters gitti');

    act(() => {
      tree.update(
        <ErrorBoundary resetKeys={['b']}>
          <Boom explode={false} />
        </ErrorBoundary>,
      );
    });
    expect(textOf(tree)).toContain('alive');
  });

  it('does NOT reset when resetKeys are unchanged', () => {
    // Without this, a `componentDidUpdate` that cleared the error on every
    // update would pass the recovery test above and then re-render the broken
    // subtree on every parent render — an infinite throw/catch loop.
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary resetKeys={['a']}>
          <Boom explode />
        </ErrorBoundary>,
      );
    });
    act(() => {
      tree.update(
        <ErrorBoundary resetKeys={['a']}>
          <Boom explode={false} />
        </ErrorBoundary>,
      );
    });
    expect(textOf(tree)).toContain('ters gitti');
  });

  it('renders a custom fallback when one is supplied', () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(
        <ErrorBoundary fallback={() => <Text>özel yedek</Text>}>
          <Boom explode />
        </ErrorBoundary>,
      );
    });
    expect(textOf(tree)).toContain('özel yedek');
  });
});
