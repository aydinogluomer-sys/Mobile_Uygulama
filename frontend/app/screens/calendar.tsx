import { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import MonthBackground from '../../components/MonthBackground';
import GlassPanel from '../../components/ui/GlassPanel';
import { colors, hexA } from '../../lib/tokens';

const DAYS_SHORT = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];
const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Pazartesi = 0
}

export default function CalendarScreen() {
  const headerHeight = useHeaderHeight();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState(today.toISOString().split('T')[0]);

  const { tasks, fetchTasks } = useTaskStore();
  const { habits, fetchHabits } = useHabitStore();
  const { fetchLogsForDate, logs } = useLogStore();

  useEffect(() => { fetchTasks(); fetchHabits(); }, []);
  useEffect(() => { if (selected) fetchLogsForDate(selected); }, [selected]);

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const todayStr = today.toISOString().split('T')[0];

  function dateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function hasTask(day: number) {
    const d = dateStr(day);
    return tasks.some((t) => t.due_date?.startsWith(d));
  }

  const selectedTasks = tasks.filter((t) => t.due_date?.startsWith(selected) && !t.completed);
  const selectedHabitLogs = habits.filter((h) => h.status === 'active');

  return (
    <View style={s.root}>
      {/* Görünen aya göre değişen, tam-ekran mevsimsel arka plan (crossfade'li) */}
      <MonthBackground month={month} />

      <SafeAreaView style={s.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={[s.content, { paddingTop: headerHeight + 8 }]}>
          {/* Takvim paneli — ay navigasyonu + gün başlıkları + ızgara, cam üzerinde */}
          <GlassPanel style={s.panel}>
            <View style={s.monthNav}>
              <TouchableOpacity style={s.navBtn} onPress={prevMonth}>
                <Ionicons name="chevron-back" size={20} color={colors.textDim} />
              </TouchableOpacity>
              <Text style={s.monthTitle}>{MONTHS[month]} {year}</Text>
              <TouchableOpacity style={s.navBtn} onPress={nextMonth}>
                <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
              </TouchableOpacity>
            </View>

            <View style={s.weekRow}>
              {DAYS_SHORT.map((d) => (
                <Text key={d} style={s.dayHeader}>{d}</Text>
              ))}
            </View>

            <View style={s.grid}>
              {Array.from({ length: firstDay }).map((_, i) => (
                <View key={`empty-${i}`} style={s.dayCell} />
              ))}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                const ds = dateStr(day);
                const isToday = ds === todayStr;
                const isSelected = ds === selected;
                const hasDot = hasTask(day);
                return (
                  <TouchableOpacity
                    key={day}
                    style={[s.dayCell, isSelected && s.dayCellSelected, isToday && !isSelected && s.dayCellToday]}
                    onPress={() => setSelected(ds)}
                  >
                    <Text style={[s.dayText, isSelected && s.dayTextSelected, isToday && !isSelected && s.dayTextToday]}>
                      {day}
                    </Text>
                    {hasDot && <View style={[s.dot, isSelected && s.dotSelected]} />}
                  </TouchableOpacity>
                );
              })}
            </View>
          </GlassPanel>

          {/* Seçili gün görevleri */}
          <GlassPanel style={s.panel}>
            <Text style={s.sectionTitle}>
              {selected === todayStr ? 'BUGÜN' : selected} — GÖREVLER
            </Text>
            {selectedTasks.length === 0 ? (
              <Text style={s.noItem}>Bu gün için görev yok</Text>
            ) : (
              selectedTasks.map((t) => (
                <View key={t.id} style={s.item}>
                  <View style={[s.priorityDot, { backgroundColor: t.priority === 'high' ? colors.error : t.priority === 'medium' ? colors.warning : colors.success }]} />
                  <Text style={s.itemText}>{t.title}</Text>
                </View>
              ))
            )}
          </GlassPanel>

          {/* Seçili gün alışkanlıkları */}
          <GlassPanel style={s.panelLast}>
            <Text style={s.sectionTitle}>AKTIF ALIŞKANLIKLAR</Text>
            {selectedHabitLogs.length === 0 ? (
              <Text style={s.noItem}>Aktif alışkanlık yok</Text>
            ) : (
              selectedHabitLogs.slice(0, 5).map((h) => (
                <View key={h.id} style={s.item}>
                  <Ionicons name={(h.icon ?? 'star-outline') as any} size={14} color={h.color ?? colors.primary} />
                  <Text style={s.itemText}>{h.name}</Text>
                </View>
              ))
            )}
          </GlassPanel>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingBottom: 40 },

  panel: { marginBottom: 16 },
  panelLast: { marginBottom: 0 },

  monthNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  navBtn: { width: 36, height: 36, borderRadius: 10, backgroundColor: hexA(colors.surface, 0.85), alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  monthTitle: { fontSize: 18, fontWeight: '700', color: colors.white },

  weekRow: { flexDirection: 'row', marginBottom: 8 },
  dayHeader: { flex: 1, textAlign: 'center', fontSize: 11, color: colors.textDim, fontWeight: '600' },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: { width: `${100/7}%` as any, aspectRatio: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  dayCellSelected: { backgroundColor: colors.primary, borderRadius: 10 },
  dayCellToday: { borderWidth: 1, borderColor: colors.primary, borderRadius: 10 },
  dayText: { fontSize: 14, color: colors.text },
  dayTextSelected: { color: colors.white, fontWeight: '700' },
  dayTextToday: { color: colors.primary, fontWeight: '700' },
  dot: { width: 4, height: 4, borderRadius: 2, backgroundColor: colors.primary },
  dotSelected: { backgroundColor: hexA(colors.white, 0.5) },

  sectionTitle: { fontSize: 11, fontWeight: '700', color: colors.textDim, letterSpacing: 1, marginBottom: 10 },
  noItem: { fontSize: 13, color: colors.textFaint, fontStyle: 'italic' },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: hexA(colors.surface, 0.7), borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: hexA(colors.border, 0.8), marginBottom: 6,
  },
  priorityDot: { width: 8, height: 8, borderRadius: 4 },
  itemText: { fontSize: 14, color: colors.text, flex: 1 },
});
