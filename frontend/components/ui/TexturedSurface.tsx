import { Platform, StyleSheet, View, type StyleProp, type ViewStyle, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import { colors, radius, space } from '../../lib/tokens';

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

/**
 * Atlas "Paper & Clay" dokunsal yüzey kabı.
 * Kartlara, çekmeceye, günlük sayfalarına veya tam ekran katmanlara sıfır layout
 * kayması ve garantili WCAG kontrastı ile organik doku/mikro-desen ekler.
 */
export default function TexturedSurface({
  children,
  source,
  textureOpacity = 0.06,
  backgroundColor = colors.surface,
  borderColor = colors.border,
  borderWidth = 1,
  radiusKey = 'md',
  padding,
  overlayOnly = false,
  style,
}: Props) {
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
          backgroundColor,
          borderColor,
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

const s = StyleSheet.create({
  clip: {
    overflow: 'hidden',
    position: 'relative',
  },
});

