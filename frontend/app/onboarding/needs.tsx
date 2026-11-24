import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { font, space, type Palette } from '../../lib/tokens';
import { useThemedStyles } from '../../hooks/useThemeColors';
import OnboardingScaffold from '../../components/onboarding/OnboardingScaffold';
import { ONBOARDING_ART } from '../../lib/visualAssets';
import SelectableTile from '../../components/onboarding/SelectableTile';
import { useOnboardingStore } from '../../store/onboardingStore';
import {
  BARRIER_IDS, BARRIER_LABELS, GOAL_IDS, GOAL_LABELS, MAX_GOALS, canAdvanceFromNeeds,
} from '../../lib/onboarding';

/**
 * Step 1 — what the user wants, and what stops them.
 *
 * Both answers change the plan. Goals rank the candidate habits; the barrier
 * changes both the ranking and, for two of the seven, the starting targets
 * themselves (`lib/starterPlan.ts`). Nothing on this screen is collected "for
 * later".
 */
export default function OnboardingNeedsScreen() {
  const router = useRouter();
  const s = useThemedStyles(makeStyles);
  const answers = useOnboardingStore((s) => s.answers);
  const toggleGoal = useOnboardingStore((s) => s.toggleGoal);
  const setBarrier = useOnboardingStore((s) => s.setBarrier);
  const saveProgress = useOnboardingStore((s) => s.saveProgress);
  const skip = useOnboardingStore((s) => s.skip);
  const saving = useOnboardingStore((s) => s.saving);
  const saveError = useOnboardingStore((s) => s.saveError);
  const loadError = useOnboardingStore((s) => s.loadError);

  const markStarted = useOnboardingStore((s) => s.markStarted);
  useEffect(() => { markStarted(); }, [markStarted]);

  const goalsFull = answers.goals.length >= MAX_GOALS;

  async function handleContinue() {
    // Persist before advancing, so closing the app on step 2 does not lose
    // step 1. The write does not mark the flow finished — see `saveProgress`.
    const ok = await saveProgress('needs');
    if (!ok) return;
    router.push('/onboarding/preferences');
  }

  async function handleSkip() {
    // Recorded, not merely navigated away from: an unrecorded skip would put
    // the user back here on the next launch, forever.
    const ok = await skip();
    if (!ok) return;
    router.replace('/tabs/today');
  }

  return (
    <OnboardingScaffold
      step={1}
      totalSteps={3}
      heroSource={ONBOARDING_ART.step1Compass}
      title="Seni biraz tanıyalım"
      subtitle="Hedeflerini bilirsek sana daha uygun bir başlangıç hazırlayabiliriz."
      primaryLabel="Devam et"
      onPrimary={handleContinue}
      primaryDisabled={!canAdvanceFromNeeds(answers) || saving}
      primaryLoading={saving}
      secondaryLabel="Şimdilik geç"
      onSecondary={handleSkip}
      error={saveError ?? loadError}
    >
      <View style={s.section}>
        <Text style={s.sectionTitle}>Neyi geliştirmek istiyorsun?</Text>
        <Text style={s.sectionHint}>
          En fazla {MAX_GOALS} seçim yapabilirsin. {answers.goals.length}/{MAX_GOALS} seçildi.
        </Text>
        <View style={s.chipGrid}>
          {GOAL_IDS.map((goal) => (
            <View key={goal} style={s.chipCell}>
              <SelectableTile
                role="checkbox"
                label={GOAL_LABELS[goal]}
                selected={answers.goals.includes(goal)}
                // Refused rather than silently evicting the oldest choice, so
                // a chip the user picked on purpose never vanishes on its own.
                disabled={goalsFull}
                onPress={() => toggleGoal(goal)}
              />
            </View>
          ))}
        </View>
      </View>

      <View style={s.section}>
        <Text style={s.sectionTitle}>Sürdürmeni en çok ne zorlaştırıyor?</Text>
        <Text style={s.sectionHint}>Sana en yakın olan tek seçeneği işaretle.</Text>
        <View style={s.list}>
          {BARRIER_IDS.map((barrier) => (
            <SelectableTile
              key={barrier}
              role="radio"
              label={BARRIER_LABELS[barrier]}
              selected={answers.primaryBarrier === barrier}
              onPress={() => setBarrier(barrier)}
            />
          ))}
        </View>
      </View>
    </OnboardingScaffold>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  section: { gap: space.md },
  sectionTitle: { ...font.h2, color: colors.text },
  sectionHint: { ...font.bodySm, color: colors.textFaint, marginTop: -4 },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  // Two per row on a phone; wraps to one on a very narrow screen and to more
  // on web without a breakpoint.
  chipCell: { flexGrow: 1, flexBasis: '46%', minWidth: 150 },
  list: { gap: space.sm },
});
