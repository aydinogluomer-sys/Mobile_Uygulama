import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { currentUser } from '../../lib/session';
import { colors, fontFamily } from '../../lib/tokens';
import { CompletedSession, useFocusStore } from '../../store/focusStore';
import { FocusSessionRow, inRange, summary, byTask, buckets, fmtDuration, fmtHours } from '../../lib/focusReport';
import { sessionsSince as fetchFocusSessionsSince } from '../../services/focusService';

type Props = {
  visible: boolean;
  session: CompletedSession | null;
  accent: string;
  onClose: () => void;
  onOpenReport: () => void;
};

const CHART_H = 120;

export default function FocusSessionCompleteModal({ visible, session, accent, onClose, onOpenReport }: Props) {
  const settings = useFocusStore((st) => st.settings);
  const [rows, setRows] = useState<FocusSessionRow[]>([]);

  // Açılınca son 1 haftanın gerçek seanslarını çek (rapor mantığının aynısı)
  useEffect(() => {
    if (!visible) return;
    setRows([]);
    let active = true;
    (async () => {
      const user = await currentUser();
      if (!user) return;
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 8);
      // focus_sessions okunur — bkz. repositories/focusSessionRepository.ts
      const res = await fetchFocusSessionsSince({ sinceIso: weekAgo.toISOString() });
      if (active) setRows(res.ok ? res.data : []);
    })();
    return () => { active = false; };
  }, [visible]);

  const week = useMemo(() => inRange(rows, 'week'), [rows]);
  const sum = useMemo(() => summary(week), [week]);
  const chart = useMemo(() => buckets(week, 'week'), [week]);
  const tasks = useMemo(() => byTask(week), [week]);
  const maxBar = Math.max(1, ...chart.map((b) => b.seconds));

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.backdrop}>
        <SafeAreaView style={s.sheet} edges={['bottom']}>
          {/* Kutlama başlığı */}
          <View style={s.head}>
            <View style={[s.badge, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
              <Ionicons name="checkmark" size={26} color={accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Seans Tamamlandı</Text>
              <Text style={s.sub} numberOfLines={1}>
                {session?.taskTitle ? session.taskTitle : 'Odak seansı'} · {session ? fmtDuration(session.seconds) : ''}
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
            {/* İstatistik kartları (bu hafta — gerçek veri) */}
            <View style={s.statRow}>
              <Stat value={`${fmtHours(sum.totalSeconds)}s`} label="Toplam odak" />
              <Stat value={`${sum.totalSessions}`} label="Oturum" />
              <Stat value={`${sum.daysFocused}`} label="Odaklı gün" />
            </View>

            {/* ODAK SAATLERİ — gerçek veriyle bar grafiği */}
            {settings.showFocusChart && (
              <>
                <Text style={s.sectionTitle}>ODAK SAATLERİ</Text>
                <View style={[s.chart, { height: CHART_H }]}>
                  {chart.map((b, i) => (
                    <View key={i} style={s.chartCol}>
                      <View style={[s.chartBar, { height: Math.max(2, Math.round((b.seconds / maxBar) * (CHART_H - 22))), backgroundColor: accent }]} />
                      <Text style={s.chartLabel} numberOfLines={1}>{b.label}</Text>
                    </View>
                  ))}
                </View>
              </>
            )}

            {/* GÖREVE GÖRE SÜRE — gerçek veri */}
            {tasks.length > 0 && (
              <>
                <Text style={s.sectionTitle}>GÖREVE GÖRE SÜRE</Text>
                {tasks.slice(0, 5).map((t) => (
                  <View key={t.title} style={s.ttRow}>
                    <Text style={s.ttName} numberOfLines={1}>{t.title}</Text>
                    <View style={s.ttBar}>
                      <View style={[s.ttBarFill, { width: `${Math.round((t.totalSeconds / Math.max(1, tasks[0].totalSeconds)) * 100)}%`, backgroundColor: accent }]} />
                    </View>
                    <Text style={s.ttVal}>{fmtDuration(t.totalSeconds)}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          {/* Aksiyonlar */}
          <View style={s.foot}>
            <TouchableOpacity style={[s.primaryBtn, { backgroundColor: accent }]} onPress={onOpenReport}>
              <Ionicons name="stats-chart-outline" size={18} color="#fff" />
              <Text style={s.primaryText}>Tam Raporu Gör</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.secondaryBtn} onPress={onClose}>
              <Text style={s.secondaryText}>Kapat</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.bgElevated, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 18, maxHeight: '88%',
    borderTopWidth: 1, borderColor: colors.border,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  badge: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, fontWeight: '800', color: colors.text },
  sub: { fontSize: 12.5, color: colors.textFaint, marginTop: 3 },

  body: { paddingBottom: 16 },
  statRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: 'center' },
  statValue: { fontFamily: fontFamily.mono, fontSize: 22, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textFaint, marginTop: 4, letterSpacing: 0.4, textTransform: 'uppercase' },

  sectionTitle: { fontSize: 11, fontWeight: '800', color: colors.textFaint, letterSpacing: 1, marginBottom: 12, marginTop: 4 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, marginBottom: 22 },
  chartCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 5 },
  chartBar: { width: '70%', maxWidth: 22, borderRadius: 3, minHeight: 2 },
  chartLabel: { fontSize: 9, color: colors.textGhost, fontFamily: fontFamily.mono },

  ttRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  ttName: { flex: 1.2, fontSize: 13, color: colors.textDim },
  ttBar: { flex: 1, height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  ttBarFill: { height: '100%', borderRadius: 3 },
  ttVal: { fontSize: 12, color: colors.textFaint, fontFamily: fontFamily.mono, minWidth: 48, textAlign: 'right' },

  foot: { paddingTop: 12, paddingBottom: 20, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: 14, marginBottom: 6 },
  primaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  secondaryBtn: { paddingVertical: 11, alignItems: 'center' },
  secondaryText: { fontSize: 14, fontWeight: '600', color: colors.textFaint },
});
