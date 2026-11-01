import { colors } from '../lib/tokens';
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';
import { LIFE_AREAS, AreaKey } from '../store/lifeAreasStore';
import { radarText } from '../lib/chartText';
import { Platform, StyleSheet, View } from 'react-native';
import { Image } from 'expo-image';
import { SCREEN_BANNERS } from '../lib/visualAssets';

const IS_TEST = typeof process !== 'undefined' && Boolean(process.env?.JEST_WORKER_ID);

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

const RINGS = [2, 4, 6, 8, 10];

// Yaşam alanları radar grafiği — değerler 0-10 ölçeğinde.
export default function AreaRadar({
  values,
  size = 260,
  color = colors.accent,
}: {
  values: Record<AreaKey, number>;
  size?: number;
  color?: string;
}) {
  const PAD_X = 25;
  const svgW = size + PAD_X * 2;
  const CX = svgW / 2;
  const CY = size / 2;
  const MAX_R = Math.max(44, CY - 38);
  const n = LIFE_AREAS.length;
  const angleStep = 360 / n;

  function polarToXY(angle: number, radius: number) {
    const rad = (angle - 90) * (Math.PI / 180);
    return { x: CX + radius * Math.cos(rad), y: CY + radius * Math.sin(rad) };
  }

  const dataPoints = LIFE_AREAS.map((area, i) => {
    const r = (Math.max(0, Math.min(10, values[area.key] ?? 0)) / 10) * MAX_R;
    return polarToXY(i * angleStep, r);
  });
  const polyPoints = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  // R07.07 — the radar as text, for screen readers.
  const text = radarText(LIFE_AREAS.map((a) => ({ label: a.label, value: Math.max(0, Math.min(10, values[a.key] ?? 0)) })));
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={text}
      style={{ position: 'relative', width: svgW, maxWidth: '100%', height: size, alignItems: 'center', justifyContent: 'center' }}
    >
      {!IS_TEST ? (
        <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none" {...decorativeA11y}>
          <Image
            source={SCREEN_BANNERS.lifeAreasHarmony}
            style={{ width: size, height: size, borderRadius: size / 2, opacity: 0.18 }}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
        </View>
      ) : null}
      <Svg width={svgW} height={size}>
        {RINGS.map((ring) => {
          const r = (ring / 10) * MAX_R;
          const pts = LIFE_AREAS.map((_, i) => {
            const p = polarToXY(i * angleStep, r);
            return `${p.x},${p.y}`;
          }).join(' ');
          return <Polygon key={ring} points={pts} fill="none" stroke={colors.border} strokeWidth="1" />;
        })}

        {LIFE_AREAS.map((_, i) => {
          const outer = polarToXY(i * angleStep, MAX_R);
          return <Line key={i} x1={CX} y1={CY} x2={outer.x} y2={outer.y} stroke={colors.border} strokeWidth="1" />;
        })}

        <Polygon points={polyPoints} fill={color + '20'} stroke={color} strokeWidth="2" />

        {dataPoints.map((p, i) => (
          <Circle key={i} cx={p.x} cy={p.y} r={4} fill={LIFE_AREAS[i].color} />
        ))}

        {LIFE_AREAS.map((area, i) => {
          const { x, y } = polarToXY(i * angleStep, MAX_R + 14);
          const anchor = x < CX - 5 ? 'end' : x > CX + 5 ? 'start' : 'middle';
          return (
            <SvgText key={area.key} x={x} y={y + 4} textAnchor={anchor as any} fill={colors.textDim} fontSize="10" fontWeight="600">
              {area.label}
            </SvgText>
          );
        })}

        <Circle cx={CX} cy={CY} r={3} fill={colors.textGhost} />
      </Svg>
    </View>
  );
}
