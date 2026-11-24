import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  useWindowDimensions, TouchableOpacity, Modal, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { format, subDays, getDaysInMonth } from 'date-fns';
import { decimalTR, seriesText } from '../../lib/chartText';
import Svg, { Rect, Text as SvgText } from 'react-native-svg';
import { currentUser } from '../../lib/session';
import { parseLocalDate, ymd } from '../../lib/date';
import { buildAggregateYearGrid, type AggregateRow } from '../../lib/yearGrid';
import { useHabitStore } from '../../store/habitStore';
import { useTaskStore } from '../../store/taskStore';
import { heatmapLogs as fetchHabitLogsHeatmap, habitIdsCompletedSince as fetchHabitIdsCompletedSince } from '../../services/habitService';
import { LIFE_AREAS, AreaKey } from '../../store/lifeAreasStore';
import AreaRadar from '../../components/AreaRadar';
import HabitListView from '../../components/HabitListView';
import KintsugiYearGrid from '../../components/habits/KintsugiYearGrid';
import { colors, space, radius, font, hexA, fontFamily } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import { barWidth, chartWidth, radarSize } from '../../lib/layoutMetrics';
import { Card, StatTile, SectionHeader, ProgressBar, ProgressRing, EmptyState, Button, EditorialBanner } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

const MONTHS_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

type HeatmapData = Record<string, number>;

const BAR_COUNT = 14;
const BAR_GAP = 3;
const CHART_H = 80;

export function TrendChart({ data, width: winWidth = 375 }: { data: number[]; width?: number }) {
  const CHART_WIDTH = chartWidth(winWidth);
  const BAR_W = barWidth(CHART_WIDTH, BAR_COUNT, BAR_GAP);
  const max = Math.max(...data, 1);
  // R07.07 — the chart as text, for screen readers.
  const text = seriesText('Son 14 gün tamamlanan', data.map((v, i) => ({ label: format(subDays(new Date(), BAR_COUNT - 1 - i), 'dd/MM'), value: v })));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={text}>
    <Svg width={CHART_WIDTH} height={CHART_H + 20}>
      {data.map((val, i) => {
        const barH = Math.max(4, Math.round((val / max) * CHART_H));
        const x = i * (BAR_W + BAR_GAP);
        const y = CHART_H - barH;
        const isToday = i === BAR_COUNT - 1;
        return (
          <Rect
            key={i}
            x={x} y={y}
            width={BAR_W} height={barH}
            rx={3}
            fill={isToday ? colors.primary : hexA(colors.primary, 0.28)}
          />
        );
      })}
      {/* Day labels — every 7 days */}
      {[0, 6, 13].map((i) => {
        const date = subDays(new Date(), BAR_COUNT - 1 - i);
        const label = format(date, 'dd/MM');
        const x = i * (BAR_W + BAR_GAP) + BAR_W / 2;
        return (
          <SvgText key={i} x={x} y={CHART_H + 14} textAnchor="middle" fill={colors.textFaint} fontSize={9}>
            {label}
          </SvgText>
        );
      })}
    </Svg>
    </View>
  );
}

