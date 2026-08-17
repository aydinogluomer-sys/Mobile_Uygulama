import { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, useWindowDimensions } from 'react-native';
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
import { buildTodayNarrative } from '../../lib/todayNarrative';
import { colors, space, radius, font, hexA } from '../../lib/tokens';
import { haptic } from '../../lib/haptics';
import { todayLocal } from '../../lib/date';
import {
  Card, SectionHeader, EmptyState, ProgressRing, IconCircle, WillpowerBand,
} from '../../components/ui';

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

  const { habits, fetchHabits } = useHabitStore();
  const { fetchLogsForDate, getLogForHabit, logHabit } = useLogStore();
  const { tasks, fetchTasks, toggleDone, dueToday, overdue, addTask } = useTaskStore();
  const { state: wp, fetchToday } = useWillpowerStore();
  const { sessionsCompleted } = useFocusStore();
  const { plans: recoveryPlans, fetchPlans } = useRecoveryStore();

  const [refreshing, setRefreshing] = useState(false);

  const activeHabits = habits.filter((h) => h.status === 'active');
  const completedHabits = activeHabits.filter((h) => {
    const log = getLogForHabit(h.id);
    return log?.state === 'done' || log?.state === 'partial';
  });

  const todayTasks = dueToday();
  const overdueList = overdue();
  const pendingTasks = tasks.filter((t) => !t.completed && t.status === 'pending').slice(0, 5);

  const load = useCallback(async () => {
    await Promise.all([fetchHabits(), fetchLogsForDate(today), fetchTasks(), fetchToday(), fetchPlans()]);
  }, [fetchHabits, fetchLogsForDate, fetchPlans, fetchTasks, fetchToday, today]);

  useEffect(() => { load(); }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  const habitPct = activeHabits.length > 0 ? completedHabits.length / activeHabits.length : 0;
  const remainingHabits = activeHabits.length - completedHabits.length;
  const plannedRecovery = recoveryPlans.filter((p) => p.status === 'planned').length;

  const eyebrow = `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]} · ${isoWeek(now)}. hafta`;

  const narrative = buildTodayNarrative({
    hour: now.getHours(),
    overdueCount: overdueList.length,
    todayTaskCount: todayTasks.length,
    remainingHabits,
    totalHabits: activeHabits.length,
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
      sub: activeHabits.length === 0 ? 'ilk ritüelini oluştur' : remainingHabits === 0 ? 'günlük seri tamam' : `${remainingHabits} adım kaldı`,
      tone: activeHabits.length > 0 && remainingHabits === 0 ? 'ok' : 'mute',
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
    if (h.tracking_type === 'numeric') {
      router.push('/tabs/timeline' as any);
      return;
    }
    const log = getLogForHabit(h.id);
    const done = log?.state === 'done' || log?.state === 'partial';
    haptic.success();
    await logHabit({ habitId: h.id, date: new Date(), state: done ? 'miss' : 'done' });
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
            <Text style={s.productLabel}>ATLAS / GÜNLÜK PUSULA</Text>
            <Text style={s.productHint}>Ritmini gör, sıradaki doğru adımı seç.</Text>
          </View>
          <TouchableOpacity
            onPress={() => router.push('/screens/journal' as any)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Günlüğü aç"
          >
            <IconCircle icon="journal-outline" color={colors.accent} size={40} />
          </TouchableOpacity>
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
                    {activeHabits.length === 0
                      ? 'Henüz aktif bir ritüel yok'
                      : remainingHabits === 0 ? 'Günlük seri tamamlandı' : `${completedHabits.length}/${activeHabits.length} tamamlandı`}
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

            {activeHabits.length > 0 && (
              <Card padding="lg">
                <SectionHeader
                  title="RİTÜELLER · BUGÜN"
                  variant="overline"
                  actionLabel="Tümü →"
                  onAction={() => router.push('/tabs/timeline' as any)}
                />
                <View style={{ gap: space.sm }}>
                  {activeHabits.slice(0, isWide ? 4 : activeHabits.length).map((h) => {
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
                        accessibilityLabel={`${h.name}${h.tracking_type === 'numeric' ? ', değer gir' : ''}`}
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
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { width: '100%', maxWidth: 1240, alignSelf: 'center', paddingVertical: space.xl, paddingBottom: 96 },

  masthead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingBottom: space.lg, marginBottom: space.xl,
    borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
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
