import {
  loadMonthlyReflection,
  saveMonthlyDraft,
  saveMonthlyReflection,
  logsForPeriod,
  recoveryForPeriod,
  type ReviewLogRow,
} from '../../services/reviewService';
import { currentUser } from '../../lib/session';
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { format, startOfMonth, endOfMonth, subMonths, subWeeks, eachDayOfInterval } from 'date-fns';
import type { Habit } from '../../lib/supabase';
import { useTaskStore, type Task } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { useJournalStore } from '../../store/journalStore';
import { useGoalStore } from '../../store/goalStore';
import { useRoutineRunnerStore } from '../../store/routineRunnerStore';
import { routineReport } from '../../lib/routineReport';
import { measuredRows, type MeasuredRow } from '../../lib/periodReport';
import MeasuredReportSection from '../../components/MeasuredReportSection';
import MonthBackground from '../../components/MonthBackground';
import { useReducedMotion } from '../../components/seasonalMotion/useReducedMotion';
import { MONTH_TAGLINES_TR } from '../../components/seasonalMotion/config';
import { colors, hexA, alphaHex } from '../../lib/tokens';
import { buildArchiveReflection, calculateHabitCompletionRate, focusMinutesFromSessions, reportBadge, summarizeHabitProgress, type ReportBadge } from '../../lib/reportMetrics';
import { ymdFromIso, ymd, parseLocalDate } from '../../lib/date';
import { dailyLoad, type TaskLoadItem } from '../../lib/capacity';
import { carriesDayLoad } from '../../lib/habitSchedule';
import {
  completionTrend, strongestHabit, mostFragileHabit, recoverySuccessRate,
  type Trend, type Result,
} from '../../lib/behaviorIntelligence';
import { planFromRow } from '../../lib/recovery';
import { sessionsSince as fetchFocusSessionsSince } from '../../services/focusService';
import { EmptyState } from '../../components/ui';

const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

const REVIEW_QUESTIONS = [
  { key: 'wins', label: '🏆 Bu ayın kazanımları nelerdi?', placeholder: 'Bu ay başardıklarını yaz...' },
  { key: 'lessons', label: '🧭 Bu ay ne öğrendin / ne işe yaradı?', placeholder: 'Öğrendiklerini yaz...' },
  { key: 'next_month', label: '🎯 Gelecek ay neyi değiştireceksin?', placeholder: 'Bir sonraki ay için önceliklerin...' },
];

// ---------------------------------------------------------------------------
// §12 -- monthly analysis block. "Ay özeti"/"Focus"/"Reflection" already
// existed (metricsRow+badge, focusMinutes, AYLIK YANSIMA below) -- this adds
// the five genuinely missing blocks: Trend, En iyi habit, En sorunlu habit,
// Capacity trend, Recovery trend, Completed goals.
// ---------------------------------------------------------------------------

type MonthlyAnalysis = {
  trend4: Result<Trend>;
  trend12: Result<Trend>;
  strongest: Result<{ habitId: string; strength: number }>;
  fragile: Result<{ habitId: string; volatility: number }>;
  capacityOverloadThisMonth: number;
  capacityOverloadPrevMonth: number;
  recoveryThisMonth: Result<number>;
  recoveryPrevMonth: Result<number>;
  completedGoals: number;
  totalMonthlyGoals: number;
};

const NOT_LOADED: Result<never> = { ok: false, reason: 'Henüz yüklenmedi' };

const EMPTY_ANALYSIS: MonthlyAnalysis = {
  trend4: NOT_LOADED,
  trend12: NOT_LOADED,
  strongest: NOT_LOADED,
  fragile: NOT_LOADED,
  capacityOverloadThisMonth: 0,
  capacityOverloadPrevMonth: 0,
  recoveryThisMonth: NOT_LOADED,
  recoveryPrevMonth: NOT_LOADED,
  completedGoals: 0,
  totalMonthlyGoals: 0,
};

function trendLabel(direction: 'improving' | 'declining' | 'flat'): string {
  if (direction === 'improving') return 'Yükseliyor';
  if (direction === 'declining') return 'Düşüyor';
  return 'Sabit';
}

