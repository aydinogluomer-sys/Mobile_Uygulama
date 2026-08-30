import { colors } from '../../lib/tokens';
import { currentUser } from '../../lib/session';
import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, startOfWeek, endOfWeek, subWeeks, eachDayOfInterval } from 'date-fns';
import type { Habit } from '../../lib/supabase';
import { useTaskStore, type Task } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { useJournalStore } from '../../store/journalStore';
import {
  buildArchiveReflection, calculateHabitCompletionRate, focusMinutesFromSessions,
  reportBadge, isCompletedState, type ReportBadge,
} from '../../lib/reportMetrics';
import { ymdFromIso, ymd, parseLocalDate, type Ymd } from '../../lib/date';
import { dailyLoad, type TaskLoadItem } from '../../lib/capacity';
import { isDueOn } from '../../lib/habitSchedule';
import { recoverySuccessRate, type Result } from '../../lib/behaviorIntelligence';
import { planFromRow } from '../../lib/recovery';
import {
  logsForPeriod,
  recoveryForPeriod,
  loadWeeklyReflection as fetchWeeklyReview,
  saveWeeklyReflection as upsertWeeklyReview,
} from '../../services/reviewService';
import { sessionsSince as fetchFocusSessionsSince } from '../../services/focusService';

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
  /** `null` when the week has no tasks to rate against (insufficient data, not a fabricated 0/0). */
  taskCompletionRate: number | null;
  /** `lib/behaviorIntelligence.recoverySuccessRate` over this week's recovery plans -- a genuine `Result`, rendered via `.reason` on `{ok:false}`. */
  recoveryCompletion: Result<number>;
  /** Days in the week whose `dailyLoad` band was `aşırı` (lib/capacity.ts). */
  overloadDays: number;
};

const EMPTY_AUTO_METRICS: AutoMetrics = {
  totalCompletions: null,
  taskCompletionRate: null,
  recoveryCompletion: { ok: false, reason: 'Henüz yüklenmedi' },
  overloadDays: 0,
};

