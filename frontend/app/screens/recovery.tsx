import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
  Modal, TextInput, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, subDays, addDays } from 'date-fns';
import { tr } from 'date-fns/locale';
import { currentUser } from '../../lib/session';
import type { Habit, RecoveryStrategy } from '../../lib/supabase';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { deficitFor, type TrackingTypeV2 } from '../../lib/recovery';
import { isCountBasedSchedule, isEligibleOn, isMissedOn } from '../../lib/habitSchedule';
import { colors, space, radius, font, hexA } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import { Card, SectionHeader, EmptyState, IconCircle, Badge, Button, Chip, Skeleton } from '../../components/ui';
import { todayLocal } from '../../lib/date';
import { logsForHabitsSince as fetchHabitLogsForHabitsSince } from '../../services/habitService';
import { completePlanWithMakeup, makeupNeedsValue, makeupSuggestedValue } from '../../services/recoveryService';
// KD-12 — a measurable make-up asks for the amount instead of inventing one;
// the state then comes from the value, exactly as the timeline does (R01.03-a).
import { measuredEntryFor } from '../../services/habitLogService';
import MeasurableInputModal from '../../components/MeasurableInputModal';

// Telafi gününü hesaplayan hızlı seçenekler (date-picker dep yok)
function nextSaturdayOffset(): number {
  const dow = new Date().getDay(); // 0=Paz..6=Cmt
  const diff = (6 - dow + 7) % 7;
  return diff === 0 ? 7 : diff; // bugün cumartesiyse gelecek cumartesi
}
const WHEN_OPTIONS: { key: string; label: string; offset: () => number }[] = [
  { key: 'today', label: 'Bugün', offset: () => 0 },
  { key: 'tomorrow', label: 'Yarın', offset: () => 1 },
  { key: 'weekend', label: 'Hafta sonu', offset: nextSaturdayOffset },
];

type StreakMap = Record<string, number>;

// v2 sozlugu. Eski dort secenek ('full'|'half'|'mini'|'reschedule') ile
// bire bir ayni sey DEGIL: 'mini' ("2 dk minimum") v2'de karsiligi olmayan
// bir kavramdi ve adaptor onu 'skip'e -- yani "telafi etme"ye -- esliyordu.
// Artik dort secenek de kalici sozlukte adlandirildigi gibi.
export const STRATEGY_META: Record<RecoveryStrategy, { label: string; desc: string; icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  complete_today: { label: 'Bugün Tamamla', desc: 'Tamamını bugün yap', icon: 'refresh', color: colors.success },
  push_tomorrow: { label: 'Yarına Aktar', desc: 'İleri bir güne taşı', icon: 'calendar-outline', color: colors.primaryBright },
  split_two_days: { label: 'İkiye Böl', desc: 'İki güne dağıt', icon: 'contrast-outline', color: colors.warning },
  skip: { label: 'Telafi Etme', desc: 'Bu sefer geç, zinciri kırma', icon: 'flash-outline', color: colors.info },
};

