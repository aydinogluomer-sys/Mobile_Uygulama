import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SegmentedTabs, { type Segment } from '../../components/SegmentedTabs';
import { colors } from '../../lib/tokens';
import ProfileDetailScreen from '../screens/profile';
import LeaderboardScreen from '../screens/leaderboard';
import JournalScreen from '../screens/journal';
import IntegrationsScreen from '../screens/integrations';
import SettingsScreen from './settings';

/**
 * PROFİL — the account surface: who you are, what you have earned, and how
 * the app is configured.
 *
 * Previously the profile, leaderboard, journal, integrations and settings
 * were five separate drawer entries with no relationship to each other in the
 * navigation, even though they are all "about me and my setup".
 *
 * Composed from the existing screens; their routes are unchanged.
 */
type Key = 'me' | 'leaderboard' | 'journal' | 'integrations' | 'settings';

const SEGMENTS: readonly Segment<Key>[] = [
  { key: 'me', label: 'Profil' },
  { key: 'leaderboard', label: 'Sıralama' },
  { key: 'journal', label: 'Günlük' },
  { key: 'integrations', label: 'Entegrasyonlar' },
  { key: 'settings', label: 'Ayarlar' },
];

export default function ProfileHubScreen() {
  const [tab, setTab] = useState<Key>('me');
  return (
    <View style={s.root}>
      <SegmentedTabs segments={SEGMENTS} value={tab} onChange={setTab} />
      <View style={s.body}>
        {tab === 'me' && <ProfileDetailScreen />}
        {tab === 'leaderboard' && <LeaderboardScreen />}
        {tab === 'journal' && <JournalScreen />}
        {tab === 'integrations' && <IntegrationsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
