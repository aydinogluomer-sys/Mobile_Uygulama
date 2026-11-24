import { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { colors, space, radius, font, fontFamily, hexA, onColor } from '../../lib/tokens';
import { useAccent } from '../../lib/useAccent';
import { DECOR, getTodayHeroForHour, TEXTURES } from '../../lib/visualAssets';
import type { TodayNarrative } from '../../lib/todayNarrative';
import EmbeddedFiligree from '../spatial/EmbeddedFiligree';

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

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as const)
    : ({
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      } as const);

/** Editöryel Bugün hero — eyebrow + anlatısal serif başlık (clay vurgulu) + alt-metin + bağlamsal CTA'lar. */
function TodayHero({ eyebrow, narrative, ctas }: Props) {
  const accent = useAccent();
  const { width } = useWindowDimensions();
  const isCompact = width < 480;
  const heroArt = getTodayHeroForHour();
  return (
    <View style={s.wrap}>
      {!IS_TEST ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" {...decorativeA11y}>
          <Image source={heroArt} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.54) }]} />
          <Image source={TEXTURES.topographic} style={[StyleSheet.absoluteFill, { opacity: 0.05 }]} contentFit="cover" cachePolicy="memory-disk" />
          <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" opacity={0.18} size={148} />
        </View>
      ) : null}
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
          // R06.04 — readable on the accent fill whatever the accent theme.
          const fg = isPrimary ? onColor(accent.primary) : colors.text;
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
              <Ionicons name={c.icon} size={15} color={isPrimary ? fg : colors.textDim} />
              <Text style={[s.ctaText, { color: fg }]}>{c.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export default memo(TodayHero);

const s = StyleSheet.create({
  wrap: {
    width: '100%',
    marginBottom: space.xxl,
    padding: space.xl,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    position: 'relative',
  },
  eyebrow: { ...font.overline, color: colors.textFaint, marginBottom: space.sm },
  title: {
    fontFamily: fontFamily.serif,
    fontSize: 38,
    lineHeight: 45,
    color: colors.text,
    letterSpacing: -0.4,
    marginBottom: space.sm,
    maxWidth: 680,
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
  ctaGhost: { backgroundColor: hexA(colors.surface, 0.85) },
  ctaText: { ...font.bodySm, fontWeight: '700' },
});
