import { View, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, hexA } from '../../lib/tokens';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  size?: number;     // kabın kenarı
  iconSize?: number; // ikon boyutu
  radiusKey?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
};

/** Tonal renkli ikon kabı — uygulamada çok tekrar eden desen. */
export default function IconCircle({
  icon, color = colors.primary, size = 42, iconSize, radiusKey = 'md', style,
}: Props) {
  return (
    <View
      style={[
        {
          width: size, height: size, borderRadius: radius[radiusKey],
          backgroundColor: hexA(color, 0.16),
          alignItems: 'center', justifyContent: 'center',
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={iconSize ?? Math.round(size * 0.5)} color={color} />
    </View>
  );
}
