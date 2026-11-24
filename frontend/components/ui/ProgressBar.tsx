import { View, ViewStyle, StyleProp, type AccessibilityProps } from 'react-native';
import { hexA } from '../../lib/tokens';
import { useThemeColors } from '../../hooks/useThemeColors';

type Props = AccessibilityProps & {
  /** 0–1 arası ilerleme */
  progress: number;
  color?: string;
  trackColor?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Yatay ilerleme çubuğu — tutarlı track + fill.
 *
 * ERİŞİLEBİLİRLİK, İKİ MODLU. Bu çubuk bugün her yerde ZATEN sayıyı söyleyen
 * bir metnin yanında duruyor (StatTile'ın değeri, WillpowerBand'in "3/5"i,
 * stats/timeline'daki yüzde). Böyle bir yerde çubuğu ayrıca duyurmak aynı
 * bilgiyi ikinci kez, bu kez bağlamsız okutur. Bu yüzden VARSAYILAN süsleme:
 * ağaçtan gizli. Çubuk tek başına bilgi taşıyorsa çağıran bir
 * `accessibilityLabel` verir; o zaman `progressbar` rolüne ve yüzde değerine
 * kavuşur. İki mod da testlerle sabitlendi.
 */
export default function ProgressBar({
  progress, color, trackColor, height = 4, style, ...a11y
}: Props) {
  const c = useThemeColors();
  const resolvedColor = color ?? c.primary;
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  const described =
    a11y.accessibilityLabel !== undefined ||
    a11y['aria-label'] !== undefined ||
    a11y.accessibilityRole !== undefined;

  return (
    <View
      {...(described
        ? {
            accessibilityRole: 'progressbar' as const,
            accessibilityValue: { min: 0, max: 100, now: Math.round(pct) },
          }
        : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
      {...a11y}
      style={[
        { height, borderRadius: height, backgroundColor: trackColor ?? hexA(c.text, 0.08), overflow: 'hidden' },
        style,
      ]}
    >
      <View style={{ height: '100%', width: `${pct}%`, borderRadius: height, backgroundColor: resolvedColor }} />
    </View>
  );
}
