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
 * React logs caught boundary errors to `console.error` by design; that noise is
 * silenced per-test so a genuine unexpected console error stays visible.
 */
import React from 'react';
import { Text } from 'react-native';
import ErrorBoundary from '../../components/ui/ErrorBoundary';
import { setCrashSink, type CrashReport } from '../../lib/crashReporting';
import { renderWithProviders, screen, type RenderedScreen } from '../helpers/renderWithProviders';

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

function textOf(tree: RenderedScreen): string {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string') {
      out.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === 'object' && 'children' in (node as { children?: unknown })) {
      const children = (node as { children?: unknown[] | null }).children;
      (children ?? []).forEach(walk);
    }
  };
  walk(tree.toJSON());
  return out.join(' ');
}

describe('ErrorBoundary', () => {
  it('renders children untouched when nothing throws', () => {
    const tree = renderWithProviders(
      <ErrorBoundary>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('alive')).toBeTruthy();
    expect(textOf(tree)).toContain('alive');
    expect(textOf(tree)).not.toContain('ters gitti');
  });

  it('catches a render throw and shows the fallback instead of unmounting', () => {
    const tree = renderWithProviders(
      <ErrorBoundary>
        <Boom explode />
      </ErrorBoundary>,
    );
    const text = textOf(tree);
    expect(text).toContain('Bir şeyler ters gitti');
    expect(text).toContain('Tekrar dene');
    expect(text).not.toContain('alive');
  });

  it('reports the caught error through the crash funnel', () => {
    const seen: CrashReport[] = [];
    setCrashSink((r) => seen.push(r));
    renderWithProviders(
      <ErrorBoundary context="today">
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].source).toBe('render');
    expect(seen[0].context).toBe('today');
    expect(seen[0].name).toBe('Error');
  });

  it('recovers when resetKeys change — the boundary must not latch forever', () => {
    const tree = renderWithProviders(
      <ErrorBoundary resetKeys={['a']}>
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(textOf(tree)).toContain('ters gitti');

    tree.rerender(
      <ErrorBoundary resetKeys={['b']}>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText('alive')).toBeTruthy();
    expect(textOf(tree)).toContain('alive');
  });

  it('does NOT reset when resetKeys are unchanged', () => {
    const tree = renderWithProviders(
      <ErrorBoundary resetKeys={['a']}>
        <Boom explode />
      </ErrorBoundary>,
    );
    tree.rerender(
      <ErrorBoundary resetKeys={['a']}>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(textOf(tree)).toContain('ters gitti');
  });

  it('renders a custom fallback when one is supplied', () => {
    const tree = renderWithProviders(
      <ErrorBoundary fallback={() => <Text>özel yedek</Text>}>
        <Boom explode />
      </ErrorBoundary>,
    );
    expect(screen.getByText('özel yedek')).toBeTruthy();
    expect(textOf(tree)).toContain('özel yedek');
  });
});
