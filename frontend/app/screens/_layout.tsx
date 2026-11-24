import { Stack } from 'expo-router';
import { View, StyleSheet } from 'react-native';
import { BlurView } from 'expo-blur';
import { hexA, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemeMode, useThemedStyles } from '../../hooks/useThemeColors';

/** Mevsimsel arka plana sahip ekranlar için: görselin üstüne oturan frosted-glass header. */
function GlassHeaderBg() {
  const colors = useThemeColors();
  const mode = useThemeMode();
  const s = useThemedStyles(makeStyles);
  return (
    <View style={StyleSheet.absoluteFill}>
      <BlurView intensity={30} tint={mode === 'light' ? 'light' : 'dark'} style={StyleSheet.absoluteFill} />
      <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.45) }]} />
      <View style={s.hairline} />
    </View>
  );
}

export default function ScreensLayout() {
  const colors = useThemeColors();
  const seasonalHeader = {
    headerTransparent: true,
    headerTintColor: colors.white,
    headerBackground: () => <GlassHeaderBg />,
  } as const;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerBackTitle: 'Geri',
        contentStyle: { backgroundColor: colors.bg },
      }}
    >
      <Stack.Screen name="calendar" options={{ title: 'Takvim', ...seasonalHeader }} />
      <Stack.Screen name="habit-detail" options={{ title: 'Alışkanlık Detayı' }} />
      <Stack.Screen name="insights" options={{ title: 'İçgörüler' }} />
      <Stack.Screen name="recovery" options={{ title: 'Telafi' }} />
      <Stack.Screen name="projects" options={{ title: 'Projeler' }} />
      <Stack.Screen name="notes" options={{ title: 'Notlar' }} />
      <Stack.Screen name="journal" options={{ title: 'Günlük' }} />
      <Stack.Screen name="journal-archive" options={{ title: 'Günlük Arşivi' }} />
      <Stack.Screen name="journal-reader" options={{ title: 'Defter' }} />
      <Stack.Screen name="journal-insights" options={{ title: 'AI İçgörüleri' }} />
      <Stack.Screen name="weekly-review" options={{ title: 'Haftalık Rapor' }} />
      <Stack.Screen name="monthly-review" options={{ title: 'Aylık Rapor', ...seasonalHeader }} />
      <Stack.Screen name="reading-list" options={{ title: 'Okuma Listesi' }} />
      <Stack.Screen name="integrations" options={{ title: 'Entegrasyonlar' }} />
      <Stack.Screen name="eisenhower" options={{ title: 'Eisenhower Matrisi' }} />
      <Stack.Screen name="life-areas" options={{ title: 'Yaşam Alanları' }} />
      <Stack.Screen name="deep-work" options={{ title: 'Derin Çalışma' }} />
      <Stack.Screen name="goals" options={{ title: 'Hedefler' }} />
      <Stack.Screen name="ai-coach" options={{ title: 'AI Coach' }} />
      <Stack.Screen name="dashboard" options={{ title: 'Dashboard' }} />
      <Stack.Screen name="focus-points" options={{ title: 'Focus Points' }} />
      <Stack.Screen name="credit-history" options={{ title: 'Kredi Geçmişi' }} />
      <Stack.Screen name="okr" options={{ title: 'OKR' }} />
      <Stack.Screen name="leaderboard" options={{ title: 'Sıralama' }} />
      <Stack.Screen name="achievements" options={{ title: 'Başarımlar & Rozetler' }} />
      <Stack.Screen name="profile" options={{ title: 'Profilim' }} />
      <Stack.Screen name="routine-runner" options={{ title: 'Rutin Yürütücü' }} />
      <Stack.Screen name="focus-flow" options={{ title: 'Odak Akışı', headerShown: false }} />
      <Stack.Screen name="privacy" options={{ title: 'Gizlilik Politikası' }} />
    </Stack>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    hairline: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 1, backgroundColor: hexA(colors.white, 0.08) },
  });
