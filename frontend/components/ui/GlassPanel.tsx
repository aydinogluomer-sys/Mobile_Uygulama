import { View, StyleSheet, ViewStyle, StyleProp } from 'react-native';
import { BlurView } from 'expo-blur';
import { colors, radius, space, hexA } from '../../lib/tokens';

type Props = {
  children: React.ReactNode;
  /** Blur yoğunluğu (0–100). */
  intensity?: number;
  /** Üstteki koyu dolgu opaklığı — okunabilirliği garantiler (blur zayıf render olsa bile). */
  tintAlpha?: number;
  padding?: keyof typeof space | number;
  radiusKey?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
};

/**
 * Görsel arka plan üzerinde içerik taşımak için frosted-glass kabı.
 * BlurView + yarı-saydam koyu dolgu + ince açık kenarlık → parlak görsellerde bile metin okunur,
 * görsel panelin etrafında çerçeve gibi görünmeye devam eder.
 */
export default function GlassPanel({
  children, intensity = 22, tintAlpha = 0.5, padding = 'lg', radiusKey = 'lg', style,
}: Props) {
  const pad = typeof padding === 'number' ? padding : space[padding];
  return (
    <View style={[s.wrap, { borderRadius: radius[radiusKey] }, style]}>
      <BlurView intensity={intensity} tint="dark" style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, tintAlpha) }]} />
      <View style={{ padding: pad }}>{children}</View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: hexA(colors.white, 0.08),
  },
});
