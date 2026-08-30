import { colors } from '../lib/tokens';
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';
import { LIFE_AREAS, AreaKey } from '../store/lifeAreasStore';

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
  const CENTER = size / 2;
  const MAX_R = CENTER - 28;
  const n = LIFE_AREAS.length;
  const angleStep = 360 / n;

  function polarToXY(angle: number, radius: number) {
    const rad = (angle - 90) * (Math.PI / 180);
    return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
  }

  const dataPoints = LIFE_AREAS.map((area, i) => {
    const r = (Math.max(0, Math.min(10, values[area.key] ?? 0)) / 10) * MAX_R;
    return polarToXY(i * angleStep, r);
  });
  const polyPoints = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <Svg width={size} height={size}>
      {RINGS.map((ring) => {
        const r = (ring / 10) * MAX_R;
        const pts = LIFE_AREAS.map((_, i) => {
          const p = polarToXY(i * angleStep, r);
          return `${p.x},${p.y}`;
        }).join(' ');
        return <Polygon key={ring} points={pts} fill="none" stroke="#383528" strokeWidth="1" />;
      })}

      {LIFE_AREAS.map((_, i) => {
        const outer = polarToXY(i * angleStep, MAX_R);
        return <Line key={i} x1={CENTER} y1={CENTER} x2={outer.x} y2={outer.y} stroke="#383528" strokeWidth="1" />;
      })}

      <Polygon points={polyPoints} fill={color + '20'} stroke={color} strokeWidth="2" />

      {dataPoints.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={4} fill={LIFE_AREAS[i].color} />
      ))}

      {LIFE_AREAS.map((area, i) => {
        const { x, y } = polarToXY(i * angleStep, MAX_R + 18);
        const anchor = x < CENTER - 5 ? 'end' : x > CENTER + 5 ? 'start' : 'middle';
        return (
          <SvgText key={area.key} x={x} y={y + 4} textAnchor={anchor as any} fill="#BFBBAE" fontSize="10" fontWeight="600">
            {area.label}
          </SvgText>
        );
      })}

      <Circle cx={CENTER} cy={CENTER} r={3} fill="#56544B" />
    </Svg>
  );
}
