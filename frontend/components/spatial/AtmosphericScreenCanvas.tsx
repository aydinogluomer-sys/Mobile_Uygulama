import { useState } from 'react';
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
import { hexA, type Palette, type ThemeMode } from '../../lib/tokens';
import { useThemeColors, useThemeMode, useThemedStyles } from '../../hooks/useThemeColors';
import { useScreenActive } from '../../hooks/useScreenActive';
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
  /** Görsel üzerindeki sıcak bazalt/kâğıt karartma yoğunluğu (WCAG AA >= 4.5:1 için varsayılan 0.58). */
  scrim?: number;
  /** Kaydırma pozisyonuna bağlı mikro-paralaks için Animated.Value. */
  scrollY?: Animated.Value;
  /** Üst köşe atmosferik ışık tonu. */
  tintColor?: string;
  /** Mevsimsel ortam toz/ışık hareketi açık mı? */
  ambientMotion?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Açıkça verilirse odak ve AppState kararını geçersiz kılar (test ve özel durumlar). */
  active?: boolean;
};

export function effectiveScrim(scrim: number, mode: ThemeMode): number {
  return mode === 'light' ? Math.max(0.9, scrim) : scrim;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      overflow: 'hidden',
      backgroundColor: c.bg,
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

/**
 * Katman 0 — Tam Ekran Atmosferik Sahne Tuali.
 * Odakta olmayan veya arka plandaki ekranlarda tam ekran görseli ve mevsimsel
 * döngüyü düşürerek bellek ve çerçeve bütçesini korur (PRF-07, PRF-11).
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
  active,
}: Props) {
  const c = useThemeColors();
  const mode = useThemeMode();
  const s = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const seasonalIntensity = useThemeStore((st) => st.seasonalMotion);
  const screenActive = useScreenActive();
  const isActive = active ?? (IS_TEST ? false : screenActive);
  const [everActive, setEverActive] = useState(isActive);
  const [shownBefore, setShownBefore] = useState(false);

  if (isActive && !everActive) {
    setEverActive(true);
  } else if (!isActive && everActive && !shownBefore) {
    setShownBefore(true);
  }

  const canAnimate = !IS_TEST && !reduceMotion && isActive && Boolean(scrollY);

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

  if (!isActive) {
    return (
      <View
        style={[StyleSheet.absoluteFill, s.root, style]}
        pointerEvents="none"
        {...decorativeA11y}
      />
    );
  }

  const transitionMs = IS_TEST || reduceMotion || shownBefore ? 0 : 280;

  return (
    <View style={[StyleSheet.absoluteFill, s.root, style]} pointerEvents="none" {...decorativeA11y}>
      <Animated.View style={[StyleSheet.absoluteFill, parallaxStyle]}>
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={transitionMs}
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

      {/* Çift kademeli sıcak bazalt/kâğıt scrim — kartların ve metinlerin kontrastını garanti eder */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(c.bg, effectiveScrim(scrim, mode)) }]} />

      {tintColor ? (
        <View style={[s.topGlow, { backgroundColor: hexA(tintColor, 0.07) }]} />
      ) : null}

      {ambientMotion ? (
        <SeasonalMotion
          month={monthNameFromIndex(new Date().getMonth())}
          intensity={seasonalIntensity === 'off' ? 'off' : 'subtle'}
          reduceMotion={reduceMotion}
          isVisible={ambientMotion && isActive}
        />
      ) : null}
    </View>
  );
}
