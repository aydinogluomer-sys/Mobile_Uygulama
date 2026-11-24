import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { getMonthBackground } from '../lib/monthBackgrounds';
import { hexA } from '../lib/tokens';
import { useThemeColors } from '../hooks/useThemeColors';
import { useThemeStore } from '../store/themeStore';
import SeasonalMotion from './seasonalMotion/SeasonalMotion';
import { useReducedMotion } from './seasonalMotion/useReducedMotion';
import { monthNameFromIndex } from './seasonalMotion/config';

type Props = {
  /** Görünen ay (0 = Ocak … 11 = Aralık). Hangi görselin gösterileceğini belirler. */
  month: number;
  /** Görselin üzerindeki koyu scrim opaklığı. Görseller parlak olduğu için ~0.45 varsayılan. */
  scrim?: number;
  /** Ekran odakta/aktif mi? false ise mevsimsel animasyon durur (contract §14). */
  active?: boolean;
};

/**
 * Takvim ekranı için tam-ekran mevsimsel arka plan.
 * Katman sırası (arkadan öne, contract §4): görsel → scrim → mevsimsel hareket.
 * `month` değiştiğinde görseller arasında yumuşak crossfade olur.
 * `pointerEvents="none"` → dokunmalar arkadaki/öndeki içeriğe geçer (hareket katmanı da dahil).
 */
export default function MonthBackground({ month, scrim = 0.45, active = true }: Props) {
  const colors = useThemeColors();
  const seasonalMotion = useThemeStore((st) => st.seasonalMotion);
  const reduceMotion = useReducedMotion();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image
        source={getMonthBackground(month)}
        style={StyleSheet.absoluteFill}
        contentFit="cover"
        transition={350}
        cachePolicy="memory-disk"
      />
      {/* Sıcak koyu scrim — parlak görsellerde metin/cam panel kontrastını korur */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, scrim) }]} />
      {/* Mevsimsel ambient hareket — scrim üstünde, cam panel/içerik altında */}
      <SeasonalMotion
        month={monthNameFromIndex(month)}
        intensity={seasonalMotion}
        reduceMotion={reduceMotion}
        isVisible={active}
      />
    </View>
  );
}
