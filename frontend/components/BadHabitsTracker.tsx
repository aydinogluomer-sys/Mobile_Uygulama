import { colors, alphaHex, radius } from '../lib/tokens';
import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerAccountStorage } from '../lib/accountScope';
import { currentUser } from '../lib/session';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { haptic } from '../lib/haptics';
import {
  listBadHabits, createBadHabit, savingsFor, type Savings,
} from '../services/badHabitService';
import type { BadHabitRow } from '../repositories/badHabitRepository';
import { EmblemMedallion, TexturedSurface } from './ui';
import { BAD_HABIT_SHIELD, TEXTURES } from '../lib/visualAssets';

/**
 * F04: the deflected-urge counter is a motivation number of ONE person. It lives under the user's
 * key; the old unscoped key is removed, never adopted (crediting it to whoever opens the app next
 * would show them someone else's reward).
 */
const URGE_STORAGE_KEY_PREFIX = 'aderyth.deflected_urges_count';
export const urgeStorageKey = (uid: string): string => `${URGE_STORAGE_KEY_PREFIX}:${uid}`;
registerAccountStorage({ name: 'badHabits.urges', transient: false, keysFor: (uid) => [urgeStorageKey(uid)] });

interface BadHabitsTrackerProps {
  visible: boolean;
  onClose: () => void;
}

