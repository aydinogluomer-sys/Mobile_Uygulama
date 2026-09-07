import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useIsFocused } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { useLogStore } from '../../store/logStore';
import MonthBackground from '../../components/MonthBackground';
import SeasonalMotionPreview from '../../components/seasonalMotion/SeasonalMotionPreview';
import { useReducedMotion } from '../../components/seasonalMotion/useReducedMotion';
import { MONTH_TAGLINES_TR } from '../../components/seasonalMotion/config';
import GlassPanel from '../../components/ui/GlassPanel';
import { colors, hexA } from '../../lib/tokens';
import { ymd } from '../../lib/date';

const DAYS_SHORT = ['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];
const MONTHS = ['Ocak','Şubat','Mart','Nisan','Mayıs','Haziran','Temmuz','Ağustos','Eylül','Ekim','Kasım','Aralık'];
const MONTH_TAGLINES = MONTH_TAGLINES_TR;

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1; // Pazartesi = 0
}

export default function CalendarScreen() {
  const headerHeight = useHeaderHeight();
  const isFocused = useIsFocused();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [selected, setSelected] = useState(ymd(today));
  const [showMotionPreview, setShowMotionPreview] = useState(false);

  const { tasks, fetchTasks } = useTaskStore();
  const { habits, fetchHabits } = useHabitStore();
  const { fetchLogsForDate } = useLogStore();

  // Defter sayfası animasyonu: girişte "açılma", ay değişiminde yön bazlı "sayfa çevirme".
  const reduceMotion = useReducedMotion();
  const pageAnim = useRef(new Animated.Value(1)).current;
  const [flipDir, setFlipDir] = useState(0); // -1 önceki, 0 açılış, +1 sonraki

  function animatePage(dir: number) {
    setFlipDir(dir);
    if (reduceMotion) { pageAnim.setValue(1); return; } // erişilebilirlik: animasyon yok
    pageAnim.setValue(0);
    Animated.timing(pageAnim, {
      toValue: 1,
      duration: dir === 0 ? 480 : 430,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }

  useEffect(() => { fetchTasks(); fetchHabits(); }, [fetchTasks, fetchHabits]);
  useEffect(() => { if (selected) fetchLogsForDate(selected); }, [selected, fetchLogsForDate]);
  // Ekran odağa gelince defter "açılır"
  useEffect(() => { if (isFocused) animatePage(0); }, [isFocused]); // eslint-disable-line react-hooks/exhaustive-deps

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
    animatePage(-1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
    animatePage(1);
  }

  // Sayfa-çevirme stili (native driver: rotateY + translateX + opacity; sol cilt menteşesi)
  const pageStyle = {
    opacity: pageAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }),
    transformOrigin: 'left center' as const,
    transform: [
      { perspective: 900 },
      { rotateY: pageAnim.interpolate({ inputRange: [0, 1], outputRange: [`${(flipDir === 0 ? 10 : flipDir * 16)}deg`, '0deg'] }) },
      { translateX: pageAnim.interpolate({ inputRange: [0, 1], outputRange: [flipDir * 26, 0] }) },
    ],
  };

  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  const todayStr = ymd(today);

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
      {/* Görünen aya göre değişen, tam-ekran mevsimsel arka plan (crossfade'li + ambient hareket) */}
      <MonthBackground month={month} active={isFocused} />

      <SafeAreaView style={s.safe} edges={['bottom']}>
        <ScrollView contentContainerStyle={[s.content, { paddingTop: headerHeight + 8 }]}>
          {/* Defter sayfası — giriş "açılma" + ay değişiminde sayfa çevirme animasyonu */}
          <Animated.View style={pageStyle}>
          {/* Ajanda kapak başlığı — cam YOK; mevsim sahnesi + hareketi burada açıkça görünür */}
          <View style={s.hero}>
            <View style={s.heroNavRow}>
              <TouchableOpacity style={s.heroArrow} onPress={prevMonth} accessibilityRole="button" accessibilityLabel="Önceki ay">
                <Ionicons name="chevron-back" size={22} color={colors.white} />
              </TouchableOpacity>
              <Text style={s.heroMonth} accessibilityRole="header">{MONTHS[month]}</Text>
              <TouchableOpacity style={s.heroArrow} onPress={nextMonth} accessibilityRole="button" accessibilityLabel="Sonraki ay">
                <Ionicons name="chevron-forward" size={22} color={colors.white} />
              </TouchableOpacity>
            </View>
            <Text style={s.heroYear}>{year}</Text>
            <Text style={s.heroTagline}>{MONTH_TAGLINES[month]}</Text>
          </View>

          {/* Takvim paneli — gün başlıkları + ızgara, cam üzerinde */}
          <GlassPanel style={s.panel}>
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
                    accessibilityRole="button"
                    accessibilityLabel={`${day} ${MONTHS[month]} ${year}${isToday ? ', bugün' : ''}${hasDot ? ', görev var' : ''}`}
                    accessibilityState={{ selected: isSelected }}
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
          </Animated.View>

          {/* Seçili gün görevleri */}
          <GlassPanel style={s.panel}>
            <Text style={s.sectionTitle} accessibilityRole="header">
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
            <Text style={s.sectionTitle} accessibilityRole="header">AKTIF ALIŞKANLIKLAR</Text>
            {selectedHabitLogs.length === 0 ? (
              <Text style={s.noItem}>Aktif alışkanlık yok</Text>
            ) : (
              selectedHabitLogs.slice(0, 5).map((h) => (
                <View key={h.id} style={s.item}>
                  <Ionicons name={(h.icon ?? 'star-outline') as any} size={14} color={h.color ?? colors.primary} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                  <Text style={s.itemText}>{h.name}</Text>
                </View>
              ))
            )}
          </GlassPanel>
        </ScrollView>
      </SafeAreaView>

      {/* DEV: mevsimsel hareket önizleme (yalnızca geliştirme) */}
      {__DEV__ && (
        <>
          <TouchableOpacity
            style={s.devBtn}
            onPress={() => setShowMotionPreview(true)}
            accessibilityRole="button"
            accessibilityLabel="Mevsimsel hareket önizlemesi"
          >
            <Ionicons name="sparkles-outline" size={16} color={colors.white} />
          </TouchableOpacity>
          <SeasonalMotionPreview visible={showMotionPreview} onClose={() => setShowMotionPreview(false)} />
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, backgroundColor: 'transparent' },
  content: { padding: 16, paddingBottom: 40 },

  panel: { marginBottom: 16 },
  panelLast: { marginBottom: 0 },

  // Ajanda kapak başlığı (cam yok → mevsim sahnesi/hareket görünür)
  hero: { minHeight: 156, alignItems: 'center', justifyContent: 'center', paddingVertical: 22, marginBottom: 6 },
  heroNavRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
  heroArrow: {
    width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center',
    backgroundColor: hexA(colors.bgSunk, 0.32), borderWidth: 1, borderColor: hexA(colors.white, 0.15),
  },
  heroMonth: {
    fontSize: 40, fontWeight: '800', color: colors.white, letterSpacing: 0.5,
    minWidth: 172, textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.55)', textShadowRadius: 10, textShadowOffset: { width: 0, height: 2 },
  },
  heroYear: {
    fontSize: 15, fontWeight: '600', color: hexA(colors.white, 0.82), marginTop: 4, letterSpacing: 3,
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6,
  },
  heroTagline: {
    fontSize: 13, color: hexA(colors.white, 0.85), marginTop: 8, fontStyle: 'italic', textAlign: 'center',
    textShadowColor: 'rgba(0,0,0,0.5)', textShadowRadius: 6,
  },

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

  devBtn: {
    position: 'absolute', right: 14, bottom: 24, width: 40, height: 40, borderRadius: 20,
    backgroundColor: hexA(colors.bgSunk, 0.8), borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
});
