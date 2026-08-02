import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import HabitListView from '../../components/HabitListView';
import { colors } from '../../lib/tokens';

// Dashboard artık İstatistikler → "Liste" sekmesine taşındı (HabitListView).
// Bu rota geri uyumluluk için ince sarmalayıcı olarak kalır.
export default function DashboardScreen() {
  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <HabitListView />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
});
