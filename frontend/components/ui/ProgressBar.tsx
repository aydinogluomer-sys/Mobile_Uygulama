import { View, ViewStyle, StyleProp } from 'react-native';
import { colors, hexA } from '../../lib/tokens';

type Props = {
  /** 0–1 arası ilerleme */
  progress: number;
  color?: string;
  trackColor?: string;
  height?: number;
  style?: StyleProp<ViewStyle>;
};

/** Yatay ilerleme çubuğu — tutarlı track + fill. */
export default function ProgressBar({
  progress, color = colors.primary, trackColor, height = 4, style,
}: Props) {
  const pct = Math.max(0, Math.min(1, progress)) * 100;
  return (
    <View
      style={[
        { height, borderRadius: height, backgroundColor: trackColor ?? hexA(colors.white, 0.08), overflow: 'hidden' },
        style,
      ]}
    >
      <View style={{ height: '100%', width: `${pct}%`, borderRadius: height, backgroundColor: color }} />
    </View>
  );
}
