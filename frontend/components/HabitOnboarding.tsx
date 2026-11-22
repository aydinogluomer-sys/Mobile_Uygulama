import { colors, alphaHex } from '../lib/tokens';
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays } from 'date-fns';
import type { Habit, FrequencyConfig, WillpowerState } from '../lib/supabase';
import {
  IMPACT_LEVELS, URGENCY_OPTIONS, TRIAGE_META, DIFFICULTY_LEVELS,
  computeTriage, eisenhowerCell, triageToStatus,
  computeWillpowerCost, costBreakdown, difficultyMeta, endConditionLabel, cueLabel,
  type ImpactLevel, type Urgency,
} from '../lib/triage';
import { DURATION_UNIT } from '../lib/habitEngine';
import { togglePartOfDay as togglePartOfDayPure, isFrequencyComplete, frequencySummary } from '../lib/frequencyForm';
// KD-09 — the frequency controls live in one component, shared with habit-detail.
import FrequencyEditor from './FrequencyEditor';
import { useHabitStore } from '../store/habitStore';
import { LIFE_AREAS } from '../store/lifeAreasStore';
import { useWillpowerStore } from '../store/willpowerStore';
import { decimalTR } from '../lib/chartText';
import { isNumberInputPending, parseLocaleNumber } from '../lib/localeNumber';

// DB sütun adlarına uygun form tipi
type HabitFormData = Omit<Habit, 'id' | 'created_at' | 'user_id'>;

interface HabitOnboardingProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (habitData: HabitFormData) => void;
  willpowerState?: WillpowerState | null;
}

const COLORS = [colors.accent, colors.success, '#3b82f6', colors.warning, colors.error, '#ec4899', colors.teal, '#8b5cf6'];

const ICONS = [
  'fitness-outline', 'book-outline', 'briefcase-outline', 'water-outline',
  'bed-outline', 'bicycle-outline', 'leaf-outline', 'heart-outline',
  'star-outline', 'flame-outline', 'musical-notes-outline', 'code-slash-outline',
];

const PART_OF_DAY = [
  { id: 'morning', label: 'Sabah', icon: '🌅' },
  { id: 'afternoon', label: 'Öğle', icon: '☀️' },
  { id: 'evening', label: 'Akşam', icon: '🌙' },
];

const DEFAULT_FORM: HabitFormData = {
  name: '',
  icon: 'star-outline',
  color: colors.accent,
  behavior_type: 'positive',
  tracking_type: 'boolean',
  unit: null,
  daily_goal: null,
  target_direction: null,
  frequency_config: { kind: 'daily' },
  willpower_cost: 3,
  status: 'waiting',
  impact_level: 'medium',
  urgency: 'not_urgent',
  difficulty: 3,
  estimated_minutes: 0,
  reminders: null,
  cue_habit_id: null,
  cue_note: null,
  life_area: null,
  end_condition: null,
};

function evaluateGoalInput(
  rawText: string,
  trackingType: HabitFormData['tracking_type'],
  direction: HabitFormData['target_direction'],
): { value: number | null; error: string | null } {
  if (trackingType !== 'numeric' && trackingType !== 'duration') {
    return { value: null, error: null };
  }
  if (rawText.trim() === '') {
    return { value: null, error: null };
  }
  const isDuration = trackingType === 'duration';
  const parsed = parseLocaleNumber(rawText, { min: 0, integer: isDuration });
  if (parsed === null) {
    return {
      value: null,
      error: isNumberInputPending(rawText)
        ? null
        : isDuration
          ? 'Dakikayı tam sayı yaz, örn. 20'
          : 'Sayıyı rakamla yaz, örn. 2,5',
    };
  }
  if ((direction ?? 'at_least') !== 'at_most' && parsed <= 0) {
    return { value: parsed, error: "En az için hedef 0'dan büyük olmalı" };
  }
  return { value: parsed, error: null };
}

