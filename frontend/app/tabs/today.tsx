import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, useWindowDimensions, Alert, Modal } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import { useTaskStore } from '../../store/taskStore';
import { useWillpowerStore } from '../../store/willpowerStore';
import { useFocusStore } from '../../store/focusStore';
import { useRecoveryStore } from '../../store/recoveryStore';
import XPDisplay from '../../components/XPDisplay';
import TodayHero from '../../components/today/TodayHero';
import MetricGrid, { type Metric } from '../../components/today/MetricGrid';
import NextUpStrip, { type NextUpItem } from '../../components/today/NextUpStrip';
import InlineComposer from '../../components/InlineComposer';
import RecoveryRailCard from '../../components/today/RecoveryRailCard';
// R03.03 — start small: first step of a task as its own focus session.
import SmallStartSheet from '../../components/SmallStartSheet';
import type { SmallStepParent } from '../../lib/smallStart';
// R01.05 — habits on a dated break, and the holiday mode for all of them.
import TimeOffSheet from '../../components/TimeOffSheet';
import { activePauseOn, isPausedOn } from '../../lib/habitPauses';
// R01.04 — a habit with steps opens its checklist instead of a one-tap toggle.
import ChecklistSheet from '../../components/ChecklistSheet';
import { itemsOn } from '../../lib/habitChecklist';
import { buildTodayNarrative } from '../../lib/todayNarrative';
import { colors, space, radius, font, hexA } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import { todayLocal, parseLocalDate, startOfWeekLocal, ymd } from '../../lib/date';
import {
  Card, SectionHeader, EmptyState, ProgressRing, IconCircle, WillpowerBand, SyncStatusBadge,
} from '../../components/ui';
import { isMeasurableTracking } from '../../lib/habitEngine';
import { isEligibleOn, scheduleKind, isCountBasedSchedule, periodStatus } from '../../lib/habitSchedule';
// R01.06-b — the current period's logs, so a "3 a week" already met can step aside.
import { logsForPeriod, type ReviewLogRow } from '../../services/reviewService';
import type { Habit } from '../../lib/supabase';

// =====================================================================================
// R01.06-a — Bugün takvimi SORAR.
//
// Eskiden bu ekran yalnız `status === 'active'` filtresi uyguluyordu: Pzt/Çar/Cum
// alışkanlığı Salı da "kalan adım" sayılıyor, yüzdenin paydasına giriyordu.
// Artık günün yüzeyleri `isEligibleOn` (saf, log istemez) ile süzülmüş listeyi
// kullanır. `carriesDayLoad` BİLEREK kullanılmıyor: dönem logu ister, bu ekran
// yalnız bugünün logunu yükler. Sonuç: "haftada 3" hedefi dolsa da her gün
// görünür (loglanabilir); "bu hafta doldu" soluklaştırması ayrı kart (R01.06-b).
// =====================================================================================

/**
 * Takvim BELİRSİZ mi — yani `isEligibleOn`'un `false`'u "bugün değil" değil,
 * "bilmiyorum" mu demek?
 *
 *  - sayı modu (`weekly_count`/`monthly_count`) ama hedef yok: `scheduleKind`
 *    ne gün ne sayı taşıyan bir `kind:'weekly'` (ya da sayısız `monthly`)
 *    satırını `count: 0` olarak sınıflar ve `isEligibleOn` her gün `false` döner.
 *  - sabit gün modu ama `days` içinde geçerli (0..6 tamsayı) tek bir gün yok:
 *    `includes` hiçbir gün eşleşmez, yine her gün `false`.
 *
 * İki durumda da kâhinin cevabı "hiçbir gün" olur; bu bir takvim değil, eksik veri.
 */
