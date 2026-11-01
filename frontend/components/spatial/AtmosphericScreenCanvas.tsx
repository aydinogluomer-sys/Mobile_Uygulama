import {
  Animated,
  Platform,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { colors, hexA } from '../../lib/tokens';
import { useThemeStore } from '../../store/themeStore';
import SeasonalMotion from '../seasonalMotion/SeasonalMotion';
import { monthNameFromIndex } from '../seasonalMotion/config';
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
  /** Tam ekran atmosferik sahne tuali (`CANVASES.*`). */
  source: ImageSourcePropType;
  /** İsteğe bağlı ikincil mikro-doku katmanı (`TEXTURES.*`). */
  textureSource?: ImageSourcePropType;
  textureOpacity?: number;
  /** Görsel üzerindeki sıcak bazalt karartma yoğunluğu (WCAG AA >= 4.5:1 için varsayılan 0.58). */
  scrim?: number;
  /** Kaydırma pozisyonuna bağlı mikro-paralaks için Animated.Value. */
  scrollY?: Animated.Value;
  /** Üst köşe atmosferik ışık tonu (örn. `colors.primary`, `colors.warning`). */
  tintColor?: string;
  /** Mevsimsel ortam toz/ışık hareketi açık mı? */
  ambientMotion?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Katman 0 — Tam Ekran Atmosferik Sahne Tuali.
 * Yalnızca header'da görsel olması yerine tüm sayfa zeminini yaşayan,
 * kaydırmaya duyarlı paralakslı ve WCAG kontrast korumalı bir mekana dönüştürür.
 */
export default function AtmosphericScreenCanvas({
  source,
  textureSource,
  textureOpacity = 0.05,
  scrim = 0.58,
  scrollY,
  tintColor,
  ambientMotion = false,
  style,
}: Props) {
  const reduceMotion = useReducedMotion();
  const seasonalIntensity = useThemeStore((st) => st.seasonalMotion);
  const canAnimate = !IS_TEST && !reduceMotion && Boolean(scrollY);

  const parallaxStyle =
    canAnimate && scrollY
      ? {
          transform: [
            {
              translateY: scrollY.interpolate({
                inputRange: [-140, 0, 640],
                outputRange: [20, 0, -36],
                extrapolate: 'clamp',
              }),
            },
            {
              scale: scrollY.interpolate({
                inputRange: [-140, 0, 640],
                outputRange: [1.06, 1.02, 1.05],
                extrapolate: 'clamp',
              }),
            },
          ],
        }
      : undefined;

  if (IS_TEST) {
    return <View style={[StyleSheet.absoluteFill, s.root, style]} pointerEvents="none" />;
  }

  return (
    <View style={[StyleSheet.absoluteFill, s.root, style]} pointerEvents="none" {...decorativeA11y}>
      <Animated.View style={[StyleSheet.absoluteFill, parallaxStyle]}>
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={IS_TEST || reduceMotion ? 0 : 280}
          cachePolicy="memory-disk"
        />
      </Animated.View>

      {textureSource ? (
        <Image
          source={textureSource}
          style={[StyleSheet.absoluteFill, { opacity: textureOpacity }]}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : null}

      {/* Çift kademeli sıcak bazalt scrim — kartların ve metinlerin kontrastını garanti eder */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bg, scrim) }]} />

      {tintColor ? (
        <View style={[s.topGlow, { backgroundColor: hexA(tintColor, 0.07) }]} />
      ) : null}

      {ambientMotion && !IS_TEST ? (
        <SeasonalMotion
          month={monthNameFromIndex(new Date().getMonth())}
          intensity={seasonalIntensity === 'off' ? 'off' : 'subtle'}
          reduceMotion={reduceMotion}
          isVisible
        />
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    overflow: 'hidden',
    backgroundColor: colors.bg,
  },
  topGlow: {
    position: 'absolute',
    top: -120,
    left: -80,
    width: 380,
    height: 320,
    borderRadius: 220,
  },
});
