import { useMemo, useState, type JSX } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { font, radius, space, type Palette } from '../lib/tokens';
import { useThemedStyles } from '../hooks/useThemeColors';
import { todayLocal, type Ymd } from '../lib/date';
import { buildAggregateYearGrid, formatDayWithYearTR } from '../lib/yearGrid';
import type { HeatmapRow } from '../hooks/useHeatmapLogs';
import KintsugiYearGrid from './habits/KintsugiYearGrid';

export type YearlyHeatmapProps = {
  rows: readonly HeatmapRow[];
  status: 'loading' | 'ready' | 'error';
  error?: string | null;
  onRetry?: () => void;
  capacity: number;
  todayYmd?: Ymd;
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    container: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.md,
      gap: space.sm,
    },
    header: {
      gap: space.xs,
    },
    title: {
      ...font.h3,
      color: c.text,
    },
    subtitle: {
      ...font.caption,
      color: c.textDim,
    },
    detailBanner: {
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.sm,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.borderSubtle,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
    },
    detailDate: {
      ...font.caption,
      color: c.text,
      flex: 1,
    },
    detailCount: {
      ...font.caption,
      color: c.primary,
    },
  });

export default function YearlyHeatmap(p: YearlyHeatmapProps): JSX.Element {
  const s = useThemedStyles(makeStyles);
  const [selected, setSelected] = useState<Ymd | null>(null);
  const effectiveToday = p.todayYmd ?? todayLocal();

  const model = useMemo(
    () =>
      buildAggregateYearGrid({
        rows: p.rows,
        todayYmd: effectiveToday,
        capacity: p.capacity,
      }),
    [p.rows, effectiveToday, p.capacity],
  );

  const selectedCell = useMemo(() => {
    if (!selected) return null;
    return model.columns.flatMap((col) => col.cells).find((c) => c.date === selected) ?? null;
  }, [model, selected]);

  const selectedCount = selectedCell ? selectedCell.done + selectedCell.partial : 0;

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.title}>Yıllık Aktivite</Text>
        <Text style={s.subtitle}>
          Son 1 yılda {model.totalCompletions} tamamlama · {model.activeDays} aktif gün
          {model.peak > 0 ? ` · Zirve: ${model.peak}/gün` : ''}
        </Text>
      </View>

      <KintsugiYearGrid
        mode="aggregate"
        model={model}
        selected={selected}
        onSelect={setSelected}
        status={p.status}
        onRetry={p.onRetry}
      />

      {selectedCell && (
        <View style={s.detailBanner}>
          <Text style={s.detailDate}>{formatDayWithYearTR(selectedCell.date)}</Text>
          <Text style={s.detailCount}>
            {selectedCount > 0
              ? `${selectedCount} alışkanlık tamamlandı`
              : 'Bu tarihte kayıtlı tamamlama yok'}
          </Text>
        </View>
      )}
    </View>
  );
}
