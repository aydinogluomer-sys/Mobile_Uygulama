import { useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { colors, alphaHex, radius, space, font } from '../lib/tokens';
import { useLogStore } from '../store/logStore';
import { haptic } from '../lib/haptics';

const DAYS_OF_WEEK = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTH_NAMES = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];

export default function YearlyHeatmap() {
  const { logs } = useLogStore();
  const [selectedDay, setSelectedDay] = useState<{ date: string; count: number } | null>(null);

  // Tarihleri hesapla: Bugün dahil geriye doğru 52 hafta (364 gün)
  const { weeks, totalCompletions, activeDaysCount, maxDailyCompletions } = useMemo(() => {
    // Gün bazında log sayıları
    const countsByDate = new Map<string, number>();
    logs.forEach((log) => {
      const d = log.completed_at || (log as any).date;
      if (d) {
        const key = typeof d === 'string' ? d.slice(0, 10) : '';
        if (key) {
          countsByDate.set(key, (countsByDate.get(key) ?? 0) + 1);
        }
      }
    });

    const now = new Date();
    // Haftanın gününü 0 (Pzt) - 6 (Paz) yap
    const currentDayOfWeek = (now.getDay() + 6) % 7;

    // 52 hafta = 364 gün + mevcut haftanın kalan günleri
    const totalDays = 52 * 7;
    const startDate = new Date(now);
    startDate.setDate(now.getDate() - totalDays + (6 - currentDayOfWeek));

    const weeksList: {
      weekIndex: number;
      monthLabel?: string;
      days: { date: string; dateObj: Date; count: number; dayOfWeek: number }[];
    }[] = [];

    let currentWeek: { date: string; dateObj: Date; count: number; dayOfWeek: number }[] = [];
    let activeDays = 0;
    let maxDaily = 0;
    let totalCount = 0;

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate);
      d.setDate(startDate.getDate() + i);

      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateKey = `${y}-${m}-${day}`;

      const count = countsByDate.get(dateKey) ?? 0;
      if (count > 0) {
        activeDays++;
        totalCount += count;
        if (count > maxDaily) maxDaily = count;
      }

      const dayOfWeek = (d.getDay() + 6) % 7;
      currentWeek.push({ date: dateKey, dateObj: d, count, dayOfWeek });

      if (currentWeek.length === 7) {
        // Ay başı etiketini ilk gününden tespit et
        const firstDayOfMonth = currentWeek.find((item) => item.dateObj.getDate() <= 7);
        const monthLabel = firstDayOfMonth ? MONTH_NAMES[firstDayOfMonth.dateObj.getMonth()] : undefined;

        weeksList.push({
          weekIndex: weeksList.length,
          monthLabel,
          days: currentWeek,
        });
        currentWeek = [];
      }
    }

    return {
      weeks: weeksList,
      totalCompletions: totalCount,
      activeDaysCount: activeDays,
      maxDailyCompletions: maxDaily,
    };
  }, [logs]);

  function getColor(count: number) {
    if (count === 0) return colors.surfaceAlt;
    if (count === 1) return alphaHex(colors.success, '45');
    if (count <= 3) return alphaHex(colors.success, '80');
    return colors.success;
  }

  function handleDayPress(day: { date: string; count: number }) {
    haptic.select();
    setSelectedDay(day);
  }

  return (
    <View style={s.container}>
      <View style={s.header}>
        <View>
          <Text style={s.title}>Yıllık Aktivite Isı Haritası</Text>
          <Text style={s.subtitle}>
            Son 1 yılda {totalCompletions} tamamlama · {activeDaysCount} aktif gün{maxDailyCompletions > 0 ? ` · Zirve: ${maxDailyCompletions}/gün` : ''}
          </Text>
        </View>
        <View style={s.legend}>
          <Text style={s.legendText}>Az</Text>
          <View style={[s.legendBox, { backgroundColor: colors.surfaceAlt }]} />
          <View style={[s.legendBox, { backgroundColor: alphaHex(colors.success, '45') }]} />
          <View style={[s.legendBox, { backgroundColor: alphaHex(colors.success, '80') }]} />
          <View style={[s.legendBox, { backgroundColor: colors.success }]} />
          <Text style={s.legendText}>Çok</Text>
        </View>
      </View>

      {/* Grid: Yatay Kaydırılabilir */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.scrollContent}>
        {/* Sol tarafta gün kısaltmaları (Pzt, Çar, Cum) */}
        <View style={s.daysColumn}>
          {DAYS_OF_WEEK.map((d, i) => (
            <View key={d} style={s.dayLabelRow}>
              {i % 2 === 0 ? <Text style={s.dayLabel}>{d}</Text> : null}
            </View>
          ))}
        </View>

        {/* Haftalar */}
        <View style={s.weeksContainer}>
          {/* Ay etiketleri */}
          <View style={s.monthLabelsRow}>
            {weeks.map((w) => (
              <View key={w.weekIndex} style={s.monthLabelCell}>
                {w.monthLabel ? <Text style={s.monthText}>{w.monthLabel}</Text> : null}
              </View>
            ))}
          </View>

          {/* Hücreler sütunları */}
          <View style={s.matrixRow}>
            {weeks.map((w) => (
              <View key={w.weekIndex} style={s.weekCol}>
                {w.days.map((d) => {
                  const isSelected = selectedDay?.date === d.date;
                  return (
                    <TouchableOpacity
                      key={d.date}
                      style={[
                        s.dayCell,
                        { backgroundColor: getColor(d.count) },
                        isSelected && s.dayCellSelected,
                      ]}
                      onPress={() => handleDayPress(d)}
                      activeOpacity={0.7}
                      accessibilityRole="button"
                      accessibilityLabel={`${d.date}: ${d.count} tamamlama`}
                    />
                  );
                })}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>

      {/* Seçili Gün Detayı */}
      {selectedDay && (
        <View style={s.detailBanner}>
          <Text style={s.detailDate}>
            📅 {new Date(selectedDay.date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric', weekday: 'long' })}
          </Text>
          <Text style={s.detailCount}>
            {selectedDay.count > 0
              ? `${selectedDay.count} alışkanlık tamamlandı ✨`
              : 'Bu tarihte kayıtlı tamamlama yok'}
          </Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: space.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  title: {
    ...font.title,
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
  },
  subtitle: {
    ...font.caption,
    color: colors.textDim,
    marginTop: 1,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendText: {
    fontSize: 9,
    color: colors.textFaint,
  },
  legendBox: {
    width: 8,
    height: 8,
    borderRadius: 2,
  },

  scrollContent: {
    paddingVertical: space.xs,
  },
  daysColumn: {
    marginRight: 4,
    marginTop: 16,
    gap: 3,
  },
  dayLabelRow: {
    height: 11,
    justifyContent: 'center',
  },
  dayLabel: {
    fontSize: 8,
    color: colors.textFaint,
    fontWeight: '600',
  },

  weeksContainer: {
    gap: 4,
  },
  monthLabelsRow: {
    flexDirection: 'row',
    height: 12,
  },
  monthLabelCell: {
    width: 14,
    marginRight: 3,
  },
  monthText: {
    fontSize: 9,
    color: colors.textDim,
    fontWeight: '600',
  },

  matrixRow: {
    flexDirection: 'row',
    gap: 3,
  },
  weekCol: {
    gap: 3,
  },
  dayCell: {
    width: 11,
    height: 11,
    borderRadius: 2,
  },
  dayCellSelected: {
    borderWidth: 1.5,
    borderColor: colors.warning,
  },

  detailBanner: {
    marginTop: 4,
    paddingHorizontal: space.sm,
    paddingVertical: 6,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailDate: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.text,
  },
  detailCount: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.primary,
  },
});
