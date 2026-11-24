/**
 * F27 (NAV-13, PS-01) — Settings > Araçlar modular toggle panel for Today cards.
 *
 * Purely local state (`useDisclosureStore`): zero network calls, zero "new" badges or red dots.
 */
import React, { useMemo } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { useShallow } from 'zustand/react/shallow';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { isToolVisible, type TodayToolId } from '../../lib/disclosure';
import { font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { useDisclosureStore } from '../../store/disclosureStore';
import { useHabitStore } from '../../store/habitStore';
import { useRoutineRunnerStore } from '../../store/routineRunnerStore';
import { useTaskStore } from '../../store/taskStore';
import { Button } from '../ui';

const TOOL_ROWS: readonly { id: TodayToolId; label: string }[] = [
  { id: 'spark', label: 'Günün odak akışı' },
  { id: 'metrics', label: 'Sakin metrik kartları' },
  { id: 'segments', label: 'Görünüm filtreleri' },
  { id: 'balance', label: 'Denge paneli (deneyim puanı, irade dengesi, telafi rayı)' },
  { id: 'routine', label: 'Rutin kartı' },
  { id: 'strategy', label: 'Strateji ve OKR kartı' },
];

export default function TodayToolsSection(): React.JSX.Element {
  const c = useThemeColors();
  const styles = useThemedStyles(makeStyles);

  const { stage, choices, setTool, resetTools } = useDisclosureStore(
    useShallow((st) => ({
      stage: st.stage,
      choices: st.choices,
      setTool: st.setTool,
      resetTools: st.resetTools,
    })),
  );

  const habits = useHabitStore((st) => st.habits);
  const tasks = useTaskStore((st) => st.tasks);
  const runnerSession = useRoutineRunnerStore((st) => st.session);

  const ctx = useMemo(() => {
    const activeHabits = habits.filter((h) => h.status === 'active').length;
    const openTasks = tasks.filter((t) => !t.completed && t.status !== 'cancelled').length;
    return {
      itemCount: activeHabits + openTasks,
      routineActive: Boolean(runnerSession && runnerSession.status !== 'finished'),
    };
  }, [habits, tasks, runnerSession]);

  const hasExplicitChoices = Object.keys(choices).length > 0;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Araçlar</Text>
      <Text style={styles.description}>
        Bugün ekranında hangi kartların görüneceğini sen seçersin. Kapalı olanlar silinmez; istediğin zaman açılır.
      </Text>

      <View style={styles.card}>
        {TOOL_ROWS.map((row, idx) => {
          const visible = isToolVisible(row.id, stage, choices[row.id], ctx);
          return (
            <View
              key={row.id}
              style={[styles.row, idx > 0 && styles.rowDivider]}
            >
              <Text style={styles.rowLabel}>{row.label}</Text>
              <Switch
                value={visible}
                onValueChange={(next) => setTool(row.id, next ? 'on' : 'off')}
                accessibilityRole="switch"
                accessibilityLabel={row.label}
                trackColor={{ false: c.surfaceAlt, true: hexA(c.accent, 0.5) }}
                thumbColor={visible ? c.accent : c.textDim}
              />
            </View>
          );
        })}
      </View>

      {hasExplicitChoices && (
        <View style={styles.resetWrap}>
          <Button
            label="Önerilen düzene dön"
            variant="ghost"
            size="sm"
            onPress={resetTools}
          />
        </View>
      )}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    section: {
      marginBottom: space.xxl,
    },
    sectionTitle: {
      ...font.h3,
      color: c.text,
      marginBottom: space.xs,
    },
    description: {
      ...font.bodySm,
      color: c.textDim,
      lineHeight: 20,
      marginBottom: space.md,
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: space.lg,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.md,
      minHeight: 48,
      paddingVertical: space.sm,
    },
    rowDivider: {
      borderTopWidth: 1,
      borderTopColor: c.borderSubtle,
    },
    rowLabel: {
      ...font.body,
      color: c.text,
      flex: 1,
    },
    resetWrap: {
      marginTop: space.md,
      alignSelf: 'flex-start',
    },
  });
