import { Text, View, ViewStyle, StyleProp, type AccessibilityProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius, hexA } from '../../lib/tokens';
import { useThemeColors } from '../../hooks/useThemeColors';

/**
 * `AccessibilityProps` ile genişletildi: rozet metni çoğu zaman kısaltmadır
 * ("5 dk", "3 irade") ve çağıranın bunu açık bir etiketle değiştirebilmesi
 * gerekir. Rozetin kendisi dokunulabilir değil ve bir durum sahibi değil,
 * bu yüzden varsayılan rol/etiket UYDURULMUYOR — içindeki `Text` zaten okunur.
 */
type Props = AccessibilityProps & {
  label: string | number;
  color?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  style?: StyleProp<ViewStyle>;
};

/** Küçük tonal rozet (örn. irade maliyeti, dk, hatırlatıcı). Chip'ten daha kompakt. */
export default function Badge({ label, color, icon, style, ...a11y }: Props) {
  const c = useThemeColors();
  const resolvedColor = color ?? c.textDim;

  return (
    <View
      {...a11y}
      style={[
        {
          flexDirection: 'row', alignItems: 'center', gap: 2,
          backgroundColor: hexA(resolvedColor, 0.16), borderRadius: radius.xs,
          paddingHorizontal: 6, paddingVertical: 2,
        },
        style,
      ]}
    >
      {/* İkon süsleme: rozetin metni aynı bilgiyi zaten taşıyor. */}
      {icon && (
        <Ionicons
          name={icon}
          size={10}
          color={resolvedColor}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      )}
      <Text style={{ fontSize: 11, color: resolvedColor, fontWeight: '700' }}>{label}</Text>
    </View>
  );
}
