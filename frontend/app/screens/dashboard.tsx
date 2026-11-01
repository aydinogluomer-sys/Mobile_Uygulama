import { StyleSheet, View } from 'react-native';
import { AtmosphericScreenCanvas, EditorialBanner } from '../../components/ui';
import { CANVASES, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import { SafeAreaView } from 'react-native-safe-area-context';
import HabitListView from '../../components/HabitListView';
import { colors } from '../../lib/tokens';

// Dashboard artık İstatistikler → "Liste" sekmesine taşındı (HabitListView).
// Bu rota geri uyumluluk için ince sarmalayıcı olarak kalır.
export default function DashboardScreen() {
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.observatoryStats} textureSource={TEXTURES.topographic} scrim={0.66} tintColor={colors.primary} />
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <EditorialBanner
          source={SCREEN_BANNERS.dashboardCommand}
          textureSource={TEXTURES.topographic}
          eyebrow="KOMUTA TABLOSU"
          title="Alışkanlık Dizini"
          subtitle="Tüm alışkanlıklarının durum, alan ve seri görünümü."
          accentColor={colors.primary}
          minHeight={88}
        />
      </View>
      <HabitListView />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
});
