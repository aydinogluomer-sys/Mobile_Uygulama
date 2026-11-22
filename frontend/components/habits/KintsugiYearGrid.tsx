import { useEffect, useRef, useState, type JSX } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import { font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { haptic } from '../../lib/haptics';
import type { Ymd } from '../../lib/date';
import {
  YEAR_GRID_CELL,
  YEAR_GRID_GAP,
  YEAR_GRID_ROWS,
  aggregateSummaryText,
  cellAtPoint,
  formatDayLongTR,
  gridContentWidth,
  nextSelectableDay,
  yearGridDayLabel,
  yearGridSummaryText,
  type AggregateCell,
  type AggregateGridModel,
  type YearCell,
  type YearGridModel,
} from '../../lib/yearGrid';
import Button from '../ui/Button';
import Skeleton from '../ui/Skeleton';
import GoldMendShimmer, { GoldVein } from '../motion/GoldMendShimmer';

export type KintsugiYearGridProps =
  | {
      mode: 'habit';
      model: YearGridModel | null;
      accent: string;
      selected: Ymd | null;
      onSelect: (day: Ymd | null) => void;
      status: 'loading' | 'ready' | 'error';
      onRetry?: () => void;
      repairedCount: number;
    }
  | {
      mode: 'aggregate';
      model: AggregateGridModel | null;
      accent?: string;
      selected: Ymd | null;
      onSelect: (day: Ymd | null) => void;
      status: 'loading' | 'ready' | 'error';
      onRetry?: () => void;
    };

const ROW_LABELS: readonly (string | null)[] = ['Pzt', null, 'Çar', null, 'Cum', null, null];
const AGG_ALPHAS: readonly number[] = [0, 0.28, 0.5, 0.75, 1];
const TOUCH_MIN = space.hh + space.xs; // 44dp
const ROW_AXIS_WIDTH = space.xxl + space.xs; // 28dp
const MONTH_HEADER_HEIGHT = space.lg; // 16dp

function StepperBtn({
  glyph,
  label,
  onStep,
  btnStyle,
  glyphStyle,
}: {
  glyph: string;
  label: string;
  onStep: () => void;
  btnStyle: ViewStyle;
  glyphStyle: object;
}) {
  return (
    <Pressable
      onPress={onStep}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={btnStyle}
    >
      <Text style={glyphStyle}>{glyph}</Text>
    </Pressable>
  );
}

function nextAggregateDay(
  m: AggregateGridModel,
  from: Ymd | null,
  dir: -1 | 1,
): Ymd | null {
  const selectable = m.columns.flatMap((col) => col.cells).filter((c) => !c.future);
  if (selectable.length === 0) return null;
  if (from === null) {
    return dir === -1 ? selectable[selectable.length - 1].date : selectable[0].date;
  }
  const idx = selectable.findIndex((c) => c.date === from);
  if (idx === -1) {
    if (dir === 1) return selectable.find((c) => c.date > from)?.date ?? null;
    for (let i = selectable.length - 1; i >= 0; i--) {
      if (selectable[i].date < from) return selectable[i].date;
    }
    return null;
  }
  const nextIdx = idx + dir;
  return nextIdx >= 0 && nextIdx < selectable.length ? selectable[nextIdx].date : null;
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      gap: space.sm,
    },
    summaryWrap: {
      position: 'relative',
      overflow: 'hidden',
      borderRadius: radius.sm,
      paddingVertical: space.xs,
    },
    summaryText: {
      ...font.caption,
      color: c.textDim,
    },
    skeletonWrap: {
      gap: space.sm,
      paddingVertical: space.xs,
    },
    errorWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      borderRadius: radius.md,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.border,
    },
    errorText: {
      ...font.bodySm,
      color: c.textDim,
      flex: 1,
    },
    retryBtn: {
      minWidth: TOUCH_MIN,
      minHeight: TOUCH_MIN,
    },
    scrollRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
    },
    axisCol: {
      width: ROW_AXIS_WIDTH,
      paddingTop: MONTH_HEADER_HEIGHT + space.xs,
      gap: YEAR_GRID_GAP,
    },
    axisCell: {
      height: YEAR_GRID_CELL,
      justifyContent: 'center',
    },
    axisText: {
      ...font.caption,
      color: c.textFaint,
    },
    matrixWrap: {
      gap: space.xs,
    },
    monthRow: {
      position: 'relative',
      height: MONTH_HEADER_HEIGHT,
    },
    monthLabel: {
      position: 'absolute',
      top: 0,
      ...font.caption,
      color: c.textDim,
    },
    columnsRow: {
      flexDirection: 'row',
      gap: YEAR_GRID_GAP,
    },
    weekCol: {
      gap: YEAR_GRID_GAP,
    },
    cellBase: {
      width: YEAR_GRID_CELL,
      height: YEAR_GRID_CELL,
      borderRadius: radius.xs,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    skipBar: {
      width: space.sm,
      height: 1.5,
      backgroundColor: c.textFaint,
    },
    noteDot: {
      position: 'absolute',
      right: 1,
      bottom: 1,
      width: 3,
      height: 3,
      borderRadius: radius.pill,
      backgroundColor: c.text,
    },
    stripRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: c.borderSubtle,
      paddingHorizontal: space.xs,
    },
    stepperBtn: {
      minWidth: TOUCH_MIN,
      minHeight: TOUCH_MIN,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
    },
    stepperGlyph: {
      ...font.bodySm,
      color: c.text,
    },
    stripCenter: {
      flex: 1,
      paddingVertical: space.xs,
    },
    stripText: {
      ...font.caption,
      color: c.text,
    },
    stripHint: {
      ...font.caption,
      color: c.textFaint,
    },
    legendWrap: {
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
      width: 11,
      height: 11,
      borderRadius: radius.xs,
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
    },
    legendLabel: {
      ...font.caption,
      color: c.textFaint,
    },
  });

