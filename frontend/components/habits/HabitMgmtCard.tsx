import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Habit } from '../../lib/supabase';
import { t } from '../../lib/i18n';
import { impactMeta } from '../../lib/triage';
import { isMeasurableTracking } from '../../lib/habitEngine';
import { alphaHex, font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { IconButton } from '../ui';

export type HabitMgmtCardProps = {
  habit: Habit;
  cue?: string | null;
  onActivate: (habit: Habit) => void;
  onComplete: (habit: Habit) => void;
  onMoveToWaiting: (habit: Habit) => void;
  onReopen: (habit: Habit) => void;
  onRemove: (habit: Habit) => void;
};

export default function HabitMgmtCard({
  habit,
  cue,
  onActivate,
  onComplete,
  onMoveToWaiting,
  onReopen,
  onRemove,
}: HabitMgmtCardProps): React.JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const imp = habit.impact_level ? impactMeta(habit.impact_level) : null;
  const isIdea = habit.status === 'idea';
  const isCompleted = habit.status === 'completed';
  const tint = habit.color ?? c.primary;
  const iconName = (habit.icon ?? 'star-outline') as keyof typeof Ionicons.glyphMap;

  return (
    <View style={[s.mgmtCard, isIdea && s.mgmtCardIdea, isCompleted && s.mgmtCardDone]}>
      <View style={[s.iconWrap, { backgroundColor: alphaHex(tint, '25') }]}>
        <Ionicons name={iconName} size={22} color={tint} />
      </View>
      <View style={s.mgmtMeta}>
        <Text style={s.mgmtName}>{habit.name}</Text>
        <View style={s.rowBadges}>
          {imp && (
            <View
              style={[
                s.impactChip,
                { backgroundColor: alphaHex(imp.color, '20'), borderColor: alphaHex(imp.color, '40') },
              ]}
            >
              <View style={[s.impactChipDot, { backgroundColor: imp.color }]} />
              <Text style={[s.impactChipText, { color: imp.color }]}>{imp.label}</Text>
            </View>
          )}
          <View style={s.wpCostBadge}>
            <Ionicons name="flash" size={10} color={c.warning} />
            <Text style={s.wpCostText}>{habit.willpower_cost}</Text>
          </View>
          {isMeasurableTracking(habit.tracking_type) && (
            <View style={s.measurableBadge}>
              <Text style={s.measurableBadgeText}>📊 {habit.unit}</Text>
            </View>
          )}
        </View>
        {cue ? (
          <View style={s.cueRow}>
            <Ionicons name="link-outline" size={11} color={c.textFaint} />
            <Text style={s.cueText} numberOfLines={1}>
              {cue}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={s.cardActions}>
        {isCompleted ? (
          <TouchableOpacity
            style={s.moveBtn}
            onPress={() => onReopen(habit)}
            accessibilityRole="button"
            accessibilityLabel={t('habits.mgmt.reopen.a11y', { name: habit.name })}
          >
            <Ionicons name="refresh-outline" size={14} color={c.primary} />
            <Text style={s.moveBtnText}>{t('habits.mgmt.reopen')}</Text>
          </TouchableOpacity>
        ) : isIdea ? (
          <TouchableOpacity
            style={s.moveBtn}
            onPress={() => onMoveToWaiting(habit)}
            accessibilityRole="button"
            accessibilityLabel={t('habits.mgmt.moveToWaiting.a11y', { name: habit.name })}
          >
            <Ionicons name="arrow-up-circle-outline" size={14} color={c.primary} />
            <Text style={s.moveBtnText}>{t('habits.mgmt.wait')}</Text>
          </TouchableOpacity>
        ) : (
          <>
            <IconButton
              compact
              icon="checkmark-done-circle-outline"
              size={22}
              color={c.success}
              label={t('habits.mgmt.complete.a11y', { name: habit.name })}
              onPress={() => onComplete(habit)}
            />
            <IconButton
              compact
              icon="play-circle"
              size={26}
              color={c.success}
              label={t('habits.mgmt.activate.a11y', { name: habit.name })}
              onPress={() => onActivate(habit)}
            />
          </>
        )}
        <IconButton
          compact
          icon="trash-outline"
          size={16}
          color={c.error}
          label={t('habits.mgmt.delete.a11y', { name: habit.name })}
          style={s.trashBtn}
          onPress={() => onRemove(habit)}
        />
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    mgmtCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: space.md,
      marginBottom: space.sm,
      borderWidth: 1,
      borderColor: c.border,
      opacity: 0.92,
    },
    mgmtCardIdea: {
      opacity: 0.55,
      borderStyle: 'dashed',
    },
    mgmtCardDone: {
      opacity: 0.55,
      borderColor: hexA(c.success, 0.25),
    },
    iconWrap: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mgmtMeta: {
      flex: 1,
    },
    mgmtName: {
      ...font.body,
      fontWeight: '600',
      color: c.text,
      marginBottom: space.xs,
    },
    rowBadges: {
      flexDirection: 'row',
      gap: space.xs,
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    impactChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      borderRadius: radius.xs,
      paddingHorizontal: space.xs,
      paddingVertical: space.xs,
      borderWidth: 1,
    },
    impactChipDot: {
      width: 7,
      height: 7,
      borderRadius: radius.xs,
    },
    impactChipText: {
      ...font.caption,
      fontWeight: '600',
    },
    wpCostBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      backgroundColor: alphaHex(c.warning, '20'),
      borderRadius: radius.xs,
      paddingHorizontal: space.xs,
      paddingVertical: space.xs,
    },
    wpCostText: {
      ...font.caption,
      color: c.warning,
      fontWeight: '600',
    },
    measurableBadge: {
      backgroundColor: hexA(c.primary, 0.12),
      borderRadius: radius.xs,
      paddingHorizontal: space.xs,
      paddingVertical: space.xs,
    },
    measurableBadgeText: {
      ...font.caption,
      color: c.primary,
    },
    cueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      marginTop: space.xs,
    },
    cueText: {
      ...font.caption,
      color: c.textFaint,
      flex: 1,
    },
    cardActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    moveBtn: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      backgroundColor: hexA(c.primary, 0.12),
      borderRadius: radius.sm,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderWidth: 1,
      borderColor: hexA(c.primary, 0.19),
    },
    moveBtnText: {
      ...font.caption,
      color: c.primary,
      fontWeight: '600',
    },
    trashBtn: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      backgroundColor: alphaHex(c.error, '15'),
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: alphaHex(c.error, '30'),
    },
  });
