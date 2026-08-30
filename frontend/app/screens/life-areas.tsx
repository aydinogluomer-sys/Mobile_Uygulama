import { useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';
import { useLifeAreasStore, LIFE_AREAS, AreaKey } from '../../store/lifeAreasStore';
import { Skeleton } from '../../components/ui';

const SIZE = 260;
const CENTER = SIZE / 2;
const RINGS = [2, 4, 6, 8, 10];
const MAX_R = CENTER - 28;

function polarToXY(angle: number, radius: number) {
  const rad = (angle - 90) * (Math.PI / 180);
  return {
    x: CENTER + radius * Math.cos(rad),
    y: CENTER + radius * Math.sin(rad),
  };
}

function RadarWeb({ values }: { values: Record<AreaKey, number> }) {
  const n = LIFE_AREAS.length;
  const angleStep = 360 / n;

  const dataPoints = LIFE_AREAS.map((area, i) => {
    const angle = i * angleStep;
    const r = (values[area.key] / 10) * MAX_R;
    return polarToXY(angle, r);
  });

  const polyPoints = dataPoints.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <Svg width={SIZE} height={SIZE}>
      {/* Ring gridlines */}
      {RINGS.map((ring) => {
        const r = (ring / 10) * MAX_R;
        const pts = LIFE_AREAS.map((_, i) => {
          const p = polarToXY(i * angleStep, r);
          return `${p.x},${p.y}`;
        }).join(' ');
        return (
          <Polygon
            key={ring}
            points={pts}
            fill="none"
            stroke="#383528"
            strokeWidth="1"
          />
        );
      })}

      {/* Axis lines */}
      {LIFE_AREAS.map((_, i) => {
        const outer = polarToXY(i * angleStep, MAX_R);
        return (
          <Line
            key={i}
            x1={CENTER} y1={CENTER}
            x2={outer.x} y2={outer.y}
            stroke="#383528" strokeWidth="1"
          />
        );
      })}

      {/* Data polygon */}
      <Polygon
        points={polyPoints}
        fill="#D9775720"
        stroke="#D97757"
        strokeWidth="2"
      />

      {/* Data dots */}
      {dataPoints.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={4} fill={LIFE_AREAS[i].color} />
      ))}

      {/* Labels */}
      {LIFE_AREAS.map((area, i) => {
        const angle = i * angleStep;
        const labelR = MAX_R + 18;
        const { x, y } = polarToXY(angle, labelR);
        const anchor = x < CENTER - 5 ? 'end' : x > CENTER + 5 ? 'start' : 'middle';
        return (
          <SvgText
            key={area.key}
            x={x} y={y + 4}
            textAnchor={anchor as any}
            fill="#BFBBAE"
            fontSize="10"
            fontWeight="600"
          >
            {area.label}
          </SvgText>
        );
      })}

      {/* Center dot */}
      <Circle cx={CENTER} cy={CENTER} r={3} fill="#56544B" />
    </Svg>
  );
}

function ValueSlider({ area, value, onChange }: {
  area: typeof LIFE_AREAS[number];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <View style={sl.row}>
      <Text style={[sl.label, { color: area.color }]}>{area.label}</Text>
      <View style={sl.sliderTrack}>
        {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
          // Kutucuklar tamamen görsel; etiket olmadan ekran okuyucuya hiç
          // görünmezler. Her biri "bu alana v puan ver" anlamına gelir.
          <TouchableOpacity
            key={v}
            style={[sl.tick, v <= value && { backgroundColor: area.color }]}
            onPress={() => onChange(v)}
            accessibilityRole="radio"
            accessibilityLabel={`${area.label}: ${v} puan ver`}
            accessibilityState={{ selected: v === value, checked: v === value }}
          />
        ))}
      </View>
      <Text style={sl.valueText}>{value}</Text>
    </View>
  );
}

export default function LifeAreasScreen() {
  const { values, lastSavedDate, loading, saving, loadLatest, setValue, save } = useLifeAreasStore();

  useEffect(() => { loadLatest(); }, [loadLatest]);

  const avg = Math.round(
    Object.values(values).reduce((a, b) => a + b, 0) / LIFE_AREAS.length * 10
  ) / 10;

  if (loading) {
    // Ekranın şekli sabit: radar + her yaşam alanı için bir kaydırıcı satırı +
    // kaydet düğmesi. Bu şekli göstermek beklemeyi kısaltır ve veri gelince
    // düzen zıplamaz.
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.scroll}>
          <View style={s.radarContainer}>
            <Skeleton width={SIZE} height={SIZE} circle />
          </View>
          <View style={s.slidersCard}>
            {LIFE_AREAS.map((area) => (
              <View key={area.key} style={sl.row}>
                <Skeleton width={68} height={12} />
                <View style={sl.sliderTrack}><Skeleton height={8} /></View>
                <Skeleton width={16} height={13} />
              </View>
            ))}
          </View>
          <Skeleton height={50} style={{ width: '100%' }} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll}>

        {/* Radar */}
        <View style={s.radarContainer}>
          <RadarWeb values={values} />
          <View style={s.avgBadge}>
            <Text style={s.avgValue}>{avg}</Text>
            <Text style={s.avgLabel}>ort./10</Text>
          </View>
        </View>

        {/* Son kayıt */}
        {lastSavedDate && (
          <View style={s.lastSaved}>
            <Ionicons
              name="checkmark-circle"
              size={14}
              color="#87A678"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={s.lastSavedText}>Son kayıt: {lastSavedDate}</Text>
          </View>
        )}

        {/* Sliders */}
        <View style={s.slidersCard}>
          {LIFE_AREAS.map((area) => (
            <ValueSlider
              key={area.key}
              area={area}
              value={values[area.key]}
              onChange={(v) => setValue(area.key, v)}
            />
          ))}
        </View>

        {/* Kaydet */}
        <TouchableOpacity
          style={[s.saveBtn, saving && s.saveBtnLoading]}
          onPress={save}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={saving ? 'Kaydediliyor' : 'Yaşam alanı puanlarını kaydet'}
          accessibilityState={{ disabled: saving, busy: saving }}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="save-outline" size={18} color="#fff" />
              <Text style={s.saveBtnText}>Kaydet</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#15140F' },
  scroll: { padding: 20, paddingBottom: 40, alignItems: 'center' },

  radarContainer: { alignItems: 'center', marginBottom: 8, position: 'relative' },
  avgBadge: {
    position: 'absolute', bottom: 24, right: 20,
    backgroundColor: '#1D1C17', borderRadius: 10, padding: 8,
    borderWidth: 1, borderColor: '#383528', alignItems: 'center',
  },
  avgValue: { fontSize: 18, fontWeight: '700', color: '#fff' },
  avgLabel: { fontSize: 10, color: '#827E72' },

  lastSaved: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 16 },
  lastSavedText: { fontSize: 12, color: '#827E72' },

  slidersCard: {
    width: '100%', backgroundColor: '#1D1C17', borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: '#383528', marginBottom: 20,
    gap: 14,
  },

  saveBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: '#D97757', borderRadius: 14, padding: 15,
  },
  saveBtnLoading: { opacity: 0.7 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});

const sl = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  label: { fontSize: 12, fontWeight: '700', width: 68 },
  sliderTrack: { flex: 1, flexDirection: 'row', gap: 3 },
  tick: {
    flex: 1, height: 8, borderRadius: 4, backgroundColor: '#383528',
  },
  valueText: { fontSize: 13, fontWeight: '700', color: '#fff', width: 16, textAlign: 'right' },
});
