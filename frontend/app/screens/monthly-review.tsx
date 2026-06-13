import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import { useLogStore } from '../../store/logStore';
import { useHabitStore } from '../../store/habitStore';
import MonthBackground from '../../components/MonthBackground';
import GlassPanel from '../../components/ui/GlassPanel';
import { colors, hexA } from '../../lib/tokens';

const MONTHS_TR = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const DAYS_SHORT = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfWeek(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

export default function MonthlyReviewScreen() {
  const headerHeight = useHeaderHeight();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [reflection, setReflection] = useState('');

  const { logs } = useLogStore();
  const { habits } = useHabitStore();

  const activeHabits = habits.filter((h) => h.status === 'active');
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);

  const monthLogs = logs.filter((l) => l.completed_at?.startsWith(monthPrefix));
  const doneLogs = monthLogs.filter((l) => l.state === 'done' || l.state === 'partial');
  const missedLogs = monthLogs.filter((l) => l.state === 'miss');

  // Aktif alışkanlık başına aylık tamamlama sayısı
  const habitStats = activeHabits.map((h) => {
    const count = doneLogs.filter((l) => l.habit_id === h.id).length;
    return { habit: h, count };
  }).sort((a, b) => b.count - a.count);

  // Günlük aktivite map
  const activityMap: Record<string, number> = {};
  doneLogs.forEach((l) => {
    activityMap[l.completed_at] = (activityMap[l.completed_at] ?? 0) + 1;
  });

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
    if (isCurrentMonth) return;
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  function dateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function dotColor(day: number) {
    const count = activityMap[dateStr(day)] ?? 0;
    if (count === 0) return hexA(colors.border, 0.7);
    if (count === 1) return '#0e4429';
    if (count === 2) return '#006d32';
    if (count === 3) return '#26a641';
    return '#39d353';
  }

  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth();
  const totalPossible = activeHabits.length * daysInMonth;
  const completionRate = totalPossible > 0 ? Math.round((doneLogs.length / totalPossible) * 100) : 0;

  return (
    <View style={s.root}>
      {/* Görünen aya göre değişen, tam-ekran mevsimsel arka plan */}
      <MonthBackground month={month} scrim={0.5} />

      <SafeAreaView style={s.safe} edges={['bottom']}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={[s.content, { paddingTop: headerHeight + 8 }]} keyboardShouldPersistTaps="handled">

            {/* Ana rapor paneli: ay seçici + özet + ısı haritası */}
            <GlassPanel style={s.block} tintAlpha={0.55}>
              {/* Ay seçici */}
              <View style={s.monthNav}>
                <TouchableOpacity style={s.navBtn} onPress={prevMonth}>
                  <Ionicons name="chevron-back" size={20} color={colors.textDim} />
                </TouchableOpacity>
                <Text style={s.monthTitle}>{MONTHS_TR[month]} {year}</Text>
                <TouchableOpacity style={[s.navBtn, isCurrentMonth && s.navBtnDisabled]} onPress={nextMonth}>
                  <Ionicons name="chevron-forward" size={20} color={isCurrentMonth ? colors.border : colors.textDim} />
                </TouchableOpacity>
              </View>

              {/* Özet kartlar */}
              <View style={s.summaryRow}>
                <View style={s.summaryCard}>
                  <Text style={[s.summaryValue, { color: colors.success }]}>{doneLogs.length}</Text>
                  <Text style={s.summaryLabel}>Tamamlanan</Text>
                </View>
                <View style={s.summaryCard}>
                  <Text style={[s.summaryValue, { color: colors.error }]}>{missedLogs.length}</Text>
                  <Text style={s.summaryLabel}>Kaçırılan</Text>
                </View>
                <View style={s.summaryCard}>
                  <Text style={[s.summaryValue, { color: colors.primary }]}>%{completionRate}</Text>
                  <Text style={s.summaryLabel}>Başarı</Text>
                </View>
              </View>

              {/* Aylık takvim ısı haritası */}
              <Text style={s.sectionTitle}>AYLIK AKTİVİTE</Text>
              <View style={s.dayHeaders}>
                {DAYS_SHORT.map((d) => (
                  <Text key={d} style={s.dayHeader}>{d}</Text>
                ))}
              </View>
              <View style={s.grid}>
                {Array.from({ length: firstDay }).map((_, i) => (
                  <View key={`e-${i}`} style={s.cell} />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                  const isToday = isCurrentMonth && day === now.getDate();
                  const color = dotColor(day);
                  return (
                    <View key={day} style={[s.cell, s.dayCell, { backgroundColor: color }, isToday && s.todayCell]}>
                      <Text style={[s.dayNum, isToday && s.todayNum]}>{day}</Text>
                    </View>
                  );
                })}
              </View>
            </GlassPanel>

            {/* En iyi alışkanlıklar */}
            {habitStats.length > 0 && (
              <GlassPanel style={s.block}>
                <Text style={s.sectionTitle}>ALIŞKANLIK PERFORMANSI</Text>
                {habitStats.slice(0, 5).map(({ habit, count }, i) => {
                  const pct = daysInMonth > 0 ? Math.round((count / daysInMonth) * 100) : 0;
                  const medals = ['🥇', '🥈', '🥉'];
                  return (
                    <View key={habit.id} style={s.habitRow}>
                      <Text style={s.medal}>{medals[i] ?? ''}</Text>
                      <View style={[s.habitDot, { backgroundColor: habit.color ?? colors.primary }]} />
                      <Text style={s.habitName} numberOfLines={1}>{habit.name}</Text>
                      <View style={s.habitBarWrap}>
                        <View style={s.habitBarBg}>
                          <View style={[s.habitBarFill, { width: `${pct}%` as any, backgroundColor: habit.color ?? colors.primary }]} />
                        </View>
                      </View>
                      <Text style={s.habitCount}>{count}/{daysInMonth}</Text>
                    </View>
                  );
                })}
              </GlassPanel>
            )}

            {/* Refleksiyon */}
            <GlassPanel style={s.blockLast}>
              <Text style={s.sectionTitle}>AYLIK REFLEKSIYON</Text>
              <Text style={s.reflectPrompt}>Bu ay ne işe yaradı? Bir sonraki ay için ne değiştirirsin?</Text>
              <TextInput
                style={s.reflectInput}
                placeholder="Düşüncelerini yaz..."
                placeholderTextColor={colors.textGhost}
                multiline
                value={reflection}
                onChangeText={setReflection}
                textAlignVertical="top"
              />
            </GlassPanel>

          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingBottom: 40 },

  block: { marginBottom: 16 },
  blockLast: { marginBottom: 0 },

  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: hexA(colors.surface, 0.85), borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  navBtnDisabled: { opacity: 0.3 },
  monthTitle: { fontSize: 20, fontWeight: '700', color: colors.white },

  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  summaryCard: { flex: 1, backgroundColor: hexA(colors.bgSunk, 0.4), borderRadius: 12, padding: 14, borderWidth: 1, borderColor: hexA(colors.white, 0.06), alignItems: 'center' },
  summaryValue: { fontSize: 24, fontWeight: '700', marginBottom: 2 },
  summaryLabel: { fontSize: 11, color: colors.textFaint },

  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textDim, letterSpacing: 1, marginBottom: 12 },
  dayHeaders: { flexDirection: 'row', marginBottom: 6 },
  dayHeader: { flex: 1, textAlign: 'center', fontSize: 10, color: colors.textFaint, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%` as any, aspectRatio: 1, padding: 2 },
  dayCell: { borderRadius: 6, alignItems: 'center', justifyContent: 'center', margin: 1.5 },
  todayCell: { borderWidth: 1.5, borderColor: colors.primary },
  dayNum: { fontSize: 11, color: colors.textDim },
  todayNum: { color: colors.white, fontWeight: '700' },

  habitRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  medal: { fontSize: 16, width: 24 },
  habitDot: { width: 8, height: 8, borderRadius: 4 },
  habitName: { width: 90, fontSize: 13, color: colors.text },
  habitBarWrap: { flex: 1 },
  habitBarBg: { height: 5, backgroundColor: hexA(colors.border, 0.9), borderRadius: 3 },
  habitBarFill: { height: 5, borderRadius: 3 },
  habitCount: { fontSize: 11, color: colors.textFaint, minWidth: 38, textAlign: 'right' },

  reflectPrompt: { fontSize: 13, color: colors.textDim, fontStyle: 'italic', marginBottom: 12 },
  reflectInput: { fontSize: 14, color: colors.text, minHeight: 120, lineHeight: 22 },
});
