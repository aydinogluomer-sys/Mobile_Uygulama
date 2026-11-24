import { View, Text, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { space, font, tabularNums } from '../../lib/tokens';
import { useThemeColors } from '../../hooks/useThemeColors';

type Props = {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  count?: number;
  /** Sağ aksiyon (örn. "Tümü →") */
  actionLabel?: string;
  onAction?: () => void;
  /**
   * Sağ aksiyonun ekran okuyucu etiketi. Verilmezse `actionLabel` kullanılır —
   * ama "Tümü →" gibi bir metin tek başına neyin tümü olduğunu söylemez, bu
   * yüzden çağıran taraf ("Tüm alışkanlıkları gör") geçebilsin diye ayrı bir
   * prop var. Başlığın kendisine değil, YALNIZ aksiyona uygulanır; bu yüzden
   * bileşen `AccessibilityProps` ile genişletilmedi — kime uygulandığı belirsiz
   * olurdu.
   */
  actionAccessibilityLabel?: string;
  actionAccessibilityHint?: string;
  /** overline (küçük, uppercase) · title (sans) · serif (editöryel başlık) */
  variant?: 'overline' | 'title' | 'serif';
  style?: StyleProp<ViewStyle>;
};

/** Bölüm başlığı — overline/serif başlık + opsiyonel count/aksiyon. */
export default function SectionHeader({
  title, icon, iconColor, count, actionLabel, onAction,
  actionAccessibilityLabel, actionAccessibilityHint, variant = 'title', style,
}: Props) {
  const c = useThemeColors();
  const resolvedIconColor = iconColor ?? c.textFaint;
  const titleStyle = variant === 'overline'
    ? { ...font.overline, color: c.textFaint }
    : variant === 'serif'
      ? { ...font.title, fontSize: 19, color: c.text }
      : { ...font.h3, color: c.text };

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md }, style]}>
      {/* Başlık ikonu süsleme: hemen yanındaki başlık metni aynı şeyi söyler. */}
      {icon && (
        <Ionicons
          name={icon}
          size={18}
          color={resolvedIconColor}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
      <Text style={[titleStyle, { flex: 1 }]}>{title}</Text>
      {typeof count === 'number' && (
        <Text style={{ ...tabularNums, fontSize: 13, color: c.textFaint }}>{count}</Text>
      )}
      {actionLabel && (
        <TouchableOpacity
          onPress={onAction}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel={actionAccessibilityLabel ?? actionLabel}
          accessibilityHint={actionAccessibilityHint}
        >
          <Text style={{ fontSize: 12, color: c.primaryBright, fontWeight: '600' }}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
