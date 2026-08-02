import React, { useEffect, useState } from 'react';
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
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { tr } from 'date-fns/locale';
import { badHabitAPI } from '../utils/api';
import { BadHabit } from '../types';

interface BadHabitsTrackerProps {
  visible: boolean;
  onClose: () => void;
}

export default function BadHabitsTracker({ visible, onClose }: BadHabitsTrackerProps) {
  const [badHabits, setBadHabits] = useState<BadHabit[]>([]);
  const [loading, setLoading] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedHabit, setSelectedHabit] = useState<BadHabit | null>(null);
  const [savings, setSavings] = useState<any>(null);
  const [newHabit, setNewHabit] = useState({
    name: '',
    description: '',
    cost_per_day: '',
    time_wasted_per_day: '',
  });

  useEffect(() => {
    if (visible) {
      loadBadHabits();
    }
  }, [visible]);

  const loadBadHabits = async () => {
    try {
      setLoading(true);
      const data = await badHabitAPI.getAll();
      setBadHabits(data);
    } catch (error) {
      console.error('Kötü alışkanlıklar yüklenirken hata:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddBadHabit = async () => {
    try {
      if (!newHabit.name.trim()) return;

      await badHabitAPI.create({
        name: newHabit.name,
        description: newHabit.description,
        quit_date: new Date().toISOString(),
        cost_per_day: parseFloat(newHabit.cost_per_day) || 0,
        time_wasted_per_day: parseInt(newHabit.time_wasted_per_day) || 0,
      });

      setShowAddModal(false);
      setNewHabit({ name: '', description: '', cost_per_day: '', time_wasted_per_day: '' });
      await loadBadHabits();
    } catch (error) {
      console.error('Kötü alışkanlık eklenirken hata:', error);
    }
  };

  const viewSavings = async (habit: BadHabit) => {
    try {
      if (!habit._id) return;
      const data = await badHabitAPI.getSavings(habit._id);
      setSavings(data);
      setSelectedHabit(habit);
    } catch (error) {
      console.error('Tasarruf hesaplanırken hata:', error);
    }
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
            <Ionicons name="close" size={28} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.title}>Bıraktığım Alışkanlıklar</Text>
          <TouchableOpacity onPress={() => setShowAddModal(true)}>
            <Ionicons name="add-circle" size={28} color="#D97757" />
          </TouchableOpacity>
        </View>

        {loading ? (
          <ActivityIndicator size="large" color="#D97757" style={styles.loader} />
        ) : (
          <ScrollView style={styles.content}>
            {badHabits.length === 0 ? (
              <View style={styles.emptyState}>
                <Ionicons name="ribbon-outline" size={64} color="#56544B" />
                <Text style={styles.emptyText}>Henüz bıraktığınız alışkanlık yok</Text>
                <Text style={styles.emptySubtext}>Bıraktığınız kötü alışkanlıkları ekleyin!</Text>
              </View>
            ) : (
              badHabits.map((habit) => (
                <TouchableOpacity
                  key={habit._id}
                  style={styles.habitCard}
                  onPress={() => viewSavings(habit)}
                >
                  <View style={styles.habitIcon}>
                    <Ionicons name="ban" size={24} color="#C76A6A" />
                  </View>
                  <View style={styles.habitInfo}>
                    <Text style={styles.habitName}>{habit.name}</Text>
                    <Text style={styles.habitDate}>
                      Bırakma tarihi: {format(new Date(habit.quit_date), 'dd MMM yyyy', { locale: tr })}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={20} color="#827E72" />
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
                placeholderTextColor="#827E72"
                value={newHabit.name}
                onChangeText={(text) => setNewHabit({ ...newHabit, name: text })}
              />

              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Açıklama"
                placeholderTextColor="#827E72"
                value={newHabit.description}
                onChangeText={(text) => setNewHabit({ ...newHabit, description: text })}
                multiline
              />

              <TextInput
                style={styles.input}
                placeholder="Günlük maliyet (₺)"
                placeholderTextColor="#827E72"
                value={newHabit.cost_per_day}
                onChangeText={(text) => setNewHabit({ ...newHabit, cost_per_day: text })}
                keyboardType="numeric"
              />

              <TextInput
                style={styles.input}
                placeholder="Günlük kaybedilen zaman (dakika)"
                placeholderTextColor="#827E72"
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
                  <Ionicons name="trophy" size={48} color="#87A678" />
                  <Text style={styles.savingsTitle}>{selectedHabit.name}</Text>
                  <Text style={styles.savingsSubtitle}>Tasarruf Raporu</Text>
                </View>

                <View style={styles.savingsStats}>
                  <View style={styles.savingsStatCard}>
                    <Ionicons name="calendar" size={32} color="#D97757" />
                    <Text style={styles.savingsStatValue}>{savings.days_since_quit}</Text>
                    <Text style={styles.savingsStatLabel}>Gün</Text>
                  </View>

                  <View style={styles.savingsStatCard}>
                    <Ionicons name="cash" size={32} color="#87A678" />
                    <Text style={styles.savingsStatValue}>₺{savings.money_saved}</Text>
                    <Text style={styles.savingsStatLabel}>Tasarruf</Text>
                  </View>

                  <View style={styles.savingsStatCard}>
                    <Ionicons name="time" size={32} color="#D4A84A" />
                    <Text style={styles.savingsStatValue}>{savings.time_saved_hours}sa</Text>
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
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#15140F',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    paddingTop: 50,
    backgroundColor: '#1D1C17',
    borderBottomWidth: 1,
    borderBottomColor: '#28261F',
  },
  title: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
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
    color: '#fff',
    marginTop: 16,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#827E72',
    marginTop: 8,
  },
  habitCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#383528',
  },
  habitIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#C76A6A20',
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
    color: '#fff',
    marginBottom: 4,
  },
  habitDate: {
    fontSize: 13,
    color: '#BFBBAE',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#1D1C17',
    borderRadius: 16,
    padding: 24,
    width: '100%',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  input: {
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    color: '#fff',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#383528',
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
    backgroundColor: '#56544B',
  },
  cancelButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  saveButton: {
    backgroundColor: '#D97757',
  },
  saveButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  savingsContent: {
    backgroundColor: '#1D1C17',
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
    color: '#fff',
    marginTop: 16,
  },
  savingsSubtitle: {
    fontSize: 14,
    color: '#BFBBAE',
    marginTop: 4,
  },
  savingsStats: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  savingsStatCard: {
    flex: 1,
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#383528',
  },
  savingsStatValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 8,
  },
  savingsStatLabel: {
    fontSize: 12,
    color: '#BFBBAE',
    marginTop: 4,
  },
  closeButton: {
    backgroundColor: '#D97757',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  closeButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
});
