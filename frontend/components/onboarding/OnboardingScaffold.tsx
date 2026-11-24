import { ReactNode } from 'react';
import { Platform, View, Text, StyleSheet, ScrollView, TouchableOpacity, type ImageSourcePropType } from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { Button } from '../ui';
import { AtmosphericScreenCanvas, EmbeddedFiligree } from '../spatial';
import { CANVASES, DECOR, TEXTURES } from '../../lib/visualAssets';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

type Props = {
  /** 1-based, for the progress rail. */
  step: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
  /** Optional editorial hero illustration for this onboarding step. */
  heroSource?: ImageSourcePropType;
  children: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  primaryDisabled?: boolean;
  primaryLoading?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
  /** Shown above the actions — a save failure, not a validation hint. */
  error?: string | null;
};

/**
 * The frame every onboarding step shares: progress, heading, body, actions.
 *
 * Three screens with the same shape written three times is three chances for
 * them to drift — a different heading size, a CTA in a different place, a
 * progress rail that disagrees with itself. The steps supply the questions;
 * this supplies everything around them.
 *
 * The progress rail is segments rather than a percentage bar because the flow
 * has three discrete answers, not a continuous quantity, and a bar at 66%
 * invites "66% of what?".
 */
export default function OnboardingScaffold({
  step, totalSteps, title, subtitle, heroSource, children,
  primaryLabel, onPrimary, primaryDisabled, primaryLoading,
  secondaryLabel, onSecondary, error,
}: Props) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  return (
    <SafeAreaView style={s.safe}>
      <AtmosphericScreenCanvas
        source={heroSource ?? CANVASES.todaySanctuary}
        textureSource={TEXTURES.linen}
        scrim={0.72}
        tintColor={colors.primary}
      />
      <View
        style={s.progress}
        accessibilityRole="progressbar"
        accessibilityLabel={`Adım ${step} / ${totalSteps}`}
        accessibilityValue={{ min: 1, max: totalSteps, now: step }}
      >
        {Array.from({ length: totalSteps }, (_, i) => (
          <View key={i} style={[s.segment, i < step ? s.segmentOn : s.segmentOff]} />
        ))}
      </View>

      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">
        {!!heroSource && (
          <View style={s.heroWrap} pointerEvents="none" {...decorativeA11y}>
            <Image
              source={heroSource}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <View style={s.heroScrim} />
            <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" opacity={0.22} size={96} />
          </View>
        )}
        <Text style={s.title}>{title}</Text>
        {!!subtitle && <Text style={s.subtitle}>{subtitle}</Text>}
        <View style={s.body}>{children}</View>
      </ScrollView>

      <View style={s.footer}>
        {!!error && (
          <Text style={s.error} accessibilityLabel={`Hata: ${error}`}>{error}</Text>
        )}
        <Button
          label={primaryLabel}
          onPress={onPrimary}
          disabled={primaryDisabled}
          loading={primaryLoading}
          size="lg"
        />
        {!!secondaryLabel && !!onSecondary && (
          <TouchableOpacity
            onPress={onSecondary}
            style={s.secondary}
            accessibilityRole="button"
            accessibilityLabel={secondaryLabel}
          >
            <Text style={s.secondaryText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, position: 'relative' },
  progress: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: space.xxl, paddingTop: space.md, paddingBottom: space.xs,
  },
  segment: { flex: 1, height: 3, borderRadius: radius.pill },
  segmentOn: { backgroundColor: colors.primary },
  segmentOff: { backgroundColor: colors.border },

  scroll: { paddingHorizontal: space.xxl, paddingTop: space.lg, paddingBottom: space.h },
  heroWrap: {
    height: 118,
    borderRadius: radius.xl,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: hexA(colors.primary, 0.28),
    backgroundColor: colors.surfaceAlt,
    marginBottom: space.lg,
    position: 'relative',
  },
  heroScrim: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    backgroundColor: hexA(colors.bg, 0.22),
  },
  title: { ...font.display, color: colors.text, marginBottom: space.md },
  subtitle: { ...font.body, color: colors.textDim, lineHeight: 23 },
  body: { marginTop: space.h, gap: space.h },

  footer: {
    paddingHorizontal: space.xxl, paddingTop: space.lg, paddingBottom: space.lg,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
    backgroundColor: hexA(colors.bg, 0.88),
    gap: space.md,
  },
  error: { ...font.bodySm, color: colors.error, lineHeight: 19 },
  secondary: { alignItems: 'center', paddingVertical: space.xs },
  secondaryText: { ...font.body, color: colors.textDim },
});
