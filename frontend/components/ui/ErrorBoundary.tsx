/**
 * ErrorBoundary — plan §24 Phase 4 "crash reporting".
 *
 * Without this, a throw during render anywhere in the tree unmounts the whole
 * app to a blank screen. The user sees nothing, can do nothing, and the only
 * recovery is force-quitting. React gives exactly one mechanism to intercept
 * that, and it is only available to a class component — hence the class in a
 * codebase that is otherwise entirely hooks.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it does not catch errors in event
 * handlers, in `setTimeout`, or inside promises. That is React's design, not
 * an omission here — those paths are covered by
 * `installGlobalErrorHandlers()` in `lib/crashReporting.ts`. Stating it
 * explicitly matters because "we have an error boundary" is otherwise easily
 * mistaken for "crashes are handled", and the two are different sets.
 *
 * RESET SEMANTICS. `resetKeys` exists because a boundary that latches into
 * its error state forever is a worse failure than the crash: navigate away
 * and back, and the fallback is still there, because the boundary above the
 * navigator never re-rendered. Passing the route key means "the thing that
 * failed is gone; try again" — a real recovery path rather than a decorative
 * "Retry" button that re-renders the same broken subtree.
 */
import { Component, type ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { onColor, radius, space, type Palette } from '../../lib/tokens';
import { useThemedStyles } from '../../hooks/useThemeColors';
import { reportError } from '../../lib/crashReporting';

type Props = {
  children: ReactNode;
  /** Enum-shaped label for the report (screen or subtree name). */
  context?: string;
  /** When any value here changes, the boundary clears its error state. */
  resetKeys?: unknown[];
  /** Custom fallback. Receives a retry callback. */
  fallback?: (retry: () => void) => ReactNode;
};

type State = { error: Error | null };

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: space.xxl,
      gap: space.md,
      backgroundColor: c.bg,
    },
    title: { color: c.text, fontSize: 18, fontWeight: '600' },
    body: { color: c.textDim, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    button: {
      marginTop: space.sm,
      paddingVertical: space.md,
      paddingHorizontal: space.xl,
      borderRadius: radius.md,
      backgroundColor: c.primary,
    },
    buttonText: { color: onColor(c.primary), fontSize: 15, fontWeight: '600' },
    debug: {
      marginTop: space.lg,
      color: c.textFaint,
      fontSize: 11,
      textAlign: 'center',
    },
  });

function ErrorFallback({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.wrap} accessibilityRole="alert">
      <Text style={s.title}>Bir şeyler ters gitti</Text>
      <Text style={s.body}>
        Bu bölüm beklenmedik bir hatayla karşılaştı. Verilerin yerinde duruyor.
      </Text>
      <TouchableOpacity
        style={s.button}
        onPress={onRetry}
        accessibilityRole="button"
        accessibilityLabel="Tekrar dene"
      >
        <Text style={s.buttonText}>Tekrar dene</Text>
      </TouchableOpacity>
      {/* The message is shown in development only. In production it would be
          a raw internal string in front of a user who cannot act on it, and
          — per `scrubMessage`'s doc — error text is exactly where user
          content leaks, so it does not belong on screen either. */}
      {__DEV__ ? <Text style={s.debug}>{`${error.name}: ${error.message}`}</Text> : null}
    </View>
  );
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    // `componentStack` is the genuinely useful half of a React crash — it
    // names the component tree, which the JS stack (full of minified
    // framework frames) usually does not. It is passed through `reportError`
    // so it gets the same scrubbing as everything else rather than being
    // logged raw.
    reportError(error, 'render', this.props.context);
    if (__DEV__ && info?.componentStack) {
       
      console.error('[crash:render] component stack', info.componentStack);
    }
  }

  componentDidUpdate(prev: Props) {
    const { resetKeys } = this.props;
    if (!this.state.error || !resetKeys) return;
    const before = prev.resetKeys ?? [];
    const changed =
      before.length !== resetKeys.length || resetKeys.some((k, i) => !Object.is(k, before[i]));
    if (changed) this.setState({ error: null });
  }

  retry = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(this.retry);

    return <ErrorFallback error={error} onRetry={this.retry} />;
  }
}
