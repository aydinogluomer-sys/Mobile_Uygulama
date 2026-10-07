import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
  Alert,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { format, addDays, startOfWeek } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import MeasurableInputModal from '../../components/MeasurableInputModal';
import HabitOnboarding from '../../components/HabitOnboarding';
import { useCommandStore } from '../../store/commandStore';
import type { Habit } from '../../lib/supabase';
import { computeTriage, triageToStatus, impactMeta, TRIAGE_META, cueLabel } from '../../lib/triage';
import { dailyLoad, capacityAdvice, bandFor, LOAD_BANDS, habitsInRangeOn } from '../../lib/capacity';
import { syncAllReminders } from '../../lib/notifications';
import { colors, radius, hexA } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import { WillpowerBand, SectionHeader, EmptyState, ProgressBar } from '../../components/ui';
import { isMeasurableTracking } from '../../lib/habitEngine';
// R01.03-a: a measurable entry's total and state come from the service, not this screen.
import { measuredEntryFor } from '../../services/habitLogService';

const DELETE_REASONS = [
  'Artık ihtiyacım yok',
  'Çok zorlayıcı',
  'Yanlış oluşturdum',
  'Önceliğim değişti',
  'Zaman bulamıyorum',
];

export default function TimelineScreen() {
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [measureHabit, setMeasureHabit] = useState<Habit | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  /**
   * The command palette cannot open this modal itself — it is mounted in the
   * tab layout and the modal lives here. It records an intent and navigates;
   * this effect is the other half.
   *
   * Keyed on the store value rather than on mount, because tab screens stay
   * mounted: a mount-only effect would fire on the first visit and never
   * again, so the palette action would work exactly once per app launch.
   * `consumeIntent` clears as it reads, so this cannot re-fire on re-render.
   */
  const pendingIntent = useCommandStore((st) => st.pendingIntent);
  const consumeIntent = useCommandStore((st) => st.consumeIntent);
  useEffect(() => {
    if (pendingIntent !== 'new-habit') return;
    if (consumeIntent() === 'new-habit') setShowOnboarding(true);
  }, [pendingIntent, consumeIntent]);

  const [xpAnim, setXpAnim] = useState<number | null>(null);

  // Silme akışı
  const [deleteTarget, setDeleteTarget] = useState<Habit | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ habit: Habit; reason: string; wasActive: boolean } | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kapasite yöneticisi
  const [capacityTarget, setCapacityTarget] = useState<Omit<Habit, 'id' | 'created_at' | 'user_id'> | null>(null);

  const { habits, loading: habitsLoading, fetchHabits, addHabit, activateHabit, pauseHabit, updateHabit, removeHabit, restoreHabit, purgeHabit } = useHabitStore();
  const { fetchLogsForDate, logHabit, getLogForHabit, getRemainingValue } = useLogStore();
  const { state: wp, fetchToday, canActivate, spend, refund } = useWillpowerStore();

  // W1 (task Phase-1 CODER-F, Plan §10): şu an aktif alışkanlıkların yükü --
  // canActivate'e gerçek kapasite verisi geçmek için kullanılır. `habitsLoading`
  // sırasında `habits` henüz tam olmayabilir; o durumda çağrı siteleri eski
  // (legacy) tek-parametreli forma düşer -- yarım bir activeHabits listesi
  // yükü OLDUĞUNDAN AZ gösterip aktivasyona yanlışlıkla izin verebilirdi.
  const activeHabits = habits.filter((h) => h.status === 'active');

  const loadData = useCallback(async () => {
    await Promise.all([fetchHabits(), fetchLogsForDate(selectedDate), fetchToday()]);
    // Bildirim hatırlatıcılarını mevcut alışkanlıklarla senkronla
    syncAllReminders(useHabitStore.getState().habits);
  }, [selectedDate, fetchHabits, fetchLogsForDate, fetchToday]);

  useEffect(() => {
    setLoading(true);
    loadData().finally(() => setLoading(false));
    return () => { if (deleteTimer.current) clearTimeout(deleteTimer.current); };
  }, [loadData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  // ── Günlük takip ──
  const handleYesNoTap = async (habit: Habit) => {
    const log = getLogForHabit(habit.id, selectedDate);
    const nextState = (!log || log.state === 'miss') ? 'done' : 'miss';
    if (nextState === 'done') haptic.success(); else haptic.light();
    const res = await logHabit({ habitId: habit.id, date: selectedDate, state: nextState });
    if (!res.ok) Alert.alert('Kaydedilemedi', res.error);
  };

  // R01.03-a — the modal's number is what the user ADDS; what is written is the
  // DAY'S TOTAL, and its state comes from the service, for both directions.
  // This screen used to decide the state itself (`value >= remaining` for
  // at_least, the raw entry for at_most) and wrote `done` rows at 40%.
  const handleMeasurableSubmit = async (entered: number) => {
    if (!measureHabit) return;
    const prior = getLogForHabit(measureHabit.id, selectedDate)?.value;
    const intent = measuredEntryFor(measureHabit, prior, entered);
    const res = await logHabit({
      habitId: measureHabit.id,
      date: selectedDate,
      state: intent.state,
      value: intent.value,
      targetValue: intent.targetValue,
      targetDirection: intent.targetDirection,
    });
    if (!res.ok) {
      Alert.alert('Kaydedilemedi', res.error);
      return;                       // modalı açık bırak; kullanıcı tekrar denesin
    }
    setMeasureHabit(null);
  };

  // ── Ekleme (triaj + kapasite) ──
  const handleAddHabit = async (habitData: Omit<Habit, 'id' | 'created_at' | 'user_id'>) => {
    setShowOnboarding(false);
    const triage = computeTriage(habitData.impact_level, habitData.urgency);

    if (triage === 'do_now' && !canActivate(habitData.willpower_cost, habitsLoading ? undefined : { habit: habitData, activeHabits })) {
      setCapacityTarget(habitData);
      return;
    }

    const finalStatus = triageToStatus(triage, canActivate(habitData.willpower_cost, habitsLoading ? undefined : { habit: habitData, activeHabits }));
    const result = await addHabit({ ...habitData, status: finalStatus });
    if (!result) return;

    if (finalStatus === 'active') {
      await spend(habitData.willpower_cost);
      setXpAnim(habitData.willpower_cost);
      setTimeout(() => setXpAnim(null), 2000);
    } else if (finalStatus === 'idea') {
      Alert.alert('🗑 Fikirler\'e Eklendi', 'Düşük öncelikli bir alışkanlık. Fikirler bölümünde saklandı.', [{ text: 'Tamam' }]);
    } else {
      Alert.alert(`${TRIAGE_META[triage].emoji} Bekleme Odasına Alındı`, `Strateji kararı: ${TRIAGE_META[triage].label}.`, [{ text: 'Tamam' }]);
    }
    await loadData();
  };

  const handleActivatePending = async () => {
    const data = capacityTarget;
    if (!data) return;
    setCapacityTarget(null);
    const result = await addHabit({ ...data, status: 'active' });
    if (result) {
      await spend(data.willpower_cost);
      setXpAnim(data.willpower_cost);
      setTimeout(() => setXpAnim(null), 2000);
    }
    await loadData();
  };

  const handleWaitPending = async () => {
    const data = capacityTarget;
    if (!data) return;
    setCapacityTarget(null);
    await addHabit({ ...data, status: 'waiting' });
    await loadData();
  };

  // ── Oda aksiyonları ──
  const handleActivate = async (habit: Habit) => {
    if (!canActivate(habit.willpower_cost, habitsLoading ? undefined : { habit, activeHabits })) {
      haptic.warning();
      Alert.alert('Kapasite Dolu', `${habit.willpower_cost} irade gerekiyor; bütçen yetmiyor veya slot dolu.`, [{ text: 'Tamam' }]);
      return;
    }
    haptic.success();
    await activateHabit(habit.id, habit.willpower_cost);
  };
  const handlePause = async (habit: Habit) => { haptic.light(); await pauseHabit(habit.id, habit.willpower_cost); };
  const handleMoveToWaiting = async (habit: Habit) => { haptic.light(); await updateHabit(habit.id, { status: 'waiting' }); };
  const handleComplete = async (habit: Habit) => {
    haptic.success();
    const wasActive = habit.status === 'active';
    await updateHabit(habit.id, { status: 'completed' });
    if (wasActive) await refund(habit.willpower_cost);
  };
  const handleReopen = async (habit: Habit) => { await updateHabit(habit.id, { status: 'waiting' }); };

  // ── Silme: neden sor → geri al → kalıcı sil ──
  const flushPending = async () => {
    if (deleteTimer.current) { clearTimeout(deleteTimer.current); deleteTimer.current = null; }
    const p = pendingDelete;
    if (p) { setPendingDelete(null); await purgeHabit(p.habit, p.reason); }
  };

  const confirmDelete = async () => {
    const habit = deleteTarget;
    const reason = deleteReason.trim();
    if (!habit) return;
    haptic.warning();
    setDeleteTarget(null);
    setDeleteReason('');
    await flushPending();

    const wasActive = habit.status === 'active';
    await removeHabit(habit.id);
    if (wasActive) await refund(habit.willpower_cost);

    setPendingDelete({ habit, reason, wasActive });
    deleteTimer.current = setTimeout(() => {
      setPendingDelete((cur) => { if (cur) purgeHabit(cur.habit, cur.reason); return null; });
      deleteTimer.current = null;
    }, 6000);
  };

  const handleUndoDelete = async () => {
    if (deleteTimer.current) { clearTimeout(deleteTimer.current); deleteTimer.current = null; }
    const p = pendingDelete;
    setPendingDelete(null);
    if (!p) return;
    await restoreHabit(p.habit);
    if (p.wasActive) await spend(p.habit.willpower_cost);
  };

  const renderWeekCalendar = () => {
    const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
    return (
      <View style={styles.weekCal}>
        {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((day, i) => {
          const sel = format(day, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
          const today = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
          return (
            <TouchableOpacity
              key={i}
              style={[styles.dayItem, sel && styles.daySelected, today && !sel && styles.dayToday]}
              onPress={() => setSelectedDate(day)}
            >
              <Text style={[styles.dayName, sel && styles.dayTextSel]}>{format(day, 'EEE', { locale: tr })}</Text>
              <Text style={[styles.dayNum, sel && styles.dayTextSel]}>{format(day, 'd')}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  // Aktif alışkanlık → takip edilebilir satır + yönetim aksiyonları
  const renderTrackRow = (habit: Habit) => {
    const log = getLogForHabit(habit.id, selectedDate);
    const isDone = log?.state === 'done';
    const isPartial = log?.state === 'partial';
    const remaining = isMeasurableTracking(habit.tracking_type)
      ? getRemainingValue(habit.id, habit.daily_goal ?? 0, selectedDate) : 0;
    const currentValue = (habit.daily_goal ?? 0) - remaining;
    const pct = isMeasurableTracking(habit.tracking_type) && habit.daily_goal
      ? Math.min(100, Math.round((currentValue / habit.daily_goal) * 100)) : 0;
    const imp = habit.impact_level ? impactMeta(habit.impact_level) : null;
    const cue = cueLabel(habit, habits);

    return (
      <TouchableOpacity
        key={habit.id}
        style={[styles.habitRow, isDone && styles.habitRowDone]}
        onPress={() => {
          if (isMeasurableTracking(habit.tracking_type)) setMeasureHabit(habit);
          else handleYesNoTap(habit);
        }}
        activeOpacity={0.7}
      >
        <View style={styles.habitRowLeft}>
          <View style={[
            styles.check,
            isDone && { backgroundColor: habit.color ?? colors.primary, borderColor: habit.color ?? colors.primary },
            isPartial && { borderColor: habit.color ?? colors.primary },
          ]}>
            {isDone && <Ionicons name="checkmark" size={16} color="#fff" />}
            {isPartial && <Ionicons name="remove" size={16} color={habit.color ?? colors.primary} />}
          </View>

          <View style={styles.habitRowInfo}>
            <Text style={[styles.habitRowName, isDone && styles.habitRowNameDone]}>{habit.name}</Text>
            <View style={styles.rowBadges}>
              {imp && (
                <View style={[styles.impactChip, { backgroundColor: imp.color + '20', borderColor: imp.color + '40' }]}>
                  <View style={[styles.impactChipDot, { backgroundColor: imp.color }]} />
                  <Text style={[styles.impactChipText, { color: imp.color }]}>{imp.label}</Text>
                </View>
              )}
              <View style={styles.wpCostBadge}>
                <Ionicons name="flash" size={10} color="#f59e0b" />
                <Text style={styles.wpCostText}>{habit.willpower_cost}</Text>
              </View>
              {habit.estimated_minutes > 0 && (
                <View style={styles.minBadge}>
                  <Ionicons name="timer-outline" size={10} color="#14b8a6" />
                  <Text style={styles.minBadgeText}>{habit.estimated_minutes}dk</Text>
                </View>
              )}
              {habit.reminders?.enabled && (
                <View style={styles.remBadge}>
                  <Ionicons name="notifications" size={10} color="#a78bfa" />
                  <Text style={styles.remBadgeText}>{habit.reminders.time}</Text>
                </View>
              )}
            </View>
            {cue && (
              <View style={styles.cueRow}>
                <Ionicons name="link-outline" size={11} color="#6b7280" />
                <Text style={styles.cueText} numberOfLines={1}>{cue}</Text>
              </View>
            )}
            {isMeasurableTracking(habit.tracking_type) && (
              <View style={styles.measurableRow}>
                <ProgressBar progress={pct / 100} color={habit.color ?? colors.primary} height={4} style={{ flex: 1 }} />
                <Text style={styles.measurableLabel}>
                  {isDone ? 'Tamamlandı' : remaining > 0 ? `${remaining} ${habit.unit ?? ''} kaldı` : `${currentValue} ${habit.unit ?? ''}`}
                </Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.rowActions}>
          {log?.xp != null && log.xp > 0 && (
            <View style={styles.xpBadge}><Text style={styles.xpBadgeText}>+{log.xp}</Text></View>
          )}
          <TouchableOpacity style={styles.rowIconBtn} onPress={() => handleComplete(habit)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="checkmark-done-circle-outline" size={22} color="#10b981" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.rowIconBtn} onPress={() => handlePause(habit)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="pause-circle-outline" size={22} color="#9ca3af" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.rowTrashBtn} onPress={() => { setDeleteReason(''); setDeleteTarget(habit); }} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
            <Ionicons name="trash-outline" size={16} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  // Bekleme/Fikirler → yönetim kartı
  const renderMgmtCard = (habit: Habit) => {
    const imp = habit.impact_level ? impactMeta(habit.impact_level) : null;
    const isIdea = habit.status === 'idea';
    const isCompleted = habit.status === 'completed';
    const cue = cueLabel(habit, habits);
    return (
      <View key={habit.id} style={[styles.mgmtCard, isIdea && styles.mgmtCardIdea, isCompleted && styles.mgmtCardDone]}>
        <View style={[styles.iconWrap, { backgroundColor: (habit.color ?? colors.primary) + '25' }]}>
          <Ionicons name={(habit.icon ?? 'star-outline') as any} size={22} color={habit.color ?? colors.primary} />
        </View>
        <View style={styles.mgmtMeta}>
          <Text style={styles.mgmtName}>{habit.name}</Text>
          <View style={styles.rowBadges}>
            {imp && (
              <View style={[styles.impactChip, { backgroundColor: imp.color + '20', borderColor: imp.color + '40' }]}>
                <View style={[styles.impactChipDot, { backgroundColor: imp.color }]} />
                <Text style={[styles.impactChipText, { color: imp.color }]}>{imp.label}</Text>
              </View>
            )}
            <View style={styles.wpCostBadge}>
              <Ionicons name="flash" size={10} color="#f59e0b" />
              <Text style={styles.wpCostText}>{habit.willpower_cost}</Text>
            </View>
            {isMeasurableTracking(habit.tracking_type) && (
              <View style={styles.measurableBadge}><Text style={styles.measurableBadgeText}>📊 {habit.unit}</Text></View>
            )}
          </View>
          {cue && (
            <View style={styles.cueRow}>
              <Ionicons name="link-outline" size={11} color="#6b7280" />
              <Text style={styles.cueText} numberOfLines={1}>{cue}</Text>
            </View>
          )}
        </View>
        <View style={styles.cardActions}>
          {isCompleted ? (
            <TouchableOpacity style={styles.moveBtn} onPress={() => handleReopen(habit)}>
              <Ionicons name="refresh-outline" size={14} color={colors.primary} />
              <Text style={styles.moveBtnText}>Geri Aç</Text>
            </TouchableOpacity>
          ) : isIdea ? (
            <TouchableOpacity style={styles.moveBtn} onPress={() => handleMoveToWaiting(habit)}>
              <Ionicons name="arrow-up-circle-outline" size={14} color={colors.primary} />
              <Text style={styles.moveBtnText}>Beklet</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity style={styles.rowIconBtn} onPress={() => handleComplete(habit)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                <Ionicons name="checkmark-done-circle-outline" size={22} color="#10b981" />
              </TouchableOpacity>
              <TouchableOpacity style={styles.activateBtn} onPress={() => handleActivate(habit)}>
                <Ionicons name="play-circle" size={26} color="#10b981" />
              </TouchableOpacity>
            </>
          )}
          <TouchableOpacity style={styles.trashBtn} onPress={() => { setDeleteReason(''); setDeleteTarget(habit); }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="trash-outline" size={16} color="#ef4444" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const waitingHabits = habits.filter((h) => h.status === 'waiting');
  const ideaHabits = habits.filter((h) => h.status === 'idea');
  const completedHabits = habits.filter((h) => h.status === 'completed');
  const todayDone = activeHabits.filter((h) => getLogForHabit(h.id, selectedDate)?.state === 'done').length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* İrade Bandı */}
      {wp && (
        <View style={styles.wpBand}>
          <WillpowerBand wp={wp} />
        </View>
      )}

      {renderWeekCalendar()}

      <View style={styles.summaryBar}>
        <Text style={styles.summaryDate}>{format(selectedDate, 'dd MMMM', { locale: tr })}</Text>
        <Text style={styles.summaryProgress}>{todayDone}/{activeHabits.length} tamamlandı</Text>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Aktif Odak — takip edilebilir */}
        <View style={styles.section}>
          <SectionHeader title="Aktif Odak" icon="rocket" iconColor={colors.success} count={activeHabits.length} variant="serif" />
          {activeHabits.length === 0 ? (
            <EmptyState
              icon="rocket-outline"
              title="Aktif alışkanlık yok"
              hint="Bekleme odasından bir alışkanlığı aktifleştir veya + ile yenisini ekle."
              ctaLabel="Alışkanlık Ekle"
              onCta={() => setShowOnboarding(true)}
              color={colors.success}
            />
          ) : (
            activeHabits.map(renderTrackRow)
          )}
        </View>

        {/* Bekleme Odası — her zaman görünür */}
        <View style={styles.section}>
          <SectionHeader title="Bekleme Odası" icon="hourglass-outline" iconColor={colors.textDim} count={waitingHabits.length} variant="serif" />
          {waitingHabits.length === 0 ? (
            <View style={styles.emptySmall}>
              <Text style={styles.emptyHint}>Bekleme odası boş</Text>
            </View>
          ) : (
            <>
              <Text style={styles.sectionHint}>Kapasite açılınca aktifleştirebilirsin</Text>
              {waitingHabits.map(renderMgmtCard)}
            </>
          )}
        </View>

        {/* Fikirler */}
        {ideaHabits.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Fikirler" icon="bulb-outline" iconColor={colors.textFaint} count={ideaHabits.length} variant="serif" />
            <Text style={styles.sectionHint}>Düşük öncelikli — hazır olunca beklemeye al</Text>
            {ideaHabits.map(renderMgmtCard)}
          </View>
        )}

        {/* Tamamlanan */}
        {completedHabits.length > 0 && (
          <View style={styles.section}>
            <SectionHeader title="Tamamlanan" icon="checkmark-done-circle-outline" iconColor={colors.success} count={completedHabits.length} variant="serif" />
            <Text style={styles.sectionHint}>Hedefine ulaştın — gerekirse geri aç</Text>
            {completedHabits.map(renderMgmtCard)}
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.fab} onPress={() => setShowOnboarding(true)} accessibilityLabel="Alışkanlık ekle">
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* XP animasyonu */}
      {xpAnim !== null && (
        <Animatable.View animation="fadeInUp" style={styles.xpToast}>
          <Text style={styles.xpToastText}>+{xpAnim} XP</Text>
        </Animatable.View>
      )}

      {/* Geri Al toast */}
      {pendingDelete && (
        <Animatable.View animation="fadeInUp" duration={250} style={styles.undoToast}>
          <Ionicons name="trash" size={16} color="#ef4444" />
          <Text style={styles.undoText} numberOfLines={1}>&quot;{pendingDelete.habit.name}&quot; silindi</Text>
          <TouchableOpacity style={styles.undoBtn} onPress={handleUndoDelete}>
            <Ionicons name="arrow-undo" size={14} color={colors.primary} />
            <Text style={styles.undoBtnText}>Geri Al</Text>
          </TouchableOpacity>
        </Animatable.View>
      )}

      <HabitOnboarding
        visible={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onSubmit={handleAddHabit}
        willpowerState={wp}
      />

      <MeasurableInputModal
        visible={measureHabit !== null}
        habit={measureHabit}
        // The day's real total so far -- not `goal - remaining`, which clamps at
        // the goal and hid a ceiling already exceeded.
        currentValue={measureHabit ? (getLogForHabit(measureHabit.id, selectedDate)?.value ?? 0) : 0}
        onClose={() => setMeasureHabit(null)}
        onConfirm={handleMeasurableSubmit}
      />

      {/* Silme nedeni modalı */}
      <Modal visible={!!deleteTarget} animationType="fade" transparent onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.delOverlay}>
          <View style={styles.delSheet}>
            <View style={styles.delIconWrap}><Ionicons name="trash-outline" size={26} color="#ef4444" /></View>
            <Text style={styles.delTitle}>Alışkanlığı Sil</Text>
            <Text style={styles.delSub} numberOfLines={2}>&quot;{deleteTarget?.name}&quot; silinecek. Nedenini seçer misin?</Text>
            <View style={styles.reasonWrap}>
              {DELETE_REASONS.map((r) => {
                const sel = deleteReason === r;
                return (
                  <TouchableOpacity key={r} style={[styles.reasonChip, sel && styles.reasonChipSel]} onPress={() => setDeleteReason(r)}>
                    <Text style={[styles.reasonChipText, sel && styles.reasonChipTextSel]}>{r}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <TextInput
              style={styles.reasonInput}
              placeholder="Veya kendi nedenini yaz (opsiyonel)"
              placeholderTextColor="#4b5563"
              value={DELETE_REASONS.includes(deleteReason) ? '' : deleteReason}
              onChangeText={setDeleteReason}
            />
            <View style={styles.delActions}>
              <TouchableOpacity style={styles.delCancelBtn} onPress={() => setDeleteTarget(null)}>
                <Text style={styles.delCancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.delConfirmBtn} onPress={confirmDelete}>
                <Ionicons name="trash" size={16} color="#fff" />
                <Text style={styles.delConfirmText}>Sil</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Kapasite Yöneticisi modalı */}
      <Modal visible={!!capacityTarget} animationType="slide" transparent onRequestClose={() => setCapacityTarget(null)}>
        <View style={styles.capOverlay}>
          <View style={styles.capSheet}>
            <View style={styles.capHeader}>
              <View style={styles.capWarnIcon}><Ionicons name="flash" size={22} color="#ef4444" /></View>
              <View style={{ flex: 1 }}>
                <Text style={styles.capTitle}>İrade Limitin Dolu</Text>
                <Text style={styles.capSub}>&quot;{capacityTarget?.name}&quot; ({capacityTarget?.willpower_cost} irade) aktif etmek için yer aç</Text>
              </View>
            </View>
            {wp && capacityTarget && (
              <View style={styles.capStatRow}>
                <View style={styles.capStat}><Text style={styles.capStatVal}>{wp.daily_budget - wp.used}</Text><Text style={styles.capStatLabel}>Boş İrade</Text></View>
                <View style={styles.capStat}><Text style={styles.capStatVal}>{wp.focus_capacity - wp.active_count}</Text><Text style={styles.capStatLabel}>Boş Slot</Text></View>
                <View style={styles.capStat}><Text style={[styles.capStatVal, { color: '#f59e0b' }]}>{capacityTarget.willpower_cost}</Text><Text style={styles.capStatLabel}>Gereken</Text></View>
              </View>
            )}

            {/* W2 (Plan §10) — "74 + 18 → 92" şeklindeki kapasite tahmini.
                v1 sezgisel gösterge; hassas bir ölçüm iddiası değildir. */}
            {capacityTarget && !habitsLoading && (() => {
              const currentLoad = dailyLoad({ habits: habitsInRangeOn(activeHabits, new Date()) }).normalised; // KD-08
              const advice = capacityAdvice({ currentLoad, incomingHabit: capacityTarget });
              const bandLabel = LOAD_BANDS.find((b) => b.key === bandFor(advice.projected))?.label ?? '';
              return (
                <View style={styles.capAdviceBox}>
                  <Text style={styles.capAdviceFormula}>
                    Kapasite (v1 tahmini) · {currentLoad} + {Math.round(advice.incomingPoints)} → {advice.projected}
                    {bandLabel ? ` · ${bandLabel}` : ''}
                  </Text>
                  <Text style={styles.capAdviceMsg}>{advice.message}</Text>
                </View>
              );
            })()}

            <Text style={styles.capListTitle}>AKTİF ALIŞKANLIKLAR — beklemeye al</Text>
            <ScrollView style={styles.capList}>
              {activeHabits.length === 0 ? (
                <Text style={styles.capEmpty}>Aktif alışkanlık yok</Text>
              ) : (
                activeHabits.map((h) => (
                  <View key={h.id} style={styles.capItem}>
                    <View style={[styles.capItemIcon, { backgroundColor: (h.color ?? colors.primary) + '25' }]}>
                      <Ionicons name={(h.icon ?? 'star-outline') as any} size={18} color={h.color ?? colors.primary} />
                    </View>
                    <Text style={styles.capItemName} numberOfLines={1}>{h.name}</Text>
                    <View style={styles.capItemCost}><Ionicons name="flash" size={11} color="#f59e0b" /><Text style={styles.capItemCostText}>{h.willpower_cost}</Text></View>
                    <TouchableOpacity style={styles.capMoveBtn} onPress={() => handlePause(h)}>
                      <Ionicons name="arrow-down" size={13} color="#9ca3af" /><Text style={styles.capMoveText}>Beklet</Text>
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </ScrollView>
            <View style={styles.capActions}>
              <TouchableOpacity style={styles.capCancelBtn} onPress={() => setCapacityTarget(null)}>
                <Text style={styles.capCancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.capWaitBtn} onPress={handleWaitPending}>
                <Ionicons name="time-outline" size={15} color="#f59e0b" /><Text style={styles.capWaitText}>Beklemeye Ekle</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.capActivateBtn, !(capacityTarget && canActivate(capacityTarget.willpower_cost, habitsLoading ? undefined : { habit: capacityTarget, activeHabits })) && styles.capActivateDisabled]}
              onPress={handleActivatePending}
              disabled={!(capacityTarget && canActivate(capacityTarget.willpower_cost, habitsLoading ? undefined : { habit: capacityTarget, activeHabits }))}
            >
              <Ionicons name="flash" size={16} color="#fff" />
              <Text style={styles.capActivateText}>
                {capacityTarget && canActivate(capacityTarget.willpower_cost, habitsLoading ? undefined : { habit: capacityTarget, activeHabits }) ? 'Aktif Olarak Ekle' : 'Yer açınca aktifleşir'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },

  wpBand: {
    paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: colors.bgElevated, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },

  weekCal: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 12, paddingVertical: 14, backgroundColor: colors.bgElevated },
  dayItem: { alignItems: 'center', justifyContent: 'center', width: 44, height: 60, borderRadius: 12 },
  daySelected: { backgroundColor: colors.primary },
  dayToday: { borderWidth: 1, borderColor: colors.primary },
  dayName: { fontSize: 11, color: colors.neutral400, marginBottom: 4 },
  dayNum: { fontSize: 17, fontWeight: '600', color: colors.white },
  dayTextSel: { color: colors.white },

  summaryBar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.coolBlack750,
  },
  summaryDate: { fontSize: 16, fontWeight: '700', color: colors.white },
  summaryProgress: { fontSize: 13, color: colors.neutral400 },

  scroll: { flex: 1 },
  section: { paddingHorizontal: 12, paddingTop: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, paddingHorizontal: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.white, flex: 1 },
  sectionCount: { fontSize: 13, color: colors.neutral500, fontWeight: '600' },
  sectionHint: { fontSize: 12, color: colors.neutral500, marginBottom: 10, fontStyle: 'italic', paddingHorizontal: 2 },

  empty: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptySmall: { alignItems: 'center', paddingVertical: 16 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.white },
  emptyHint: { fontSize: 13, color: colors.neutral500 },

  // Takip satırı (aktif)
  habitRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: colors.surface, borderRadius: radius.md, padding: 14, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  habitRowDone: { opacity: 0.6, borderColor: hexA(colors.success, 0.25) },
  habitRowLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  check: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: colors.coolBlack600, alignItems: 'center', justifyContent: 'center' },
  habitRowInfo: { flex: 1 },
  habitRowName: { fontSize: 15, fontWeight: '600', color: colors.white, marginBottom: 4 },
  habitRowNameDone: { textDecorationLine: 'line-through', color: colors.neutral500 },
  rowBadges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' },
  measurableRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  measurableTrack: { flex: 1, height: 4, backgroundColor: colors.coolBlack700, borderRadius: 2, overflow: 'hidden' },
  measurableFill: { height: '100%', borderRadius: 2 },
  measurableLabel: { fontSize: 11, color: colors.neutral400, minWidth: 80 },
  rowActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  rowIconBtn: { padding: 2 },
  rowTrashBtn: {
    width: 32, height: 32, borderRadius: 9, backgroundColor: '#ef444415',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ef444430',
  },
  xpBadge: { backgroundColor: hexA(colors.primary, 0.12), borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, marginRight: 2 },
  xpBadgeText: { fontSize: 11, color: colors.primary, fontWeight: '600' },

  // Yönetim kartı (bekleme/fikir)
  mgmtCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, marginBottom: 10,
    borderWidth: 1, borderColor: colors.border, opacity: 0.92,
  },
  mgmtCardIdea: { opacity: 0.55, borderStyle: 'dashed' },
  mgmtCardDone: { opacity: 0.55, borderColor: hexA(colors.success, 0.25) },
  iconWrap: { width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  mgmtMeta: { flex: 1 },
  mgmtName: { fontSize: 15, fontWeight: '600', color: colors.white, marginBottom: 4 },

  impactChip: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  impactChipDot: { width: 7, height: 7, borderRadius: 4 },
  impactChipText: { fontSize: 11, fontWeight: '600' },
  wpCostBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#f59e0b20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  wpCostText: { fontSize: 11, color: '#f59e0b', fontWeight: '600' },
  minBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#14b8a620', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  minBadgeText: { fontSize: 11, color: '#14b8a6', fontWeight: '600' },
  remBadge: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#8b5cf620', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  remBadgeText: { fontSize: 11, color: '#a78bfa', fontWeight: '600' },
  cueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  cueText: { fontSize: 12, color: colors.neutral500, flex: 1 },
  measurableBadge: { backgroundColor: hexA(colors.primary, 0.12), borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  measurableBadgeText: { fontSize: 11, color: colors.primary },

  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  activateBtn: { padding: 2 },
  moveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: hexA(colors.primary, 0.12), borderRadius: 8, paddingHorizontal: 9, paddingVertical: 7,
    borderWidth: 1, borderColor: hexA(colors.primary, 0.19),
  },
  moveBtnText: { fontSize: 12, color: colors.primary, fontWeight: '600' },
  trashBtn: {
    width: 32, height: 32, borderRadius: 9, backgroundColor: '#ef444415',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#ef444430',
  },

  fab: {
    position: 'absolute', right: 16, bottom: Platform.OS === 'ios' ? 100 : 80,
    width: 56, height: 56, borderRadius: 28, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.black, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },

  xpToast: { position: 'absolute', top: '42%', alignSelf: 'center', backgroundColor: colors.primary, paddingHorizontal: 24, paddingVertical: 14, borderRadius: 14 },
  xpToastText: { fontSize: 28, fontWeight: 'bold', color: colors.white },

  undoToast: {
    position: 'absolute', left: 16, right: 16, bottom: Platform.OS === 'ios' ? 100 : 80,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.coolBlack800, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: colors.coolBlack700,
    shadowColor: colors.black, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 10,
  },
  undoText: { flex: 1, fontSize: 14, color: colors.neutral200 },
  undoBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: hexA(colors.primary, 0.12), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: hexA(colors.primary, 0.25) },
  undoBtnText: { fontSize: 13, color: colors.primary, fontWeight: '700' },

  // Silme modalı
  delOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 24 },
  delSheet: { backgroundColor: colors.coolBlack800, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: colors.coolBlack700 },
  delIconWrap: { width: 52, height: 52, borderRadius: 16, backgroundColor: '#ef444418', alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12 },
  delTitle: { fontSize: 19, fontWeight: '800', color: colors.white, textAlign: 'center', marginBottom: 4 },
  delSub: { fontSize: 13, color: colors.neutral400, textAlign: 'center', marginBottom: 18, lineHeight: 18 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  reasonChip: { backgroundColor: colors.coolBlack900, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: colors.coolBlack700 },
  reasonChipSel: { backgroundColor: '#ef444418', borderColor: '#ef4444' },
  reasonChipText: { fontSize: 13, color: colors.neutral400 },
  reasonChipTextSel: { color: '#ef4444', fontWeight: '600' },
  reasonInput: { backgroundColor: colors.coolBlack900, borderRadius: 12, padding: 12, fontSize: 14, color: colors.white, borderWidth: 1, borderColor: colors.coolBlack700, marginBottom: 18 },
  delActions: { flexDirection: 'row', gap: 12 },
  delCancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.coolBlack700, alignItems: 'center' },
  delCancelText: { fontSize: 15, fontWeight: '600', color: colors.neutral200 },
  delConfirmBtn: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 13, borderRadius: 12, backgroundColor: '#ef4444', alignItems: 'center', justifyContent: 'center' },
  delConfirmText: { fontSize: 15, fontWeight: '700', color: colors.white },

  // Kapasite yöneticisi
  capOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  capSheet: { backgroundColor: colors.coolBlack800, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24, maxHeight: '88%' },
  capHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  capWarnIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#ef444418', alignItems: 'center', justifyContent: 'center' },
  capTitle: { fontSize: 18, fontWeight: '800', color: colors.white },
  capSub: { fontSize: 13, color: colors.neutral400, marginTop: 2, lineHeight: 17 },
  capStatRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  capStat: { flex: 1, backgroundColor: colors.coolBlack900, borderRadius: 12, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: colors.coolBlack700 },
  capStatVal: { fontSize: 20, fontWeight: '800', color: colors.white },
  capStatLabel: { fontSize: 11, color: colors.neutral500, marginTop: 2 },
  capAdviceBox: {
    backgroundColor: colors.coolBlack900, borderRadius: 12, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: colors.coolBlack700,
  },
  capAdviceFormula: { fontSize: 13, fontWeight: '700', color: '#f59e0b', marginBottom: 4 },
  capAdviceMsg: { fontSize: 12, color: colors.neutral400, lineHeight: 16 },
  capListTitle: { fontSize: 11, fontWeight: '700', color: colors.neutral500, letterSpacing: 1, marginBottom: 10 },
  capList: { maxHeight: 240 },
  capEmpty: { fontSize: 13, color: colors.neutral500, textAlign: 'center', paddingVertical: 16 },
  capItem: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.coolBlack900, borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: colors.coolBlack700 },
  capItemIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  capItemName: { flex: 1, fontSize: 14, color: colors.neutral200, fontWeight: '500' },
  capItemCost: { flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: '#f59e0b20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  capItemCostText: { fontSize: 11, color: '#f59e0b', fontWeight: '600' },
  capMoveBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.coolBlack700, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7 },
  capMoveText: { fontSize: 12, color: colors.neutral400, fontWeight: '600' },
  capActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  capCancelBtn: { flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.coolBlack700, alignItems: 'center' },
  capCancelText: { fontSize: 14, fontWeight: '600', color: colors.neutral200 },
  capWaitBtn: { flex: 1.4, flexDirection: 'row', gap: 6, paddingVertical: 13, borderRadius: 12, backgroundColor: '#f59e0b18', borderWidth: 1, borderColor: '#f59e0b40', alignItems: 'center', justifyContent: 'center' },
  capWaitText: { fontSize: 14, fontWeight: '700', color: '#f59e0b' },
  capActivateBtn: { flexDirection: 'row', gap: 8, paddingVertical: 15, borderRadius: 12, marginTop: 10, backgroundColor: '#10b981', alignItems: 'center', justifyContent: 'center' },
  capActivateDisabled: { backgroundColor: colors.selectedTintSuccess, opacity: 0.7 },
  capActivateText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
