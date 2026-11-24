import { Text, StyleProp, ViewStyle, type AccessibilityProps } from 'react-native';
import { space, font } from '../../lib/tokens';
import { useThemeColors } from '../../hooks/useThemeColors';
import Card from './Card';
import ProgressBar from './ProgressBar';

/**
 * `AccessibilityProps` ile genişletildi ve doğrudan `Card`'a aktarılıyor:
 * `onPress` verilen bir StatTile artık Card üzerinden `button` rolü alıyor,
 * ve çağıran "Seri: 12 gün" gibi tek parça bir etiket geçebiliyor.
 * İçerideki `ProgressBar` etiketsiz olduğu için kendiliğinden gizli kalır —
 * değeri zaten üstteki metin söylüyor.
 */
type Props = AccessibilityProps & {
  value: string | number;
  label: string;
  sub?: string;
  subColor?: string;
  /** 0–1 verilirse alt kısımda ince ProgressBar gösterir */
  progress?: number;
  progressColor?: string;
  accent?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** Metrik kartı — büyük tabular değer + label (+ opsiyonel sub / progress bar). */
export default function StatTile({
  value, label, sub, subColor, progress, progressColor, accent, onPress, style, ...a11y
}: Props) {
  const c = useThemeColors();
  const resolvedProgressColor = progressColor ?? c.primary;

  return (
    <Card onPress={onPress} padding="lg" style={[{ flex: 1 }, style]} {...a11y}>
      <Text style={{ ...font.overline, color: c.textFaint, marginBottom: space.sm }}>{label}</Text>
      <Text style={{ ...font.metric, color: accent ?? c.text, marginBottom: typeof progress === 'number' ? space.sm : 0 }}>{value}</Text>
      {sub && <Text style={{ fontSize: 11, color: subColor ?? c.textFaint, marginTop: 3 }}>{sub}</Text>}
      {typeof progress === 'number' && <ProgressBar progress={progress} color={resolvedProgressColor} height={3} />}
    </Card>
  );
}
