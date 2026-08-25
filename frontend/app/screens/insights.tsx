/**
 * Insights screen.  (Phase 2, CODER-I, plan §11)
 *
 * Main block (hero): İÇGÖRÜLER / BU HAFTA / this week's completion % / the
 * week-over-week delta / "En güçlü: <habit>" / "Dikkat: <weekday> tamamlama
 * oranı %<rate>". Six sections below: Hafta · Ay · Alışkanlıklar · Kapasite ·
 * Telafi · Odak.
 *
 * ## The one rule every Result-consuming line here obeys
 *
 * `lib/behaviorIntelligence.ts` returns `{ ok: true, value }` for a real
 * answer and `{ ok: false, reason }` when the sample is too thin to trust.
 * This screen NEVER substitutes a fabricated number for an `{ ok: false }`
 * result -- every such branch renders `result.reason` instead, the same
 * discipline `app/screens/habit-detail.tsx` established (see its own doc and
 * `__tests__/repo/habitDetailScreen.test.ts`). `morningEveningDifference` is
 * never called here -- it is permanently unsupported by the schema (see that
 * function's own doc in lib/behaviorIntelligence.ts) and plan §11
 * deliberately excludes it from this screen.
 *
 * ## Where the data comes from
 *
 * `habits`/`tasks` are read from their existing stores (already fetched
 * elsewhere in the app -- Rule 4 governs DB access, not in-memory store
 * reads). Habit logs / recovery plans / focus sessions are fetched ONCE, for
 * a rolling 14-week window ending today (wide enough for the 12-week trend
 * and 8-week fragility windows `behaviorIntelligence` uses), via existing
 * repository functions -- no new repository code needed for this screen.
 */
import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, subWeeks, eachDayOfInterval } from 'date-fns';

import { useHabitStore } from '../../store/habitStore';
import { useTaskStore, type Task } from '../../store/taskStore';
import type { Habit, RecoveryPlan } from '../../lib/supabase';
import type { FocusSessionRow } from '../../lib/focusReport';
import { colors, space, font } from '../../lib/tokens';
import { Card, SectionHeader, EmptyState, IconCircle } from '../../components/ui';
import { ymd, ymdFromIso, parseLocalDate } from '../../lib/date';
import { isDueOn } from '../../lib/habitSchedule';
import { dailyLoad, LOAD_BANDS, type TaskLoadItem } from '../../lib/capacity';
import {
  calculateHabitCompletionRate, focusMinutesFromSessions, getWeekBounds, getMonthBounds,
} from '../../lib/reportMetrics';
import {
  weekdayBreakdown, bestWeekday, worstWeekday, strongestHabit, mostFragileHabit,
  completionTrend, mostRecoveredHabit, recoverySuccessRate, type Result, type Trend,
} from '../../lib/behaviorIntelligence';
import { fromLegacyRecoveryPlan } from '../../lib/recovery';
import { fetchHabitLogsForReview, type ReviewLogRow } from '../../repositories/habitLogRepository';
import { fetchFocusSessionsSince } from '../../repositories/focusSessionRepository';
import { fetchRecoveryPlansForReview } from '../../repositories/recoveryRepository';
import { DOW_TR } from '../../lib/focusReport';

const HISTORY_WEEKS = 14; // >= the 12-week trend + 8-week fragility windows behaviorIntelligence.ts uses, with a buffer

function trendLabel(direction: 'improving' | 'declining' | 'flat'): string {
  if (direction === 'improving') return 'Yükseliyor';
  if (direction === 'declining') return 'Düşüyor';
  return 'Sabit';
}
function trendIcon(direction: 'improving' | 'declining' | 'flat'): keyof typeof Ionicons.glyphMap {
  if (direction === 'improving') return 'trending-up-outline';
  if (direction === 'declining') return 'trending-down-outline';
  return 'remove-outline';
}
function formatTrend(t: Result<Trend>): string {
  if (!t.ok) return t.reason;
  const pts = Math.round(t.value.magnitude * 100);
  return `${trendLabel(t.value.direction)} · ${pts >= 0 ? '+' : ''}${pts} puan${t.value.partialWindow ? ` (${t.value.weeksUsed}/${t.value.weeksRequested} hafta)` : ''}`;
}

