import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { colors, hexA } from '../../lib/tokens';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

type Props = {
  /** Değer her değiştiğinde (ve truthy olduğunda) kart yüzeyinden altın/yosun onarım parıltısı geçer. */
  triggerKey: string | number | boolean | null | undefined;
  color?: string;
};

/**
 * Kintsugi telafi tamamlama ve ritüel işaretleme anları için tek seferlik
 * sakin altın/yosun ışık süpürmesi ("Kintsugi Gold Mend Shimmer").
 */
export default function GoldMendShimmer({ triggerKey, color = colors.warning }: Props) {
  const reduceMotion = useReducedMotion();
  const skip = IS_TEST || reduceMotion;
  const sweep = useRef(new Animated.Value(0)).current;
  const firstMount = useRef(true);

  useEffect(() => {
    if (firstMount.current) {
      firstMount.current = false;
      return;
    }
    if (skip || !triggerKey) return;
    sweep.setValue(0);
    Animated.timing(sweep, {
      toValue: 1,
      duration: 540,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [triggerKey, skip, sweep]);

  if (skip) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" {...decorativeA11y}>
      <Animated.View
        style={[
          s.beam,
          {
            backgroundColor: hexA(color, 0.22),
            opacity: sweep.interpolate({
              inputRange: [0, 0.15, 0.85, 1],
              outputRange: [0, 1, 0.8, 0],
            }),
            transform: [
              {
                translateX: sweep.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-180, 460],
                }),
              },
              { skewX: '-18deg' },
            ],
          },
        ]}
      />
    </View>
  );
}

export type GoldVeinProps = {
  length: number;
  thickness?: number;
  color?: string;
  angle?: number;
};

/**
 * Kintsugi statik altın damar çizgisi — Reduce Motion açıkken de görünür kalır.
 */
export function GoldVein({
  length,
  thickness = 1.5,
  color = colors.warning,
  angle = -45,
}: GoldVeinProps) {
  return (
    <View
      pointerEvents="none"
      {...decorativeA11y}
      style={[
        s.vein,
        {
          width: length,
          height: thickness,
          backgroundColor: color,
          transform: [{ rotate: `${angle}deg` }],
        },
      ]}
    />
  );
}

const s = StyleSheet.create({
  beam: {
    position: 'absolute',
    top: -10,
    bottom: -10,
    width: 96,
  },
  vein: {
    position: 'absolute',
  },
});