/**
 * How many days in `[start, end]` had a `dailyLoad` band of `aşırı` --
 * plan §12's "Capacity overload days". Walks each local day, asks which
 * ACTIVE habits were due that day (`isDueOn`, schedule-aware, same oracle
 * `habit-detail.tsx`/`behaviorIntelligence.ts` use), which tasks were due
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
}): number {
  const startDate = parseLocalDate(params.start);
  const endDate = parseLocalDate(params.end);
  if (!startDate || !endDate) return 0;

  const days = eachDayOfInterval({ start: startDate, end: endDate }).map((d) => ymd(d));
  let count = 0;
  for (const day of days) {
    const dateObj = parseLocalDate(day);
    if (!dateObj) continue;
    const habitsDue = params.activeHabits.filter((h) => isDueOn(h, dateObj));
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
  return (
    <View style={s.autoMetricTile}>
      <Text style={s.autoMetricValue} numberOfLines={1}>{value}</Text>
      <Text style={s.autoMetricLabel}>{label}</Text>
    </View>
  );
}

export default function WeeklyReviewScreen() {
  const { tasks, fetchTasks } = useTaskStore();
  const { habits, fetchHabits } = useHabitStore();
  const { appendEntry } = useJournalStore();

  const [weekOffset, setWeekOffset] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [habitCompletionRate, setHabitCompletionRate] = useState(0);
  const [focusMinutes, setFocusMinutes] = useState(0);
  const [badge, setBadge] = useState<ReportBadge | null>(null);
  const [autoMetrics, setAutoMetrics] = useState<AutoMetrics>(EMPTY_AUTO_METRICS);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const targetDate = subWeeks(new Date(), weekOffset);
  const weekKey = getWeekKey(targetDate);
  const { start, end } = getWeekRange(targetDate);
  const isCurrentWeek = weekOffset === 0;

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
  loaders.current = { loadReview, loadWeekMetrics };

  useEffect(() => {
    void loaders.current.loadReview();
    void loaders.current.loadWeekMetrics();
  }, [weekOffset, habits.length, tasks.length]);

  async function loadReview() {
    const user = await currentUser();
    if (!user) {
      setAnswers({});
      setSavedAt(null);
      return;
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
    const user = await currentUser();
    if (!user) {
      setHabitCompletionRate(0);
      setFocusMinutes(0);
      setBadge(reportBadge({ habitRate: 0, focusMinutes: 0, completedTasks: completedTasks.length }));
      setAutoMetrics(EMPTY_AUTO_METRICS);
      return;
    }

    const [logsRes, sessionsRes, recoveryRes] = await Promise.all([
      logsForPeriod({ start, end }),
      fetchFocusSessionsSince({ sinceIso: start }),
      recoveryForPeriod({ start, end }),
    ]);

    const rate = logsRes.ok ? calculateHabitCompletionRate(habits, logsRes.data, start, end) : 0;
    // `fetchFocusSessionsSince` has no upper bound -- clip to this week's `end`
    // client-side, same window `fetchFocusSecondsForReview` used to filter server-side.
    const weekSessions = sessionsRes.ok
      ? sessionsRes.data.filter((sess: { started_at: string }) => sess.started_at <= `${end}T23:59:59`)
      : [];
    const minutes = focusMinutesFromSessions(weekSessions);
    const nextBadge = reportBadge({ habitRate: rate, focusMinutes: minutes, completedTasks: completedTasks.length });

    setHabitCompletionRate(rate);
    setFocusMinutes(minutes);
    setBadge(nextBadge);

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
    });

    setAutoMetrics({
      totalCompletions: completedLogCount == null ? null : completedLogCount + completedTasks.length,
      taskCompletionRate,
      recoveryCompletion,
      overloadDays,
    });
  }

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
      Alert.alert('Hata', error instanceof Error ? error.message : 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.hero}>
          <View style={s.heroIcon}>
            <Ionicons name="bar-chart-outline" size={28} color="#14b8a6" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle} accessibilityRole="header">Haftalık Rapor</Text>
            <Text style={s.heroDates}>{start} - {end}</Text>
          </View>
          <View style={s.weekNav}>
            <TouchableOpacity
              onPress={() => setWeekOffset((offset) => offset + 1)}
              style={s.navBtn}
              accessibilityRole="button"
              accessibilityLabel="Önceki hafta"
            >
              <Ionicons name="chevron-back" size={18} color="#BFBBAE" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setWeekOffset((offset) => Math.max(0, offset - 1))}
              style={[s.navBtn, isCurrentWeek && s.navBtnDisabled]}
              disabled={isCurrentWeek}
              accessibilityRole="button"
              accessibilityLabel="Sonraki hafta"
              accessibilityState={{ disabled: isCurrentWeek }}
            >
              <Ionicons name="chevron-forward" size={18} color={isCurrentWeek ? colors.textGhost : colors.textDim} />
            </TouchableOpacity>
          </View>
        </View>

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

        {badge && (
          <View style={s.badgeCard}>
            <Text style={[s.badgeEmoji, { color: badge.color }]}>{badge.emoji}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.badgeTitle}>{badge.label}</Text>
              <Text style={s.badgeDesc}>{badge.level.toUpperCase()} · Haftalık rapor özeti</Text>
            </View>
          </View>
        )}

        {/* §12 -- Toplam tamamlama · Habit completion · Task completion · Focus duration · Recovery completion · Capacity overload days */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>OTOMATİK METRİKLER</Text>
          <View style={s.autoMetricGrid}>
            <AutoMetricTile
              label="Toplam Tamamlama"
              value={autoMetrics.totalCompletions != null ? String(autoMetrics.totalCompletions) : 'Veri yok'}
            />
            <AutoMetricTile label="Alışkanlık Tamamlama" value={`%${habitCompletionRate}`} />
            <AutoMetricTile
              label="Görev Tamamlama"
              value={autoMetrics.taskCompletionRate != null ? `%${autoMetrics.taskCompletionRate}` : 'Veri yok'}
            />
            <AutoMetricTile label="Odak Süresi" value={`${focusMinutes} dk`} />
            <AutoMetricTile
              label="Telafi Tamamlama"
              value={autoMetrics.recoveryCompletion.ok ? `%${Math.round(autoMetrics.recoveryCompletion.value * 100)}` : autoMetrics.recoveryCompletion.reason}
            />
            <AutoMetricTile label="Aşırı Yüklenme Günü" value={`${autoMetrics.overloadDays} gün`} />
          </View>
        </View>

        {completedTasks.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>BU HAFTA TAMAMLANANLAR</Text>
            {completedTasks.slice(0, 5).map((task) => (
              <View key={task.id} style={s.taskItem}>
                <Ionicons name="checkmark-circle" size={16} color="#87A678" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
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
                style={s.questionInput}
                placeholder={question.placeholder}
                placeholderTextColor="#56544B"
                multiline
                value={answers[question.key] ?? ''}
                onChangeText={(value) => setAnswers((current) => ({ ...current, [question.key]: value }))}
                editable={isCurrentWeek}
              />
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
              <ActivityIndicator color="#fff" size="small" />
            ) : savedAt ? (
              <>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={s.saveBtnText}>Kaydedildi ({savedAt})</Text>
              </>
            ) : (
              <Text style={s.saveBtnText}>Raporu Kaydet</Text>
            )}
          </TouchableOpacity>
        )}

        {!isCurrentWeek && savedAt && (
          <View style={s.savedBadge}>
            <Ionicons name="checkmark-circle" size={16} color="#87A678" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={s.savedBadgeText}>Bu hafta kaydedildi - {savedAt}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 20, paddingBottom: 40 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  heroIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#14b8a620', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 18, fontWeight: '700', color: colors.white },
  heroDates: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  weekNav: { flexDirection: 'row', gap: 4 },
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
  autoMetricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  autoMetricTile: { width: '31.5%', backgroundColor: colors.surface, borderRadius: 12, padding: 10, borderWidth: 1, borderColor: colors.border, alignItems: 'center', marginBottom: 8 },
  autoMetricValue: { fontSize: 15, fontWeight: '700', color: colors.white, marginBottom: 3 },
  autoMetricLabel: { fontSize: 9.5, color: colors.textFaint, textAlign: 'center', lineHeight: 12 },
  taskItem: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: colors.border, marginBottom: 6 },
  taskTitle: { flex: 1, fontSize: 14, color: colors.textDim },
  moreText: { fontSize: 12, color: colors.textGhost, paddingLeft: 4, marginTop: 4 },
  questionCard: { marginBottom: 14 },
  questionLabel: { fontSize: 14, color: colors.text, fontWeight: '600', marginBottom: 8 },
  questionInput: { backgroundColor: colors.surface, borderRadius: 12, padding: 14, fontSize: 14, color: colors.white, borderWidth: 1, borderColor: colors.border, minHeight: 80, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#14b8a6', borderRadius: 14, paddingVertical: 15, marginTop: 8 },
  saveBtnLoading: { opacity: 0.7 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: colors.white },
  savedBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#87A67810', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#87A67830' },
  savedBadgeText: { fontSize: 13, color: colors.success },
});
