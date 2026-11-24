import { Platform, StyleSheet, View, type StyleProp, type ViewStyle, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import { radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';

type Props = {
  children?: React.ReactNode;
  /** Kesintisiz doku veya mikro-desen görseli (`visualAssets.ts` üzerinden). */
  source: ImageSourcePropType;
  /** Dokunun görünürlük yoğunluğu (varsayılan 0.06 — metin kontrastını bozmaz). */
  textureOpacity?: number;
  backgroundColor?: string;
  borderColor?: string;
  borderWidth?: number;
  radiusKey?: keyof typeof radius;
  padding?: keyof typeof space | number;
  /** Salt arka plan katmanı olarak (absoluteFill) kullanmak için true. */
  overlayOnly?: boolean;
  style?: StyleProp<ViewStyle>;
};

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as const)
    : ({
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      } as const);

const makeStyles = (_c: Palette) =>
  StyleSheet.create({
    clip: {
      overflow: 'hidden',
      position: 'relative',
    },
  });

/**
 * Atlas "Paper & Clay" dokunsal yüzey kabı.
 * Kartlara, çekmeceye, günlük sayfalarına veya tam ekran katmanlara sıfır layout
 * kayması ve garantili WCAG kontrastı ile organik doku/mikro-desen ekler.
 */
export default function TexturedSurface({
  children,
  source,
  textureOpacity = 0.06,
  backgroundColor,
  borderColor,
  borderWidth = 1,
  radiusKey = 'md',
  padding,
  overlayOnly = false,
  style,
}: Props) {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const resolvedBg = backgroundColor ?? c.surface;
  const resolvedBorder = borderColor ?? c.border;

  if (overlayOnly) {
    if (IS_TEST) return null;
    return (
      <View style={[StyleSheet.absoluteFill, s.clip, style]} pointerEvents="none" {...decorativeA11y}>
        <Image
          source={source}
          style={[StyleSheet.absoluteFill, { opacity: textureOpacity }]}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      </View>
    );
  }

  const pad = padding === undefined ? undefined : typeof padding === 'number' ? padding : space[padding];

  return (
    <View
      style={[
        s.clip,
        {
          backgroundColor: resolvedBg,
          borderColor: resolvedBorder,
          borderWidth,
          borderRadius: radius[radiusKey],
          ...(pad !== undefined ? { padding: pad } : null),
        },
        style,
      ]}
    >
      {!IS_TEST ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" {...decorativeA11y}>
          <Image
            source={source}
            style={[StyleSheet.absoluteFill, { opacity: textureOpacity }]}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        </View>
      ) : null}
      {children}
    </View>
  );
}
