/**
 * F08 (BLD-10) — the toast entrance that replaced react-native-animatable's `fadeInUp`.
 *
 * Opacity 0 -> 1 and translateY 12 -> 0 on React Native's own Animated, on the native driver.
 * `disabled` (or the OS Reduce Motion setting via `useReducedMotion()`) starts at the end values
 * and never starts an animation, so the content is simply there. The running animation is stopped
 * on unmount.
 */
import { useEffect, useRef } from 'react';
import { Animated, type ViewProps } from 'react-native';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';

export type FadeInUpViewProps = ViewProps & {
  /** true ise animasyon yok, içerik anında görünür (Hareketi Azalt). */
  readonly disabled?: boolean;
  /** Varsayılan 250 ms; 400 ms üstü kabul edilmez. */
  readonly duration?: number;
};

export const FADE_IN_UP_DEFAULT_MS = 250;
export const FADE_IN_UP_MAX_MS = 400;
export const FADE_IN_UP_OFFSET = 12;

const IS_TEST_ENV = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

export default function FadeInUpView({
  disabled = false,
  duration = FADE_IN_UP_DEFAULT_MS,
  style,
  children,
  ...rest
}: FadeInUpViewProps) {
  const systemReduceMotion = useReducedMotion();
  const skipAnimation = disabled || (!IS_TEST_ENV && systemReduceMotion);
  const progress = useRef(new Animated.Value(skipAnimation ? 1 : 0)).current;

  useEffect(() => {
    if (skipAnimation) {
      progress.setValue(1);
      return undefined;
    }
    const ms = Math.min(Math.max(0, duration), FADE_IN_UP_MAX_MS);
    const animation = Animated.timing(progress, { toValue: 1, duration: ms, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [skipAnimation, duration, progress]);

  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [FADE_IN_UP_OFFSET, 0] });

  return (
    <Animated.View {...rest} style={[style, { opacity: progress, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}
