import { colors, alphaHex } from '../../lib/tokens';
import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
  Modal,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Animatable from 'react-native-animatable';
import { useHabitStore } from '../../store/habitStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import HabitOnboarding from '../../components/HabitOnboarding';
import AIRoutineModal from '../../components/AIRoutineModal';
import { useCommandStore } from '../../store/commandStore';
import type { Habit } from '../../lib/supabase';
import { computeTriage, triageToStatus, impactMeta, TRIAGE_META, cueLabel } from '../../lib/triage';
import { dailyLoad, capacityAdvice, bandFor, LOAD_BANDS, habitsInRangeOn } from '../../lib/capacity';
import { isMeasurableTracking } from '../../lib/habitEngine';
import { explainActivation } from '../../services/capacityService';

export default function HabitsScreen() {
  const { habits, loading, fetchHabits, addHabit, activateHabit, pauseHabit, updateHabit, removeHabit, restoreHabit, purgeHabit } = useHabitStore();
  const { state: wp, fetchToday, canActivate, spend, refund, isStale } = useWillpowerStore();
  // R03.04 — the same rule activation uses, in words: why it waits, how to start it.
  const explain = (h: Habit) => explainActivation({
    state: (wp ?? null) as never, stale: isStale(), cost: h.willpower_cost,
    capacityInput: loading ? undefined : { habit: h, activeHabits: habits.filter((x) => x.status === 'active') },
  });
  const [refreshing, setRefreshing] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showAIRoutine, setShowAIRoutine] = useState(false);

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
    if (pendingIntent !== 'ai-routine') return;
    if (consumeIntent() === 'ai-routine') setShowAIRoutine(true);
  }, [pendingIntent, consumeIntent]);

  const [xpAnim, setXpAnim] = useState<number | null>(null);

  // Silme akışı
  const [deleteTarget, setDeleteTarget] = useState<Habit | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ habit: Habit; reason: string; wasActive: boolean } | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kapasite yöneticisi — limit aşımında eklemeyi bekleten taslak
  const [capacityTarget, setCapacityTarget] = useState<Omit<Habit, 'id' | 'created_at' | 'user_id'> | null>(null);

  // W1 (task Phase-1 CODER-F, Plan §10): şu an aktif alışkanlıkların yükü --
  // canActivate'e gerçek kapasite verisi geçmek için kullanılır. `loading`
  // sırasında `habits` henüz tam olmayabilir; o durumda çağrı siteleri eski
  // (legacy) tek-parametreli forma düşer -- yarım bir activeHabits listesi
  // yükü OLDUĞUNDAN AZ gösterip aktivasyona yanlışlıkla izin verebilirdi.
  const activeHabits = habits.filter((h) => h.status === 'active');

  useEffect(() => {
    fetchHabits();
    fetchToday();
    return () => { if (deleteTimer.current) clearTimeout(deleteTimer.current); };
  }, [fetchHabits, fetchToday]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchHabits(), fetchToday()]);
    setRefreshing(false);
  };

  const handleAddHabit = async (habitData: Omit<Habit, 'id' | 'created_at' | 'user_id'>) => {
    setShowOnboarding(false);
    const triage = computeTriage(habitData.impact_level, habitData.urgency);

    // do_now hedefli ama irade limiti yetmiyor → kapasite yöneticisini aç (henüz ekleme)
    if (triage === 'do_now' && !canActivate(habitData.willpower_cost, loading ? undefined : { habit: habitData, activeHabits })) {
      setCapacityTarget(habitData);
      return;
    }

    const finalStatus = triageToStatus(triage, canActivate(habitData.willpower_cost, loading ? undefined : { habit: habitData, activeHabits }));
    const result = await addHabit({ ...habitData, status: finalStatus });
    if (!result) return;

    if (finalStatus === 'active') {
      await spend(habitData.willpower_cost);
      setXpAnim(habitData.willpower_cost);
      setTimeout(() => setXpAnim(null), 2000);
    } else if (finalStatus === 'idea') {
      Alert.alert(
        '🗑 Fikirler\'e Eklendi',
        'Düşük öncelikli bir alışkanlık. Fikirler bölümünde saklandı; istediğinde beklemeye alabilirsin.',
        [{ text: 'Tamam' }]
      );
    } else {
      Alert.alert(
        `${TRIAGE_META[triage].emoji} Bekleme Odasına Alındı`,
        `Strateji kararı: ${TRIAGE_META[triage].label}. Zamanı gelince Aktif Odak'a alabilirsin.`,
        [{ text: 'Tamam' }]
      );
    }
  };

  // Kapasite yöneticisi aksiyonları
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
  };

  const handleWaitPending = async () => {
    const data = capacityTarget;
    if (!data) return;
    setCapacityTarget(null);
    await addHabit({ ...data, status: 'waiting' });
  };

  const handleMoveToWaiting = async (habit: Habit) => {
    await updateHabit(habit.id, { status: 'waiting' });
  };

  // ── Silme akışı: neden sor → geri al → kalıcı sil ──
  const DELETE_REASONS = [
    'Artık ihtiyacım yok',
    'Çok zorlayıcı',
    'Yanlış oluşturdum',
    'Önceliğim değişti',
    'Zaman bulamıyorum',
  ];

  // Bekleyen kalıcı silmeyi hemen tamamla (yeni bir silme başlatılmadan önce)
  const flushPending = async () => {
    if (deleteTimer.current) { clearTimeout(deleteTimer.current); deleteTimer.current = null; }
    const p = pendingDelete;
    if (p) {
      setPendingDelete(null);
      await purgeHabit(p.habit, p.reason);
    }
  };

  const confirmDelete = async () => {
    const habit = deleteTarget;
    const reason = deleteReason.trim();
    if (!habit) return;
    setDeleteTarget(null);
    setDeleteReason('');

    // Önceki bekleyen silme varsa kalıcılaştır
    await flushPending();

    const wasActive = habit.status === 'active';
    await removeHabit(habit.id);            // arşivle + listeden çıkar
    if (wasActive) await refund(habit.willpower_cost); // iradeyi hemen iade et

    setPendingDelete({ habit, reason, wasActive });
    deleteTimer.current = setTimeout(() => {
      setPendingDelete((cur) => {
        if (cur) purgeHabit(cur.habit, cur.reason);
        return null;
      });
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

  const handleActivate = async (habit: Habit) => {
    if (!canActivate(habit.willpower_cost, loading ? undefined : { habit, activeHabits })) {
      // R03.04 — say why, say how, and let the user overrule a load SUGGESTION.
      const e = explain(habit);
      Alert.alert(
        'Şimdilik bekliyor',
        `${e.why}

${e.how}`,
        e.canOverride
          ? [{ text: 'Vazgeç', style: 'cancel' }, { text: 'Yine de etkinleştir', onPress: () => { void activateHabit(habit.id, habit.willpower_cost, { override: true }); } }]
          : [{ text: 'Tamam' }],
      );
      return;
    }
    await activateHabit(habit.id, habit.willpower_cost);
  };

  const handlePause = async (habit: Habit) => {
    await pauseHabit(habit.id, habit.willpower_cost);
  };

  const handleComplete = async (habit: Habit) => {
    const wasActive = habit.status === 'active';
    await updateHabit(habit.id, { status: 'completed' });
    if (wasActive) await refund(habit.willpower_cost);
  };

  const handleReopen = async (habit: Habit) => {
    await updateHabit(habit.id, { status: 'waiting' });
  };

  const getWpColor = () => {
    if (!wp) return colors.textFaint;
    const ratio = wp.used / wp.daily_budget;
    if (ratio < 0.5) return colors.success;
    if (ratio < 0.8) return colors.warning;
    return colors.error;
  };

  const renderHabitCard = (habit: Habit, isWaiting: boolean) => {
    const imp = habit.impact_level ? impactMeta(habit.impact_level) : null;
    const isIdea = habit.status === 'idea';
    const isCompleted = habit.status === 'completed';
    const cue = cueLabel(habit, habits);
    return (
    <View key={habit.id} style={[styles.habitCard, (isWaiting || isIdea) && styles.habitCardWaiting, isIdea && styles.habitCardIdea, isCompleted && styles.habitCardDone]}>
      <View style={styles.habitHeader}>
        <View style={styles.habitLeft}>
          <View style={[styles.iconWrap, { backgroundColor: (habit.color ?? colors.accent) + '25' }]}>
            <Ionicons name={(habit.icon ?? 'star-outline') as any} size={24} color={habit.color ?? colors.accent} />
          </View>
          <View style={styles.habitMeta}>
            <Text style={styles.habitName}>{habit.name}</Text>
            <View style={styles.habitBadges}>
              {imp && (
                <View style={[styles.impactChip, { backgroundColor: imp.color + '20', borderColor: imp.color + '40' }]}>
                  <View style={[styles.impactChipDot, { backgroundColor: imp.color }]} />
                  <Text style={[styles.impactChipText, { color: imp.color }]}>{imp.label}</Text>
                </View>
              )}
              <View style={styles.wpCostBadge}>
                <Ionicons name="flash" size={11} color={colors.warning} />
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
              {isMeasurableTracking(habit.tracking_type) && (
                <View style={styles.measurableBadge}>
                  <Text style={styles.measurableText}>📊 {habit.unit}</Text>
                </View>
              )}
              <View style={[
                styles.behaviorBadge,
                { backgroundColor: habit.behavior_type === 'positive' ? alphaHex(colors.success, '20') : alphaHex(colors.error, '20') }
              ]}>
                <Text style={styles.behaviorText}>
                  {habit.behavior_type === 'positive' ? '✅ Pozitif' : '🚫 Negatif'}
                </Text>
              </View>
            </View>
            {cue && (
              <View style={styles.cueRow}>
                <Ionicons name="link-outline" size={11} color={colors.textFaint} />
                <Text style={styles.cueText} numberOfLines={1}>{cue}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.cardActions}>
          {isCompleted ? (
            <TouchableOpacity style={styles.moveBtn} onPress={() => handleReopen(habit)}>
              <Ionicons name="refresh-outline" size={15} color={colors.accent} />
              <Text style={styles.moveBtnText}>Geri Aç</Text>
            </TouchableOpacity>
          ) : isIdea ? (
            <TouchableOpacity style={styles.moveBtn} onPress={() => handleMoveToWaiting(habit)}>
              <Ionicons name="arrow-up-circle-outline" size={15} color={colors.accent} />
              <Text style={styles.moveBtnText}>Beklemeye Al</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity style={styles.iconBtn} onPress={() => handleComplete(habit)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="checkmark-done-circle-outline" size={24} color={colors.success} />
              </TouchableOpacity>
              {isWaiting ? (
                <TouchableOpacity style={styles.activateBtn} onPress={() => handleActivate(habit)}>
                  <Ionicons name="play-circle" size={28} color={colors.success} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.pauseIconBtn} onPress={() => handlePause(habit)}>
                  <Ionicons name="pause-circle-outline" size={26} color={colors.textDim} />
                </TouchableOpacity>
              )}
            </>
          )}
          <TouchableOpacity
            style={styles.trashBtn}
            onPress={() => { setDeleteReason(''); setDeleteTarget(habit); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={18} color={colors.error} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
    );
  };

  if (loading && habits.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const waitingHabits = habits.filter((h) => h.status === 'waiting');
  const ideaHabits = habits.filter((h) => h.status === 'idea');
  const completedHabits = habits.filter((h) => h.status === 'completed');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* İrade Bandı */}
      {wp && (
        <View style={styles.wpBar}>
          <View style={styles.wpLeft}>
            <Ionicons name="flash" size={16} color={getWpColor()} />
            <Text style={[styles.wpText, { color: getWpColor() }]}>
              İrade {wp.used}/{wp.daily_budget}
            </Text>
          </View>
          <View style={styles.wpProgressTrack}>
            <View style={[styles.wpProgressFill, { width: `${(wp.used / wp.daily_budget) * 100}%`, backgroundColor: getWpColor() }]} />
          </View>
          <Text style={styles.wpCapacity}>
            <Ionicons name="layers-outline" size={13} color={colors.textDim} /> {wp.active_count}/{wp.focus_capacity}
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        {/* Aktif */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="rocket" size={18} color={colors.success} />
            <Text style={styles.sectionTitle}>Aktif Odak</Text>
            <Text style={styles.sectionCount}>{activeHabits.length}</Text>
          </View>
          {activeHabits.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Henüz aktif alışkanlık yok</Text>
              <Text style={styles.emptyHint}>Bekleme odasından bir alışkanlık aktifleştir</Text>
            </View>
          ) : (
            activeHabits.map((h) => renderHabitCard(h, false))
          )}
        </View>

        {/* Bekleme Odası — her zaman görünür */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="hourglass-outline" size={18} color={colors.textDim} />
            <Text style={styles.sectionTitle}>Bekleme Odası</Text>
            <Text style={styles.sectionCount}>{waitingHabits.length}</Text>
          </View>
          {waitingHabits.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Bekleme odası boş</Text>
              <Text style={styles.emptyHint}>Kapasiteni aşan alışkanlıklar burada birikir</Text>
            </View>
          ) : (
            <>
              <Text style={styles.sectionHint}>
                Kapasite açılınca buradan aktifleştirebilirsin
              </Text>
              {waitingHabits.map((h) => {
                const e = explain(h);
                return (
                  <View key={h.id}>
                    {renderHabitCard(h, true)}
                    {/* R03.04 — neden bekliyor / nasıl aktive edilir */}
                    <Text style={styles.waitingWhy} accessibilityLabel={`${h.name} neden bekliyor: ${e.why} ${e.how}`}>
                      {e.why} {e.how}
                    </Text>
                  </View>
                );
              })}
            </>
          )}
        </View>

        {/* Fikirler */}
        {ideaHabits.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="bulb-outline" size={18} color={colors.textFaint} />
              <Text style={[styles.sectionTitle, { color: colors.textDim }]}>Fikirler</Text>
              <Text style={styles.sectionCount}>{ideaHabits.length}</Text>
            </View>
            <Text style={styles.sectionHint}>
              Düşük öncelikli — hazır olduğunda beklemeye al
            </Text>
            {ideaHabits.map((h) => renderHabitCard(h, false))}
          </View>
        )}

        {/* Tamamlanan */}
        {completedHabits.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="checkmark-done-circle-outline" size={18} color={colors.success} />
              <Text style={[styles.sectionTitle, { color: colors.textDim }]}>Tamamlanan</Text>
              <Text style={styles.sectionCount}>{completedHabits.length}</Text>
            </View>
            <Text style={styles.sectionHint}>Hedefine ulaştın — gerekirse geri açabilirsin</Text>
            {completedHabits.map((h) => renderHabitCard(h, false))}
          </View>
        )}
      </ScrollView>

      {/* FAB — Alışkanlık Ekle */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowOnboarding(true)}>
        <Ionicons name="add" size={28} color={colors.white} />
      </TouchableOpacity>

      {/* AI Rutin butonu */}
      <TouchableOpacity style={styles.aiFab} onPress={() => setShowAIRoutine(true)}>
        <Ionicons name="sparkles" size={20} color={colors.white} />
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
          <Ionicons name="trash" size={16} color={colors.error} />
          <Text style={styles.undoText} numberOfLines={1}>
            &quot;{pendingDelete.habit.name}&quot; silindi
          </Text>
          <TouchableOpacity style={styles.undoBtn} onPress={handleUndoDelete}>
            <Ionicons name="arrow-undo" size={14} color={colors.accent} />
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

      <AIRoutineModal
        visible={showAIRoutine}
        onClose={() => setShowAIRoutine(false)}
      />

      {/* Silme nedeni modalı */}
      <Modal visible={!!deleteTarget} animationType="fade" transparent onRequestClose={() => setDeleteTarget(null)}>
        <View style={styles.delOverlay}>
          <View style={styles.delSheet}>
            <View style={styles.delIconWrap}>
              <Ionicons name="trash-outline" size={26} color={colors.error} />
            </View>
            <Text style={styles.delTitle}>Alışkanlığı Sil</Text>
            <Text style={styles.delSub} numberOfLines={2}>
              &quot;{deleteTarget?.name}&quot; silinecek. Nedenini seçer misin?
            </Text>

            <View style={styles.reasonWrap}>
              {DELETE_REASONS.map((r) => {
                const sel = deleteReason === r;
                return (
                  <TouchableOpacity
                    key={r}
                    style={[styles.reasonChip, sel && styles.reasonChipSel]}
                    onPress={() => setDeleteReason(r)}
                  >
                    <Text style={[styles.reasonChipText, sel && styles.reasonChipTextSel]}>{r}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TextInput
              style={styles.reasonInput}
              placeholder="Veya kendi nedenini yaz (opsiyonel)"
              placeholderTextColor={colors.textGhost}
              value={DELETE_REASONS.includes(deleteReason) ? '' : deleteReason}
              onChangeText={setDeleteReason}
            />

            <View style={styles.delActions}>
              <TouchableOpacity style={styles.delCancelBtn} onPress={() => setDeleteTarget(null)}>
                <Text style={styles.delCancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.delConfirmBtn} onPress={confirmDelete}>
                <Ionicons name="trash" size={16} color={colors.white} />
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
              <View style={styles.capWarnIcon}>
                <Ionicons name="flash" size={22} color={colors.error} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.capTitle}>İrade Limitin Dolu</Text>
                <Text style={styles.capSub}>
                  &quot;{capacityTarget?.name}&quot; ({capacityTarget?.willpower_cost} irade) aktif etmek için yer aç
                </Text>
              </View>
            </View>

            {wp && capacityTarget && (
              <View style={styles.capStatRow}>
                <View style={styles.capStat}>
                  <Text style={styles.capStatVal}>{wp.daily_budget - wp.used}</Text>
                  <Text style={styles.capStatLabel}>Boş İrade</Text>
                </View>
                <View style={styles.capStat}>
                  <Text style={styles.capStatVal}>{wp.focus_capacity - wp.active_count}</Text>
                  <Text style={styles.capStatLabel}>Boş Slot</Text>
                </View>
                <View style={styles.capStat}>
                  <Text style={[styles.capStatVal, { color: colors.warning }]}>{capacityTarget.willpower_cost}</Text>
                  <Text style={styles.capStatLabel}>Gereken</Text>
                </View>
              </View>
            )}

            {/* W2 (Plan §10) — "74 + 18 → 92" şeklindeki kapasite tahmini.
                v1 sezgisel gösterge; hassas bir ölçüm iddiası değildir. */}
            {capacityTarget && !loading && (() => {
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
                    <View style={[styles.capItemIcon, { backgroundColor: (h.color ?? colors.accent) + '25' }]}>
                      <Ionicons name={(h.icon ?? 'star-outline') as any} size={18} color={h.color ?? colors.accent} />
                    </View>
                    <Text style={styles.capItemName} numberOfLines={1}>{h.name}</Text>
                    <View style={styles.capItemCost}>
                      <Ionicons name="flash" size={11} color={colors.warning} />
                      <Text style={styles.capItemCostText}>{h.willpower_cost}</Text>
                    </View>
                    <TouchableOpacity style={styles.capMoveBtn} onPress={() => handlePause(h)}>
                      <Ionicons name="arrow-down" size={13} color={colors.textDim} />
                      <Text style={styles.capMoveText}>Beklet</Text>
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
                <Ionicons name="time-outline" size={15} color={colors.warning} />
                <Text style={styles.capWaitText}>Beklemeye Ekle</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.capActivateBtn, !(capacityTarget && canActivate(capacityTarget.willpower_cost, loading ? undefined : { habit: capacityTarget, activeHabits })) && styles.capActivateDisabled]}
              onPress={handleActivatePending}
              disabled={!(capacityTarget && canActivate(capacityTarget.willpower_cost, loading ? undefined : { habit: capacityTarget, activeHabits }))}
            >
              <Ionicons name="flash" size={16} color={colors.white} />
              <Text style={styles.capActivateText}>
                {capacityTarget && canActivate(capacityTarget.willpower_cost, loading ? undefined : { habit: capacityTarget, activeHabits })
                  ? 'Aktif Olarak Ekle'
                  : 'Yer açınca aktifleşir'}
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
  wpBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  wpLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 90 },
  wpText: { fontSize: 12, fontWeight: '600' },
  wpProgressTrack: {
    flex: 1, height: 4, backgroundColor: colors.border, borderRadius: 2, overflow: 'hidden',
  },
  wpProgressFill: { height: '100%', borderRadius: 2 },
  wpCapacity: { fontSize: 12, color: colors.textDim },
  scroll: { flex: 1 },
  section: { padding: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: 'bold', color: colors.white, flex: 1 },
  sectionCount: {
    fontSize: 12, color: colors.textDim, backgroundColor: colors.border,
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  sectionHint: { fontSize: 12, color: colors.textFaint, marginBottom: 12, fontStyle: 'italic' },
  waitingWhy: { fontSize: 12, color: colors.textDim, marginTop: -6, marginBottom: 12, paddingHorizontal: 4 },
  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 15, color: colors.textFaint, marginBottom: 4 },
  emptyHint: { fontSize: 12, color: colors.textGhost },
  habitCard: {
    backgroundColor: colors.surface, borderRadius: 14, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: colors.border,
  },
  habitCardWaiting: { opacity: 0.65 },
  habitCardIdea: { opacity: 0.5, borderStyle: 'dashed' },
  habitCardDone: { opacity: 0.55, borderColor: alphaHex(colors.success, '40') },
  habitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  habitLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  habitMeta: { flex: 1 },
  habitName: { fontSize: 16, fontWeight: '600', color: colors.white, marginBottom: 4 },
  habitBadges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  wpCostBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: alphaHex(colors.warning, '20'), borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  wpCostText: { fontSize: 11, color: colors.warning, fontWeight: '600' },
  minBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#14b8a620', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  minBadgeText: { fontSize: 11, color: '#14b8a6', fontWeight: '600' },
  remBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#8b5cf620', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  remBadgeText: { fontSize: 11, color: '#a78bfa', fontWeight: '600' },
  cueRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 },
  cueText: { fontSize: 12, color: colors.textFaint, flex: 1 },
  measurableBadge: {
    backgroundColor: alphaHex(colors.accent, '20'), borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  measurableText: { fontSize: 11, color: colors.accent },
  behaviorBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  behaviorText: { fontSize: 11, color: colors.textDim },
  activateBtn: { padding: 2 },
  pauseIconBtn: { padding: 2 },
  iconBtn: { padding: 2 },
  moveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: alphaHex(colors.accent, '20'), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: alphaHex(colors.accent, '30'),
  },
  moveBtnText: { fontSize: 12, color: colors.accent, fontWeight: '600' },
  impactChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1,
  },
  impactChipDot: { width: 7, height: 7, borderRadius: 4 },
  impactChipText: { fontSize: 11, fontWeight: '600' },
  fab: {
    position: 'absolute', right: 16,
    bottom: Platform.OS === 'ios' ? 100 : 80,
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.black, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 8,
  },
  aiFab: {
    position: 'absolute', right: 16,
    bottom: Platform.OS === 'ios' ? 166 : 146,
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: '#8b5cf6', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#8b5cf6', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4, shadowRadius: 6, elevation: 6,
  },
  xpToast: {
    position: 'absolute', top: '40%', alignSelf: 'center',
    backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: 14,
  },
  xpToastText: { fontSize: 28, fontWeight: 'bold', color: colors.white },

  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trashBtn: {
    width: 34, height: 34, borderRadius: 9, backgroundColor: alphaHex(colors.error, '15'),
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: alphaHex(colors.error, '30'),
  },

  undoToast: {
    position: 'absolute', left: 16, right: 16,
    bottom: Platform.OS === 'ios' ? 100 : 80,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: colors.border,
    shadowColor: colors.black, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 10,
  },
  undoText: { flex: 1, fontSize: 14, color: colors.text },
  undoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: alphaHex(colors.accent, '20'), borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: alphaHex(colors.accent, '40'),
  },
  undoBtnText: { fontSize: 13, color: colors.accent, fontWeight: '700' },

  // Silme nedeni modalı
  delOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 24 },
  delSheet: { backgroundColor: colors.surface, borderRadius: 20, padding: 22, borderWidth: 1, borderColor: colors.border },
  delIconWrap: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: alphaHex(colors.error, '18'),
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12,
  },
  delTitle: { fontSize: 19, fontWeight: '800', color: colors.white, textAlign: 'center', marginBottom: 4 },
  delSub: { fontSize: 13, color: colors.textDim, textAlign: 'center', marginBottom: 18, lineHeight: 18 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  reasonChip: {
    backgroundColor: colors.surface, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  reasonChipSel: { backgroundColor: alphaHex(colors.error, '18'), borderColor: colors.error },
  reasonChipText: { fontSize: 13, color: colors.textDim },
  reasonChipTextSel: { color: colors.error, fontWeight: '600' },
  reasonInput: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 12, fontSize: 14, color: colors.white,
    borderWidth: 1, borderColor: colors.border, marginBottom: 18,
  },
  delActions: { flexDirection: 'row', gap: 12 },
  delCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center',
  },
  delCancelText: { fontSize: 15, fontWeight: '600', color: colors.text },
  delConfirmBtn: {
    flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 13, borderRadius: 12,
    backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center',
  },
  delConfirmText: { fontSize: 15, fontWeight: '700', color: colors.white },

  // Kapasite yöneticisi
  capOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  capSheet: {
    backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24, maxHeight: '88%',
  },
  capHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  capWarnIcon: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: alphaHex(colors.error, '18'),
    alignItems: 'center', justifyContent: 'center',
  },
  capTitle: { fontSize: 18, fontWeight: '800', color: colors.white },
  capSub: { fontSize: 13, color: colors.textDim, marginTop: 2, lineHeight: 17 },
  capStatRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  capStat: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  capStatVal: { fontSize: 20, fontWeight: '800', color: colors.white },
  capStatLabel: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  capAdviceBox: {
    backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 14,
    borderWidth: 1, borderColor: colors.border,
  },
  capAdviceFormula: { fontSize: 13, fontWeight: '700', color: colors.warning, marginBottom: 4 },
  capAdviceMsg: { fontSize: 12, color: colors.textDim, lineHeight: 16 },
  capListTitle: { fontSize: 11, fontWeight: '700', color: colors.textFaint, letterSpacing: 1, marginBottom: 10 },
  capList: { maxHeight: 240 },
  capEmpty: { fontSize: 13, color: colors.textFaint, textAlign: 'center', paddingVertical: 16 },
  capItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderRadius: 12, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  capItemIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  capItemName: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '500' },
  capItemCost: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: alphaHex(colors.warning, '20'), borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  capItemCostText: { fontSize: 11, color: colors.warning, fontWeight: '600' },
  capMoveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
  },
  capMoveText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },
  capActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  capCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: colors.border, alignItems: 'center',
  },
  capCancelText: { fontSize: 14, fontWeight: '600', color: colors.text },
  capWaitBtn: {
    flex: 1.4, flexDirection: 'row', gap: 6, paddingVertical: 13, borderRadius: 12,
    backgroundColor: alphaHex(colors.warning, '18'), borderWidth: 1, borderColor: alphaHex(colors.warning, '40'),
    alignItems: 'center', justifyContent: 'center',
  },
  capWaitText: { fontSize: 14, fontWeight: '700', color: colors.warning },
  capActivateBtn: {
    flexDirection: 'row', gap: 8, paddingVertical: 15, borderRadius: 12, marginTop: 10,
    backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center',
  },
  capActivateDisabled: { backgroundColor: colors.selectedTintSuccess, opacity: 0.7 },
  capActivateText: { fontSize: 15, fontWeight: '700', color: colors.white },
});
