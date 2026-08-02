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
import type { Habit } from '../../lib/supabase';
import { computeTriage, triageToStatus, impactMeta, TRIAGE_META, cueLabel } from '../../lib/triage';

export default function HabitsScreen() {
  const { habits, loading, fetchHabits, addHabit, activateHabit, pauseHabit, updateHabit, removeHabit, restoreHabit, purgeHabit } = useHabitStore();
  const { state: wp, fetchToday, canActivate, spend, refund } = useWillpowerStore();
  const [refreshing, setRefreshing] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showAIRoutine, setShowAIRoutine] = useState(false);
  const [xpAnim, setXpAnim] = useState<number | null>(null);

  // Silme akışı
  const [deleteTarget, setDeleteTarget] = useState<Habit | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ habit: Habit; reason: string; wasActive: boolean } | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Kapasite yöneticisi — limit aşımında eklemeyi bekleten taslak
  const [capacityTarget, setCapacityTarget] = useState<Omit<Habit, 'id' | 'created_at' | 'user_id'> | null>(null);

  useEffect(() => {
    fetchHabits();
    fetchToday();
    return () => { if (deleteTimer.current) clearTimeout(deleteTimer.current); };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([fetchHabits(), fetchToday()]);
    setRefreshing(false);
  };

  const handleAddHabit = async (habitData: Omit<Habit, 'id' | 'created_at' | 'user_id'>) => {
    setShowOnboarding(false);
    const triage = computeTriage(habitData.impact_level, habitData.urgency);

    // do_now hedefli ama irade limiti yetmiyor → kapasite yöneticisini aç (henüz ekleme)
    if (triage === 'do_now' && !canActivate(habitData.willpower_cost)) {
      setCapacityTarget(habitData);
      return;
    }

    const finalStatus = triageToStatus(triage, canActivate(habitData.willpower_cost));
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
    if (!canActivate(habit.willpower_cost)) {
      Alert.alert(
        'Kapasite Dolu',
        `Bu alışkanlığı aktifleştirmek ${habit.willpower_cost} irade puanı gerektirir. Mevcut bütçeniz yetmiyor veya kapasite doldu.`,
        [{ text: 'Tamam' }]
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
    if (!wp) return '#827E72';
    const ratio = wp.used / wp.daily_budget;
    if (ratio < 0.5) return '#87A678';
    if (ratio < 0.8) return '#D4A84A';
    return '#C76A6A';
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
          <View style={[styles.iconWrap, { backgroundColor: (habit.color ?? '#D97757') + '25' }]}>
            <Ionicons name={(habit.icon ?? 'star-outline') as any} size={24} color={habit.color ?? '#D97757'} />
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
                <Ionicons name="flash" size={11} color="#D4A84A" />
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
              {habit.tracking_type === 'numeric' && (
                <View style={styles.measurableBadge}>
                  <Text style={styles.measurableText}>📊 {habit.unit}</Text>
                </View>
              )}
              <View style={[
                styles.behaviorBadge,
                { backgroundColor: habit.behavior_type === 'positive' ? '#87A67820' : '#C76A6A20' }
              ]}>
                <Text style={styles.behaviorText}>
                  {habit.behavior_type === 'positive' ? '✅ Pozitif' : '🚫 Negatif'}
                </Text>
              </View>
            </View>
            {cue && (
              <View style={styles.cueRow}>
                <Ionicons name="link-outline" size={11} color="#827E72" />
                <Text style={styles.cueText} numberOfLines={1}>{cue}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.cardActions}>
          {isCompleted ? (
            <TouchableOpacity style={styles.moveBtn} onPress={() => handleReopen(habit)}>
              <Ionicons name="refresh-outline" size={15} color="#D97757" />
              <Text style={styles.moveBtnText}>Geri Aç</Text>
            </TouchableOpacity>
          ) : isIdea ? (
            <TouchableOpacity style={styles.moveBtn} onPress={() => handleMoveToWaiting(habit)}>
              <Ionicons name="arrow-up-circle-outline" size={15} color="#D97757" />
              <Text style={styles.moveBtnText}>Beklemeye Al</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity style={styles.iconBtn} onPress={() => handleComplete(habit)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="checkmark-done-circle-outline" size={24} color="#87A678" />
              </TouchableOpacity>
              {isWaiting ? (
                <TouchableOpacity style={styles.activateBtn} onPress={() => handleActivate(habit)}>
                  <Ionicons name="play-circle" size={28} color="#87A678" />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={styles.pauseIconBtn} onPress={() => handlePause(habit)}>
                  <Ionicons name="pause-circle-outline" size={26} color="#BFBBAE" />
                </TouchableOpacity>
              )}
            </>
          )}
          <TouchableOpacity
            style={styles.trashBtn}
            onPress={() => { setDeleteReason(''); setDeleteTarget(habit); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="trash-outline" size={18} color="#C76A6A" />
          </TouchableOpacity>
        </View>
      </View>
    </View>
    );
  };

  if (loading && habits.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#D97757" />
      </View>
    );
  }

  const activeHabits = habits.filter((h) => h.status === 'active');
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
            <Ionicons name="layers-outline" size={13} color="#BFBBAE" /> {wp.active_count}/{wp.focus_capacity}
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.scroll}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D97757" />}
      >
        {/* Aktif */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="rocket" size={18} color="#87A678" />
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
            <Ionicons name="hourglass-outline" size={18} color="#BFBBAE" />
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
              {waitingHabits.map((h) => renderHabitCard(h, true))}
            </>
          )}
        </View>

        {/* Fikirler */}
        {ideaHabits.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="bulb-outline" size={18} color="#827E72" />
              <Text style={[styles.sectionTitle, { color: '#BFBBAE' }]}>Fikirler</Text>
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
              <Ionicons name="checkmark-done-circle-outline" size={18} color="#87A678" />
              <Text style={[styles.sectionTitle, { color: '#BFBBAE' }]}>Tamamlanan</Text>
              <Text style={styles.sectionCount}>{completedHabits.length}</Text>
            </View>
            <Text style={styles.sectionHint}>Hedefine ulaştın — gerekirse geri açabilirsin</Text>
            {completedHabits.map((h) => renderHabitCard(h, false))}
          </View>
        )}
      </ScrollView>

      {/* FAB — Alışkanlık Ekle */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowOnboarding(true)}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* AI Rutin butonu */}
      <TouchableOpacity style={styles.aiFab} onPress={() => setShowAIRoutine(true)}>
        <Ionicons name="sparkles" size={20} color="#fff" />
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
          <Ionicons name="trash" size={16} color="#C76A6A" />
          <Text style={styles.undoText} numberOfLines={1}>
            "{pendingDelete.habit.name}" silindi
          </Text>
          <TouchableOpacity style={styles.undoBtn} onPress={handleUndoDelete}>
            <Ionicons name="arrow-undo" size={14} color="#D97757" />
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
              <Ionicons name="trash-outline" size={26} color="#C76A6A" />
            </View>
            <Text style={styles.delTitle}>Alışkanlığı Sil</Text>
            <Text style={styles.delSub} numberOfLines={2}>
              "{deleteTarget?.name}" silinecek. Nedenini seçer misin?
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
              placeholderTextColor="#56544B"
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
              <View style={styles.capWarnIcon}>
                <Ionicons name="flash" size={22} color="#C76A6A" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.capTitle}>İrade Limitin Dolu</Text>
                <Text style={styles.capSub}>
                  "{capacityTarget?.name}" ({capacityTarget?.willpower_cost} irade) aktif etmek için yer aç
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
                  <Text style={[styles.capStatVal, { color: '#D4A84A' }]}>{capacityTarget.willpower_cost}</Text>
                  <Text style={styles.capStatLabel}>Gereken</Text>
                </View>
              </View>
            )}

            <Text style={styles.capListTitle}>AKTİF ALIŞKANLIKLAR — beklemeye al</Text>
            <ScrollView style={styles.capList}>
              {activeHabits.length === 0 ? (
                <Text style={styles.capEmpty}>Aktif alışkanlık yok</Text>
              ) : (
                activeHabits.map((h) => (
                  <View key={h.id} style={styles.capItem}>
                    <View style={[styles.capItemIcon, { backgroundColor: (h.color ?? '#D97757') + '25' }]}>
                      <Ionicons name={(h.icon ?? 'star-outline') as any} size={18} color={h.color ?? '#D97757'} />
                    </View>
                    <Text style={styles.capItemName} numberOfLines={1}>{h.name}</Text>
                    <View style={styles.capItemCost}>
                      <Ionicons name="flash" size={11} color="#D4A84A" />
                      <Text style={styles.capItemCostText}>{h.willpower_cost}</Text>
                    </View>
                    <TouchableOpacity style={styles.capMoveBtn} onPress={() => handlePause(h)}>
                      <Ionicons name="arrow-down" size={13} color="#BFBBAE" />
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
                <Ionicons name="time-outline" size={15} color="#D4A84A" />
                <Text style={styles.capWaitText}>Beklemeye Ekle</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.capActivateBtn, !(capacityTarget && canActivate(capacityTarget.willpower_cost)) && styles.capActivateDisabled]}
              onPress={handleActivatePending}
              disabled={!(capacityTarget && canActivate(capacityTarget.willpower_cost))}
            >
              <Ionicons name="flash" size={16} color="#fff" />
              <Text style={styles.capActivateText}>
                {capacityTarget && canActivate(capacityTarget.willpower_cost)
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
  container: { flex: 1, backgroundColor: '#15140F' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#15140F' },
  wpBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#1D1C17',
    borderBottomWidth: 1,
    borderBottomColor: '#28261F',
  },
  wpLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, width: 90 },
  wpText: { fontSize: 12, fontWeight: '600' },
  wpProgressTrack: {
    flex: 1, height: 4, backgroundColor: '#383528', borderRadius: 2, overflow: 'hidden',
  },
  wpProgressFill: { height: '100%', borderRadius: 2 },
  wpCapacity: { fontSize: 12, color: '#BFBBAE' },
  scroll: { flex: 1 },
  section: { padding: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  sectionTitle: { fontSize: 17, fontWeight: 'bold', color: '#fff', flex: 1 },
  sectionCount: {
    fontSize: 12, color: '#BFBBAE', backgroundColor: '#383528',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10,
  },
  sectionHint: { fontSize: 12, color: '#827E72', marginBottom: 12, fontStyle: 'italic' },
  empty: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 15, color: '#827E72', marginBottom: 4 },
  emptyHint: { fontSize: 12, color: '#56544B' },
  habitCard: {
    backgroundColor: '#1D1C17', borderRadius: 14, padding: 14,
    marginBottom: 12, borderWidth: 1, borderColor: '#383528',
  },
  habitCardWaiting: { opacity: 0.65 },
  habitCardIdea: { opacity: 0.5, borderStyle: 'dashed' },
  habitCardDone: { opacity: 0.55, borderColor: '#87A67840' },
  habitHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  habitLeft: { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 12 },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  habitMeta: { flex: 1 },
  habitName: { fontSize: 16, fontWeight: '600', color: '#fff', marginBottom: 4 },
  habitBadges: { flexDirection: 'row', gap: 6, flexWrap: 'wrap' },
  wpCostBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#D4A84A20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  wpCostText: { fontSize: 11, color: '#D4A84A', fontWeight: '600' },
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
  cueText: { fontSize: 12, color: '#827E72', flex: 1 },
  measurableBadge: {
    backgroundColor: '#D9775720', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  measurableText: { fontSize: 11, color: '#D97757' },
  behaviorBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  behaviorText: { fontSize: 11, color: '#BFBBAE' },
  activateBtn: { padding: 2 },
  pauseIconBtn: { padding: 2 },
  iconBtn: { padding: 2 },
  moveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#D9775720', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
    borderWidth: 1, borderColor: '#D9775730',
  },
  moveBtnText: { fontSize: 12, color: '#D97757', fontWeight: '600' },
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
    backgroundColor: '#D97757', alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 },
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
    backgroundColor: '#D97757', paddingHorizontal: 24, paddingVertical: 14,
    borderRadius: 14,
  },
  xpToastText: { fontSize: 28, fontWeight: 'bold', color: '#fff' },

  cardActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  trashBtn: {
    width: 34, height: 34, borderRadius: 9, backgroundColor: '#C76A6A15',
    alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#C76A6A30',
  },

  undoToast: {
    position: 'absolute', left: 16, right: 16,
    bottom: Platform.OS === 'ios' ? 100 : 80,
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1D1C17', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: '#383528',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 10,
  },
  undoText: { flex: 1, fontSize: 14, color: '#EDEAE0' },
  undoBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#D9775720', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#D9775740',
  },
  undoBtnText: { fontSize: 13, color: '#D97757', fontWeight: '700' },

  // Silme nedeni modalı
  delOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', padding: 24 },
  delSheet: { backgroundColor: '#1D1C17', borderRadius: 20, padding: 22, borderWidth: 1, borderColor: '#383528' },
  delIconWrap: {
    width: 52, height: 52, borderRadius: 16, backgroundColor: '#C76A6A18',
    alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 12,
  },
  delTitle: { fontSize: 19, fontWeight: '800', color: '#fff', textAlign: 'center', marginBottom: 4 },
  delSub: { fontSize: 13, color: '#BFBBAE', textAlign: 'center', marginBottom: 18, lineHeight: 18 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  reasonChip: {
    backgroundColor: '#1D1C17', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: '#383528',
  },
  reasonChipSel: { backgroundColor: '#C76A6A18', borderColor: '#C76A6A' },
  reasonChipText: { fontSize: 13, color: '#BFBBAE' },
  reasonChipTextSel: { color: '#C76A6A', fontWeight: '600' },
  reasonInput: {
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 12, fontSize: 14, color: '#fff',
    borderWidth: 1, borderColor: '#383528', marginBottom: 18,
  },
  delActions: { flexDirection: 'row', gap: 12 },
  delCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#383528', alignItems: 'center',
  },
  delCancelText: { fontSize: 15, fontWeight: '600', color: '#EDEAE0' },
  delConfirmBtn: {
    flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 13, borderRadius: 12,
    backgroundColor: '#C76A6A', alignItems: 'center', justifyContent: 'center',
  },
  delConfirmText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Kapasite yöneticisi
  capOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  capSheet: {
    backgroundColor: '#1D1C17', borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 24, maxHeight: '88%',
  },
  capHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  capWarnIcon: {
    width: 48, height: 48, borderRadius: 14, backgroundColor: '#C76A6A18',
    alignItems: 'center', justifyContent: 'center',
  },
  capTitle: { fontSize: 18, fontWeight: '800', color: '#fff' },
  capSub: { fontSize: 13, color: '#BFBBAE', marginTop: 2, lineHeight: 17 },
  capStatRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  capStat: {
    flex: 1, backgroundColor: '#1D1C17', borderRadius: 12, paddingVertical: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#383528',
  },
  capStatVal: { fontSize: 20, fontWeight: '800', color: '#fff' },
  capStatLabel: { fontSize: 11, color: '#827E72', marginTop: 2 },
  capListTitle: { fontSize: 11, fontWeight: '700', color: '#827E72', letterSpacing: 1, marginBottom: 10 },
  capList: { maxHeight: 240 },
  capEmpty: { fontSize: 13, color: '#827E72', textAlign: 'center', paddingVertical: 16 },
  capItem: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: '#383528',
  },
  capItemIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  capItemName: { flex: 1, fontSize: 14, color: '#EDEAE0', fontWeight: '500' },
  capItemCost: {
    flexDirection: 'row', alignItems: 'center', gap: 2,
    backgroundColor: '#D4A84A20', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2,
  },
  capItemCostText: { fontSize: 11, color: '#D4A84A', fontWeight: '600' },
  capMoveBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    backgroundColor: '#383528', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7,
  },
  capMoveText: { fontSize: 12, color: '#BFBBAE', fontWeight: '600' },
  capActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  capCancelBtn: {
    flex: 1, paddingVertical: 13, borderRadius: 12, backgroundColor: '#383528', alignItems: 'center',
  },
  capCancelText: { fontSize: 14, fontWeight: '600', color: '#EDEAE0' },
  capWaitBtn: {
    flex: 1.4, flexDirection: 'row', gap: 6, paddingVertical: 13, borderRadius: 12,
    backgroundColor: '#D4A84A18', borderWidth: 1, borderColor: '#D4A84A40',
    alignItems: 'center', justifyContent: 'center',
  },
  capWaitText: { fontSize: 14, fontWeight: '700', color: '#D4A84A' },
  capActivateBtn: {
    flexDirection: 'row', gap: 8, paddingVertical: 15, borderRadius: 12, marginTop: 10,
    backgroundColor: '#87A678', alignItems: 'center', justifyContent: 'center',
  },
  capActivateDisabled: { backgroundColor: '#1f3d33', opacity: 0.7 },
  capActivateText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
