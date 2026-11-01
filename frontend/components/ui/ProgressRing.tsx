import { Platform, View, type AccessibilityProps } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, hexA } from '../../lib/tokens';

type Props = AccessibilityProps & {
  /** 0–1 arası ilerleme */
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
};

/**
 * Gerçek SVG dairesel ilerleme yayı (focus.tsx'in sahte border-rotate hilesinin yerine).
 *
 * ERİŞİLEBİLİRLİK. Yayın kendisi (`<Svg>`) HER ZAMAN ağaçtan gizli: içinde
 * metin yok, sadece çizim var. `children` ise DIŞARIDA bırakılıyor — halkanın
 * ortasındaki sayaç/oran metni bugün bu bileşenin tek anlamlı çıktısı ve onu
 * da gizlemek ekranı sessizleştirirdi. Kap yalnızca çağıran bir
 * `accessibilityLabel` verdiğinde `progressbar` rolü ve yüzde değeri alır.
 */
export default function ProgressRing({
  progress, size = 180, stroke = 10, color = colors.primary, trackColor, children, ...a11y
}: Props) {
  const p = Math.max(0, Math.min(1, progress));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p);
  const center = size / 2;
  const described =
    a11y.accessibilityLabel !== undefined ||
    a11y['aria-label'] !== undefined ||
    a11y.accessibilityRole !== undefined;

  return (
    <View
      {...(described
        ? {
            accessibilityRole: 'progressbar' as const,
            accessibilityValue: { min: 0, max: 100, now: Math.round(p * 100) },
          }
        : null)}
      {...a11y}
      style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      <Svg
        width={size}
        height={size}
        style={{ position: 'absolute' }}
        {...(Platform.OS === 'web'
          ? { 'aria-hidden': true }
          : {
              accessibilityElementsHidden: true,
              importantForAccessibility: 'no-hide-descendants' as const,
            })}
      >
        {/* track */}
        <Circle
          cx={center} cy={center} r={r}
          stroke={trackColor ?? hexA(color, 0.16)} strokeWidth={stroke} fill="none"
        />
        {/* progress yayı — saat 12'den başlasın diye -90° döndür */}
        <Circle
          cx={center} cy={center} r={r}
          stroke={color} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={offset} strokeLinecap="round"
          transform={`rotate(-90 ${center} ${center})`}
        />
      </Svg>
      {children}
    </View>
  );
}
