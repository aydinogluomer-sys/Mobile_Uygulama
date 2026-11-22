import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { DAY_CLOSE_COPY } from '../../lib/dayClose';
import { font, radius, space, type Palette } from '../../lib/tokens';
import { Button } from '../ui';

export type DayCloseRowView = {
  id: string;
  title: string;
  priority: 'high' | 'medium' | 'low' | 'none';
  decision: 'tomorrow' | 'release' | null;
};

export type DayCloseTasksProps = {
  rows: readonly DayCloseRowView[];
  hasMore: boolean;
  waitingForSync: boolean;
  onDecide: (taskId: string, decision: 'tomorrow' | 'release') => void;
  onUndo: (taskId: string) => void;
  onMoveAll: () => void;
};

function priorityDotColor(priority: DayCloseRowView['priority'], c: Palette): string {
  if (priority === 'high' || priority === 'medium') return c.warning;
  if (priority === 'low') return c.success;
  return c.textGhost;
}

export default function DayCloseTasks({
  rows,
  hasMore,
  waitingForSync,
  onDecide,
  onUndo,
  onMoveAll,
}: DayCloseTasksProps): React.JSX.Element | null {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);

  if (rows.length === 0) {
    return <Text style={s.emptyText}>{DAY_CLOSE_COPY.empty}</Text>;
  }

  const undecidedCount = rows.filter((r) => r.decision === null).length;

  return (
    <View style={s.section}>
      <View style={s.headerRow}>
        <Text style={s.title}>{DAY_CLOSE_COPY.tasksTitle}</Text>
        {undecidedCount >= 2 && (
          <Button
            label={DAY_CLOSE_COPY.moveAll}
            variant="tonal"
            size="sm"
            color={c.accent}
            onPress={onMoveAll}
            accessibilityRole="button"
            accessibilityLabel={DAY_CLOSE_COPY.moveAll}
            style={s.actionBtn}
          />
        )}
      </View>

      <View style={s.list}>
        {rows.map((row) => {
          const decided = row.decision !== null;
          const statusCopy =
            row.decision === 'tomorrow'
              ? DAY_CLOSE_COPY.tomorrowDone
              : DAY_CLOSE_COPY.releaseDone;

          return (
            <View key={row.id} style={s.rowCard}>
              <View style={s.rowTop}>
                <View
                  style={[s.dot, { backgroundColor: priorityDotColor(row.priority, c) }]}
                  accessible={false}
                />
                <Text style={s.rowTitle} numberOfLines={2}>
                  {row.title}
                </Text>
              </View>

              {!decided ? (
                <View style={s.actionsWrap}>
                  <Button
                    label={DAY_CLOSE_COPY.tomorrow}
                    variant="tonal"
                    size="sm"
                    color={c.accent}
                    onPress={() => onDecide(row.id, 'tomorrow')}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.title}: yarına taşı`}
                    style={s.actionBtn}
                  />
                  <Button
                    label={DAY_CLOSE_COPY.release}
                    variant="ghost"
                    size="sm"
                    color={c.textDim}
                    onPress={() => onDecide(row.id, 'release')}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.title}: Bir Gün listesine bırak`}
                    style={s.actionBtn}
                  />
                </View>
              ) : (
                <View style={s.decidedWrap}>
                  <View style={s.decidedTextCol}>
                    <Text style={s.doneText}>{statusCopy}</Text>
                    {waitingForSync && (
                      <Text style={s.syncText}>{DAY_CLOSE_COPY.waitingForSync}</Text>
                    )}
                  </View>
                  <Button
                    label={DAY_CLOSE_COPY.undo}
                    variant="ghost"
                    size="sm"
                    color={c.accent}
                    onPress={() => onUndo(row.id)}
                    accessibilityRole="button"
                    accessibilityLabel={`${row.title}: ${DAY_CLOSE_COPY.undo}`}
                    style={s.actionBtn}
                  />
                </View>
              )}
            </View>
          );
        })}
      </View>

      {hasMore && <Text style={s.moreText}>{DAY_CLOSE_COPY.moreHidden}</Text>}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    section: {
      gap: space.sm,
      marginBottom: space.sm,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: space.xs,
    },
    title: {
      ...font.caption,
      color: c.textDim,
      fontWeight: '700',
    },
    list: {
      gap: space.sm,
    },
    rowCard: {
      backgroundColor: c.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.sm,
      gap: space.xs,
    },
    rowTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: radius.full,
    },
    rowTitle: {
      flex: 1,
      ...font.bodySm,
      color: c.text,
      fontWeight: '600',
    },
    actionsWrap: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.xs,
      justifyContent: 'flex-end',
    },
    decidedWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      gap: space.xs,
    },
    decidedTextCol: {
      flex: 1,
      gap: space.xs,
    },
    doneText: {
      ...font.caption,
      color: c.textDim,
    },
    syncText: {
      ...font.caption,
      color: c.textFaint,
    },
    actionBtn: {
      minHeight: 44,
    },
    moreText: {
      ...font.caption,
      color: c.textFaint,
    },
    emptyText: {
      ...font.caption,
      color: c.textFaint,
    },
  });