function formatTrend(t: Result<Trend>): string {
  if (!t.ok) return t.reason;
  const pts = Math.round(t.value.magnitude * 100);
  return `${trendLabel(t.value.direction)} · ${pts >= 0 ? '+' : ''}${pts} puan${t.value.partialWindow ? ` (${t.value.weeksUsed}/${t.value.weeksRequested} hafta)` : ''}`;
}

/**
 * How many days in `[start, end]` had a `dailyLoad` band of `aşırı` --
 * plan §12's "Capacity trend" input. Identical composition to the same
 * helper in `weekly-review.tsx` (screen-local, `lib/**` is off-limits to
 * this task -- see that file's own doc for the full reasoning).
 */
function countOverloadDays(params: {
  start: string;
  end: string;
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

export default function MonthlyReviewScreen() {
  const now = new Date();
  const isFocused = useIsFocused();
  const { tasks, fetchTasks } = useTaskStore();
  const { habits, fetchHabits } = useHabitStore();
  const { appendEntry } = useJournalStore();
  const { goals, loadGoals } = useGoalStore();

  const [monthOffset, setMonthOffset] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [habitCompletionRate, setHabitCompletionRate] = useState(0);
  const [focusMinutes, setFocusMinutes] = useState(0);
  const [habitStats, setHabitStats] = useState<{ id: string; name: string; color: string; percent: number; completedDays: number; possibleDays: number }[]>([]);
  const [badge, setBadge] = useState<ReportBadge | null>(null);
  const [analysis, setAnalysis] = useState<MonthlyAnalysis>(EMPTY_ANALYSIS);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Ekranda gorunen metin buluta HENUZ yazilmadi: kaydedilmemis taslak ya
  // da tasima oncesi kalmis yerel kayit.
  const [unsavedDraft, setUnsavedDraft] = useState(false);

  // Defter sayfası animasyonu: girişte "açılma", ay değişiminde yön bazlı "sayfa çevirme" (bkz. calendar.tsx).
  const reduceMotion = useReducedMotion();
  const pageAnim = useRef(new Animated.Value(1)).current;
  const [flipDir, setFlipDir] = useState(0); // -1 önceki, 0 açılış, +1 sonraki

  function animatePage(dir: number) {
    setFlipDir(dir);
    if (reduceMotion) { pageAnim.setValue(1); return; } // erişilebilirlik: animasyon yok
    pageAnim.setValue(0);
    Animated.timing(pageAnim, {
      toValue: 1,
      duration: dir === 0 ? 480 : 430,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  const targetDate = subMonths(now, monthOffset);
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const monthKey = format(targetDate, 'yyyy-MM');
  const start = format(startOfMonth(targetDate), 'yyyy-MM-dd');
  const end = format(endOfMonth(targetDate), 'yyyy-MM-dd');
  const isCurrentMonth = monthOffset === 0;
  const routineHistory = useRoutineRunnerStore((st) => st.history);
  const routines = routineReport(routineHistory, start, end);
  // R07.04 — amount/duration per measured habit, from the R01 engine.
  const [measured, setMeasured] = useState<MeasuredRow[]>([]);

  const monthTasks = tasks.filter((task) => {
    const day = ymdFromIso(task.completed_at ?? task.created_at);
    return day >= start && day <= end;
  });
  const completedTasks = monthTasks.filter((task) => task.completed);
  const activeHabits = habits.filter((habit) => habit.status === 'active');

  useEffect(() => {
    fetchTasks();
    fetchHabits();
    loadGoals();
  }, [fetchTasks, fetchHabits, loadGoals]);

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
  const loaders = useRef({ loadReflection, loadMonthMetrics });
  loaders.current = { loadReflection, loadMonthMetrics };

  useEffect(() => {
    void loaders.current.loadReflection();
    void loaders.current.loadMonthMetrics();
  }, [monthOffset, habits.length, tasks.length, goals.length]);

  // Ekran odağa gelince defter "açılır" (bkz. calendar.tsx)
  useEffect(() => { if (isFocused) animatePage(0); }, [isFocused]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bulut kaynak, AsyncStorage yalnizca taslak. Sira ve gerekcesi
  // services/reviewService.loadMonthlyReflection icinde.
  async function loadReflection() {
    const r = await loadMonthlyReflection(monthKey);
    setAnswers(r.answers);
    setSavedAt(r.savedAt ? format(new Date(r.savedAt), 'dd.MM.yyyy') : null);
    setUnsavedDraft(r.source === 'draft' || r.source === 'legacy');
  }

  async function loadMonthMetrics() {
    const user = await currentUser();
    if (!user) {
      setHabitCompletionRate(0);
      setFocusMinutes(0);
      setHabitStats([]);
      setBadge(reportBadge({ habitRate: 0, focusMinutes: 0, completedTasks: completedTasks.length }));
      setAnalysis(EMPTY_ANALYSIS);
      return;
    }

    // `asOf` anchors every behaviorIntelligence window: "now" for the current
    // month (so a partial in-progress month still reads its trend honestly),
    // the month's own last day for a past month being reviewed.
    const asOf = isCurrentMonth ? now : endOfMonth(targetDate);
    const wideStart = format(subWeeks(asOf, 13), 'yyyy-MM-dd'); // 13 weeks >= the 12-week trend + 8-week fragility windows below
    const prevMonthDate = subMonths(targetDate, 1);
    const prevStart = format(startOfMonth(prevMonthDate), 'yyyy-MM-dd');
    const prevEnd = format(endOfMonth(prevMonthDate), 'yyyy-MM-dd');

    const [logsRes, sessionsRes, recoveryRes] = await Promise.all([
      logsForPeriod({ start: wideStart, end }),
      fetchFocusSessionsSince({ sinceIso: prevStart }),
      recoveryForPeriod({ start: prevStart, end }),
    ]);

    const logsForBI = logsRes.ok ? logsRes.data : [];
    setMeasured(logsRes.ok ? measuredRows(habits, logsRes.data, { start, end, asOf: new Date() }) : []);
    const rate = logsRes.ok ? calculateHabitCompletionRate(habits, logsRes.data, start, end) : 0;

    // `fetchFocusSessionsSince` has no upper bound -- clip to `end` client-side.
    const allSessions = sessionsRes.ok ? sessionsRes.data.filter((sess: { started_at: string }) => sess.started_at <= `${end}T23:59:59`) : [];
    const monthSessions = allSessions.filter((sess) => sess.started_at >= start);
    const prevMonthSessions = allSessions.filter((sess) => sess.started_at >= prevStart);
    const minutes = focusMinutesFromSessions(monthSessions);
    const nextBadge = reportBadge({ habitRate: rate, focusMinutes: minutes, completedTasks: completedTasks.length });

    setHabitCompletionRate(rate);
    setFocusMinutes(minutes);
    setBadge(nextBadge);

    const stats = summarizeHabitProgress(habits, logsForBI, start, end).map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      percent: row.percent,
      completedDays: row.completedDays,
      possibleDays: row.possibleDays,
    }));
    setHabitStats(stats);

    const trend4 = completionTrend(activeHabits, logsForBI, { weeks: 4, asOf });
    const trend12 = completionTrend(activeHabits, logsForBI, { weeks: 12, asOf });
    const strongest = strongestHabit(activeHabits, logsForBI, { asOf });
    const fragile = mostFragileHabit(activeHabits, logsForBI, { asOf });

    const capacityOverloadThisMonth = countOverloadDays({ start, end, activeHabits, allTasks: tasks, focusSessions: monthSessions, habitLogs: logsForBI });
    const capacityOverloadPrevMonth = countOverloadDays({ start: prevStart, end: prevEnd, activeHabits, allTasks: tasks, focusSessions: prevMonthSessions, habitLogs: logsForBI });

    const recoveryPlans = recoveryRes.ok ? recoveryRes.data : [];
    const thisMonthPlans = recoveryPlans.filter((p) => p.target_date >= start && p.target_date <= end);
    const prevMonthPlans = recoveryPlans.filter((p) => p.target_date >= prevStart && p.target_date <= prevEnd);
    const recoveryThisMonth = recoverySuccessRate(thisMonthPlans.map(planFromRow));
    const recoveryPrevMonth = recoverySuccessRate(prevMonthPlans.map(planFromRow));

    // Goal.month is 1-indexed (see app/screens/goals.tsx's CUR_MONTH = NOW.getMonth() + 1);
    // `month` here is JS's 0-indexed Date#getMonth(), so +1 to compare.
    // Only `kind === 'monthly'` goals are scoped to a specific month -- yearly/
    // quarterly goals have no month of their own to attribute to this review,
    // so they are excluded rather than guessed at.
    const targetMonthNumber = month + 1;
    const monthlyGoals = goals.filter((g) => g.kind === 'monthly' && g.year === year && g.month === targetMonthNumber);
    const completedGoals = monthlyGoals.filter((g) => g.progress >= 100).length;

    setAnalysis({
      trend4, trend12, strongest, fragile,
      capacityOverloadThisMonth, capacityOverloadPrevMonth,
      recoveryThisMonth, recoveryPrevMonth,
      completedGoals, totalMonthlyGoals: monthlyGoals.length,
    });
  }

  async function handleSave() {
    setSaving(true);
    try {
      // Once cloud write, sonra arsiv kopyasi. Sira onemli: arsiv kaydi
      // render edilmis bir OZET, cevaplarin kendisi degil -- once o yazilip
      // asil kayit basarisiz olursa geri getirilemeyen sey kaybolurdu.
      const saved = await saveMonthlyReflection(monthKey, answers);
      if (!saved.ok) throw new Error(saved.error);
      const stamp = format(new Date(saved.savedAt), 'dd.MM.yyyy');
      setUnsavedDraft(false);
      await appendEntry(
        format(new Date(), 'yyyy-MM-dd'),
        buildArchiveReflection({
          sourceLabel: 'Aylık Rapor',
          periodLabel: `${MONTHS_TR[month]} ${year}`,
          start,
          end,
          answers,
          metrics: {
            taskCount: completedTasks.length,
            habitRate: habitCompletionRate,
            focusMinutes,
            badge: badge ?? reportBadge({ habitRate: habitCompletionRate, focusMinutes, completedTasks: completedTasks.length }),
          },
        }),
      );
      setSavedAt(stamp);
    } catch (error) {
      Alert.alert('Hata', error instanceof Error ? error.message : 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  }

  // Sayfa-çevirme stili (native driver: rotateY + translateX + opacity; sol cilt menteşesi) — bkz. calendar.tsx
  const pageStyle = {
    opacity: pageAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
    transformOrigin: 'left center' as const,
    transform: [
      { perspective: 900 },
      { rotateY: pageAnim.interpolate({ inputRange: [0, 1], outputRange: [`${(flipDir === 0 ? 10 : flipDir * 16)}deg`, '0deg'] }) },
      { translateX: pageAnim.interpolate({ inputRange: [0, 1], outputRange: [flipDir * 26, 0] }) },
    ],
  };

  function habitNameById(id: string): string {
    return habits.find((h) => h.id === id)?.name ?? '—';
  }

  return (
    <View style={s.root}>
      {/* Görünen aya göre değişen, tam-ekran mevsimsel arka plan (bkz. calendar.tsx) */}
      <MonthBackground month={month} active={isFocused} />

      <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
        <Animated.View style={pageStyle}>
          {/* Ajanda kapak başlığı — ay adı + mevsim mottosu (tek kaynak: seasonalMotion/config) */}
          <View style={s.heroCover}>
            <Text style={s.heroMonth}>{MONTHS_TR[month]}</Text>
            <Text style={s.heroYear}>{year}</Text>
            <Text style={s.heroTagline}>{MONTH_TAGLINES_TR[month]}</Text>
          </View>

          <View style={s.hero}>
            <View style={s.heroIcon}>
              <Ionicons name="calendar-number-outline" size={28} color={colors.accent} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroTitle} accessibilityRole="header">Aylık Rapor</Text>
              <Text style={s.heroDates}>{MONTHS_TR[month]} {year}</Text>
            </View>
            <View style={s.monthNav}>
              <TouchableOpacity
                onPress={() => { setMonthOffset((offset) => offset + 1); animatePage(-1); }}
                style={s.navBtn}
                accessibilityRole="button"
                accessibilityLabel="Önceki ay"
              >
                <Ionicons name="chevron-back" size={18} color={colors.textDim} />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => { setMonthOffset((offset) => Math.max(0, offset - 1)); animatePage(1); }}
                style={[s.navBtn, isCurrentMonth && s.navBtnDisabled]}
                disabled={isCurrentMonth}
                accessibilityRole="button"
                accessibilityLabel="Sonraki ay"
                accessibilityState={{ disabled: isCurrentMonth }}
              >
                <Ionicons name="chevron-forward" size={18} color={isCurrentMonth ? colors.textGhost : colors.textDim} />
              </TouchableOpacity>
            </View>
          </View>

          {/* §12 -- "Ay özeti" */}
          <Text style={s.sectionTitle}>AY ÖZETİ</Text>
          <View style={s.metricsRow}>
            <View style={s.metric}>
              <Text style={s.metricValue}>{completedTasks.length}</Text>
              <Text style={s.metricLabel}>Görev{'\n'}Tamamlandı</Text>
            </View>
            <View style={s.metric}>
              <Text style={[s.metricValue, { color: colors.success }]}>{habitCompletionRate}%</Text>
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
          <MeasuredReportSection rows={measured} />
          {/* R05.07 — routine sessions, from the summary each session stored when it finished. */}
          <Text style={s.metricLabel} accessibilityLabel={`Bu ay rutinler: ${routines.label}`}>Rutinler: {routines.label}</Text>

          {badge && (
            <View style={s.badgeCard}>
              <Text style={[s.badgeEmoji, { color: badge.color }]}>{badge.emoji}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.badgeTitle}>{badge.label}</Text>
                <Text style={s.badgeDesc}>{badge.level.toLocaleUpperCase('tr-TR')} · Aylık rapor özeti</Text>
              </View>
            </View>
          )}

          {/* Bölüm boşken tamamen kaybolmak yerine neden boş olduğunu söylüyor */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>BU AY TAMAMLANANLAR</Text>
            {completedTasks.length === 0 ? (
              <EmptyState icon="checkmark-done-outline" title="Bu ay tamamlanan görev yok" compact color={colors.success} />
            ) : (
              <>
                {completedTasks.slice(0, 6).map((task) => (
                  <View key={task.id} style={s.taskItem}>
                    <Ionicons name="checkmark-circle" size={16} color={colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                    <Text style={s.taskTitle} numberOfLines={1}>{task.title}</Text>
                  </View>
                ))}
                {completedTasks.length > 6 && <Text style={s.moreText}>+{completedTasks.length - 6} daha...</Text>}
              </>
            )}
          </View>

          <View style={s.section}>
            <Text style={s.sectionTitle}>ALIŞKANLIK PERFORMANSI</Text>
            {habitStats.length === 0 ? (
              <EmptyState
                icon="bar-chart-outline"
                title="Bu ay ölçülecek alışkanlık yok"
                hint="Aktif bir alışkanlık ekledikten sonra aylık performansı burada görünür."
                compact
              />
            ) : (
              habitStats.slice(0, 6).map((habit, index) => {
                const medals = ['🥇', '🥈', '🥉'];
                return (
                  <View key={habit.id} style={s.habitRow}>
                    <Text style={s.medal}>{medals[index] ?? ''}</Text>
                    <View style={[s.habitDot, { backgroundColor: habit.color }]} />
                    <Text style={s.habitName} numberOfLines={1}>{habit.name}</Text>
                    <View style={s.habitBarWrap}>
                      <View style={s.habitBarBg}>
                        <View style={[s.habitBarFill, { width: `${habit.percent}%`, backgroundColor: habit.color }]} />
                      </View>
                    </View>
                    <Text style={s.habitCount}>{habit.completedDays}/{habit.possibleDays}</Text>
                  </View>
                );
              })
            )}
          </View>

          {/* §12 -- "Trend" (4/12 haftalık, lib/behaviorIntelligence.completionTrend) */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>TREND</Text>
            <View style={s.analysisRow}>
              <Text style={s.analysisLabel}>4 Haftalık</Text>
              <Text style={s.analysisValue}>{formatTrend(analysis.trend4)}</Text>
            </View>
            <View style={s.analysisRow}>
              <Text style={s.analysisLabel}>12 Haftalık</Text>
              <Text style={s.analysisValue}>{formatTrend(analysis.trend12)}</Text>
            </View>
          </View>

          {/* §12 -- "En iyi habit" / "En sorunlu habit" (strongestHabit / mostFragileHabit) */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>ALIŞKANLIK ANALİZİ</Text>
            <View style={s.analysisRow}>
              <Text style={s.analysisLabel}>En İyi Habit</Text>
              <Text style={s.analysisValue}>{analysis.strongest.ok ? habitNameById(analysis.strongest.value.habitId) : analysis.strongest.reason}</Text>
            </View>
            <View style={s.analysisRow}>
              <Text style={s.analysisLabel}>En Sorunlu Habit</Text>
              <Text style={s.analysisValue}>{analysis.fragile.ok ? habitNameById(analysis.fragile.value.habitId) : analysis.fragile.reason}</Text>
            </View>
          </View>

          {/* §12 -- "Capacity trend" (lib/capacity.dailyLoad -- aşırı-band günü sayımı) */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>KAPASİTE TRENDİ</Text>
            <View style={s.analysisRow}>
              <Text style={s.analysisLabel}>Aşırı Yüklenme Günü</Text>
              <Text style={s.analysisValue}>Bu ay {analysis.capacityOverloadThisMonth} · Geçen ay {analysis.capacityOverloadPrevMonth}</Text>
            </View>
          </View>

          {/* §12 -- "Recovery trend" (lib/behaviorIntelligence.recoverySuccessRate) */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>TELAFİ TRENDİ</Text>
            <View style={s.analysisRow}>
              <Text style={s.analysisLabel}>Bu Ay</Text>
              <Text style={s.analysisValue}>{analysis.recoveryThisMonth.ok ? `%${Math.round(analysis.recoveryThisMonth.value * 100)}` : analysis.recoveryThisMonth.reason}</Text>
            </View>
            <View style={s.analysisRow}>
              <Text style={s.analysisLabel}>Geçen Ay</Text>
              <Text style={s.analysisValue}>{analysis.recoveryPrevMonth.ok ? `%${Math.round(analysis.recoveryPrevMonth.value * 100)}` : analysis.recoveryPrevMonth.reason}</Text>
            </View>
          </View>

          {/* §12 -- "Completed goals" (store/goalStore.ts, kind:'monthly' bu ay/yıl) */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>TAMAMLANAN HEDEFLER</Text>
            <View style={s.analysisRow}>
              <Text style={s.analysisLabel}>Bu Ayın Hedefleri</Text>
              <Text style={s.analysisValue}>{analysis.completedGoals} / {analysis.totalMonthlyGoals} tamamlandı</Text>
            </View>
          </View>

          <View style={s.section}>
            <Text style={s.sectionTitle}>AYLIK YANSIMA</Text>
            {REVIEW_QUESTIONS.map((question) => (
              <View key={question.key} style={s.questionCard}>
                <Text style={s.questionLabel}>{question.label}</Text>
                <TextInput
                  style={s.questionInput}
                  placeholder={question.placeholder}
                  placeholderTextColor={colors.textFaint}
                  multiline
                  value={answers[question.key] ?? ''}
                  onChangeText={(value) => {
                    setAnswers((current) => {
                      const next = { ...current, [question.key]: value };
                      // Taslak yerelde, hesap kapsamli. Yazarken sinyal
                      // giderse paragraf kaybolmasin diye; buluta yazmaz.
                      void saveMonthlyDraft(monthKey, next);
                      return next;
                    });
                    setUnsavedDraft(true);
                  }}
                  textAlignVertical="top"
                />
              </View>
            ))}
          </View>

          {/* Kaydederken içerik yalnızca spinner'a düşüyor — etiketi durumdan üretiyoruz */}
          <TouchableOpacity
            style={[s.saveBtn, saving && s.saveBtnLoading]}
            onPress={handleSave}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel={
              saving ? 'Aylık rapor kaydediliyor'
              : unsavedDraft ? 'Kaydedilmemiş değişiklikler var, aylık raporu kaydet'
              : savedAt ? `Kaydedildi, ${savedAt}`
              : 'Aylık raporu kaydet'
            }
            accessibilityState={{ disabled: saving, busy: saving }}
          >
            {saving ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : savedAt && !unsavedDraft ? (
              <>
                <Ionicons name="checkmark" size={18} color={colors.white} />
                <Text style={s.saveBtnText}>Kaydedildi ({savedAt})</Text>
              </>
            ) : (
              <Text style={s.saveBtnText}>Aylık Raporu Kaydet</Text>
            )}
          </TouchableOpacity>
        </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 20, paddingBottom: 40 },

  // Ajanda kapak başlığı — ay adı + mevsim mottosu (cam yok → mevsim sahnesi/hareket görünür, bkz. calendar.tsx)
  heroCover: { minHeight: 132, alignItems: 'center', justifyContent: 'center', paddingVertical: 20, marginBottom: 18 },
  heroMonth: {
    fontSize: 34, fontWeight: '800', color: colors.white, letterSpacing: 0.5, textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 2 },
  },
  heroYear: {
    fontSize: 14, fontWeight: '600', color: hexA(colors.white, 0.82), marginTop: 4, letterSpacing: 3,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6,
  },
  heroTagline: {
    fontSize: 12, color: hexA(colors.white, 0.85), marginTop: 8, fontStyle: 'italic', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6,
  },

  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  heroIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: alphaHex(colors.accent, '20'), alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  heroDates: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  monthNav: { flexDirection: 'row', gap: 4 },
  navBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.3 },
  metricsRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  metric: { flex: 1, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  metricValue: { fontSize: 20, fontWeight: '700', color: colors.white, marginBottom: 4 },
  metricLabel: { fontSize: 10, color: colors.textFaint, textAlign: 'center', lineHeight: 14 },
  badgeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 24 },
  badgeEmoji: { fontSize: 20 },
  badgeTitle: { fontSize: 14, fontWeight: '700', color: colors.white },
  badgeDesc: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textFaint, letterSpacing: 1, marginBottom: 10 },
  taskItem: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 6 },
  taskTitle: { flex: 1, fontSize: 14, color: colors.textDim },
  moreText: { fontSize: 12, color: colors.textGhost, paddingLeft: 4, marginTop: 4 },
  habitRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  medal: { fontSize: 16, width: 22 },
  habitDot: { width: 8, height: 8, borderRadius: 4 },
  habitName: { width: 84, fontSize: 13, color: colors.text },
  habitBarWrap: { flex: 1 },
  habitBarBg: { height: 5, backgroundColor: colors.borderSubtle, borderRadius: 3 },
  habitBarFill: { height: 5, borderRadius: 3 },
  habitCount: { fontSize: 11, color: colors.textFaint, minWidth: 40, textAlign: 'right' },
  analysisRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 10, paddingHorizontal: 12, marginBottom: 6,
  },
  analysisLabel: { fontSize: 12, color: colors.textFaint, fontWeight: '600' },
  analysisValue: { fontSize: 12, color: colors.text, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  questionCard: { marginBottom: 14 },
  questionLabel: { fontSize: 14, color: colors.text, fontWeight: '600', marginBottom: 8 },
  questionInput: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 14, color: colors.white, borderWidth: 1, borderColor: colors.border, minHeight: 80, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 15, marginTop: 4 },
  saveBtnLoading: { opacity: 0.7 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: colors.white },
});