const BAND_COLOR: Record<string, string> = {
  dusuk: colors.success,
  dengeli: colors.info,
  yuksek: colors.warning,
  asiri: colors.error,
};

/**
 * How many days in `[start, end]` had a `dailyLoad` band of `aşırı` -- same
 * composition `weekly-review.tsx`/`monthly-review.tsx` use (screen-local,
 * `lib/**` is off-limits to this task -- see either file's own doc for the
 * full reasoning).
 */
function countOverloadDays(params: {
  start: string;
  end: string;
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

/**
 * Renders one İÇGÖRÜ-style metric. On `{ ok: false }` it renders
 * `result.reason` -- never a substituted number -- mirroring
 * `habit-detail.tsx`'s own `InsightRow`.
 */
function InsightRow<T>({ icon, label, result, formatOk }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  result: Result<T>;
  formatOk: (value: T) => string;
}) {
  return (
    <Card padding="md" style={s.insightCard}>
      <View style={s.insightHead}>
        <IconCircle icon={icon} color={colors.primary} size={34} radiusKey="sm" />
        <Text style={s.insightLabel}>{label}</Text>
      </View>
      {result.ok ? (
        <Text style={s.insightValue}>{formatOk(result.value)}</Text>
      ) : (
        <Text style={s.insightReason}>{result.reason}</Text>
      )}
    </Card>
  );
}

/** A plain (non-Result) metric row -- always a real, non-fabricated value. */
function MetricRow({ icon, label, value }: { icon: keyof typeof Ionicons.glyphMap; label: string; value: string }) {
  return (
    <Card padding="md" style={s.insightCard}>
      <View style={s.insightHead}>
        <IconCircle icon={icon} color={colors.primary} size={34} radiusKey="sm" />
        <Text style={s.insightLabel}>{label}</Text>
      </View>
      <Text style={s.insightValue}>{value}</Text>
    </Card>
  );
}

export default function InsightsScreen() {
  const { habits, fetchHabits } = useHabitStore();
  const { tasks, fetchTasks } = useTaskStore();

  const [logs, setLogs] = useState<ReviewLogRow[]>([]);
  const [recoveryPlans, setRecoveryPlans] = useState<RecoveryPlan[]>([]);
  const [focusSessions, setFocusSessions] = useState<FocusSessionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const today = new Date();
  const todayYmd = ymd(today);
  const since = format(subWeeks(today, HISTORY_WEEKS), 'yyyy-MM-dd');

  useEffect(() => {
    fetchHabits();
    fetchTasks();
  }, [fetchHabits, fetchTasks]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      fetchHabitLogsForReview({ start: since, end: todayYmd }),
      fetchRecoveryPlansForReview({ start: since, end: todayYmd }),
      fetchFocusSessionsSince({ sinceIso: since }),
    ]).then(([logsRes, recoveryRes, sessionsRes]) => {
      if (cancelled) return;
      setLogs(logsRes.ok ? logsRes.data : []);
      setRecoveryPlans(recoveryRes.ok ? recoveryRes.data : []);
      setFocusSessions(sessionsRes.ok ? sessionsRes.data.filter((sess) => sess.started_at <= `${todayYmd}T23:59:59`) : []);
      setLoading(false);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [since, todayYmd]);

  const activeHabits = habits.filter((h) => h.status === 'active');
  const weekRange = getWeekBounds(today);
  const monthRange = getMonthBounds(today);

  const habitName = (id: string) => habits.find((h) => h.id === id)?.name ?? '—';

  // ---- hero -----------------------------------------------------------
  const weekRate = calculateHabitCompletionRate(activeHabits, logs, weekRange.start, weekRange.end);
  const weekOverWeek = completionTrend(activeHabits, logs, { weeks: 2, asOf: today });
  const strongest = strongestHabit(activeHabits, logs, { asOf: today });
  const weekdayStats = weekdayBreakdown(activeHabits, logs, { start: weekRange.start, end: weekRange.end });
  const worstDay = worstWeekday(weekdayStats);
  const bestDay = bestWeekday(weekdayStats);

  // ---- Ay -----------------------------------------------------------
  const monthRate = calculateHabitCompletionRate(activeHabits, logs, monthRange.start, monthRange.end);
  const trend12 = completionTrend(activeHabits, logs, { weeks: 12, asOf: today });
  const trend4 = completionTrend(activeHabits, logs, { weeks: 4, asOf: today });

  // ---- Alışkanlıklar --------------------------------------------------
  const fragile = mostFragileHabit(activeHabits, logs, { asOf: today });

  // ---- Kapasite ---------------------------------------------------------
  const habitsDueToday = activeHabits.filter((h) => isDueOn(h, today));
  const tasksDueToday: TaskLoadItem[] = tasks
    .filter((t) => t.due_date === todayYmd && t.status !== 'cancelled')
    .map(() => ({}));
  const overdueCountToday = tasks.filter(
    (t) => !!t.due_date && t.due_date < todayYmd && !t.completed && t.status !== 'cancelled',
  ).length;
  const focusMinutesToday = focusMinutesFromSessions(focusSessions.filter((s) => ymdFromIso(s.started_at) === todayYmd));
  const todayLoad = dailyLoad({ habits: habitsDueToday, tasks: tasksDueToday, focusMinutes: focusMinutesToday, overdueCount: overdueCountToday });
  const todayBandLabel = LOAD_BANDS.find((b) => b.key === todayLoad.band)?.label ?? todayLoad.band;
  const overloadDaysThisWeek = countOverloadDays({
    start: weekRange.start, end: weekRange.end, activeHabits, allTasks: tasks, focusSessions,
  });

  // ---- Telafi -----------------------------------------------------------
  const recoveryPlansV2 = recoveryPlans.map(fromLegacyRecoveryPlan);
  const mostRecovered = mostRecoveredHabit(recoveryPlansV2);
  const recoveryRate = recoverySuccessRate(recoveryPlansV2);

  // ---- Odak ---------------------------------------------------------
  const weekFocusMinutes = focusMinutesFromSessions(
    focusSessions.filter((s) => ymdFromIso(s.started_at) >= weekRange.start && ymdFromIso(s.started_at) <= weekRange.end),
  );
  const monthFocusMinutes = focusMinutesFromSessions(
    focusSessions.filter((s) => ymdFromIso(s.started_at) >= monthRange.start && ymdFromIso(s.started_at) <= monthRange.end),
  );

  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <View style={s.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
        <Text style={s.eyebrow}>İÇGÖRÜLER</Text>

        {activeHabits.length === 0 ? (
          <EmptyState
            icon="analytics-outline"
            title="Henüz içgörü yok"
            hint="Bir alışkanlık aktive ettikten ve birkaç gün kayıt tuttuktan sonra burada haftalık/aylık örüntüler görünecek."
          />
        ) : (
          <Card padding="lg" style={s.heroCard}>
            <Text style={s.heroLabel}>BU HAFTA</Text>
            <Text style={s.heroPercent}>%{weekRate}</Text>
            <Text style={s.heroDelta}>
              {weekOverWeek.ok
                ? `${weekOverWeek.value.magnitude >= 0 ? '+' : ''}${Math.round(weekOverWeek.value.magnitude * 100)}% önceki haftaya göre`
                : weekOverWeek.reason}
            </Text>
            <Text style={s.heroLine}>
              En güçlü: {strongest.ok ? habitName(strongest.value.habitId) : strongest.reason}
            </Text>
            <Text style={[s.heroLine, s.heroWarning]}>
              {worstDay.ok
                ? `Dikkat: ${DOW_TR[worstDay.value.weekday]} tamamlama oranı %${Math.round(worstDay.value.rate * 100)}`
                : `Dikkat: ${worstDay.reason}`}
            </Text>
          </Card>
        )}

        {/* HAFTA */}
        <SectionHeader title="HAFTA" variant="overline" style={{ marginTop: space.xl }} />
        <InsightRow icon="trending-up-outline" label="En başarılı gün" result={bestDay} formatOk={(v) => `${DOW_TR[v.weekday]} · %${Math.round(v.rate * 100)}`} />
        <InsightRow icon="trending-down-outline" label="En zayıf gün" result={worstDay} formatOk={(v) => `${DOW_TR[v.weekday]} · %${Math.round(v.rate * 100)}`} />
        <InsightRow icon={trendIcon(trend4.ok ? trend4.value.direction : 'flat')} label="4 haftalık trend" result={trend4} formatOk={() => formatTrend(trend4)} />

        {/* AY */}
        <SectionHeader title="AY" variant="overline" style={{ marginTop: space.lg }} />
        <MetricRow icon="calendar-number-outline" label="Bu ay tamamlama" value={`%${monthRate}`} />
        <InsightRow icon={trendIcon(trend12.ok ? trend12.value.direction : 'flat')} label="12 haftalık trend" result={trend12} formatOk={() => formatTrend(trend12)} />

        {/* ALIŞKANLIKLAR */}
        <SectionHeader title="ALIŞKANLIKLAR" variant="overline" style={{ marginTop: space.lg }} />
        <InsightRow icon="flash-outline" label="En güçlü habit" result={strongest} formatOk={(v) => habitName(v.habitId)} />
        <InsightRow icon="pulse-outline" label="En kırılgan habit" result={fragile} formatOk={(v) => `${habitName(v.habitId)} · %${Math.round(v.volatility * 100)} oynaklık`} />

        {/* KAPASİTE */}
        <SectionHeader title="KAPASİTE" variant="overline" style={{ marginTop: space.lg }} />
        <MetricRow
          icon="speedometer-outline"
          label="Bugünün yükü"
          value={`${todayLoad.normalised} / 100 · ${todayBandLabel}`}
        />
        <MetricRow icon="warning-outline" label="Bu hafta aşırı yüklenme günü" value={`${overloadDaysThisWeek} gün`} />

        {/* TELAFİ */}
        <SectionHeader title="TELAFİ" variant="overline" style={{ marginTop: space.lg }} />
        <InsightRow icon="refresh-circle-outline" label="En sık telafi edilen habit" result={mostRecovered} formatOk={(v) => `${habitName(v.habitId)} · ${v.count}x`} />
        <InsightRow icon="checkmark-done-outline" label="Telafi başarı oranı" result={recoveryRate} formatOk={(v) => `%${Math.round(v * 100)}`} />

        {/* ODAK */}
        <SectionHeader title="ODAK" variant="overline" style={{ marginTop: space.lg, marginBottom: space.xxl }} />
        <MetricRow icon="timer-outline" label="Bu hafta odak süresi" value={`${weekFocusMinutes} dk`} />
        <MetricRow icon="timer-outline" label="Bu ay odak süresi" value={`${monthFocusMinutes} dk`} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: space.lg, paddingBottom: space.xxl },

  eyebrow: { ...font.overline, color: colors.textFaint, marginBottom: space.md },

  heroCard: { marginBottom: space.md },
  heroLabel: { ...font.overline, color: colors.textFaint, marginBottom: space.xs },
  heroPercent: { ...font.display, fontSize: 40, color: colors.text, marginBottom: 2 },
  heroDelta: { fontSize: 13, color: colors.textDim, fontWeight: '600', marginBottom: space.sm },
  heroLine: { fontSize: 13, color: colors.textDim, marginTop: 2 },
  heroWarning: { color: colors.warning },

  insightCard: { gap: 4, marginBottom: space.sm },
  insightHead: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  insightLabel: { fontSize: 13, color: colors.textDim, fontWeight: '600', flex: 1 },
  insightValue: { fontSize: 15, color: colors.text, fontWeight: '700' },
  insightReason: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },
});