export default function BadHabitsTracker({ visible, onClose }: BadHabitsTrackerProps) {
  const [badHabits, setBadHabits] = useState<BadHabitRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedHabit, setSelectedHabit] = useState<BadHabitRow | null>(null);
  const [savings, setSavings] = useState<Savings | null>(null);
  const [urgeShieldActive, setUrgeShieldActive] = useState(false);
  const [urgeSecondsLeft, setUrgeSecondsLeft] = useState(60);
  const [deflectedUrges, setDeflectedUrges] = useState(0);
  const [newHabit, setNewHabit] = useState({
    name: '',
    description: '',
    cost_per_day: '',
    time_wasted_per_day: '',
  });

  const loadBadHabits = async () => {
    setLoading(true);
    const res = await listBadHabits(null, 100);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setBadHabits(res.data.rows);
  };

  useEffect(() => {
    if (visible) {
      loadBadHabits();
      void (async () => {
        await AsyncStorage.removeItem(URGE_STORAGE_KEY_PREFIX);
        const uid = (await currentUser())?.id;
        if (!uid) { setDeflectedUrges(0); return; }
        const v = await AsyncStorage.getItem(urgeStorageKey(uid));
        setDeflectedUrges(v ? parseInt(v, 10) || 0 : 0);
      })().catch(() => undefined);
    }
  }, [visible]);

  useEffect(() => {
    if (!urgeShieldActive) return;
    if (urgeSecondsLeft <= 0) {
      haptic.success();
      const nextCount = deflectedUrges + 1;
      setDeflectedUrges(nextCount);
      void (async () => {
        const uid = (await currentUser())?.id;
        if (!uid) return;
        await AsyncStorage.setItem(urgeStorageKey(uid), String(nextCount));
      })().catch(() => undefined);
      return;
    }
    const timer = setTimeout(() => setUrgeSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [urgeShieldActive, urgeSecondsLeft, deflectedUrges]);

  const startUrgeShield = () => {
    haptic.medium();
    setUrgeSecondsLeft(60);
    setUrgeShieldActive(true);
  };

  const breathCycleSec = (60 - urgeSecondsLeft) % 14;
  const breathInstruction =
    breathCycleSec < 4
      ? 'Burnundan Derin Nefes Al (4 sn)…'
      : breathCycleSec < 8
        ? 'Nefesini Sakince Tut (4 sn)…'
        : 'Ağzından Yavaşça Ver (6 sn)…';

  const handleAddBadHabit = async () => {
    const name = newHabit.name.trim();
    if (!name) return;

    const res = await createBadHabit({
      name,
      description: newHabit.description.trim() || null,
      quitDate: new Date().toISOString(),
      costPerDay: parseFloat(newHabit.cost_per_day) || 0,
      timeWastedPerDay: parseInt(newHabit.time_wasted_per_day, 10) || 0,
    });
    if (!res.ok) {
      setError(res.error);
      return;
    }

    setShowAddModal(false);
    setNewHabit({ name: '', description: '', cost_per_day: '', time_wasted_per_day: '' });
    await loadBadHabits();
  };

  // Derived, not fetched. The endpoint this replaces was a round trip to
  // multiply two numbers by a day count -- and it returned a NEGATIVE saving
  // for a quit date in the future. See services/badHabitService.ts.
  const viewSavings = (habit: BadHabitRow) => {
    setSavings(savingsFor(habit));
    setSelectedHabit(habit);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={false}
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose}>
            <Ionicons name="close" size={28} color={colors.white} />
          </TouchableOpacity>
          <Text style={styles.title}>Bıraktığım Alışkanlıklar</Text>
          <TouchableOpacity onPress={() => setShowAddModal(true)}>
            <Ionicons name="add-circle" size={28} color={colors.accent} />
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-offline-outline" size={64} color={colors.error} />
            <Text style={styles.emptyText}>Liste yüklenemedi</Text>
            <Text style={styles.emptySubtext}>{error}</Text>
          </View>
        ) : loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={styles.loader} />
        ) : (
          <ScrollView style={styles.content}>
            {/* One Sec / Opal İlhamlı: 60 Saniye Dürtü Kalkanı (Urge Surfing) */}
            <View style={[styles.urgeBanner, { overflow: 'hidden', position: 'relative' }]}>
              <TexturedSurface source={TEXTURES.kintsugi} textureOpacity={0.06} overlayOnly />
              <EmblemMedallion
                source={BAD_HABIT_SHIELD}
                size={48}
                unlocked
                accentColor={colors.teal}
              />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="shield-checkmark" size={18} color={colors.teal} />
                  <Text style={styles.urgeBannerTitle}>60 Saniye Dürtü Kalkanı</Text>
                </View>
                <Text style={styles.urgeBannerSub}>
                  Bir dürtü geldiğinde otomatik davranışı 60 saniyelik nefes dalgasıyla kır.
                  {deflectedUrges > 0 ? ` · ${deflectedUrges} dürtü savuşturuldu ✨` : ''}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.urgeStartBtn}
                onPress={startUrgeShield}
                accessibilityRole="button"
                accessibilityLabel="Şu an zorlanıyorum, 60 saniye dürtü kalkanını başlat"
              >
                <Text style={styles.urgeStartBtnText}>Kalkanı Aç</Text>
              </TouchableOpacity>
            </View>

            {badHabits.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="ribbon-outline" size={64} color={colors.textGhost} />
                <Text style={styles.emptyText}>Henüz bıraktığınız alışkanlık yok</Text>
                <Text style={styles.emptySubtext}>Bıraktığınız kötü alışkanlıkları ekleyin!</Text>
              </View>
            ) : (
              badHabits.map((habit) => (
                <TouchableOpacity
                  key={habit.id}
                  style={styles.habitCard}
                  onPress={() => viewSavings(habit)}
                >
                  <View style={styles.habitIcon}>
                    <Ionicons name="ban" size={24} color={colors.error} />
                  </View>
                  <View style={styles.habitInfo}>
                    <Text style={styles.habitName}>{habit.name}</Text>
                    <Text style={styles.habitDate}>
                      Bırakma tarihi: {format(new Date(habit.quit_date), 'dd MMM yyyy', { locale: tr })}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color={colors.textFaint} />
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        )}

        {/* Add Modal */}
        <Modal
          visible={showAddModal}
          animationType="slide"
          transparent={true}
          onRequestClose={() => setShowAddModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>Yeni Kötü Alışkanlık</Text>
              
              <TextInput
                style={styles.input}
                placeholder="Alışkanlık adı (örn: Sigara)"
                placeholderTextColor={colors.textFaint}
                value={newHabit.name}
                onChangeText={(text) => setNewHabit({ ...newHabit, name: text })}
              />

              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Açıklama"
                placeholderTextColor={colors.textFaint}
                value={newHabit.description}
                onChangeText={(text) => setNewHabit({ ...newHabit, description: text })}
                multiline
              />

              <TextInput
                style={styles.input}
                placeholder="Günlük maliyet (₺)"
                placeholderTextColor={colors.textFaint}
                value={newHabit.cost_per_day}
                onChangeText={(text) => setNewHabit({ ...newHabit, cost_per_day: text })}
                keyboardType="numeric"
              />

              <TextInput
                style={styles.input}
                placeholder="Günlük kaybedilen zaman (dakika)"
                placeholderTextColor={colors.textFaint}
                value={newHabit.time_wasted_per_day}
                onChangeText={(text) => setNewHabit({ ...newHabit, time_wasted_per_day: text })}
                keyboardType="numeric"
              />

              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.cancelButton]}
                  onPress={() => setShowAddModal(false)}
                >
                  <Text style={styles.cancelButtonText}>İptal</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modalButton, styles.saveButton]}
                  onPress={handleAddBadHabit}
                >
                  <Text style={styles.saveButtonText}>Ekle</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        {/* Savings Modal */}
        {selectedHabit && savings && (
          <Modal
            visible={!!selectedHabit}
            animationType="slide"
            transparent={true}
            onRequestClose={() => {
              setSelectedHabit(null);
              setSavings(null);
            }}
          >
            <View style={styles.modalOverlay}>
              <View style={styles.savingsContent}>
                <View style={styles.savingsHeader}>
                  <Ionicons name="trophy" size={48} color={colors.success} />
                  <Text style={styles.savingsTitle}>{selectedHabit.name}</Text>
                  <Text style={styles.savingsSubtitle}>Tasarruf Raporu</Text>
                </View>

                <View style={styles.savingsStats}>
                  <View style={styles.savingsStatCard}>
                    <Ionicons name="calendar" size={32} color={colors.accent} />
                    <Text style={styles.savingsStatValue}>{savings.daysSinceQuit}</Text>
                    <Text style={styles.savingsStatLabel}>Gün</Text>
                  </View>

                  <View style={styles.savingsStatCard}>
                    <Ionicons name="cash" size={32} color={colors.success} />
                    <Text style={styles.savingsStatValue}>₺{savings.moneySaved}</Text>
                    <Text style={styles.savingsStatLabel}>Tasarruf</Text>
                  </View>

                  <View style={styles.savingsStatCard}>
                    <Ionicons name="time" size={32} color={colors.warning} />
                    <Text style={styles.savingsStatValue}>{savings.timeSavedHours}sa</Text>
                    <Text style={styles.savingsStatLabel}>Zaman</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.closeButton}
                  onPress={() => {
                    setSelectedHabit(null);
                    setSavings(null);
                  }}
                >
                  <Text style={styles.closeButtonText}>Kapat</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        )}

        {/* 60 Saniye Dürtü Kalkanı (Urge Surfing) Modalı */}
        <Modal
          visible={urgeShieldActive}
          animationType="fade"
          transparent={true}
          onRequestClose={() => setUrgeShieldActive(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.urgeModalCard}>
              <Ionicons
                name={urgeSecondsLeft === 0 ? 'checkmark-circle' : 'shield-half-outline'}
                size={52}
                color={urgeSecondsLeft === 0 ? colors.success : colors.teal}
              />
              <Text style={styles.urgeModalTitle}>
                {urgeSecondsLeft === 0 ? 'Dürtü Dalgası Geçti' : 'Dürtü Dalgasını Gözlemle'}
              </Text>
              <Text style={styles.urgeTimerText}>
                {urgeSecondsLeft === 0 ? 'Başardın!' : `${urgeSecondsLeft} sn`}
              </Text>
              <Text style={styles.urgeBreathText}>
                {urgeSecondsLeft === 0
                  ? `İradeni korudun. Toplam ${deflectedUrges} kez dürtü dalgasını savuşturdun.`
                  : breathInstruction}
              </Text>
              <Text style={styles.urgeScienceNote}>
                Nörobilim notu: Otomatik bir dürtü tepkisi 60–90 saniye ertelenirse prefrontal korteks kontrolü geri alır.
              </Text>
              <TouchableOpacity
                style={[styles.closeButton, { width: '100%', marginTop: 18 }]}
                onPress={() => setUrgeShieldActive(false)}
                accessibilityRole="button"
                accessibilityLabel="Kalkanı kapat"
              >
                <Text style={styles.closeButtonText}>
                  {urgeSecondsLeft === 0 ? 'Harika, Devam Et' : 'Sakinleştim, Kapat'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 50,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.white,
  },
  loader: {
    marginTop: 40,
  },
  content: {
    flex: 1,
    padding: 16,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: colors.white,
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.textFaint,
    marginTop: 8,
  },
  habitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  habitIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: alphaHex(colors.error, '20'),
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  habitInfo: {
    flex: 1,
  },
  habitName: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    marginBottom: 4,
  },
  habitDate: {
    fontSize: 13,
    color: colors.textDim,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.white,
    marginBottom: 20,
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: colors.white,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  modalButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  modalButton: {
    flex: 1,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  cancelButton: {
    backgroundColor: colors.textGhost,
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.white,
  },
  saveButton: {
    backgroundColor: colors.accent,
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.white,
  },
  savingsContent: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    padding: 24,
    width: '100%',
  },
  savingsHeader: {
    alignItems: 'center',
    marginBottom: 32,
  },
  savingsTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.white,
    marginTop: 16,
  },
  savingsSubtitle: {
    fontSize: 14,
    color: colors.textDim,
    marginTop: 4,
  },
  savingsStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  savingsStatCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  savingsStatValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.white,
    marginTop: 8,
  },
  savingsStatLabel: {
    fontSize: 12,
    color: colors.textDim,
    marginTop: 4,
  },
  closeButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.white,
  },
  urgeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: alphaHex(colors.teal, '45'),
  },
  urgeBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.white,
  },
  urgeBannerSub: {
    fontSize: 12,
    color: colors.textDim,
    marginTop: 4,
    lineHeight: 17,
  },
  urgeStartBtn: {
    backgroundColor: colors.teal,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
  },
  urgeStartBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.white,
  },
  urgeModalCard: {
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  urgeModalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.white,
    marginTop: 12,
  },
  urgeTimerText: {
    fontSize: 44,
    fontWeight: '800',
    color: colors.teal,
    marginVertical: 14,
    fontVariant: ['tabular-nums'],
  },
  urgeBreathText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.white,
    textAlign: 'center',
    marginBottom: 10,
  },
  urgeScienceNote: {
    fontSize: 12,
    color: colors.textFaint,
    textAlign: 'center',
    lineHeight: 17,
  },
});
