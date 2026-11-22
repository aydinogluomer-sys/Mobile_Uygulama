/**
 * Skeleton placeholder — plan §24 Phase 4 "skeleton states".
 *
 * Why this exists: 25 screens currently show a bare `ActivityIndicator` while
 * loading. A spinner communicates "something is happening"; a skeleton
 * communicates "here is the shape of what is arriving", which both shortens
 * perceived wait and stops the layout jumping when real content replaces it.
 *
 * Three deliberate properties:
 *
 *  1. **Reduce-motion is honoured.**
 *  2. **Native driver.**
 *  3. **Non-interactive.**
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type DimensionValue, type ViewStyle } from 'react-native';
import { radius, type Palette } from '../../lib/tokens';
import { useThemedStyles } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';

type Props = {
  width?: DimensionValue;
  height?: number;
  /** Fully round — for avatar/icon placeholders. */
  circle?: boolean;
  style?: ViewStyle;
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    base: { backgroundColor: c.surface },
  });

export default function Skeleton({ width = '100%', height = 14, circle = false, style }: Props) {
  const s = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const pulse = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    if (reduceMotion) {
      // Settle at the mid opacity rather than wherever the loop stopped, so a
      // reduce-motion user sees a deliberate resting state, not a frozen frame.
      pulse.setValue(0.55);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.9, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.55, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, pulse]);

  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        s.base,
        { width, height, borderRadius: circle ? height / 2 : radius.sm, opacity: pulse },
        style,
      ]}
    />
  );
}

/** A few stacked lines — the common "text is loading" case. */
export function SkeletonLines({ count = 3, gap = 8 }: { count?: number; gap?: number }) {
  return (
    <View pointerEvents="none" style={{ gap }}>
      {Array.from({ length: count }, (_, i) => (
        // Last line short, as real paragraphs end — a full-width last line reads
        // as a box rather than as text.
        <Skeleton key={i} width={i === count - 1 ? '60%' : '100%'} />
      ))}
    </View>
  );
}
