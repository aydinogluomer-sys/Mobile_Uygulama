import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, hexA, radius, space } from '../../lib/tokens';
import OnboardingScaffold from '../../components/onboarding/OnboardingScaffold';
import { useOnboardingStore } from '../../store/onboardingStore';
import { DAYPART_LABELS, GOAL_LABELS, PACE_LABELS } from '../../lib/onboarding';
import { DAYPART_ORDER } from '../../lib/starterPlan';

/**
 * Step 3 — the plan, before anything is written.
 *
 * ## Nothing here persists until the user says so
 *
 * The plan is a value in memory produced by `lib/starterPlan.ts`. Deselecting
 * a habit changes a local set; only "Bu planla başla" reaches the database,
 * through the same routine installation pipeline a Routine Pack uses.
 *
 * ## Why "edit" is deselection rather than an editor
 *
 * The app has no general proposal editor to reuse — `routineStore`'s
 * `completeProposal` fills in missing difficulty/minutes on an AI response,
 * which is a different job. Building a second habit editor here for a screen
 * the user sees once would be a lot of surface for one use, so the edit
 * afforded is the one that matters at this moment: drop what you do not want.
 * Everything else is editable on the habit itself afterwards, in the editor
 * that already exists.
 */
export default function OnboardingPlanScreen() {
  const router = useRouter();
  const plan = useOnboardingStore((s) => s.plan);
  const planReasons = useOnboardingStore((s) => s.planReasons);
  const answers = useOnboardingStore((s) => s.answers);
  const generatePlan = useOnboardingStore((s) => s.generatePlan);
  const installPlan = useOnboardingStore((s) => s.installPlan);
  const installing = useOnboardingStore((s) => s.installing);
  const installError = useOnboardingStore((s) => s.installError);

  /** Names the user removed from the preview. Local until install. */
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);

  // Arriving here directly (a reload on web, a deep link) with no plan in
  // memory regenerates it rather than showing an empty screen. Deterministic,
  // so the regenerated plan is the same one.
  useEffect(() => {
    if (!plan) generatePlan();
  }, [plan, generatePlan]);

  const kept = useMemo(
    () => (plan?.habits ?? []).filter((h) => !dropped.has(h.name)),
    [plan, dropped],
  );

  const grouped = useMemo(
    () => DAYPART_ORDER
      .map((daypart) => ({ daypart, habits: kept.filter((h) => h.daypart === daypart) }))
      .filter((g) => g.habits.length > 0),
    [kept],
  );

  const totalMinutes = kept.reduce((sum, h) => sum + h.estimated_minutes, 0);

  async function handleInstall() {
    if (kept.length === 0) return;
    // Apply the deselection to the plan the store will install, so what was
    // previewed is exactly what is written.
    if (dropped.size > 0 && plan) {
      useOnboardingStore.setState({ plan: { ...plan, habits: kept } });
    }
    const ok = await installPlan();
    if (!ok) return;   // the error is rendered; onboarding stays unfinished
    router.replace('/tabs/today');
  }

  if (!plan) {
    return (
      <OnboardingScaffold
        step={3} totalSteps={3}
        title="Planın hazırlanıyor"
        primaryLabel="Bu planla başla"
        onPrimary={() => {}}
        primaryDisabled
      >
        <Text style={s.muted}>Bir saniye…</Text>
      </OnboardingScaffold>
    );
  }

  return (
    <OnboardingScaffold
      step={3}
      totalSteps={3}
      title="Sana özel başlangıç planın ✨"
      primaryLabel="Bu planla başla"
      onPrimary={handleInstall}
      primaryDisabled={kept.length === 0 || installing}
      primaryLoading={installing}
      secondaryLabel={editing ? 'Düzenlemeyi bitir' : 'Alışkanlıkları düzenle'}
      onSecondary={() => setEditing((v) => !v)}
      error={installError}
    >
      <View style={s.summaryRow}>
        <View style={s.summaryCell}>
          <Text style={s.eyebrow}>ODAK ALANLARIN</Text>
          <Text style={s.summaryValue}>
            {answers.goals.length > 0
              ? answers.goals.map((g) => GOAL_LABELS[g]).join(' · ')
              : 'Genel başlangıç'}
          </Text>
        </View>
        <View style={s.summaryCell}>
          <Text style={s.eyebrow}>BAŞLANGIÇ TEMPON</Text>
          <Text style={s.summaryValue}>{answers.pace ? PACE_LABELS[answers.pace] : 'Dengeli'}</Text>
        </View>
      </View>

      {grouped.map((group) => (
        <View key={group.daypart} style={s.group}>
          <Text style={s.groupTitle}>{DAYPART_LABELS[group.daypart]}</Text>
          {group.habits.map((habit) => (
            <View key={habit.name} style={s.habitRow}>
              <Ionicons name={habit.icon as never} size={18} color={colors.primary} />
              <View style={s.habitBody}>
                <Text style={s.habitName}>{habit.name}</Text>
                <Text style={s.habitMeta}>
                  {habit.estimated_minutes} dk
                  {habit.daily_goal != null ? ` · hedef ${habit.daily_goal}${habit.unit ? ' ' + habit.unit : ''}` : ''}
                  {habit.reduced ? ' · başlangıç için düşürüldü' : ''}
                </Text>
              </View>
              {editing && (
                <TouchableOpacity
                  onPress={() => setDropped((prev) => new Set(prev).add(habit.name))}
                  accessibilityRole="button"
                  accessibilityLabel={`${habit.name} alışkanlığını plandan çıkar`}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-circle-outline" size={20} color={colors.textFaint} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      ))}

      {dropped.size > 0 && (
        <TouchableOpacity
          onPress={() => setDropped(new Set())}
          accessibilityRole="button"
          style={s.restore}
        >
          <Ionicons name="refresh-outline" size={15} color={colors.primaryBright} />
          <Text style={s.restoreText}>Çıkardıklarımı geri getir ({dropped.size})</Text>
        </TouchableOpacity>
      )}

      <Text style={s.total}>
        {kept.length} alışkanlık · yaklaşık {totalMinutes} dk/gün
      </Text>

      {planReasons.length > 0 && (
        <View style={s.why}>
          <Text style={s.whyTitle}>Neden bu plan?</Text>
          {planReasons.map((reason) => (
            <View key={reason} style={s.whyRow}>
              <View style={s.whyDot} />
              <Text style={s.whyText}>{reason}</Text>
            </View>
          ))}
        </View>
      )}
    </OnboardingScaffold>
  );
}

const s = StyleSheet.create({
  muted: { ...font.body, color: colors.textFaint },

  summaryRow: { flexDirection: 'row', gap: space.lg },
  summaryCell: { flex: 1, gap: 4 },
  eyebrow: { ...font.overline, color: colors.textFaint },
  summaryValue: { ...font.h3, color: colors.text, lineHeight: 21 },

  group: { gap: space.sm },
  groupTitle: { ...font.overline, color: colors.primary },
  habitRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    paddingVertical: space.md, paddingHorizontal: space.lg,
    backgroundColor: colors.surface, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.borderSubtle,
  },
  habitBody: { flex: 1, gap: 2 },
  habitName: { ...font.body, color: colors.text },
  habitMeta: { ...font.caption, color: colors.textFaint },

  restore: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  restoreText: { ...font.bodySm, color: colors.primaryBright },

  total: {
    ...font.h3, color: colors.text,
    paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.borderSubtle,
  },

  why: {
    gap: space.sm, padding: space.lg,
    backgroundColor: hexA(colors.primary, 0.07), borderRadius: radius.lg,
  },
  whyTitle: { ...font.h3, color: colors.text },
  whyRow: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  whyDot: {
    width: 5, height: 5, borderRadius: 3, backgroundColor: colors.primary, marginTop: 8,
  },
  whyText: { ...font.bodySm, color: colors.textDim, flex: 1, lineHeight: 20 },
});