export default function RecoveryScreen() {
  const { tasks, fetchTasks, toggleDone, moveToList } = useTaskStore();
  const { habits, fetchHabits } = useHabitStore();
  const { fetchLogsForDate, logHabit } = useLogStore();
  const { plans, fetchPlans, addPlan, skipPlan, deletePlan, planForHabit, recoveryOptionsFor } = useRecoveryStore();
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [streaks, setStreaks] = useState<StreakMap>({});
  // Geçmiş günlerde tamamlanmış/kısmi günler — "habitId|yyyy-mm-dd" anahtarlı
  const [doneSet, setDoneSet] = useState<Set<string>>(new Set());
  const [partialSet, setPartialSet] = useState<Set<string>>(new Set());
  /** Days the user explicitly logged as missed — distinct from never logged. */
  const [missedSet, setMissedSet] = useState<Set<string>>(new Set());
  // Kısmi günün GERÇEK değeri — "habitId|yyyy-mm-dd" -> value. Plan §9'un
  // başlığı (10.000 hedef / 8.000 fiili -> 2.000 eksik) bu olmadan çalışmaz.
  const [valueMap, setValueMap] = useState<Record<string, number>>({});
  const [loggingId, setLoggingId] = useState<string | null>(null);

  // KD-12 — the amount prompt for a measurable make-up. `planId` null means the
  // retroactive "yaptım" on a backlog day; otherwise a recovery plan is being
  // closed and the service writes the log and the plan together.
  const [makeupTarget, setMakeupTarget] = useState<
    { habit: Habit; date: string; planId: string | null; prior: number; suggested: number | null } | null
  >(null);

  // Planlama sheet'i
  const [planTarget, setPlanTarget] = useState<Habit | null>(null);
  const [planSource, setPlanSource] = useState<string>('');
  const [whenOffset, setWhenOffset] = useState(0);
  const [strategy, setStrategy] = useState<RecoveryStrategy>('complete_today');
  const [note, setNote] = useState('');
  const [reminderOn, setReminderOn] = useState(false);
  const [reminderTime, setReminderTime] = useState('20:00');
  const [saving, setSaving] = useState(false);

  const today = todayLocal();

  const overdueTasks = tasks.filter(
    (t) => t.due_date && t.due_date < today && !t.completed && t.status !== 'cancelled'
  );
  const activeHabits = habits.filter((h) => h.status === 'active');
  const habitById = (id: string) => habits.find((h) => h.id === id);

  const LOOKBACK = 14;
  const yesterdayStr = format(subDays(new Date(), 1), 'yyyy-MM-dd');

  // Geçmiş günlerde (BUGÜN HARİÇ) frekansa göre "due" olup tamamlanmamış günler = backlog.
  // hiç log yok → "kaçırıldı"; partial → "kısmi". Zaten planlı (source_date) günler hariç tutulur.
  // Bugün "kaçırıldı" sayılmaz — bugün henüz "bekliyor" (Bugün/Alışkanlıklar ekranında).
  const backlogEntries: { habit: Habit; date: string; kind: 'missed' | 'partial' }[] = [];
  for (const h of activeHabits) {
    // R01.02-b -- a count schedule ("3 a week") has NO per-day obligation, so it
    // has no missed day either. `isDueOn` used to answer with invented weekdays,
    // which filled this backlog with make-up offers for days the user never chose
    // while ignoring the ones they actually worked (R00 journey map row 6). The
    // real unit for these is a closed unmet PERIOD and its remaining count
    // (`periodStatus`); surfacing that needs a period row this day-keyed list
    // cannot express, so it is the follow-up card. Skipping is the correct
    // interim: a wrong-day make-up offer is worse than none.
    if (isCountBasedSchedule(h)) continue;
    for (let k = 1; k <= LOOKBACK; k++) {
      const dObj = subDays(new Date(), k);
      // R01.02-c — day lane: `isCountBasedSchedule(h)` above. `isEligibleOn` = `isDueOn` for daily/weekly_days; it adds the every_n_days interval. The date range is not a mode: it is the lifetime envelope (`withinLifetime`) both read.
      if (!isEligibleOn(h, dObj)) continue;
      const d = format(dObj, 'yyyy-MM-dd');
      const key = `${h.id}|${d}`;
      if (doneSet.has(key)) continue;
      if (plans.some((p) => p.habit_id === h.id && p.source_date === d)) continue;
      const isPartial = partialSet.has(key);
      // Negative habits are due like any other now, but an UNLOGGED day is
      // not a missed one for them: nothing recorded says nothing about the
      // day, and treating it as failure would fill this backlog with every
      // day the user did not open the app. A logged failure still counts.
      if (!isPartial && !isMissedOn(h, missedSet.has(key) ? { state: 'miss' } : undefined)) continue;
      backlogEntries.push({ habit: h, date: d, kind: isPartial ? 'partial' : 'missed' });
    }
  }
  backlogEntries.sort((a, b) => b.date.localeCompare(a.date));

  // Üst üste kaçırılan due-gün sayısı (dünden geri; yapılan/kısmı gün seriyi kırar)
  function consecutiveMissedDue(h: Habit): number {
    // Consecutive MISSED DUE DAYS is undefined for a count schedule -- see the
    // backlog loop above. 0 means "no day-level run", not "doing fine".
    if (isCountBasedSchedule(h)) return 0;
    let run = 0;
    for (let k = 1; k <= LOOKBACK; k++) {
      const dObj = subDays(new Date(), k);
      // R01.02-c — day lane: `isCountBasedSchedule(h)` above. `isEligibleOn` = `isDueOn` for daily/weekly_days; it adds the every_n_days interval. The date range is not a mode: it is the lifetime envelope (`withinLifetime`) both read.
      if (!isEligibleOn(h, dObj)) continue;
      const key = `${h.id}|${format(dObj, 'yyyy-MM-dd')}`;
      if (doneSet.has(key) || partialSet.has(key)) break;
      run++;
    }
    return run;
  }

  // Telafi günü (gelecek/bugün) insan etiketi
  function targetLabel(date: string): string {
    if (date === today) return 'Bugün';
    if (date === format(addDays(new Date(), 1), 'yyyy-MM-dd')) return 'Yarın';
    const [y, mo, d] = date.split('-').map(Number);
    return format(new Date(y, mo - 1, d), 'd MMM EEE', { locale: tr });
  }
  // Geçmiş gün insan etiketi
  function pastLabel(date: string): string {
    if (date === yesterdayStr) return 'Dün';
    const diff = Math.round((Date.parse(today) - Date.parse(date)) / 86400000);
    return `${diff} gün önce`;
  }

  // KD-12 — the day the amount prompt is writing to. "5 Ağustos", used as
  // "5 Ağustos gününe": the explicit `gününe` avoids the Turkish dative
  // suffix having to agree with the month's vowels, which "Ağustos'a" /
  // "Eylül'e" would.
  function makeupDayText(date: string): string {
    const [y, mo, d] = date.split('-').map(Number);
    return format(new Date(y, mo - 1, d), 'd MMMM', { locale: tr });
  }

  const computeStreaks = useCallback(async (habitIds: string[]) => {
    if (habitIds.length === 0) return;
    const since = format(subDays(new Date(), 60), 'yyyy-MM-dd');
    const user = await currentUser();
    if (!user) return;
    const res = await fetchHabitLogsForHabitsSince({ habitIds, since });
    if (!res.ok) return;
    const data = res.data;
    const map: StreakMap = {};
    for (const id of habitIds) {
      const logs = data.filter((l) => l.habit_id === id);
      let streak = 0;
      let cur = new Date();
      cur.setDate(cur.getDate() - 1);
      for (let i = 0; i < 60; i++) {
        const d = format(cur, 'yyyy-MM-dd');
        if (logs.some((l) => l.completed_at === d)) { streak++; cur.setDate(cur.getDate() - 1); }
        else break;
      }
      map[id] = streak;
    }
    setStreaks(map);

    // Geçmiş gün set'leri — kaçırma/kısmi tespiti backlog için bunları kullanır
    const done = new Set<string>();
    const partial = new Set<string>();
    const missed = new Set<string>();
    const vals: Record<string, number> = {};
    for (const l of data) {
      const k = `${l.habit_id}|${l.completed_at}`;
      // Split by STATE. This used to be `partial ? partial : done`, so an
      // explicit `miss` — and a `skip` — landed in the done set and the
      // backlog skipped the day entirely: a day the user recorded as failed
      // could never be offered a make-up.
      if (l.state === 'partial') partial.add(k);
      else if (l.state === 'miss') missed.add(k);
      else if (l.state === 'done') done.add(k);
      // `skip` is deliberately in none of them: it means "not today, on
      // purpose", which is neither a completion nor a failure.
      if (typeof l.value === 'number') vals[k] = l.value;
    }
    setDoneSet(done);
    setPartialSet(partial);
    setMissedSet(missed);
    setValueMap(vals);
  }, []);

  const load = useCallback(async () => {
    await Promise.all([fetchTasks(), fetchHabits(), fetchLogsForDate(today), fetchPlans()]);
  }, [today, fetchTasks, fetchHabits, fetchLogsForDate, fetchPlans]);

  useEffect(() => { load().finally(() => setLoading(false)); }, [load]);

  useEffect(() => {
    const active = habits.filter((h) => h.status === 'active');
    if (active.length > 0) computeStreaks(active.map((h) => h.id));
  }, [habits, computeStreaks]);

  async function onRefresh() {
    haptic.light();
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function refreshSets() {
    await computeStreaks(activeHabits.map((h) => h.id));
  }

  // Geçmiş bir günü retroaktif "yaptım" olarak işaretle
  //
  // KD-12 — for a measurable habit this used to write `done` with NO value,
  // which `completionRatio` reads as 0%: the user caught the day up and their
  // completion rate counted it as nothing. The amount is asked for now; the
  // state is derived from it, so the row cannot contradict itself.
  async function handleLogNow(habitId: string, date: string) {
    const habit = habitById(habitId);
    if (makeupNeedsValue(habit)) {
      haptic.select();
      setMakeupTarget({
        habit: habit!,
        date,
        planId: null,
        prior: valueMap[`${habitId}|${date}`] ?? 0,
        suggested: habit!.daily_goal ?? null,
      });
      return;
    }
    haptic.success();
    setLoggingId(`${habitId}|${date}`);
    const [y, mo, d] = date.split('-').map(Number);
    const res = await logHabit({ habitId, date: new Date(y, mo - 1, d), state: 'done' });
    if (!res.ok) {
      Alert.alert('Kaydedilemedi', res.error);
      setLoggingId(null);
      return;
    }
    await refreshSets();
    setLoggingId(null);
  }

  function openPlan(h: Habit, sourceDate: string) {
    haptic.select();
    setPlanTarget(h);
    setPlanSource(sourceDate);
    setWhenOffset(0);
    setStrategy('complete_today');
    setNote('');
    setReminderOn(false);
    setReminderTime('20:00');
  }

  const targetDate = format(addDays(new Date(), whenOffset), 'yyyy-MM-dd');

  // W3 (task Phase-1 CODER-F, Plan §9) — planlama sheet'inin hedef alışkanlığı
  // için GERÇEK açık. Yalnızca GÖSTERİM amaçlı: `addPlan` hâlâ yalnızca
  // bugünün gerçek `recovery_plans` sütunlarını yazıyor (bkz. addPlan/
  // recoveryOptionsFor'un store'daki belgeleri) -- açık burada asla
  // kalıcılaştırılmıyor.
  //
  // `value` artık GERÇEK okunuyor: `fetchHabitLogsForHabitsSince` `value`
  // sütununu da seçiyor, bu yüzden ölçülebilir bir alışkanlıkta 'kısmi' bir
  // gün için planın §9 başlığı doğru çalışıyor: 10.000 hedef / 8.000 fiili
  // -> 2.000 eksik. Değer yoksa (binary alışkanlık, ya da kayıtta `value`
  // null) `null` geçilir ve `deficitFor` kendi belgelenmiş muhafazakâr
  // davranışına düşer -- hedefin tamamını açık sayar, ASLA olduğundan az
  // göstermez.
  // `TrackingTypeV2` artık `Habit['tracking_type']` ile birebir aynı; eskiden
  // buradaki üçlü koşul 'numeric' dışındaki HER ŞEYİ 'boolean'a düşürüyordu,
  // yani süreli bir alışkanlığın eksiği "20 dakika kaldı" yerine "tamamen
  // kaçırıldı" diye hesaplanıyordu. Eşleme kimlik olduğu için kaldırıldı.
  const planTrackingType: TrackingTypeV2 = planTarget?.tracking_type ?? 'boolean';
  const planLogKey = planTarget ? `${planTarget.id}|${planSource}` : '';
  const planState: 'done' | 'partial' | 'miss' =
    doneSet.has(planLogKey) ? 'done' : partialSet.has(planLogKey) ? 'partial' : 'miss';
  const planLoggedValue: number | null =
    planLogKey && Object.prototype.hasOwnProperty.call(valueMap, planLogKey) ? valueMap[planLogKey] : null;
  const planDeficit = planTarget
    ? deficitFor({ trackingType: planTrackingType, target: planTarget.daily_goal, value: planLoggedValue, state: planState })
    : null;
  const planOptions = planTarget
    ? recoveryOptionsFor({
        trackingType: planTrackingType,
        target: planTarget.daily_goal,
        value: planLoggedValue,
        state: planState,
        fromDate: planSource || today,
      })
    : [];

  async function submitPlan() {
    if (!planTarget) return;
    setSaving(true);
    await addPlan({
      habitId: planTarget.id,
      habitName: planTarget.name,
      sourceDate: planSource,
      targetDate,
      strategy,
      note: note.trim() || null,
      reminderTime: reminderOn ? reminderTime.trim() : null,
    });
    setSaving(false);
    haptic.success();
    setPlanTarget(null);
  }

  async function handleCompletePlan(plan: typeof plans[number]) {
    const planHabit = habitById(plan.habit_id);
    if (makeupNeedsValue(planHabit)) {
      // KD-12 — same rule as the backlog "yaptım": ask, never invent. The
      // suggestion is sized by the strategy (`split_two_days` -> half), and the
      // user can overwrite it.
      haptic.select();
      setMakeupTarget({
        habit: planHabit!,
        date: plan.target_date,
        planId: plan.id,
        prior: valueMap[`${plan.habit_id}|${plan.target_date}`] ?? 0,
        suggested: makeupSuggestedValue(plan, planHabit),
      });
      return;
    }
    haptic.success();
    // What a make-up logs (done vs partial, and the reduced value) and the
    // rule that the LOG is written before the plan is closed both live in
    // `services/recoveryService.completePlanWithMakeup`. Closing the plan
    // without a log leaves the two permanently contradicting each other
    // (finding N-04), so the ordering is a domain rule, not screen code.
    const res = await completePlanWithMakeup({
      plan,
      habit: habitById(plan.habit_id),
      writeLog: (input) => logHabit(input),
    });
    if (!res.ok) {
      Alert.alert('Kaydedilemedi', res.error);
      return;
    }
    await refreshSets();
    if (plan.target_date === today) await fetchLogsForDate(today);
  }

  /**
   * KD-12 — the amount the user entered for a measurable make-up.
   *
   * The entry is an ADDITION to whatever that day already holds, and the state
   * is derived from the resulting total (`measuredEntryFor` -> `stateForValue`),
   * never chosen here. A plan goes through `completePlanWithMakeup` so the log
   * and the plan are still written in that order; a backlog day writes directly.
   * A failure leaves the modal open so the entry is not lost.
   */
  async function handleMakeupConfirm(entered: number) {
    if (!makeupTarget) return;
    const { habit, date, planId, prior } = makeupTarget;
    haptic.success();

    if (planId) {
      const plan = plans.find((pl) => pl.id === planId);
      if (!plan) { setMakeupTarget(null); return; }
      const res = await completePlanWithMakeup({
        plan,
        habit,
        writeLog: (input) => logHabit(input),
        enteredValue: entered,
        priorDayValue: prior,
      });
      if (!res.ok) { Alert.alert('Kaydedilemedi', res.error); return; }
      await refreshSets();
      if (plan.target_date === today) await fetchLogsForDate(today);
      setMakeupTarget(null);
      return;
    }

    setLoggingId(`${habit.id}|${date}`);
    const [y, mo, d] = date.split('-').map(Number);
    const intent = measuredEntryFor(habit, prior, entered);
    const res = await logHabit({
      habitId: habit.id,
      date: new Date(y, mo - 1, d),
      state: intent.state,
      value: intent.value,
      targetValue: intent.targetValue,
      targetDirection: intent.targetDirection,
    });
    if (!res.ok) { Alert.alert('Kaydedilemedi', res.error); setLoggingId(null); return; }
    await refreshSets();
    if (date === today) await fetchLogsForDate(today);
    setLoggingId(null);
    setMakeupTarget(null);
  }

  const totalMissed = backlogEntries.filter((e) => e.kind === 'missed').length;
  const totalPartial = backlogEntries.filter((e) => e.kind === 'partial').length;
  const totalOverdue = overdueTasks.length;
  const totalPlans = plans.length;
  // Üst üste ≥2 due-gün kaçıran (ve henüz planı olmayan) alışkanlıklar
  const neverMissTwice = activeHabits.filter((h) => consecutiveMissedDue(h) >= 2 && !planForHabit(h.id));
  const allClear = backlogEntries.length === 0 && totalOverdue === 0 && totalPlans === 0;

  // Yükleme yer tutucusu: hero + 3'lü özet şeridi + kart listesi — aşağıdaki
  // gerçek içeriğin geometrisi. Spinner yerine bu, yüklenince sıçrama olmuyor.
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.content}>
          <View style={s.hero}>
            <Skeleton width={64} height={64} circle />
            <Skeleton width={120} height={22} />
            <Skeleton width={240} height={12} />
          </View>
          <View style={s.summaryStrip}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={78} style={{ flex: 1 }} />
            ))}
          </View>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={112} style={{ marginBottom: space.sm }} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.warning} />}
      >
        {/* Hero */}
        <View style={s.hero}>
          <IconCircle icon="refresh-outline" color={colors.warning} size={64} iconSize={32} radiusKey="lg" />
          <Text style={s.heroTitle}>Telafi</Text>
          <Text style={s.heroSub}>Bir kez kaçırmak olur — ikinci kez kaçırma. Toparlanma zamanı.</Text>
        </View>

        {/* Özet şerit */}
        <View style={s.summaryStrip}>
          <Card padding="md" style={s.stripCard}>
            <Ionicons name="pulse-outline" size={18} color={totalMissed > 0 ? colors.warning : colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={[s.stripNum, { color: totalMissed > 0 ? colors.warning : colors.success }]}>{totalMissed}</Text>
            <Text style={s.stripLabel}>Kaçırılan</Text>
          </Card>
          <Card padding="md" style={s.stripCard}>
            <Ionicons name="contrast-outline" size={18} color={totalPartial > 0 ? colors.info : colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={[s.stripNum, { color: totalPartial > 0 ? colors.info : colors.success }]}>{totalPartial}</Text>
            <Text style={s.stripLabel}>Kısmi</Text>
          </Card>
          <Card padding="md" style={s.stripCard}>
            <Ionicons name="time-outline" size={18} color={totalOverdue > 0 ? colors.error : colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={[s.stripNum, { color: totalOverdue > 0 ? colors.error : colors.success }]}>{totalOverdue}</Text>
            <Text style={s.stripLabel}>Gecikmiş İş</Text>
          </Card>
        </View>

        {allClear && (
          <Card padding="lg" style={{ marginBottom: space.lg }}>
            <EmptyState
              icon="checkmark-done-circle-outline"
              title="Her şey yolunda!"
              hint="Telafi edilecek bir şey yok. Serini koru — yarın da burada görüşürüz."
              color={colors.success}
              compact
            />
          </Card>
        )}

        {/* Telafi Planın — aktif planlar */}
        {totalPlans > 0 && (
          <View style={s.section}>
            <SectionHeader title="Telafi Planın" icon="calendar-outline" iconColor={colors.primaryBright} count={totalPlans} variant="serif" />
            {plans.map((p) => {
              const h = habitById(p.habit_id);
              const m = STRATEGY_META[p.strategy];
              const overdue = p.target_date < today;
              return (
                <Card key={p.id} padding="md" style={{ marginBottom: space.sm }} selected={overdue} accent={colors.error}>
                  <View style={s.habitRow}>
                    <IconCircle icon={(h?.icon ?? 'star-outline') as any} color={h?.color ?? colors.primary} size={40} radiusKey="sm" />
                    <View style={{ flex: 1 }}>
                      <Text style={s.habitName} numberOfLines={1}>{h?.name ?? 'Alışkanlık'}</Text>
                      <View style={s.habitMeta}>
                        <Badge label={targetLabel(p.target_date)} icon="calendar-outline" color={overdue ? colors.error : colors.primaryBright} />
                        <Chip label={m.label} icon={m.icon} color={m.color} size="sm" />
                        {p.reminder_time && <Badge label={p.reminder_time} icon="notifications" color={colors.accent} />}
                        {overdue && <Badge label="gecikti" icon="alert-circle" color={colors.error} />}
                      </View>
                    </View>
                    <TouchableOpacity
                      onPress={() => { haptic.warning(); deletePlan(p.id); }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      accessibilityRole="button"
                      accessibilityLabel={`${h?.name ?? 'Alışkanlık'} telafi planını sil`}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.textGhost} />
                    </TouchableOpacity>
                  </View>
                  {!!p.note && <Text style={s.planNote}>{p.note}</Text>}
                  <View style={s.habitActions}>
                    <Button label="Telafi Et" icon="checkmark-done" variant="primary" size="sm" onPress={() => handleCompletePlan(p)} style={{ flex: 1 }} />
                    <Button label="Atla" icon="play-skip-forward-outline" variant="ghost" size="sm" color={colors.textDim} onPress={() => { haptic.light(); skipPlan(p.id); }} style={{ flex: 1 }} />
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        {/* Never miss twice uyarısı */}
        {neverMissTwice.length > 0 && (
          <View style={s.warnBanner} accessibilityRole="alert">
            <Ionicons name="warning" size={18} color={colors.error} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <View style={{ flex: 1 }}>
              <Text style={s.warnTitle}>İki kez kaçırma!</Text>
              <Text style={s.warnText}>
                {neverMissTwice.length === 1
                  ? `"${neverMissTwice[0].name}" ${consecutiveMissedDue(neverMissTwice[0])} gün üst üste kaçtı. Küçük de olsa bir adım at — zinciri kurtar.`
                  : `${neverMissTwice.length} alışkanlık üst üste kaçıyor. Bir mini adım bile zinciri korur.`}
              </Text>
            </View>
          </View>
        )}

        {/* Telafi Bekleyen — geçmiş günlerde kaçırılan/kısmi (frekansa göre due) */}
        {backlogEntries.length > 0 && (
          <View style={s.section}>
            <SectionHeader title="Telafi Bekleyen" icon="alert-circle-outline" iconColor={colors.warning} count={backlogEntries.length} variant="serif" />
            {backlogEntries.map((e) => {
              const h = e.habit;
              const key = `${h.id}|${e.date}`;
              const isLogging = loggingId === key;
              const streak = streaks[h.id] ?? 0;
              return (
                <Card key={key} padding="md" style={{ marginBottom: space.sm }}>
                  <View style={s.habitRow}>
                    <IconCircle icon={(h.icon ?? 'star-outline') as any} color={h.color ?? colors.primary} size={40} radiusKey="sm" />
                    <View style={{ flex: 1 }}>
                      <Text style={s.habitName} numberOfLines={1}>{h.name}</Text>
                      <View style={s.habitMeta}>
                        <Badge label={pastLabel(e.date)} icon="calendar-outline" color={colors.textDim} />
                        {e.kind === 'partial'
                          ? <Badge label="Kısmi" icon="contrast-outline" color={colors.info} />
                          : <Badge label="Kaçırıldı" icon="close-circle-outline" color={colors.warning} />}
                        {streak > 0 && <Badge label={`${streak}g seri`} icon="flame" color={colors.warning} />}
                      </View>
                    </View>
                  </View>
                  <View style={s.habitActions}>
                    <Button label="Yaptım" icon="checkmark" variant="tonal" color={colors.success} size="sm"
                      loading={isLogging} onPress={() => handleLogNow(h.id, e.date)} style={{ flex: 1 }} />
                    <Button label="Telafi Planla" icon="calendar-outline" variant="tonal" size="sm"
                      onPress={() => openPlan(h, e.date)} style={{ flex: 1 }} />
                  </View>
                </Card>
              );
            })}
          </View>
        )}

        {/* Gecikmiş görevler */}
        {totalOverdue > 0 && (
          <View style={s.section}>
            <SectionHeader title="Gecikmiş İşler" icon="time-outline" iconColor={colors.error} count={totalOverdue} variant="serif" />
            {overdueTasks.map((t) => (
              <Card key={t.id} padding="md" style={{ marginBottom: space.sm }}>
                <View style={s.taskInfo}>
                  <Text style={s.taskTitle} numberOfLines={1}>{t.title}</Text>
                  <Text style={s.taskDate}>{t.due_date}</Text>
                </View>
                <View style={s.taskActions}>
                  <Button label="Tamamla" icon="checkmark" variant="tonal" size="sm" color={colors.success}
                    onPress={() => { haptic.success(); toggleDone(t.id); }} />
                  <Button label="Bu Hafta" icon="arrow-forward" variant="tonal" size="sm"
                    onPress={() => { haptic.light(); moveToList(t.id, 'this_week'); }} />
                </View>
              </Card>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Telafi planlama sheet'i */}
      <Modal visible={!!planTarget} transparent animationType="slide" onRequestClose={() => setPlanTarget(null)}>
        <KeyboardAvoidingView style={s.sheetOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={s.sheet}>
            <View style={s.sheetHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.sheetTitle}>Telafi Planla</Text>
                <Text style={s.sheetHabit} numberOfLines={1}>
                  {planTarget?.name}{planSource ? ` · ${pastLabel(planSource)} kaçtı` : ''}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setPlanTarget(null)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                accessibilityRole="button"
                accessibilityLabel="Telafi planlamayı kapat"
              >
                <Ionicons name="close" size={22} color={colors.textDim} />
              </TouchableOpacity>
            </View>

            {/* W3 (Plan §9) — gerçek hesaplanmış açık + recoveryOptionsFor'un
                önerdiği 4 seçenek. Salt bilgi amaçlı; seçim hâlâ aşağıdaki
                NASIL ızgarasından (STRATEGY_META) yapılır. v1 sezgisel
                gösterge; hassas bir ölçüm iddiası değildir. */}
            {planDeficit && (
              <View style={s.deficitBox}>
                <Text style={s.deficitLabel}>
                  TELAFİ —{' '}
                  {planDeficit.type === 'numeric'
                    ? planDeficit.value > 0
                      ? `${planDeficit.value.toLocaleString('tr-TR')}${planTarget?.unit ? ` ${planTarget.unit}` : ''} kaldı`
                      : 'hedef tamamlandı'
                    : planDeficit.value > 0 ? 'bu gün kaldı' : 'kaçırılan yok'}
                </Text>
                {planOptions.length > 0 && (
                  <Text style={s.deficitHint}>
                    Öneri: {planOptions.map((o) => o.label).join(' · ')}
                  </Text>
                )}
              </View>
            )}

            <ScrollView style={{ maxHeight: 440 }} showsVerticalScrollIndicator={false}>
              {/* NE ZAMAN */}
              <Text style={s.fieldLabel}>NE ZAMAN</Text>
              <View style={s.chipRow}>
                {WHEN_OPTIONS.map((w) => {
                  const off = w.offset();
                  return (
                    <Chip key={w.key} label={w.label} color={colors.primaryBright}
                      selected={whenOffset === off} onPress={() => { haptic.select(); setWhenOffset(off); }} />
                  );
                })}
              </View>
              <View style={s.stepper}>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() => { haptic.select(); setWhenOffset((o) => Math.max(0, o - 1)); }}
                  accessibilityRole="button"
                  accessibilityLabel="Telafi gününü bir gün geri al"
                >
                  <Ionicons name="remove" size={18} color={colors.text} />
                </TouchableOpacity>
                <View style={s.stepInfo}>
                  <Text style={s.stepDate}>{format(addDays(new Date(), whenOffset), 'd MMMM EEEE', { locale: tr })}</Text>
                  <Text style={s.stepSub}>{whenOffset === 0 ? 'bugün' : whenOffset === 1 ? 'yarın' : `${whenOffset} gün sonra`}</Text>
                </View>
                <TouchableOpacity
                  style={s.stepBtn}
                  onPress={() => { haptic.select(); setWhenOffset((o) => Math.min(30, o + 1)); }}
                  accessibilityRole="button"
                  accessibilityLabel="Telafi gününü bir gün ileri al"
                >
                  <Ionicons name="add" size={18} color={colors.text} />
                </TouchableOpacity>
              </View>

              {/* NASIL */}
              <Text style={[s.fieldLabel, { marginTop: space.lg }]}>NASIL</Text>
              <View style={s.stratGrid}>
                {(Object.keys(STRATEGY_META) as RecoveryStrategy[]).map((k) => {
                  const m = STRATEGY_META[k];
                  const sel = strategy === k;
                  return (
                    <TouchableOpacity
                      key={k}
                      style={[s.stratCard, sel && { borderColor: m.color, backgroundColor: hexA(m.color, 0.1) }]}
                      onPress={() => { haptic.select(); setStrategy(k); }}
                      accessibilityRole="radio"
                      accessibilityLabel={`${m.label} — ${m.desc}`}
                      accessibilityState={{ checked: sel, selected: sel }}
                    >
                      <Ionicons name={m.icon} size={18} color={m.color} />
                      <Text style={[s.stratLabel, sel && { color: m.color }]}>{m.label}</Text>
                      <Text style={s.stratDesc}>{m.desc}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* NOT */}
              <Text style={[s.fieldLabel, { marginTop: space.lg }]}>NOT (opsiyonel)</Text>
              <TextInput
                style={s.noteInput}
                placeholder="Örn. kahvaltıdan hemen sonra, salonda 15 dk"
                placeholderTextColor={colors.textGhost}
                value={note}
                onChangeText={setNote}
                multiline
                accessibilityLabel="Telafi notu"
              />

              {/* HATIRLATICI */}
              <TouchableOpacity
                style={s.remToggle}
                activeOpacity={0.7}
                onPress={() => { haptic.select(); setReminderOn((v) => !v); }}
                accessibilityRole="switch"
                accessibilityLabel="Hatırlatıcı"
                accessibilityState={{ checked: reminderOn }}
              >
                <Ionicons name={reminderOn ? 'notifications' : 'notifications-off-outline'} size={18} color={reminderOn ? colors.accent : colors.textFaint} />
                <Text style={[s.remLabel, reminderOn && { color: colors.text }]}>Hatırlatıcı</Text>
                <View style={[s.switchTrack, reminderOn && { backgroundColor: colors.accent }]}>
                  <View style={[s.switchKnob, reminderOn && { transform: [{ translateX: 16 }] }]} />
                </View>
              </TouchableOpacity>
              {reminderOn && (
                <View style={s.timeRow}>
                  <Ionicons name="time-outline" size={16} color={colors.textFaint} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                  <TextInput
                    style={s.timeInput}
                    value={reminderTime}
                    onChangeText={setReminderTime}
                    placeholder="20:00"
                    placeholderTextColor={colors.textGhost}
                    maxLength={5}
                    accessibilityLabel="Hatırlatıcı saati"
                  />
                  <Text style={s.timeHint}>SS:DD</Text>
                </View>
              )}
            </ScrollView>

            <Button
              label={`${format(addDays(new Date(), whenOffset), 'd MMM', { locale: tr })} için planla`}
              icon="checkmark"
              size="lg"
              loading={saving}
              onPress={submitPlan}
              style={{ marginTop: space.md }}
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* KD-12 — ölçülebilir telafide miktar sorulur; değer uydurulmaz. */}
      <MeasurableInputModal
        visible={makeupTarget !== null}
        habit={makeupTarget?.habit ?? null}
        currentValue={makeupTarget?.prior ?? 0}
        dayLabel={makeupTarget ? `${makeupDayText(makeupTarget.date)} gününe` : undefined}
        onClose={() => setMakeupTarget(null)}
        onConfirm={handleMakeupConfirm}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  content: { padding: space.xl, paddingBottom: space.hh },

  hero: { alignItems: 'center', paddingVertical: space.lg, gap: 8, marginBottom: space.lg },
  heroTitle: { ...font.title, color: colors.text },
  heroSub: { ...font.bodySm, color: colors.textFaint, textAlign: 'center', maxWidth: 280, lineHeight: 19 },

  summaryStrip: { flexDirection: 'row', gap: space.md, marginBottom: space.xxl },
  stripCard: { flex: 1, alignItems: 'center', gap: 4 },
  stripNum: { ...font.metric, fontSize: 24 },
  stripLabel: { fontSize: 11, color: colors.textFaint, textAlign: 'center' },

  section: { marginBottom: space.xxl },

  warnBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: space.md,
    backgroundColor: hexA(colors.error, 0.1), borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: hexA(colors.error, 0.3), marginBottom: space.lg,
  },
  warnTitle: { ...font.h3, fontSize: 14, color: colors.error, marginBottom: 2 },
  warnText: { ...font.bodySm, color: colors.textDim, lineHeight: 18 },

  progRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm },
  progText: { fontSize: 11, color: colors.textFaint, minWidth: 64, textAlign: 'right' },

  habitRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  habitName: { ...font.body, color: colors.text, fontWeight: '600', marginBottom: 4 },
  habitMeta: { flexDirection: 'row', gap: 5, alignItems: 'center', flexWrap: 'wrap' },
  habitActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  planNote: { ...font.bodySm, color: colors.textDim, marginTop: space.sm, fontStyle: 'italic' },

  taskInfo: { marginBottom: space.md },
  taskTitle: { ...font.body, color: colors.text, fontWeight: '500' },
  taskDate: { fontSize: 12, color: colors.error, marginTop: 2 },
  taskActions: { flexDirection: 'row', gap: space.sm },

  // Planlama sheet'i
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: space.xl, paddingBottom: Platform.OS === 'ios' ? 36 : space.xxl,
    borderWidth: 1, borderColor: colors.border,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: space.lg },
  sheetTitle: { ...font.h2, color: colors.text },
  sheetHabit: { ...font.bodySm, color: colors.textFaint, marginTop: 2 },
  deficitBox: {
    backgroundColor: hexA(colors.warning, 0.1), borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: hexA(colors.warning, 0.3), marginBottom: space.lg,
  },
  deficitLabel: { ...font.body, color: colors.warning, fontWeight: '700' },
  deficitHint: { ...font.bodySm, color: colors.textDim, marginTop: 4, lineHeight: 17 },
  fieldLabel: { ...font.overline, color: colors.textFaint, marginBottom: space.sm },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.md },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: space.md, backgroundColor: colors.bgElevated, borderRadius: radius.md, padding: space.sm, borderWidth: 1, borderColor: colors.border },
  stepBtn: { width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  stepInfo: { flex: 1, alignItems: 'center' },
  stepDate: { ...font.body, color: colors.text, fontWeight: '600' },
  stepSub: { fontSize: 11, color: colors.textFaint, marginTop: 1 },

  stratGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  stratCard: {
    width: '48%', backgroundColor: colors.bgElevated, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.border, gap: 4,
  },
  stratLabel: { ...font.bodySm, color: colors.text, fontWeight: '700', marginTop: 2 },
  stratDesc: { fontSize: 11, color: colors.textFaint, lineHeight: 15 },

  noteInput: {
    backgroundColor: colors.bgElevated, borderRadius: radius.md, padding: space.md, minHeight: 56,
    color: colors.text, fontSize: 14, borderWidth: 1, borderColor: colors.border, textAlignVertical: 'top',
  },
  remToggle: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.lg },
  remLabel: { flex: 1, ...font.body, color: colors.textDim },
  switchTrack: { width: 38, height: 22, borderRadius: 11, backgroundColor: colors.surfaceAlt, padding: 3, justifyContent: 'center' },
  switchKnob: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.white },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.md, backgroundColor: colors.bgElevated, borderRadius: radius.md, paddingHorizontal: space.md, height: 44, borderWidth: 1, borderColor: colors.border },
  timeInput: { flex: 1, color: colors.text, fontSize: 15 },
  timeHint: { fontSize: 11, color: colors.textGhost },
});
