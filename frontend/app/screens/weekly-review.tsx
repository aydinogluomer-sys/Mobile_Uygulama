import AsyncStorage from '@react-native-async-storage/async-storage';
import { alphaHex, font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { Button, EditorialBanner, IconButton } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import { currentUser } from '../../lib/session';
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator } from 'react-native';
import { notify } from '../../lib/dialog';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, startOfWeek, endOfWeek, subWeeks, eachDayOfInterval } from 'date-fns';
import type { Habit } from '../../lib/supabase';
import { useTaskStore, type Task } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
// R07.06 — next week's change as a real action, kept with the week.
import NextActionPicker from '../../components/NextActionPicker';
import {
  actionFor,
  actionOutcome,
  nextWeekMonday,
  previousWeekKey,
  reviewActionsKey,
  taskTitleFrom,
  upsertAction,
  type NextAction,
} from '../../lib/reviewActions';
import { useJournalStore } from '../../store/journalStore';
import { useRoutineRunnerStore } from '../../store/routineRunnerStore';
import { routineReport } from '../../lib/routineReport';
import { measuredRows, type MeasuredRow } from '../../lib/periodReport';
import MeasuredReportSection from '../../components/MeasuredReportSection';
import {
  buildArchiveReflection, calculateHabitCompletionRate, focusMinutesFromSessions,
  reportBadge, isCompletedState, type ReportBadge,
} from '../../lib/reportMetrics';
import { ymdFromIso, ymd, parseLocalDate, type Ymd } from '../../lib/date';
import { dailyLoad, type TaskLoadItem } from '../../lib/capacity';
import { carriesDayLoad } from '../../lib/habitSchedule';
import { recoverySuccessRate, type Result } from '../../lib/behaviorIntelligence';
import { planFromRow } from '../../lib/recovery';
import {
  logsForPeriod,
  type ReviewLogRow,
  recoveryForPeriod,
  loadWeeklyReflection as fetchWeeklyReview,
  saveWeeklyReflection as upsertWeeklyReview,
} from '../../services/reviewService';
import { sessionsBetween } from '../../services/focusService';
import TimeDistributionBar from '../../components/review/TimeDistributionBar';
import {
  buildTimeDistribution,
  habitDurationMinutes,
  type TimeDistribution,
} from '../../lib/timeDistribution';

