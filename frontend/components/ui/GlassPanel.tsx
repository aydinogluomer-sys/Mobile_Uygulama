import { View, StyleSheet, ViewStyle, StyleProp, Platform } from 'react-native';
import { BlurView } from 'expo-blur';
import { Image } from 'expo-image';
import { radius, space, hexA, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemeMode, useThemedStyles } from '../../hooks/useThemeColors';
import { TEXTURES } from '../../lib/visualAssets';

type Props = {
  children: React.ReactNode;
  /** Blur yoğunluğu (0–100). */
  intensity?: number;
  /** Üstteki koyu/kâğıt dolgu opaklığı — okunabilirliği garantiler (blur zayıf render olsa bile). */
  tintAlpha?: number;
  padding?: keyof typeof space | number;
  radiusKey?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: hexA(c.text, 0.08),
    },
  });

/**
 * Görsel arka plan üzerinde içerik taşımak için frosted-glass kabı.
 * BlurView + yarı-saydam dolgu + ince kenarlık → parlak görsellerde bile metin okunur,
 * görsel panelin etrafında çerçeve gibi görünmeye devam eder.
 */
export default function GlassPanel({
  children, intensity = 22, tintAlpha = 0.5, padding = 'lg', radiusKey = 'lg', style,
}: Props) {
  const c = useThemeColors();
  const mode = useThemeMode();
  const s = useThemedStyles(makeStyles);
  const pad = typeof padding === 'number' ? padding : space[padding];
  return (
    <View style={[s.wrap, { borderRadius: radius[radiusKey] }, style]}>
      <BlurView intensity={intensity} tint={mode === 'dark' ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(c.bgSunk, tintAlpha) }]} />
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
        {...(Platform.OS === 'web'
          ? { 'aria-hidden': true }
          : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
      >
        <Image source={TEXTURES.clay} style={[StyleSheet.absoluteFill, { opacity: 0.04 }]} contentFit="cover" cachePolicy="memory-disk" />
      </View>
      <View style={{ padding: pad }}>{children}</View>
    </View>
  );
}
