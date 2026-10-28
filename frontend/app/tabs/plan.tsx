import { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import SegmentedTabs, { type Segment } from '../../components/SegmentedTabs';
import { colors, radius, alphaHex } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import TasksScreen from './tasks';
import ProjectsScreen from '../screens/projects';
import OKRScreen from '../screens/okr';
import GoalsScreen from '../screens/goals';
import LifeAreasScreen from '../screens/life-areas';
import FocusScreen from './focus';
import CalendarScreen from '../screens/calendar';

/**
 * PLAN — Calm Tech 3-Katmanlı Planlama Pusulası:
 * 1. Eylem (Görevler, Projeler, Odak Sayacı)
 * 2. Strateji Pusulası (Yaşam Alanları → Hedefler → OKR "Altın İplik" Hiyerarşisi)
 * 3. Takvim (Zaman Blokları ve Ajanda)
 */
type PlanGroup = 'execution' | 'strategy' | 'calendar';
type ExecutionSub = 'tasks' | 'projects' | 'focus';
type StrategySub = 'goals' | 'life_areas' | 'okr';

const SEGMENTS: readonly Segment<PlanGroup>[] = [
  { key: 'execution', label: 'Görev & Odak' },
  { key: 'strategy', label: 'Strateji Pusulası' },
  { key: 'calendar', label: 'Takvim' },
];

export default function PlanScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [group, setGroup] = useState<PlanGroup>('execution');
  const [execSub, setExecSub] = useState<ExecutionSub>('tasks');
  const [stratSub, setStratSub] = useState<StrategySub>('goals');

  useEffect(() => {
    const t = params.tab;
    if (!t) return;
    if (t === 'tasks' || t === 'projects' || t === 'focus') {
      setGroup('execution');
      setExecSub(t);
    } else if (t === 'goals' || t === 'life_areas' || t === 'okr') {
      setGroup('strategy');
      setStratSub(t);
    } else if (t === 'calendar') {
      setGroup('calendar');
    }
  }, [params.tab]);

  return (
    <View style={s.root}>
      <SegmentedTabs segments={SEGMENTS} value={group} onChange={setGroup} />

      {/* Bağlamsal Aşamalı Açılım (Progressive Disclosure): Her grupta en fazla 3 odak noktası */}
      {group === 'execution' && (
        <View style={s.contextBar}>
          {[
            { key: 'tasks' as const, label: 'Görevler', icon: 'checkbox-outline' },
            { key: 'projects' as const, label: 'Projeler', icon: 'folder-outline' },
            { key: 'focus' as const, label: 'Odak Sayacı', icon: 'timer-outline' },
          ].map((item) => {
            const active = execSub === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[s.contextPill, active && s.contextPillActive]}
                onPress={() => { haptic.select(); setExecSub(item.key); }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <Ionicons name={item.icon as any} size={13} color={active ? colors.primary : colors.textFaint} />
                <Text style={[s.contextPillText, active && s.contextPillTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {group === 'strategy' && (
        <View style={s.contextBar}>
          {[
            { key: 'life_areas' as const, label: '1. Yaşam Alanı', icon: 'pie-chart-outline' },
            { key: 'goals' as const, label: '2. Hedefler', icon: 'trophy-outline' },
            { key: 'okr' as const, label: '3. OKR & Sonuç', icon: 'flag-outline' },
          ].map((item) => {
            const active = stratSub === item.key;
            return (
              <TouchableOpacity
                key={item.key}
                style={[s.contextPill, active && s.contextPillActive]}
                onPress={() => { haptic.select(); setStratSub(item.key); }}
                accessibilityRole="button"
                accessibilityLabel={item.label}
              >
                <Ionicons name={item.icon as any} size={13} color={active ? colors.primary : colors.textFaint} />
                <Text style={[s.contextPillText, active && s.contextPillTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      <View style={s.body}>
        {group === 'execution' && (
          <>
            {execSub === 'tasks' && <TasksScreen />}
            {execSub === 'projects' && <ProjectsScreen />}
            {execSub === 'focus' && <FocusScreen />}
          </>
        )}
        {group === 'strategy' && (
          <>
            {stratSub === 'life_areas' && <LifeAreasScreen />}
            {stratSub === 'goals' && <GoalsScreen />}
            {stratSub === 'okr' && <OKRScreen />}
          </>
        )}
        {group === 'calendar' && <CalendarScreen />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  contextBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 7,
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  contextPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 6,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  contextPillActive: {
    backgroundColor: alphaHex(colors.primary, '18'),
    borderColor: colors.primary,
  },
  contextPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textFaint,
  },
  contextPillTextActive: {
    color: colors.primary,
    fontWeight: '700',
  },
  body: { flex: 1 },
});
