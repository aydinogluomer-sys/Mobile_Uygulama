import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SegmentedTabs, { type Segment } from '../../components/SegmentedTabs';
import { colors } from '../../lib/tokens';
import StatsScreen from './stats';
import WeeklyReviewScreen from '../screens/weekly-review';
import MonthlyReviewScreen from '../screens/monthly-review';
import InsightsDetailScreen from '../screens/insights';
import RecoveryScreen from '../screens/recovery';

/**
 * İÇGÖRÜLER — everything that looks backwards at what happened.
 *
 * Statistics, the weekly and monthly reviews, behaviour insights and the
 * recovery backlog were spread across one tab and four drawer entries, so
 * "how am I doing" had five different answers in five different places.
 *
 * Composed from the existing screens for the same reasons as Plan: their
 * routes still work, and no reporting logic is rewritten in a change whose
 * purpose is navigation.
 */
type Key = 'stats' | 'weekly' | 'monthly' | 'behaviour' | 'recovery';

const SEGMENTS: readonly Segment<Key>[] = [
  { key: 'stats', label: 'Genel' },
  { key: 'weekly', label: 'Haftalık' },
  { key: 'monthly', label: 'Aylık' },
  { key: 'behaviour', label: 'Davranış' },
  { key: 'recovery', label: 'Telafi' },
];

export default function InsightsHubScreen() {
  const [tab, setTab] = useState<Key>('stats');
  return (
    <View style={s.root}>
      <SegmentedTabs segments={SEGMENTS} value={tab} onChange={setTab} />
      <View style={s.body}>
        {tab === 'stats' && <StatsScreen />}
        {tab === 'weekly' && <WeeklyReviewScreen />}
        {tab === 'monthly' && <MonthlyReviewScreen />}
        {tab === 'behaviour' && <InsightsDetailScreen />}
        {tab === 'recovery' && <RecoveryScreen />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