export default function HabitOnboarding({ visible, onClose, onSubmit, willpowerState }: HabitOnboardingProps) {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<HabitFormData>(DEFAULT_FORM);
  const [goalText, setGoalTextState] = useState('');
  const [cueMode, setCueMode] = useState<'none' | 'habit' | 'note'>('none');
  const existingHabits = useHabitStore((s) => s.habits);
  const existingHabitsLoading = useHabitStore((s) => s.loading);
  // W1 (task Phase-1 CODER-F, Plan §10): şu an aktif alışkanlıkların yükü --
  // canActivate'e gerçek kapasite verisi geçmek için kullanılır. Yükleme
  // sürerken (existingHabitsLoading) yarım bir liste yükü OLDUĞUNDAN AZ
  // gösterip aktivasyona yanlışlıkla izin verebileceğinden, eski (legacy)
  // tek-parametreli çağrıya düşülür.
  const activeHabits = existingHabits.filter((h) => h.status === 'active');

  const goalCheck = evaluateGoalInput(goalText, form.tracking_type, form.target_direction);

  function setGoalText(text: string) {
    setGoalTextState(text);
    setForm((prev) => {
      const nextGoal = evaluateGoalInput(text, prev.tracking_type, prev.target_direction);
      return { ...prev, daily_goal: nextGoal.value };
    });
  }

  function reset() {
    setStep(1);
    setForm(DEFAULT_FORM);
    setGoalTextState('');
    setCueMode('none');
  }

  function handleClose() {
    reset();
    onClose();
  }

  function handleSubmit() {
    onSubmit(form);
    reset();
  }

  // Triaj + kapasite → nihai Kanban hedefi (3 yönlü)
  // Tek kaynak: kuralın kopyası değil, store'un kendisi. Bu blok
  // canActivate()'in ikiziydi ve prop'u doğrudan okuduğu için store'un
  // bayatlık kontrolünü atlıyordu (bulgu N-07).
  const canActivate = useWillpowerStore((s) => s.canActivate);
  const score = useWillpowerStore((s) => s.score);
  const canActivateNow = canActivate(form.willpower_cost, existingHabitsLoading ? undefined : { habit: form, activeHabits });
  const plannedTriage = computeTriage(form.impact_level, form.urgency);
  const plannedStatus = triageToStatus(plannedTriage, canActivateNow); // 'active'|'waiting'|'idea'
  const DEST = {
    active: { color: colors.success, icon: 'flash', label: 'Aktif Olarak Ekle', room: 'Aktif Odak' },
    waiting: { color: colors.warning, icon: 'time-outline', label: 'Beklemeye Ekle', room: 'Bekleme Odası' },
    idea: { color: colors.textFaint, icon: 'bulb-outline', label: 'Fikir Olarak Sakla', room: 'Fikirler' },
    paused: { color: colors.textDim, icon: 'pause', label: 'Ekle', room: 'Bekleme Odası' },
    completed: { color: colors.success, icon: 'checkmark', label: 'Ekle', room: 'Tamamlandı' },
    archived: { color: colors.textFaint, icon: 'archive', label: 'Ekle', room: 'Arşiv' },
  }[plannedStatus];

  const wpUsedRatio = willpowerState ? willpowerState.used / willpowerState.daily_budget : 0;
  const wpBarColor = wpUsedRatio < 0.5 ? colors.success : wpUsedRatio < 0.8 ? colors.warning : colors.error;
  // null = "okuma yok". Eskiden 100'e düşüyordu, yani kullanıcı hiç sahip
  // olmadığı dolu bir iradeyi görüyordu — S-01'de store'dan kaldırılan
  // uydurmanın aynısı.
  const wpScore = score();

  function canProceed() {
    if (step === 1) return form.name.trim().length > 0;
    if (step === 2 && form.tracking_type === 'numeric') {
      const validGoal =
        form.daily_goal !== null &&
        (form.target_direction === 'at_most' ? form.daily_goal >= 0 : form.daily_goal > 0);
      return Boolean(form.unit?.trim()) && validGoal && goalCheck.error === null;
    }
    // Süre için birim sorulmaz — sabittir (DURATION_UNIT). Yalnız hedef dakika
    // gerekir; serbest metin birimden süre çıkarımı YAPILMAZ.
    if (step === 2 && form.tracking_type === 'duration') {
      const validGoal =
        form.daily_goal !== null &&
        (form.target_direction === 'at_most' ? form.daily_goal >= 0 : form.daily_goal > 0);
      return validGoal && goalCheck.error === null;
    }
    // R01.02-e: a schedule with no target (weekly with no day, a count of 0)
    // cannot leave step 3 -- see lib/frequencyForm.isFrequencyComplete.
    if (step === 3) return isFrequencyComplete(form.frequency_config);
    return true;
  }

  // Step 1 — İsim + Davranış Tipi
  const renderStep1 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Alışkanlığın Nedir?</Text>
      <Text style={styles.stepSubtitle}>İsim ver ve türünü seç</Text>

      <TextInput
        style={styles.input}
        placeholder="Örn: Sabah Sporu"
        placeholderTextColor={colors.textFaint}
        value={form.name}
        onChangeText={(t) => setForm({ ...form, name: t })}
        autoFocus
      />

      <Text style={styles.label}>Davranış Türü</Text>
      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.typeCard, form.behavior_type === 'positive' && styles.typeCardSelected]}
          onPress={() => setForm({ ...form, behavior_type: 'positive' })}
        >
          <Text style={styles.typeEmoji}>✅</Text>
          <Text style={styles.typeLabel}>Pozitif</Text>
          <Text style={styles.typeDesc}>Yapmak istiyorum</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeCard, form.behavior_type === 'negative' && styles.typeCardSelectedRed]}
          onPress={() => setForm({ ...form, behavior_type: 'negative' })}
        >
          <Text style={styles.typeEmoji}>🚫</Text>
          <Text style={styles.typeLabel}>Negatif</Text>
          <Text style={styles.typeDesc}>Bırakmak istiyorum</Text>
        </TouchableOpacity>
      </View>

      <Text style={[styles.label, { marginTop: 20 }]}>Kategori</Text>
      <Text style={styles.areaHint}>
        Yaşam dengeni ölçer: hayatının hangi alanlarında alışkanlığın var, hangilerinde yok — bunu İstatistikler&apos;de görürsün. (opsiyonel)
      </Text>
      <View style={styles.areaGrid}>
        {LIFE_AREAS.map((a) => {
          const sel = form.life_area === a.key;
          return (
            <TouchableOpacity
              key={a.key}
              style={[styles.areaChip, sel && { backgroundColor: a.color + '22', borderColor: a.color }]}
              onPress={() => setForm({ ...form, life_area: sel ? null : a.key })}
            >
              <View style={[styles.areaDot, { backgroundColor: a.color }]} />
              <Text style={[styles.areaChipText, sel && { color: a.color }]}>{a.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  // Step 2 — Ölçüm Tipi
  const renderStep2 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Nasıl Takip Edilsin?</Text>
      <Text style={styles.stepSubtitle}>Tamamlama yöntemini seç</Text>

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.typeCard, form.tracking_type === 'boolean' && styles.typeCardSelected]}
          onPress={() => {
            setGoalTextState('');
            setForm({ ...form, tracking_type: 'boolean', unit: null, daily_goal: null, target_direction: null });
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: form.tracking_type === 'boolean' }}
          accessibilityLabel="Evet veya Hayır olarak takip et"
        >
          <Text style={styles.typeEmoji}>✓</Text>
          <Text style={styles.typeLabel}>Evet / Hayır</Text>
          <Text style={styles.typeDesc}>Yaptım ya da yapmadım</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeCard, form.tracking_type === 'numeric' && styles.typeCardSelected]}
          onPress={() => {
            setGoalTextState('');
            setForm({ ...form, tracking_type: 'numeric', unit: null, daily_goal: null, target_direction: 'at_least' });
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: form.tracking_type === 'numeric' }}
          accessibilityLabel="Sayısal miktar olarak takip et"
        >
          <Text style={styles.typeEmoji}>📊</Text>
          <Text style={styles.typeLabel}>Sayısal</Text>
          <Text style={styles.typeDesc}>Adım, sayfa, ml…</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <TouchableOpacity
          style={[styles.typeCard, form.tracking_type === 'duration' && styles.typeCardSelected]}
          // Süre kendi takip tipidir; birimi sabittir. Birimi kullanıcıya
          // yazdırıp metinden ("dakika"/"dk"/"minutes") çıkarım yapmak, bir
          // yazım hatasının alışkanlığı sessizce sayısala düşürmesi demekti.
          onPress={() => {
            setGoalTextState('');
            setForm({ ...form, tracking_type: 'duration', unit: DURATION_UNIT, daily_goal: null, target_direction: 'at_least' });
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: form.tracking_type === 'duration' }}
          accessibilityLabel="Süre olarak takip et"
        >
          <Text style={styles.typeEmoji}>⏱️</Text>
          <Text style={styles.typeLabel}>Süre</Text>
          <Text style={styles.typeDesc}>Dakika cinsinden</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.typeCard, form.tracking_type === 'abstinence' && styles.typeCardSelected]}
          // Kaçınma seçmek davranış tipini de 'negative' yapar: "bugün uzak
          // durdum mu" ancak bırakılmak istenen bir alışkanlık için anlamlıdır.
          // Yine de ikisi ayrı alanlarda saklanır — 1. adımda davranış tipi
          // değiştirilebilir ve bu seçim onu geri almaz.
          onPress={() => {
            setGoalTextState('');
            setForm({ ...form, tracking_type: 'abstinence', behavior_type: 'negative', unit: null, daily_goal: null, target_direction: null });
          }}
          accessibilityRole="button"
          accessibilityState={{ selected: form.tracking_type === 'abstinence' }}
          accessibilityLabel="Kaçınma olarak takip et"
        >
          <Text style={styles.typeEmoji}>🚫</Text>
          <Text style={styles.typeLabel}>Kaçınma</Text>
          <Text style={styles.typeDesc}>Bugün uzak durdum</Text>
        </TouchableOpacity>
      </View>

      {form.tracking_type === 'numeric' && (
        <View style={styles.measurableSection}>
          <Text style={styles.label}>Birim</Text>
          <TextInput
            style={styles.input}
            placeholder="Örn: adım, sayfa, ml"
            placeholderTextColor={colors.textFaint}
            value={form.unit ?? ''}
            onChangeText={(t) => setForm((prev) => ({ ...prev, unit: t }))}
          />

          <Text style={styles.label}>Hedef Miktar</Text>
          <TextInput
            style={styles.input}
            placeholder="Örn: 10000"
            placeholderTextColor={colors.textFaint}
            keyboardType="numeric"
            accessibilityLabel="Hedef miktar"
            value={goalText}
            onChangeText={setGoalText}
          />
          {goalCheck.error && (
            <Text style={styles.fieldHint} accessibilityLiveRegion="polite">
              {goalCheck.error}
            </Text>
          )}

          <Text style={styles.label}>Yön</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.dirBtn, form.target_direction === 'at_least' && styles.dirBtnSelected]}
              onPress={() => setForm((prev) => ({ ...prev, target_direction: 'at_least' }))}
              accessibilityRole="button"
              accessibilityState={{ selected: form.target_direction === 'at_least' }}
            >
              <Text style={styles.dirBtnText}>En az ↑</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dirBtn, form.target_direction === 'at_most' && styles.dirBtnSelected]}
              onPress={() => setForm((prev) => ({ ...prev, target_direction: 'at_most' }))}
              accessibilityRole="button"
              accessibilityState={{ selected: form.target_direction === 'at_most' }}
            >
              <Text style={styles.dirBtnText}>En fazla ↓</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {form.tracking_type === 'duration' && (
        <View style={styles.measurableSection}>
          <Text style={styles.label}>Hedef Süre ({DURATION_UNIT})</Text>
          <TextInput
            style={styles.input}
            placeholder="Örn: 20"
            placeholderTextColor={colors.textFaint}
            keyboardType="numeric"
            accessibilityLabel="Hedef süre"
            value={goalText}
            onChangeText={setGoalText}
          />
          {goalCheck.error && (
            <Text style={styles.fieldHint} accessibilityLiveRegion="polite">
              {goalCheck.error}
            </Text>
          )}

          <Text style={styles.label}>Yön</Text>
          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.dirBtn, form.target_direction === 'at_least' && styles.dirBtnSelected]}
              onPress={() => setForm((prev) => ({ ...prev, target_direction: 'at_least' }))}
              accessibilityRole="button"
              accessibilityState={{ selected: form.target_direction === 'at_least' }}
            >
              <Text style={styles.dirBtnText}>En az ↑</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.dirBtn, form.target_direction === 'at_most' && styles.dirBtnSelected]}
              onPress={() => setForm((prev) => ({ ...prev, target_direction: 'at_most' }))}
              accessibilityRole="button"
              accessibilityState={{ selected: form.target_direction === 'at_most' }}
            >
              <Text style={styles.dirBtnText}>En fazla ↓</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {form.tracking_type === 'abstinence' && (
        <View style={styles.measurableSection}>
          <Text style={styles.typeDesc}>
            Her gün tek soru sorulur: bugün uzak durdun mu? Miktar ya da süre girilmez.
          </Text>
        </View>
      )}
    </View>
  );

  // Step 3 — Frekans
  const renderStep3 = () => {
    const freq = form.frequency_config;

    // R01.02-e — every frequency change goes through a pure transition in
    // lib/frequencyForm.ts (tested there) and through `applyAndRecost`, so the
    // willpower cost shown later reflects the schedule (an "every 3 days" habit
    // costs less than a daily one since R01.02-d2). The old `setKind` reset the
    // config to `{ kind }`: it dropped part_of_day silently and left "Haftalık"
    // / "Aylık" with no target (count 0). See `setFrequencyKind`.
    function updateFreq(next: FrequencyConfig) {
      if (next !== freq) applyAndRecost({ frequency_config: next });
    }
    function togglePartOfDay(part: string) {
      updateFreq(togglePartOfDayPure(freq, part as NonNullable<FrequencyConfig['part_of_day']>[number]));
    }

    const ec = form.end_condition;
    const endKind: 'none' | 'date' | 'amount' = ec?.kind ?? 'none';
    const rem = form.reminders;
    function setEndDate(days: number) {
      setForm({ ...form, end_condition: { kind: 'date', value: format(addDays(new Date(), days), 'yyyy-MM-dd') } });
    }

    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Ne Sıklıkta?</Text>
        <Text style={styles.stepSubtitle}>Frekansı belirle</Text>

        <FrequencyEditor value={freq} onChange={updateFreq} />

        <Text style={[styles.label, { marginTop: 20 }]}>Günün hangi bölümünde?</Text>
        <View style={styles.row}>
          {PART_OF_DAY.map((p) => (
            <TouchableOpacity
              key={p.id}
              style={[styles.partBtn, (freq.part_of_day ?? []).includes(p.id as any) && styles.partBtnSelected]}
              onPress={() => togglePartOfDay(p.id)}
            >
              <Text style={styles.partEmoji}>{p.icon}</Text>
              <Text style={styles.partLabel}>{p.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Bitiş Koşulu */}
        <Text style={[styles.label, { marginTop: 20 }]}>Bitiş Koşulu</Text>
        <View style={styles.row}>
          {([
            { k: 'none', label: 'Süresiz', icon: 'infinite-outline' },
            { k: 'date', label: 'Tarihe kadar', icon: 'calendar-outline' },
            { k: 'amount', label: 'Hedef sayıya', icon: 'flag-outline' },
          ] as const).map((opt) => {
            const sel = endKind === opt.k;
            return (
              <TouchableOpacity
                key={opt.k}
                style={[styles.endKindBtn, sel && styles.endKindBtnSel]}
                onPress={() => {
                  if (opt.k === 'none') setForm({ ...form, end_condition: null });
                  else if (opt.k === 'date') setEndDate(30);
                  else setForm({ ...form, end_condition: { kind: 'amount', value: 30 } });
                }}
              >
                <Ionicons name={opt.icon as any} size={18} color={sel ? colors.accent : colors.textDim} />
                <Text style={[styles.endKindText, sel && { color: colors.accent }]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {endKind === 'date' && (
          <>
            <View style={[styles.daysRow, { marginTop: 12 }]}>
              {[30, 60, 90, 180].map((n) => {
                const target = format(addDays(new Date(), n), 'yyyy-MM-dd');
                const sel = ec?.kind === 'date' && ec.value === target;
                return (
                  <TouchableOpacity
                    key={n}
                    style={[styles.dayBtn, sel && styles.dayBtnSelected]}
                    onPress={() => setEndDate(n)}
                  >
                    <Text style={[styles.dayBtnText, sel && styles.dayBtnTextSelected]}>{n} gün</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            {ec?.kind === 'date' && (
              <Text style={styles.endHint}>Bitiş: {endConditionLabel(ec)}</Text>
            )}
          </>
        )}

        {endKind === 'amount' && (
          <View style={[styles.row, { marginTop: 12, alignItems: 'center' }]}>
            <TextInput
              style={[styles.input, { flex: 1, marginBottom: 0 }]}
              placeholder="Örn: 30"
              placeholderTextColor={colors.textFaint}
              keyboardType="numeric"
              value={ec?.kind === 'amount' ? String(ec.value) : ''}
              onChangeText={(t) => {
                const v = parseInt(t, 10);
                setForm({ ...form, end_condition: v > 0 ? { kind: 'amount', value: v } : { kind: 'amount', value: 0 } });
              }}
            />
            <Text style={styles.endUnit}>kez tamamlayınca</Text>
          </View>
        )}

        {/* Hatırlatıcı */}
        <View style={styles.reminderHead}>
          <Text style={[styles.label, { marginTop: 20, marginBottom: 0 }]}>Hatırlatıcı</Text>
          <TouchableOpacity
            style={[styles.remToggle, rem?.enabled && styles.remToggleOn]}
            onPress={() => setForm({
              ...form,
              reminders: rem?.enabled ? { time: rem.time, enabled: false } : { time: rem?.time || '08:00', enabled: true },
            })}
          >
            <Ionicons name={rem?.enabled ? 'notifications' : 'notifications-off-outline'} size={14} color={rem?.enabled ? colors.white : colors.textDim} />
            <Text style={[styles.remToggleText, rem?.enabled && { color: colors.white }]}>{rem?.enabled ? 'Açık' : 'Kapalı'}</Text>
          </TouchableOpacity>
        </View>
        {rem?.enabled && (
          <>
            <View style={[styles.daysRow, { marginTop: 12, flexWrap: 'wrap', gap: 8 }]}>
              {['07:00', '08:00', '12:00', '18:00', '21:00'].map((t) => {
                const sel = rem.time === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[styles.minsBtn, sel && styles.minsBtnSel]}
                    onPress={() => setForm({ ...form, reminders: { time: t, enabled: true } })}
                  >
                    <Text style={[styles.minsBtnText, sel && styles.minsBtnTextSel]}>{t}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={[styles.input, { marginTop: 10 }]}
              placeholder="Özel saat (SS:DD)"
              placeholderTextColor={colors.textFaint}
              value={rem.time}
              onChangeText={(t) => setForm({ ...form, reminders: { time: t, enabled: true } })}
            />
          </>
        )}

        {/* Çağrışım / İpucu (habit stacking) */}
        <Text style={[styles.label, { marginTop: 20 }]}>Çağrışım (İpucu)</Text>
        <View style={styles.row}>
          {([
            { k: 'none', label: 'Yok', icon: 'remove-circle-outline' },
            { k: 'habit', label: 'Alışkanlıktan sonra', icon: 'link-outline' },
            { k: 'note', label: 'Serbest not', icon: 'create-outline' },
          ] as const).map((opt) => {
            const sel = cueMode === opt.k;
            return (
              <TouchableOpacity
                key={opt.k}
                style={[styles.endKindBtn, sel && styles.endKindBtnSel]}
                onPress={() => {
                  setCueMode(opt.k);
                  if (opt.k === 'none') setForm({ ...form, cue_habit_id: null, cue_note: null });
                  else if (opt.k === 'habit') setForm({ ...form, cue_note: null });
                  else setForm({ ...form, cue_habit_id: null, cue_note: form.cue_note ?? '' });
                }}
              >
                <Ionicons name={opt.icon as any} size={18} color={sel ? colors.accent : colors.textDim} />
                <Text style={[styles.endKindText, sel && { color: colors.accent }]}>{opt.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {cueMode === 'habit' && (
          existingHabits.length === 0 ? (
            <Text style={styles.endHint}>Henüz başka alışkanlık yok</Text>
          ) : (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {existingHabits.map((h) => {
                  const sel = form.cue_habit_id === h.id;
                  return (
                    <TouchableOpacity
                      key={h.id}
                      style={[styles.cueChip, sel && styles.cueChipSel]}
                      onPress={() => setForm({ ...form, cue_habit_id: h.id, cue_note: null })}
                    >
                      <Ionicons name={(h.icon ?? 'star-outline') as any} size={14} color={sel ? colors.accent : (h.color ?? colors.textDim)} />
                      <Text style={[styles.cueChipText, sel && { color: colors.accent }]} numberOfLines={1}>{h.name}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </ScrollView>
          )
        )}

        {cueMode === 'note' && (
          <TextInput
            style={[styles.input, { marginTop: 12 }]}
            placeholder="Örn: Kahvaltıdan sonra"
            placeholderTextColor={colors.textFaint}
            value={form.cue_note ?? ''}
            onChangeText={(t) => setForm({ ...form, cue_note: t })}
          />
        )}
      </View>
    );
  };

  // Bir alanı değiştir + irade maliyetini formülle yeniden hesapla
  function applyAndRecost(patch: Partial<HabitFormData>) {
    const next = { ...form, ...patch };
    next.willpower_cost = computeWillpowerCost(next);
    setForm(next);
  }

  // Step 4 — Öncelik & Strateji (Etki-Şiddet + Eisenhower + Triaj)
  function setImpact(level: ImpactLevel) {
    applyAndRecost({ impact_level: level });
  }
  function setUrgency(u: Urgency) {
    setForm({ ...form, urgency: u });
  }
  function setDifficulty(d: number) {
    applyAndRecost({ difficulty: d });
  }
  function setMinutes(m: number) {
    applyAndRecost({ estimated_minutes: Math.max(0, m) });
  }

  const renderStep4 = () => {
    const triage = computeTriage(form.impact_level, form.urgency);
    const meta = TRIAGE_META[triage];
    const cell = eisenhowerCell(form.impact_level, form.urgency);
    // Eisenhower 2×2 hücre tanımları (görsel)
    const grid: { row: number; col: number; t: typeof triage }[] = [
      { row: 0, col: 0, t: 'do_now' },
      { row: 0, col: 1, t: 'plan' },
      { row: 1, col: 0, t: 'wait_watch' },
      { row: 1, col: 1, t: 'eliminate' },
    ];

    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Öncelik & Strateji</Text>
        <Text style={styles.stepSubtitle}>Bu alışkanlık ne kadar önemli ve acil?</Text>

        {/* Etki Seviyesi */}
        <Text style={styles.label}>Etki Seviyesi</Text>
        <View style={styles.impactRow}>
          {IMPACT_LEVELS.map((lv) => {
            const sel = form.impact_level === lv.key;
            return (
              <TouchableOpacity
                key={lv.key}
                style={[styles.impactCard, sel && { borderColor: lv.color, backgroundColor: lv.color + '18' }]}
                onPress={() => setImpact(lv.key)}
              >
                <View style={[styles.impactDot, { backgroundColor: lv.color }]} />
                <Text style={[styles.impactLabel, sel && { color: lv.color }]}>{lv.label}</Text>
                <Text style={styles.impactDesc}>{lv.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Aciliyet */}
        <Text style={[styles.label, { marginTop: 20 }]}>Aciliyet</Text>
        <View style={styles.row}>
          {URGENCY_OPTIONS.map((u) => {
            const sel = form.urgency === u.key;
            return (
              <TouchableOpacity
                key={u.key}
                style={[styles.typeCard, sel && styles.typeCardSelected]}
                onPress={() => setUrgency(u.key)}
              >
                <Ionicons name={u.icon as any} size={22} color={sel ? colors.accent : colors.textDim} />
                <Text style={[styles.typeLabel, { marginTop: 6 }]}>{u.label}</Text>
                <Text style={styles.typeDesc}>{u.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Strateji Haritası — Eisenhower 2×2 */}
        <Text style={[styles.label, { marginTop: 20 }]}>Strateji Haritası</Text>
        <View style={styles.matrixHeaderRow}>
          <View style={styles.matrixCorner} />
          <Text style={styles.matrixColLabel}>Acil</Text>
          <Text style={styles.matrixColLabel}>Acil Değil</Text>
        </View>
        {[0, 1].map((r) => (
          <View key={r} style={styles.matrixRow}>
            <Text style={styles.matrixRowLabel}>{r === 0 ? 'Önemli' : 'Önemsiz'}</Text>
            {[0, 1].map((c) => {
              const g = grid.find((x) => x.row === r && x.col === c)!;
              const m = TRIAGE_META[g.t];
              const active = cell.row === r && cell.col === c;
              return (
                <View
                  key={c}
                  style={[
                    styles.matrixCell,
                    { borderColor: active ? m.color : colors.border, backgroundColor: active ? m.color + '22' : colors.surface },
                  ]}
                >
                  <Text style={styles.matrixEmoji}>{m.emoji}</Text>
                  <Text style={[styles.matrixCellLabel, active && { color: m.color }]} numberOfLines={1}>
                    {m.label}
                  </Text>
                </View>
              );
            })}
          </View>
        ))}

        {/* Triaj Kararı */}
        <View style={[styles.triageCard, { borderColor: meta.color + '55', backgroundColor: meta.color + '12' }]}>
          <View style={[styles.triageIconWrap, { backgroundColor: meta.color + '22' }]}>
            <Text style={styles.triageEmoji}>{meta.emoji}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.triageTitle, { color: meta.color }]}>{meta.label}</Text>
            <Text style={styles.triageDesc}>{meta.roomDesc}</Text>
            <Text style={styles.triageCost}>Sonraki adımda zorluk ile irade maliyeti hesaplanır</Text>
          </View>
        </View>
      </View>
    );
  };

  // Step 5 — Zorluk & İrade Maliyeti (şeffaf hesap)
  const renderStep5 = () => {
    const bd = costBreakdown(form);
    const dmeta = difficultyMeta(form.difficulty);
    const rows: { label: string; val: string; color?: string }[] = [
      { label: `Zorluk (${dmeta.label})`, val: `${bd.diff}`, color: dmeta.color },
      // R01.02-e/A10: an interval habit names its interval, and its factor is the
      // interpolated one from triage (R01.02-d2), shown rounded.
      { label: `Frekans (${'intervalDays' in bd ? `${bd.intervalDays} günde bir` : bd.freqKind === 'daily' ? 'günlük' : bd.freqKind === 'weekly' ? 'haftalık' : 'aylık'})`, val: `×${decimalTR(Math.round(bd.freqFactor * 100) / 100, 2)}` },
      { label: 'Temel', val: decimalTR(bd.base) },
      { label: 'Davranış', val: bd.behaviorBonus ? `+${bd.behaviorBonus}` : '+0' },
      { label: 'Etki', val: bd.impactBonus ? `+${bd.impactBonus}` : '+0' },
      { label: 'Ölçüm', val: bd.trackingBonus ? `+${bd.trackingBonus}` : '+0' },
      { label: `Süre (${bd.mins} dk)`, val: bd.timeBonus ? `+${bd.timeBonus}` : '+0' },
    ];
    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Zorluk & İrade</Text>
        <Text style={styles.stepSubtitle}>Senin için ne kadar zorlayıcı?</Text>

        <Text style={styles.label}>Zorluk Seviyesi</Text>
        <View style={styles.row}>
          {DIFFICULTY_LEVELS.map((d) => {
            const sel = form.difficulty === d.key;
            return (
              <TouchableOpacity
                key={d.key}
                style={[styles.typeCard, sel && { borderColor: d.color, backgroundColor: d.color + '18' }]}
                onPress={() => setDifficulty(d.key)}
              >
                <Ionicons name={d.icon as any} size={22} color={sel ? d.color : colors.textDim} />
                <Text style={[styles.typeLabel, { marginTop: 6 }, sel && { color: d.color }]}>{d.label}</Text>
                <Text style={styles.typeDesc}>{d.desc}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Tahmini süre */}
        <Text style={[styles.label, { marginTop: 20 }]}>Günlük Tahmini Süre</Text>
        <View style={styles.minsRow}>
          {[5, 15, 30, 45, 60, 90].map((m) => {
            const sel = form.estimated_minutes === m;
            return (
              <TouchableOpacity
                key={m}
                style={[styles.minsBtn, sel && styles.minsBtnSel]}
                onPress={() => setMinutes(m)}
              >
                <Text style={[styles.minsBtnText, sel && styles.minsBtnTextSel]}>{m} dk</Text>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={[styles.minsBtn, form.estimated_minutes === 0 && styles.minsBtnSel]}
            onPress={() => setMinutes(0)}
          >
            <Text style={[styles.minsBtnText, form.estimated_minutes === 0 && styles.minsBtnTextSel]}>—</Text>
          </TouchableOpacity>
        </View>
        <TextInput
          style={[styles.input, { marginTop: 10 }]}
          placeholder="Özel süre (dk)"
          placeholderTextColor={colors.textFaint}
          keyboardType="numeric"
          value={form.estimated_minutes ? String(form.estimated_minutes) : ''}
          onChangeText={(t) => setMinutes(parseInt(t, 10) || 0)}
        />
        {form.estimated_minutes === 0 && (
          <Text style={styles.minsInfo} accessibilityLiveRegion="polite">
            Süre seçilmedi: yük en az 1 dk üzerinden hesaplanır
          </Text>
        )}

        {/* İrade maliyeti dökümü */}
        <View style={styles.costBreakdownCard}>
          <View style={styles.costHeadRow}>
            <View style={styles.costHeadLeft}>
              <Ionicons name="flash" size={20} color={colors.warning} />
              <Text style={styles.costHeadLabel}>Hesaplanan İrade Maliyeti</Text>
            </View>
            <View style={styles.costBigBadge}>
              <Text style={styles.costBigText}>{bd.cost}</Text>
            </View>
          </View>
          <View style={styles.costDivider} />
          {rows.map((r, i) => (
            <View key={i} style={styles.costRowItem}>
              <Text style={styles.costRowLabel}>{r.label}</Text>
              <Text style={[styles.costRowVal, r.color && { color: r.color }]}>{r.val}</Text>
            </View>
          ))}
          <View style={styles.costDivider} />
          <View style={styles.costRowItem}>
            <Text style={styles.costFormulaLabel}>Toplam (yuvarlanır)</Text>
            <Text style={styles.costFormulaVal}>{decimalTR(bd.raw)} → {bd.cost}</Text>
          </View>
          <Text style={styles.costHint}>
            Daha zor, daha sık ve daha etkili alışkanlıklar günlük irade bütçenden daha fazla yer.
          </Text>
        </View>
      </View>
    );
  };

  // Step 6 — İkon, Renk, İrade Maliyeti
  const renderStep6 = () => (
    <View style={styles.stepContent}>
      <Text style={styles.stepTitle}>Son Ayarlar</Text>
      <Text style={styles.stepSubtitle}>İkon, renk ve irade maliyeti</Text>

      <Text style={styles.label}>İkon</Text>
      <View style={styles.iconGrid}>
        {ICONS.map((icon) => (
          <TouchableOpacity
            key={icon}
            style={[styles.iconBtn, form.icon === icon && { borderColor: form.color ?? colors.accent, borderWidth: 2 }]}
            onPress={() => setForm({ ...form, icon })}
          >
            <Ionicons name={icon as any} size={24} color={form.icon === icon ? (form.color ?? colors.accent) : colors.textDim} />
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Renk</Text>
      <View style={styles.colorRow}>
        {COLORS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.colorDot, { backgroundColor: c }, form.color === c && styles.colorDotSelected]}
            onPress={() => setForm({ ...form, color: c })}
          >
            {form.color === c && <Ionicons name="checkmark" size={16} color={colors.white} />}
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>İrade Maliyeti (1–10)</Text>
      <View style={styles.infoBox}>
        <Ionicons name="flash" size={18} color={colors.warning} />
        <Text style={styles.infoText}>
          İrade motoru zorluk × frekans + etki + davranış faktörlerinden {computeWillpowerCost(form)} hesapladı — dilersen elle ayarla.
        </Text>
      </View>
      <View style={styles.costRow}>
        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
          <TouchableOpacity
            key={n}
            style={[styles.costBtn, form.willpower_cost === n && styles.costBtnSelected]}
            onPress={() => setForm({ ...form, willpower_cost: n })}
          >
            <Text style={[styles.costBtnText, form.willpower_cost === n && styles.costBtnTextSelected]}>{n}</Text>
          </TouchableOpacity>
        ))}
      </View>

    </View>
  );

  // Step 7 — Özet & Onayla (Mini Tablo karşılığı)
  const renderStep7 = () => {
    const triage = computeTriage(form.impact_level, form.urgency);
    const tmeta = TRIAGE_META[triage];
    const imp = IMPACT_LEVELS.find((l) => l.key === form.impact_level);
    const trackLabel =
      form.tracking_type === 'numeric' ? `Sayısal · ${form.daily_goal ?? '?'} ${form.unit ?? ''}`.trim()
      : form.tracking_type === 'duration' ? `Süre · ${form.daily_goal ?? '?'} ${DURATION_UNIT}`
      : form.tracking_type === 'abstinence' ? 'Kaçınma'
      : 'Evet / Hayır';
    // R01.02-e: the real schedule sentence ("Haftada 3 kez", "3 günde bir",
    // "… · 5–20 Ağustos arası"), not just the kind.
    const freqLabel = frequencySummary(form.frequency_config);

    const rows: { icon: string; label: string; val: string; color?: string }[] = [
      { icon: 'pricetag-outline', label: 'Davranış', val: form.behavior_type === 'positive' ? 'Pozitif' : 'Negatif' },
      { icon: 'compass-outline', label: 'Kategori', val: LIFE_AREAS.find((a) => a.key === form.life_area)?.label ?? '—' },
      { icon: 'analytics-outline', label: 'Takip', val: trackLabel },
      { icon: 'repeat-outline', label: 'Frekans', val: freqLabel },
      { icon: 'timer-outline', label: 'Tahmini Süre', val: form.estimated_minutes ? `${form.estimated_minutes} dk/gün` : '—' },
      { icon: 'notifications-outline', label: 'Hatırlatıcı', val: form.reminders?.enabled ? form.reminders.time : 'Kapalı' },
      { icon: 'link-outline', label: 'Çağrışım', val: cueLabel(form, existingHabits) ?? '—' },
      { icon: 'hourglass-outline', label: 'Bitiş', val: endConditionLabel(form.end_condition) },
      { icon: 'flame-outline', label: 'Etki', val: imp?.label ?? '—', color: imp?.color },
      { icon: form.urgency === 'urgent' ? 'flash' : 'time-outline', label: 'Aciliyet', val: form.urgency === 'urgent' ? 'Acil' : 'Acil Değil' },
      { icon: tmeta.icon, label: 'Karar', val: `${tmeta.emoji} ${tmeta.label}`, color: tmeta.color },
      { icon: 'flash', label: 'İrade Maliyeti', val: `${form.willpower_cost}`, color: colors.warning },
    ];

    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Özet & Onayla</Text>
        <Text style={styles.stepSubtitle}>Kararını gözden geçir</Text>

        {/* Başlık kartı */}
        <View style={styles.summaryHead}>
          <View style={[styles.summaryIcon, { backgroundColor: (form.color ?? colors.accent) + '25' }]}>
            <Ionicons name={(form.icon ?? 'star-outline') as any} size={26} color={form.color ?? colors.accent} />
          </View>
          <Text style={styles.summaryName}>{form.name || 'İsimsiz alışkanlık'}</Text>
        </View>

        {/* Mini tablo */}
        <View style={styles.summaryTable}>
          {rows.map((r, i) => (
            <View key={i} style={[styles.summaryRow, i === rows.length - 1 && { borderBottomWidth: 0 }]}>
              <View style={styles.summaryRowLeft}>
                <Ionicons name={r.icon as any} size={15} color={colors.textFaint} />
                <Text style={styles.summaryRowLabel}>{r.label}</Text>
              </View>
              <Text style={[styles.summaryRowVal, r.color && { color: r.color }]}>{r.val}</Text>
            </View>
          ))}
        </View>

        {/* Hedef kartı */}
        {willpowerState && (
          <View style={[styles.routingCard, { borderColor: DEST.color + '40', backgroundColor: DEST.color + '12' }]}>
            <Ionicons name={DEST.icon as any} size={18} color={DEST.color} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.routingTitle, { color: DEST.color }]}>{DEST.room}&apos;a eklenecek</Text>
              <Text style={styles.routingDesc}>
                {plannedStatus === 'active'
                  ? `🔥 ${TRIAGE_META[plannedTriage].label} · Slot: ${willpowerState.active_count + 1}/${willpowerState.focus_capacity} · Harcama: ${willpowerState.used + form.willpower_cost}/${willpowerState.daily_budget} irade`
                  : plannedStatus === 'idea'
                  ? `🗑 ${TRIAGE_META[plannedTriage].label} · Düşük öncelik — fikir olarak saklanır.`
                  : plannedTriage === 'do_now'
                  ? `⏳ Kapasite dolu (${willpowerState.active_count}/${willpowerState.focus_capacity} slot). Yer açarak aktifleştirebilirsin.`
                  : `${TRIAGE_META[plannedTriage].emoji} ${TRIAGE_META[plannedTriage].label} · Zamanı gelince Aktif Odak'a alabilirsin.`}
              </Text>
            </View>
          </View>
        )}

        <View style={styles.mirrorNoteRow}>
          <Ionicons name="grid-outline" size={13} color={colors.textFaint} />
          <Text style={styles.mirrorNoteText}>Bu özet, İstatistikler → Liste sekmesinde bir satır olarak görünür.</Text>
        </View>
      </View>
    );
  };

  const TOTAL_STEPS = 7;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <View style={styles.header}>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={28} color={colors.white} />
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
                <Text style={[styles.wpBandScore, { color: wpBarColor }]}>{wpScore === null ? '…' : `${wpScore}%`}</Text>
              </View>
              <View style={styles.wpBarBg}>
                <View style={[styles.wpBarFill, { width: `${wpUsedRatio * 100}%` as any, backgroundColor: wpBarColor }]} />
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
            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
            {step === 4 && renderStep4()}
            {step === 5 && renderStep5()}
            {step === 6 && renderStep6()}
            {step === 7 && renderStep7()}
          </ScrollView>

          <View style={styles.footer}>
            {step > 1 && (
              <TouchableOpacity style={styles.backButton} onPress={() => setStep(step - 1)}>
                <Ionicons name="arrow-back" size={20} color={colors.white} />
                <Text style={styles.backButtonText}>Geri</Text>
              </TouchableOpacity>
            )}
            {step < TOTAL_STEPS ? (
              <TouchableOpacity
                style={[styles.nextButton, !canProceed() && styles.buttonDisabled]}
                onPress={() => setStep(step + 1)}
                disabled={!canProceed()}
              >
                <Text style={styles.nextButtonText}>Devam</Text>
                <Ionicons name="arrow-forward" size={20} color={colors.white} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.submitButton, { backgroundColor: DEST.color }]}
                onPress={handleSubmit}
              >
                <Ionicons name={DEST.icon as any} size={18} color={colors.white} />
                <Text style={styles.submitButtonText}>{DEST.label}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', justifyContent: 'flex-end' },
  container: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, height: '92%' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 20, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: colors.white },
  progressContainer: { flexDirection: 'row', justifyContent: 'center', padding: 16, gap: 8 },
  progressDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.border },
  progressDotActive: { backgroundColor: colors.accent, width: 28 },
  content: { flex: 1, padding: 20 },
  stepContent: { flex: 1 },
  stepTitle: { fontSize: 24, fontWeight: 'bold', color: colors.white, marginBottom: 6 },
  stepSubtitle: { fontSize: 14, color: colors.textDim, marginBottom: 24 },
  label: { fontSize: 15, fontWeight: '600', color: colors.white, marginBottom: 10 },
  input: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 15,
    color: colors.white, marginBottom: 14, borderWidth: 1, borderColor: colors.border,
  },
  fieldHint: { fontSize: 12, color: colors.warning, marginTop: -8, marginBottom: 12 },
  minsInfo: { fontSize: 12, color: colors.textFaint, marginTop: -6, marginBottom: 6 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  typeCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 14, padding: 16,
    alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  typeCardSelected: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  typeCardSelectedRed: { borderColor: colors.error, backgroundColor: colors.selectedTintError },
  typeEmoji: { fontSize: 28, marginBottom: 6 },
  typeLabel: { fontSize: 15, fontWeight: '600', color: colors.white, marginBottom: 2 },
  typeDesc: { fontSize: 12, color: colors.textDim, textAlign: 'center' },
  measurableSection: { marginTop: 16 },
  dirBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  dirBtnSelected: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  dirBtnText: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  freqBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12,
    alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  freqBtnSelected: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  freqBtnText: { color: colors.textDim, fontSize: 13, fontWeight: '600' },
  freqBtnTextSelected: { color: colors.accent },
  daysRow: { flexDirection: 'row', gap: 6 },
  dayBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 8, paddingVertical: 10,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  dayBtnSelected: { backgroundColor: colors.accent, borderColor: colors.accent },
  // R01.02-e: same height/hit area as dayBtn; only room for longer labels.
  wideChip: { paddingHorizontal: 4 },
  dayBtnText: { fontSize: 11, color: colors.textDim, fontWeight: '600' },
  dayBtnTextSelected: { color: colors.white },
  partBtn: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 14,
    alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  partBtnSelected: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  partEmoji: { fontSize: 24, marginBottom: 4 },
  partLabel: { fontSize: 12, color: colors.textDim },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  iconBtn: {
    width: 52, height: 52, backgroundColor: colors.surface, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  colorRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  colorDot: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'transparent',
  },
  colorDotSelected: { borderColor: colors.white },
  infoBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: 10, padding: 12, gap: 10, marginBottom: 14,
  },
  infoText: { flex: 1, fontSize: 13, color: colors.textDim },
  costRow: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  costBtn: {
    width: 44, height: 44, backgroundColor: colors.surface, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border,
  },
  costBtnSelected: { backgroundColor: colors.warning, borderColor: colors.warning },
  costBtnText: { fontSize: 14, fontWeight: '600', color: colors.textDim },
  costBtnTextSelected: { color: colors.white },
  footer: {
    flexDirection: 'row', padding: 20,
    borderTopWidth: 1, borderTopColor: colors.border, gap: 12,
  },
  backButton: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.border,
  },
  backButtonText: { fontSize: 15, fontWeight: '600', color: colors.white },
  nextButton: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: colors.accent,
  },
  nextButtonText: { fontSize: 16, fontWeight: '600', color: colors.white },
  submitButton: {
    flex: 1, flexDirection: 'row', paddingVertical: 14, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  submitButtonText: { fontSize: 16, fontWeight: 'bold', color: colors.white },
  buttonDisabled: { opacity: 0.4 },

  wpBand: {
    marginHorizontal: 20, marginTop: 8, backgroundColor: colors.surface,
    borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border,
  },
  wpBandTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  wpBandLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  wpBandLabel: { fontSize: 12, fontWeight: '600' },
  wpBandScore: { fontSize: 13, fontWeight: '700' },
  wpBarBg: { height: 5, backgroundColor: colors.border, borderRadius: 3, marginBottom: 6 },
  wpBarFill: { height: 5, borderRadius: 3 },
  wpBandSub: { fontSize: 11, color: colors.textFaint },

  routingCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    borderRadius: 12, padding: 12, borderWidth: 1, marginTop: 14,
  },
  routingTitle: { fontSize: 14, fontWeight: '700', marginBottom: 3 },
  routingDesc: { fontSize: 12, color: colors.textDim, lineHeight: 16 },

  // Strateji adımı (Step 4)
  impactRow: { flexDirection: 'row', gap: 8 },
  impactCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 12,
    paddingHorizontal: 6, alignItems: 'center', borderWidth: 2, borderColor: colors.border,
  },
  impactDot: { width: 14, height: 14, borderRadius: 7, marginBottom: 8 },
  impactLabel: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 2 },
  impactDesc: { fontSize: 9, color: colors.textDim, textAlign: 'center', lineHeight: 12 },

  matrixHeaderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  matrixCorner: { width: 56 },
  matrixColLabel: { flex: 1, fontSize: 11, color: colors.textDim, textAlign: 'center', fontWeight: '600' },
  matrixRow: { flexDirection: 'row', alignItems: 'stretch', marginBottom: 8, gap: 8 },
  matrixRowLabel: { width: 56, fontSize: 11, color: colors.textDim, fontWeight: '600', alignSelf: 'center' },
  matrixCell: {
    flex: 1, borderRadius: 10, borderWidth: 1.5, paddingVertical: 12,
    alignItems: 'center', justifyContent: 'center', gap: 3,
  },
  matrixEmoji: { fontSize: 18 },
  matrixCellLabel: { fontSize: 11, color: colors.textFaint, fontWeight: '600' },

  triageCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 14, borderWidth: 1.5, padding: 14, marginTop: 20,
  },
  triageIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  triageEmoji: { fontSize: 22 },
  triageTitle: { fontSize: 16, fontWeight: '800', marginBottom: 2 },
  triageDesc: { fontSize: 12, color: colors.textDim, marginBottom: 3 },
  triageCost: { fontSize: 11, color: colors.textFaint },

  // İrade maliyeti dökümü (Step 5)
  costBreakdownCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: colors.border, marginTop: 20,
  },
  costHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  costHeadLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  costHeadLabel: { fontSize: 14, fontWeight: '700', color: colors.white },
  costBigBadge: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: alphaHex(colors.warning, '22'),
    alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: alphaHex(colors.warning, '55'),
  },
  costBigText: { fontSize: 22, fontWeight: '800', color: colors.warning },
  costDivider: { height: 1, backgroundColor: colors.border, marginVertical: 12 },
  costRowItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  costRowLabel: { fontSize: 13, color: colors.textDim },
  costRowVal: { fontSize: 13, fontWeight: '600', color: colors.text },
  costFormulaLabel: { fontSize: 13, fontWeight: '700', color: colors.white },
  costFormulaVal: { fontSize: 13, fontWeight: '700', color: colors.warning },
  costHint: { fontSize: 11, color: colors.textFaint, marginTop: 10, lineHeight: 15 },

  // Tahmini süre (Step 5)
  minsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  minsBtn: {
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.border,
  },
  minsBtnSel: { backgroundColor: alphaHex(colors.accent, '20'), borderColor: colors.accent },
  minsBtnText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
  minsBtnTextSel: { color: colors.accent },

  // Bitiş koşulu (Step 3)
  endKindBtn: {
    flex: 1, flexDirection: 'column', alignItems: 'center', gap: 5,
    backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 12,
    borderWidth: 2, borderColor: colors.border,
  },
  endKindBtnSel: { borderColor: colors.accent, backgroundColor: colors.selectedTint },
  endKindText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },
  endHint: { fontSize: 12, color: colors.accent, marginTop: 10, fontWeight: '600' },
  endUnit: { fontSize: 13, color: colors.textDim, marginLeft: 10 },

  // Hatırlatıcı (Step 3)
  reminderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  remToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 20,
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7,
    borderWidth: 1, borderColor: colors.border,
  },
  remToggleOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  remToggleText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },

  // Çağrışım (Step 3)
  cueChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 160,
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.border,
  },
  cueChipSel: { backgroundColor: alphaHex(colors.accent, '20'), borderColor: colors.accent },
  cueChipText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },

  // Özet adımı (Step 7)
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  summaryIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  summaryName: { flex: 1, fontSize: 18, fontWeight: '700', color: colors.white },
  summaryTable: { backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14 },
  summaryRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  summaryRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryRowLabel: { fontSize: 13, color: colors.textDim },
  summaryRowVal: { fontSize: 13, fontWeight: '700', color: colors.text, maxWidth: '55%', textAlign: 'right' },
  mirrorNoteRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14, paddingHorizontal: 2 },
  mirrorNoteText: { fontSize: 11, color: colors.textFaint, fontStyle: 'italic', flex: 1 },

  // Yaşam alanı çipleri (Step 1)
  areaHint: { fontSize: 11, color: colors.textFaint, marginTop: -4, marginBottom: 12, lineHeight: 16 },
  areaGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  areaChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.border,
  },
  areaDot: { width: 9, height: 9, borderRadius: 5 },
  areaChipText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
});
