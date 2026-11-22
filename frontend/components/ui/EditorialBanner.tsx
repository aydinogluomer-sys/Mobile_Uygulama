import { Platform, StyleSheet, Text, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { font, fontFamily, hexA, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemeMode, useThemedStyles } from '../../hooks/useThemeColors';
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: c.surface,
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
      color: c.text,
      letterSpacing: -0.3,
    },
    subtitle: {
      ...font.bodySm,
      color: c.textDim,
      lineHeight: 19,
    },
    rightWrap: {
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

/**
 * Alt ekranlar, ritüel blokları ve modül üst kısımları için editöryel atmosferik başlık kartı.
 * Arka plandaki illüstrasyonu sıcak scrim katmanıyla yumuşatarak üstündeki serif/sans
 * tipografinin her zaman net okunmasını sağlar.
 */
export default function EditorialBanner({
  source,
  eyebrow,
  title,
  subtitle,
  accentColor,
  scrim = 0.56,
  minHeight = 116,
  radiusKey = 'lg',
  textureSource,
  textureOpacity = 0.06,
  rightSlot,
  children,
  style,
}: Props) {
  const c = useThemeColors();
  const mode = useThemeMode();
  const s = useThemedStyles(makeStyles);
  const reduceMotion = useReducedMotion();
  const resolvedAccent = accentColor ?? c.primary;
  const resolvedScrim = mode === 'light' ? Math.max(0.84, scrim) : scrim;

  return (
    <View
      style={[
        s.wrap,
        {
          minHeight,
          borderRadius: radius[radiusKey],
          borderColor: hexA(resolvedAccent, 0.26),
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
          <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(c.bgSunk, resolvedScrim) }]} />
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
                <Text style={[s.eyebrow, { color: resolvedAccent }]}>{eyebrow}</Text>
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
