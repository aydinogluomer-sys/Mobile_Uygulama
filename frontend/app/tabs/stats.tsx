import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Dimensions,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, subDays, startOfYear } from 'date-fns';
import { tr } from 'date-fns/locale';
import { completionAPI, statsAPI } from '../../utils/api';
import { HeatmapData, Stats } from '../../types';

const { width } = Dimensions.get('window');
const CELL_SIZE = (width - 48) / 53; // 52 weeks + padding
const CELL_GAP = 3;

export default function StatsScreen() {
  const [loading, setLoading] = useState(true);
  const [heatmapData, setHeatmapData] = useState<HeatmapData>({});
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [heatmap, statsData] = await Promise.all([
        completionAPI.getHeatmap(),
        statsAPI.get(),
      ]);
      setHeatmapData(heatmap);
      setStats(statsData);
    } catch (error) {
      console.error('İstatistikler yüklenirken hata:', error);
    } finally {
      setLoading(false);
    }
  };

  const getIntensityColor = (count: number) => {
    if (count === 0) return '#1a1a1a';
    if (count === 1) return '#0e4429';
    if (count === 2) return '#006d32';
    if (count === 3) return '#26a641';
    return '#39d353';
  };

  const renderHeatmap = () => {
    const today = new Date();
    const startDate = subDays(today, 364); // Last 365 days
    const weeks: Date[][] = [];
    
    // Group days by week
    let currentWeek: Date[] = [];
    for (let i = 0; i < 365; i++) {
      const date = subDays(today, 364 - i);
      const dayOfWeek = date.getDay();
      
      if (dayOfWeek === 0 && currentWeek.length > 0) {
        weeks.push(currentWeek);
        currentWeek = [];
      }
      currentWeek.push(date);
    }
    if (currentWeek.length > 0) {
      weeks.push(currentWeek);
    }

    return (
      <View style={styles.heatmapContainer}>
        <Text style={styles.heatmapTitle}>Yıllık Aktivite</Text>
        <Text style={styles.heatmapSubtitle}>Son 365 gününüz</Text>
        
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.heatmap}>
            {weeks.map((week, weekIndex) => (
              <View key={weekIndex} style={styles.heatmapWeek}>
                {week.map((day, dayIndex) => {
                  const dateKey = format(day, 'yyyy-MM-dd');
                  const count = heatmapData[dateKey] || 0;
                  
                  return (
                    <View
                      key={dayIndex}
                      style={[
                        styles.heatmapCell,
                        {
                          backgroundColor: getIntensityColor(count),
                          width: CELL_SIZE,
                          height: CELL_SIZE,
                          marginBottom: CELL_GAP,
                        },
                      ]}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.heatmapLegend}>
          <Text style={styles.legendText}>Az</Text>
          <View style={styles.legendColors}>
            <View style={[styles.legendCell, { backgroundColor: '#1a1a1a' }]} />
            <View style={[styles.legendCell, { backgroundColor: '#0e4429' }]} />
            <View style={[styles.legendCell, { backgroundColor: '#006d32' }]} />
            <View style={[styles.legendCell, { backgroundColor: '#26a641' }]} />
            <View style={[styles.legendCell, { backgroundColor: '#39d353' }]} />
          </View>
          <Text style={styles.legendText}>Çok</Text>
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
      <ScrollView style={styles.scrollView}>
        <View style={styles.content}>
          <Text style={styles.title}>İstatistikler</Text>
          <Text style={styles.subtitle}>İlerlemenizi takip edin</Text>

          {/* Stats Cards */}
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: '#6366f120' }]}>
                <Ionicons name="trophy" size={24} color="#6366f1" />
              </View>
              <Text style={styles.statValue}>{stats?.total_habits || 0}</Text>
              <Text style={styles.statLabel}>Alışkanlık</Text>
            </View>

            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: '#10b98120' }]}>
                <Ionicons name="checkmark-done" size={24} color="#10b981" />
              </View>
              <Text style={styles.statValue}>{stats?.total_completions || 0}</Text>
              <Text style={styles.statLabel}>Tamamlama</Text>
            </View>

            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: '#f59e0b20' }]}>
                <Ionicons name="flash" size={24} color="#f59e0b" />
              </View>
              <Text style={styles.statValue}>{stats?.today_completions || 0}</Text>
              <Text style={styles.statLabel}>Bugün</Text>
            </View>

            <View style={styles.statCard}>
              <View style={[styles.statIcon, { backgroundColor: '#8b5cf620' }]}>
                <Ionicons name="list" size={24} color="#8b5cf6" />
              </View>
              <Text style={styles.statValue}>{stats?.active_tasks || 0}</Text>
              <Text style={styles.statLabel}>Aktif Görev</Text>
            </View>
          </View>

          {/* Heatmap */}
          {renderHeatmap()}

          {/* Quick Stats */}
          <View style={styles.quickStats}>
            <Text style={styles.sectionTitle}>Hızlı İstatistikler</Text>
            
            <View style={styles.quickStatItem}>
              <View style={styles.quickStatLeft}>
                <Ionicons name="checkmark-circle" size={20} color="#10b981" />
                <Text style={styles.quickStatLabel}>Tamamlanan Görevler</Text>
              </View>
              <Text style={styles.quickStatValue}>{stats?.completed_tasks || 0}</Text>
            </View>

            <View style={styles.quickStatItem}>
              <View style={styles.quickStatLeft}>
                <Ionicons name="time" size={20} color="#f59e0b" />
                <Text style={styles.quickStatLabel}>Bekleyen Görevler</Text>
              </View>
              <Text style={styles.quickStatValue}>{stats?.active_tasks || 0}</Text>
            </View>

            <View style={styles.quickStatItem}>
              <View style={styles.quickStatLeft}>
                <Ionicons name="trending-up" size={20} color="#6366f1" />
                <Text style={styles.quickStatLabel}>Toplam Tamamlama</Text>
              </View>
              <Text style={styles.quickStatValue}>{stats?.total_completions || 0}</Text>
            </View>
          </View>
        </View>
      </ScrollView>

      <TouchableOpacity style={styles.refreshButton} onPress={loadData}>
        <Ionicons name="refresh" size={20} color="#fff" />
        <Text style={styles.refreshText}>Yenile</Text>
      </TouchableOpacity>
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
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 24,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
  },
  statIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 13,
    color: '#9ca3af',
  },
  heatmapContainer: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  heatmapTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
  },
  heatmapSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 16,
  },
  heatmap: {
    flexDirection: 'row',
    gap: CELL_GAP,
  },
  heatmapWeek: {
    flexDirection: 'column',
  },
  heatmapCell: {
    borderRadius: 2,
  },
  heatmapLegend: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 16,
    gap: 8,
  },
  legendText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  legendColors: {
    flexDirection: 'row',
    gap: 4,
  },
  legendCell: {
    width: 12,
    height: 12,
    borderRadius: 2,
  },
  quickStats: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 16,
  },
  quickStatItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#2a2a2a',
  },
  quickStatLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  quickStatLabel: {
    fontSize: 15,
    color: '#d1d5db',
  },
  quickStatValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
  },
  refreshButton: {
    position: 'absolute',
    bottom: 90,
    right: 16,
    backgroundColor: '#6366f1',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  refreshText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
});
