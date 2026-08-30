import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SegmentedTabs, { type Segment } from '../../components/SegmentedTabs';
import { colors } from '../../lib/tokens';
import TasksScreen from './tasks';
import FocusScreen from './focus';
import CalendarScreen from '../screens/calendar';

/**
 * PLAN — the "when am I doing this" surface.
 *
 * The target information architecture asks for five destinations: Bugün,
 * Plan, Alışkanlıklar, İçgörüler, Profil. Planning previously occupied two
 * separate tabs (Görevler, Odak) plus a drawer entry (Takvim), which is three
 * places to answer one question.
 *
 * This consolidates them by COMPOSING the existing screens rather than moving
 * their code. Two reasons that matters:
 *
 *  - The screens keep their own routes (`/tabs/tasks`, `/tabs/focus`,
 *    `/screens/calendar`), so every `router.push` already in the codebase,
 *    every deep link and every drawer entry still lands somewhere real. An IA
 *    change that breaks navigation is not an improvement.
 *  - No behaviour is rewritten, so the consolidation cannot introduce a
 *    regression in task handling or the focus timer.
 */
const SEGMENTS: readonly Segment<'tasks' | 'focus' | 'calendar'>[] = [
  { key: 'tasks', label: 'Görevler' },
  { key: 'focus', label: 'Odak' },
  { key: 'calendar', label: 'Takvim' },
];

export default function PlanScreen() {
  const [tab, setTab] = useState<'tasks' | 'focus' | 'calendar'>('tasks');
  return (
    <View style={s.root}>
      <SegmentedTabs segments={SEGMENTS} value={tab} onChange={setTab} />
      <View style={s.body}>
        {tab === 'tasks' && <TasksScreen />}
        {tab === 'focus' && <FocusScreen />}
        {tab === 'calendar' && <CalendarScreen />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
