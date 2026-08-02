import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, radius, font, fontFamily, hexA } from '../../lib/tokens';
import { useAccent } from '../../lib/useAccent';
import type { TodayNarrative } from '../../lib/todayNarrative';

type Cta = {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  variant?: 'primary' | 'secondary' | 'ghost';
  onPress: () => void;
};

type Props = {
  /** üst etiket: "Pzt, 15 Haziran · 25. hafta" */
  eyebrow: string;
  narrative: TodayNarrative;
  ctas: Cta[];
};

/** Editöryel Bugün hero — eyebrow + anlatısal serif başlık (clay vurgulu) + alt-metin + bağlamsal CTA'lar. */
export default function TodayHero({ eyebrow, narrative, ctas }: Props) {
  const accent = useAccent();
  const { width } = useWindowDimensions();
  const isCompact = width < 480;
  return (
    <View style={s.wrap}>
      <Text style={s.eyebrow}>{eyebrow}</Text>
      <Text style={[s.title, isCompact && s.titleCompact]}>
        {narrative.lead}
        <Text style={[s.em, { color: accent.primary }]}>{narrative.emphasis}</Text>
        {narrative.tail}
      </Text>
      <Text style={s.sub}>{narrative.sub}</Text>
      <View style={s.ctas}>
        {ctas.map((c) => {
          const variant = c.variant ?? 'ghost';
          const isPrimary = variant === 'primary';
          const isSecondary = variant === 'secondary';
          const fg = isPrimary ? colors.white : colors.text;
          return (
            <TouchableOpacity
              key={c.label}
              activeOpacity={0.85}
              onPress={c.onPress}
              accessibilityRole="button"
              accessibilityLabel={c.label}
              style={[
                s.cta,
                isPrimary && { backgroundColor: accent.primary, borderColor: accent.primary },
                isSecondary && { backgroundColor: accent.soft, borderColor: hexA(accent.primary, 0.28) },
                variant === 'ghost' && s.ctaGhost,
              ]}
            >
              <Ionicons name={c.icon} size={15} color={isPrimary ? colors.white : colors.textDim} />
              <Text style={[s.ctaText, { color: fg }]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { maxWidth: 760, marginBottom: space.xxl },
  eyebrow: { ...font.overline, color: colors.textFaint, marginBottom: space.sm },
  title: {
    fontFamily: fontFamily.serif,
    fontSize: 38,
    lineHeight: 45,
    color: colors.text,
    letterSpacing: -0.4,
    marginBottom: space.sm,
  },
  titleCompact: { fontSize: 29, lineHeight: 35 },
  em: { fontFamily: fontFamily.serif, fontStyle: 'italic', color: colors.primary },
  sub: { fontFamily: fontFamily.serif, fontStyle: 'italic', fontSize: 15, lineHeight: 22, color: colors.textDim, marginBottom: space.xl, maxWidth: 620 },
  ctas: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cta: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: space.lg, minHeight: 42, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border,
  },
  ctaGhost: { backgroundColor: colors.surface },
  ctaText: { ...font.bodySm, fontWeight: '700' },
});
