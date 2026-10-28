import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SegmentedTabs, { type Segment } from '../../components/SegmentedTabs';
import { colors } from '../../lib/tokens';
import ProfileDetailScreen from '../screens/profile';
import IntegrationsScreen from '../screens/integrations';
import SettingsScreen from './settings';

/**
 * PROFİL (Calm Tech 3 Sütunlu Kimlik & Sistem Merkezi):
 * 5 sıkışık alt sekme yerine:
 * 1. Kimlik & Bento (Seviye, Yıllık Isı Haritası, Başarımlar, Liderlik, Odak Puanları)
 * 2. Bağlantılar (Entegrasyonlar & Webhook)
 * 3. Ayarlar (Tema, Veri/Gizlilik, Yedekleme)
 */
type Key = 'me' | 'integrations' | 'settings';

const SEGMENTS: readonly Segment<Key>[] = [
  { key: 'me', label: 'Kimlik & Özet' },
  { key: 'integrations', label: 'Bağlantılar' },
  { key: 'settings', label: 'Ayarlar' },
];

export default function ProfileHubScreen() {
  const [tab, setTab] = useState<Key>('me');
  return (
    <View style={s.root}>
      <SegmentedTabs segments={SEGMENTS} value={tab} onChange={setTab} />
      <View style={s.body}>
        {tab === 'me' && <ProfileDetailScreen />}
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
