import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SegmentedTabs, { type Segment } from '../../components/SegmentedTabs';
import { radius, alphaHex, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { haptic } from '../../lib/haptics';
import { useTabParam } from '../../hooks/useTabParams';
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
 * 3. Takvim (Aylık Takvim ve Ajanda)
 */
type PlanGroup = 'execution' | 'strategy' | 'calendar';
type ExecutionSub = 'tasks' | 'projects' | 'focus';
type StrategySub = 'goals' | 'life_areas' | 'okr';

export const PLAN_TABS = [
  'tasks',
  'projects',
  'focus',
  'goals',
  'life_areas',
  'okr',
  'calendar',
] as const;
export type PlanTab = (typeof PLAN_TABS)[number];

const SEGMENTS: readonly Segment<PlanGroup>[] = [
  { key: 'execution', label: 'Görev & Odak' },
  { key: 'strategy', label: 'Strateji Pusulası' },
  { key: 'calendar', label: 'Takvim' },
];

export default function PlanScreen() {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const { value: tabParam, stamp } = useTabParam(PLAN_TABS);
  const [group, setGroup] = useState<PlanGroup>(() => {
    if (tabParam === 'goals' || tabParam === 'life_areas' || tabParam === 'okr') return 'strategy';
    if (tabParam === 'calendar') return 'calendar';
    return 'execution';
  });
  const [execSub, setExecSub] = useState<ExecutionSub>(() =>
    tabParam === 'tasks' || tabParam === 'projects' || tabParam === 'focus' ? tabParam : 'tasks',
  );
  const [stratSub, setStratSub] = useState<StrategySub>(() =>
    tabParam === 'goals' || tabParam === 'life_areas' || tabParam === 'okr' ? tabParam : 'goals',
  );
  const paramSyncKey = `${tabParam ?? ''}|${stamp ?? ''}`;
  const [lastParamSyncKey, setLastParamSyncKey] = useState(paramSyncKey);

  if (lastParamSyncKey !== paramSyncKey) {
    setLastParamSyncKey(paramSyncKey);
    if (tabParam === 'tasks' || tabParam === 'projects' || tabParam === 'focus') {
      setGroup('execution');
      setExecSub(tabParam);
    } else if (tabParam === 'goals' || tabParam === 'life_areas' || tabParam === 'okr') {
      setGroup('strategy');
      setStratSub(tabParam);
    } else if (tabParam === 'calendar') {
      setGroup('calendar');
    }
  }

  return (
    <View style={s.root}>
      <SegmentedTabs segments={SEGMENTS} value={group} onChange={setGroup} />

      {/* Bağlamsal Aşamalı Açılım (Progressive Disclosure): Her grupta en fazla 3 odak noktası */}
      {group === 'execution' && (
        <View style={s.contextBar}>
          {[
            { key: 'tasks' as const, label: 'Görevler', icon: 'checkbox-outline' as const },
            { key: 'projects' as const, label: 'Projeler', icon: 'folder-outline' as const },
            { key: 'focus' as const, label: 'Odak Sayacı', icon: 'timer-outline' as const },
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
                <Ionicons name={item.icon} size={13} color={active ? colors.primary : colors.textFaint} />
                <Text style={[s.contextPillText, active && s.contextPillTextActive]}>{item.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {group === 'strategy' && (
        <View style={s.contextBar}>
          {[
            { key: 'life_areas' as const, label: '1. Yaşam Alanı', icon: 'pie-chart-outline' as const },
            { key: 'goals' as const, label: '2. Hedefler', icon: 'trophy-outline' as const },
            { key: 'okr' as const, label: '3. OKR & Sonuç', icon: 'flag-outline' as const },
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
                <Ionicons name={item.icon} size={13} color={active ? colors.primary : colors.textFaint} />
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

const makeStyles = (colors: Palette) => StyleSheet.create({
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
