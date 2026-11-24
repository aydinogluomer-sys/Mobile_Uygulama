import { useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Animated, Easing, useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useIsFocused } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useShallow } from 'zustand/react/shallow';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import DayTimeStrip from '../../components/calendar/DayTimeStrip';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { blocksOn } from '../../lib/nextBlock';
import MonthBackground from '../../components/MonthBackground';
import SeasonalMotionPreview from '../../components/seasonalMotion/SeasonalMotionPreview';
import { useReducedMotion } from '../../components/seasonalMotion/useReducedMotion';
import { MONTH_TAGLINES_TR } from '../../components/seasonalMotion/config';
import GlassPanel from '../../components/ui/GlassPanel';
import { Button, Chip, SheetModal } from '../../components/ui';
import { EmbeddedFiligree } from '../../components/spatial';
import { DECOR } from '../../lib/visualAssets';
import { font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { ymd } from '../../lib/date';
import {
  buildDayPlanPreview,
  formatMinutesToHm,
  parseHmToMinutes,
  type FixedPlanBlock,
} from '../../lib/dayPlanPreview';
import { newOperationId } from '../../lib/outbox';
import {
  preserveDraftOnFailure,
  resolveScreenState,
  type ScreenStateDescriptor,
} from '../../lib/screenStateContract';
import {
  commitDayPlan,
  undoDayPlanCommit,
  type DayPlanCommitDeps,
  type DayPlanCommitReceipt,
} from '../../services/dayPlanCommitService';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export type CalendarTimePreset = {
  readonly id: string;
  readonly label: string;
  readonly start: string | null;
  readonly end: string | null;
};

export const CALENDAR_TIME_PRESETS: readonly CalendarTimePreset[] = [
  { id: '09:00-09:30', label: '09:00–09:30', start: '09:00', end: '09:30' },
  { id: '11:00-11:30', label: '11:00–11:30', start: '11:00', end: '11:30' },
  { id: '14:00-14:30', label: '14:00–14:30', start: '14:00', end: '14:30' },
  { id: '16:00-16:30', label: '16:00–16:30', start: '16:00', end: '16:30' },
  { id: '19:00-19:30', label: '19:00–19:30', start: '19:00', end: '19:30' },
  { id: 'clear', label: 'Saati kaldır', start: null, end: null },
];

export type CalendarScreenProps = {
  fixedBlocks?: readonly FixedPlanBlock[];
  commitDeps?: DayPlanCommitDeps;
};

const DAYS_SHORT = ['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const MONTH_TAGLINES = MONTH_TAGLINES_TR;

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Pazartesi = 0
}

export default function CalendarScreen({
  fixedBlocks: externalFixedBlocks,
  commitDeps,
}: CalendarScreenProps = {}) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const headerHeight = useHeaderHeight();
  const isFocused = useIsFocused();
  const { width } = useWindowDimensions();
  const isAlmanacSpread = width >= 960;
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState(ymd(today));
  const [showMotionPreview, setShowMotionPreview] = useState(false);

  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(CALENDAR_TIME_PRESETS[0].id);
  const [committingTime, setCommittingTime] = useState(false);
  const [undoingTime, setUndoingTime] = useState(false);
  const [panelFeedback, setPanelFeedback] = useState<ScreenStateDescriptor | null>(null);
  const [bannerState, setBannerState] = useState<ScreenStateDescriptor | null>(null);
  const [lastReceipt, setLastReceipt] = useState<DayPlanCommitReceipt | null>(null);

  const { tasks, fetchTasks } = useTaskStore(
    useShallow((st) => ({ tasks: st.tasks, fetchTasks: st.fetchTasks })),
  );
  const { habits, fetchHabits } = useHabitStore(
    useShallow((st) => ({ habits: st.habits, fetchHabits: st.fetchHabits })),
  );
  const fetchLogsForDate = useLogStore((st) => st.fetchLogsForDate);

  // Defter sayfası animasyonu: girişte "açılma", ay değişiminde yön bazlı "sayfa çevirme".
  const reduceMotion = useReducedMotion();
  const [pageAnim] = useState(() => new Animated.Value(1));
  const [flipDir, setFlipDir] = useState(0); // -1 önceki, 0 açılış, +1 sonraki

  const runPageAnimation = useCallback((dir: number) => {
    if (reduceMotion) { pageAnim.setValue(1); return; } // erişilebilirlik: animasyon yok
    pageAnim.setValue(0);
    Animated.timing(pageAnim, {
      toValue: 1,
      duration: dir === 0 ? 480 : 430,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [pageAnim, reduceMotion]);

  function animatePage(dir: number) {
    setFlipDir(dir);
    runPageAnimation(dir);
  }

  useEffect(() => { fetchTasks(); fetchHabits(); }, [fetchTasks, fetchHabits]);
  useEffect(() => { if (selected) fetchLogsForDate(selected); }, [selected, fetchLogsForDate]);
  // Ekran odağa gelince defter "açılır"
  useEffect(() => {
    if (isFocused) {
      runPageAnimation(0);
      return;
    }
    const frameId = requestAnimationFrame(() => setFlipDir(0));
    return () => cancelAnimationFrame(frameId);
  }, [isFocused, runPageAnimation]);

  function prevMonth() {
    if (month === 0) { setYear((y) => y - 1); setMonth(11); }
    else setMonth((m) => m - 1);
    animatePage(-1);
  }
  function nextMonth() {
    if (month === 11) { setYear((y) => y + 1); setMonth(0); }
    else setMonth((m) => m + 1);
    animatePage(1);
  }

  // Sayfa-çevirme stili (native driver: rotateY + translateX + opacity; sol cilt menteşesi)
  const pageStyle = {
    opacity: pageAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
    transformOrigin: 'left center' as const,
    transform: [
      { perspective: 900 },
      { rotateY: pageAnim.interpolate({ inputRange: [0, 1], outputRange: [`${flipDir === 0 ? 10 : flipDir * 16}deg`, '0deg'] }) },
      { translateX: pageAnim.interpolate({ inputRange: [0, 1], outputRange: [flipDir * 26, 0] }) },
    ],
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const todayStr = ymd(today);
  const selectedBlocks = useMemo(() => blocksOn(tasks, selected), [tasks, selected]);
  const nowTick = useMinuteClock(isFocused && selected === todayStr);

  function dateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function hasTask(day: number) {
    const d = dateStr(day);
    return tasks.some((t) => t.due_date?.startsWith(d));
  }

  const selectedTasks = useMemo(
    () => tasks.filter((t) => t.due_date?.startsWith(selected) && !t.completed && t.status !== 'cancelled'),
    [tasks, selected],
  );
  const untimedSelected = useMemo(
    () => selectedTasks.filter((t) => selectedBlocks.every((b) => b.id !== t.id)),
    [selectedTasks, selectedBlocks],
  );
  const selectedHabitLogs = habits.filter((h) => h.status === 'active');

  const editingTask = useMemo(
    () => (editingTaskId ? selectedTasks.find((t) => t.id === editingTaskId) ?? null : null),
    [editingTaskId, selectedTasks],
  );

  const chosenPreset = useMemo(
    () =>
      CALENDAR_TIME_PRESETS.find((p) => p.id === selectedPresetId) ??
      CALENDAR_TIME_PRESETS[0],
    [selectedPresetId],
  );

  function openTimeEditor(taskId: string) {
    const target = selectedTasks.find((t) => t.id === taskId);
    if (!target) return;
    const matched = CALENDAR_TIME_PRESETS.find(
      (p) =>
        p.start !== null &&
        p.start === (target.time_block_start ?? null) &&
        p.end === (target.time_block_end ?? null),
    );
    setSelectedPresetId(matched ? matched.id : CALENDAR_TIME_PRESETS[0].id);
    setPanelFeedback(null);
    setEditingTaskId(target.id);
  }

  function closeTimeEditor() {
    if (committingTime) return;
    setEditingTaskId(null);
    setPanelFeedback(null);
  }

  const slotPreview = useMemo(() => {
    if (!editingTask) return null;

    const peerFixedBlocks: FixedPlanBlock[] = selectedBlocks
      .filter((b) => b.id !== editingTask.id)
      .map((b) => {
        const startMin = parseHmToMinutes(b.startLabel) ?? 9 * 60;
        const endTime = b.endLabel ?? formatMinutesToHm(Math.min(1439, startMin + 30));
        return {
          id: b.id,
          title: b.title,
          local_day: selected,
          start_time: b.startLabel,
          end_time: endTime,
          locked: true,
          source: 'internal_fixed',
        };
      });

    const combinedFixedBlocks: FixedPlanBlock[] = [
      ...(externalFixedBlocks ?? []),
      ...peerFixedBlocks,
    ];

    const candidateTasks = tasks.map((t) =>
      t.id === editingTask.id
        ? {
            ...t,
            due_date: selected,
            time_block_start: chosenPreset.start,
            time_block_end: chosenPreset.end,
          }
        : t,
    );

    const preview = buildDayPlanPreview({
      userId: editingTask.user_id || 'local-user',
      localDayKey: selected,
      nowLocalMinutes: 8 * 60,
      generatedAtIso: `${selected}T08:00:00.000Z`,
      protectedRef: null,
      fixedBlocks: combinedFixedBlocks,
      tasks: candidateTasks,
      habits,
      todayLogs: [],
      remainingCapacityMinutes: 480,
    });

    const change =
      preview.changes.find(
        (c) => c.sourceRef.entity === 'task' && c.sourceRef.id === editingTask.id,
      ) ?? null;

    const conflictingBlock =
      change?.conflictingFixedBlockId
        ? combinedFixedBlocks.find((fb) => fb.id === change.conflictingFixedBlockId) ?? null
        : null;

    return {
      preview,
      change,
      conflictingBlock,
    };
  }, [editingTask, selectedBlocks, externalFixedBlocks, selected, tasks, chosenPreset, habits]);

  async function handleApplyTimeChange() {
    if (!editingTask || committingTime) return;
    setCommittingTime(true);
    setPanelFeedback(null);

    try {
      const executionDayKey = commitDeps?.now ? ymd(commitDeps.now()) : ymd(new Date());
      const res = await commitDayPlan(
        {
          operationId: newOperationId(),
          localDayKey: executionDayKey,
          items: [
            {
              itemId: `time-block:${editingTask.id}`,
              entity: 'task',
              targetId: editingTask.id,
              title: editingTask.title,
              expectedVersion: editingTask.updated_at ?? null,
              action: 'update_time_block',
              taskPatch: {
                time_block_start: chosenPreset.start,
                time_block_end: chosenPreset.end,
              },
              priorTaskSnapshot: {
                due_date: editingTask.due_date ?? null,
                list_type: editingTask.list_type,
                time_block_start: editingTask.time_block_start ?? null,
                time_block_end: editingTask.time_block_end ?? null,
              },
            },
          ],
        },
        commitDeps,
      );

      const firstItem = res.results[0];
      const succeeded = res.overall === 'committed' || res.overall === 'pending';
      const draftDecision = preserveDraftOnFailure(selectedPresetId, {
        ok: succeeded,
        status: firstItem?.status,
      });

      if (!draftDecision.shouldClearInput) {
        setSelectedPresetId(draftDecision.draft);
        setPanelFeedback(
          resolveScreenState({
            authReady: true,
            loading: false,
            hasCachedData: true,
            itemCount: selectedTasks.length,
            syncStatus: firstItem?.status ?? 'retryable',
            error: firstItem?.error
              ? {
                  retryable: firstItem.status === 'retryable',
                  message: firstItem.error,
                }
              : null,
          }),
        );
        return;
      }

      setLastReceipt(res.receipt);
      setBannerState(
        resolveScreenState({
          authReady: true,
          loading: false,
          hasCachedData: true,
          itemCount: selectedTasks.length,
          syncStatus: res.overall === 'pending' ? 'pending' : 'committed',
        }),
      );
      setEditingTaskId(null);
    } finally {
      setCommittingTime(false);
    }
  }

  async function handleUndoTimeChange() {
    if (!lastReceipt || undoingTime) return;
    setUndoingTime(true);
    try {
      const undoRes = await undoDayPlanCommit(lastReceipt, commitDeps);
      setLastReceipt(null);
      if (undoRes.overall === 'conflict') {
        setBannerState(
          resolveScreenState({
            authReady: true,
            loading: false,
            hasCachedData: true,
            itemCount: selectedTasks.length,
            syncStatus: 'conflict',
          }),
        );
      } else {
        setBannerState(null);
      }
    } finally {
      setUndoingTime(false);
    }
  }

  return (
    <View style={s.root}>
      {/* Görünen aya göre değişen, tam-ekran mevsimsel arka plan (crossfade'li + ambient hareket) */}
      <MonthBackground month={month} active={isFocused} />

      <SafeAreaView style={s.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={[s.content, { paddingTop: headerHeight + 8 }]}>
          <View style={isAlmanacSpread ? s.almanacSpread : undefined}>
            <View style={isAlmanacSpread ? s.almanacLeft : undefined}>
              {/* Defter sayfası — giriş "açılma" + ay değişiminde sayfa çevirme animasyonu */}
              <Animated.View style={pageStyle}>
                {/* Ajanda kapak başlığı — cam YOK; mevsim sahnesi + hareketi burada açıkça görünür */}
                <View style={s.hero}>
                  <View style={s.heroNavRow}>
                    <TouchableOpacity style={s.heroArrow} onPress={prevMonth} accessibilityRole="button" accessibilityLabel="Önceki ay">
                      <Ionicons name="chevron-back" size={22} color={colors.white} />
                    </TouchableOpacity>
                    <Text style={s.heroMonth} accessibilityRole="header">{MONTHS[month]}</Text>
                    <TouchableOpacity style={s.heroArrow} onPress={nextMonth} accessibilityRole="button" accessibilityLabel="Sonraki ay">
                      <Ionicons name="chevron-forward" size={22} color={colors.white} />
                    </TouchableOpacity>
                  </View>
                  <Text style={s.heroYear}>{year}</Text>
                  <Text style={s.heroTagline}>{MONTH_TAGLINES[month]}</Text>
                </View>

                {/* Takvim paneli — gün başlıkları + ızgara, cam üzerinde */}
                <GlassPanel style={s.panel}>
                  <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={112} opacity={0.14} />
                  <View style={s.weekRow}>
                    {DAYS_SHORT.map((d) => (
                      <Text key={d} style={s.dayHeader}>{d}</Text>
                    ))}
                  </View>

                  <View style={s.grid}>
                    {Array.from({ length: firstDay }).map((_, i) => (
                      <View key={`empty-${i}`} style={s.dayCell} />
                    ))}
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                      const ds = dateStr(day);
                      const isToday = ds === todayStr;
                      const isSelected = ds === selected;
                      const hasDot = hasTask(day);
                      return (
                        <TouchableOpacity
                          key={day}
                          style={[s.dayCell, isSelected && s.dayCellSelected, isToday && !isSelected && s.dayCellToday]}
                          onPress={() => setSelected(ds)}
                          accessibilityRole="button"
                          accessibilityLabel={`${day} ${MONTHS[month]} ${year}${isToday ? ', bugün' : ''}${hasDot ? ', görev var' : ''}`}
                          accessibilityState={{ selected: isSelected }}
                        >
                          <Text style={[s.dayText, isSelected && s.dayTextSelected, isToday && !isSelected && s.dayTextToday]}>
                            {day}
                          </Text>
                          {hasDot && <View style={[s.dot, isSelected && s.dotSelected]} />}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </GlassPanel>
              </Animated.View>
            </View>

            <View style={isAlmanacSpread ? s.almanacRight : undefined}>
              {/* Seçili gün görevleri */}
              <GlassPanel style={s.panel}>
                <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={108} opacity={0.16} />
                <Text style={s.sectionTitle} accessibilityRole="header">
                  {selected === todayStr ? 'BUGÜN' : selected} — GÖREVLER
                </Text>

                {bannerState !== null && (
                  <View
                    testID="calendar-time-feedback"
                    style={s.feedbackBanner}
                    accessibilityRole={bannerState.accessibilityRole}
                    accessibilityLiveRegion={bannerState.liveRegion}
                  >
                    <Ionicons
                      name={bannerState.nonColorIcon as IoniconName}
                      size={16}
                      color={bannerState.kind === 'conflict' ? colors.warning : colors.accent}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />
                    <Text style={s.feedbackText}>{bannerState.headline}</Text>
                    {lastReceipt !== null && (
                      <Button
                        label="Geri al"
                        variant="ghost"
                        size="sm"
                        icon="arrow-undo-outline"
                        loading={undoingTime}
                        testID="calendar-time-undo"
                        accessibilityLabel="Geri al"
                        onPress={handleUndoTimeChange}
                      />
                    )}
                  </View>
                )}

                {selectedTasks.length === 0 ? (
                  <Text style={s.noItem}>Bu gün için görev yok</Text>
                ) : (
                  <>
                    {selectedBlocks.length > 0 && (
                      <>
                        <DayTimeStrip blocks={selectedBlocks} now={selected === todayStr ? nowTick : null} />
                        {selectedBlocks.map((b) => (
                          <View key={`timed-${b.id}`} style={s.timedActionRow}>
                            <Text style={s.timedActionMeta} numberOfLines={1}>
                              {b.endLabel ? `${b.startLabel}–${b.endLabel}` : b.startLabel} · {b.title}
                            </Text>
                            <Chip
                              label="Saati değiştir"
                              icon="time-outline"
                              size="sm"
                              color={colors.accent}
                              testID={`calendar-change-time-${b.id}`}
                              accessibilityLabel={`${b.title} saatini değiştir`}
                              onPress={() => openTimeEditor(b.id)}
                            />
                          </View>
                        ))}
                      </>
                    )}
                    {untimedSelected.map((t) => (
                      <View key={t.id} style={s.item}>
                        <View style={[s.priorityDot, { backgroundColor: t.priority === 'high' ? colors.error : t.priority === 'medium' ? colors.warning : colors.success }]} />
                        <Text style={s.itemText}>{t.title}</Text>
                        <Chip
                          label="Saati değiştir"
                          icon="time-outline"
                          size="sm"
                          color={colors.accent}
                          testID={`calendar-change-time-${t.id}`}
                          accessibilityLabel={`${t.title} saatini değiştir`}
                          onPress={() => openTimeEditor(t.id)}
                        />
                      </View>
                    ))}
                  </>
                )}
              </GlassPanel>

              {/* Seçili gün alışkanlıkları */}
              <GlassPanel style={s.panelLast}>
                <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={108} opacity={0.14} />
                <Text style={s.sectionTitle} accessibilityRole="header">AKTIF ALIŞKANLIKLAR</Text>
                {selectedHabitLogs.length === 0 ? (
                  <Text style={s.noItem}>Aktif alışkanlık yok</Text>
                ) : (
                  selectedHabitLogs.slice(0, 5).map((h) => (
                    <View key={h.id} style={s.item}>
                      <Ionicons name={(h.icon ?? 'star-outline') as IoniconName} size={14} color={h.color ?? colors.primary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                      <Text style={s.itemText}>{h.name}</Text>
                    </View>
                  ))
                )}
              </GlassPanel>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>

      <SheetModal
        visible={editingTask !== null}
        onClose={closeTimeEditor}
        accessibilityLabel="Saati değiştir paneli"
      >
        {editingTask !== null && (
          <View testID="calendar-time-adjust-panel" style={s.adjustPanel}>
            <Text style={s.adjustOverline}>SAAT BLOĞU DÜZENLE</Text>
            <Text style={s.adjustTitle} numberOfLines={2}>
              {editingTask.title}
            </Text>

            <View style={s.slotGrid}>
              {CALENDAR_TIME_PRESETS.map((preset) => (
                <Chip
                  key={preset.id}
                  label={preset.label}
                  icon={preset.start ? 'time-outline' : 'close-circle-outline'}
                  color={colors.accent}
                  selected={selectedPresetId === preset.id}
                  testID={`calendar-time-slot-${preset.id}`}
                  onPress={() => setSelectedPresetId(preset.id)}
                />
              ))}
            </View>

            {slotPreview !== null && (
              <View testID="calendar-time-preview" style={s.previewBox}>
                <Text style={s.previewLabel}>
                  {chosenPreset.start
                    ? `Seçilen saat: ${chosenPreset.label}`
                    : 'Seçilen saat: Saatsiz (saat bloğu kaldırılır)'}
                </Text>
                {slotPreview.conflictingBlock !== null ? (
                  <View
                    testID="calendar-time-overlap-warning"
                    accessibilityRole="alert"
                    accessibilityLiveRegion="polite"
                    style={s.overlapRow}
                  >
                    <Ionicons
                      name="warning-outline"
                      size={16}
                      color={colors.warning}
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />
                    <Text style={s.overlapText}>
                      {`Bu aralık «${slotPreview.conflictingBlock.title}» (${slotPreview.conflictingBlock.start_time}–${slotPreview.conflictingBlock.end_time}) bloğuyla çakışıyor.`}
                    </Text>
                  </View>
                ) : (
                  <Text style={s.previewSub}>
                    {slotPreview.change?.displayReason ?? 'Kalan kapasiteye çakışmadan yerleşir.'}
                  </Text>
                )}
              </View>
            )}

            {panelFeedback !== null && (
              <View
                testID="calendar-time-panel-error"
                accessibilityRole={panelFeedback.accessibilityRole}
                accessibilityLiveRegion={panelFeedback.liveRegion}
                style={s.overlapRow}
              >
                <Ionicons
                  name={panelFeedback.nonColorIcon as IoniconName}
                  size={16}
                  color={colors.error}
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                />
                <Text style={s.errorText}>
                  {`${panelFeedback.headline} · ${panelFeedback.detail}`}
                </Text>
              </View>
            )}

            <View style={s.adjustActions}>
              <Button
                label="Vazgeç"
                variant="secondary"
                color={colors.textDim}
                onPress={closeTimeEditor}
                testID="calendar-time-cancel"
                style={s.adjustBtn}
              />
              <Button
                label="Saati kaydet"
                variant="primary"
                loading={committingTime}
                onPress={handleApplyTimeChange}
                testID="calendar-time-commit"
                style={s.adjustBtnPrimary}
              />
            </View>
          </View>
        )}
      </SheetModal>

      {/* DEV: mevsimsel hareket önizleme (yalnızca geliştirme) */}
      {__DEV__ && (
        <>
          <TouchableOpacity
            style={s.devBtn}
            onPress={() => setShowMotionPreview(true)}
            accessibilityRole="button"
            accessibilityLabel="Mevsimsel hareket önizlemesi"
          >
            <Ionicons name="sparkles-outline" size={16} color={colors.white} />
          </TouchableOpacity>
          <SeasonalMotionPreview visible={showMotionPreview} onClose={() => setShowMotionPreview(false)} />
        </>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg },
    safe: { flex: 1, backgroundColor: 'transparent' },
    content: { padding: 16, paddingBottom: 40 },

    almanacSpread: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 20,
    },
    almanacLeft: {
      flex: 1.15,
    },
    almanacRight: {
      flex: 0.95,
      paddingTop: 28,
    },

    panel: { marginBottom: 16, overflow: 'hidden', position: 'relative' },
    panelLast: { marginBottom: 0, overflow: 'hidden', position: 'relative' },

    // Ajanda kapak başlığı (cam yok → mevsim sahnesi/hareket görünür)
    hero: { minHeight: 156, alignItems: 'center', justifyContent: 'center', paddingVertical: 22, marginBottom: 6 },
    heroNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
    heroArrow: {
      width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
      backgroundColor: hexA(colors.bgSunk, 0.32), borderWidth: 1, borderColor: hexA(colors.white, 0.15),
    },
    heroMonth: {
      fontSize: 40, fontWeight: '800', color: colors.white, letterSpacing: 0.5,
      minWidth: 172, textAlign: 'center',
      textShadowColor: hexA(colors.black, 0.55), textShadowRadius: 10, textShadowOffset: { width: 0, height: 2 },
    },
    heroYear: {
      fontSize: 15, fontWeight: '600', color: hexA(colors.white, 0.82), marginTop: 4, letterSpacing: 3,
      textShadowColor: hexA(colors.black, 0.5), textShadowRadius: 6,
    },
    heroTagline: {
      fontSize: 13, color: hexA(colors.white, 0.85), marginTop: 8, fontStyle: 'italic', textAlign: 'center',
      textShadowColor: hexA(colors.black, 0.5), textShadowRadius: 6,
    },

    weekRow: { flexDirection: 'row', marginBottom: 8 },
    dayHeader: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.textDim, fontWeight: '600' },

    grid: { flexDirection: 'row', flexWrap: 'wrap' },
    dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
    dayCellSelected: { backgroundColor: colors.primary, borderRadius: 10 },
    dayCellToday: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10 },
    dayText: { fontSize: 14, color: colors.text },
    dayTextSelected: { color: colors.white, fontWeight: '700' },
    dayTextToday: { color: colors.primary, fontWeight: '700' },
    dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary },
    dotSelected: { backgroundColor: hexA(colors.white, 0.5) },

    sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textDim, letterSpacing: 1, marginBottom: 10 },
    noItem: { fontSize: 13, color: colors.textFaint, fontStyle: 'italic' },
    item: {
      flexDirection: 'row', alignItems: 'center', gap: 10,
      backgroundColor: hexA(colors.surface, 0.7), borderRadius: 10, padding: 12,
      borderWidth: 1, borderColor: hexA(colors.border, 0.8), marginBottom: 6,
    },
    priorityDot: { width: 8, height: 8, borderRadius: 4 },
    itemText: { fontSize: 14, color: colors.text, flex: 1 },

    timedActionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: space.sm,
      marginBottom: space.sm,
      paddingHorizontal: space.xs,
    },
    timedActionMeta: {
      ...font.caption,
      color: colors.textDim,
      flex: 1,
    },
    feedbackBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: space.sm,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      marginBottom: space.md,
    },
    feedbackText: {
      ...font.caption,
      color: colors.text,
      flex: 1,
    },
    adjustPanel: {
      gap: space.md,
    },
    adjustOverline: {
      ...font.overline,
      color: colors.textDim,
    },
    adjustTitle: {
      ...font.h3,
      color: colors.text,
    },
    slotGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
    },
    previewBox: {
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: space.md,
      gap: space.xs,
    },
    previewLabel: {
      ...font.bodySm,
      color: colors.text,
    },
    previewSub: {
      ...font.caption,
      color: colors.textDim,
    },
    overlapRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
    },
    overlapText: {
      ...font.caption,
      color: colors.warning,
      flex: 1,
    },
    errorText: {
      ...font.caption,
      color: colors.error,
      flex: 1,
    },
    adjustActions: {
      flexDirection: 'row',
      gap: space.md,
      marginTop: space.xs,
    },
    adjustBtn: {
      flex: 1,
    },
    adjustBtnPrimary: {
      flex: 2,
    },

    devBtn: {
      position: 'absolute', right: 14, bottom: 24, width: 40, height: 40, borderRadius: 20,
      backgroundColor: hexA(colors.bgSunk, 0.8), borderWidth: 1, borderColor: colors.border,
      alignItems: 'center', justifyContent: 'center',
    },
  });
