import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { useJournalStore } from '../../store/journalStore';
import { colors } from '../../lib/tokens';
import { buildArchiveReflection, calculateHabitCompletionRate, focusMinutesFromSessions, reportBadge, summarizeHabitProgress, type ReportBadge } from '../../lib/reportMetrics';
import { ymdFromIso } from '../../lib/date';

const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const REFLECT_KEY = (monthKey: string) => `monthly_review_${monthKey}`;

const REVIEW_QUESTIONS = [
  { key: 'wins', label: '🏆 Bu ayın kazanımları nelerdi?', placeholder: 'Bu ay başardıklarını yaz...' },
  { key: 'lessons', label: '🧭 Bu ay ne öğrendin / ne işe yaradı?', placeholder: 'Öğrendiklerini yaz...' },
  { key: 'next_month', label: '🎯 Gelecek ay neyi değiştireceksin?', placeholder: 'Bir sonraki ay için önceliklerin...' },
];

export default function MonthlyReviewScreen() {
  const now = new Date();
  const { tasks, fetchTasks } = useTaskStore();
  const { habits, fetchHabits } = useHabitStore();
  const { appendEntry } = useJournalStore();

  const [monthOffset, setMonthOffset] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [habitCompletionRate, setHabitCompletionRate] = useState(0);
  const [focusMinutes, setFocusMinutes] = useState(0);
  const [habitStats, setHabitStats] = useState<{ id: string; name: string; color: string; percent: number; completedDays: number; possibleDays: number }[]>([]);
  const [badge, setBadge] = useState<ReportBadge | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const targetDate = subMonths(now, monthOffset);
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const monthKey = format(targetDate, 'yyyy-MM');
  const start = format(startOfMonth(targetDate), 'yyyy-MM-dd');
  const end = format(endOfMonth(targetDate), 'yyyy-MM-dd');
  const isCurrentMonth = monthOffset === 0;

  const monthTasks = tasks.filter((task) => {
    const day = ymdFromIso(task.completed_at ?? task.created_at);
    return day >= start && day <= end;
  });
  const completedTasks = monthTasks.filter((task) => task.completed);
  const activeHabits = habits.filter((habit) => habit.status === 'active');

  useEffect(() => {
    fetchTasks();
    fetchHabits();
  }, [fetchTasks, fetchHabits]);

  useEffect(() => {
    void loadReflection();
    void loadMonthMetrics();
  }, [monthOffset, habits.length]);

  async function loadReflection() {
    try {
      const raw = await AsyncStorage.getItem(REFLECT_KEY(monthKey));
      if (raw) {
        const parsed = JSON.parse(raw);
        setAnswers(parsed.answers ?? {});
        setSavedAt(parsed.savedAt ?? null);
      } else {
        setAnswers({});
        setSavedAt(null);
      }
    } catch {
      setAnswers({});
      setSavedAt(null);
    }
  }

  async function loadMonthMetrics() {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setHabitCompletionRate(0);
      setFocusMinutes(0);
      setHabitStats([]);
      setBadge(reportBadge({ habitRate: 0, focusMinutes: 0, completedTasks: completedTasks.length }));
      return;
    }

    const [logsRes, sessionsRes] = await Promise.all([
      supabase
        .from('habit_logs')
        .select('habit_id, completed_at, state, value')
        .eq('user_id', user.id)
        .gte('completed_at', start)
        .lte('completed_at', `${end}T23:59:59`)
        .in('state', ['done', 'partial', 'miss', 'skip']),
      supabase
        .from('focus_sessions')
        .select('completed_seconds')
        .eq('user_id', user.id)
        .gte('started_at', start)
        .lte('started_at', `${end}T23:59:59`),
    ]);

    const rate = logsRes.data ? calculateHabitCompletionRate(habits, logsRes.data as any, start, end) : 0;
    const minutes = sessionsRes.data ? focusMinutesFromSessions(sessionsRes.data as any) : 0;
    const nextBadge = reportBadge({ habitRate: rate, focusMinutes: minutes, completedTasks: completedTasks.length });

    setHabitCompletionRate(rate);
    setFocusMinutes(minutes);
    setBadge(nextBadge);

    const stats = summarizeHabitProgress(habits, (logsRes.data ?? []) as any, start, end).map((row) => ({
      id: row.id,
      name: row.name,
      color: row.color,
      percent: row.percent,
      completedDays: row.completedDays,
      possibleDays: row.possibleDays,
    }));
    setHabitStats(stats);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const stamp = format(new Date(), 'dd.MM.yyyy');
      await AsyncStorage.setItem(REFLECT_KEY(monthKey), JSON.stringify({ answers, savedAt: stamp }));
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

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
          <View style={s.hero}>
            <View style={s.heroIcon}>
              <Ionicons name="calendar-number-outline" size={28} color="#D97757" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroTitle}>Aylık Rapor</Text>
              <Text style={s.heroDates}>{MONTHS_TR[month]} {year}</Text>
            </View>
            <View style={s.monthNav}>
              <TouchableOpacity onPress={() => setMonthOffset((offset) => offset + 1)} style={s.navBtn}>
                <Ionicons name="chevron-back" size={18} color="#BFBBAE" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMonthOffset((offset) => Math.max(0, offset - 1))}
                style={[s.navBtn, isCurrentMonth && s.navBtnDisabled]}
                disabled={isCurrentMonth}
              >
                <Ionicons name="chevron-forward" size={18} color={isCurrentMonth ? '#56544B' : '#BFBBAE'} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.metricsRow}>
            <View style={s.metric}>
              <Text style={s.metricValue}>{completedTasks.length}</Text>
              <Text style={s.metricLabel}>Görev{'\n'}Tamamlandı</Text>
            </View>
            <View style={s.metric}>
              <Text style={[s.metricValue, { color: '#87A678' }]}>{habitCompletionRate}%</Text>
              <Text style={s.metricLabel}>Alışkanlık{'\n'}Oran</Text>
            </View>
            <View style={s.metric}>
              <Text style={[s.metricValue, { color: '#D97757' }]}>{focusMinutes}</Text>
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
                <Text style={s.badgeDesc}>{badge.level.toUpperCase()} · Aylık rapor özeti</Text>
              </View>
            </View>
          )}

          {completedTasks.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>BU AY TAMAMLANANLAR</Text>
              {completedTasks.slice(0, 6).map((task) => (
                <View key={task.id} style={s.taskItem}>
                  <Ionicons name="checkmark-circle" size={16} color="#87A678" />
                  <Text style={s.taskTitle} numberOfLines={1}>{task.title}</Text>
                </View>
              ))}
              {completedTasks.length > 6 && <Text style={s.moreText}>+{completedTasks.length - 6} daha...</Text>}
            </View>
          )}

          {habitStats.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>ALIŞKANLIK PERFORMANSI</Text>
              {habitStats.slice(0, 6).map((habit, index) => {
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
              })}
            </View>
          )}

          <View style={s.section}>
            <Text style={s.sectionTitle}>AYLIK YANSIMA</Text>
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
                  textAlignVertical="top"
                />
              </View>
            ))}
          </View>

          <TouchableOpacity style={[s.saveBtn, saving && s.saveBtnLoading]} onPress={handleSave} disabled={saving}>
            {saving ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : savedAt ? (
              <>
                <Ionicons name="checkmark" size={18} color="#fff" />
                <Text style={s.saveBtnText}>Kaydedildi ({savedAt})</Text>
              </>
            ) : (
              <Text style={s.saveBtnText}>Aylık Raporu Kaydet</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#15140F' },
  content: { padding: 20, paddingBottom: 40 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  heroIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#D9775720', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  heroDates: { fontSize: 12, color: '#827E72', marginTop: 2 },
  monthNav: { flexDirection: 'row', gap: 4 },
  navBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#1D1C17', borderWidth: 1, borderColor: '#383528', alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.3 },
  metricsRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  metric: { flex: 1, backgroundColor: '#1D1C17', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#383528', alignItems: 'center' },
  metricValue: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 4 },
  metricLabel: { fontSize: 10, color: '#827E72', textAlign: 'center', lineHeight: 14 },
  badgeCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#1D1C17', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#383528', marginBottom: 24 },
  badgeEmoji: { fontSize: 20 },
  badgeTitle: { fontSize: 14, fontWeight: '700', color: '#fff' },
  badgeDesc: { fontSize: 11, color: '#827E72', marginTop: 2 },
  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#827E72', letterSpacing: 1, marginBottom: 10 },
  taskItem: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#1D1C17', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#383528', marginBottom: 6 },
  taskTitle: { flex: 1, fontSize: 14, color: '#BFBBAE' },
  moreText: { fontSize: 12, color: '#56544B', paddingLeft: 4, marginTop: 4 },
  habitRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  medal: { fontSize: 16, width: 22 },
  habitDot: { width: 8, height: 8, borderRadius: 4 },
  habitName: { width: 84, fontSize: 13, color: '#EDEAE0' },
  habitBarWrap: { flex: 1 },
  habitBarBg: { height: 5, backgroundColor: '#28261F', borderRadius: 3 },
  habitBarFill: { height: 5, borderRadius: 3 },
  habitCount: { fontSize: 11, color: '#827E72', minWidth: 40, textAlign: 'right' },
  questionCard: { marginBottom: 14 },
  questionLabel: { fontSize: 14, color: '#EDEAE0', fontWeight: '600', marginBottom: 8 },
  questionInput: { backgroundColor: '#1D1C17', borderRadius: 12, padding: 14, fontSize: 14, color: '#fff', borderWidth: 1, borderColor: '#383528', minHeight: 80, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#D97757', borderRadius: 14, paddingVertical: 15, marginTop: 4 },
  saveBtnLoading: { opacity: 0.7 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
