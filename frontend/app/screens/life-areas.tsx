import { colors, hexA } from '../../lib/tokens';
import { useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, useWindowDimensions, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import Svg, { Polygon, Circle, Line, Text as SvgText } from 'react-native-svg';
import { useLifeAreasStore, LIFE_AREAS, AreaKey } from '../../store/lifeAreasStore';
import {
  AtmosphericScreenCanvas,
  ChapterDivider,
  EditorialBanner,
  EmbeddedFiligree,
  Skeleton,
} from '../../components/ui';
import {
  CANVASES,
  DECOR,
  getLifeAreaArt,
  SCREEN_BANNERS,
  TEXTURES,
} from '../../lib/visualAssets';

const SVG_W = 310;
const SIZE = 260;
const CX = SVG_W / 2;
const CY = SIZE / 2;
const RINGS = [2, 4, 6, 8, 10];
const MAX_R = 92;
const IS_TEST = typeof process !== 'undefined' && Boolean(process.env?.JEST_WORKER_ID);

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

function polarToXY(angle: number, radius: number) {
  const rad = (angle - 90) * (Math.PI / 180);
  return {
    x: CX + radius * Math.cos(rad),
    y: CY + radius * Math.sin(rad),
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
    <Svg width={SVG_W} height={SIZE}>
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
            stroke={colors.border}
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
            x1={CX} y1={CY}
            x2={outer.x} y2={outer.y}
            stroke={colors.border} strokeWidth="1"
          />
        );
      })}

      {/* Data polygon */}
      <Polygon
        points={polyPoints}
        fill={hexA(colors.accent, 0.14)}
        stroke={colors.accent}
        strokeWidth="2"
      />

      {/* Data dots */}
      {dataPoints.map((p, i) => (
        <Circle key={i} cx={p.x} cy={p.y} r={4} fill={LIFE_AREAS[i].color} />
      ))}

      {/* Labels */}
      {LIFE_AREAS.map((area, i) => {
        const angle = i * angleStep;
        const labelR = MAX_R + 14;
        const { x, y } = polarToXY(angle, labelR);
        const anchor = x < CX - 5 ? 'end' : x > CX + 5 ? 'start' : 'middle';
        return (
          <SvgText
            key={area.key}
            x={x} y={y + 4}
            textAnchor={anchor as any}
            fill={colors.textDim}
            fontSize="10"
            fontWeight="600"
          >
            {area.label}
          </SvgText>
        );
      })}

      {/* Center dot */}
      <Circle cx={CX} cy={CY} r={3} fill={colors.textGhost} />
    </Svg>
  );
}

function AreaTarotCard({
  area,
  value,
  onChange,
  cardWidthStyle,
}: {
  area: typeof LIFE_AREAS[number];
  value: number;
  onChange: (v: number) => void;
  cardWidthStyle: object;
}) {
  return (
    <View style={[sl.card, cardWidthStyle, { borderColor: hexA(area.color, 0.34) }]}>
      {!IS_TEST ? (
        <View style={sl.artWrap} pointerEvents="none" {...decorativeA11y}>
          <Image
            source={getLifeAreaArt(area.key)}
            style={StyleSheet.absoluteFill}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.34) }]} />
        </View>
      ) : null}

      <View style={sl.cardBody}>
        <View style={sl.headRow}>
          <Text style={[sl.label, { color: area.color }]} numberOfLines={1}>
            {area.label}
          </Text>
          <View style={[sl.scoreBadge, { borderColor: hexA(area.color, 0.45), backgroundColor: hexA(area.color, 0.14) }]}>
            <Text style={[sl.valueText, { color: colors.white }]}>{value}</Text>
            <Text style={sl.scoreSuffix}>/10</Text>
          </View>
        </View>

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
      </View>
    </View>
  );
}