function getWeekKey(date = new Date()) {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

function getWeekRange(date = new Date()) {
  return {
    start: format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    end: format(endOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
  };
}

const REVIEW_QUESTIONS = [
  { key: 'wins', label: '🏆 Bu hafta ne işe yaradı?', placeholder: 'İşe yarayanları yaz...' },
  { key: 'challenges', label: '⚡ Nerede zorlandın?', placeholder: 'Zorlandığın yerleri yaz...' },
  { key: 'next_week', label: '🎯 Gelecek hafta ne değişmeli?', placeholder: 'Değişmesi gerekenleri yaz...' },
];

// ---------------------------------------------------------------------------
// §12 auto-derived metrics -- "Toplam tamamlama · Habit completion ·
// Task completion · Focus duration · Recovery completion · Capacity
// overload days". `Habit completion` and `Focus duration` already exist as
// this screen's own `habitCompletionRate`/`focusMinutes` state (rendered in
// the pre-existing metricsRow above) -- reused there, not duplicated here.
// ---------------------------------------------------------------------------

type AutoMetrics = {
  /** Completed habit-log occurrences (done|partial) + completed tasks this week -- both real counts, never fabricated. */
  /** `null` when the habit-log fetch failed -- a failed query must not render
   *  as "0 tamamlama", which claims the user achieved nothing. Same rule as
   *  `willpowerStore.score()` returning null instead of a fabricated 100. */
  totalCompletions: number | null;
  /** Completed habit-log occurrences (done|partial) alone, or `null` when logs failed to load. */
  completedLogCount: number | null;
  /** `null` when the week has no tasks to rate against (insufficient data, not a fabricated 0/0). */
  taskCompletionRate: number | null;
  /** `lib/behaviorIntelligence.recoverySuccessRate` over this week's recovery plans -- a genuine `Result`, rendered via `.reason` on `{ok:false}`. */
  recoveryCompletion: Result<number>;
  /** Days in the week whose `dailyLoad` band was `aşırı` (lib/capacity.ts). */
  overloadDays: number;
};

const EMPTY_AUTO_METRICS: AutoMetrics = {
  totalCompletions: null,
  completedLogCount: null,
  taskCompletionRate: null,
  recoveryCompletion: { ok: false, reason: 'Henüz yüklenmedi' },
  overloadDays: 0,
};

/**
 * How many days in `[start, end]` had a `dailyLoad` band of `aşırı` --
 * plan §12's "Capacity overload days". Walks each local day, asks which
 * ACTIVE habits carried work that day (`carriesDayLoad` -- `isDueOn` for
 * day-based schedules, open-and-unmet period for count-based ones, so a
 * "3 a week" habit no longer loads invented weekdays), which tasks were due
 * that day, how many tasks were already overdue as of that day, and how
 * many focus minutes were logged that day -- exactly `dailyLoad`'s four
 * inputs (lib/capacity.ts) -- then classifies the resulting band via
 * `dailyLoad` itself. No new domain logic: this is composition of existing
 * `lib/**` exports, screen-local (mirrors `habit-detail.tsx`'s own
 * screen-local day-walking helpers) because `lib/**` is off-limits to this
 * task.
 */
function countOverloadDays(params: {
  start: Ymd;
  end: Ymd;
  activeHabits: Habit[];
  allTasks: Task[];
  focusSessions: { started_at: string; completed_seconds: number }[];
  // R01.02-b -- `carriesDayLoad` needs completions to tell an open, unmet
  // count period from a satisfied one. Day-based habits ignore it.
  habitLogs: ReviewLogRow[];
}): number {
  const startDate = parseLocalDate(params.start);
  const endDate = parseLocalDate(params.end);
  if (!startDate || !endDate) return 0;

  const days = eachDayOfInterval({ start: startDate, end: endDate }).map((d) => ymd(d));
  let count = 0;
  for (const day of days) {
    const dateObj = parseLocalDate(day);
    if (!dateObj) continue;
    const habitsDue = params.activeHabits.filter((h) => carriesDayLoad(h, params.habitLogs, dateObj));
    // `Task` (store/taskStore.ts) has no `estimated_minutes` field -- map to
    // `TaskLoadItem` (an intentionally all-optional weak type) so `dailyLoad`
    // falls back to its own `DEFAULT_TASK_MINUTES` per task, same as every
    // other caller of `dailyLoad({ tasks })` in this codebase.
    const tasksDue: TaskLoadItem[] = params.allTasks
      .filter((t) => t.due_date === day && t.status !== 'cancelled')
      .map(() => ({}));
    const overdueCount = params.allTasks.filter(
      (t) => !!t.due_date && t.due_date < day && !t.completed && t.status !== 'cancelled',
    ).length;
    const focusMinutesForDay = focusMinutesFromSessions(
      params.focusSessions.filter((s) => ymdFromIso(s.started_at) === day),
    );
    const load = dailyLoad({ habits: habitsDue, tasks: tasksDue, focusMinutes: focusMinutesForDay, overdueCount });
    if (load.band === 'asiri') count += 1;
  }
  return count;
}

function AutoMetricTile({ label, value }: { label: string; value: string }) {
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.autoMetricTile}>
      <Text style={s.autoMetricValue} numberOfLines={1}>{value}</Text>
      <Text style={s.autoMetricLabel}>{label}</Text>
    </View>
  );
}

