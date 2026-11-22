import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { actionSheet, notify, type DialogOption } from '../../lib/dialog';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useTaskStore } from '../../store/taskStore';
import { useCoreOutboxSync } from '../../hooks/useCoreOutboxSync';
import { type NextAction } from '../../lib/todayNext';
import { FLOW_COPY } from '../../lib/flowCopy';
import { useWillpowerStore } from '../../store/willpowerStore';
import { useFocusStore } from '../../store/focusStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import { useDisclosureStore } from '../../store/disclosureStore';
import { isToolVisible } from '../../lib/disclosure';
import { currentUser } from '../../lib/session';
import XPDisplay from '../../components/XPDisplay';
import TodayHero from '../../components/today/TodayHero';
import DayCloseEcho from '../../components/today/DayCloseEcho';
import DayCloseMood from '../../components/today/DayCloseMood';
import DayCloseTasks from '../../components/today/DayCloseTasks';
import MetricGrid, { type Metric } from '../../components/today/MetricGrid';
import NextUpStrip from '../../components/today/NextUpStrip';
import HabitSection, { HolidayCard, SetAsideCard } from '../../components/today/HabitSection';
import InlineComposer from '../../components/InlineComposer';
import RecoveryRailCard from '../../components/today/RecoveryRailCard';
import SmallStartSheet from '../../components/SmallStartSheet';
import OutboxIssues from '../../components/OutboxIssues';
import { useRoutineRunnerStore } from '../../store/routineRunnerStore';
import type { SmallStepParent } from '../../lib/smallStart';
import TimeOffSheet from '../../components/TimeOffSheet';
import ChecklistSheet from '../../components/ChecklistSheet';
import { itemsOn } from '../../lib/habitChecklist';
import { buildTodayNarrative } from '../../lib/todayNarrative';
import { space, radius, font, hexA, onColor, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useDayClose } from '../../hooks/useDayClose';
import { useTodayClock, useTodayModel } from '../../hooks/useTodayModel';
import { haptic } from '../../lib/haptics';
import {
  Button,
  Card,
  Chip,
  EmptyState,
  IconCircle,
  SectionHeader,
  SyncStatusBadge,
  WillpowerBand,
} from '../../components/ui';
import {
  AtmosphericScreenCanvas,
  BentoVisualCard,
  ChapterDivider,
  EmbeddedFiligree,
} from '../../components/spatial';
import { BENTO_ART, CANVASES, DECOR, TEXTURES } from '../../lib/visualAssets';
import { isMeasurableTracking } from '../../lib/habitEngine';
import { markNoteHintSeen, normalizeNote, NOTE_MAX_LENGTH, readNoteHintSeen } from '../../lib/habitNote';
import { logsForPeriod, type ReviewLogRow } from '../../services/reviewService';
import { bootstrapTodayScreen } from '../../services/todayBootstrapService';
import type { Habit } from '../../lib/supabase';
import {
  isoWeek,
  periodWindowStart,
  type PartGroupKey,
} from '../../lib/todaySelectors';

export {
  isScheduleAmbiguous,
  isPeriodDoneBefore,
  selectTodayHabits,
  selectOnBreakHabits,
  setAsideIds,
  selectSetAsideHabits,
  periodDoneLabel,
  selectPeriodDoneHabits,
  periodWindowStart,
  summarizeTodayHabits,
  todayHabitCopy,
} from '../../lib/todaySelectors';

const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const PRIORITY_TONE: Record<string, keyof Palette> = {
  high: 'error',
  medium: 'warning',
  low: 'success',
  none: 'textGhost',
};

const EMPTY_GROUPS: ReadonlySet<PartGroupKey> = new Set<PartGroupKey>();

const MORE_MENU_ROUTES = {
  focus: '/tabs/focus',
  weekly: '/screens/weekly-review',
  recovery: '/screens/recovery',
  projects: '/screens/projects',
  notes: '/screens/notes',
} as const;

function isMoreMenuKey(id: string): id is keyof typeof MORE_MENU_ROUTES {
  return Object.prototype.hasOwnProperty.call(MORE_MENU_ROUTES, id);
}