export default function KintsugiYearGrid(props: KintsugiYearGridProps): JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const scrollRef = useRef<ScrollView | null>(null);
  const didInitialScrollRef = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(0);

  const repairedCount = props.mode === 'habit' ? props.repairedCount : 0;
  const prevRepairedRef = useRef(repairedCount);
  const [shimmerSeq, setShimmerSeq] = useState(0);

  useEffect(() => {
    if (repairedCount > prevRepairedRef.current) {
      setShimmerSeq((n) => n + 1);
    }
    prevRepairedRef.current = repairedCount;
  }, [repairedCount]);

  if (props.status === 'loading') {
    return (
      <View testID="year-grid-loading" style={s.skeletonWrap}>
        <Skeleton width="52%" height={12} />
        <Skeleton width="100%" height={YEAR_GRID_ROWS * (YEAR_GRID_CELL + YEAR_GRID_GAP)} />
      </View>
    );
  }

  if (props.status === 'error' || !props.model) {
    return (
      <View testID="year-grid-error" style={s.errorWrap}>
        <Text style={s.errorText} accessibilityLiveRegion="polite">
          Kayıtlar okunamadı. Tekrar dene.
        </Text>
        {props.onRetry && (
          <Button
            label="Tekrar dene"
            variant="tonal"
            size="md"
            onPress={props.onRetry}
            accessibilityLabel="Tekrar dene"
            style={s.retryBtn}
          />
        )}
      </View>
    );
  }

  const columnCount = props.model.columns.length;
  const matrixWidth = gridContentWidth(columnCount);
  const totalWidth = ROW_AXIS_WIDTH + matrixWidth;
  const scrollEnabled = viewportWidth <= 0 || totalWidth > viewportWidth;
  const pitch = YEAR_GRID_CELL + YEAR_GRID_GAP;

  function onLayoutContainer(e: LayoutChangeEvent) {
    setViewportWidth(e.nativeEvent.layout.width);
  }

  function onContentSizeChange() {
    if (!didInitialScrollRef.current && scrollEnabled) {
      didInitialScrollRef.current = true;
      scrollRef.current?.scrollToEnd?.({ animated: false });
    }
  }

  function handleGridPress(e: GestureResponderEvent) {
    if (!props.model) return;
    const ne = e?.nativeEvent as { locationX?: unknown; locationY?: unknown } | undefined;
    if (typeof ne?.locationX !== 'number' || typeof ne?.locationY !== 'number') return;
    const hit = cellAtPoint(ne.locationX, ne.locationY, props.model.columns.length);
    if (!hit) return;
    const cell = props.model.columns[hit.column]?.cells[hit.row];
    if (!cell) return;
    if (props.mode === 'habit' && (cell as YearCell).state === 'future') return;
    if (props.mode === 'aggregate' && (cell as AggregateCell).future) return;
    haptic.select();
    props.onSelect(props.selected === cell.date ? null : cell.date);
  }

  function stepDay(dir: -1 | 1) {
    if (!props.model) return;
    const next =
      props.mode === 'habit'
        ? nextSelectableDay(props.model, props.selected, dir)
        : nextAggregateDay(props.model, props.selected, dir);
    if (next) {
      haptic.select();
      props.onSelect(next);
    }
  }

  const summaryLabel =
    props.mode === 'habit'
      ? yearGridSummaryText(props.model)
      : aggregateSummaryText(props.model);

  const habitAccent = props.mode === 'habit' ? props.accent : (props.accent ?? c.success);

  function renderHabitCell(cell: YearCell) {
    const isSel = props.selected === cell.date;
    const missedBg = hexA(c.textFaint, 0.18);

    let cellVisual = {};
    if (cell.state === 'done') {
      cellVisual = { backgroundColor: habitAccent };
    } else if (cell.state === 'partial') {
      cellVisual = {
        backgroundColor: hexA(habitAccent, 0.45),
        borderWidth: 1,
        borderColor: habitAccent,
      };
    } else if (cell.state === 'skip') {
      cellVisual = {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: c.border,
      };
    } else if (cell.state === 'missed') {
      cellVisual = { backgroundColor: missedBg };
    } else if (cell.state === 'repaired') {
      cellVisual = {
        backgroundColor: missedBg,
        borderWidth: 1,
        borderColor: hexA(c.warning, 0.55),
      };
    } else if (cell.state === 'not_scheduled' || cell.state === 'unknown') {
      cellVisual = {
        backgroundColor: 'transparent',
        borderWidth: 1,
        borderColor: c.borderSubtle,
      };
    } else if (cell.state === 'pending') {
      cellVisual = {
        backgroundColor: 'transparent',
        borderWidth: 1.5,
        borderColor: habitAccent,
        borderRadius: radius.pill,
      };
    } else {
      cellVisual = { backgroundColor: 'transparent' };
    }

    const selBorder = isSel
      ? { borderWidth: 2, borderColor: cell.state === 'done' ? c.text : habitAccent }
      : null;

    return (
      <View
        key={cell.date}
        testID={`year-cell-${cell.state}`}
        style={[s.cellBase, cellVisual, selBorder]}
      >
        {cell.state === 'skip' && <View style={s.skipBar} />}
        {cell.state === 'repaired' && (
          <GoldVein length={YEAR_GRID_CELL + 4} color={c.warning} angle={-45} />
        )}
        {cell.hasNote && <View style={s.noteDot} />}
      </View>
    );
  }

  function renderAggregateCell(cell: AggregateCell) {
    const isSel = props.selected === cell.date;
    const bg = cell.future
      ? 'transparent'
      : cell.level === 0
        ? c.surfaceAlt
        : hexA(habitAccent, AGG_ALPHAS[cell.level]);

    return (
      <View
        key={cell.date}
        testID={`year-agg-cell-${cell.level}`}
        style={[
          s.cellBase,
          { backgroundColor: bg },
          isSel && { borderWidth: 2, borderColor: c.text },
        ]}
      />
    );
  }

  const selectedHabitCell: YearCell | null =
    props.mode === 'habit' && props.selected
      ? (props.model.columns.flatMap((col) => col.cells).find((cl) => cl.date === props.selected) ??
        null)
      : null;

  const selectedAggregateCell: AggregateCell | null =
    props.mode === 'aggregate' && props.selected
      ? (props.model.columns.flatMap((col) => col.cells).find((cl) => cl.date === props.selected) ??
        null)
      : null;

  const stripText =
    props.mode === 'habit'
      ? selectedHabitCell
        ? yearGridDayLabel(selectedHabitCell)
        : null
      : selectedAggregateCell
        ? `${formatDayLongTR(selectedAggregateCell.date)}: ${selectedAggregateCell.done + selectedAggregateCell.partial} tamamlama`
        : null;

  return (
    <View style={s.root} onLayout={onLayoutContainer}>
      {props.mode === 'habit' && (
        <View style={s.summaryWrap}>
          <Text style={s.summaryText}>{summaryLabel}</Text>
          <GoldMendShimmer triggerKey={shimmerSeq} color={c.warning} />
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        horizontal
        scrollEnabled={scrollEnabled}
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={onContentSizeChange}
      >
        <View style={s.scrollRow}>
          <View
            style={s.axisCol}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            {ROW_LABELS.map((lbl, idx) => (
              <View key={idx} style={s.axisCell}>
                {lbl ? (
                  <Text style={s.axisText} maxFontSizeMultiplier={1.2}>
                    {lbl}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>

          <View style={s.matrixWrap}>
            <View
              style={[s.monthRow, { width: matrixWidth }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {props.model.columns.map((col, colIdx) =>
                col.monthLabel ? (
                  <Text
                    key={col.weekStart}
                    maxFontSizeMultiplier={1.2}
                    style={[s.monthLabel, { left: colIdx * pitch }]}
                  >
                    {col.monthLabel}
                  </Text>
                ) : null,
              )}
            </View>

            <View accessible accessibilityRole="image" accessibilityLabel={summaryLabel}>
              <Pressable
                accessible={false}
                testID="year-grid-surface"
                onPress={handleGridPress}
              >
                <View pointerEvents="none" style={s.columnsRow}>
                  {props.mode === 'habit'
                    ? props.model.columns.map((col) => (
                        <View key={col.weekStart} style={s.weekCol}>
                          {col.cells.map(renderHabitCell)}
                        </View>
                      ))
                    : props.model.columns.map((col) => (
                        <View key={col.weekStart} style={s.weekCol}>
                          {col.cells.map(renderAggregateCell)}
                        </View>
                      ))}
                </View>
              </Pressable>
            </View>
          </View>
        </View>
      </ScrollView>

      <View style={s.stripRow}>
        <StepperBtn
          glyph="‹"
          label="Önceki gün"
          onStep={() => stepDay(-1)}
          btnStyle={s.stepperBtn}
          glyphStyle={s.stepperGlyph}
        />
        <View style={s.stripCenter} accessibilityLiveRegion="polite">
          {stripText ? (
            <Text style={s.stripText}>{stripText}</Text>
          ) : (
            <Text style={s.stripHint}>Gün seçmek için ızgaraya dokun veya ‹ › kullan.</Text>
          )}
        </View>
        <StepperBtn
          glyph="›"
          label="Sonraki gün"
          onStep={() => stepDay(1)}
          btnStyle={s.stepperBtn}
          glyphStyle={s.stepperGlyph}
        />
      </View>

      {props.mode === 'habit' ? (
        <View style={s.legendWrap}>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, { backgroundColor: habitAccent }]} />
            <Text style={s.legendLabel}>Tamamlandı</Text>
          </View>
          <View style={s.legendItem}>
            <View
              style={[
                s.legendSwatch,
                {
                  backgroundColor: hexA(habitAccent, 0.45),
                  borderWidth: 1,
                  borderColor: habitAccent,
                },
              ]}
            />
            <Text style={s.legendLabel}>Kısmi</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, { borderWidth: 1, borderColor: c.border }]}>
              <View style={s.skipBar} />
            </View>
            <Text style={s.legendLabel}>Atlandı</Text>
          </View>
          <View style={s.legendItem}>
            <View
              style={[
                s.legendSwatch,
                {
                  backgroundColor: hexA(c.textFaint, 0.18),
                  borderWidth: 1,
                  borderColor: hexA(c.warning, 0.55),
                },
              ]}
            >
              <GoldVein length={14} color={c.warning} angle={-45} />
            </View>
            <Text style={s.legendLabel}>Telafi edildi</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, { backgroundColor: hexA(c.textFaint, 0.18) }]} />
            <Text style={s.legendLabel}>Kaçırıldı</Text>
          </View>
          <View style={s.legendItem}>
            <View style={[s.legendSwatch, { borderWidth: 1, borderColor: c.borderSubtle }]} />
            <Text style={s.legendLabel}>Planlı değil</Text>
          </View>
          <View style={s.legendItem}>
            <View
              style={[
                s.legendSwatch,
                { borderWidth: 1.5, borderColor: habitAccent, borderRadius: radius.pill },
              ]}
            />
            <Text style={s.legendLabel}>Bugün</Text>
          </View>
        </View>
      ) : (
        <View style={s.legendWrap}>
          <Text style={s.legendLabel}>Az</Text>
          {([0, 1, 2, 3, 4] as const).map((lvl) => (
            <View
              key={lvl}
              style={[
                s.legendSwatch,
                {
                  backgroundColor:
                    lvl === 0 ? c.surfaceAlt : hexA(habitAccent, AGG_ALPHAS[lvl]),
                },
              ]}
            />
          ))}
          <Text style={s.legendLabel}>Çok</Text>
        </View>
      )}
    </View>
  );
}
