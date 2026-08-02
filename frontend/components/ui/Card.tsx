import { View, TouchableOpacity, ViewStyle, StyleProp } from 'react-native';
import { colors, radius, space, shadow } from '../../lib/tokens';

type Variant = 'plain' | 'elevated' | 'glass';

type Props = {
  children: React.ReactNode;
  variant?: Variant;
  padding?: keyof typeof space | number;
  radiusKey?: keyof typeof radius;
  selected?: boolean;
  accent?: string;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

/** Tüm yüzeylerin temel kabı — tutarlı surface/border/radius/padding. */
export default function Card({
  children, variant = 'plain', padding = 'lg', radiusKey = 'md',
  selected, accent, onPress, style,
}: Props) {
  const pad = typeof padding === 'number' ? padding : space[padding];
  const base: ViewStyle = {
    backgroundColor: variant === 'elevated' ? colors.surfaceAlt : colors.surface,
    borderRadius: radius[radiusKey],
    padding: pad,
    borderWidth: 1,
    borderColor: selected ? (accent ?? colors.primary) : colors.border,
    ...(variant === 'elevated' ? shadow.md : null),
  };

  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={[base, style]}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={[base, style]}>{children}</View>;
}
