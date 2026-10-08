import { Text, View, TouchableOpacity, ViewStyle, StyleProp, type AccessibilityProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, hexA } from '../../lib/tokens';

/**
 * `AccessibilityProps` ile genişletildi: prop tipi kapalıyken çağıran taraf
 * etiket/ipucu geçemiyordu. Daha da önemlisi Chip `selected` durumunun
 * SAHİBİYDİ ama onu hiç duyurmuyordu — dokunulabilir bir chip ekran
 * okuyucuda seçiliyken de seçili değilken de birebir aynı okunuyordu.
 */
type Props = AccessibilityProps & {
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
  label, color = colors.textDim, icon, dot, selected, onPress, size = 'md', style, ...a11y
}: Props) {
  const isAccent = selected || !!dot || !!icon;
  const fg = isAccent ? color : colors.textDim;
  const py = size === 'sm' ? 3 : 6;
  const px = size === 'sm' ? 8 : 11;
  const fs = size === 'sm' ? 11 : 12;

  // `selected` VERİLMEDİYSE chip bir geçiş (toggle) değildir; o durumda
  // "seçili değil" diye duyurmak yanlış olur. Verildiyse — false olsa bile —
  // durum gerçektir ve duyurulur.
  const ownedState = selected === undefined ? undefined : { selected };
  const accessibilityState =
    ownedState || a11y.accessibilityState ? { ...ownedState, ...a11y.accessibilityState } : undefined;

  const content = (
    <>
      {/* dot ve icon saf süsleme: chip'in kendi metni zaten aynı şeyi söylüyor. */}
      {dot && (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: color }}
        />
      )}
      {icon && (
        <Ionicons
          name={icon}
          size={fs + 1}
          color={fg}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
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
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        // Varsayılanlar önce, `...a11y` sonra → çağıran her zaman geçersiz kılabilir.
        accessibilityRole="button"
        accessibilityLabel={label}
        {...a11y}
        accessibilityState={accessibilityState}
        // R06.04 — a chip is small to look at, not to touch.
        hitSlop={{ top: 10, bottom: 10, left: 4, right: 4 }}
        style={[base, style]}
      >
        {content}
      </TouchableOpacity>
    );
  }
  return (
    <View {...a11y} accessibilityState={accessibilityState} style={[base, style]}>
      {content}
    </View>
  );
}
