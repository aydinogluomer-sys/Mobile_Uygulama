import { ReactNode } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font, radius, space } from '../../lib/tokens';
import { Button } from '../ui';

type Props = {
  /** 1-based, for the progress rail. */
  step: number;
  totalSteps: number;
  title: string;
  subtitle?: string;
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
  step, totalSteps, title, subtitle, children,
  primaryLabel, onPrimary, primaryDisabled, primaryLoading,
  secondaryLabel, onSecondary, error,
}: Props) {
  return (
    <SafeAreaView style={s.safe}>
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
          <TouchableOpacity onPress={onSecondary} style={s.secondary} accessibilityRole="button">
            <Text style={s.secondaryText}>{secondaryLabel}</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  progress: {
    flexDirection: 'row', gap: 6,
    paddingHorizontal: space.xxl, paddingTop: space.md, paddingBottom: space.xs,
  },
  segment: { flex: 1, height: 3, borderRadius: radius.pill },
  segmentOn: { backgroundColor: colors.primary },
  segmentOff: { backgroundColor: colors.border },

  scroll: { paddingHorizontal: space.xxl, paddingTop: space.xl, paddingBottom: space.h },
  title: { ...font.display, color: colors.text, marginBottom: space.md },
  subtitle: { ...font.body, color: colors.textDim, lineHeight: 23 },
  body: { marginTop: space.h, gap: space.h },

  footer: {
    paddingHorizontal: space.xxl, paddingTop: space.lg, paddingBottom: space.lg,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
    backgroundColor: colors.bg,
    gap: space.md,
  },
  error: { ...font.bodySm, color: colors.error, lineHeight: 19 },
  secondary: { alignItems: 'center', paddingVertical: space.xs },
  secondaryText: { ...font.body, color: colors.textDim },
});
