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
import { BUILT_IN_TEMPLATES, suggestTemplate } from '../../lib/routineRunner';
import { isLowEnergyOn, useLowEnergyStore } from '../../store/lowEnergyStore';
import { useMoodStore } from '../../store/moodStore';
import { ENERGY_COPY, lowEnergySuggested } from '../../lib/moods';
import { useTimeCapsules } from '../../hooks/useTimeCapsules';
import TimeCapsuleCard from '../../components/recovery/TimeCapsuleCard';
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
import { syncAllReminders } from '../../lib/notifications';
import { navigateTo, type DestinationId } from '../../lib/destinations';
import { useProjectStore } from '../../store/projectStore';
import { quickAddToTaskInput } from '../../lib/taskQuickAdd';
import type { Habit } from '../../lib/supabase';
import { isoWeekNumber } from '../../lib/date';
import { fmt, t } from '../../lib/i18n';
import {
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

const PRIORITY_TONE: Record<string, keyof Palette> = {
  high: 'error',
  medium: 'warning',
  low: 'success',
  none: 'textGhost',
};

const EMPTY_GROUPS: ReadonlySet<PartGroupKey> = new Set<PartGroupKey>();

const MORE_MENU_DESTINATIONS: Readonly<Record<string, DestinationId>> = {
  focus: 'focus',
  weekly: 'weekly-review',
  recovery: 'recovery',
  projects: 'projects',
  notes: 'notes',
};

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
  const [scrollY] = useState(() => new Animated.Value(0));

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
  const runnerActiveTemplateId = useRoutineRunnerStore((st) => st.activeTemplateId);
  const runnerUserTemplates = useRoutineRunnerStore((st) => st.templates);
  const suggestedRoutineName = useMemo(() => {
    if (runnerSession && runnerSession.status !== 'finished') return null;
    const templates = [...BUILT_IN_TEMPLATES, ...runnerUserTemplates];
    const sug = suggestTemplate(templates, clock.hour, runnerActiveTemplateId);
    if (!sug) return null;
    return templates.find((tpl) => tpl.id === sug.templateId)?.name ?? null;
  }, [runnerSession, runnerUserTemplates, clock.hour, runnerActiveTemplateId]);

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
  const rawProjects = useProjectStore((st) => st.projects);
  const quickProjects = useMemo(
    () =>
      rawProjects
        .filter((p) => !p.status || p.status === 'active')
        .map((p) => ({ id: p.id, name: p.name })),
    [rawProjects],
  );
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
  const lowEnergyFilter = useLowEnergyStore((st) => isLowEnergyOn(st, clock.today));
  const setLowEnergy = useLowEnergyStore((st) => st.set);
  const moodCheckins = useMoodStore((st) => st.checkins);
  const energySuggested = useMemo(
    () => lowEnergySuggested(moodCheckins, today),
    [moodCheckins, today],
  );
  const caps = useTimeCapsules();
  const [capsuleMoment, setCapsuleMoment] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const closeFlow = useDayClose(shutdownOpen);
  const lightDayFromCloseRef = useRef(false);
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<PartGroupKey>>(EMPTY_GROUPS);
  const lightDayOpen = lightDayPick !== null;

  const [trackedDay, setTrackedDay] = useState(clock.today);
  if (trackedDay !== clock.today) {
    setTrackedDay(clock.today);
    setExpandedGroups(EMPTY_GROUPS);
    setCapsuleMoment(false);
  }

  useEffect(() => {
    void useMoodStore.getState().hydrate();
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

  const effectiveSegment =
    !showSegments || (activeSegment === 'balance' && !showBalance && !showRoutine && !showStrategy)
      ? 'all'
      : activeSegment;

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
    void Promise.resolve().then(() => load());
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
        router.push('/tabs/timeline');
        return;
      }
      const log = getLogForHabit(h.id);
      const done = log?.state === 'done' || log?.state === 'partial';
      haptic.success();
      const res = await logHabit({ habitId: h.id, date: new Date(), state: done ? 'miss' : 'done' });
      if (!res.ok) void notify(t('today.saveFailed'), res.error);
    },
    [checklistItems, getLogForHabit, logHabit, router, today],
  );

  const openMoreMenu = useCallback(async () => {
    const options: DialogOption[] = [
      ...(nowAction?.kind !== 'focus' ? [{ id: 'focus', label: t('today.more.focus'), icon: 'timer-outline' }] : []),
      { id: 'shutdown', label: t('today.more.dayClose'), icon: 'moon-outline' },
      { id: 'weekly', label: t('today.more.weeklyReview'), icon: 'calendar-outline' },
      { id: 'recovery', label: t('today.more.recovery'), icon: 'leaf-outline' },
      { id: 'projects', label: t('today.more.projects'), icon: 'folder-outline' },
      { id: 'notes', label: t('today.more.notes'), icon: 'document-text-outline' },
    ];
    const picked = await actionSheet({ title: t('today.more.title'), options });
    if (picked === 'shutdown') {
      setShutdownOpen(true);
      return;
    }
    const destId = picked !== null ? MORE_MENU_DESTINATIONS[picked] : undefined;
    if (destId) {
      navigateTo(router, destId);
    }
  }, [nowAction?.kind, router]);

  const openNowAction = useCallback(
    (a: NextAction) => {
      if (a.kind === 'focus') router.push('/tabs/focus');
      else if (a.kind === 'routine') router.push('/screens/routine-runner');
      else if (a.kind === 'recovery') navigateTo(router, 'recovery');
      else if (a.kind === 'task') router.push('/tabs/tasks');
      else {
        const h = habits.find((x) => x.id === a.id);
        if (h) void onHabitTap(h);
      }
    },
    [habits, onHabitTap, router],
  );

  const eyebrow = useMemo(
    () =>
      t('today.hero.eyebrow', {
        weekday: fmt.date(todayDate, 'weekdayShort'),
        day: todayDate.getDate(),
        month: fmt.date(todayDate, 'monthLong'),
        week: isoWeekNumber(todayDate),
      }),
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
        onPress: () => (nowAction ? openNowAction(nowAction) : router.push('/tabs/focus')),
      },
      {
        label: t('today.more.title'),
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
        eyebrow: t('today.metrics.tasks.eyebrow'),
        value: String(todayTasks.length + overdueList.length),
        sub:
          overdueList.length > 0
            ? t('today.metrics.tasks.subOverdue', { overdue: overdueList.length, today: todayTasks.length })
            : t('today.metrics.tasks.subToday', { count: todayTasks.length }),
        tone: 'mute',
        onPress: () => router.push('/tabs/tasks'),
      },
      {
        eyebrow: t('today.metrics.focus.eyebrow'),
        value: sessionsCompleted > 0 ? String(sessionsCompleted) : '—',
        sub: sessionsCompleted > 0 ? t('today.metrics.focus.subDone') : t('today.metrics.focus.subIdle'),
        tone: sessionsCompleted > 0 ? 'accent' : 'mute',
        onPress: () => router.push('/tabs/focus'),
      },
      {
        eyebrow: t('today.metrics.habits.eyebrow'),
        value: `${Math.round(habitPct * 100)}%`,
        sub: habitCopy.metricSub,
        tone: habitSummary.total > 0 && remainingHabits === 0 ? 'ok' : 'mute',
        onPress: () => router.push('/tabs/timeline'),
      },
      {
        eyebrow: t('today.metrics.recovery.eyebrow'),
        value: plannedRecovery > 0 ? String(plannedRecovery) : '—',
        sub: plannedRecovery > 0 ? t('today.metrics.recovery.subPlanned') : t('today.metrics.recovery.subCalm'),
        tone: plannedRecovery > 0 ? 'warn' : 'mute',
        onPress: () => navigateTo(router, 'recovery'),
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
    router.push('/tabs/tasks');
  }, [router]);

  const blockTasks = useMemo(() => todayTasks.filter((task) => !!task.time_block_start), [todayTasks]);

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
    if (!res.ok) void notify(t('today.saveFailed'), res.error);
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
      void notify(t('today.lightDay.partialSaveFailed'), names);
      setLightDayPick(new Set(failed));
      return;
    }
    haptic.success();
    setCapsuleMoment(true);
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
    if (typeof syncAllReminders === 'function') {
      void syncAllReminders([]);
    }
  }

  const eligibleCapsuleItem = caps.eligible;
  const hasContext = Boolean(
    !legacyNoticeSeen ||
      afterBreak ||
      holiday ||
      setAsideHabits.length > 0 ||
      (capsuleMoment && eligibleCapsuleItem),
  );
  const hasAnyShelfTool = showBalance || showRoutine || showStrategy;
  const completeTaskA11y = (title: string) => t('today.tasks.complete.a11y', { title });
  const smallStartTaskA11y = (title: string) => t('today.tasks.smallStart.a11y', { title });
  const dueTodayLabel = t('today.tasks.dueToday');

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
            <Text style={s.productLabel}>{t('today.masthead.overline')}</Text>
            <Text style={s.productHint}>{t('today.masthead.hint')}</Text>
          </View>
          <View style={s.mastheadActions}>
            <SyncStatusBadge pending={pendingSyncCount + taskSync.pending + coreSync.pending} dead={deadSyncCount + taskSync.dead + taskSync.conflict + coreSync.dead + coreSync.conflict} />
            <TouchableOpacity
              onPress={() => navigateTo(router, 'journal')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('today.masthead.journal.a11y')}
            >
              <IconCircle icon="journal-outline" color={c.accent} size={40} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => navigateTo(router, 'profile')}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel={t('today.masthead.profile.a11y')}
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
              router.push(`/screens/focus-flow?item=${dailySpark.item.id}`);
            }}
            accessibilityRole="button"
            accessibilityLabel={t('today.spark.watch.a11y')}
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
                {t('today.spark.eyebrow', { reason: dailySpark.reasonTag })}
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
                {t('today.spark.duration', { seconds: dailySpark.item.durationSec })}
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
                label={t('today.calm.lowEnergy')}
                icon="battery-half-outline"
                color={lowEnergyFilter ? c.success : c.textDim}
                selected={lowEnergyFilter}
                onPress={() => {
                  haptic.select();
                  setLowEnergy(!lowEnergyFilter, clock.today);
                }}
                accessibilityLabel={t('today.calm.lowEnergy.a11y')}
                accessibilityHint={energySuggested && !lowEnergyFilter ? ENERGY_COPY.suggest : undefined}
                style={[s.calmChip, energySuggested && !lowEnergyFilter && s.calmModeChipSuggested]}
              />

              {clock.hour >= 17 && (
                <Chip
                  label={t('today.calm.dayClose')}
                  icon="moon-outline"
                  color={c.accent}
                  onPress={() => {
                    haptic.select();
                    setShutdownOpen(true);
                  }}
                  accessibilityLabel={t('today.calm.dayClose.a11y')}
                  style={s.calmChip}
                />
              )}
            </View>
            {energySuggested && !lowEnergyFilter && (
              <Text style={s.breakNote}>{ENERGY_COPY.suggest}</Text>
            )}
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
                  <Text style={s.lowEnergyTitle}>{t('today.lowEnergy.title')}</Text>
                  <Text style={s.breakNote}>{t('today.lowEnergy.body')}</Text>
                </View>
              </View>
            </BentoVisualCard>
          )}

          <NextUpStrip items={nextUpItems} blockTasks={blockTasks} onPress={handleNextUpPress} />
        </View>

        {/* Bağlamsal 4. Blok — yalnız doluysa tek kapsayıcı */}
        {hasContext && (
          <View testID="today-block-context" style={s.contextBlock}>
            {!legacyNoticeSeen && (
              <Card padding="lg">
                <Text style={s.breakNote}>{t('today.legacyNotice.body')}</Text>
                <View style={s.legacyNoticeBtnWrap}>
                  <Button
                    label={t('today.legacyNotice.ok')}
                    variant="ghost"
                    size="sm"
                    onPress={dismissLegacyNotice}
                  />
                </View>
              </Card>
            )}

            {afterBreak && (
              <Card padding="lg" accessibilityLabel={`${FLOW_COPY.afterBreakTitle}. ${FLOW_COPY.afterBreak}`}>
                <SectionHeader title={fmt.upper(FLOW_COPY.afterBreakTitle)} variant="overline" />
                <Text style={s.breakNote}>{FLOW_COPY.afterBreak}</Text>
              </Card>
            )}

            {holiday && (
              <HolidayCard endDate={holiday.end_date ?? null} onEnd={handleEndHoliday} />
            )}

            {setAsideHabits.length > 0 && (
              <SetAsideCard habits={setAsideHabits} onHabitTap={onHabitTap} />
            )}

            {capsuleMoment && eligibleCapsuleItem && (
              <TimeCapsuleCard
                capsule={eligibleCapsuleItem}
                onRead={() => {
                  void caps.open(eligibleCapsuleItem.id);
                  setCapsuleMoment(false);
                }}
                onLater={() => setCapsuleMoment(false)}
              />
            )}
          </View>
        )}

        {/* Sakin Metrik Kartları — yalnız metrics aracı açıkken */}
        {showMetrics && metrics && (
          <>
            <MetricGrid metrics={metrics} />
            <ChapterDivider source={DECOR.dividerSundial} label={t('today.workbench.overline')} />
          </>
        )}

        {/* Akıllı Segment Filtresi — yalnız segments aracı açıkken */}
        {showSegments && (
          <View style={s.segmentedRow}>
            <TouchableOpacity
              style={[s.segmentBtn, effectiveSegment === 'all' && s.segmentBtnActive]}
              onPress={() => { haptic.select(); setActiveSegment('all'); }}
              accessibilityRole="button"
              accessibilityLabel={t('today.segments.all.a11y')}
            >
              <Ionicons name="layers-outline" size={14} color={effectiveSegment === 'all' ? c.primary : c.textDim} />
              <Text style={[s.segmentText, effectiveSegment === 'all' && s.segmentTextActive]}>{t('today.segments.all')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[s.segmentBtn, effectiveSegment === 'habits' && s.segmentBtnActive]}
              onPress={() => { haptic.select(); setActiveSegment('habits'); }}
              accessibilityRole="button"
              accessibilityLabel={t('today.segments.habits.a11y')}
            >
              <Ionicons name="repeat-outline" size={14} color={effectiveSegment === 'habits' ? c.primary : c.textDim} />
              <Text style={[s.segmentText, effectiveSegment === 'habits' && s.segmentTextActive]}>{t('today.segments.habits')}</Text>
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
              accessibilityLabel={t('today.segments.tasks.a11y')}
            >
              <Ionicons name="checkbox-outline" size={14} color={effectiveSegment === 'tasks' ? c.primary : c.textDim} />
              <Text style={[s.segmentText, effectiveSegment === 'tasks' && s.segmentTextActive]}>{t('today.segments.tasks')}</Text>
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
                accessibilityLabel={t('today.segments.balance.a11y')}
              >
                <Ionicons name="compass-outline" size={14} color={effectiveSegment === 'balance' ? c.primary : c.textDim} />
                <Text style={[s.segmentText, effectiveSegment === 'balance' && s.segmentTextActive]}>{t('today.segments.balance')}</Text>
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
                onOpenRing={() => router.push('/tabs/timeline')}
                onOpenTimeline={() => router.push('/tabs/timeline')}
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
                    <Text style={s.sectionEyebrow}>{t('today.tasks.eyebrow', { count: pendingTasks.length })}</Text>
                    <Text style={s.sectionTitle}>{t('today.tasks.title')}</Text>
                  </View>
                  <Button
                    label={t('today.seeAll')}
                    variant="ghost"
                    size="sm"
                    onPress={() => router.push('/tabs/tasks')}
                    accessibilityLabel={t('today.tasks.openAll.a11y')}
                  />
                </View>
                <OutboxIssues />
                <View style={{ marginBottom: space.sm }}>
                  <InlineComposer
                    placeholder={t('today.tasks.composerPlaceholder')}
                    quickAdd={{ projects: quickProjects }}
                    voice
                    onSubmit={async (text, quick) => {
                      await addTask(
                        quickAddToTaskInput(
                          text,
                          quick,
                          { priority: 'none', list_type: 'inbox', due_date: today, project_id: null },
                          today,
                        ),
                      );
                    }}
                  />
                </View>
                {pendingTasks.length === 0 ? (
                  <Card padding="lg">
                    <EmptyState
                      variant="editorial"
                      icon="checkmark-circle-outline"
                      title={t('today.tasks.empty.title')}
                      hint={t('today.tasks.empty.hint')}
                      ctaLabel={t('today.tasks.empty.cta')}
                      onCta={() => router.push('/tabs/tasks')}
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
                            accessibilityLabel={completeTaskA11y(t.title)}
                          >
                            <View style={[s.taskDot, { borderColor: priorityColor(t.priority) }]} />
                            <Text style={s.taskTitle} numberOfLines={1}>{t.title}</Text>
                            {t.due_date && (
                              <View style={[s.dueBadge, t.due_date < today && s.dueBadgeOverdue]}>
                                <Text style={[s.taskDate, t.due_date < today && { color: c.error }]}>
                                  {t.due_date === today ? dueTodayLabel : t.due_date}
                                </Text>
                              </View>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={s.smallStartBtn}
                            onPress={() => setSmallStartFor({ kind: 'task', id: t.id, title: t.title })}
                            hitSlop={8}
                            accessibilityRole="button"
                            accessibilityLabel={smallStartTaskA11y(t.title)}
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
                  onPress={() => navigateTo(router, 'profile')}
                  accessibilityRole="button"
                  accessibilityLabel={t('today.balance.xp.a11y')}
                >
                  <XPDisplay />
                </TouchableOpacity>

                {wp && (
                  <Card padding="lg" onPress={() => router.push('/tabs/timeline')}>
                    <View style={s.wpHead}>
                      <Text style={s.wpHeadText}>{t('today.willpower.title')}</Text>
                      <Text style={s.wpHeadHint}>{t('today.willpower.hint')}</Text>
                    </View>
                    <WillpowerBand wp={wp} />
                  </Card>
                )}

                <RecoveryRailCard
                  plans={recoveryPlans}
                  today={today}
                  onOpen={() => navigateTo(router, 'recovery')}
                />
              </>
            )}

            {showRoutine && (
              <Card padding="lg" style={{ overflow: 'hidden', position: 'relative' }} onPress={() => router.push('/screens/routine-runner')}>
                <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={108} opacity={0.16} />
                <SectionHeader title={t('today.routine.overline')} variant="overline" />
                <Text style={s.breakNote}>
                  {runnerSession && runnerSession.status !== 'finished'
                    ? t('today.routine.active', {
                        name: runnerSession.templateName,
                        done: Object.keys(runnerSession.results).length,
                        total: runnerSession.steps.length,
                      })
                    : suggestedRoutineName
                      ? t('today.routine.suggested', { name: suggestedRoutineName })
                      : t('today.routine.idle')}
                </Text>
              </Card>
            )}

            {showStrategy && (
              <Card padding="lg" style={{ overflow: 'hidden', position: 'relative' }} onPress={() => navigateTo(router, 'okr')}>
                <EmbeddedFiligree source={DECOR.cornerBlueprint} anchor="bottom-right" size={108} opacity={0.17} />
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space.xs }}>
                  <SectionHeader title={t('today.strategy.overline')} variant="overline" />
                  <Ionicons name="chevron-forward" size={14} color={c.textGhost} />
                </View>
                <Text style={s.breakNote}>{t('today.strategy.body')}</Text>
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
          if (started) { setSmallStartFor(null); router.push('/tabs/focus'); }
          return started;
        }}
      />

      <Modal visible={lightDayPick !== null} transparent animationType="slide" onRequestClose={closeLightDaySheet}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.sheetOverlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>{t('today.lightDay.title')}</Text>
            <Text style={s.sheetBody}>{FLOW_COPY.lighten}</Text>
            <Text style={s.sheetNote}>{t('today.lightDay.capacityNote')}</Text>
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
                    accessibilityLabel={t('today.lightDay.pick.a11y', { name: h.name })}
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
                <Text style={s.sheetNote}>{t('today.lightDay.noteHint')}</Text>
              )}
              <TextInput
                value={lightDayNote}
                onChangeText={setLightDayNote}
                placeholder={t('today.lightDay.notePlaceholder')}
                placeholderTextColor={c.textFaint}
                maxLength={NOTE_MAX_LENGTH}
                returnKeyType="done"
                accessibilityLabel={t('today.lightDay.note.a11y')}
                style={s.lightDayNoteInput}
              />
              <Text style={s.lightDayNoteSub}>{t('today.lightDay.noteSub')}</Text>
            </View>
            <View style={s.sheetActions}>
              <TouchableOpacity
                style={s.sheetCancel}
                onPress={closeLightDaySheet}
                accessibilityRole="button"
                accessibilityLabel={t('common.cancel')}
              >
                <Text style={s.sheetCancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.sheetSave, (!lightDayPick || lightDayPick.size === 0 || lightDaySaving) && s.sheetSaveDisabled]}
                onPress={confirmLightDay}
                disabled={!lightDayPick || lightDayPick.size === 0 || lightDaySaving}
                accessibilityRole="button"
                accessibilityLabel={t('today.lightDay.confirm.a11y')}
                accessibilityState={{ disabled: !lightDayPick || lightDayPick.size === 0 || lightDaySaving }}
              >
                <Text style={s.sheetSaveText}>{lightDaySaving ? t('today.lightDay.saving') : t('today.lightDay.confirm')}</Text>
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
                <Text style={s.shutdownTitle}>{t('today.shutdown.title')}</Text>
              </View>
              <Text style={s.sheetBody}>
                {t('today.shutdown.summary', {
                  done: completedHabits.length,
                  total: habitSummary.total,
                  sessions: sessionsCompleted,
                })}
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
                    accessibilityLabel={t('today.shutdown.lighten.a11y')}
                  >
                    <Ionicons name="leaf-outline" size={18} color={c.success} />
                    <View style={{ flex: 1 }}>
                      <Text style={s.shutdownOptionTitle}>
                        {t('today.shutdown.lighten.title', { count: remainingHabits })}
                      </Text>
                      <Text style={s.shutdownOptionSub}>{t('today.shutdown.lighten.sub')}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                  </TouchableOpacity>
                )}

                <TouchableOpacity
                  style={s.shutdownOptionCard}
                  onPress={() => {
                    setShutdownOpen(false);
                    navigateTo(router, 'journal');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('today.shutdown.journal.a11y')}
                >
                  <Ionicons name="journal-outline" size={18} color={c.accent} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.shutdownOptionTitle}>{t('today.shutdown.journal.title')}</Text>
                    <Text style={s.shutdownOptionSub}>{t('today.shutdown.journal.sub')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={s.shutdownOptionCard}
                  onPress={() => {
                    setShutdownOpen(false);
                    navigateTo(router, 'recovery');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={t('today.shutdown.recovery.a11y')}
                >
                  <Ionicons name="shield-checkmark-outline" size={18} color={c.primary} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.shutdownOptionTitle}>{t('today.shutdown.recovery.title')}</Text>
                    <Text style={s.shutdownOptionSub}>{t('today.shutdown.recovery.sub')}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.textFaint} />
                </TouchableOpacity>
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[s.sheetSave, s.shutdownFinishBtn]}
              onPress={onFinishClose}
              accessibilityRole="button"
              accessibilityLabel={t('today.shutdown.finish.a11y')}
            >
              <Text style={s.sheetSaveText}>{t('today.shutdown.finish')}</Text>
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
  calmModeChipSuggested: {
    borderColor: c.accent,
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