export default function LifeAreasScreen() {
  const { values, lastSavedDate, loading, saving, loadLatest, setValue, save } = useLifeAreasStore();
  const { width } = useWindowDimensions();
  const cols = width >= 980 ? 4 : width >= 460 ? 2 : 1;
  const cardWidthStyle =
    cols === 4 ? { width: '23.8%' } : cols === 2 ? { width: '48.4%' } : { width: '100%' };

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
        <AtmosphericScreenCanvas
          source={CANVASES.strategyAltitude}
          textureSource={TEXTURES.sacredGrid}
          scrim={0.64}
          tintColor={colors.accent}
        />
        <View style={s.scroll}>
          <View style={s.radarContainer}>
            <Skeleton width={SIZE} height={SIZE} circle />
          </View>
          <View style={s.slidersCard}>
            {LIFE_AREAS.map((area) => (
              <View key={area.key} style={sl.skeletonRow}>
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
      <AtmosphericScreenCanvas
        source={CANVASES.strategyAltitude}
        textureSource={TEXTURES.sacredGrid}
        scrim={0.62}
        tintColor={colors.accent}
      />
      <ScrollView contentContainerStyle={s.scroll}>

        <EditorialBanner
          source={SCREEN_BANNERS.lifeAreasHarmony}
          textureSource={TEXTURES.sacredGrid}
          eyebrow="YAŞAM DENGESİ"
          title="Yaşam Alanları"
          subtitle="Sekiz temel yaşam alanındaki denge ve tatmin haritan."
          accentColor={colors.accent}
          minHeight={92}
          style={{ width: '100%', marginBottom: 14 }}
        />

        {/* Radar Pusulası Sahnesi */}
        <View style={s.radarStage}>
          <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="top-right" size={116} opacity={0.18} />
          <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-left" size={116} opacity={0.14} />
          <View style={s.avgBadge}>
            <Text style={s.avgValue}>{avg}</Text>
            <Text style={s.avgLabel}>ort./10</Text>
          </View>
          <View style={s.radarContainer}>
            <RadarWeb values={values} />
          </View>

          {lastSavedDate && (
            <View style={s.lastSaved}>
              <Ionicons
                name="checkmark-circle"
                size={14}
                color={colors.success}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
              <Text style={s.lastSavedText}>Son kayıt: {lastSavedDate}</Text>
            </View>
          )}
        </View>

        <ChapterDivider source={DECOR.dividerSundial} label="SEKİZ YAŞAM ARKEOTİPİ" style={{ width: '100%' }} />

        {/* 8 Yaşam Alanı Koleksiyon / Tarot Bento Izgarası */}
        <View style={s.tarotGrid}>
          {LIFE_AREAS.map((area) => (
            <AreaTarotCard
              key={area.key}
              area={area}
              value={values[area.key]}
              onChange={(v) => setValue(area.key, v)}
              cardWidthStyle={cardWidthStyle}
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
            <ActivityIndicator color={colors.white} size="small" />
          ) : (
            <>
              <Ionicons name="save-outline" size={18} color={colors.white} />
              <Text style={s.saveBtnText}>Kaydet</Text>
            </>
          )}
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: 18, paddingBottom: 44, alignItems: 'center' },

  radarStage: {
    width: '100%',
    alignItems: 'center',
    backgroundColor: hexA(colors.surface, 0.88),
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 12,
    marginBottom: 8,
    overflow: 'hidden',
    position: 'relative',
  },
  radarContainer: { alignItems: 'center', position: 'relative' },
  avgBadge: {
    position: 'absolute', top: 14, right: 14, zIndex: 2,
    backgroundColor: hexA(colors.bgSunk, 0.92), borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: hexA(colors.warning, 0.4), alignItems: 'center',
  },
  avgValue: { fontSize: 18, fontWeight: '700', color: colors.white, fontVariant: ['tabular-nums'] },
  avgLabel: { fontSize: 10, color: colors.textFaint },

  lastSaved: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
  lastSavedText: { fontSize: 12, color: colors.textFaint },

  slidersCard: {
    width: '100%', backgroundColor: colors.surface, borderRadius: 16,
    padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 20,
    gap: 14,
  },
  tarotGrid: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 12,
    marginTop: 6,
    marginBottom: 20,
  },

  saveBtn: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: colors.accent, borderRadius: 14, padding: 15,
  },
  saveBtnLoading: { opacity: 0.7 },
  saveBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },
});

const sl = StyleSheet.create({
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  card: {
    backgroundColor: hexA(colors.surface, 0.94),
    borderRadius: 15,
    borderWidth: 1,
    overflow: 'hidden',
  },
  artWrap: {
    width: '100%',
    height: 82,
    position: 'relative',
    backgroundColor: colors.bgSunk,
  },
  cardBody: {
    padding: 12,
    gap: 10,
  },
  headRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  label: { fontSize: 13, fontWeight: '700', flex: 1 },
  scoreBadge: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  sliderTrack: { flexDirection: 'row', gap: 3 },
  tick: {
    flex: 1, height: 10, borderRadius: 4, backgroundColor: colors.border,
  },
  valueText: { fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] },
  scoreSuffix: { fontSize: 10, color: colors.textFaint, marginLeft: 1 },
});
