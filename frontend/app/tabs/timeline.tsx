import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, addDays, startOfWeek } from 'date-fns';
import { tr } from 'date-fns/locale';
import { useStore } from '../../store/useStore';
import { taskAPI, statsAPI } from '../../utils/api';
import { Task } from '../../types';
import ADHDTaskSplitter from '../../components/ADHDTaskSplitter';

export default function TimelineScreen() {
  const { tasks, setTasks, selectedDate, setSelectedDate, stats, setStats } = useStore();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [showADHDSplitter, setShowADHDSplitter] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedDate]);

  const loadData = async () => {
    try {
      setLoading(true);
      const dateStr = format(selectedDate, 'yyyy-MM-dd');
      const [tasksData, statsData] = await Promise.all([
        taskAPI.getAll(dateStr),
        statsAPI.get(),
      ]);
      setTasks(tasksData);
      setStats(statsData);
    } catch (error) {
      console.error('Veri yüklenirken hata:', error);
    } finally {
      setLoading(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const toggleTaskComplete = async (task: Task) => {
    try {
      if (!task._id) return;
      await taskAPI.update(task._id, { completed: !task.completed });
      await loadData();
    } catch (error) {
      console.error('Görev güncellenirken hata:', error);
    }
  };

  const renderWeekCalendar = () => {
    const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
    const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

    return (
      <View style={styles.weekCalendar}>
        {days.map((day, index) => {
          const isSelected = format(day, 'yyyy-MM-dd') === format(selectedDate, 'yyyy-MM-dd');
          const isToday = format(day, 'yyyy-MM-dd') === format(new Date(), 'yyyy-MM-dd');
          
          return (
            <TouchableOpacity
              key={index}
              style={[
                styles.dayItem,
                isSelected && styles.dayItemSelected,
                isToday && !isSelected && styles.dayItemToday,
              ]}
              onPress={() => setSelectedDate(day)}
            >
              <Text style={[styles.dayName, isSelected && styles.dayNameSelected]}>
                {format(day, 'EEE', { locale: tr })}
              </Text>
              <Text style={[styles.dayNumber, isSelected && styles.dayNumberSelected]}>
                {format(day, 'd')}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderTask = (task: Task) => {
    const timeRange = task.time_block_start && task.time_block_end
      ? `${task.time_block_start} - ${task.time_block_end}`
      : 'Zaman belirtilmemiş';

    return (
      <TouchableOpacity
        key={task._id}
        style={styles.taskCard}
        onPress={() => toggleTaskComplete(task)}
        onLongPress={() => {
          setSelectedTask(task);
          setShowADHDSplitter(true);
        }}
      >
        <View style={styles.taskLeft}>
          <View style={[
            styles.taskCheckbox,
            task.completed && styles.taskCheckboxCompleted
          ]}>
            {task.completed && (
              <Ionicons name="checkmark" size={18} color="#fff" />
            )}
          </View>
          <View style={styles.taskInfo}>
            <Text style={[
              styles.taskTitle,
              task.completed && styles.taskTitleCompleted
            ]}>
              {task.title}
            </Text>
            <Text style={styles.taskTime}>{timeRange}</Text>
            {task.description && (
              <Text style={styles.taskDescription}>{task.description}</Text>
            )}
          </View>
        </View>
        <View style={styles.taskRight}>
          {!task.is_subtask && (
            <TouchableOpacity
              onPress={() => {
                setSelectedTask(task);
                setShowADHDSplitter(true);
              }}
              style={styles.adhdButton}
            >
              <Ionicons name="flash" size={16} color="#f59e0b" />
            </TouchableOpacity>
          )}
          <Ionicons name="chevron-forward" size={20} color="#6b7280" />
        </View>
      </TouchableOpacity>
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
      {/* Stats Header */}
      <View style={styles.header}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats?.today_completions || 0}</Text>
          <Text style={styles.statLabel}>Bugün</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats?.active_tasks || 0}</Text>
          <Text style={styles.statLabel}>Aktif</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{stats?.completed_tasks || 0}</Text>
          <Text style={styles.statLabel}>Tamamlanan</Text>
        </View>
      </View>

      {/* Week Calendar */}
      {renderWeekCalendar()}

      {/* Tasks List */}
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
        <View style={styles.tasksContainer}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {format(selectedDate, 'dd MMMM yyyy', { locale: tr })}
            </Text>
            <Text style={styles.taskCount}>{tasks.length} görev</Text>
          </View>

          {tasks.length === 0 ? (
            <View style={styles.emptyState}>
              <Ionicons name="calendar-outline" size={64} color="#374151" />
              <Text style={styles.emptyText}>Bugün için görev yok</Text>
              <Text style={styles.emptySubtext}>Hemen bir görev ekleyin!</Text>
            </View>
          ) : (
            tasks.map(renderTask)
          )}
        </View>
      </ScrollView>

      {/* Add Task Button */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => setShowAddTask(true)}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>

      {/* ADHD Task Splitter Modal */}
      {selectedTask && (
        <ADHDTaskSplitter
          task={selectedTask}
          visible={showADHDSplitter}
          onClose={() => {
            setShowADHDSplitter(false);
            setSelectedTask(null);
          }}
          onSplit={async (subtasks) => {
            setShowADHDSplitter(false);
            setSelectedTask(null);
            await loadData();
          }}
        />
      )}
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: '#0f0f0f',
    borderBottomWidth: 1,
    borderBottomColor: '#1f1f1f',
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#6366f1',
  },
  statLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 4,
  },
  weekCalendar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: '#0f0f0f',
  },
  dayItem: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 44,
    height: 64,
    borderRadius: 12,
  },
  dayItemSelected: {
    backgroundColor: '#6366f1',
  },
  dayItemToday: {
    borderWidth: 1,
    borderColor: '#6366f1',
  },
  dayName: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 4,
  },
  dayNameSelected: {
    color: '#fff',
  },
  dayNumber: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
  dayNumberSelected: {
    color: '#fff',
  },
  scrollView: {
    flex: 1,
  },
  tasksContainer: {
    padding: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  taskCount: {
    fontSize: 14,
    color: '#9ca3af',
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  taskLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  taskCheckbox: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: '#6366f1',
    marginRight: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskCheckboxCompleted: {
    backgroundColor: '#6366f1',
  },
  taskInfo: {
    flex: 1,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  taskTitleCompleted: {
    textDecorationLine: 'line-through',
    color: '#6b7280',
  },
  taskTime: {
    fontSize: 13,
    color: '#9ca3af',
  },
  taskDescription: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
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
});