export default function TodayScreen() {
  const router = useRouter();
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const priorityColor = (p: string): string => c[PRIORITY_TONE[p] ?? 'textGhost'];
  const { width, height: windowHeight } = useWindowDimensions();
  const pagePadding = width < 480 ? space.md : width < 900 ? space.lg : space.xl;
  const isWide = width >= 1180;
  const clock = useTodayClock();
  const today = clock.today;
  const scrollY = useRef(new Animated.Value(0)).current;

  const { fetchHabits, timeOffAvailable, addTimeOff, endTimeOff, checklistItems } = useHabitStore(
    useShallow((st) => ({
      fetchHabits: st.fetchHabits,
      timeOffAvailable: st.timeOffAvailable,
      addTimeOff: st.addTimeOff,
      endTimeOff: st.endTimeOff,
      checklistItems: st.checklistItems,
    })),
  );
  const [checklistFor, setChecklistFor] = useState<Habit | null>(null);
  const runnerSession = useRoutineRunnerStore((st) => st.session);

  const { fetchLogsForDate, getLogForHabit, logHabit, pendingSyncCount, deadSyncCount } = useLogStore(
    useShallow((st) => ({
      fetchLogsForDate: st.fetchLogsForDate,
      getLogForHabit: st.getLogForHabit,
      logHabit: st.logHabit,
      pendingSyncCount: st.pendingSyncCount,
      deadSyncCount: st.deadSyncCount,
    })),
  );
  const { fetchTasks, toggleDone, addTask, sync: taskSync } = useTaskStore(
    useShallow((st) => ({
      fetchTasks: st.fetchTasks,
      toggleDone: st.toggleDone,
      addTask: st.addTask,
      sync: st.sync,
    })),
  );
  const coreSync = useCoreOutboxSync();
  const wp = useWillpowerStore((st) => st.state);
  const fetchToday = useWillpowerStore((st) => st.fetchToday);
  const { recoveryPlans, fetchPlans } = useRecoveryStore(
    useShallow((st) => ({ recoveryPlans: st.plans, fetchPlans: st.fetchPlans })),
  );

  const { stage, choices, legacyNoticeSeen, dismissLegacyNotice } = useDisclosureStore(
    useShallow((st) => ({
      stage: st.stage,
      choices: st.choices,
      legacyNoticeSeen: st.legacyNoticeSeen,
      dismissLegacyNotice: st.dismissLegacyNotice,
    })),
  );

  const [refreshing, setRefreshing] = useState(false);
  const [periodLogs, setPeriodLogs] = useState<ReviewLogRow[] | null>(null);
  const [lightDayPick, setLightDayPick] = useState<Set<string> | null>(null);
  const [lightDayNote, setLightDayNote] = useState('');
  const [lightDayHintVisible, setLightDayHintVisible] = useState(false);
  const [smallStartFor, setSmallStartFor] = useState<SmallStepParent | null>(null);
  const [lightDaySaving, setLightDaySaving] = useState(false);
  const [holidayOpen, setHolidayOpen] = useState(false);

  const [activeSegment, setActiveSegment] = useState<'all' | 'habits' | 'tasks' | 'balance'>('all');
  const [lowEnergyFilter, setLowEnergyFilter] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const closeFlow = useDayClose(shutdownOpen);
  const lightDayFromCloseRef = useRef(false);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<PartGroupKey>>(EMPTY_GROUPS);
  const lightDayOpen = lightDayPick !== null;

  useEffect(() => {
    setExpandedGroups(EMPTY_GROUPS);
  }, [clock.today]);

  useEffect(() => {
    if (!lightDayOpen) return;
    let alive = true;
    void currentUser().then(async (u) => {
      if (!u || !alive) return;
      const seen = await readNoteHintSeen(u.id);
      if (!seen && alive) {
        setLightDayHintVisible(true);
        await markNoteHintSeen(u.id);
      }
    });
    return () => {
      alive = false;
    };
  }, [lightDayOpen]);

  useEffect(() => {
    void currentUser().then((u) => {
      if (u) void useDisclosureStore.getState().hydrate(u, clock.today);
    });
  }, [clock.today]);

  useEffect(() => {
    useDisclosureStore.getState().recordActiveDay(clock.today);
  }, [clock.today]);

  const routineActive = Boolean(runnerSession && runnerSession.status !== 'finished');
  const sparkEnabled = isToolVisible('spark', stage, choices.spark, {
    itemCount: 0,
    routineActive,
  });

  const model = useTodayModel({
    clock,
    periodLogs,
    lowEnergy: lowEnergyFilter,
    expandedGroups,
    sparkEnabled,
  });

  const {
    todayDate,
    habits,
    todayHabits,
    completedHabits,
    setAsideHabits,
    periodDoneHabits,
    onBreakHabits,
    lightDayCandidates,
    holiday,
    afterBreak,
    habitSummary,
    habitCopy,
    groups,
    todayTasks,
    overdueList,
    pendingTasks,
    nextUpItems,
    nowAction,
    primary,
    summaryLine,
    dailySpark,
    plannedRecovery,
    sessionsCompleted,
    stateOf,
  } = model;

  const toolCtx = useMemo(
    () => ({
      itemCount: todayHabits.length + todayTasks.length + overdueList.length,
      routineActive,
    }),
    [todayHabits.length, todayTasks.length, overdueList.length, routineActive],
  );

  const showSpark = isToolVisible('spark', stage, choices.spark, toolCtx);
  const showMetrics = isToolVisible('metrics', stage, choices.metrics, toolCtx);
  const showSegments = isToolVisible('segments', stage, choices.segments, toolCtx);
  const showBalance = isToolVisible('balance', stage, choices.balance, toolCtx);
  const showRoutine = isToolVisible('routine', stage, choices.routine, toolCtx);
  const showStrategy = isToolVisible('strategy', stage, choices.strategy, toolCtx);

  useEffect(() => {
    if (!showSegments && activeSegment !== 'all') {
      setActiveSegment('all');
    } else if (activeSegment === 'balance' && !showBalance && !showRoutine && !showStrategy) {
      setActiveSegment('all');
    }
  }, [showSegments, showBalance, showRoutine, showStrategy, activeSegment]);

  const effectiveSegment = showSegments ? activeSegment : 'all';

  const loadPeriodLogs = useCallback(async () => {
    const res = await logsForPeriod({ start: periodWindowStart(todayDate), end: today });
    setPeriodLogs(res.ok ? res.data : null);
  }, [today, todayDate]);

  const load = useCallback(async (opts?: { force?: boolean }) => {
    const boot = await bootstrapTodayScreen(today);
    if (boot.ok) {
      setPeriodLogs(boot.periodLogs);
      return;
    }
    await Promise.all([fetchHabits(opts), fetchLogsForDate(today), fetchTasks(), fetchToday(), fetchPlans(), loadPeriodLogs()]);
  }, [fetchHabits, fetchLogsForDate, fetchPlans, fetchTasks, fetchToday, loadPeriodLogs, today]);

  useEffect(() => {
    void load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load({ force: true });
    setRefreshing(false);
  }

  const habitPct = habitSummary.pct;
  const remainingHabits = habitSummary.remaining;

  const onHabitTap = useCallback(
    async function onHabitTap(h: typeof habits[number]) {
      if (itemsOn(checklistItems, h.id, today).length > 0) {
        setChecklistFor(h);
        return;
      }
      if (isMeasurableTracking(h.tracking_type)) {
        router.push('/tabs/timeline' as any);
        return;
      }
      const log = getLogForHabit(h.id);
      const done = log?.state === 'done' || log?.state === 'partial';
      haptic.success();
      const res = await logHabit({ habitId: h.id, date: new Date(), state: done ? 'miss' : 'done' });
      if (!res.ok) void notify('Kaydedilemedi', res.error);
    },
    [checklistItems, getLogForHabit, logHabit, router, today],
  );

  const openMoreMenu = useCallback(async () => {
    const options: DialogOption[] = [
      ...(nowAction?.kind !== 'focus' ? [{ id: 'focus', label: 'Odağa geç', icon: 'timer-outline' }] : []),
      { id: 'shutdown', label: 'Günü kapat', icon: 'moon-outline' },
      { id: 'weekly', label: 'Haftayı değerlendir', icon: 'calendar-outline' },
      { id: 'recovery', label: 'Denge planı', icon: 'leaf-outline' },
      { id: 'projects', label: 'Projeler', icon: 'folder-outline' },
      { id: 'notes', label: 'Notlar', icon: 'document-text-outline' },
    ];
    const picked = await actionSheet({ title: 'Diğer', options });
    if (picked === 'shutdown') {
      setShutdownOpen(true);
      return;
    }
    if (picked !== null && isMoreMenuKey(picked)) {
      router.push(MORE_MENU_ROUTES[picked]);
    }
  }, [nowAction?.kind, router]);

  const openNowAction = useCallback(
    (a: NextAction) => {
      if (a.kind === 'focus') router.push('/tabs/focus' as any);
      else if (a.kind === 'routine') router.push('/screens/routine-runner' as any);
      else if (a.kind === 'recovery') router.push('/screens/recovery' as any);
      else if (a.kind === 'task') router.push('/tabs/tasks' as any);
      else {
        const h = habits.find((x) => x.id === a.id);
        if (h) void onHabitTap(h);
      }
    },
    [habits, onHabitTap, router],
  );

  const eyebrow = useMemo(
    () => `${DAYS[todayDate.getDay()]}, ${todayDate.getDate()} ${MONTHS[todayDate.getMonth()]} · ${isoWeek(todayDate)}. hafta`,
    [todayDate],
  );

  const narrative = useMemo(
    () =>
      buildTodayNarrative({
        hour: clock.hour,
        overdueCount: overdueList.length,
        todayTaskCount: todayTasks.length,
        remainingHabits,
        totalHabits: habitSummary.total,
        focusSessions: sessionsCompleted,
      }),
    [clock.hour, overdueList.length, todayTasks.length, remainingHabits, habitSummary.total, sessionsCompleted],
  );

  const heroCtas = useMemo(
    () => [
      {
        label: primary.label,
        icon: (primary.verb === 'Devam et' ? 'play-forward' : 'play') as 'play-forward' | 'play',
        variant: 'primary' as const,
        onPress: () => (nowAction ? openNowAction(nowAction) : router.push('/tabs/focus' as any)),
      },
      {
        label: 'Diğer',
        icon: 'ellipsis-horizontal' as const,
        variant: 'ghost' as const,
        onPress: openMoreMenu,
      },
    ],
    [nowAction, openMoreMenu, openNowAction, primary.label, primary.verb, router],
  );

  const metrics = useMemo<Metric[] | null>(() => {
    if (!showMetrics) return null;
    return [
      {
        eyebrow: 'Açık görev',
        value: String(todayTasks.length + overdueList.length),
        sub: overdueList.length > 0 ? `${overdueList.length} gecikmiş · ${todayTasks.length} bugün` : `${todayTasks.length} görev bugün`,
        tone: 'mute',
        onPress: () => router.push('/tabs/tasks' as any),
      },
      {
        eyebrow: 'Odak · bugün',
        value: sessionsCompleted > 0 ? String(sessionsCompleted) : '—',
        sub: sessionsCompleted > 0 ? 'odak seansı tamamlandı' : 'ilk seansını başlat',
        tone: sessionsCompleted > 0 ? 'accent' : 'mute',
        onPress: () => router.push('/tabs/focus' as any),
      },
      {
        eyebrow: 'Alışkanlık',
        value: `${Math.round(habitPct * 100)}%`,
        sub: habitCopy.metricSub,
        tone: habitSummary.total > 0 && remainingHabits === 0 ? 'ok' : 'mute',
        onPress: () => router.push('/tabs/timeline' as any),
      },
      {
        eyebrow: 'Telafi',
        value: plannedRecovery > 0 ? String(plannedRecovery) : '—',
        sub: plannedRecovery > 0 ? 'planlı telafi var' : 'denge korunuyor',
        tone: plannedRecovery > 0 ? 'warn' : 'mute',
        onPress: () => router.push('/screens/recovery' as any),
      },
    ];
  }, [
    showMetrics,
    todayTasks.length,
    overdueList.length,
    sessionsCompleted,
    habitPct,
    habitCopy.metricSub,
    habitSummary.total,
    remainingHabits,
    plannedRecovery,
    router,
  ]);

  const handleNextUpPress = useCallback(() => {
    router.push('/tabs/tasks' as any);
  }, [router]);

  const handleToggleGroup = useCallback((key: PartGroupKey) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const handleEndHoliday = useCallback(async () => {
    if (!holiday) return;
    const res = await endTimeOff(holiday.id);
    if (!res.ok) void notify('Kaydedilemedi', res.error);
  }, [endTimeOff, holiday]);

  function toggleLightDay(id: string) {
    setLightDayPick((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function closeLightDaySheet() {
    setLightDayPick(null);
    setLightDayNote('');
    if (lightDayFromCloseRef.current) {
      lightDayFromCloseRef.current = false;
      setShutdownOpen(true);
    }
  }

  async function confirmLightDay() {
    if (!lightDayPick || lightDayPick.size === 0) return;
    setLightDaySaving(true);
    const normalizedNote = normalizeNote(lightDayNote) ?? undefined;
    const failed: string[] = [];
    for (const id of lightDayPick) {
      const res = await logHabit({ habitId: id, date: new Date(), state: 'skip', note: normalizedNote });
      if (!res.ok) failed.push(id);
    }
    setLightDaySaving(false);
    if (failed.length > 0) {
      const names = habits.filter((h) => failed.includes(h.id)).map((h) => h.name).join(', ');
      void notify('Bir kısmı kaydedilemedi', names);
      setLightDayPick(new Set(failed));
      return;
    }
    haptic.success();
    closeLightDaySheet();
  }

  const closeRows = useMemo(
    () =>
      closeFlow.rows.map((r) => ({
        id: r.task.id,
        title: r.task.title,
        priority: r.task.priority,
        decision: r.decision,
      })),
    [closeFlow.rows],
  );

  async function onFinishClose() {
    haptic.success();
    useDisclosureStore.getState().markFirstClose(clock.today);
    setShutdownOpen(false);
    await closeFlow.finish(setAsideHabits.length);
  }

  const hasContext = Boolean(!legacyNoticeSeen || afterBreak || holiday || setAsideHabits.length > 0);
  const hasAnyShelfTool = showBalance || showRoutine || showStrategy;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.todaySanctuary}
        textureSource={TEXTURES.clay}
        scrim={0.62}
        scrollY={scrollY}
        tintColor={c.primary}
        ambientMotion={!lowEnergyFilter}
      />
      <Animated.ScrollView
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: Platform.OS !== 'web' })}
        scrollEventThrottle={16}
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingHorizontal: pagePadding }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={c.primary} />}
      >
        {/* Üst Başlık & Hızlı Erişim */}
        <View style={s.masthead}>
          <View>
            <Text style={s.productLabel}>ADERYTH / GÜNLÜK PUSULA</Text>
            <Text style={s.productHint}>Ritmini gör, sıradaki doğru adımı seç.</Text>
          </View>
          <View style={s.mastheadActions}>
            <SyncStatusBadge pending={pendingSyncCount + taskSync.pending + coreSync.pending} dead={deadSyncCount + taskSync.dead + taskSync.conflict + coreSync.dead + coreSync.conflict} />
            <TouchableOpacity
              onPress={() => router.push('/screens/journal' as any)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Günlüğü aç"
            >
              <IconCircle icon="journal-outline" color={c.accent} size={40} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => router.push('/screens/profile' as any)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Profili aç"
            >
              <IconCircle icon="person-outline" color={c.textDim} size={40} />
            </TouchableOpacity>
          </View>
        </View>

        {/* 🔥 Inflow Odak Akışı — Yalnız spark aracı açıkken görünür */}
        {showSpark && dailySpark && (
          <TouchableOpacity
            style={[
              s.sparkCard,
              { borderColor: hexA(dailySpark.item.accentColor, 0.42) },
            ]}
            activeOpacity={0.85}
            onPress={() => {
              haptic.select();
              router.push(`/screens/focus-flow?item=${dailySpark.item.id}` as any);
            }}
            accessibilityRole="button"
            accessibilityLabel="Günün Odak Akışını İzle"
          >
            <View
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
              {...(Platform.OS === 'web'
                ? { 'aria-hidden': true }
                : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
            >
              {process.env?.NODE_ENV !== 'test' ? (
                <Image
                  source={BENTO_ART.sparkReels}
                  style={s.sparkArt}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
              ) : null}
              <View style={s.sparkArtScrim} />
            </View>
            <View
              style={[
                s.sparkPlayRing,
                {
                  borderColor: dailySpark.item.accentColor,
                  backgroundColor: hexA(dailySpark.item.accentColor, 0.16),
                },
              ]}
            >
              <Ionicons name="play" size={18} color={dailySpark.item.accentColor} />
            </View>
            <View style={s.sparkTextCol}>
              <Text
                style={[s.sparkEyebrow, { color: dailySpark.item.accentColor }]}
                numberOfLines={1}
              >
                🔥 ODAK AKIŞI · {dailySpark.reasonTag}
              </Text>
              <Text style={s.sparkTitle} numberOfLines={1}>
                {dailySpark.item.hookTitle}
              </Text>
            </View>
            <View
              style={[
                s.sparkWatchPill,
                { backgroundColor: hexA(dailySpark.item.accentColor, 0.18) },
              ]}
            >
              <Text style={[s.sparkWatchText, { color: dailySpark.item.accentColor }]}>
                {dailySpark.item.durationSec} sn →
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Blok 1: Günün Odağı & Editöryel Hero + Sırada */}
        <View testID="today-block-hero">
          <TodayHero
            eyebrow={eyebrow}
            narrative={narrative}
            ctas={heroCtas}
          />
          <DayCloseEcho />
          <View style={s.summaryPillRow}>
            <View style={s.summaryPill}>
              <Ionicons name="sparkles" size={13} color={c.accent} />
              <Text style={s.breakNote} accessibilityLabel={`${primary.hint}. ${summaryLine}`}>
                {primary.hint} · {summaryLine}
              </Text>
            </View>

            <View style={s.calmModesRow}>
              <Chip
                label="Düşük Enerji Modu"
                icon="battery-half-outline"
                color={lowEnergyFilter ? c.success : c.textDim}
                selected={lowEnergyFilter}
                onPress={() => {
                  haptic.select();
                  setLowEnergyFilter((v) => !v);
                }}
                accessibilityLabel="Düşük enerji filtresi: yalnız hafif alışkanlıkları öne çıkar"
                style={s.calmChip}
              />

              {clock.hour >= 17 && (
                <Chip
                  label="Günü Kapat"
                  icon="moon-outline"
                  color={c.accent}
                  onPress={() => {
                    haptic.select();
                    setShutdownOpen(true);
                  }}
                  accessibilityLabel="Günü kapat: akşam kapanış ritüelini başlat"
                  style={s.calmChip}
                />
              )}
            </View>
          </View>

          {lowEnergyFilter && (
            <BentoVisualCard
              artSource={BENTO_ART.lowEnergyMoss}
              bleedMode="right-vignette"
              scrim={0.5}
              accentColor={c.success}
              padding="md"
              style={{ marginBottom: space.sm }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Ionicons name="leaf" size={18} color={c.success} />
                <View style={{ flex: 1 }}>
                  <Text style={s.lowEnergyTitle}>Yumuşak Ritim · Düşük Enerji Filtresi Açık</Text>
                  <Text style={s.breakNote}>Yalnızca hafif adımlar öne çıkarıldı; serilerin güvende.</Text>
                </View>
              </View>
            </BentoVisualCard>
          )}

          <NextUpStrip items={nextUpItems} onPress={handleNextUpPress} />
        </View>

        {/* Bağlamsal 4. Blok — yalnız doluysa tek kapsayıcı */}
        {hasContext && (
          <View testID="today-block-context" style={s.contextBlock}>
            {!legacyNoticeSeen && (
              <Card padding="lg">
                <Text style={s.breakNote}>
                  Bugün sadeleşti. Kartları Ayarlar &gt; Araçlar bölümünden geri açabilirsin.
                </Text>
                <View style={s.legacyNoticeBtnWrap}>
                  <Button
                    label="Tamam"
                    variant="ghost"
                    size="sm"
                    onPress={dismissLegacyNotice}
                  />
                </View>
              </Card>
            )}

            {afterBreak && (
              <Card padding="lg" accessibilityLabel={`${FLOW_COPY.afterBreakTitle}. ${FLOW_COPY.afterBreak}`}>
                <SectionHeader title={FLOW_COPY.afterBreakTitle.toLocaleUpperCase('tr-TR')} variant="overline" />
                <Text style={s.breakNote}>{FLOW_COPY.afterBreak}</Text>
              </Card>
            )}

            {holiday && (
              <HolidayCard endDate={holiday.end_date ?? null} onEnd={handleEndHoliday} />
            )}

            {setAsideHabits.length > 0 && (
              <SetAsideCard habits={setAsideHabits} onHabitTap={onHabitTap} />
            )}
          </View>
        )}

        {/* Sakin Metrik Kartları — yalnız metrics aracı açıkken */}
        {showMetrics && metrics && (
          <>
            <MetricGrid metrics={metrics} />
            <ChapterDivider source={DECOR.dividerSundial} label="GÜNÜN ÇALIŞMA TEZGAHI" />
          </>
        )}

        {/* Akıllı Segment Filtresi — yalnız segments aracı açıkken */}
        {showSegments && (
          <View style={s.segmentedRow}>
            <TouchableOpacity
              style={[s.segmentBtn, effectiveSegment === 'all' && s.segmentBtnActive]}
              onPress={() => { haptic.select(); setActiveSegment('all'); }}
              accessibilityRole="button"
              accessibilityLabel="Tümünü göster"
            >
              <Ionicons name="layers-outline" size={14} color={effectiveSegment === 'all' ? c.primary : c.textDim} />
              <Text style={[s.segmentText, effectiveSegment === 'all' && s.segmentTextActive]}>Tümü</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.segmentBtn, effectiveSegment === 'habits' && s.segmentBtnActive]}
              onPress={() => { haptic.select(); setActiveSegment('habits'); }}
              accessibilityRole="button"
              accessibilityLabel="Sadece ritüelleri göster"
            >
              <Ionicons name="repeat-outline" size={14} color={effectiveSegment === 'habits' ? c.primary : c.textDim} />
              <Text style={[s.segmentText, effectiveSegment === 'habits' && s.segmentTextActive]}>Ritüeller</Text>
              {remainingHabits > 0 && (
                <View style={s.badgePill}>
                  <Text style={s.badgeText}>{remainingHabits}</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.segmentBtn, effectiveSegment === 'tasks' && s.segmentBtnActive]}
              onPress={() => { haptic.select(); setActiveSegment('tasks'); }}
              accessibilityRole="button"
              accessibilityLabel="Sadece görevleri göster"
            >
              <Ionicons name="checkbox-outline" size={14} color={effectiveSegment === 'tasks' ? c.primary : c.textDim} />
              <Text style={[s.segmentText, effectiveSegment === 'tasks' && s.segmentTextActive]}>Görevler</Text>
              {pendingTasks.length > 0 && (
                <View style={s.badgePill}>
                  <Text style={s.badgeText}>{pendingTasks.length}</Text>
                </View>
              )}
            </TouchableOpacity>

            {showBalance && (
              <TouchableOpacity
                style={[s.segmentBtn, effectiveSegment === 'balance' && s.segmentBtnActive]}
                onPress={() => { haptic.select(); setActiveSegment('balance'); }}
                accessibilityRole="button"
                accessibilityLabel="Denge ve rutini göster"
              >
                <Ionicons name="compass-outline" size={14} color={effectiveSegment === 'balance' ? c.primary : c.textDim} />
                <Text style={[s.segmentText, effectiveSegment === 'balance' && s.segmentTextActive]}>Denge</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Ana İçerik: DOM sırası önce Ritüeller (Blok 2), sonra Ekleyici & Masadakiler (Blok 3) */}
        <View style={[s.dashboardBody, isWide && s.dashboardBodyWide]}>
          {(effectiveSegment === 'all' || effectiveSegment === 'habits') && (
            <View
              testID="today-block-habits"
              style={[s.mainColumn, isWide && effectiveSegment === 'all' && s.mainColumn]}
            >
              <HabitSection
                isWide={isWide}
                lowEnergy={lowEnergyFilter}
                showRing={showMetrics}
                todayDate={todayDate}
                todayHabits={todayHabits}
                groups={groups}
                habitSummary={habitSummary}
                habitCopy={habitCopy}
                lightDayCandidateCount={lightDayCandidates.length}
                holidayActive={Boolean(holiday)}
                onBreakHabits={onBreakHabits}
                periodDoneHabits={periodDoneHabits}
                stateOf={stateOf}
                onHabitTap={onHabitTap}
                onToggleGroup={handleToggleGroup}
                onOpenRing={() => router.push('/tabs/timeline' as any)}
                onOpenTimeline={() => router.push('/tabs/timeline' as any)}
                onOpenLightDay={() => setLightDayPick(new Set())}
                onOpenHoliday={() => setHolidayOpen(true)}
              />
            </View>
          )}

          {(effectiveSegment === 'all' || effectiveSegment === 'tasks') && (
            <View
              testID="today-block-composer"
              style={[
                s.railColumn,
                isWide && effectiveSegment === 'all' && s.railColumnWide,
                effectiveSegment !== 'all' && { flex: 1 },
              ]}
            >
              <View style={s.mainSection}>
                <View style={s.sectionIntro}>
                  <View>
                    <Text style={s.sectionEyebrow}>BUGÜN · {pendingTasks.length}</Text>
                    <Text style={s.sectionTitle}>Masadakiler</Text>
                  </View>
                  <Button
                    label="Tümü →"
                    variant="ghost"
                    size="sm"
                    onPress={() => router.push('/tabs/tasks' as any)}
                    accessibilityLabel="Tüm görevleri aç"
                  />
                </View>
                <OutboxIssues />
                <View style={{ marginBottom: space.sm }}>
                  <InlineComposer
                    placeholder="Bugün için hızlı bir adım ekle…"
                    onSubmit={async (t) => { await addTask({ title: t, priority: 'none', list_type: 'inbox', due_date: today }); }}
                  />
                </View>
                {pendingTasks.length === 0 ? (
                  <Card padding="lg">
                    <EmptyState
                      variant="editorial"
                      icon="checkmark-circle-outline"
                      title="Bugünün açık döngüsü kalmadı."
                      hint="Bir sonraki odak bloğunu planlayabilir veya günü kısa bir notla kapatabilirsin."
                      ctaLabel="Yeni adım ekle"
                      onCta={() => router.push('/tabs/tasks' as any)}
                      color={c.success}
                      compact
                    />
                  </Card>
                ) : (
                  <View style={{ gap: space.sm }}>
                    {pendingTasks.map((t) => (
                      <Card key={t.id} padding="md">
                        <View style={s.taskRow}>
                          <TouchableOpacity
                            style={s.taskMain}
                            onPress={() => { haptic.light(); void toggleDone(t.id); }}
                            accessibilityRole="button"
                            accessibilityLabel={`${t.title}, tamamlamak için dokun`}
                          >
                            <View style={[s.taskDot, { borderColor: priorityColor(t.priority) }]} />
                            <Text style={s.taskTitle} numberOfLines={1}>{t.title}</Text>
                            {t.due_date && (
                              <View style={[s.dueBadge, t.due_date < today && s.dueBadgeOverdue]}>
                                <Text style={[s.taskDate, t.due_date < today && { color: c.error }]}>
                                  {t.due_date === today ? 'Bugün' : t.due_date}
                                </Text>
                              </View>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.smallStartBtn}
                            onPress={() => setSmallStartFor({ kind: 'task', id: t.id, title: t.title })}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={`${t.title} için küçük başla`}
                          >
                            <Ionicons name="play-circle-outline" size={22} color={c.accent} />
                          </TouchableOpacity>
                        </View>
                      </Card>
                    ))}
                  </View>
                )}
              </View>
            </View>
          )}
        </View>

        {/* İlerleyici Araç Rafı — yalnız açık olan araçlar */}
        {(effectiveSegment === 'all' || effectiveSegment === 'balance') && hasAnyShelfTool && (
          <View style={s.toolShelf}>
            {showBalance && (
              <>
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => router.push('/screens/profile' as any)}
                  accessibilityRole="button"
                  accessibilityLabel="Profil ve deneyim puanını aç"
                >
                  <XPDisplay />
                </TouchableOpacity>

                {wp && (
                  <Card padding="lg" onPress={() => router.push('/tabs/timeline' as any)}>
                    <View style={s.wpHead}>
                      <Text style={s.wpHeadText}>İrade dengesi</Text>
                      <Text style={s.wpHeadHint}>günlük bütçe</Text>
                    </View>
                    <WillpowerBand wp={wp} />
                  </Card>
                )}

                <RecoveryRailCard
                  plans={recoveryPlans}
                  today={today}
                  onOpen={() => router.push('/screens/recovery' as any)}
                />
              </>
            )}

            {showRoutine && (
              <Card padding="lg" style={{ overflow: 'hidden', position: 'relative' }} onPress={() => router.push('/screens/routine-runner' as any)}>
                <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={108} opacity={0.16} />
                <SectionHeader title="RUTİN" variant="overline" />
                <Text style={s.breakNote}>
                  {runnerSession && runnerSession.status !== 'finished'
                    ? `${runnerSession.templateName} sürüyor · ${Object.keys(runnerSession.results).length}/${runnerSession.steps.length} — devam et`
                    : 'Sabah, akşam ya da çalışma rutinini adım adım başlat.'}
                </Text>
              </Card>
            )}

            {showStrategy && (
              <Card padding="lg" style={{ overflow: 'hidden', position: 'relative' }} onPress={() => router.push('/screens/okr' as any)}>
                <EmbeddedFiligree source={DECOR.cornerBlueprint} anchor="bottom-right" size={108} opacity={0.17} />
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs }}>
                  <SectionHeader title="STRATEJİ & OKR" variant="overline" />
                  <Ionicons name="chevron-forward" size={14} color={c.textGhost} />
                </View>
                <Text style={s.breakNote}>
                  Çeyreklik hedefler, Key Results ve vizyon ilerlemeni incele.
                </Text>
              </Card>
            )}
          </View>
        )}
      </Animated.ScrollView>

      <ChecklistSheet habit={checklistFor} day={today} onClose={() => setChecklistFor(null)} />

      <TimeOffSheet
        visible={holidayOpen}
        kind="holiday"
        today={today}
        available={timeOffAvailable === true}
        onClose={() => setHolidayOpen(false)}
        onConfirm={async (draft) => {
          const res = await addTimeOff(null, draft);
          if (res.ok) setHolidayOpen(false);
          return res;
        }}
      />

      <SmallStartSheet
        parent={smallStartFor}
        onClose={() => setSmallStartFor(null)}
        onStart={(parent, draft) => {
          const started = useFocusStore.getState().startSmallStep(parent, draft);
          if (started) { setSmallStartFor(null); router.push('/tabs/focus' as any); }
          return started;
        }}
      />

      <Modal visible={lightDayPick !== null} transparent animationType="slide" onRequestClose={closeLightDaySheet}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.sheetOverlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Bugün daha az yapabilirim</Text>
            <Text style={s.sheetBody}>{FLOW_COPY.lighten}</Text>
            <Text style={s.sheetNote}>
              Kapasite; alışkanlıklarının zorluğu, süresi ve sıklığından tahmin edilen bir sayıdır.
              Bir sağlık ölçümü ya da kesin bir irade bütçesi değildir.
            </Text>
            <ScrollView style={{ maxHeight: 320 }} accessibilityRole="list">
              {lightDayCandidates.map((h) => {
                const picked = lightDayPick?.has(h.id) ?? false;
                return (
                  <TouchableOpacity
                    key={h.id}
                    style={[s.habitRow, { marginBottom: space.sm }]}
                    onPress={() => toggleLightDay(h.id)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: picked }}
                    accessibilityLabel={`${h.name} bugün için kenara konsun`}
                  >
                    <View style={[s.habitCheck, { borderColor: picked ? c.accent : c.borderStrong }, picked && { backgroundColor: c.accent }]}>
                      {picked && <Ionicons name="checkmark" size={14} color={c.white} />}
                    </View>
                    <Text style={s.habitName} numberOfLines={1}>{h.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={s.lightDayNoteWrap}>
              {lightDayHintVisible && (
                <Text style={s.sheetNote}>
                  İstersen nedenini tek satırda yaz. Yalnız sen görürsün.
                </Text>
              )}
              <TextInput
                value={lightDayNote}
                onChangeText={setLightDayNote}
                placeholder="Kısa bir not (isteğe bağlı)"
                placeholderTextColor={c.textFaint}
                maxLength={NOTE_MAX_LENGTH}
                returnKeyType="done"
                accessibilityLabel="Hafif gün notu (isteğe bağlı)"
                style={s.lightDayNoteInput}
              />
              <Text style={s.lightDayNoteSub}>
                Bu not seçtiğin tüm alışkanlıklara eklenir.
              </Text>
            </View>
            <View style={s.sheetActions}>
              <TouchableOpacity
                style={s.sheetCancel}
                onPress={closeLightDaySheet}
                accessibilityRole="button"
                accessibilityLabel="Vazgeç"
              >
                <Text style={s.sheetCancelText}>Vazgeç</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.sheetSave, (!lightDayPick || lightDayPick.size === 0 || lightDaySaving) && s.sheetSaveDisabled]}
                onPress={confirmLightDay}
                disabled={!lightDayPick || lightDayPick.size === 0 || lightDaySaving}
                accessibilityRole="button"
                accessibilityLabel="Seçilenleri bugün için kenara koy"
                accessibilityState={{ disabled: !lightDayPick || lightDayPick.size === 0 || lightDaySaving }}
              >
                <Text style={s.sheetSaveText}>{lightDaySaving ? 'Kaydediliyor…' : 'Kenara koy'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Akşam Kapanış Ritüeli (Shutdown Ritual) Modalı */}
      <Modal visible={shutdownOpen} transparent animationType="slide" onRequestClose={() => setShutdownOpen(false)}>
        <View style={s.sheetOverlay}>
          <View style={s.sheet}>
            <ScrollView
              style={{ maxHeight: Math.round(0.68 * windowHeight) }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View
                style={s.shutdownHero}
                pointerEvents="none"
                {...(Platform.OS === 'web'
                  ? { 'aria-hidden': true }
                  : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
              >
                {process.env?.NODE_ENV !== 'test' ? (
                  <Image source={BENTO_ART.eveningShutdown} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                ) : null}
                <View style={s.shutdownHeroScrim} />
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.xs }}>
                <Ionicons name="moon" size={20} color={c.accent} />
                <Text style={s.shutdownTitle}>Günü Kapat · Zihinsel Kapanış</Text>
              </View>
              <Text style={s.sheetBody}>
                Bugün {completedHabits.length}/{habitSummary.total} ritüel ve {sessionsCompleted} odak seansı tamamladın.
                Açık kalan döngüleri yarına devredip zihnini dinlenme moduna alabilirsin.
              </Text>

              <DayCloseMood value={closeFlow.mood} onChoose={closeFlow.chooseMood} />

              {closeRows.length > 0 && (
                <DayCloseTasks
                  rows={closeRows}
                  hasMore={closeFlow.hasMore}
                  waitingForSync={closeFlow.waitingForSync}
                  onDecide={closeFlow.decide}
                  onUndo={closeFlow.undo}
                  onMoveAll={closeFlow.moveVisibleToTomorrow}
                />
              )}

              <View style={{ gap: space.sm, marginVertical: space.md }}>
                {remainingHabits > 0 && (
                  <TouchableOpacity
                    style={s.shutdownOptionCard}
                    onPress={() => {
                      lightDayFromCloseRef.current = true;
                      setShutdownOpen(false);
                      setLightDayPick(new Set(lightDayCandidates.map((h) => h.id)));
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Kalan ritüelleri cezasız olarak bugünlük kenara koy"
                  >
                    <Ionicons name="leaf-outline" size={18} color={c.success} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.shutdownOptionTitle}>Kalan {remainingHabits} ritüeli bugünlük hafiflet</Text>
                      <Text style={s.shutdownOptionSub}>Serilerin bozulmaz; bugün cezasız kapanır.</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={s.shutdownOptionCard}
                  onPress={() => {
                    setShutdownOpen(false);
                    router.push('/screens/journal' as any);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Günü tek cümlelik günlük yansımasıyla kapat"
                >
                  <Ionicons name="journal-outline" size={18} color={c.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.shutdownOptionTitle}>1 Cümlelik Akşam Yansıması Yaz</Text>
                    <Text style={s.shutdownOptionSub}>Zihnindeki son düşünceleri kağıda bırak.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.shutdownOptionCard}
                  onPress={() => {
                    setShutdownOpen(false);
                    router.push('/screens/recovery' as any);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Telafi kalkanını ve yarının planını incele"
                >
                  <Ionicons name="shield-checkmark-outline" size={18} color={c.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.shutdownOptionTitle}>Telafi & Yarın Pusulası</Text>
                    <Text style={s.shutdownOptionSub}>Kaçan adımları yarına veya iki güne böl.</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                </TouchableOpacity>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[s.sheetSave, s.shutdownFinishBtn]}
              onPress={onFinishClose}
              accessibilityRole="button"
              accessibilityLabel="Bugünlük bitti, ekranı kapat"
            >
              <Text style={s.sheetSaveText}>Bugünlük Bitti · İyi Dinlenmeler ✨</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (c: Palette) => StyleSheet.create({
  breakNote: { ...font.bodySm, color: c.textDim, lineHeight: 19 },
  summaryPillRow: {
    gap: space.xs,
    marginTop: space.sm,
    marginBottom: space.sm,
  },
  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: hexA(c.surfaceAlt, 0.7),
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.full,
    alignSelf: 'flex-start',
  },
  calmModesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.xs,
    marginTop: space.xs,
  },
  calmChip: {
    borderRadius: radius.full,
    minHeight: 44,
  },
  contextBlock: {
    gap: space.md,
    marginTop: space.md,
  },
  legacyNoticeBtnWrap: {
    marginTop: space.sm,
    alignSelf: 'flex-start',
  },
  toolShelf: {
    gap: space.md,
    marginTop: space.lg,
  },
  shutdownTitle: {
    ...font.h2,
    color: c.text,
  },
  shutdownOptionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: c.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: c.border,
    padding: space.md,
  },
  shutdownOptionTitle: { ...font.bodySm, fontWeight: '700', color: c.text },
  shutdownOptionSub: { ...font.caption, color: c.textDim, marginTop: space.xs },
  sheetOverlay: { flex: 1, backgroundColor: hexA(c.black, 0.65), justifyContent: 'flex-end' },
  sheet: { backgroundColor: c.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg },
  sheetTitle: { ...font.h2, color: c.text, marginBottom: space.sm },
  sheetBody: { ...font.bodySm, color: c.textDim, lineHeight: 19, marginBottom: space.sm },
  sheetNote: { ...font.caption, color: c.textFaint, lineHeight: 16, marginBottom: space.md },
  lightDayNoteWrap: { marginTop: space.md, gap: space.xs },
  lightDayNoteInput: {
    ...font.bodySm,
    color: c.text,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
  },
  lightDayNoteSub: { ...font.caption, color: c.textFaint },
  sheetActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  sheetCancel: { flex: 1, paddingVertical: space.md, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: c.border, minHeight: 48, justifyContent: 'center' },
  sheetCancelText: { color: c.textDim, fontWeight: '600' },
  sheetSave: { flex: 1, paddingVertical: space.md, borderRadius: radius.md, alignItems: 'center', backgroundColor: c.accent, minHeight: 48, justifyContent: 'center' },
  shutdownFinishBtn: { flex: 0, marginTop: space.sm },
  sheetSaveDisabled: { opacity: 0.4 },
  sheetSaveText: { color: onColor(c.accent), fontWeight: '700' },
  safe: { flex: 1, backgroundColor: c.bg },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 1240, alignSelf: 'center', paddingVertical: space.lg, paddingBottom: 96 },

  masthead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: space.md, marginBottom: space.lg,
    borderBottomWidth: 1, borderBottomColor: c.borderSubtle,
  },
  mastheadActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  productLabel: { ...font.overline, color: c.primaryBright, marginBottom: space.xs },
  productHint: { ...font.bodySm, color: c.textFaint },

  segmentedRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.xs,
    backgroundColor: c.surfaceAlt, borderRadius: radius.full,
    padding: space.xs, marginTop: space.lg, marginBottom: space.md,
  },
  segmentBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: space.sm, borderRadius: radius.full, minHeight: 44,
  },
  segmentBtnActive: {
    backgroundColor: c.surfaceHover,
    shadowColor: c.black, shadowOpacity: 0.25, shadowRadius: 4, elevation: 2,
  },
  segmentText: { ...font.caption, color: c.textFaint, fontWeight: '600' },
  segmentTextActive: { color: c.text, fontWeight: '700' },
  badgePill: {
    backgroundColor: c.primary, borderRadius: radius.full,
    paddingHorizontal: space.xs, paddingVertical: space.xs, minWidth: 18, alignItems: 'center',
  },
  badgeText: { ...font.overline, color: onColor(c.primary), fontWeight: '700' },

  dashboardBody: { marginTop: space.md, gap: space.lg },
  dashboardBodyWide: { flexDirection: 'row', alignItems: 'flex-start', gap: space.hh },
  mainColumn: { flex: 1, minWidth: 0, gap: space.md },
  railColumn: { gap: space.md },
  railColumnWide: { width: 380 },
  mainSection: { gap: space.xs },
  sectionIntro: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, marginBottom: space.md },
  sectionEyebrow: { ...font.overline, color: c.textFaint, marginBottom: space.xs },
  sectionTitle: { ...font.title, color: c.text },

  wpHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  wpHeadText: { ...font.h3, color: c.text },
  wpHeadHint: { ...font.caption, color: c.textFaint },

  habitRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: c.surface, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: c.border, minHeight: 52,
  },
  habitCheck: {
    width: 32, height: 32, borderRadius: radius.sm, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  habitName: { flex: 1, ...font.body, color: c.text },

  taskRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 },
  taskMain: { flexDirection: 'row', alignItems: 'center', gap: space.md, flex: 1, minHeight: 44 },
  taskDot: { width: 12, height: 12, borderRadius: radius.xs, borderWidth: 2 },
  taskTitle: { flex: 1, ...font.body, color: c.text },
  dueBadge: {
    backgroundColor: hexA(c.surfaceAlt, 0.8),
    paddingHorizontal: space.sm, paddingVertical: space.xs, borderRadius: radius.sm,
  },
  dueBadgeOverdue: {
    backgroundColor: hexA(c.error, 0.15),
  },
  taskDate: { ...font.caption, color: c.textFaint, fontWeight: '500' },
  lowEnergyTitle: { ...font.bodySm, fontWeight: '700', color: c.success, marginBottom: space.xs },
  shutdownHero: {
    height: 112,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
    marginBottom: space.md,
    borderWidth: 1,
    borderColor: c.border,
  },
  shutdownHeroScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: hexA(c.bgSunk, 0.34),
  },
  sparkArt: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: '58%',
    opacity: 0.72,
  },
  sparkArtScrim: {
    ...StyleSheet.absoluteFill,
    backgroundColor: hexA(c.surface, 0.56),
  },
  sparkCard: {
    overflow: 'hidden',
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: c.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    marginBottom: space.md,
  },
  sparkPlayRing: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkTextCol: {
    flex: 1,
    gap: 2,
  },
  sparkEyebrow: {
    ...font.overline,
    fontWeight: '700',
  },
  sparkTitle: {
    ...font.bodySm,
    color: c.text,
    fontWeight: '600',
  },
  sparkWatchPill: {
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderRadius: radius.full,
  },
  sparkWatchText: {
    ...font.caption,
    fontWeight: '700',
  },
  smallStartBtn: {
    padding: space.xs, alignItems: 'center', justifyContent: 'center',
  },
});
