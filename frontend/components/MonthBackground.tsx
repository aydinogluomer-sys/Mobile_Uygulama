import { View, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { getMonthBackground } from '../lib/monthBackgrounds';
import { colors, hexA } from '../lib/tokens';

type Props = {
  /** Görünen ay (0 = Ocak … 11 = Aralık). Hangi görselin gösterileceğini belirler. */
  month: number;
  /** Görselin üzerindeki koyu scrim opaklığı. Görseller parlak olduğu için ~0.45 varsayılan. */
  scrim?: number;
};

/**
 * Takvim ekranı için tam-ekran mevsimsel arka plan.
 * `month` değiştiğinde görseller arasında yumuşak crossfade olur.
 * `pointerEvents="none"` → dokunmalar arkadaki/öndeki içeriğe geçer.
 */
export default function MonthBackground({ month, scrim = 0.45 }: Props) {
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
    </View>
  );
}
