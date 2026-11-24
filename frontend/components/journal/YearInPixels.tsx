import { memo, useState, type JSX } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { MOODS, moodMeta } from '../../lib/journalMoods';
import { font, radius, space, type Palette } from '../../lib/tokens';
import { fitCellSize, YEAR_GRID_GAP } from '../../lib/yearGrid';
import {
  monthSummaryText,
  YEAR_PIXELS_TRUNCATED_NOTE,
  yearPixelsSummaryText,
  type PixelMonth,
  type YearPixelsModel,
} from '../../lib/yearPixels';
import Button from '../ui/Button';

export type YearInPixelsProps = {
  model: YearPixelsModel;
  truncated: boolean;
  scopeNote: string;
};

const PIXEL_COLUMNS = 31;
const MIN_CELL = 6;
const MAX_CELL = 14;
const MONTH_LABEL_WIDTH = space.xxl + space.xs; // 28dp
const LABEL_OFFSET = MONTH_LABEL_WIDTH + space.xs; // 32dp

type MonthRowProps = {
  month: PixelMonth;
  cellSize: number;
  emptyColor: string;
  futureBorderColor: string;
  labelStyle: object;
  rowStyle: object;
  cellsRowStyle: object;
};

const MonthRow = memo(function MonthRow({
  month,
  cellSize,
  emptyColor,
  futureBorderColor,
  labelStyle,
  rowStyle,
  cellsRowStyle,
}: MonthRowProps): JSX.Element {
  return (
    <View testID={`year-pixels-month-${month.month}`} style={rowStyle}>
      <Text style={labelStyle} maxFontSizeMultiplier={1.2}>
        {month.label}
      </Text>
      <View style={cellsRowStyle}>
        {month.cells.map((cell) => {
          const visual =
            cell.state === 'mood' && cell.mood !== null
              ? { backgroundColor: moodMeta(cell.mood)?.color ?? emptyColor }
              : cell.state === 'future'
                ? { backgroundColor: 'transparent', borderWidth: 1, borderColor: futureBorderColor }
                : { backgroundColor: emptyColor };
          return (
            <View
              key={cell.date}
              testID={`pixel-${cell.state}`}
              style={[
                {
                  width: cellSize,
                  height: cellSize,
                  borderRadius: radius.xs,
                },
                visual,
              ]}
            />
          );
        })}
      </View>
    </View>
  );
});

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.md,
      marginBottom: space.md,
      gap: space.sm,
    },
    title: {
      ...font.h3,
      color: c.text,
    },
    gridWrap: {
      gap: YEAR_GRID_GAP,
    },
    monthRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    monthLabel: {
      ...font.caption,
      color: c.textDim,
      width: MONTH_LABEL_WIDTH,
    },
    cellsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: YEAR_GRID_GAP,
      flex: 1,
    },
    legendRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: space.sm,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    legendSwatch: {
      width: 10,
      height: 10,
      borderRadius: radius.xs,
    },
    legendLabel: {
      ...font.caption,
      color: c.textFaint,
    },
    summaryList: {
      gap: space.xs,
      paddingVertical: space.xs,
      paddingHorizontal: space.sm,
      borderRadius: radius.sm,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.borderSubtle,
    },
    summaryItem: {
      ...font.caption,
      color: c.text,
    },
    note: {
      ...font.caption,
      color: c.textFaint,
    },
    truncatedNote: {
      ...font.caption,
      color: c.textDim,
    },
  });

export default function YearInPixels({
  model,
  truncated,
  scopeNote,
}: YearInPixelsProps): JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [innerWidth, setInnerWidth] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const cellSize =
    innerWidth > 0
      ? fitCellSize(innerWidth - LABEL_OFFSET, PIXEL_COLUMNS, YEAR_GRID_GAP, MIN_CELL, MAX_CELL)
      : MIN_CELL;

  function handleLayout(e: LayoutChangeEvent) {
    const w = e.nativeEvent.layout.width;
    if (Number.isFinite(w) && w > 0) {
      setInnerWidth(w);
    }
  }

  return (
    <View style={s.card}>
      <Text style={s.title} accessibilityRole="header">
        {`${model.year} ruh hali`}
      </Text>

      <View
        onLayout={handleLayout}
        accessible
        accessibilityRole="image"
        accessibilityLabel={yearPixelsSummaryText(model)}
        style={s.gridWrap}
      >
        {model.months.map((m) => (
          <MonthRow
            key={m.month}
            month={m}
            cellSize={cellSize}
            emptyColor={c.surfaceAlt}
            futureBorderColor={c.borderSubtle}
            labelStyle={s.monthLabel}
            rowStyle={s.monthRow}
            cellsRowStyle={s.cellsRow}
          />
        ))}
      </View>

      <View style={s.legendRow}>
        {MOODS.map((m) => (
          <View key={m.value} style={s.legendItem}>
            <View style={[s.legendSwatch, { backgroundColor: m.color }]} />
            <Text style={s.legendLabel}>{m.label}</Text>
          </View>
        ))}
      </View>

      <Button
        label="Aylara göre özet"
        variant="ghost"
        size="md"
        onPress={() => setExpanded((prev) => !prev)}
        accessibilityLabel="Aylara göre özet"
        accessibilityState={{ expanded }}
      />

      {expanded && (
        <View style={s.summaryList}>
          {model.months.map((m) => (
            <Text
              key={m.month}
              testID={`year-pixels-month-summary-${m.month}`}
              style={s.summaryItem}
            >
              {monthSummaryText(m)}
            </Text>
          ))}
        </View>
      )}

      <Text style={s.note}>{scopeNote}</Text>
      {truncated && <Text style={s.truncatedNote}>{YEAR_PIXELS_TRUNCATED_NOTE}</Text>}
    </View>
  );
}
