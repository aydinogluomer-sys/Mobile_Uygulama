import { View, Text, StyleSheet, useWindowDimensions } from 'react-native';
import { space, font, fontFamily, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { DECOR } from '../../lib/visualAssets';
import BentoVisualCard from '../spatial/BentoVisualCard';
import AnimatedMetricValue from '../motion/AnimatedMetricValue';
import StaggeredReveal from '../motion/StaggeredReveal';

export type Metric = {
  eyebrow: string;
  /** büyük mono değer */
  value: string;
  sub: string;
  /** değer rengi (varsayılan: ink) */
  tone?: 'accent' | 'ok' | 'warn' | 'bad' | 'mute';
  onPress?: () => void;
};

function toneColor(colors: Palette, tone: NonNullable<Metric['tone']>): string {
  switch (tone) {
    case 'accent':
      return colors.primary;
    case 'ok':
      return colors.success;
    case 'warn':
      return colors.warning;
    case 'bad':
      return colors.error;
    case 'mute':
      return colors.textGhost;
  }
}

/** Sakin 2×2 / 4×1 Bento metrik ızgarası — gömülü usturlap filigranı + akıcı mono sayaç + yay etkileşimi. */
export default function MetricGrid({ metrics }: { metrics: Metric[] }) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const { width } = useWindowDimensions();
  const wide = width >= 960;
  return (
    <View style={s.grid}>
      {metrics.map((m, idx) => {
        const color = m.tone ? toneColor(colors, m.tone) : colors.text;
        return (
          <StaggeredReveal key={m.eyebrow} index={idx} style={[s.cellWrap, wide && s.cellWide]}>
            <BentoVisualCard
              padding="lg"
              radiusKey="lg"
              accentColor={m.tone && m.tone !== 'mute' ? color : colors.borderStrong}
              filigreeSource={DECOR.cornerAstrolabe}
              filigreeAnchor="bottom-right"
              filigreeOpacity={0.14}
              filigreeSize={96}
              onPress={m.onPress}
              {...(m.onPress ? { accessibilityLabel: `${m.eyebrow}: ${m.value}. ${m.sub}` } : {})}
            >
              <Text style={s.eyebrow}>{m.eyebrow}</Text>
              <AnimatedMetricValue value={m.value} style={[s.num, { color }]} />
              <Text style={s.sub} numberOfLines={2}>{m.sub}</Text>
            </BentoVisualCard>
          </StaggeredReveal>
        );
      })}
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.md },
  cellWrap: {
    flexGrow: 1,
    flexBasis: '46%',
    minWidth: 0,
  },
  cellWide: { flexBasis: '22%' },
  eyebrow: { ...font.overline, color: colors.textFaint, marginBottom: space.xs },
  num: {
    fontFamily: fontFamily.mono,
    fontSize: 28,
    fontWeight: '500',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
    marginBottom: 2,
  },
  sub: { ...font.caption, color: colors.textFaint, lineHeight: 16 },
});