export function isScheduleAmbiguous(habit: Habit): boolean {
  const sk = scheduleKind(habit);
  if (sk.kind === 'weekly_count' || sk.kind === 'monthly_count') return sk.count <= 0;
  if (sk.kind === 'weekly_days') {
    return !sk.days.some((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  }
  return false;
}

/**
 * Bugün'ün alışkanlıkları = aktif ∩ (o güne uygun ∪ takvimi belirsiz).
 *
 * FAIL-OPEN: takvim belirsizse GÖSTER. Belirsiz satırı gizlemek, kullanıcının
 * loglayabildiği (ve bu karttan önce Bugün'de gördüğü) bir alışkanlığı ondan
 * saklamak olur — ve gizlendiğini söyleyen hiçbir yüzey yoktur. Fazladan bir
 * satır görmek, var olan bir işi kaybetmekten ucuzdur. Bu, `isEligibleOn` /
 * `scheduleKind` değiştirilerek değil burada çözülür: kâhinin "belirsizlikte az
 * say" ilkesi raporlar için doğru, "neyi göstereyim" sorusu için yanlış.
 */
/**
 * R01.06-b — was this count-based habit's CURRENT period already met before
 * `date` began?
 *
 * "3 a week" finished by Wednesday has no work left on Thursday, but R01.06-a
 * had only today's log and kept it in "N adım kaldı" all week. Only logs
 * STRICTLY BEFORE `date` count -- the same "what did the day begin owing" rule
 * as `carriesDayLoad` -- so a habit finished TODAY stays in today's list and
 * reads as done, instead of vanishing the moment it is ticked. Day-based
 * habits are never "period done": they have no period.
 */
export function isPeriodDoneBefore(habit: Habit, date: Date, periodLogs: readonly ReviewLogRow[]): boolean {
  if (!isCountBasedSchedule(habit)) return false;
  const ds = ymd(date);
  const before = periodLogs.filter((l) => l.habit_id === habit.id && l.completed_at.slice(0, 10) < ds);
  return periodStatus(habit, before, date, { asOf: date }).status === 'satisfied';
}

/**
 * Today's work. `periodLogs` (R01.06-b) is optional ON PURPOSE: until the
 * period's logs have loaded -- or if loading fails -- nothing is hidden for
 * lack of evidence, and the list is exactly R01.06-a's. Hiding a habit because
 * a fetch has not answered yet would be the fail-closed mistake fail-open
 * exists to prevent.
 */
export function selectTodayHabits(
  habits: Habit[],
  date: Date,
  periodLogs: readonly ReviewLogRow[] | null = null,
  // R03.02 — habits the user set aside for today ("Bugün daha az"). Optional so
  // every caller that predates the light day keeps its exact behaviour.
  setAside: ReadonlySet<string> = NO_IDS,
): Habit[] {
  return habits.filter(
    (h) => h.status === 'active'
      // R01.05 — a dated break wins over the ambiguous-schedule fail-open.
      && !isPausedOn(h, date)
      && (isEligibleOn(h, date) || isScheduleAmbiguous(h))
      && !(periodLogs && isPeriodDoneBefore(h, date, periodLogs))
      && !setAside.has(h.id),
  );
}

/** R01.05 — the active habits on a dated break (own pause or holiday) today. */
export function selectOnBreakHabits(habits: Habit[], date: Date): Habit[] {
  return habits.filter((h) => h.status === 'active' && isPausedOn(h, date));
}

const NO_IDS: ReadonlySet<string> = new Set<string>();

/**
 * R03.02 — "Bugün daha az yapabilirim": the ids whose TODAY log is `skip`.
 *
 * The light day is built on the existing `skip` state rather than a new
 * concept, because `skip` already means exactly what the light day promises
 * everywhere it is read (habitSchedule "skip cezasız (§8.5)"): excluded from
 * both sides of every rate, transparent to the streak (neither counts nor
 * breaks it), and worth 0 XP (`xpFor`). It is per DAY, so no goal changes --
 * the guide's rule that a light day must not permanently alter targets holds
 * by construction.
 */
export function setAsideIds(habits: Habit[], todayStateOf: (habitId: string) => string | undefined): Set<string> {
  return new Set(habits.filter((h) => todayStateOf(h.id) === 'skip').map((h) => h.id));
}

/**
 * R03.02 — the habits set aside today, among those that would otherwise be
 * today's work. A habit whose period is already met stays in the period-done
 * group instead: setting it aside would mean nothing.
 */
export function selectSetAsideHabits(
  habits: Habit[],
  date: Date,
  periodLogs: readonly ReviewLogRow[] | null,
  setAside: ReadonlySet<string>,
): Habit[] {
  return selectTodayHabits(habits, date, periodLogs).filter((h) => setAside.has(h.id));
}

/** "bu hafta tamam" / "bu ay tamam" — the period the habit is counted in. */
export function periodDoneLabel(habit: Habit): string {
  return scheduleKind(habit).kind === 'monthly_count' ? 'bu ay tamam' : 'bu hafta tamam';
}

/** R01.06-b — the habits that stepped aside because their period is already met. */
export function selectPeriodDoneHabits(habits: Habit[], date: Date, periodLogs: readonly ReviewLogRow[] | null): Habit[] {
  if (!periodLogs) return [];
  return habits.filter(
    (h) => h.status === 'active' && isEligibleOn(h, date) && isPeriodDoneBefore(h, date, periodLogs),
  );
}

/**
 * The window that covers the current week AND month: a week can start in the
 * previous month (Mon 28 Sep .. Sun 4 Oct), so the month alone would miss its
 * first days.
 */
export function periodWindowStart(date: Date): string {
  const week = startOfWeekLocal(date);
  const month = new Date(date.getFullYear(), date.getMonth(), 1);
  return ymd(week < month ? week : month);
}

export type TodayHabitSummary = { total: number; completed: number; remaining: number; pct: number };

/**
 * Yüzde ve "N adım kaldı" TEK paydadan gelir (`total` = Bugün'ün listesi);
 * ayrı ayrı hesaplanırsa biri takvimi sorar, öteki sormaz ve birbirini yalanlar.
 * `total === 0` iken yüzde 0'dır — sıfıra bölme yok.
 *
 * Pay, paydanın içinden sayılır: `completedHabits`'te olup Bugün'ün listesinde
 * olmayan bir alışkanlık (ör. Salı başka ekrandan loglanmış bir Pzt/Çar/Cum)
 * yüzdeyi 100'ün üstüne ya da "kalan"ı eksiye itemez.
 */
export function summarizeTodayHabits(todayHabits: Habit[], completedHabits: Habit[]): TodayHabitSummary {
  const total = todayHabits.length;
  const doneIds = new Set(completedHabits.map((h) => h.id));
  const completed = todayHabits.filter((h) => doneIds.has(h.id)).length;
  return { total, completed, remaining: total - completed, pct: total > 0 ? completed / total : 0 };
}

/**
 * Metrik kartı ve halka kartının alt metni.
 *
 * `activeCount` (toplam aktif) burada GERÇEKTEN kastedilen sayıdır: "hiç
 * ritüelin yok, oluştur" ile "ritüellerin var ama bugün planlı değil" farklı
 * cümlelerdir. İkincisinde kullanıcıya oluşturma önermek yanlış olur.
 */
export function todayHabitCopy(summary: TodayHabitSummary, activeCount: number): { metricSub: string; ringSub: string } {
  if (activeCount === 0) return { metricSub: 'ilk ritüelini oluştur', ringSub: 'Henüz aktif bir ritüel yok' };
  if (summary.total === 0) return { metricSub: 'bugün planlı ritüel yok', ringSub: 'Bugün planlı ritüel yok' };
  if (summary.remaining === 0) return { metricSub: 'günlük seri tamam', ringSub: 'Günlük seri tamamlandı' };
  return {
    metricSub: `${summary.remaining} adım kaldı`,
    ringSub: `${summary.completed}/${summary.total} tamamlandı`,
  };
}

// ISO hafta numarası (1–53)
function isoWeek(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil((((date as any) - (yearStart as any)) / 86400000 + 1) / 7);
}

const DAYS = ['Paz', 'Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt'];
const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

const PRIORITY_COLOR: Record<string, string> = {
  high: colors.error, medium: colors.warning, low: colors.success, none: colors.textGhost,
};

export default function TodayScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const pagePadding = width < 480 ? space.lg : width < 900 ? space.xl : space.h;
  const isWide = width >= 1180;
  const today = todayLocal();
  const now = new Date();

  const { habits, fetchHabits, pauses, timeOffAvailable, addTimeOff, endTimeOff, checklistItems } = useHabitStore();
  const [checklistFor, setChecklistFor] = useState<Habit | null>(null);
  // §18: `pendingSyncCount` / `deadSyncCount` burada okunuyor çünkü alışkanlık
  // tamamlama bu ekranda oluyor (`onHabitTap` -> `logHabit`). Dokunuşun
  // yapıldığı yerde durumu göstermek, kullanıcının "kaydedildi mi?" sorusunu
  // sorduğu tek yer.
  const { fetchLogsForDate, getLogForHabit, logHabit, pendingSyncCount, deadSyncCount } = useLogStore();
  const { tasks, fetchTasks, toggleDone, dueToday, overdue, addTask } = useTaskStore();
  const { state: wp, fetchToday } = useWillpowerStore();
  const { sessionsCompleted } = useFocusStore();
  const { plans: recoveryPlans, fetchPlans } = useRecoveryStore();

  const [refreshing, setRefreshing] = useState(false);
  // R01.06-b — null until loaded, and on failure: see `selectTodayHabits`.
  const [periodLogs, setPeriodLogs] = useState<ReviewLogRow[] | null>(null);
  // R03.02 — the light-day sheet: which of today's open habits the user is setting aside.
  const [lightDayPick, setLightDayPick] = useState<Set<string> | null>(null);
  const [smallStartFor, setSmallStartFor] = useState<SmallStepParent | null>(null);
  const [lightDaySaving, setLightDaySaving] = useState(false);

  // Toplam aktif — YALNIZ "hiç ritüel yok" boş-durumunu ayırt etmek için
  // (`todayHabitCopy`). Hiçbir gün-yüzeyinde payda değildir.
  const activeHabits = habits.filter((h) => h.status === 'active');
  // Günün yüzeyleri (liste, sayaç, yüzde, kalan, anlatı) bunu kullanır.
  const todayDate = parseLocalDate(today) ?? now;
  // R03.02 — today's `skip` logs are the light day; read from the same store as the list.
  const lightDayIds = setAsideIds(habits, (id) => getLogForHabit(id)?.state);
  const todayHabits = selectTodayHabits(habits, todayDate, periodLogs, lightDayIds);
  const setAsideHabits = selectSetAsideHabits(habits, todayDate, periodLogs, lightDayIds);
  const periodDoneHabits = selectPeriodDoneHabits(habits, todayDate, periodLogs);
  // R01.05
  const onBreakHabits = selectOnBreakHabits(habits, todayDate);
  const holiday = activePauseOn({ pause_intervals: pauses.filter((p) => p.habit_id === null) }, todayDate);
  const [holidayOpen, setHolidayOpen] = useState(false);
  const completedHabits = todayHabits.filter((h) => {
    const log = getLogForHabit(h.id);
    return log?.state === 'done' || log?.state === 'partial';
  });
  const habitSummary = summarizeTodayHabits(todayHabits, completedHabits);
  const habitCopy = todayHabitCopy(habitSummary, activeHabits.length);

  const todayTasks = dueToday();
  const overdueList = overdue();
  const pendingTasks = tasks.filter((t) => !t.completed && t.status === 'pending').slice(0, 5);

  const loadPeriodLogs = useCallback(async () => {
    const res = await logsForPeriod({ start: periodWindowStart(parseLocalDate(today) ?? new Date()), end: today });
    setPeriodLogs(res.ok ? res.data : null);
  }, [today]);

  const load = useCallback(async () => {
    await Promise.all([fetchHabits(), fetchLogsForDate(today), fetchTasks(), fetchToday(), fetchPlans(), loadPeriodLogs()]);
  }, [fetchHabits, fetchLogsForDate, fetchPlans, fetchTasks, fetchToday, loadPeriodLogs, today]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const habitPct = habitSummary.pct;
  const remainingHabits = habitSummary.remaining;
  const plannedRecovery = recoveryPlans.filter((p) => p.status === 'planned').length;

  const eyebrow = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} · ${isoWeek(now)}. hafta`;

  const narrative = buildTodayNarrative({
    hour: now.getHours(),
    overdueCount: overdueList.length,
    todayTaskCount: todayTasks.length,
    remainingHabits,
    totalHabits: habitSummary.total,
    focusSessions: sessionsCompleted,
  });

  const metrics: Metric[] = [
    {
      eyebrow: 'Açık görev',
      value: String(todayTasks.length + overdueList.length),
      sub: overdueList.length > 0 ? `${overdueList.length} gecikmiş · ${todayTasks.length} bugün` : `${todayTasks.length} görev bugün`,
      tone: overdueList.length > 0 ? 'bad' : 'mute',
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

  // "Sırada" şeridi — gecikmiş → bugün → en yakın son-tarihli görevler
  const upcoming = tasks
    .filter((t) => !t.completed && t.status !== 'cancelled' && t.due_date && t.due_date > today)
    .sort((a, b) => (a.due_date! < b.due_date! ? -1 : 1));

  const dueLabel = (iso: string): string => {
    const d = new Date(iso + 'T00:00:00');
    const diff = Math.round((d.getTime() - new Date(today + 'T00:00:00').getTime()) / 86400000);
    if (diff <= 0) return diff < 0 ? 'gecikmiş' : 'bugün';
    if (diff < 7) return DAYS[d.getDay()];
    return `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;
  };

  const nextUpItems: NextUpItem[] = [
    ...overdueList.map((t) => ({ id: t.id, title: t.title, dueLabel: 'gecikmiş', dotColor: PRIORITY_COLOR[t.priority], overdue: true })),
    ...todayTasks.map((t) => ({ id: t.id, title: t.title, dueLabel: 'bugün', dotColor: PRIORITY_COLOR[t.priority] })),
    ...upcoming.map((t) => ({ id: t.id, title: t.title, dueLabel: dueLabel(t.due_date!), dotColor: PRIORITY_COLOR[t.priority] })),
  ].slice(0, 8);

  // Binary alışkanlık → yerinde tamamla; numerik → timeline'a yönlen.
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
    if (!res.ok) Alert.alert('Kaydedilemedi', res.error);
  }

  // R03.02 — what can be set aside: today's work that is not done yet.
  const lightDayCandidates = todayHabits.filter((h) => !completedHabits.some((c) => c.id === h.id));

  function toggleLightDay(id: string) {
    setLightDayPick((cur) => {
      const next = new Set(cur ?? []);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /**
   * R03.02 — writes a `skip` for TODAY for each chosen habit, and nothing else.
   * Explicit choice only: nothing is set aside on the user's behalf, and no
   * target, schedule or future day is touched. A failed write is reported by
   * name and the sheet stays open with what failed still selected.
   */
  async function confirmLightDay() {
    if (!lightDayPick || lightDayPick.size === 0) return;
    setLightDaySaving(true);
    const failed: string[] = [];
    for (const id of lightDayPick) {
      const res = await logHabit({ habitId: id, date: new Date(), state: 'skip' });
      if (!res.ok) failed.push(id);
    }
    setLightDaySaving(false);
    if (failed.length > 0) {
      const names = habits.filter((h) => failed.includes(h.id)).map((h) => h.name).join(', ');
      Alert.alert('Bir kısmı kaydedilemedi', names);
      setLightDayPick(new Set(failed));
      return;
    }
    haptic.success();
    setLightDayPick(null);
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[s.content, { paddingHorizontal: pagePadding }]}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        <View style={s.masthead}>
          <View>
            <Text style={s.productLabel}>ADERYTH / GÜNLÜK PUSULA</Text>
            <Text style={s.productHint}>Ritmini gör, sıradaki doğru adımı seç.</Text>
          </View>
          <View style={s.mastheadActions}>
            {/* §18 senkron durumu — hiçbir şey beklemiyorsa kendini render
                etmez, dolayısıyla burada koşul gerekmiyor. */}
            <SyncStatusBadge pending={pendingSyncCount} dead={deadSyncCount} />
            <TouchableOpacity
              onPress={() => router.push('/screens/journal' as any)}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Günlüğü aç"
            >
              <IconCircle icon="journal-outline" color={colors.accent} size={40} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Editöryel Bugün hero */}
        <TodayHero
          eyebrow={eyebrow}
          narrative={narrative}
          ctas={[
            { label: 'Odağa geç', icon: 'timer-outline', variant: 'primary', onPress: () => router.push('/tabs/focus' as any) },
            { label: 'Haftayı değerlendir', icon: 'book-outline', variant: 'secondary', onPress: () => router.push('/screens/weekly-review' as any) },
            { label: 'Denge planı', icon: 'moon-outline', variant: 'ghost', onPress: () => router.push('/screens/recovery' as any) },
          ]}
        />

        {/* Sakin metrik ızgarası */}
        <MetricGrid metrics={metrics} />

        <View style={[s.dashboardBody, isWide && s.dashboardBodyWide]}>
          <View style={s.mainColumn}>
            <View style={s.mainSection}>
              <View style={s.sectionIntro}>
                <View>
                  <Text style={s.sectionEyebrow}>BUGÜN · {pendingTasks.length}</Text>
                  <Text style={s.sectionTitle}>Masadakiler</Text>
                </View>
                <TouchableOpacity
                  onPress={() => router.push('/tabs/tasks' as any)}
                  accessibilityRole="button"
                  accessibilityLabel="Tüm görevleri aç"
                >
                  <Text style={s.sectionAction}>Tümü →</Text>
                </TouchableOpacity>
              </View>
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
                    color={colors.success}
                    compact
                  />
                </Card>
              ) : (
                <View style={{ gap: space.sm }}>
                  {pendingTasks.map((t) => (
                    <Card key={t.id} padding="md" onPress={() => { haptic.light(); toggleDone(t.id); }}>
                      <View style={s.taskRow}>
                        <View style={[s.taskDot, { borderColor: PRIORITY_COLOR[t.priority] }]} />
                        <Text style={s.taskTitle} numberOfLines={1}>{t.title}</Text>
                        {t.due_date && (
                          <Text style={[s.taskDate, t.due_date < today && { color: colors.error }]}>
                            {t.due_date === today ? 'Bugün' : t.due_date}
                          </Text>
                        )}
                        <TouchableOpacity
                          onPress={() => setSmallStartFor({ kind: 'task', id: t.id, title: t.title })}
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel={`${t.title} için küçük başla`}
                        >
                          <Ionicons name="play-circle-outline" size={20} color={colors.textFaint} />
                        </TouchableOpacity>
                      </View>
                    </Card>
                  ))}
                </View>
              )}
            </View>

            <NextUpStrip items={nextUpItems} onPress={() => router.push('/tabs/tasks' as any)} />
          </View>

          <View style={[s.railColumn, isWide && s.railColumnWide]}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => router.push('/screens/profile' as any)}
              accessibilityRole="button"
              accessibilityLabel="Profil ve deneyim puanını aç"
            >
              <XPDisplay />
            </TouchableOpacity>

            <Card padding="lg" onPress={() => router.push('/tabs/timeline' as any)}>
              <View style={s.ringCard}>
                <ProgressRing progress={habitPct} size={64} stroke={7} color={colors.success}>
                  <Text style={s.ringPct}>{Math.round(habitPct * 100)}%</Text>
                </ProgressRing>
                <View style={{ flex: 1 }}>
                  <Text style={s.ringTitle}>Bugünün ritüelleri</Text>
                  <Text style={s.ringSub}>
                    {habitCopy.ringSub}
                  </Text>
                </View>
              </View>
            </Card>

            {wp && (
              <Card padding="lg" onPress={() => router.push('/tabs/timeline' as any)}>
                <View style={s.wpHead}>
                  <Text style={s.wpHeadText}>İrade dengesi</Text>
                  <Text style={s.wpHeadHint}>günlük bütçe</Text>
                </View>
                <WillpowerBand wp={wp} />
              </Card>
            )}

            {todayHabits.length > 0 && (
              <Card padding="lg">
                <SectionHeader
                  title="RİTÜELLER · BUGÜN"
                  variant="overline"
                  actionLabel="Tümü →"
                  onAction={() => router.push('/tabs/timeline' as any)}
                />
                <View style={{ gap: space.sm }}>
                  {todayHabits.slice(0, isWide ? 4 : todayHabits.length).map((h) => {
                    const log = getLogForHabit(h.id);
                    const done = log?.state === 'done' || log?.state === 'partial';
                    const col = h.color ?? colors.primary;
                    return (
                      <TouchableOpacity
                        key={h.id}
                        activeOpacity={0.75}
                        style={[s.habitRow, done && { borderColor: hexA(colors.success, 0.4), backgroundColor: hexA(colors.success, 0.06) }]}
                        onPress={() => onHabitTap(h)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: done }}
                        accessibilityLabel={`${h.name}${isMeasurableTracking(h.tracking_type) ? ', değer gir' : ''}`}
                      >
                        <View style={[
                          s.habitCheck,
                          { borderColor: done ? colors.success : colors.borderStrong },
                          done && { backgroundColor: colors.success },
                        ]}>
                          {done
                            ? <Ionicons name="checkmark" size={14} color={colors.white} />
                            : <Ionicons name={(h.icon ?? 'ellipse-outline') as any} size={14} color={col} />}
                        </View>
                        <Text style={[s.habitName, done && s.habitNameDone]} numberOfLines={1}>{h.name}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {lightDayCandidates.length > 0 && (
                  <TouchableOpacity
                    style={s.lightDayBtn}
                    onPress={() => { haptic.select(); setLightDayPick(new Set()); }}
                    accessibilityRole="button"
                    accessibilityLabel="Bugün daha az yapabilirim. Bugünkü ritüellerden bazılarını kenara koy."
                  >
                    <Ionicons name="leaf-outline" size={14} color={colors.textDim} />
                    <Text style={s.lightDayBtnText}>Bugün daha az yapabilirim</Text>
                  </TouchableOpacity>
                )}
                {!holiday && (
                  <TouchableOpacity
                    style={s.lightDayBtn}
                    onPress={() => { haptic.select(); setHolidayOpen(true); }}
                    accessibilityRole="button"
                    accessibilityLabel="Tatil modu. Birkaç gün bütün alışkanlıklara ara ver."
                  >
                    <Ionicons name="airplane-outline" size={14} color={colors.textDim} />
                    <Text style={s.lightDayBtnText}>Birkaç gün ara: tatil modu</Text>
                  </TouchableOpacity>
                )}
              </Card>
            )}

            {/* R03.02 — bugün için kenara konanlar: kalan iş değil, ama görünür ve
                dokunulunca yine de yapıldı olarak kaydedilir. */}
            {setAsideHabits.length > 0 && (
              <Card padding="lg">
                <SectionHeader title="BUGÜN HAFİFLETİLDİ" variant="overline" />
                <View style={{ gap: space.sm }}>
                  {setAsideHabits.map((h) => (
                    <TouchableOpacity
                      key={h.id}
                      activeOpacity={0.75}
                      style={[s.habitRow, s.habitRowPeriodDone]}
                      onPress={() => onHabitTap(h)}
                      accessibilityRole="button"
                      accessibilityLabel={`${h.name}, bugün için kenara konuldu. Yine de yaptıysan dokun.`}
                    >
                      <View style={[s.habitCheck, { borderColor: colors.borderStrong }]}>
                        <Ionicons name="pause-outline" size={14} color={colors.textDim} />
                      </View>
                      <Text style={s.habitName} numberOfLines={1}>{h.name}</Text>
                      <Text style={s.setAsideTag}>bugün kenarda</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Card>
            )}

            {/* R01.05 — tatil modu açıksa söyle, tek dokunuşla bitirilebilsin */}
            {holiday && (
              <Card padding="lg">
                <SectionHeader title="TATİL MODU" variant="overline" />
                <Text style={s.breakNote}>
                  {holiday.end_date ? `${holiday.end_date} tarihine kadar` : 'Sen bitirene kadar'} bütün alışkanlıklar arada:
                  hesaba girmez, seriler köprü kurar, hatırlatıcı gelmez.
                </Text>
                <TouchableOpacity
                  style={s.lightDayBtn}
                  onPress={async () => {
                    const res = await endTimeOff(holiday.id);
                    if (!res.ok) Alert.alert('Kaydedilemedi', res.error);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Tatili bugün bitir"
                >
                  <Ionicons name="play-outline" size={14} color={colors.textDim} />
                  <Text style={s.lightDayBtnText}>Tatili bugün bitir</Text>
                </TouchableOpacity>
              </Card>
            )}

            {/* R01.05 — kendi arası (ya da tatil) olan alışkanlıklar: kalan iş değil */}
            {onBreakHabits.length > 0 && (
              <Card padding="lg">
                <SectionHeader title="ARADA" variant="overline" />
                <View style={{ gap: space.sm }}>
                  {onBreakHabits.map((h) => {
                    const p = activePauseOn(h, todayDate);
                    return (
                      <View key={h.id} style={[s.habitRow, s.habitRowPeriodDone]} accessible accessibilityLabel={`${h.name}, arada${p?.end_date ? `, ${p.end_date} tarihine kadar` : ''}.`}>
                        <View style={[s.habitCheck, { borderColor: colors.borderStrong }]}>
                          <Ionicons name="cafe-outline" size={14} color={colors.textDim} />
                        </View>
                        <Text style={s.habitName} numberOfLines={1}>{h.name}</Text>
                        <Text style={s.setAsideTag}>{p?.end_date ? `${p.end_date}'e kadar` : 'arada'}</Text>
                      </View>
                    );
                  })}
                </View>
              </Card>
            )}

            {/* R01.06-b — dönemi bugünden önce dolmuş sayı hedefleri: kalan iş değil,
                ama hâlâ görünür ve fazladan kaydedilebilir. */}
            {periodDoneHabits.length > 0 && (
              <Card padding="lg">
                <SectionHeader title="BU DÖNEM TAMAM" variant="overline" />
                <View style={{ gap: space.sm }}>
                  {periodDoneHabits.map((h) => (
                    <TouchableOpacity
                      key={h.id}
                      activeOpacity={0.75}
                      style={[s.habitRow, s.habitRowPeriodDone]}
                      onPress={() => onHabitTap(h)}
                      accessibilityRole="button"
                      accessibilityLabel={`${h.name}, ${periodDoneLabel(h)}. Yine de kaydetmek için dokun.`}
                    >
                      <View style={[s.habitCheck, { borderColor: colors.success, backgroundColor: hexA(colors.success, 0.25) }]}>
                        <Ionicons name="checkmark-done" size={14} color={colors.success} />
                      </View>
                      <Text style={[s.habitName, s.habitNameDone]} numberOfLines={1}>{h.name}</Text>
                      <Text style={s.periodDoneTag}>{periodDoneLabel(h)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </Card>
            )}

            <RecoveryRailCard
              plans={recoveryPlans}
              today={today}
              onOpen={() => router.push('/screens/recovery' as any)}
            />
          </View>
        </View>
      </ScrollView>

      {/* R03.02 — "Bugün daha az yapabilirim" */}
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
          // Starts a focus session only; the task itself is not written.
          const started = useFocusStore.getState().startSmallStep(parent, draft);
          if (started) { setSmallStartFor(null); router.push('/tabs/focus' as any); }
          return started;
        }}
      />

      <Modal visible={lightDayPick !== null} transparent animationType="slide" onRequestClose={() => setLightDayPick(null)}>
        <View style={s.sheetOverlay}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Bugün daha az yapabilirim</Text>
            <Text style={s.sheetBody}>
              Bugün kenara koyacaklarını seç. Bu yalnız bugünü etkiler: hedeflerin ve takvimin değişmez,
              tamamlama oranın düşmez, serin bozulmaz — ama bugün uzamaz da.
            </Text>
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
                    <View style={[s.habitCheck, { borderColor: picked ? colors.accent : colors.borderStrong }, picked && { backgroundColor: colors.accent }]}>
                      {picked && <Ionicons name="checkmark" size={14} color={colors.white} />}
                    </View>
                    <Text style={s.habitName} numberOfLines={1}>{h.name}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <View style={s.sheetActions}>
              <TouchableOpacity
                style={s.sheetCancel}
                onPress={() => setLightDayPick(null)}
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
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  // R01.06-b — dimmed, not hidden: the work is done, the habit is still there.
  habitRowPeriodDone: { opacity: 0.55 },
  periodDoneTag: { fontSize: 11, color: colors.success, fontWeight: '600', marginLeft: 'auto' },
  // R03.02
  setAsideTag: { fontSize: 11, color: colors.textDim, fontWeight: '600', marginLeft: 'auto' },
  lightDayBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', marginTop: space.md, paddingVertical: 6 },
  lightDayBtnText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
  breakNote: { fontSize: 13, color: colors.textDim, lineHeight: 19 },
  sheetOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bgElevated, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: space.lg },
  sheetTitle: { ...font.title, fontSize: 18, color: colors.text, marginBottom: space.sm },
  sheetBody: { fontSize: 13, color: colors.textDim, lineHeight: 19, marginBottom: space.sm },
  sheetNote: { fontSize: 11, color: colors.textFaint, lineHeight: 16, marginBottom: space.md },
  sheetActions: { flexDirection: 'row', gap: space.sm, marginTop: space.md },
  sheetCancel: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  sheetCancelText: { color: colors.textDim, fontWeight: '600' },
  sheetSave: { flex: 1, paddingVertical: 14, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.accent },
  sheetSaveDisabled: { opacity: 0.4 },
  sheetSaveText: { color: colors.white, fontWeight: '700' },
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 1240, alignSelf: 'center', paddingVertical: space.xl, paddingBottom: 96 },

  masthead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: space.lg, marginBottom: space.xl,
    borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  mastheadActions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  productLabel: { ...font.overline, color: colors.primaryBright, marginBottom: 5 },
  productHint: { ...font.bodySm, color: colors.textFaint },

  dashboardBody: { marginTop: space.hh, gap: space.h },
  dashboardBodyWide: { flexDirection: 'row', alignItems: 'flex-start', gap: space.hh },
  mainColumn: { flex: 1, minWidth: 0 },
  railColumn: { gap: space.lg },
  railColumnWide: { width: 320 },
  mainSection: { marginTop: 0 },
  sectionIntro: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md, marginBottom: space.md },
  sectionEyebrow: { ...font.overline, color: colors.textFaint, marginBottom: 6 },
  sectionTitle: { ...font.title, color: colors.text },
  sectionAction: { ...font.bodySm, color: colors.primaryBright, fontWeight: '700' },

  ringCard: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  ringPct: { ...font.metric, fontSize: 18, color: colors.success },
  ringTitle: { ...font.h3, color: colors.text, marginBottom: 3 },
  ringSub: { ...font.bodySm, color: colors.textFaint },

  wpHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  wpHeadText: { ...font.h3, color: colors.text },
  wpHeadHint: { ...font.caption, color: colors.textFaint },

  habitRow: {
    flexDirection: 'row', alignItems: 'center', gap: space.md,
    backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md,
    borderWidth: 1, borderColor: colors.border,
  },
  habitCheck: {
    width: 30, height: 30, borderRadius: radius.sm, borderWidth: 2,
    alignItems: 'center', justifyContent: 'center',
  },
  habitName: { flex: 1, ...font.body, color: colors.text },
  habitNameDone: { color: colors.textFaint, textDecorationLine: 'line-through' },

  taskRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  taskDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
  taskTitle: { flex: 1, ...font.body, color: colors.text },
  taskDate: { ...font.caption, color: colors.textFaint },
});
