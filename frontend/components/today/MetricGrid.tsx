import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { colors, space, radius, font, fontFamily } from '../../lib/tokens';

export type Metric = {
  eyebrow: string;
  /** büyük mono değer */
  value: string;
  sub: string;
  /** değer rengi (varsayılan: ink) */
  tone?: 'accent' | 'ok' | 'warn' | 'bad' | 'mute';
  onPress?: () => void;
};

const TONE: Record<NonNullable<Metric['tone']>, string> = {
  accent: colors.primary,
  ok: colors.success,
  warn: colors.warning,
  bad: colors.error,
  mute: colors.textGhost,
};

/** Sakin 2×2 metrik ızgarası — eyebrow + büyük mono değer + alt-metin. Atlas atl-metric deseni. */
export default function MetricGrid({ metrics }: { metrics: Metric[] }) {
  const { width } = useWindowDimensions();
  const wide = width >= 960;
  return (
    <View style={s.grid}>
      {metrics.map((m) => {
        const color = m.tone ? TONE[m.tone] : colors.text;
        const Wrapper: any = m.onPress ? TouchableOpacity : View;
        return (
          <Wrapper
            key={m.eyebrow}
            style={[s.cell, wide && s.cellWide]}
            {...(m.onPress ? { onPress: m.onPress, activeOpacity: 0.8, accessibilityRole: 'button', accessibilityLabel: `${m.eyebrow}: ${m.value}. ${m.sub}` } : {})}
          >
            <Text style={s.eyebrow}>{m.eyebrow}</Text>
            <Text style={[s.num, { color }]}>{m.value}</Text>
            <Text style={s.sub} numberOfLines={2}>{m.sub}</Text>
          </Wrapper>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cell: {
    flexGrow: 1, flexBasis: '46%', minWidth: 0,
    backgroundColor: colors.surface,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.lg, padding: space.lg,
  },
  cellWide: { flexBasis: '22%' },
  eyebrow: { ...font.overline, color: colors.textFaint, marginBottom: space.xs },
  num: { fontFamily: fontFamily.mono, fontSize: 28, fontWeight: '500', letterSpacing: -0.5, fontVariant: ['tabular-nums'] as any, marginBottom: 2 },
  sub: { ...font.caption, color: colors.textFaint, lineHeight: 16 },
});
