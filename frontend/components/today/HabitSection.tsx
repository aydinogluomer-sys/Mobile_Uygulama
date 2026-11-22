/**
 * F27 (PRF-14, PS-16) — Today ritual section with part-of-day collapsible groups,
 * plus contextual `HolidayCard` and `SetAsideCard`.
 */
import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { isMeasurableTracking } from '../../lib/habitEngine';
import { activePauseOn } from '../../lib/habitPauses';
import { haptic } from '../../lib/haptics';
import type { Habit } from '../../lib/supabase';
import {
  periodDoneLabel,
  type HabitGroup,
  type PartGroupKey,
  type TodayHabitSummary,
} from '../../lib/todaySelectors';
import { font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { DECOR } from '../../lib/visualAssets';
import { GoldMendShimmer } from '../motion';
import { EmbeddedFiligree } from '../spatial';
import { Button, Card, ProgressRing, SectionHeader } from '../ui';

const WIDE_GROUP_LIMIT = 6;

export type HabitSectionProps = {
  isWide: boolean;
  lowEnergy: boolean;
  showRing?: boolean;
  todayDate: Date;
  todayHabits: Habit[];
  groups: HabitGroup[];
  habitSummary: TodayHabitSummary;
  habitCopy: { metricSub: string; ringSub: string };
  lightDayCandidateCount: number;
  holidayActive: boolean;
  onBreakHabits: Habit[];
  periodDoneHabits: Habit[];
  stateOf: (habitId: string) => string | undefined;
  onHabitTap: (habit: Habit) => void;
  onToggleGroup: (key: PartGroupKey) => void;
  onOpenRing: () => void;
  onOpenTimeline: () => void;
  onOpenLightDay: () => void;
  onOpenHoliday: () => void;
};

export default function HabitSection(props: HabitSectionProps): React.JSX.Element {
  const {
    isWide,
    lowEnergy,
    showRing = false,
    todayDate,
    todayHabits,
    groups,
    habitSummary,
    habitCopy,
    lightDayCandidateCount,
    holidayActive,
    onBreakHabits,
    periodDoneHabits,
    stateOf,
    onHabitTap,
    onToggleGroup,
    onOpenRing,
    onOpenTimeline,
    onOpenLightDay,
    onOpenHoliday,
  } = props;

  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [showOnBreak, setShowOnBreak] = useState(true);
  const [showPeriodDone, setShowPeriodDone] = useState(true);

  const isDoneHabit = (habitId: string): boolean => {
    const st = stateOf(habitId);
    return st === 'done' || st === 'partial';
  };

  const filterForEnergy = (list: Habit[]): Habit[] =>
    lowEnergy ? list.filter((h) => (h.willpower_cost ?? 1) <= 2 || isDoneHabit(h.id)) : list;

  const renderHabitRow = (h: Habit) => {
    const done = isDoneHabit(h.id);
    const col = h.color ?? c.primary;
    return (
      <TouchableOpacity
        key={h.id}
        activeOpacity={0.75}
        style={[
          s.habitRow,
          done && { borderColor: hexA(c.success, 0.4), backgroundColor: hexA(c.success, 0.06) },
        ]}
        onPress={() => onHabitTap(h)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: done }}
        accessibilityLabel={`${h.name}${isMeasurableTracking(h.tracking_type) ? ', değer gir' : ''}`}
      >
        <View
          style={[
            s.habitCheck,
            { borderColor: done ? c.success : c.borderStrong },
            done && { backgroundColor: c.success },
          ]}
        >
          {done ? (
            <Ionicons name="checkmark" size={16} color={c.white} />
          ) : (
            <Ionicons name={(h.icon ?? 'ellipse-outline') as any} size={15} color={col} />
          )}
        </View>
        <Text style={[s.habitName, done && s.habitNameDone]} numberOfLines={1}>
          {h.name}
        </Text>
        <Ionicons
          name={done ? 'checkmark-circle' : 'ellipse-outline'}
          size={16}
          color={done ? c.success : c.textGhost}
        />
      </TouchableOpacity>
    );
  };

  const flatRows = filterForEnergy(
    isWide ? todayHabits.slice(0, WIDE_GROUP_LIMIT) : todayHabits,
  );
  const flatHiddenCount = Math.max(0, filterForEnergy(todayHabits).length - flatRows.length);

  return (
    <View style={s.sectionStack}>
      {showRing && (
        <Card padding="lg" onPress={onOpenRing}>
          <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={118} opacity={0.18} />
          <GoldMendShimmer triggerKey={habitSummary.completed} color={c.success} />
          <View style={s.ringCard}>
            <ProgressRing progress={habitSummary.pct} size={64} stroke={7} color={c.success}>
              <Text style={s.ringPct}>{Math.round(habitSummary.pct * 100)}%</Text>
            </ProgressRing>
            <View style={{ flex: 1 }}>
              <Text style={s.ringTitle}>Bugünün ritüelleri</Text>
              <Text style={s.ringSub}>{habitCopy.ringSub}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={c.textFaint} />
          </View>
        </Card>
      )}

      {todayHabits.length > 0 ? (
        <Card padding="lg">
          <SectionHeader
            title="RİTÜELLER · BUGÜN"
            variant="overline"
            actionLabel="Tümü →"
            onAction={onOpenTimeline}
          />
          {!showRing && <Text style={s.calmSub}>{habitCopy.ringSub}</Text>}

          {groups.length <= 1 ? (
            <View style={s.listStack}>
              {flatRows.map(renderHabitRow)}
              {flatHiddenCount > 0 && (
                <Button
                  label={`Tümü (${flatHiddenCount} daha) →`}
                  variant="ghost"
                  size="sm"
                  onPress={onOpenTimeline}
                />
              )}
            </View>
          ) : (
            <View style={s.groupsStack}>
              {groups.map((group) => {
                const filtered = filterForEnergy(group.habits);
                if (filtered.length === 0) return null;
                const visible = isWide ? filtered.slice(0, WIDE_GROUP_LIMIT) : filtered;
                const hiddenCount = filtered.length - visible.length;
                const actionVerb = group.open ? 'kapatmak için dokun' : 'açmak için dokun';

                return (
                  <View key={group.key} style={s.groupWrap}>
                    <TouchableOpacity
                      activeOpacity={0.75}
                      style={s.groupHeader}
                      onPress={() => {
                        haptic.select();
                        onToggleGroup(group.key);
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: group.open }}
                      accessibilityLabel={`${group.label}, ${filtered.length} ritüel, ${group.doneCount} tamamlandı, ${actionVerb}`}
                    >
                      <Text style={s.groupSummaryText}>
                        {group.open
                          ? `${group.label} · ${group.doneCount}/${filtered.length}`
                          : `${group.label} · ${filtered.length} ritüel`}
                      </Text>
                      <Ionicons
                        name={group.open ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={c.textFaint}
                      />
                    </TouchableOpacity>
                    {group.open && (
                      <View style={s.listStack}>
                        {visible.map(renderHabitRow)}
                        {hiddenCount > 0 && (
                          <Button
                            label={`Tümü (${hiddenCount} daha) →`}
                            variant="ghost"
                            size="sm"
                            onPress={onOpenTimeline}
                          />
                        )}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          )}

          <View style={s.ritualActionRow}>
            {lightDayCandidateCount > 0 && (
              <TouchableOpacity
                style={s.lightDayBtn}
                onPress={() => {
                  haptic.select();
                  onOpenLightDay();
                }}
                accessibilityRole="button"
                accessibilityLabel="Bugün daha az yapabilirim. Bugünkü ritüellerden bazılarını kenara koy."
              >
                <Ionicons name="leaf-outline" size={14} color={c.accent} />
                <Text style={s.lightDayBtnText}>Bugün daha az yapabilirim</Text>
              </TouchableOpacity>
            )}
            {!holidayActive && (
              <TouchableOpacity
                style={s.lightDayBtn}
                onPress={() => {
                  haptic.select();
                  onOpenHoliday();
                }}
                accessibilityRole="button"
                accessibilityLabel="Tatil modu. Birkaç gün bütün alışkanlıklara ara ver."
              >
                <Ionicons name="airplane-outline" size={14} color={c.textDim} />
                <Text style={s.lightDayBtnText}>Tatil modu</Text>
              </TouchableOpacity>
            )}
          </View>
        </Card>
      ) : (
        !showRing && (
          <Card padding="lg" onPress={onOpenTimeline}>
            <SectionHeader title="RİTÜELLER · BUGÜN" variant="overline" />
            <Text style={s.breakNote}>{habitCopy.ringSub}</Text>
          </Card>
        )
      )}

      {onBreakHabits.length > 0 && (
        <Card padding="lg">
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowOnBreak(!showOnBreak)}
            style={s.accordionHeader}
            accessibilityRole="button"
            accessibilityState={{ expanded: showOnBreak }}
            accessibilityLabel={`Arada olan ${onBreakHabits.length} alışkanlık`}
          >
            <SectionHeader title="ARADA" variant="overline" />
            <View style={s.counterBadge}>
              <Text style={s.counterBadgeText}>{onBreakHabits.length}</Text>
              <Ionicons
                name={showOnBreak ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={c.textFaint}
              />
            </View>
          </TouchableOpacity>
          {showOnBreak && (
            <View style={s.listStack}>
              {onBreakHabits.map((h) => {
                const p = activePauseOn(h, todayDate);
                return (
                  <View
                    key={h.id}
                    style={[s.habitRow, s.habitRowPeriodDone]}
                    accessible
                    accessibilityLabel={`${h.name}, arada${p?.end_date ? `, ${p.end_date} tarihine kadar` : ''}.`}
                  >
                    <View style={[s.habitCheck, { borderColor: c.borderStrong }]}>
                      <Ionicons name="cafe-outline" size={14} color={c.textDim} />
                    </View>
                    <Text style={s.habitName} numberOfLines={1}>
                      {h.name}
                    </Text>
                    <Text style={s.setAsideTag}>
                      {p?.end_date ? `${p.end_date}'e kadar` : 'arada'}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </Card>
      )}

      {periodDoneHabits.length > 0 && (
        <Card padding="lg">
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => setShowPeriodDone(!showPeriodDone)}
            style={s.accordionHeader}
            accessibilityRole="button"
            accessibilityState={{ expanded: showPeriodDone }}
            accessibilityLabel={`Bu dönem tamamlanan ${periodDoneHabits.length} alışkanlık`}
          >
            <SectionHeader title="BU DÖNEM TAMAM" variant="overline" />
            <View style={s.counterBadge}>
              <Text style={s.counterBadgeText}>{periodDoneHabits.length}</Text>
              <Ionicons
                name={showPeriodDone ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={c.textFaint}
              />
            </View>
          </TouchableOpacity>
          {showPeriodDone && (
            <View style={s.listStack}>
              {periodDoneHabits.map((h) => (
                <TouchableOpacity
                  key={h.id}
                  activeOpacity={0.75}
                  style={[s.habitRow, s.habitRowPeriodDone]}
                  onPress={() => onHabitTap(h)}
                  accessibilityRole="button"
                  accessibilityLabel={`${h.name}, ${periodDoneLabel(h)}. Yine de kaydetmek için dokun.`}
                >
                  <View
                    style={[
                      s.habitCheck,
                      { borderColor: c.success, backgroundColor: hexA(c.success, 0.25) },
                    ]}
                  >
                    <Ionicons name="checkmark-done" size={14} color={c.success} />
                  </View>
                  <Text style={[s.habitName, s.habitNameDone]} numberOfLines={1}>
                    {h.name}
                  </Text>
                  <Text style={s.periodDoneTag}>{periodDoneLabel(h)}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </Card>
      )}
    </View>
  );
}

export function HolidayCard(props: { endDate: string | null; onEnd: () => Promise<void> }): React.JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  return (
    <Card padding="lg">
      <SectionHeader title="TATİL MODU" variant="overline" />
      <Text style={s.breakNote}>
        {props.endDate ? `${props.endDate} tarihine kadar` : 'Sen bitirene kadar'} bütün alışkanlıklar arada:
        hesaba girmez, seriler köprü kurar, hatırlatıcı gelmez.
      </Text>
      <View style={s.holidayActionWrap}>
        <TouchableOpacity
          style={s.lightDayBtn}
          onPress={props.onEnd}
          accessibilityRole="button"
          accessibilityLabel="Tatili bugün bitir"
        >
          <Ionicons name="play-outline" size={14} color={c.textDim} />
          <Text style={s.lightDayBtnText}>Tatili bugün bitir</Text>
        </TouchableOpacity>
      </View>
    </Card>
  );
}

export function SetAsideCard(props: {
  habits: Habit[];
  onHabitTap?: (habit: Habit) => void;
}): React.JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [showSetAside, setShowSetAside] = useState(true);
  const setAsideHabits = props.habits;

  return (
    <Card padding="lg">
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => setShowSetAside(!showSetAside)}
        style={s.accordionHeader}
        accessibilityRole="button"
        accessibilityState={{ expanded: showSetAside }}
        accessibilityLabel={`Bugün hafifletilen ${setAsideHabits.length} alışkanlık`}
      >
        <SectionHeader title="BUGÜN HAFİFLETİLDİ" variant="overline" />
        <Ionicons
          name={showSetAside ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={c.textFaint}
        />
      </TouchableOpacity>
      {showSetAside && (
        <View style={s.listStack}>
          {setAsideHabits.map((h) => (
            <TouchableOpacity
              key={h.id}
              activeOpacity={0.75}
              style={[s.habitRow, s.habitRowPeriodDone]}
              onPress={() => props.onHabitTap?.(h)}
              accessibilityRole="button"
              accessibilityLabel={`${h.name}, bugün için kenara konuldu. Yine de yaptıysan dokun.`}
            >
              <View style={[s.habitCheck, { borderColor: c.borderStrong }]}>
                <Ionicons name="pause-outline" size={14} color={c.textDim} />
              </View>
              <Text style={s.habitName} numberOfLines={1}>
                {h.name}
              </Text>
              <Text style={s.setAsideTag}>bugün kenarda</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
    </Card>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    sectionStack: { gap: space.md },
    listStack: { gap: space.sm },
    groupsStack: { gap: space.md },
    groupWrap: { gap: space.xs },
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.sm,
      backgroundColor: hexA(c.surfaceAlt, 0.55),
    },
    groupSummaryText: {
      ...font.bodySm,
      color: c.textDim,
      fontWeight: '600',
    },
    calmSub: {
      ...font.caption,
      color: c.textFaint,
      marginBottom: space.sm,
    },
    ringCard: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
    ringPct: { ...font.metric, fontSize: 18, color: c.success },
    ringTitle: { ...font.h3, color: c.text, marginBottom: space.xs },
    ringSub: { ...font.bodySm, color: c.textFaint },
    habitRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: space.md,
      borderWidth: 1,
      borderColor: c.border,
      minHeight: 52,
    },
    habitRowPeriodDone: { opacity: 0.55 },
    habitCheck: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    habitName: { flex: 1, ...font.body, color: c.text },
    habitNameDone: { color: c.textFaint, textDecorationLine: 'line-through' },
    periodDoneTag: { ...font.overline, color: c.success, marginLeft: 'auto' },
    setAsideTag: { ...font.overline, color: c.textDim, marginLeft: 'auto' },
    ritualActionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
      marginTop: space.md,
    },
    lightDayBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      minHeight: 44,
      paddingVertical: space.xs,
      paddingHorizontal: space.sm,
      borderRadius: radius.sm,
      backgroundColor: hexA(c.surfaceAlt, 0.5),
    },
    lightDayBtnText: { ...font.caption, color: c.textDim, fontWeight: '600' },
    breakNote: { ...font.bodySm, color: c.textDim, lineHeight: 19 },
    holidayActionWrap: { marginTop: space.sm, alignSelf: 'flex-start' },
    accordionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: 44,
      paddingVertical: space.xs,
    },
    counterBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: hexA(c.surfaceAlt, 0.7),
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.full,
    },
    counterBadgeText: { ...font.caption, color: c.textFaint, fontWeight: '600' },
  });
