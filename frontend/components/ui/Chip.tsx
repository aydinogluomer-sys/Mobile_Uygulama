import { Text, View, TouchableOpacity, ViewStyle, StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, hexA } from '../../lib/tokens';

type Props = {
  label: string;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  dot?: boolean;
  selected?: boolean;
  onPress?: () => void;
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
};

/** Tonal pill — durum/etiket/seçim. dot veya icon ile zenginleşir. */
export default function Chip({
  label, color = colors.textDim, icon, dot, selected, onPress, size = 'md', style,
}: Props) {
  const isAccent = selected || !!dot || !!icon;
  const fg = isAccent ? color : colors.textDim;
  const py = size === 'sm' ? 3 : 6;
  const px = size === 'sm' ? 8 : 11;
  const fs = size === 'sm' ? 11 : 12;

  const content = (
    <>
      {dot && <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }} />}
      {icon && <Ionicons name={icon} size={fs + 1} color={fg} />}
      <Text style={{ fontSize: fs, fontWeight: '600', color: fg }}>{label}</Text>
    </>
  );

  const base: ViewStyle = {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: px, paddingVertical: py, borderRadius: radius.xs,
    backgroundColor: selected ? hexA(color, 0.16) : isAccent ? hexA(color, 0.14) : colors.surfaceAlt,
    borderWidth: 1,
    borderColor: selected ? color : isAccent ? hexA(color, 0.26) : colors.border,
  };

  if (onPress) {
    return <TouchableOpacity activeOpacity={0.7} onPress={onPress} style={[base, style]}>{content}</TouchableOpacity>;
  }
  return <View style={[base, style]}>{content}</View>;
}
