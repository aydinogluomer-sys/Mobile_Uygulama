import { View, ViewStyle, StyleProp, type AccessibilityProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, hexA } from '../../lib/tokens';

type Props = AccessibilityProps & {
  icon: keyof typeof Ionicons.glyphMap;
  color?: string;
  size?: number;     // kabın kenarı
  iconSize?: number; // ikon boyutu
  radiusKey?: keyof typeof radius;
  style?: StyleProp<ViewStyle>;
};

/**
 * Tonal renkli ikon kabı — uygulamada çok tekrar eden desen.
 *
 * ERİŞİLEBİLİRLİK: varsayılan olarak ağaçtan GİZLİ. Sebebi `Ionicons`'un bir
 * `<Text>` olarak render edilmesi: özel-kullanım alanındaki glif karakteri
 * TalkBack için gerçek bir durak üretir ve hiçbir anlam taşımaz. Mevcut her
 * çağrıda ikonun yanında zaten onu açıklayan bir metin var, yani ikon saf
 * süsleme. Bir çağıran `accessibilityLabel` (veya `aria-label`) verirse ikon
 * bilgi taşıyor demektir; o durumda gizlenmez ve `image` rolüyle görünür olur.
 */
export default function IconCircle({
  icon, color = colors.primary, size = 42, iconSize, radiusKey = 'md', style, ...a11y
}: Props) {
  const labelled = a11y.accessibilityLabel !== undefined || a11y['aria-label'] !== undefined;

  return (
    <View
      {...(labelled
        ? { accessibilityRole: 'image' as const }
        : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
      {...a11y}
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
