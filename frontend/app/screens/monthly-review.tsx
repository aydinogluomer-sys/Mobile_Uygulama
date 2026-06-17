import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { format, startOfMonth, endOfMonth, subMonths } from 'date-fns';
import { supabase } from '../../lib/supabase';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { colors } from '../../lib/tokens';

const MONTHS_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

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

  const [monthOffset, setMonthOffset] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [habitCompletionRate, setHabitCompletionRate] = useState<number | null>(null);
  const [focusCount, setFocusCount] = useState<number | null>(null);
  const [habitStats, setHabitStats] = useState<{ id: string; name: string; color: string; count: number }[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const targetDate = subMonths(now, monthOffset);
  const year = targetDate.getFullYear();
  const month = targetDate.getMonth();
  const monthKey = format(targetDate, 'yyyy-MM');
  const start = format(startOfMonth(targetDate), 'yyyy-MM-dd');
  const end = format(endOfMonth(targetDate), 'yyyy-MM-dd');
  const daysInMonth = endOfMonth(targetDate).getDate();
  const isCurrentMonth = monthOffset === 0;

  useEffect(() => {
    fetchTasks();
    fetchHabits();
  }, []);

  useEffect(() => {
    loadReflection();
    loadMonthMetrics();
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
    if (!user) return;

    const [logsRes, sessionsRes] = await Promise.all([
      supabase
        .from('habit_logs')
        .select('habit_id, completed_at, state')
        .eq('user_id', user.id)
        .gte('completed_at', start)
        .lte('completed_at', end)
        .in('state', ['done', 'partial']),
      supabase
        .from('focus_sessions')
        .select('id')
        .eq('user_id', user.id)
        .gte('started_at', start)
        .lte('started_at', end + 'T23:59:59'),
    ]);

    const activeHabits = habits.filter((h) => h.status === 'active');

    if (logsRes.data) {
      const possible = activeHabits.length * daysInMonth;
      const rate = possible > 0 ? Math.round((logsRes.data.length / possible) * 100) : 0;
      setHabitCompletionRate(Math.min(rate, 100));

      // Alışkanlık başına tamamlama sayısı
      const counts: Record<string, number> = {};
      logsRes.data.forEach((l: any) => { counts[l.habit_id] = (counts[l.habit_id] ?? 0) + 1; });
      const stats = activeHabits
        .map((h) => ({ id: h.id, name: h.name, color: h.color ?? colors.primary, count: counts[h.id] ?? 0 }))
        .sort((a, b) => b.count - a.count);
      setHabitStats(stats);
    }
    if (sessionsRes.data) setFocusCount(sessionsRes.data.length);
  }

  const monthTasks = tasks.filter((t) => {
    const d = (t.completed_at ?? t.created_at ?? '').split('T')[0];
    return d >= start && d <= end;
  });
  const completedTasks = monthTasks.filter((t) => t.completed);
  const activeHabits = habits.filter((h) => h.status === 'active');

  async function handleSave() {
    setSaving(true);
    try {
      const stamp = format(new Date(), 'dd.MM.yyyy');
      await AsyncStorage.setItem(REFLECT_KEY(monthKey), JSON.stringify({ answers, savedAt: stamp }));
      setSavedAt(stamp);
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">

          {/* Başlık + ay seçici */}
          <View style={s.hero}>
            <View style={s.heroIcon}>
              <Ionicons name="calendar-number-outline" size={28} color="#D97757" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.heroTitle}>Aylık Rapor</Text>
              <Text style={s.heroDates}>{MONTHS_TR[month]} {year}</Text>
            </View>
            <View style={s.monthNav}>
              <TouchableOpacity onPress={() => setMonthOffset((o) => o + 1)} style={s.navBtn}>
                <Ionicons name="chevron-back" size={18} color="#BFBBAE" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMonthOffset((o) => Math.max(0, o - 1))}
                style={[s.navBtn, isCurrentMonth && s.navBtnDisabled]}
                disabled={isCurrentMonth}
              >
                <Ionicons name="chevron-forward" size={18} color={isCurrentMonth ? '#56544B' : '#BFBBAE'} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Metrik özeti */}
          <View style={s.metricsRow}>
            <View style={s.metric}>
              <Text style={s.metricValue}>{completedTasks.length}</Text>
              <Text style={s.metricLabel}>Görev{'\n'}Tamamlandı</Text>
            </View>
            <View style={s.metric}>
              <Text style={[s.metricValue, { color: '#87A678' }]}>
                {habitCompletionRate !== null ? `${habitCompletionRate}%` : '—'}
              </Text>
              <Text style={s.metricLabel}>Alışkanlık{'\n'}Oran</Text>
            </View>
            <View style={s.metric}>
              <Text style={[s.metricValue, { color: '#D97757' }]}>
                {focusCount !== null ? focusCount : '—'}
              </Text>
              <Text style={s.metricLabel}>Odak{'\n'}Seansı</Text>
            </View>
            <View style={s.metric}>
              <Text style={s.metricValue}>{activeHabits.length}</Text>
              <Text style={s.metricLabel}>Aktif{'\n'}Alışkanlık</Text>
            </View>
          </View>

          {/* Bu ay tamamlananlar */}
          {completedTasks.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>BU AY TAMAMLANANLAR</Text>
              {completedTasks.slice(0, 6).map((t) => (
                <View key={t.id} style={s.taskItem}>
                  <Ionicons name="checkmark-circle" size={16} color="#87A678" />
                  <Text style={s.taskTitle} numberOfLines={1}>{t.title}</Text>
                </View>
              ))}
              {completedTasks.length > 6 && (
                <Text style={s.moreText}>+{completedTasks.length - 6} daha...</Text>
              )}
            </View>
          )}

          {/* Alışkanlık performansı */}
          {habitStats.length > 0 && (
            <View style={s.section}>
              <Text style={s.sectionTitle}>ALIŞKANLIK PERFORMANSI</Text>
              {habitStats.slice(0, 6).map((h, i) => {
                const pct = daysInMonth > 0 ? Math.round((h.count / daysInMonth) * 100) : 0;
                const medals = ['🥇', '🥈', '🥉'];
                return (
                  <View key={h.id} style={s.habitRow}>
                    <Text style={s.medal}>{medals[i] ?? ''}</Text>
                    <View style={[s.habitDot, { backgroundColor: h.color }]} />
                    <Text style={s.habitName} numberOfLines={1}>{h.name}</Text>
                    <View style={s.habitBarWrap}>
                      <View style={s.habitBarBg}>
                        <View style={[s.habitBarFill, { width: `${pct}%` as any, backgroundColor: h.color }]} />
                      </View>
                    </View>
                    <Text style={s.habitCount}>{h.count}/{daysInMonth}</Text>
                  </View>
                );
              })}
            </View>
          )}

          {/* Aylık yansıma — kaydedilir */}
          <View style={s.section}>
            <Text style={s.sectionTitle}>AYLIK YANSIMA</Text>
            {REVIEW_QUESTIONS.map((q) => (
              <View key={q.key} style={s.questionCard}>
                <Text style={s.questionLabel}>{q.label}</Text>
                <TextInput
                  style={s.questionInput}
                  placeholder={q.placeholder}
                  placeholderTextColor="#56544B"
                  multiline
                  value={answers[q.key] ?? ''}
                  onChangeText={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))}
                  textAlignVertical="top"
                />
              </View>
            ))}
          </View>

          {/* Kaydet */}
          <TouchableOpacity
            style={[s.saveBtn, saving && s.saveBtnLoading]}
            onPress={handleSave}
            disabled={saving}
          >
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

  metricsRow: { flexDirection: 'row', gap: 8, marginBottom: 24 },
  metric: { flex: 1, backgroundColor: '#1D1C17', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#383528', alignItems: 'center' },
  metricValue: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 4 },
  metricLabel: { fontSize: 10, color: '#827E72', textAlign: 'center', lineHeight: 14 },

  section: { marginBottom: 24 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: '#827E72', letterSpacing: 1, marginBottom: 10 },

  taskItem: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1D1C17', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: '#383528', marginBottom: 6,
  },
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
  questionInput: {
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 14, fontSize: 14,
    color: '#fff', borderWidth: 1, borderColor: '#383528', minHeight: 80,
    textAlignVertical: 'top',
  },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#D97757', borderRadius: 14, paddingVertical: 15, marginTop: 4,
  },
  saveBtnLoading: { opacity: 0.7 },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: '#fff' },
});
