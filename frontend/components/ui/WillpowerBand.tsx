import { View, Text, StyleProp, ViewStyle, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, font } from '../../lib/tokens';
import ProgressBar from './ProgressBar';

type WP = {
  used: number;
  daily_budget: number;
  focus_capacity: number;
  active_count: number;
};

type Props = {
  wp: WP;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

function wpColor(ratio: number) {
  if (ratio < 0.5) return colors.success;
  if (ratio < 0.8) return colors.warning;
  return colors.error;
}

/** İrade bandı — today + timeline paylaşır. Kullanım oranına göre renk. */
export default function WillpowerBand({ wp, onPress, style }: Props) {
  const ratio = wp.daily_budget > 0 ? wp.used / wp.daily_budget : 0;
  const col = wpColor(ratio);
  const Wrapper: any = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      activeOpacity={0.8}
      onPress={onPress}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.md }, style]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 56 }}>
        <Ionicons name="flash" size={14} color={col} />
        <Text style={{ ...font.bodySm, color: col, fontWeight: '700' }}>
          {wp.used}/{wp.daily_budget}
        </Text>
      </View>
      <ProgressBar progress={ratio} color={col} height={5} style={{ flex: 1 }} />
      <Text style={{ ...font.caption, color: colors.textFaint, minWidth: 58, textAlign: 'right' }}>
        {wp.active_count}/{wp.focus_capacity} aktif
      </Text>
    </Wrapper>
  );
}
