import { View, Text, StyleProp, ViewStyle } from 'react-native';
import { colors, space, font } from '../../lib/tokens';
import Card from './Card';
import ProgressBar from './ProgressBar';

type Props = {
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
  value, label, sub, subColor, progress, progressColor = colors.primary, accent, onPress, style,
}: Props) {
  return (
    <Card onPress={onPress} padding="lg" style={[{ flex: 1 }, style]}>
      <Text style={{ ...font.overline, color: colors.textFaint, marginBottom: space.sm }}>{label}</Text>
      <Text style={{ ...font.metric, color: accent ?? colors.text, marginBottom: typeof progress === 'number' ? space.sm : 0 }}>{value}</Text>
      {sub && <Text style={{ fontSize: 11, color: subColor ?? colors.textGhost, marginTop: 3 }}>{sub}</Text>}
      {typeof progress === 'number' && <ProgressBar progress={progress} color={progressColor} height={3} />}
    </Card>
  );
}
