import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { Task } from '../store/taskStore';
import { insertSplitTasks } from '../repositories/taskRepository';

interface ADHDTaskSplitterProps {
  task: Task;
  visible: boolean;
  onClose: () => void;
  onSplit: (subtasks: Task[]) => void;
}

const SPLIT_LABELS: Record<number, string[]> = {
  15: ['Başlangıç', 'Devam', 'Bitiş'],
  25: ['1. Pomodoro', '2. Pomodoro', '3. Pomodoro'],
  45: ['Hazırlık & Araştırma', 'Ana Çalışma', 'Gözden Geçirme'],
};

export default function ADHDTaskSplitter({
  task,
  visible,
  onClose,
  onSplit,
}: ADHDTaskSplitterProps) {
  const [loading, setLoading] = useState(false);
  const [subtasks, setSubtasks] = useState<Task[]>([]);

  const handleSplit = async (minutes: number) => {
    try {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const labels = SPLIT_LABELS[minutes] ?? ['Parça 1', 'Parça 2', 'Parça 3'];
      const rows = labels.map((label, i) => ({
        title: `${task.title} — ${label}`,
        description: `${minutes} dk blok (${i + 1}/${labels.length})`,
        status: 'pending' as const,
        priority: task.priority,
        due_date: task.due_date ?? null,
        project_id: task.project_id ?? null,
        list_type: task.list_type,
        completed: false,
      }));

      // Repository devralır: supabase.tasks tablosuna insert eder (bkz. repositories/taskRepository.ts).
      const res = await insertSplitTasks(rows);
      if (!res.ok) throw new Error(res.error);

      setSubtasks(res.data);
      onSplit(res.data);
    } catch (error) {
      console.error('Görev bölünürken hata:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setSubtasks([]);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <View style={styles.content}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="flash" size={24} color="#D4A84A" />
              <Text style={styles.title}>ADHD Modu</Text>
            </View>
            <TouchableOpacity onPress={handleClose}>
              <Ionicons name="close" size={28} color="#BFBBAE" />
            </TouchableOpacity>
          </View>

          <Text style={styles.description}>
            Büyük görevinizi daha küçük, yönetilebilir parçalara bölelim!
          </Text>

          <View style={styles.taskCard}>
            <Text style={styles.taskTitle}>{task.title}</Text>
            {task.description && (
              <Text style={styles.taskDescription}>{task.description}</Text>
            )}
          </View>

          {subtasks.length === 0 ? (
            <View style={styles.options}>
              <Text style={styles.optionsTitle}>Odaklanma süresi seçin:</Text>

              <TouchableOpacity
                style={styles.optionButton}
                onPress={() => handleSplit(15)}
                disabled={loading}
              >
                <Ionicons name="timer-outline" size={24} color="#87A678" />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Kısa Sprint</Text>
                  <Text style={styles.optionSubtitle}>15 dakikalık bloklara böl</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.optionButton}
                onPress={() => handleSplit(25)}
                disabled={loading}
              >
                <Ionicons name="time-outline" size={24} color="#D97757" />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Pomodoro</Text>
                  <Text style={styles.optionSubtitle}>25 dakikalık bloklara böl</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.optionButton}
                onPress={() => handleSplit(45)}
                disabled={loading}
              >
                <Ionicons name="hourglass-outline" size={24} color="#8b5cf6" />
                <View style={styles.optionText}>
                  <Text style={styles.optionTitle}>Derin Odaklanma</Text>
                  <Text style={styles.optionSubtitle}>45 dakikalık bloklara böl</Text>
                </View>
              </TouchableOpacity>

              {loading && (
                <ActivityIndicator size="large" color="#D97757" style={styles.loader} />
              )}
            </View>
          ) : (
            <View style={styles.subtasks}>
              <Text style={styles.subtasksTitle}>Görev başarıyla bölündü! 🎯</Text>
              <ScrollView style={styles.subtasksList}>
                {subtasks.map((subtask, index) => (
                  <View key={subtask.id} style={styles.subtaskCard}>
                    <View style={styles.subtaskNumber}>
                      <Text style={styles.subtaskNumberText}>{index + 1}</Text>
                    </View>
                    <Text style={styles.subtaskTitle}>{subtask.title}</Text>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.doneButton} onPress={handleClose}>
                <Text style={styles.doneButtonText}>Tamam</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'flex-end',
  },
  content: {
    backgroundColor: '#1D1C17',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    minHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  description: {
    fontSize: 15,
    color: '#BFBBAE',
    marginBottom: 20,
    lineHeight: 22,
  },
  taskCard: {
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#383528',
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  taskDescription: {
    fontSize: 14,
    color: '#BFBBAE',
  },
  options: {
    gap: 12,
  },
  optionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 8,
  },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 16,
    gap: 16,
    borderWidth: 1,
    borderColor: '#383528',
  },
  optionText: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  optionSubtitle: {
    fontSize: 13,
    color: '#BFBBAE',
  },
  loader: {
    marginTop: 20,
  },
  subtasks: {
    flex: 1,
  },
  subtasksTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#87A678',
    marginBottom: 16,
    textAlign: 'center',
  },
  subtasksList: {
    maxHeight: 300,
  },
  subtaskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1D1C17',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    gap: 12,
    borderWidth: 1,
    borderColor: '#383528',
  },
  subtaskNumber: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#D97757',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtaskNumberText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtaskTitle: {
    fontSize: 15,
    color: '#fff',
    flex: 1,
  },
  doneButton: {
    backgroundColor: '#D97757',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    marginTop: 20,
  },
  doneButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
});
