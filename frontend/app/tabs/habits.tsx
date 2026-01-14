import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useStore } from '../../store/useStore';
import { habitAPI, completionAPI } from '../../utils/api';
import { Habit } from '../../types';
import HabitOnboarding from '../../components/HabitOnboarding';

const CATEGORIES = [
  { id: 'health', label: 'Sağlık', icon: 'fitness-outline', color: '#10b981' },
  { id: 'work', label: 'İş', icon: 'briefcase-outline', color: '#3b82f6' },
  { id: 'learning', label: 'Öğrenme', icon: 'book-outline', color: '#8b5cf6' },
  { id: 'personal', label: 'Kişisel', icon: 'person-outline', color: '#f59e0b' },
  { id: 'general', label: 'Genel', icon: 'star-outline', color: '#6366f1' },
];

export default function HabitsScreen() {
  const { habits, setHabits } = useStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [queueStatus, setQueueStatus] = useState<any>(null);

  useEffect(() => {
    loadHabits();
  }, []);

  const loadHabits = async () => {
    try {
      setLoading(true);
      const [habitsData, queueData] = await Promise.all([
        habitAPI.getAll(),
        habitAPI.getQueueStatus(),
      ]);
      setHabits(habitsData);
      setQueueStatus(queueData);
    } catch (error) {
      console.error('Alışkanlıklar yüklenirken hata:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadHabits();
    setRefreshing(false);
  };

  const handleComplete = async (habit: Habit) => {
    try {
      if (!habit._id) return;
      await completionAPI.create({ habit_id: habit._id });
      await loadHabits();
      
      // Check if habit reached 80%
      const updatedHabit = await habitAPI.getById(habit._id);
      if (updatedHabit.strength_score >= 80 && queueStatus?.queued_count > 0) {
        Alert.alert(
          '🎉 Tebrikler!',
          `'${habit.name}' alışkanlığın %${Math.round(updatedHabit.strength_score)} gücünde! Artık yeni bir alışkanlık ekleyebilirsin.`,
          [{ text: 'Harika!' }]
        );
      }
    } catch (error) {
      console.error('Alışkanlık tamamlanırken hata:', error);
    }
  };

  const handleActivate = async (habitId: string) => {
    try {
      const result = await habitAPI.activate(habitId);
      if (result.status === 'blocked') {
        Alert.alert(
          'İrade Limitine Ulaştın',
          result.message,
          [
            { text: 'Tamam', style: 'cancel' },
            {
              text: 'Sıraya Al',
              onPress: async () => {
                if (result.suggested_habit_id) {
                  await habitAPI.pause(result.suggested_habit_id);
                  await habitAPI.activate(habitId);
                  await loadHabits();
                }
              },
            },
          ]
        );
      } else {
        await loadHabits();
      }
    } catch (error: any) {
      Alert.alert('Hata', error.response?.data?.detail || 'Bir hata oluştu');
    }
  };

  const handlePause = async (habitId: string) => {
    try {
      await habitAPI.pause(habitId);
      await loadHabits();
    } catch (error) {
      console.error('Alışkanlık duraklatılırken hata:', error);
    }
  };

  const handleAddHabit = async (habitData: any) => {
    try {
      await habitAPI.create(habitData);
      setShowOnboarding(false);
      await loadHabits();
      
      // Show info if queued
      if (queueStatus?.active_count >= 3) {
        Alert.alert(
          '📋 Kuyruğa Alındı',
          'İraden sınırlı bir kaynak! Analizimize göre bu alışkanlığı şimdilik kuyruğa aldık. Aktif alışkanlıklarından biri %80\'e ulaştığında otomatik aktifleşecek.',
          [{ text: 'Anladım' }]
        );
      }
    } catch (error) {
      console.error('Alışkanlık eklenirken hata:', error);
    }
  };

  const getWillpowerColor = (load: number) => {
    if (load <= 5) return '#10b981'; // Yeşil
    if (load <= 9) return '#84cc16'; // Açık yeşil
    if (load <= 11) return '#f59e0b'; // Sarı
    return '#ef4444'; // Kırmızı
  };

  const getStrengthColor = (score: number) => {
    if (score >= 80) return '#10b981';
    if (score >= 50) return '#f59e0b';
    return '#6b7280';
  };

  const getPriorityBadge = (priority: string) => {
    const badges: any = {
      urgent_important: { icon: '🔥', color: '#ef4444', label: 'Kritik' },
      important_not_urgent: { icon: '⭐', color: '#6366f1', label: 'Önemli' },
      urgent_not_important: { icon: '⚡', color: '#f59e0b', label: 'Hızlı' },
      neither: { icon: '📋', color: '#6b7280', label: 'Sonra' },
    };
    return badges[priority] || badges.neither;
  };

  const renderHabitCard = (habit: Habit, isQueued: boolean = false) => {
    const category = CATEGORIES.find(c => c.id === habit.category) || CATEGORIES[4];
    const priorityBadge = getPriorityBadge(habit.priority);
    
    return (
      <View key={habit._id} style={[styles.habitCard, isQueued && styles.habitCardQueued]}>
        {isQueued && habit.focus_score && (
          <View style={styles.focusScoreBadge}>
            <Text style={styles.focusScoreBadgeText}>{habit.focus_score.toFixed(1)}</Text>
          </View>
        )}
        <View style={styles.habitHeader}>
          <View style={styles.habitLeft}>
            <View style={[styles.iconContainer, { backgroundColor: category.color + '20' }]}>
              <Ionicons name={category.icon as any} size={24} color={category.color} />
            </View>
            <View style={styles.habitInfo}>
              <View style={styles.habitNameRow}>
                <Text style={styles.habitName}>{habit.name}</Text>
                <View style={[styles.priorityBadge, { backgroundColor: priorityBadge.color + '20' }]}>
                  <Text style={styles.priorityIcon}>{priorityBadge.icon}</Text>
                </View>
              </View>
              <Text style={styles.habitCategory}>{category.label}</Text>
            </View>
          </View>
          
          {!isQueued ? (
            <TouchableOpacity style={styles.completeButton} onPress={() => handleComplete(habit)}>
              <Ionicons name="checkmark-circle" size={32} color="#6366f1" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.activateButton} onPress={() => handleActivate(habit._id!)}>
              <Ionicons name="play-circle" size={28} color="#10b981" />
            </TouchableOpacity>
          )}
        </View>

        <View style={styles.habitStats}>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{habit.streak_current}</Text>
            <Text style={styles.statLabel}>Seri</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: getStrengthColor(habit.strength_score) }]}>
              {Math.round(habit.strength_score)}
            </Text>
            <Text style={styles.statLabel}>Güç</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statValue}>{habit.focus_score?.toFixed(1) || '0.0'}</Text>
            <Text style={styles.statLabel}>Odak</Text>
          </View>
        </View>

        <View style={styles.strengthBar}>
          <View 
            style={[
              styles.strengthFill,
              { 
                width: `${habit.strength_score}%`,
                backgroundColor: getStrengthColor(habit.strength_score)
              }
            ]}
          />
        </View>

        {!isQueued && (
          <TouchableOpacity 
            style={styles.pauseButton}
            onPress={() => handlePause(habit._id!)}
          >
            <Ionicons name="pause" size={16} color="#9ca3af" />
            <Text style={styles.pauseButtonText}>Sıraya Al</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#6366f1" />
      </View>
    );
  }

  const activeHabits = habits.filter(h => h.status === 'active');
  const queuedHabits = habits.filter(h => h.status === 'queued');

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Willpower Status */}
      {queueStatus && (
        <View style={[styles.statusBar, { backgroundColor: getWillpowerColor(queueStatus.willpower_load) + '20' }]}>
          <View style={styles.statusLeft}>
            <Ionicons name="flash" size={20} color={getWillpowerColor(queueStatus.willpower_load)} />
            <Text style={[styles.statusText, { color: getWillpowerColor(queueStatus.willpower_load) }]}>
              İrade Yükü: {queueStatus.willpower_load}/15
            </Text>
          </View>
          <Text style={styles.statusSlots}>{activeHabits.length}/3 Aktif</Text>
        </View>
      )}

      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#6366f1" />
        }
      >
        {/* Active Habits */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Ionicons name="rocket" size={20} color="#10b981" />
            <Text style={styles.sectionTitle}>Aktif Odak</Text>
          </View>
          {activeHabits.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Henüz aktif alışkanlık yok</Text>
            </View>
          ) : (
            activeHabits.map(habit => renderHabitCard(habit, false))
          )}
        </View>

        {/* Queued Habits */}
        {queuedHabits.length > 0 && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Ionicons name="hourglass" size={20} color="#9ca3af" />
              <Text style={styles.sectionTitle}>Bekleme Odası</Text>
            </View>
            <Text style={styles.queueInfo}>
              {queueStatus?.recommendation}
            </Text>
            {queuedHabits.map(habit => renderHabitCard(habit, true))}
          </View>
        )}
      </ScrollView>

      {/* Add Button */}
      <TouchableOpacity style={styles.fab} onPress={() => setShowOnboarding(true)}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Onboarding Modal */}
      <HabitOnboarding
        visible={showOnboarding}
        onClose={() => setShowOnboarding(false)}
        onSubmit={handleAddHabit}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0c0c0c' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0c0c0c' },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  statusLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  statusSlots: { fontSize: 14, color: '#6366f1', fontWeight: '600' },
  scrollView: { flex: 1 },
  section: { padding: 16 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  queueInfo: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 16,
    fontStyle: 'italic',
  },
  habitCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  habitCardQueued: { opacity: 0.7 },
  habitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  habitLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  habitInfo: { flex: 1 },
  habitNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  habitName: { fontSize: 18, fontWeight: '600', color: '#fff', flex: 1 },
  habitCategory: { fontSize: 13, color: '#9ca3af' },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  priorityIcon: { fontSize: 14 },
  completeButton: { padding: 4 },
  activateButton: { padding: 4 },
  habitStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statBox: { alignItems: 'center' },
  statValue: { fontSize: 24, fontWeight: 'bold', color: '#6366f1' },
  statLabel: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  strengthBar: {
    height: 6,
    backgroundColor: '#2a2a2a',
    borderRadius: 3,
    overflow: 'hidden',
    marginBottom: 12,
  },
  strengthFill: { height: '100%', borderRadius: 3 },
  pauseButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  pauseButtonText: { fontSize: 13, color: '#9ca3af' },
  emptyState: { alignItems: 'center', paddingVertical: 40 },
  emptyText: { fontSize: 16, color: '#6b7280' },
  fab: {
    position: 'absolute',
    right: 16,
    bottom: Platform.OS === 'ios' ? 100 : 80,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#6366f1',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
});
