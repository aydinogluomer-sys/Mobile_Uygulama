import { Text, View, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, hexA } from '../../lib/tokens';

type Props = {
  label: string | number;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
};

/** Küçük tonal rozet (örn. irade maliyeti, dk, hatırlatıcı). Chip'ten daha kompakt. */
export default function Badge({ label, color = colors.textDim, icon, style }: Props) {
  return (
    <View
      style={[
        {
          flexDirection: 'row', alignItems: 'center', gap: 2,
          backgroundColor: hexA(color, 0.16), borderRadius: radius.xs,
          paddingHorizontal: 6, paddingVertical: 2,
        },
        style,
      ]}
    >
      {icon && <Ionicons name={icon} size={10} color={color} />}
      <Text style={{ fontSize: 11, color, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
