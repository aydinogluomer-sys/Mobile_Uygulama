import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, ActivityIndicator, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format, startOfWeek, endOfWeek, subWeeks } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { useJournalStore } from '../../store/journalStore';
import { buildArchiveReflection, calculateHabitCompletionRate, focusMinutesFromSessions, reportBadge, type ReportBadge } from '../../lib/reportMetrics';
import { ymdFromIso } from '../../lib/date';
import { fetchWeeklyReview, upsertWeeklyReview } from '../../repositories/reviewRepository';
import { fetchHabitLogsForReview } from '../../repositories/habitLogRepository';
import { fetchFocusSecondsForReview } from '../../repositories/focusSessionRepository';

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
  { key: 'wins', label: '🏆 Bu haftanın kazanımları nelerdi?', placeholder: 'Başardıklarını yaz...' },
  { key: 'challenges', label: '⚡ Hangi zorluklarla karşılaştın?', placeholder: 'Zorlukları ve öğrendiklerini yaz...' },
  { key: 'next_week', label: '🎯 Gelecek hafta odağın ne olacak?', placeholder: 'Önceliklerini yaz...' },
];

export default function WeeklyReviewScreen() {
  const { tasks, fetchTasks } = useTaskStore();
  const { habits, fetchHabits } = useHabitStore();
  const { appendEntry } = useJournalStore();

  const [weekOffset, setWeekOffset] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [habitCompletionRate, setHabitCompletionRate] = useState(0);
  const [focusMinutes, setFocusMinutes] = useState(0);
  const [badge, setBadge] = useState<ReportBadge | null>(null);
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

  useEffect(() => {
    void loadReview();
    void loadWeekMetrics();
  }, [weekOffset, habits.length]);

  async function loadReview() {
    const { data: { user } } = await supabase.auth.getUser();
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
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setHabitCompletionRate(0);
      setFocusMinutes(0);
      setBadge(reportBadge({ habitRate: 0, focusMinutes: 0, completedTasks: completedTasks.length }));
      return;
    }

    const [logsRes, sessionsRes] = await Promise.all([
      fetchHabitLogsForReview({ start, end }),
      fetchFocusSecondsForReview({ start, end }),
    ]);

    const rate = logsRes.ok ? calculateHabitCompletionRate(habits, logsRes.data, start, end) : 0;
    const minutes = sessionsRes.ok ? focusMinutesFromSessions(sessionsRes.data) : 0;
    const nextBadge = reportBadge({ habitRate: rate, focusMinutes: minutes, completedTasks: completedTasks.length });

    setHabitCompletionRate(rate);
    setFocusMinutes(minutes);
    setBadge(nextBadge);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
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
            <Ionicons name="bar-chart-outline" size={28} color="#14b8a6" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.heroTitle}>Haftalık Rapor</Text>
            <Text style={s.heroDates}>{start} - {end}</Text>
          </View>
          <View style={s.weekNav}>
            <TouchableOpacity onPress={() => setWeekOffset((offset) => offset + 1)} style={s.navBtn}>
              <Ionicons name="chevron-back" size={18} color="#BFBBAE" />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setWeekOffset((offset) => Math.max(0, offset - 1))}
              style={[s.navBtn, isCurrentWeek && s.navBtnDisabled]}
              disabled={isCurrentWeek}
            >
              <Ionicons name="chevron-forward" size={18} color={isCurrentWeek ? '#56544B' : '#BFBBAE'} />
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
              <Text style={s.badgeDesc}>{badge.level.toUpperCase()} · Haftalık rapor özeti</Text>
            </View>
          </View>
        )}

        {completedTasks.length > 0 && (
          <View style={s.section}>
            <Text style={s.sectionTitle}>BU HAFTA TAMAMLANANLAR</Text>
            {completedTasks.slice(0, 5).map((task) => (
              <View key={task.id} style={s.taskItem}>
                <Ionicons name="checkmark-circle" size={16} color="#87A678" />
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
          <TouchableOpacity style={[s.saveBtn, saving && s.saveBtnLoading]} onPress={handleSave} disabled={saving}>
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
            <Ionicons name="checkmark-circle" size={16} color="#87A678" />
            <Text style={s.savedBadgeText}>Bu hafta kaydedildi - {savedAt}</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#15140F' },
  content: { padding: 20, paddingBottom: 40 },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 20 },
  heroIcon: { width: 48, height: 48, borderRadius: 14, backgroundColor: '#14b8a620', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 18, fontWeight: '700', color: '#fff' },
  heroDates: { fontSize: 11, color: '#827E72', marginTop: 2 },
  weekNav: { flexDirection: 'row', gap: 4 },
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
  questionCard: { marginBottom: 14 },
  questionLabel: { fontSize: 14, color: '#EDEAE0', fontWeight: '600', marginBottom: 8 },
  questionInput: { backgroundColor: '#1D1C17', borderRadius: 12, padding: 14, fontSize: 14, color: '#fff', borderWidth: 1, borderColor: '#383528', minHeight: 80, textAlignVertical: 'top' },
  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#14b8a6', borderRadius: 14, paddingVertical: 15, marginTop: 8 },
  saveBtnLoading: { opacity: 0.7 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  savedBadge: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: '#87A67810', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#87A67830' },
  savedBadgeText: { fontSize: 13, color: '#87A678' },
});
