import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { View, Text, TextInput, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { font, hexA, onColor, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { ICON_BUTTON_MIN, IconButton } from '../../components/ui';
import OnboardingScaffold from '../../components/onboarding/OnboardingScaffold';
import { ONBOARDING_ART } from '../../lib/visualAssets';
import { useOnboardingStore } from '../../store/onboardingStore';
import { useFocusStore } from '../../store/focusStore';
import { DAYPART_LABELS, GOAL_LABELS, PACE_LABELS, type GoalId } from '../../lib/onboarding';
import { DAYPART_ORDER } from '../../lib/starterPlan';
import { pickStarterQuickStep, type RoutinePackKey } from '../../lib/routinePacks';
import { deterministicSuggestionId } from '../../lib/actionSuggestion';
import { deriveSplitSteps, shortTopic } from '../../lib/taskDecomposition';
import { MAX_STEP_TITLE, validateSmallStep, type SmallStepParent } from '../../lib/smallStart';
import { todayLocal } from '../../lib/date';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

const QUICK_START_MINUTES = 5;

function resolveStarterPackKey(goals: readonly GoalId[]): RoutinePackKey {
  for (const goal of goals) {
    if (goal === 'focus_productivity') return 'deep-work';
    if (goal === 'sleep') return 'sleep-reset';
    if (goal === 'daily_order' || goal === 'finance' || goal === 'learning') {
      return 'everyday-foundations';
    }
    if (goal === 'health_energy' || goal === 'mental_wellbeing') {
      return 'morning-reset';
    }
  }
  return 'morning-reset';
}

function deriveOwnTaskFirstStep(rawTitle: string): string {
  const cleaned = rawTitle.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  const step = deriveSplitSteps(cleaned)[0];
  const topic = shortTopic(cleaned, 60);
  const combined = topic.length > 0 ? `${step} — ${topic}` : step;
  if (combined.length <= MAX_STEP_TITLE) return combined;
  const shortened = shortTopic(combined, MAX_STEP_TITLE);
  return shortened.length > 0 ? shortened : combined.slice(0, MAX_STEP_TITLE).trim();
}

type QuickActionButtonProps = {
  testID: string;
  label: string;
  accessibilityLabel: string;
  icon: IoniconName;
  variant: 'primary' | 'secondary';
  disabled?: boolean;
  expanded?: boolean;
  onPress: () => void;
};

function QuickActionButton({
  testID,
  label,
  accessibilityLabel,
  icon,
  variant,
  disabled = false,
  expanded,
  onPress,
}: QuickActionButtonProps) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const fg = variant === 'primary' ? onColor(colors.primary) : colors.primaryBright;

  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={
        expanded === undefined
          ? { disabled }
          : { disabled, expanded }
      }
      style={[
        s.quickActionBtn,
        variant === 'primary' ? s.quickActionPrimary : s.quickActionSecondary,
        disabled && s.quickActionDisabled,
      ]}
    >
      <Ionicons
        name={icon}
        size={16}
        color={fg}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text
        style={[
          s.quickActionLabel,
          variant === 'primary' ? s.quickActionLabelPrimary : s.quickActionLabelSecondary,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

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
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const plan = useOnboardingStore((s) => s.plan);
  const planReasons = useOnboardingStore((s) => s.planReasons);
  const answers = useOnboardingStore((s) => s.answers);
  const ownerId = useOnboardingStore((s) => s.ownerId);
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
  const [ownTaskOpen, setOwnTaskOpen] = useState(false);
  const [ownTaskInput, setOwnTaskInput] = useState('');

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

  const quickStep = useMemo(
    () => pickStarterQuickStep(resolveStarterPackKey(answers.goals)),
    [answers.goals],
  );

  const trimmedOwnTask = ownTaskInput.trim().replace(/\s+/g, ' ');
  const derivedFirstStep = useMemo(
    () => deriveOwnTaskFirstStep(trimmedOwnTask),
    [trimmedOwnTask],
  );
  const ownStepValid = useMemo(() => {
    if (!trimmedOwnTask) return false;
    return validateSmallStep(
      { kind: 'task', id: 'onboarding-draft', title: trimmedOwnTask },
      { title: derivedFirstStep, minutes: QUICK_START_MINUTES },
    ).ok;
  }, [trimmedOwnTask, derivedFirstStep]);

  function handleTrySampleStep() {
    const localDayKey = todayLocal();
    const suggestionId = deterministicSuggestionId({
      userId: ownerId,
      localDayKey,
      kind: 'start_small',
      sourceEntity: 'starter_pack',
      sourceId: quickStep.packKey,
      stepTitle: quickStep.firstStepTitle,
    });
    const parent: SmallStepParent = {
      kind: 'task',
      id: `starter:${quickStep.packKey}`,
      title: quickStep.habitName,
    };
    const started = useFocusStore.getState().startSmallStep(parent, {
      title: quickStep.firstStepTitle,
      minutes: QUICK_START_MINUTES,
      suggestionId,
    });
    if (started) {
      router.push('/tabs/focus');
    }
  }

  function handleStartOwnStep() {
    if (!trimmedOwnTask) return;
    const localDayKey = todayLocal();
    const suggestionId = deterministicSuggestionId({
      userId: ownerId,
      localDayKey,
      kind: 'start_small',
      sourceEntity: 'draft',
      sourceId: 'onboarding-draft',
      stepTitle: derivedFirstStep,
    });
    const parent: SmallStepParent = {
      kind: 'task',
      id: 'onboarding-draft',
      title: trimmedOwnTask,
    };
    const draft = {
      title: derivedFirstStep,
      minutes: QUICK_START_MINUTES,
      suggestionId,
    };
    const check = validateSmallStep(parent, draft);
    if (!check.ok) return;
    const started = useFocusStore.getState().startSmallStep(parent, draft);
    if (started) {
      router.push('/tabs/focus');
    }
  }

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
      <View testID="onboarding-quick-start-card" style={s.quickCard}>
        <Text style={s.quickTitle} accessibilityRole="header">
          Kurulumu beklemeden tek adımla dene
        </Text>

        <View style={s.quickPreviewBox}>
          <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
          <Text testID="onboarding-sample-step-preview" style={s.quickPreviewText}>
            {`${quickStep.firstStepTitle} · ${quickStep.estimatedMinutes} dk`}
          </Text>
        </View>

        <QuickActionButton
          testID="onboarding-try-sample-step"
          label="Örnek adımı dene (5 dk)"
          accessibilityLabel={`Örnek adımı dene, 5 dakika: ${quickStep.firstStepTitle}`}
          icon="play-outline"
          variant="primary"
          onPress={handleTrySampleStep}
        />

        <QuickActionButton
          testID="onboarding-add-own-task-toggle"
          label="Kendi işimi ekle"
          accessibilityLabel="Kendi işimi ekle"
          icon={ownTaskOpen ? 'chevron-up-outline' : 'add-circle-outline'}
          variant="secondary"
          expanded={ownTaskOpen}
          onPress={() => setOwnTaskOpen((v) => !v)}
        />

        {ownTaskOpen && (
          <View style={s.ownTaskBlock}>
            <TextInput
              testID="onboarding-own-task-input"
              style={s.ownInput}
              value={ownTaskInput}
              onChangeText={setOwnTaskInput}
              placeholder="Örn. Teklifi hazırla"
              placeholderTextColor={colors.textFaint}
              maxLength={MAX_STEP_TITLE}
              returnKeyType="done"
              onSubmitEditing={handleStartOwnStep}
              accessibilityRole="none"
              accessibilityLabel="Kendi işini yaz"
            />
            {trimmedOwnTask.length > 0 && (
              <Text testID="onboarding-own-step-preview" style={s.ownPreview}>
                {`${derivedFirstStep} · ${QUICK_START_MINUTES} dk`}
              </Text>
            )}
            <QuickActionButton
              testID="onboarding-start-own-step"
              label="5 dk ilk adımla başla"
              accessibilityLabel={
                ownStepValid
                  ? `5 dakika ilk adımla başla: ${derivedFirstStep}`
                  : '5 dakika ilk adımla başla'
              }
              icon="flash-outline"
              variant="primary"
              disabled={!ownStepValid}
              onPress={handleStartOwnStep}
            />
          </View>
        )}

        <Text testID="onboarding-deferred-permission-note" style={s.deferredPermissionNote}>
          Bildirim izni şimdi istenmez; ilk adımı deneyimledikten sonra istersen açabilirsin.
        </Text>
      </View>

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
              <Ionicons name={habit.icon as IoniconName} size={18} color={colors.primary} />
              <View style={s.habitBody}>
                <Text style={s.habitName}>{habit.name}</Text>
                <Text style={s.habitMeta}>
                  {habit.estimated_minutes} dk
                  {habit.daily_goal != null ? ` · hedef ${habit.daily_goal}${habit.unit ? ' ' + habit.unit : ''}` : ''}
                  {habit.reduced ? ' · başlangıç için düşürüldü' : ''}
                </Text>
              </View>
              {editing && (
                <IconButton
                  compact
                  icon="close-circle-outline"
                  size={20}
                  color={colors.textFaint}
                  label={`${habit.name} alışkanlığını plandan çıkar`}
                  onPress={() => setDropped((prev) => new Set(prev).add(habit.name))}
                />
              )}
            </View>
          ))}
        </View>
      ))}

      {dropped.size > 0 && (
        <TouchableOpacity
          onPress={() => setDropped(new Set())}
          accessibilityRole="button"
          accessibilityLabel={`Çıkardıklarımı geri getir, ${dropped.size} alışkanlık`}
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

const makeStyles = (colors: Palette) => StyleSheet.create({
  muted: { ...font.body, color: colors.textFaint },
  recovery: {
    flexDirection: 'row', gap: space.md, alignItems: 'flex-start',
    padding: space.lg, borderRadius: radius.lg,
    backgroundColor: hexA(colors.success, 0.10),
  },
  recoveryText: { ...font.bodySm, color: colors.textDim, flex: 1, lineHeight: 20 },

  quickCard: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: hexA(colors.primary, 0.28),
  },
  quickTitle: { ...font.h3, color: colors.text },
  quickPreviewBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    backgroundColor: hexA(colors.primary, 0.08),
  },
  quickPreviewText: { ...font.bodySm, color: colors.textDim, flex: 1, lineHeight: 20 },
  quickActionBtn: {
    minHeight: ICON_BUTTON_MIN,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.sm,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
  },
  quickActionPrimary: {
    backgroundColor: colors.primary,
  },
  quickActionSecondary: {
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
  },
  quickActionDisabled: {
    opacity: 0.45,
  },
  quickActionLabel: { ...font.bodySm, fontWeight: '700' },
  quickActionLabelPrimary: { color: onColor(colors.primary) },
  quickActionLabelSecondary: { color: colors.primaryBright },
  ownTaskBlock: {
    gap: space.sm,
  },
  ownInput: {
    ...font.body,
    minHeight: ICON_BUTTON_MIN,
    paddingVertical: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    color: colors.text,
  },
  ownPreview: { ...font.caption, color: colors.textDim, lineHeight: 18 },
  deferredPermissionNote: { ...font.caption, color: colors.textFaint, lineHeight: 18 },

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
