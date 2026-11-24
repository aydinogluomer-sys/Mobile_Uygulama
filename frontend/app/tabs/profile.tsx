import { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import SegmentedTabs, { type Segment } from '../../components/SegmentedTabs';
import { type Palette } from '../../lib/tokens';
import { useThemedStyles } from '../../hooks/useThemeColors';
import { INTEGRATIONS_VISIBLE } from '../../lib/destinations';
import { useTabParam } from '../../hooks/useTabParams';
import ProfileDetailScreen from '../screens/profile';
import IntegrationsScreen from '../screens/integrations';
import SettingsScreen from './settings';

/**
 * PROFİL (Calm Tech Kimlik & Sistem Merkezi):
 * 1. Kimlik & Özet (Seviye, Yıllık Isı Haritası, Başarımlar, Liderlik, Odak Puanları)
 * 2. Bağlantılar (Entegrasyonlar & Webhook — yalnız INTEGRATIONS_VISIBLE açıkken segmentte görünür)
 * 3. Ayarlar (Tema, Veri/Gizlilik, Yedekleme)
 */
export const PROFILE_TABS = ['me', 'integrations', 'settings'] as const;
type Key = (typeof PROFILE_TABS)[number];

const ALL_SEGMENTS: readonly Segment<Key>[] = [
  { key: 'me', label: 'Kimlik & Özet' },
  { key: 'integrations', label: 'Bağlantılar' },
  { key: 'settings', label: 'Ayarlar' },
];

export function profileSegments(
  integrationsVisible: boolean = INTEGRATIONS_VISIBLE,
): readonly Segment<Key>[] {
  return integrationsVisible
    ? ALL_SEGMENTS
    : ALL_SEGMENTS.filter((seg) => seg.key !== 'integrations');
}

function resolveProfileTab(candidate: Key | null): Key {
  if (!candidate) return 'me';
  if (candidate === 'integrations' && !INTEGRATIONS_VISIBLE) return 'me';
  return candidate;
}

export default function ProfileHubScreen() {
  const s = useThemedStyles(makeStyles);
  const segments = profileSegments();
  const { value: tabParam, stamp } = useTabParam(PROFILE_TABS);
  const [tab, setTab] = useState<Key>(() => resolveProfileTab(tabParam));
  const paramSyncKey = `${tabParam ?? ''}|${stamp ?? ''}`;
  const [lastParamSyncKey, setLastParamSyncKey] = useState(paramSyncKey);

  if (lastParamSyncKey !== paramSyncKey) {
    setLastParamSyncKey(paramSyncKey);
    if (tabParam) {
      setTab(resolveProfileTab(tabParam));
    }
  }

  return (
    <View style={s.root}>
      <SegmentedTabs segments={segments} value={tab} onChange={setTab} />
      <View style={s.body}>
        {tab === 'me' && <ProfileDetailScreen />}
        {tab === 'integrations' && INTEGRATIONS_VISIBLE && <IntegrationsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </View>
    </View>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
});
