import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
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
  const today = new Date().toISOString().split('T')[0];
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

  async function load() {
    await Promise.all([fetchHabits(), fetchLogsForDate(today), fetchTasks(), fetchToday(), fetchPlans()]);
  }

  useEffect(() => { load(); }, []);

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
      sub: `${overdueList.length} gecikmiş · ${todayTasks.length} bugün`,
      tone: overdueList.length > 0 ? 'bad' : 'mute',
      onPress: () => router.push('/tabs/tasks' as any),
    },
    {
      eyebrow: 'Odak · bugün',
      value: sessionsCompleted > 0 ? String(sessionsCompleted) : '—',
      sub: sessionsCompleted > 0 ? 'odak seansı tamamlandı' : 'henüz odak oturumu yok',
      tone: sessionsCompleted > 0 ? 'accent' : 'mute',
      onPress: () => router.push('/tabs/focus' as any),
    },
    {
      eyebrow: 'Alışkanlık',
      value: `${Math.round(habitPct * 100)}%`,
      sub: activeHabits.length === 0 ? 'aktif alışkanlık yok' : `${remainingHabits} kaldı`,
      tone: activeHabits.length > 0 && remainingHabits === 0 ? 'ok' : 'mute',
      onPress: () => router.push('/tabs/timeline' as any),
    },
    {
      eyebrow: 'Telafi',
      value: plannedRecovery > 0 ? String(plannedRecovery) : '—',
      sub: plannedRecovery > 0 ? 'planlı telafi var' : 'telafi planı yok',
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
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* Günlük hızlı erişim — sağ üst */}
        <View style={s.topActions}>
          <TouchableOpacity onPress={() => router.push('/screens/journal' as any)} activeOpacity={0.7}>
            <IconCircle icon="journal-outline" color={colors.accent} size={40} />
          </TouchableOpacity>
        </View>

        {/* Editöryel Bugün hero */}
        <TodayHero
          eyebrow={eyebrow}
          narrative={narrative}
          ctas={[
            { label: 'Odağa geç', icon: 'timer-outline', variant: 'primary', onPress: () => router.push('/tabs/focus' as any) },
            { label: 'Haftalık rapor', icon: 'book-outline', variant: 'secondary', onPress: () => router.push('/screens/weekly-review' as any) },
            { label: 'Aylık rapor', icon: 'calendar-number-outline', variant: 'secondary', onPress: () => router.push('/screens/monthly-review' as any) },
            { label: 'Telafiye bak', icon: 'moon-outline', variant: 'ghost', onPress: () => router.push('/screens/recovery' as any) },
          ]}
        />

        {/* Sakin metrik ızgarası */}
        <MetricGrid metrics={metrics} />

        {/* Sırada — yaklaşan görev şeridi */}
        <NextUpStrip items={nextUpItems} onPress={() => router.push('/tabs/tasks' as any)} />

        {/* XP / rütbe özeti → profil */}
        <TouchableOpacity
          activeOpacity={0.8}
          onPress={() => router.push('/screens/profile' as any)}
          style={{ marginTop: space.lg, marginBottom: space.md }}
        >
          <XPDisplay />
        </TouchableOpacity>

        {/* Alışkanlık tamamlama — ring kartı */}
        <Card padding="lg" style={{ marginBottom: space.md }} onPress={() => router.push('/tabs/timeline' as any)}>
          <View style={s.ringCard}>
            <ProgressRing progress={habitPct} size={76} stroke={8} color={colors.success}>
              <Text style={s.ringPct}>{Math.round(habitPct * 100)}%</Text>
            </ProgressRing>
            <View style={{ flex: 1 }}>
              <Text style={s.ringTitle}>Bugünün Alışkanlıkları</Text>
              <Text style={s.ringSub}>
                {activeHabits.length === 0
                  ? 'Henüz aktif alışkanlık yok'
                  : `${completedHabits.length}/${activeHabits.length} tamamlandı`}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textGhost} />
          </View>
        </Card>

        {/* İrade bandı */}
        {wp && (
          <Card padding="lg" style={{ marginTop: space.md }} onPress={() => router.push('/tabs/timeline' as any)}>
            <View style={s.wpHead}>
              <Text style={s.wpHeadText}>İrade Puanı</Text>
              <Text style={s.wpHeadHint}>günlük bütçe</Text>
            </View>
            <WillpowerBand wp={wp} />
          </Card>
        )}

        {/* Bugünün alışkanlıkları — tamamlanabilir kartlar */}
        {activeHabits.length > 0 && (
          <View style={s.section}>
            <SectionHeader
              title="BUGÜNÜN ALIŞKANLIKLARI"
              variant="overline"
              actionLabel="Tümü →"
              onAction={() => router.push('/tabs/timeline' as any)}
            />
            <View style={{ gap: space.sm }}>
              {activeHabits.map((h) => {
                const log = getLogForHabit(h.id);
                const done = log?.state === 'done' || log?.state === 'partial';
                const col = h.color ?? colors.primary;
                return (
                  <TouchableOpacity
                    key={h.id}
                    activeOpacity={0.75}
                    style={[s.habitRow, done && { borderColor: hexA(colors.success, 0.4), backgroundColor: hexA(colors.success, 0.06) }]}
                    onPress={() => onHabitTap(h)}
                  >
                    <View style={[
                      s.habitCheck,
                      { borderColor: done ? colors.success : colors.borderStrong },
                      done && { backgroundColor: colors.success },
                    ]}>
                      {done
                        ? <Ionicons name="checkmark" size={16} color={colors.white} />
                        : <Ionicons name={(h.icon ?? 'ellipse-outline') as any} size={15} color={col} />}
                    </View>
                    <Text style={[s.habitName, done && s.habitNameDone]} numberOfLines={1}>{h.name}</Text>
                    {h.tracking_type === 'numeric' && (
                      <Ionicons name="create-outline" size={16} color={colors.textGhost} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        {/* Yaklaşan görevler */}
        <View style={s.section}>
          <SectionHeader
            title="YAKLAŞAN GÖREVLER"
            variant="overline"
            actionLabel="Tümü →"
            onAction={() => router.push('/tabs/tasks' as any)}
          />
          <View style={{ marginBottom: space.sm }}>
            <InlineComposer
              placeholder="Bugüne hızlı görev ekle…"
              onSubmit={async (t) => { await addTask({ title: t, priority: 'none', list_type: 'inbox', due_date: today }); }}
            />
          </View>
          {pendingTasks.length === 0 ? (
            <Card padding="lg">
              <EmptyState
                variant="editorial"
                icon="checkmark-circle-outline"
                title="Bugünün açık işi kalmadı."
                hint="İstersen sıradaki odak bloğunu planla veya haftalık raporu kapat."
                ctaLabel="Görev Ekle"
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

        {/* Telafi rail kartı */}
        <RecoveryRailCard
          plans={recoveryPlans}
          today={today}
          onOpen={() => router.push('/screens/recovery' as any)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { flex: 1 },
  content: { padding: space.xl, paddingBottom: space.hh },

  topActions: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: space.sm },

  ringCard: { flexDirection: 'row', alignItems: 'center', gap: space.lg },
  ringPct: { ...font.metric, fontSize: 18, color: colors.success },
  ringTitle: { ...font.h3, color: colors.text, marginBottom: 3 },
  ringSub: { ...font.bodySm, color: colors.textFaint },

  wpHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md },
  wpHeadText: { ...font.h3, color: colors.text },
  wpHeadHint: { ...font.caption, color: colors.textFaint },

  section: { marginTop: space.xxl },

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
