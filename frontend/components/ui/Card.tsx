import { View, TouchableOpacity, ViewStyle, StyleProp, type AccessibilityProps } from 'react-native';
import { radius, space, shadow } from '../../lib/tokens';
import { useThemeColors } from '../../hooks/useThemeColors';

type Variant = 'plain' | 'elevated' | 'glass';

/**
 * `AccessibilityProps` ile genişletildi. `onPress` verildiğinde Card çıplak bir
 * TouchableOpacity'ye dönüşüyordu: rolsüz, ve `selected` durumunu — sahibi
 * olduğu halde — duyurmuyordu. Kart içeriği metin taşıdığı için varsayılan bir
 * etiket UYDURULMUYOR; TouchableOpacity çocuk metinleri zaten birleştirir ve
 * uydurulmuş bir etiket onların yerini alarak bilgi kaybettirirdi.
 */
type Props = AccessibilityProps & {
  children: React.ReactNode;
  variant?: Variant;
  padding?: keyof typeof space | number;
  radiusKey?: keyof typeof radius;
  selected?: boolean;
  accent?: string;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/** Tüm yüzeylerin temel kabı — tutarlı surface/border/radius/padding. */
export default function Card({
  children, variant = 'plain', padding = 'lg', radiusKey = 'md',
  selected, accent, onPress, style, ...a11y
}: Props) {
  const c = useThemeColors();
  const pad = typeof padding === 'number' ? padding : space[padding];
  const base: ViewStyle = {
    backgroundColor: variant === 'elevated' ? c.surfaceAlt : c.surface,
    borderRadius: radius[radiusKey],
    padding: pad,
    borderWidth: 1,
    borderColor: selected ? (accent ?? c.primary) : c.border,
    ...(variant === 'elevated' ? shadow.md : null),
  };

  // `selected` verilmediyse kart bir seçim öğesi değildir — bkz. Chip'teki
  // aynı gerekçe.
  const ownedState = selected === undefined ? undefined : { selected };
  const accessibilityState =
    ownedState || a11y.accessibilityState ? { ...ownedState, ...a11y.accessibilityState } : undefined;

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={onPress}
        accessibilityRole="button"
        {...a11y}
        accessibilityLabel={a11y.accessibilityLabel}
        accessibilityState={accessibilityState}
        style={[base, style]}
      >
        {children}
      </TouchableOpacity>
    );
  }
  return (
    <View {...a11y} accessibilityState={accessibilityState} style={[base, style]}>
      {children}
    </View>
  );
}
