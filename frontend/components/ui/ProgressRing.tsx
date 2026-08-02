import { View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors, hexA } from '../../lib/tokens';

type Props = {
  /** 0–1 arası ilerleme */
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
  children?: React.ReactNode;
};

/** Gerçek SVG dairesel ilerleme yayı (focus.tsx'in sahte border-rotate hilesinin yerine). */
export default function ProgressRing({
  progress, size = 180, stroke = 10, color = colors.primary, trackColor, children,
}: Props) {
  const p = Math.max(0, Math.min(1, progress));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - p);
  const center = size / 2;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
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
