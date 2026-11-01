import { Platform, StyleSheet, Text, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { colors, font, fontFamily, hexA, radius, space } from '../../lib/tokens';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';

type Props = {
  source: ImageSourcePropType;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  accentColor?: string;
  /** Görsel üzerindeki koyu sıcak scrim yoğunluğu (WCAG AA >= 4.5:1 için varsayılan 0.56). */
  scrim?: number;
  minHeight?: number;
  radiusKey?: keyof typeof radius;
  /** İsteğe bağlı mikro-doku katmanı (örn. tex-archival-paper veya tex-topographic-contour). */
  textureSource?: ImageSourcePropType;
  textureOpacity?: number;
  rightSlot?: React.ReactNode;
  children?: React.ReactNode;
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
 * Alt ekranlar, ritüel blokları ve modül üst kısımları için editöryel atmosferik başlık kartı.
 * Arka plandaki illüstrasyonu sıcak koyu scrim katmanıyla yumuşatarak üstündeki serif/sans
 * tipografinin her zaman net okunmasını sağlar.
 */
export default function EditorialBanner({
  source,
  eyebrow,
  title,
  subtitle,
  accentColor = colors.primary,
  scrim = 0.56,
  minHeight = 116,
  radiusKey = 'lg',
  textureSource,
  textureOpacity = 0.06,
  rightSlot,
  children,
  style,
}: Props) {
  const reduceMotion = useReducedMotion();

  return (
    <View
      style={[
        s.wrap,
        {
          minHeight,
          borderRadius: radius[radiusKey],
          borderColor: hexA(accentColor, 0.26),
        },
        style,
      ]}
    >
      {!IS_TEST ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" {...decorativeA11y}>
          <Image
            source={source}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            transition={reduceMotion ? 0 : 240}
            cachePolicy="memory-disk"
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, scrim) }]} />
          {textureSource ? (
            <Image
              source={textureSource}
              style={[StyleSheet.absoluteFill, { opacity: textureOpacity }]}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
          ) : null}
        </View>
      ) : null}

      <View style={s.inner}>
        {(eyebrow || title || subtitle || rightSlot) ? (
          <View style={s.headerRow}>
            <View style={s.textCol}>
              {eyebrow ? (
                <Text style={[s.eyebrow, { color: accentColor }]}>{eyebrow}</Text>
              ) : null}
              {title ? <Text style={s.title}>{title}</Text> : null}
              {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
            </View>
            {rightSlot ? <View style={s.rightWrap}>{rightSlot}</View> : null}
          </View>
        ) : null}
        {children}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: colors.surface,
    borderWidth: 1,
    justifyContent: 'center',
  },
  inner: {
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.sm,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.md,
  },
  textCol: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    ...font.overline,
  },
  title: {
    fontFamily: fontFamily.serif,
    fontSize: 23,
    lineHeight: 28,
    color: colors.text,
    letterSpacing: -0.3,
  },
  subtitle: {
    ...font.bodySm,
    color: colors.textDim,
    lineHeight: 19,
  },
  rightWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