export default function StatsScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [heatmap, setHeatmap] = useState<HeatmapData>({});
  const [heatRows, setHeatRows] = useState<readonly AggregateRow[]>([]);
  const [heatError, setHeatError] = useState(false);
  const [trend14, setTrend14] = useState<number[]>(Array(14).fill(0));
  const [areaComp30, setAreaComp30] = useState<Record<string, number>>({});
  const [view, setView] = useState<'ozet' | 'liste'>('ozet');
  const [categorizing, setCategorizing] = useState(false);
  const [selectedDay, setSelectedDay] = useState<{ date: string; count: number; ratio: number } | null>(null);
  const [totalCompletions, setTotalCompletions] = useState(0);
  const [todayCompletions, setTodayCompletions] = useState(0);
  const [monthCompletions, setMonthCompletions] = useState(0);
  const [partialData, setPartialData] = useState(false);

  const { habits, fetchHabits, updateHabit } = useHabitStore();
  const { fetchTasks } = useTaskStore();

  const now = new Date();
  const monthName = MONTHS_TR[now.getMonth()];
  const daysInCurrentMonth = getDaysInMonth(now);
  const dayOfMonth = now.getDate();
  const monthProgress = Math.min(Math.round((dayOfMonth / daysInCurrentMonth) * 100), 100);

  const activeHabits = habits.filter((h) => h.status === 'active');
  const waitingHabits = habits.filter((h) => h.status === 'waiting');
  const ideaHabits = habits.filter((h) => h.status === 'idea');
  const completedHabits = habits.filter((h) => h.status === 'completed');
  // Alışkanlık hattı (Kanban dağılımı) — yığılı oran + lejant
  const statusPipe = [
    { key: 'active', label: 'Aktif Odak', color: colors.success, count: activeHabits.length },
    { key: 'waiting', label: 'Bekleme', color: colors.warning, count: waitingHabits.length },
    { key: 'idea', label: 'Fikir', color: colors.textFaint, count: ideaHabits.length },
    { key: 'completed', label: 'Tamamlanan', color: colors.teal, count: completedHabits.length },
  ];

  // Yaşam alanı dağılımı (mevcut tüm alışkanlıklar) + aktiflerin tamamlama oranı
  const liveHabits = habits.filter((h) => h.status !== 'archived');
  const uncategorized = liveHabits.filter((h) => !h.life_area);
  const areaStats = LIFE_AREAS.map((a) => {
    const inArea = liveHabits.filter((h) => h.life_area === a.key);
    const activeInArea = inArea.filter((h) => h.status === 'active');
    const completions = activeInArea.reduce((sum, h) => sum + (areaComp30[h.id] ?? 0), 0);
    const possible = activeInArea.length * 30;
    const rate = possible > 0 ? Math.min(100, Math.round((completions / possible) * 100)) : 0;
    return { key: a.key, label: a.label, color: a.color, count: inArea.length, activeCount: activeInArea.length, rate };
  });
  const maxAreaCount = Math.max(1, ...areaStats.map((a) => a.count));
  // Radar: alan başına alışkanlık sayısı (denge / hangi alanda var-yok)
  const areaValues = areaStats.reduce((acc, a) => {
    acc[a.key] = Math.min(10, a.count);
    return acc;
  }, {} as Record<AreaKey, number>);
  const anyAreaHabits = areaStats.some((a) => a.count > 0);

  // Seri (streak): gün → tamamlama sayısı haritasından. ≥1 tamamlama = o gün "yapıldı".
  const { current: currentStreak, longest: longestStreak } = (() => {
    let current = 0;
    let cursor = new Date(now);
    // Gün bitmeden bugün boşsa seri kırılmasın → dünden başla
    if (!((heatmap[format(cursor, 'yyyy-MM-dd')] ?? 0) > 0)) cursor = subDays(cursor, 1);
    while ((heatmap[format(cursor, 'yyyy-MM-dd')] ?? 0) > 0) { current++; cursor = subDays(cursor, 1); }
    let longest = 0, run = 0;
    for (let i = 0; i < 365; i++) {
      const k = format(subDays(now, 364 - i), 'yyyy-MM-dd');
      if ((heatmap[k] ?? 0) > 0) { run++; if (run > longest) longest = run; } else { run = 0; }
    }
    return { current, longest };
  })();

  const todayRatio = activeHabits.length > 0 ? Math.min(1, todayCompletions / activeHabits.length) : 0;
  const noData = habits.length === 0 && totalCompletions === 0;

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    // Read the clock when the load RUNS, not when the component last
    // rendered -- see the note above about 00:01 refreshes.
    const now = new Date();
    const todayStr = format(now, 'yyyy-MM-dd');
    const monthPrefix = format(now, 'yyyy-MM');
    try {
      const user = await currentUser();
      if (!user) { setLoading(false); return; }

      // Plan §28: "No blocking dashboard query waterfall".
      //
      // Bu üç getirme BIRBIRINDEN BAĞIMSIZ -- hiçbiri diğerinin çıktısını
      // girdi olarak kullanmıyor; yalnızca `since` / `since30` tarih
      // dizgilerine ihtiyaç duyuyorlar ve o ikisi de yereldeki `now`'dan
      // hesaplanıyor. Daha önce üçü ayrı `await` satırlarında sıraya
      // dizilmişti; bu, veri bağımlılığı olduğu için değil, yalnızca her
      // `await` kendi satırında yazıldığı için oluşan bir şelaleydi:
      // Stats sekmesi dört ardışık gidiş-dönüş bekliyordu.
      //
      // `app/tabs/today.tsx:74` aynı işi zaten tek `Promise.all` ile yapıyor
      // -- desen depoda mevcuttu, burada kullanılmamıştı. İşleme mantığı
      // aşağıda aynen duruyor; değişen tek şey bekleme biçimi.
      const since = format(subDays(now, 364), 'yyyy-MM-dd');
      const since30 = format(subDays(now, 29), 'yyyy-MM-dd');
      const [heatmapRes, logs30Res] = await Promise.all([
        fetchHabitLogsHeatmap({ since }),
        fetchHabitIdsCompletedSince({ since: since30 }),
        fetchHabits(),
        fetchTasks(),
      ]);

      if (heatmapRes.ok) {
        setPartialData(false);
        setHeatError(false);
        const data = heatmapRes.data;
        setHeatRows(data);
        const map: HeatmapData = {};
        let total = 0;
        let today = 0;
        let month = 0;

        data.forEach((row) => {
          map[row.completed_at] = (map[row.completed_at] ?? 0) + 1;
          total++;
          if (row.completed_at === todayStr) today++;
          if (row.completed_at?.startsWith(monthPrefix)) month++;
        });

        setHeatmap(map);
        setTotalCompletions(total);
        setTodayCompletions(today);
        setMonthCompletions(month);

        // 14 günlük trend dizisi
        const arr = Array.from({ length: 14 }, (_, i) => {
          const d = format(subDays(now, 13 - i), 'yyyy-MM-dd');
          return map[d] ?? 0;
        });
        setTrend14(arr);
      } else {
        setHeatError(true);
        setPartialData(heatmapRes.code === 'TOO_LARGE');
      }

      // Son 30 gün — alan performansı için habit_id bazlı tamamlamalar
      // (habit_logs). Getirme yukarıdaki toplu `Promise.all` içinde yapıldı.
      if (logs30Res.ok) {
        const cmap: Record<string, number> = {};
        logs30Res.data.forEach((r) => { if (r.habit_id) cmap[r.habit_id] = (cmap[r.habit_id] ?? 0) + 1; });
        setAreaComp30(cmap);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [fetchHabits, fetchTasks]);

  useEffect(() => { loadData(); }, [loadData]);

  const onRefresh = useCallback(async () => {
    haptic.light();
    setRefreshing(true);
    await loadData(true);
    setRefreshing(false);
  }, [loadData]);

  const avgPerDay = dayOfMonth > 0 ? decimalTR(Math.round((monthCompletions / dayOfMonth) * 10) / 10) : '0';

  function renderHeatmap() {
    const D = Math.max(1, activeHabits.length);
    const aggModel = buildAggregateYearGrid({
      rows: heatRows,
      todayYmd: ymd(now),
      capacity: D,
    });

    function onPickHeatDay(day: string | null) {
      if (!day) {
        setSelectedDay(null);
        return;
      }
      const count = heatmap[day] ?? 0;
      setSelectedDay({ date: day, count, ratio: Math.min(1, count / D) });
    }

    const selectedDateObj = selectedDay ? (parseLocalDate(selectedDay.date) ?? now) : null;

    return (
      <View style={s.heatmapCard}>
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={118} opacity={0.14} />
        <Text style={s.cardTitle}>Yıllık Aktivite</Text>
        <Text style={s.cardSub}>Son 365 gün · günlük tamamlama oranı (yapılan / aktif alışkanlık)</Text>
        <KintsugiYearGrid
          mode="aggregate"
          model={aggModel}
          selected={selectedDay?.date ?? null}
          onSelect={onPickHeatDay}
          status={heatError ? 'error' : 'ready'}
          onRetry={() => { void loadData(); }}
        />

        {selectedDay && selectedDateObj && (
          <View style={s.heatDetail}>
            <View
              style={[
                s.heatDetailDot,
                { backgroundColor: selectedDay.ratio > 0 ? colors.success : colors.surfaceAlt },
              ]}
            />
            <Text style={s.heatDetailText}>
              {format(selectedDateObj, 'dd.MM.yyyy')} · %{Math.round(selectedDay.ratio * 100)} ({selectedDay.count}/{D} alışkanlık)
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.observatoryStats} textureSource={TEXTURES.topographic} scrim={0.64} tintColor={colors.primary} />
      {/* Görünüm sekmesi */}
      <View style={s.viewToggle}>
        {(['ozet', 'liste'] as const).map((v) => {
          const sel = view === v;
          return (
            <TouchableOpacity key={v} style={[s.vtBtn, sel && s.vtBtnSel]} onPress={() => { haptic.select(); setView(v); }}>
              <Ionicons name={v === 'ozet' ? 'bar-chart-outline' : 'list-outline'} size={15} color={sel ? colors.white : colors.textDim} />
              <Text style={[s.vtText, sel && s.vtTextSel]}>{v === 'ozet' ? 'Özet' : 'Liste'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {view === 'liste' ? (
        <HabitListView />
      ) : loading ? (
        <View style={s.loading}><ActivityIndicator size="large" color={colors.primary} /></View>
      ) : noData ? (
        <View style={s.emptyWrap}>
          <EmptyState
            icon="bar-chart-outline"
            title="Henüz veri yok"
            hint="İlk alışkanlığını ekle ve birkaç gün takip et — özetin burada canlanacak."
            ctaLabel="Alışkanlık Ekle"
            onCta={() => router.push('/tabs/timeline' as any)}
          />
        </View>
      ) : (
        <>
      <ScrollView
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >

        <EditorialBanner
          source={SCREEN_BANNERS.insightsObservatory}
          textureSource={TEXTURES.topographic}
          eyebrow="İSTATİSTİK PANOSU"
          title="Yıllık İrade Haritası"
          subtitle={`${monthName} ayı ilerlemesi ve 365 günlük ısı haritası.`}
          accentColor={colors.primary}
          minHeight={94}
          style={{ marginBottom: space.lg }}
        />
        {/* Hero — bugünün tamamlama halkası + seri */}
        <Card padding="lg" style={s.hero}>
          <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={116} opacity={0.16} />
          <ProgressRing progress={todayRatio} size={84} stroke={9} color={colors.success}>
            <Text style={s.heroRingPct}>{Math.round(todayRatio * 100)}%</Text>
          </ProgressRing>
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>Bugünün Durumu</Text>
            <Text style={s.heroSub}>
              {activeHabits.length === 0 ? 'Henüz aktif alışkanlık yok' : `${todayCompletions}/${activeHabits.length} alışkanlık tamamlandı`}
            </Text>
            <View style={s.streakRow}>
              <View style={s.streakItem}>
                <Ionicons name="flame" size={16} color={colors.warning} />
                <Text style={s.streakVal}>{currentStreak}</Text>
                <Text style={s.streakLabel}>gün seri</Text>
              </View>
              <View style={s.streakDivider} />
              <View style={s.streakItem}>
                <Ionicons name="trophy-outline" size={14} color={colors.primaryBright} />
                <Text style={s.streakVal}>{longestStreak}</Text>
                <Text style={s.streakLabel}>en uzun</Text>
              </View>
            </View>
          </View>
        </Card>

        <ChapterDivider source={DECOR.dividerSundial} label="GÖZLEMEVİ ANALİZİ" />
        {/* Alışkanlık hattı — yığılı oran + lejant (4 büyük kart yerine) */}
        <Card padding="lg" style={{ marginBottom: space.lg }}>
          <SectionHeader title="Alışkanlık Hattı" variant="overline" count={habits.length} />
          <View style={s.pipelineBar}>
            {statusPipe.every((p) => p.count === 0) ? (
              <View style={{ flex: 1, backgroundColor: colors.surfaceAlt }} />
            ) : (
              statusPipe.map((p) => p.count > 0 && (
                <View key={p.key} style={{ flex: p.count, backgroundColor: p.color }} />
              ))
            )}
          </View>
          <View style={s.pipelineLegend}>
            {statusPipe.map((p) => (
              <View key={p.key} style={s.pipeItem}>
                <View style={[s.pipeDot, { backgroundColor: p.color }]} />
                <Text style={s.pipeLabel}>{p.label}</Text>
                <Text style={s.pipeCount}>{p.count}</Text>
              </View>
            ))}
          </View>
        </Card>

        {/* Tamamlama metrikleri — tekrarsız (Bugün hero'da, Bu Ay aşağıda) */}
        <View style={s.statRow}>
          <StatTile value={habits.length} label="Toplam Alışkanlık" accent={colors.primaryBright} />
          <StatTile value={totalCompletions} label="Toplam Tamamlama" accent={colors.success} />
          <StatTile value={avgPerDay} label="Günlük Ort." accent={colors.warning} />
        </View>
        {partialData && (
          <Text style={s.partialNote} accessibilityLiveRegion="polite">
            Kayıt sayın çok büyük; gösterilen değerler eksik olabilir.
          </Text>
        )}

        {/* 14-Günlük Trend */}
        <View style={s.trendCard}>
          <Text style={s.cardTitle}>14 Günlük Trend</Text>
          <Text style={s.cardSub}>Günlük alışkanlık tamamlamaları</Text>
          <TrendChart data={trend14} width={width} />
        </View>

        {/* Heatmap — motivasyon öğesi yukarı taşındı */}
        {renderHeatmap()}

        {/* Yaşam Alanları */}
        <View style={s.areaCard}>
          <Text style={s.cardTitle}>Yaşam Alanları</Text>
          <Text style={s.cardSub}>Alanlara göre alışkanlık dağılımın · aktiflerin son 30g tamamlaması</Text>
          {anyAreaHabits ? (
            <>
              <View style={s.areaRadarWrap}>
                <AreaRadar values={areaValues} size={radarSize(width)} />
              </View>
              {areaStats.map((a) => (
                <View key={a.key} style={[s.areaRow, a.count === 0 && { opacity: 0.4 }]}>
                  <View style={[s.areaDot, { backgroundColor: a.color }]} />
                  <Text style={s.areaLabel}>{a.label}</Text>
                  <Text style={s.areaCount}>{a.count > 0 ? `${a.count} alışkanlık` : 'yok'}</Text>
                  <ProgressBar progress={a.count / maxAreaCount} color={a.color} height={6} style={{ flex: 1 }} />
                  <Text style={[s.areaPct, { color: a.activeCount > 0 ? a.color : colors.textFaint }]}>
                    {a.activeCount > 0 ? `%${a.rate}` : '—'}
                  </Text>
                </View>
              ))}
            </>
          ) : (
            <EmptyState
              icon="compass-outline"
              title="Henüz kategorilenmemiş"
              hint="Mevcut alışkanlıklarına yaşam alanı ata → buradaki dengeni gör."
              compact
            />
          )}
          {uncategorized.length > 0 && (
            <Button
              label={`${uncategorized.length} kategorisiz — Kategori Ata`}
              icon="pricetags-outline"
              variant="tonal"
              size="sm"
              onPress={() => { haptic.select(); setCategorizing(true); }}
              style={{ marginTop: space.md }}
            />
          )}
        </View>

        {/* Bu Ay */}
        <View style={s.monthCard}>
          <View style={s.monthHeader}>
            <Ionicons name="calendar-number-outline" size={18} color={colors.primary} />
            <Text style={s.cardTitle}>Bu Ay — {monthName} {now.getFullYear()}</Text>
          </View>
          <View style={s.monthStats}>
            <View style={s.monthStat}>
              <Text style={s.monthStatVal}>{monthCompletions}</Text>
              <Text style={s.monthStatLabel}>Tamamlama</Text>
            </View>
            <View style={s.monthDivider} />
            <View style={s.monthStat}>
              <Text style={s.monthStatVal}>{avgPerDay}</Text>
              <Text style={s.monthStatLabel}>Günlük Ort.</Text>
            </View>
            <View style={s.monthDivider} />
            <View style={s.monthStat}>
              <Text style={s.monthStatVal}>{dayOfMonth}/{daysInCurrentMonth}</Text>
              <Text style={s.monthStatLabel}>Gün Geçti</Text>
            </View>
          </View>
          <ProgressBar progress={monthProgress / 100} color={colors.primary} height={5} style={{ marginBottom: 6 }} />
          <Text style={s.monthBarLabel}>Ay ilerlemesi %{monthProgress}</Text>
        </View>

      </ScrollView>
        </>
      )}

      {/* Kategori atama modalı */}
      <Modal visible={categorizing} animationType="slide" transparent onRequestClose={() => setCategorizing(false)}>
        <View style={s.catOverlay}>
          <View style={s.catSheet}>
            <View style={s.catHead}>
              <Text style={s.catTitle}>Kategori Ata</Text>
              <TouchableOpacity onPress={() => setCategorizing(false)}>
                <Ionicons name="close" size={22} color={colors.textDim} />
              </TouchableOpacity>
            </View>
            <Text style={s.catSub}>Her alışkanlık için bir yaşam alanı seç</Text>
            {uncategorized.length === 0 ? (
              <View style={s.catDone}>
                <Ionicons name="checkmark-circle" size={32} color={colors.success} />
                <Text style={s.catDoneText}>Tüm alışkanlıklar kategorilendi 🎉</Text>
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 420 }}>
                {uncategorized.map((h) => (
                  <View key={h.id} style={s.catRow}>
                    <View style={s.catRowHead}>
                      <Ionicons name={(h.icon ?? 'star-outline') as any} size={16} color={h.color ?? colors.primary} />
                      <Text style={s.catRowName} numberOfLines={1}>{h.name}</Text>
                    </View>
                    <View style={s.catChips}>
                      {LIFE_AREAS.map((a) => (
                        <TouchableOpacity
                          key={a.key}
                          style={[s.catChip, { borderColor: a.color + '50' }]}
                          onPress={() => { haptic.success(); updateHabit(h.id, { life_area: a.key }); }}
                        >
                          <View style={[s.areaDot, { backgroundColor: a.color }]} />
                          <Text style={s.catChipText}>{a.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  viewToggle: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  vtBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 9,
    borderWidth: 1, borderColor: colors.border,
  },
  vtBtnSel: { backgroundColor: colors.primary, borderColor: colors.primary },
  vtText: { fontSize: 14, color: colors.textDim, fontWeight: '600' },
  vtTextSel: { color: colors.white },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  emptyWrap: { flex: 1, justifyContent: 'center', paddingHorizontal: space.xl },
  content: { padding: 16, paddingBottom: 80 },

  hero: { flexDirection: 'row', alignItems: 'center', gap: space.lg, marginBottom: space.lg },
  heroRingPct: { fontSize: 19, fontWeight: '800', color: colors.success },
  heroTitle: { ...font.h3, color: colors.text, marginBottom: 3 },
  heroSub: { ...font.bodySm, color: colors.textFaint, marginBottom: space.md },
  streakRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  streakItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  streakVal: { fontSize: 16, fontWeight: '800', color: colors.text },
  streakLabel: { fontSize: 11, color: colors.textFaint },
  streakDivider: { width: 1, height: 18, backgroundColor: colors.border },

  pipelineBar: { flexDirection: 'row', height: 12, borderRadius: 6, overflow: 'hidden', gap: 2, marginBottom: space.md, marginTop: 2 },
  pipelineLegend: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.sm },
  pipeItem: { width: '50%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  pipeDot: { width: 9, height: 9, borderRadius: 5 },
  pipeLabel: { flex: 1, fontSize: 13, color: colors.textDim },
  pipeCount: { fontSize: 14, fontWeight: '800', color: colors.text, marginRight: space.md },

  statRow: { flexDirection: 'row', gap: space.md, marginBottom: space.lg },
  partialNote: { fontSize: 12, color: colors.textFaint, lineHeight: 17, textAlign: 'center', marginBottom: space.md },

  monthCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  monthHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  monthStats: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  monthStat: { flex: 1, alignItems: 'center' },
  monthStatVal: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: 2 },
  monthStatLabel: { fontSize: 11, color: colors.textFaint },
  monthDivider: { width: 1, height: 32, backgroundColor: colors.coolBlack700 },
  monthBarBg: { height: 5, backgroundColor: colors.coolBlack700, borderRadius: 3, marginBottom: 6 },
  monthBarFill: { height: 5, backgroundColor: colors.primary, borderRadius: 3 },
  monthBarLabel: { fontSize: 11, color: colors.textFaint },

  trendCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },

  areaCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  areaRadarWrap: { alignItems: 'center', marginVertical: 10 },
  areaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  areaDot: { width: 10, height: 10, borderRadius: 5 },
  areaLabel: { fontSize: 13, color: colors.neutral200, width: 60 },
  areaCount: { fontSize: 10, color: colors.textFaint, width: 64 },
  areaBarBg: { flex: 1, height: 6, backgroundColor: colors.coolBlack700, borderRadius: 3, overflow: 'hidden' },
  areaBarFill: { height: '100%', borderRadius: 3 },
  areaPct: { fontSize: 12, fontWeight: '700', width: 40, textAlign: 'right' },
  areaEmpty: { alignItems: 'center', paddingVertical: 24, gap: 6 },
  areaEmptyText: { fontSize: 14, color: colors.textDim, fontWeight: '600' },
  areaEmptyHint: { fontSize: 12, color: colors.textFaint, textAlign: 'center' },
  catBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    marginTop: 12, paddingVertical: 10, borderRadius: 10,
    backgroundColor: hexA(colors.primary, 0.1), borderWidth: 1, borderColor: hexA(colors.primary, 0.25),
  },
  catBtnText: { fontSize: 13, color: colors.primary, fontWeight: '600' },

  catOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'flex-end' },
  catSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 32, maxHeight: '85%' },
  catHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  catTitle: { fontSize: 18, fontWeight: '800', color: colors.text },
  catSub: { fontSize: 12, color: colors.textFaint, marginTop: 2, marginBottom: 14 },
  catDone: { alignItems: 'center', paddingVertical: 30, gap: 8 },
  catDoneText: { fontSize: 14, color: colors.textDim, fontWeight: '600' },
  catRow: { backgroundColor: colors.bgElevated, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  catRowHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  catRowName: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '600' },
  catChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.surface, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 6, borderWidth: 1 },
  catChipText: { fontSize: 12, color: colors.textDim, fontWeight: '600' },
  heatmapCard: { backgroundColor: hexA(colors.surface, 0.92), borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border, marginBottom: 16, overflow: 'hidden', position: 'relative' },
  cardTitle: { fontFamily: fontFamily.serif, fontSize: 18, fontWeight: '400', letterSpacing: -0.3, color: colors.text, marginBottom: 2 },
  cardSub: { fontSize: 12, color: colors.textDim, marginBottom: 14 },
  heatDetail: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  heatDetailDot: { width: 11, height: 11, borderRadius: 2 },
  heatDetailText: { fontSize: 12, color: colors.neutral200, fontWeight: '600' },

});
