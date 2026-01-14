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
  const { habits, setHabits, addHabit } = useStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newHabit, setNewHabit] = useState({
    name: '',
    description: '',
    category: 'general',
    color: '#6366f1',
  });

  useEffect(() => {
    loadHabits();
  }, []);

  const loadHabits = async () => {
    try {
      setLoading(true);
      const data = await habitAPI.getAll();
      setHabits(data);
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
      await completionAPI.create({
        habit_id: habit._id,
      });
      await loadHabits();
    } catch (error) {
      console.error('Alışkanlık tamamlanırken hata:', error);
    }
  };

  const handleAddHabit = async () => {
    try {
      if (!newHabit.name.trim()) return;
      
      const created = await habitAPI.create(newHabit);
      addHabit(created);
      setShowAddModal(false);
      setNewHabit({
        name: '',
        description: '',
        category: 'general',
        color: '#6366f1',
      });
    } catch (error) {
      console.error('Alışkanlık eklenirken hata:', error);
    }
  };

  const getStrengthColor = (score: number) => {
    if (score >= 80) return '#10b981';
    if (score >= 50) return '#f59e0b';
    return '#6b7280';
  };

  const renderHabitCard = (habit: Habit) => {
    const category = CATEGORIES.find(c => c.id === habit.category) || CATEGORIES[4];
    
    return (
      <View key={habit._id} style={styles.habitCard}>
        <View style={styles.habitHeader}>
          <View style={styles.habitLeft}>
            <View style={[styles.iconContainer, { backgroundColor: category.color + '20' }]}>
              <Ionicons name={category.icon as any} size={24} color={category.color} />
            </View>
            <View style={styles.habitInfo}>
              <Text style={styles.habitName}>{habit.name}</Text>
              <Text style={styles.habitCategory}>{category.label}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.completeButton}
            onPress={() => handleComplete(habit)}
          >
            <Ionicons name="checkmark-circle" size={32} color="#6366f1" />
          </TouchableOpacity>
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
            <Text style={styles.statValue}>{habit.streak_best}</Text>
            <Text style={styles.statLabel}>Rekor</Text>
          </View>
        </View>

        {/* Strength Bar */}
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

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ScrollView
        style={styles.scrollView}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#6366f1"
          />
        }
      >
        <View style={styles.content}>
          <Text style={styles.title}>Alışkanlıklarım</Text>
          <Text style={styles.subtitle}>{habits.length} aktif alışkanlık</Text>

          {habits.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="trophy-outline" size={64} color="#374151" />
              <Text style={styles.emptyText}>Henüz alışkanlık yok</Text>
              <Text style={styles.emptySubtext}>Yeni bir alışkanlık ekleyerek başlayın!</Text>
            </View>
          ) : (
            habits.map(renderHabitCard)
          )}
        </View>
      </ScrollView>

      {/* Add Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowAddModal(true)}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* Add Habit Modal */}
      <Modal
        visible={showAddModal}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setShowAddModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Yeni Alışkanlık</Text>
              <TouchableOpacity onPress={() => setShowAddModal(false)}>
                <Ionicons name="close" size={28} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <TextInput
              style={styles.input}
              placeholder="Alışkanlık adı"
              placeholderTextColor="#6b7280"
              value={newHabit.name}
              onChangeText={(text) => setNewHabit({ ...newHabit, name: text })}
            />

            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Açıklama (opsiyonel)"
              placeholderTextColor="#6b7280"
              value={newHabit.description}
              onChangeText={(text) => setNewHabit({ ...newHabit, description: text })}
              multiline
              numberOfLines={3}
            />

            <Text style={styles.label}>Kategori</Text>
            <View style={styles.categoryGrid}>
              {CATEGORIES.map((cat) => (
                <TouchableOpacity
                  key={cat.id}
                  style={[
                    styles.categoryItem,
                    newHabit.category === cat.id && styles.categoryItemSelected,
                    { borderColor: cat.color }
                  ]}
                  onPress={() => setNewHabit({ ...newHabit, category: cat.id, color: cat.color })}
                >
                  <Ionicons name={cat.icon as any} size={24} color={cat.color} />
                  <Text style={styles.categoryLabel}>{cat.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              style={styles.addButton}
              onPress={handleAddHabit}
            >
              <Text style={styles.addButtonText}>Alışkanlık Ekle</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0c0c0c',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#0c0c0c',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: '#9ca3af',
    marginBottom: 24,
  },
  habitCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  habitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  habitLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  habitInfo: {
    flex: 1,
  },
  habitName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  habitCategory: {
    fontSize: 13,
    color: '#9ca3af',
  },
  completeButton: {
    padding: 4,
  },
  habitStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 16,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#6366f1',
  },
  statLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  strengthBar: {
    height: 6,
    backgroundColor: '#2a2a2a',
    borderRadius: 3,
    overflow: 'hidden',
  },
  strengthFill: {
    height: '100%',
    borderRadius: 3,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 80,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#6b7280',
    marginTop: 8,
  },
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
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#1a1a1a',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: '70%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 24,
  },
  modalTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  input: {
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  textArea: {
    height: 80,
    textAlignVertical: 'top',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  categoryItem: {
    width: '30%',
    aspectRatio: 1,
    backgroundColor: '#0f0f0f',
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryItemSelected: {
    borderWidth: 3,
  },
  categoryLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 8,
  },
  addButton: {
    backgroundColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  addButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
});
