import { useState } from 'react';
import {
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityProps,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { hexA, radius, shadow, space } from '../../lib/tokens';
import { useThemeColors } from '../../hooks/useThemeColors';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';
import EmbeddedFiligree, { type FiligreeAnchor } from './EmbeddedFiligree';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

export type BentoBleedMode = 'right-vignette' | 'full-scrim' | 'top-header';

type Props = AccessibilityProps & {
  children: React.ReactNode;
  /** Kart içi Bento illüstrasyonu (`BENTO_ART.*`, `LIFE_AREA_ART.*`). */
  artSource?: ImageSourcePropType;
  artOpacity?: number;
  bleedMode?: BentoBleedMode;
  scrim?: number;
  /** İsteğe bağlı gömülü köşe/merkez filigranı (`DECOR.*`). */
  filigreeSource?: ImageSourcePropType;
  filigreeAnchor?: FiligreeAnchor;
  filigreeOpacity?: number;
  filigreeSize?: number;
  accentColor?: string;
  selected?: boolean;
  padding?: keyof typeof space | number;
  radiusKey?: keyof typeof radius;
  backgroundColor?: string;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Katman 2 & 3 — Awwwards Bento Görsel Kartı.
 * Sağdan veya tam yüzeyden kanamalı illüstrasyon, gömülü köşe filigranı,
 * yay fizikli dokunuş (`0.976` scale) ve Web fare hover kalkışı + speküler kenar ışıması sunar.
 */
export default function BentoVisualCard({
  children,
  artSource,
  artOpacity = 0.88,
  bleedMode = 'full-scrim',
  scrim = 0.42,
  filigreeSource,
  filigreeAnchor = 'bottom-right',
  filigreeOpacity = 0.16,
  filigreeSize = 118,
  accentColor,
  selected,
  padding = 'lg',
  radiusKey = 'lg',
  backgroundColor,
  onPress,
  disabled,
  style,
  ...a11y
}: Props) {
  const colors = useThemeColors();
  const resolvedAccent = accentColor ?? colors.primary;
  const resolvedBg = backgroundColor ?? colors.surface;
  const reduceMotion = useReducedMotion();
  const canAnimate = !IS_TEST && !reduceMotion;
  const [scale] = useState(() => new Animated.Value(1));
  const [liftY] = useState(() => new Animated.Value(0));
  const [hovered, setHovered] = useState(false);

  const pad = typeof padding === 'number' ? padding : space[padding];

  function animateTo(nextScale: number, nextY: number) {
    if (!canAnimate) return;
    Animated.parallel([
      Animated.spring(scale, {
        toValue: nextScale,
        tension: 250,
        friction: 21,
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.spring(liftY, {
        toValue: nextY,
        tension: 250,
        friction: 21,
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]).start();
  }

  const borderColor = selected
    ? resolvedAccent
    : hovered
    ? hexA(resolvedAccent, 0.55)
    : hexA(resolvedAccent, artSource ? 0.24 : 0.14);

  const ownedState = selected === undefined ? undefined : { selected, disabled };
  const accessibilityState =
    ownedState || a11y.accessibilityState
      ? { ...ownedState, ...a11y.accessibilityState }
      : disabled
      ? { disabled }
      : undefined;

  const inner = (
    <>
      {artSource && !IS_TEST ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" {...decorativeA11y}>
          <Image
            source={artSource}
            style={[
              bleedMode === 'top-header' ? s.topArt : StyleSheet.absoluteFill,
              { opacity: artOpacity },
            ]}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          {bleedMode !== 'top-header' ? (
            <View
              style={[
                StyleSheet.absoluteFill,
                {
                  backgroundColor: hexA(
                    colors.bgSunk,
                    bleedMode === 'right-vignette' ? scrim * 0.65 : scrim,
                  ),
                },
              ]}
            />
          ) : null}
        </View>
      ) : null}

      {filigreeSource ? (
        <EmbeddedFiligree
          source={filigreeSource}
          anchor={filigreeAnchor}
          opacity={filigreeOpacity}
          size={filigreeSize}
        />
      ) : null}

      <View style={{ padding: pad }}>{children}</View>
    </>
  );

  const boxStyle: ViewStyle = {
    backgroundColor: resolvedBg,
    borderRadius: radius[radiusKey],
    borderWidth: selected ? 1.5 : 1,
    borderColor,
    overflow: 'hidden',
    position: 'relative',
    ...(selected || hovered ? shadow.glow(resolvedAccent) : shadow.sm),
  };

  if (!onPress) {
    return (
      <View {...a11y} accessibilityState={accessibilityState} style={[boxStyle, style]}>
        {inner}
      </View>
    );
  }

  return (
    <Animated.View
      style={[
        canAnimate ? { transform: [{ scale }, { translateY: liftY }] } : null,
        style,
      ]}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={() => animateTo(0.978, 0)}
        onPressOut={() => animateTo(hovered ? 1.01 : 1, hovered ? -2 : 0)}
        onHoverIn={() => {
          setHovered(true);
          animateTo(1.01, -2);
        }}
        onHoverOut={() => {
          setHovered(false);
          animateTo(1, 0);
        }}
        accessibilityRole="button"
        {...a11y}
        accessibilityLabel={a11y.accessibilityLabel}
        accessibilityState={accessibilityState}
        style={boxStyle}
      >
        {inner}
      </Pressable>
    </Animated.View>
  );
}

const s = StyleSheet.create({
  topArt: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 92,
  },
});