export default function WeeklyReviewScreen() {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const tasks = useTaskStore((st) => st.tasks);
  const fetchTasks = useTaskStore((st) => st.fetchTasks);
  const addTask = useTaskStore((st) => st.addTask);
  const habits = useHabitStore((st) => st.habits);
  const fetchHabits = useHabitStore((st) => st.fetchHabits);
  const appendEntry = useJournalStore((st) => st.appendEntry);

  const [weekOffset, setWeekOffset] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [habitCompletionRate, setHabitCompletionRate] = useState<number | null>(null);
  const [focusMinutes, setFocusMinutes] = useState(0);
  const [badge, setBadge] = useState<ReportBadge | null>(null);
  const [autoMetrics, setAutoMetrics] = useState<AutoMetrics>(EMPTY_AUTO_METRICS);
  // R07.04 — amount/duration per measured habit, from the R01 engine.
  const [measured, setMeasured] = useState<MeasuredRow[]>([]);
  const [weekTime, setWeekTime] = useState<TimeDistribution | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // U10 & REC-06 — persisted weekly adjustments & reversible undo state
  const [reviewUserId, setReviewUserId] = useState<string | null>(null);
  const [reviewActions, setReviewActions] = useState<NextAction[]>([]);
  const [actionsSyncTick, setActionsSyncTick] = useState(0);
  const [quickAdjustOpen, setQuickAdjustOpen] = useState(false);
  const [quickAdjustDraft, setQuickAdjustDraft] = useState('');
  const [quickAdjustError, setQuickAdjustError] = useState<string | null>(null);
  const [savingQuickAdjust, setSavingQuickAdjust] = useState(false);
  const [undoingAdjustment, setUndoingAdjustment] = useState(false);
  const nextWeekInputRef = useRef<TextInput | null>(null);

  const targetDate = subWeeks(new Date(), weekOffset);
  const weekKey = getWeekKey(targetDate);
  const currentWeekKeyRef = useRef(weekKey);
  const { start, end } = getWeekRange(targetDate);
  const isCurrentWeek = weekOffset === 0;
  // R05.07 — routine sessions, from the summary each session stored when it finished.
  const routineHistory = useRoutineRunnerStore((st) => st.history);
  const routines = routineReport(routineHistory, start, end);

  const weekTasks = tasks.filter((task) => {
    const day = ymdFromIso(task.completed_at ?? task.created_at);
    return day >= start && day <= end;
  });
  const completedTasks = weekTasks.filter((task) => task.completed);
  const activeHabits = habits.filter((habit) => habit.status === 'active');

  useEffect(() => {
    fetchTasks();
    fetchHabits();
  }, [fetchTasks, fetchHabits]);

  async function loadReview() {
    const user = await currentUser();
    if (!user) {
      setReviewUserId(null);
      setReviewActions([]);
      setAnswers({});
      setSavedAt(null);
      return;
    }

    setReviewUserId(user.id);
    try {
      const rawActions = await AsyncStorage.getItem(reviewActionsKey(user.id));
      const parsed = rawActions ? (JSON.parse(rawActions) as unknown) : [];
      setReviewActions(Array.isArray(parsed) ? (parsed as NextAction[]) : []);
    } catch {
      setReviewActions([]);
    }

    const res = await fetchWeeklyReview({ weekKey });

    if (res.ok && res.data) {
      setAnswers({
        wins: res.data.wins ?? '',
        challenges: res.data.challenges ?? '',
        next_week: res.data.next_week ?? '',
      });
      setSavedAt(res.data.created_at ? format(new Date(res.data.created_at), 'dd.MM.yyyy') : null);
      return;
    }

    setAnswers({});
    setSavedAt(null);
  }

  async function loadWeekMetrics() {
    const keyAtStart = weekKey;
    const user = await currentUser();
    if (!user) {
      if (keyAtStart !== currentWeekKeyRef.current) return;
      setHabitCompletionRate(null);
      setFocusMinutes(0);
      setBadge(reportBadge({ habitRate: null, focusMinutes: 0, completedTasks: completedTasks.length }));
      setAutoMetrics(EMPTY_AUTO_METRICS);
      setWeekTime(null);
      return;
    }

    const [logsRes, sessionsRes, recoveryRes] = await Promise.all([
      logsForPeriod({ start, end }),
      sessionsBetween({ startYmd: start, endYmd: end }),
      recoveryForPeriod({ start, end }),
    ]);

    if (keyAtStart !== currentWeekKeyRef.current) return;

    const rate = logsRes.ok ? calculateHabitCompletionRate(habits, logsRes.data, start, end, { asOf: new Date() }) : null;
    const weekSessions = sessionsRes.ok ? sessionsRes.data : [];
    const minutes = focusMinutesFromSessions(weekSessions);
    const nextBadge = reportBadge({ habitRate: rate, focusMinutes: minutes, completedTasks: completedTasks.length });

    const todayYmd = ymd(new Date());
    const clampedEnd = end < todayYmd ? end : todayYmd;
    const habitDur = logsRes.ok
      ? habitDurationMinutes(habits, logsRes.data, { start, end: clampedEnd })
      : null;
    setWeekTime(
      buildTimeDistribution({
        focusMinutes: sessionsRes.ok ? minutes : null,
        routineMinutes: routines.activeMinutes,
        habitMinutes: habitDur ? habitDur.minutes : null,
        excludedHabits: habitDur ? habitDur.excluded : 0,
      }),
    );

    setHabitCompletionRate(rate);
    setFocusMinutes(minutes);
    setBadge(nextBadge);
    setMeasured(logsRes.ok ? measuredRows(habits, logsRes.data, { start, end, asOf: new Date() }) : []);

    const completedLogCount = logsRes.ok
      ? logsRes.data.filter((l) => isCompletedState(l.state)).length
      : null;
    const taskCompletionRate = weekTasks.length > 0
      ? Math.round((completedTasks.length / weekTasks.length) * 100)
      : null;
    const recoveryCompletion: Result<number> = recoveryRes.ok
      ? recoverySuccessRate(recoveryRes.data.map(planFromRow))
      : { ok: false, reason: 'Telafi verisi yüklenemedi.' };
    const overloadDays = countOverloadDays({
      start, end, activeHabits, allTasks: tasks, focusSessions: weekSessions,
      habitLogs: logsRes.ok ? logsRes.data : [],
    });

    setAutoMetrics({
      totalCompletions: completedLogCount == null ? null : completedLogCount + completedTasks.length,
      completedLogCount,
      taskCompletionRate,
      recoveryCompletion,
      overloadDays,
    });
  }

  // ── Why a ref rather than a dependency ────────────────────────────────
  //
  // The two loaders are plain functions re-created on every render, so
  // naming them as dependencies would re-run this effect on every render —
  // an unbounded fetch loop on the heaviest screen in the app. Wrapping
  // them in useCallback does not help either: they close over `now`,
  // `targetDate` and freshly filtered arrays, so their identity would still
  // change every time.
  //
  // Their identity was never the trigger. The trigger is the listed inputs.
  // A ref says exactly that: run when those change, and call whatever
  // version of the loaders exists at that moment.
  const loaders = useRef({ loadReview, loadWeekMetrics });
  useEffect(() => {
    currentWeekKeyRef.current = weekKey;
    loaders.current = { loadReview, loadWeekMetrics };
  });

  useEffect(() => {
    void loaders.current.loadReview();
    void loaders.current.loadWeekMetrics();
  }, [weekOffset, habits.length, tasks.length, routineHistory.length]);

  async function handleSave() {
    setSaving(true);
    try {
      const user = await currentUser();
      if (!user) throw new Error('Oturum bulunamadı');

      const res = await upsertWeeklyReview({
        weekKey,
        wins: answers.wins ?? null,
        challenges: answers.challenges ?? null,
        next_week: answers.next_week ?? null,
      });
      if (!res.ok) throw new Error(res.error);

      const currentBadge = badge ?? reportBadge({ habitRate: habitCompletionRate, focusMinutes, completedTasks: completedTasks.length });

      await appendEntry(
        format(new Date(), 'yyyy-MM-dd'),
        buildArchiveReflection({
          sourceLabel: 'Haftalık Rapor',
          periodLabel: `${start} - ${end}`,
          start,
          end,
          answers,
          metrics: {
            taskCount: completedTasks.length,
            habitRate: habitCompletionRate,
            focusMinutes,
            badge: currentBadge,
          },
        }),
      );

      setSavedAt(format(new Date(), 'dd.MM.yyyy'));
    } catch (error) {
      void notify('Hata', error instanceof Error ? error.message : 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  }

  function handleJumpToAdjustment() {
    const fromText = taskTitleFrom(answers.next_week ?? '');
    const defaultSuggestion =
      autoMetrics.overloadDays > 0
        ? 'En yoğun günde bir görevi yarına taşıyarak kapasiteyi dengele'
        : 'Pazartesi sabahına 10 dakikalık tek bir odak adımı ekle';
    const draft = fromText.length > 0 ? fromText : defaultSuggestion;
    setQuickAdjustDraft(draft);
    setQuickAdjustError(null);
    setQuickAdjustOpen(true);
    if (!answers.next_week || answers.next_week.trim().length === 0) {
      setAnswers((current) => ({ ...current, next_week: draft }));
    }
    nextWeekInputRef.current?.focus();
  }

  async function handleApplyQuickAdjustment() {
    const cleanTitle = quickAdjustDraft.trim();
    if (!cleanTitle) {
      setQuickAdjustError('Küçük ayar için bir başlık yaz.');
      return;
    }
    setSavingQuickAdjust(true);
    setQuickAdjustError(null);
    try {
      const uid = reviewUserId ?? (await currentUser())?.id ?? null;
      if (!uid) {
        setQuickAdjustError('Oturum bulunamadı.');
        return;
      }
      const created = await addTask({
        title: cleanTitle,
        due_date: nextWeekMonday(weekKey),
        list_type: 'this_week',
        priority: 'none',
      });
      if (!created) {
        setQuickAdjustError('Küçük ayar görevi eklenemedi.');
        return;
      }
      const nextEntry: NextAction = {
        weekKey,
        kind: 'task',
        taskId: created.id,
        label: cleanTitle,
        createdAt: new Date().toISOString(),
      };
      const updatedList = upsertAction(reviewActions, nextEntry);
      await AsyncStorage.setItem(reviewActionsKey(uid), JSON.stringify(updatedList));
      setReviewUserId(uid);
      setReviewActions(updatedList);
      setQuickAdjustOpen(false);
      setActionsSyncTick((n) => n + 1);
    } finally {
      setSavingQuickAdjust(false);
    }
  }

  async function handleUndoAdjustment() {
    const mine = actionFor(reviewActions, weekKey);
    if (!mine) return;
    setUndoingAdjustment(true);
    try {
      const uid = reviewUserId ?? (await currentUser())?.id ?? null;
      const updatedList = reviewActions.filter((entry) => entry.weekKey !== weekKey);
      if (uid) {
        await AsyncStorage.setItem(reviewActionsKey(uid), JSON.stringify(updatedList));
      }
      if (mine.kind === 'task') {
        const storeState = useTaskStore.getState() as ReturnType<typeof useTaskStore.getState> & {
          deleteTask?: (id: string) => Promise<void>;
        };
        const linkedTask = storeState.tasks.find((t) => t.id === mine.taskId);
        if (!linkedTask || !linkedTask.completed) {
          if (typeof storeState.deleteTask === 'function') {
            await storeState.deleteTask(mine.taskId);
          } else {
            await storeState.removeTask(mine.taskId);
          }
        }
      }
      setReviewActions(updatedList);
      setActionsSyncTick((n) => n + 1);
    } finally {
      setUndoingAdjustment(false);
    }
  }

  const observedSampleCount =
    autoMetrics.completedLogCount == null
      ? null
      : autoMetrics.completedLogCount + completedTasks.length + (focusMinutes >= 10 ? 1 : 0);
  const hasSufficientInsightData =
    autoMetrics.totalCompletions !== null &&
    observedSampleCount !== null &&
    observedSampleCount >= 3;
  const currentAdjustment = actionFor(reviewActions, weekKey);
  const previousAdjustment = actionFor(reviewActions, previousWeekKey(weekKey));
  const taskCompleted = (id: string) => {
    const found = tasks.find((x) => x.id === id);
    return found ? found.completed : undefined;
  };

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.observatoryStats} textureSource={TEXTURES.topographic} scrim={0.64} tintColor={colors.teal} />
      <ScrollView contentContainerStyle={s.content}>
        <EditorialBanner
          source={SCREEN_BANNERS.reviewWeekly}
          textureSource={TEXTURES.topographic}
          eyebrow="HAFTALIK UFUK"
          title="Haftalık Değerlendirme"
          subtitle={`${start} - ${end} dönemi ritim ve kapasite özeti.`}
          accentColor={colors.teal}
          minHeight={92}
          style={{ marginBottom: 14 }}
        />
        <View style={s.hero}>
          <View style={s.heroIcon}>
            <Ionicons name="bar-chart-outline" size={28} color={colors.teal} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle} accessibilityRole="header">Haftalık Rapor</Text>
            <Text style={s.heroDates}>{start} - {end}</Text>
          </View>
          <View style={s.weekNav}>
            <IconButton
              icon="chevron-back"
              size={18}
              color={colors.textDim}
              compact
              label="Önceki hafta"
              onPress={() => setWeekOffset((offset) => offset + 1)}
              style={s.navBtn}
            />
            <IconButton
              icon="chevron-forward"
              size={18}
              color={isCurrentWeek ? colors.textGhost : colors.textDim}
              compact
              disabled={isCurrentWeek}
              label="Sonraki hafta"
              onPress={() => setWeekOffset((offset) => Math.max(0, offset - 1))}
              style={s.navBtn}
            />
          </View>
        </View>

        <View style={s.metricsRow}>
          <View style={s.metric}>
            <Text style={s.metricValue}>{completedTasks.length}</Text>
            <Text style={s.metricLabel}>Görev{'\n'}Tamamlandı</Text>
          </View>
          <View style={s.metric}>
            <Text
              style={[s.metricValue, { color: habitCompletionRate === null ? colors.textDim : colors.success }]}
              accessibilityLabel={habitCompletionRate === null ? 'Alışkanlık oranı: veri yok' : `Alışkanlık oranı: yüzde ${habitCompletionRate}`}
            >
              {habitCompletionRate === null ? '—' : `${habitCompletionRate}%`}
            </Text>
            <Text style={s.metricLabel}>Alışkanlık{'\n'}Oran</Text>
          </View>
          <View style={s.metric}>
            <Text style={[s.metricValue, { color: colors.accent }]}>{focusMinutes}</Text>
            <Text style={s.metricLabel}>Odak{'\n'}Dakika</Text>
          </View>
          <View style={s.metric}>
            <Text style={s.metricValue}>{activeHabits.length}</Text>
            <Text style={s.metricLabel}>Aktif{'\n'}Alışkanlık</Text>
          </View>
        </View>

        {badge && (
          <View style={s.badgeCard}>
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.14} />
            <Text style={[s.badgeEmoji, { color: badge.color }]}>{badge.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.badgeTitle}>{badge.label}</Text>
              <Text style={s.badgeDesc}>{badge.level.toLocaleUpperCase('tr-TR')} · Haftalık rapor özeti</Text>
            </View>
          </View>
        )}

        {/* U10 & REC-06 — BU HAFTA NE İŞLEDİ? & BİR KÜÇÜK AYAR */}
        <View testID="weekly-insight-action-card" style={s.insightActionCard}>
          <Text style={s.sectionTitle}>BU HAFTA NE İŞLEDİ? & BİR KÜÇÜK AYAR</Text>

          <View style={s.insightBlock}>
            <Text style={s.insightSubhead}>Bu hafta ne işledi?</Text>
            {!hasSufficientInsightData ? (
              <Text testID="weekly-insight-insufficient" style={s.insightInsufficientText}>
                Henüz yeterli kayıt yok — az veriden kişisel örüntü iddiası üretilmez.
              </Text>
            ) : (
              <>
                <Text testID="weekly-insight-summary" style={s.insightBodyText}>
                  Bu hafta {autoMetrics.completedLogCount} alışkanlık kaydı ve {completedTasks.length} görev tamamlandı
                  {focusMinutes > 0 ? `, toplam ${focusMinutes} dk odaklanıldı` : ''}.
                  {autoMetrics.overloadDays === 0
                    ? ' Günlük yük hiçbir gün aşırı yük bandına çıkmadı.'
                    : ` ${autoMetrics.overloadDays} gün kapasite aşırı yük bandında seyretti.`}
                </Text>
                <Text testID="weekly-insight-correlation-note" style={s.insightCorrelationText}>
                  Not: Bu özet gözlenen birlikteliği gösterir; tek başına kesin neden-sonuç anlamına gelmez.
                </Text>
              </>
            )}
          </View>

          <View style={s.insightDivider} />

          <View style={s.insightBlock}>
            <Text style={s.insightSubhead}>Bir küçük ayar</Text>
            {previousAdjustment && (
              <Text testID="weekly-previous-adjustment-outcome" style={s.insightPrevOutcome}>
                Geçen haftanın ayarı: {actionOutcome(previousAdjustment, { taskCompleted })}
              </Text>
            )}

            {currentAdjustment ? (
              <View style={s.currentAdjustWrap}>
                <Text testID="weekly-current-adjustment" style={s.insightChosenText}>
                  Seçilen ayar:{' '}
                  {currentAdjustment.kind === 'task'
                    ? `"${currentAdjustment.label}" görevi gelecek hafta için eklendi`
                    : currentAdjustment.label}
                </Text>
                <Button
                  testID="weekly-undo-adjustment"
                  label={undoingAdjustment ? 'Geri alınıyor...' : 'Öneriyi geri al'}
                  variant="tonal"
                  size="sm"
                  icon="arrow-undo-outline"
                  color={colors.warning}
                  disabled={undoingAdjustment}
                  loading={undoingAdjustment}
                  onPress={() => {
                    void handleUndoAdjustment();
                  }}
                  accessibilityLabel="Öneriyi geri al"
                  style={s.alignStart}
                />
              </View>
            ) : isCurrentWeek ? (
              quickAdjustOpen ? (
                <View style={s.quickAdjustComposer}>
                  <TextInput
                    testID="weekly-adjustment-input"
                    style={s.quickAdjustInput}
                    value={quickAdjustDraft}
                    onChangeText={(val) => {
                      setQuickAdjustDraft(val);
                      setQuickAdjustError(null);
                    }}
                    placeholder="Gelecek hafta için küçük bir ayar yaz..."
                    placeholderTextColor={colors.textFaint}
                    maxLength={120}
                    accessibilityLabel="Gelecek hafta küçük ayar başlığı"
                  />
                  {quickAdjustError && (
                    <Text style={s.quickAdjustErrorText}>{quickAdjustError}</Text>
                  )}
                  <View style={s.quickAdjustBtnRow}>
                    <Button
                      testID="weekly-cancel-adjustment"
                      label="Vazgeç"
                      variant="ghost"
                      size="sm"
                      color={colors.textDim}
                      onPress={() => {
                        setQuickAdjustOpen(false);
                        setQuickAdjustError(null);
                      }}
                      accessibilityLabel="Küçük ayar seçiminden vazgeç"
                    />
                    <Button
                      testID="weekly-apply-adjustment"
                      label={savingQuickAdjust ? 'Ekleniyor...' : 'Ayarı uygula'}
                      variant="tonal"
                      size="sm"
                      color={colors.teal}
                      full
                      disabled={savingQuickAdjust}
                      loading={savingQuickAdjust}
                      onPress={() => {
                        void handleApplyQuickAdjustment();
                      }}
                      accessibilityLabel="Küçük ayarı gelecek hafta için uygula"
                    />
                  </View>
                </View>
              ) : (
                <Button
                  testID="weekly-jump-to-adjustment"
                  label="Küçük bir ayar belirle"
                  variant="tonal"
                  size="sm"
                  icon="options-outline"
                  color={colors.teal}
                  onPress={handleJumpToAdjustment}
                  accessibilityLabel="Gelecek hafta için küçük bir ayar belirle"
                  style={s.alignStart}
                />
              )
            ) : (
              <Text style={s.insightPrevOutcome}>Bu hafta için seçilmiş bir küçük ayar yok.</Text>
            )}
          </View>
        </View>

        {/* §12 -- Toplam tamamlama · Habit completion · Task completion · Focus duration · Recovery completion · Capacity overload days */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>OTOMATİK METRİKLER</Text>
          <View style={s.autoMetricGrid}>
            <AutoMetricTile
              label="Toplam Tamamlama"
              value={autoMetrics.totalCompletions != null ? String(autoMetrics.totalCompletions) : 'Veri yok'}
            />
            <AutoMetricTile label="Alışkanlık Tamamlama" value={habitCompletionRate != null ? `%${habitCompletionRate}` : 'Veri yok'} />
            <AutoMetricTile
              label="Görev Tamamlama"
              value={autoMetrics.taskCompletionRate != null ? `%${autoMetrics.taskCompletionRate}` : 'Veri yok'}
            />
            <AutoMetricTile label="Odak Süresi" value={`${focusMinutes} dk`} />
            <AutoMetricTile label="Rutinler" value={routines.label} />
            <AutoMetricTile
              label="Telafi Tamamlama"
              value={autoMetrics.recoveryCompletion.ok ? `%${Math.round(autoMetrics.recoveryCompletion.value * 100)}` : autoMetrics.recoveryCompletion.reason}
            />
            <AutoMetricTile label="Aşırı Yüklenme Günü" value={`${autoMetrics.overloadDays} gün`} />
          </View>
        </View>

        {weekTime && (
          <View style={s.section}>
            <TimeDistributionBar
              distribution={weekTime}
              weekLabel={isCurrentWeek ? 'Bu hafta' : 'O hafta'}
            />
          </View>
        )}

        <ChapterDivider source={DECOR.dividerSundial} label="HAFTALIK ÖLÇÜM" />
        <MeasuredReportSection rows={measured} />

        {completedTasks.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>BU HAFTA TAMAMLANANLAR</Text>
            {completedTasks.slice(0, 5).map((task) => (
              <View key={task.id} style={s.taskItem}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                <Text style={s.taskTitle} numberOfLines={1}>{task.title}</Text>
              </View>
            ))}
            {completedTasks.length > 5 && <Text style={s.moreText}>+{completedTasks.length - 5} daha...</Text>}
          </View>
        )}

        <View style={s.section}>
          <Text style={s.sectionTitle}>YANSIMA</Text>
          {REVIEW_QUESTIONS.map((question) => (
            <View key={question.key} style={s.questionCard}>
              <Text style={s.questionLabel}>{question.label}</Text>
              <TextInput
                ref={question.key === 'next_week' ? nextWeekInputRef : undefined}
                style={s.questionInput}
                placeholder={question.placeholder}
                placeholderTextColor={colors.textFaint}
                multiline
                value={answers[question.key] ?? ''}
                onChangeText={(value) => setAnswers((current) => ({ ...current, [question.key]: value }))}
                editable={isCurrentWeek}
              />
              {question.key === 'next_week' && (
                <NextActionPicker weekKey={weekKey} nextWeekText={answers.next_week ?? ''} editable={isCurrentWeek} key={`${weekKey}-${actionsSyncTick}`} />
              )}
            </View>
          ))}
        </View>

        {isCurrentWeek && (
          <TouchableOpacity
            style={[s.saveBtn, saving && s.saveBtnLoading]}
            onPress={handleSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={saving ? 'Rapor kaydediliyor' : savedAt ? `Raporu güncelle, son kayıt ${savedAt}` : 'Raporu kaydet'}
            accessibilityState={{ disabled: saving, busy: saving }}
          >
            {saving ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : savedAt ? (
              <>
                <Ionicons name="checkmark" size={18} color={colors.white} />
                <Text style={s.saveBtnText}>Kaydedildi ({savedAt})</Text>
              </>
            ) : (
              <Text style={s.saveBtnText}>Raporu Kaydet</Text>
            )}
          </TouchableOpacity>
        )}

        {!isCurrentWeek && savedAt && (
          <View style={s.savedBadge}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={s.savedBadgeText}>Bu hafta kaydedildi - {savedAt}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.xl, paddingBottom: space.hh },
  hero: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginBottom: space.xl },
  heroIcon: { width: 48, height: 48, borderRadius: radius.lg, backgroundColor: alphaHex(colors.teal, '20'), alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...font.h2, color: colors.text },
  heroDates: { ...font.caption, color: colors.textFaint, marginTop: space.xs },
  weekNav: { flexDirection: 'row', gap: space.xs },
  navBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  metricsRow: { flexDirection: 'row', gap: space.sm, marginBottom: space.lg },
  metric: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  metricValue: { ...font.h2, color: colors.text, marginBottom: space.xs },
  metricLabel: { ...font.caption, color: colors.textFaint, textAlign: 'center', lineHeight: 14 },
  badgeCard: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: hexA(colors.surface, 0.92), borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, marginBottom: space.xxl, overflow: 'hidden', position: 'relative' },
  badgeEmoji: { ...font.h2 },
  badgeTitle: { ...font.bodySm, fontWeight: '700', color: colors.text },
  badgeDesc: { ...font.caption, color: colors.textFaint, marginTop: space.xs },
  section: { marginBottom: space.xxl },
  sectionTitle: { ...font.overline, color: colors.textFaint, marginBottom: space.sm },
  autoMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  autoMetricTile: { width: '31.5%', backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.sm, borderWidth: 1, borderColor: colors.border, alignItems: 'center', marginBottom: space.sm },
  autoMetricValue: { ...font.body, fontWeight: '700', color: colors.text, marginBottom: space.xs },
  autoMetricLabel: { ...font.caption, color: colors.textFaint, textAlign: 'center', lineHeight: 12 },
  taskItem: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, borderWidth: 1, borderColor: colors.border, marginBottom: space.xs },
  taskTitle: { flex: 1, ...font.bodySm, color: colors.textDim },
  moreText: { ...font.caption, color: colors.textFaint, paddingLeft: space.xs, marginTop: space.xs },
  questionCard: { marginBottom: space.md },
  questionLabel: { ...font.bodySm, color: colors.text, fontWeight: '600', marginBottom: space.sm },
  questionInput: { ...font.bodySm, backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, color: colors.text, borderWidth: 1, borderColor: colors.border, minHeight: 80, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.teal, borderRadius: radius.lg, paddingVertical: space.lg, marginTop: space.sm },
  saveBtnLoading: { opacity: 0.7 },
  saveBtnText: { ...font.h3, fontWeight: '700', color: colors.white },
  savedBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, backgroundColor: alphaHex(colors.success, '10'), borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: alphaHex(colors.success, '30') },
  savedBadgeText: { ...font.bodySm, color: colors.success },
  insightActionCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: space.md, borderWidth: 1, borderColor: colors.border, marginBottom: space.xxl, gap: space.sm },
  insightBlock: { gap: space.xs },
  insightSubhead: { ...font.bodySm, fontWeight: '700', color: colors.text },
  insightInsufficientText: { ...font.bodySm, color: colors.textDim, lineHeight: 19 },
  insightBodyText: { ...font.bodySm, color: colors.text, lineHeight: 19 },
  insightCorrelationText: { ...font.caption, color: colors.textFaint, lineHeight: 17 },
  insightDivider: { height: 1, backgroundColor: colors.border, marginVertical: space.xs },
  insightPrevOutcome: { ...font.caption, color: colors.textDim, lineHeight: 17 },
  currentAdjustWrap: { gap: space.sm, marginTop: space.xs },
  insightChosenText: { ...font.bodySm, color: colors.text, lineHeight: 18 },
  alignStart: { alignSelf: 'flex-start' },
  quickAdjustComposer: { gap: space.sm, marginTop: space.xs },
  quickAdjustInput: {
    minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.bgElevated, paddingHorizontal: space.md, paddingVertical: space.sm,
    ...font.bodySm, color: colors.text,
  },
  quickAdjustErrorText: { ...font.caption, color: colors.error },
  quickAdjustBtnRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
});
