import React, { type ComponentProps } from 'react';
import { View, Text, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { computeTriage, triageToStatus } from '../../lib/triage';
import { useHabitForm } from '../../hooks/useHabitForm';
import { useHabitStore } from '../../store/habitStore';
import { LIFE_AREAS } from '../../store/lifeAreasStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import { TOTAL_STEPS } from './constants';
import { makeStyles } from './styles';
import StepName from './StepName';
import StepMeasure from './StepMeasure';
import StepFrequency from './StepFrequency';
import StepPriority from './StepPriority';
import StepEffort from './StepEffort';
import StepAppearance from './StepAppearance';
import StepSummary from './StepSummary';
import type { DestinationMeta, HabitOnboardingContext, HabitOnboardingProps } from './types';

function getDestinations(colors: Palette): Record<string, DestinationMeta> {
  return {
    active: { color: colors.success, icon: 'flash', label: 'Aktif Olarak Ekle', room: 'Aktif Odak' },
    waiting: { color: colors.warning, icon: 'time-outline', label: 'Beklemeye Ekle', room: 'Bekleme Odası' },
    idea: { color: colors.textFaint, icon: 'bulb-outline', label: 'Fikir Olarak Sakla', room: 'Fikirler' },
    paused: { color: colors.textDim, icon: 'pause', label: 'Ekle', room: 'Bekleme Odası' },
    completed: { color: colors.success, icon: 'checkmark', label: 'Ekle', room: 'Tamamlandı' },
    archived: { color: colors.textFaint, icon: 'archive', label: 'Ekle', room: 'Arşiv' },
  };
}

export default function HabitOnboardingModal({
  visible,
  onClose,
  onSubmit,
  willpowerState,
}: HabitOnboardingProps) {
  const colors = useThemeColors();
  const styles = useThemedStyles(makeStyles);
  const {
    step,
    setStep,
    form,
    setForm,
    patch,
    applyAndRecost,
    setImpact,
    setUrgency,
    setDifficulty,
    setMinutes,
    goal,
    setGoalText,
    cueMode,
    setCueMode,
    canProceed,
    reset,
  } = useHabitForm();

  const existingHabits = useHabitStore((s) => s.habits);
  const existingHabitsLoading = useHabitStore((s) => s.loading);
  const activeHabits = existingHabits.filter((h) => h.status === 'active');

  const canActivate = useWillpowerStore((s) => s.canActivate);
  const score = useWillpowerStore((s) => s.score);
  const canActivateNow = canActivate(
    form.willpower_cost,
    existingHabitsLoading ? undefined : { habit: form, activeHabits },
  );
  const plannedTriage = computeTriage(form.impact_level, form.urgency);
  const plannedStatus = triageToStatus(plannedTriage, canActivateNow);
  const DEST = getDestinations(colors)[plannedStatus];

  const wpUsedRatio = willpowerState ? willpowerState.used / willpowerState.daily_budget : 0;
  const wpBarColor =
    wpUsedRatio < 0.5 ? colors.success : wpUsedRatio < 0.8 ? colors.warning : colors.error;
  const wpScore = score();

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit() {
    onSubmit(form);
    reset();
  }

  const ctx: HabitOnboardingContext = {
    form,
    setForm,
    patch,
    applyAndRecost,
    setImpact,
    setUrgency,
    setDifficulty,
    setMinutes,
    goal,
    setGoalText,
    cueMode,
    setCueMode,
    existingHabits,
    activeHabits,
    lifeAreas: LIFE_AREAS,
    willpowerState,
    canActivateNow,
    plannedTriage,
    plannedStatus,
    DEST,
    wpScore,
    colors,
    styles,
  };

  const proceedOk = canProceed();

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose} accessibilityRole="button" accessibilityLabel="Kapat">
              <Ionicons name="close" size={28} color={colors.text} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Yeni Alışkanlık</Text>
            <View style={{ width: 28 }} />
          </View>

          {willpowerState && (
            <View style={styles.wpBand}>
              <View style={styles.wpBandTop}>
                <View style={styles.wpBandLeft}>
                  <Ionicons name="flash" size={14} color={wpBarColor} />
                  <Text style={[styles.wpBandLabel, { color: wpBarColor }]}>İrade Skoru</Text>
                </View>
                <Text style={[styles.wpBandScore, { color: wpBarColor }]}>
                  {wpScore === null ? '…' : `${wpScore}%`}
                </Text>
              </View>
              <View style={styles.wpBarBg}>
                <View
                  style={[
                    styles.wpBarFill,
                    { width: `${Math.min(100, Math.max(0, wpUsedRatio * 100))}%`, backgroundColor: wpBarColor },
                  ]}
                />
              </View>
              <Text style={styles.wpBandSub}>
                {willpowerState.used}/{willpowerState.daily_budget} irade kullanıldı · {willpowerState.active_count}/{willpowerState.focus_capacity} slot aktif
              </Text>
            </View>
          )}

          <View style={styles.progressContainer}>
            {Array.from({ length: TOTAL_STEPS }, (_, i) => (
              <View key={i} style={[styles.progressDot, i + 1 <= step && styles.progressDotActive]} />
            ))}
          </View>

          <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
            {step === 1 && <StepName ctx={ctx} />}
            {step === 2 && <StepMeasure ctx={ctx} />}
            {step === 3 && <StepFrequency ctx={ctx} />}
            {step === 4 && <StepPriority ctx={ctx} />}
            {step === 5 && <StepEffort ctx={ctx} />}
            {step === 6 && <StepAppearance ctx={ctx} />}
            {step === 7 && <StepSummary ctx={ctx} />}
          </ScrollView>

          <View style={styles.footer}>
            {step > 1 && (
              <TouchableOpacity
                style={styles.backButton}
                onPress={() => setStep(step - 1)}
                accessibilityRole="button"
                accessibilityLabel="Geri"
              >
                <Ionicons name="arrow-back" size={20} color={colors.text} />
                <Text style={styles.backButtonText}>Geri</Text>
              </TouchableOpacity>
            )}
            {step < TOTAL_STEPS ? (
              <TouchableOpacity
                style={[styles.nextButton, !proceedOk && styles.buttonDisabled]}
                onPress={() => setStep(step + 1)}
                disabled={!proceedOk}
                accessibilityRole="button"
                accessibilityLabel="Devam"
              >
                <Text style={styles.nextButtonText}>Devam</Text>
                <Ionicons name="arrow-forward" size={20} color={colors.white} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: DEST.color }]}
                onPress={handleSubmit}
                accessibilityRole="button"
                accessibilityLabel={DEST.label}
              >
                <Ionicons name={DEST.icon as ComponentProps<typeof Ionicons>['name']} size={18} color={colors.white} />
                <Text style={styles.submitButtonText}>{DEST.label}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}
