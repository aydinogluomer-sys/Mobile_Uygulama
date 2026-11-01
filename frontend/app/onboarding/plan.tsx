import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, hexA, radius, space } from '../../lib/tokens';
import OnboardingScaffold from '../../components/onboarding/OnboardingScaffold';
import { ONBOARDING_ART } from '../../lib/visualAssets';
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
  const installPhase = useOnboardingStore((s) => s.installPhase);
  const installedHabitCount = useOnboardingStore((s) => s.installedHabitCount);
  const installExpectedHabits = useOnboardingStore((s) => s.installExpectedHabits);
  const completeInstall = useOnboardingStore((s) => s.completeInstall);

  /** Names the user removed from the preview. Local until install. */
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState(false);

  // Arriving here directly (a reload on web, a deep link) with no plan in
  // memory regenerates it rather than showing an empty screen. Deterministic,
  // so the regenerated plan is the same one.
  //
  // NOT while an install is awaiting its completion write: regenerating there
  // would put a fresh proposal on screen next to habits that already exist,
  // and the obvious next tap would install a second copy of them.
  useEffect(() => {
    if (!plan && installPhase !== 'awaiting_completion' && installPhase !== 'partial') generatePlan();
  }, [plan, generatePlan, installPhase]);

  async function handleFinish() {
    const ok = await completeInstall();
    if (ok) router.replace('/tabs/today');
  }

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

  /**
   * The habits are in the database and the completion write is not.
   *
   * Reached in this session after a failed confirm, and in a LATER session
   * from the durable `installing` status — `hydrate` resolves that by counting
   * the account's habits, so arriving here means the count was greater than
   * zero. The only action offered writes the completion; there is deliberately
   * no path from this screen back to the insert.
   */
  /**
   * Some of the plan's habits exist and some do not.
   *
   * Deliberately NOT resolved automatically. Re-running the install would put
   * the whole plan on top of the part that landed; treating it as finished
   * would silently accept a plan the user never got. So the numbers are shown
   * and the only offered action says exactly what it does — the rest of the
   * habits can be added from the habits screen, which already exists for that.
   */
  if (installPhase === 'partial') {
    return (
      <OnboardingScaffold
        step={3}
        totalSteps={3}
        title="Kurulum yarım kaldı"
        subtitle="Planının bir kısmı oluşturuldu. Var olanları koruyoruz; hiçbiri silinmeyecek."
        primaryLabel="Bununla devam et"
        onPrimary={handleFinish}
        primaryLoading={installing}
        primaryDisabled={installing}
        error={installError}
      >
        <View style={s.recovery}>
          <Ionicons name="warning-outline" size={20} color={colors.warning} />
          <Text style={s.recoveryText}>
            {installExpectedHabits > 0
              ? `${installedHabitCount} / ${installExpectedHabits} alışkanlık oluşturuldu.`
              : 'Bu kurulumun ne kadarının tamamlandığını doğrulayamadık.'}
            {' '}Devam edersen bunlar kalır; kalanları Alışkanlıklar ekranından
            istediğin zaman ekleyebilirsin.
          </Text>
        </View>
      </OnboardingScaffold>
    );
  }

  if (installPhase === 'awaiting_completion') {
    return (
      <OnboardingScaffold
        step={3}
        totalSteps={3}
        title="Neredeyse bitti"
        subtitle="Alışkanlıkların oluşturuldu, ama kurulumu kaydedemedik. Tekrar denediğinde yeniden oluşturulmayacaklar."
        primaryLabel="Kurulumu tamamla"
        onPrimary={handleFinish}
        primaryLoading={installing}
        primaryDisabled={installing}
        error={installError}
      >
        <View style={s.recovery}>
          <Ionicons name="checkmark-circle" size={20} color={colors.success} />
          <Text style={s.recoveryText}>
            {installedHabitCount} alışkanlık hesabına eklendi. Bunlar korunuyor;
            bu adım yalnızca kurulumun tamamlandığını kaydeder.
          </Text>
        </View>
      </OnboardingScaffold>
    );
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
      heroSource={ONBOARDING_ART.step3Blueprint}
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
  recovery: {
    flexDirection: 'row', gap: space.md, alignItems: 'flex-start',
    padding: space.lg, borderRadius: radius.lg,
    backgroundColor: hexA(colors.success, 0.10),
  },
  recoveryText: { ...font.bodySm, color: colors.textDim, flex: 1, lineHeight: 20 },

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
