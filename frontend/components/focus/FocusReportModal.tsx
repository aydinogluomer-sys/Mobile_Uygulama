import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, ActivityIndicator, Share, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { colors, fontFamily } from '../../lib/tokens';
import { useFocusStore } from '../../store/focusStore';
import { todayLocal } from '../../lib/date';
import {
  FocusSessionRow, ReportRange, inRange, summary, byTask, buckets, ranking,
  fmtDuration, fmtHours, toCSV, toExcelXML, sessionsSheet, EXPORT_META, webDownload,
} from '../../lib/focusReport';

type Props = { visible: boolean; onClose: () => void; accent: string };
type Tab = 'summary' | 'detail' | 'ranking';

const RANGES: { key: ReportRange; label: string }[] = [
  { key: 'today', label: 'Bugün' },
  { key: 'week', label: 'Hafta' },
  { key: 'month', label: 'Ay' },
  { key: 'year', label: 'Yıl' },
];
const TABS: { key: Tab; label: string }[] = [
  { key: 'summary', label: 'Özet' },
  { key: 'detail', label: 'Detay' },
  { key: 'ranking', label: 'Sıralama' },
];
const MODE_LABEL: Record<string, string> = { work: 'Pomodoro', shortBreak: 'Kısa mola', longBreak: 'Uzun mola' };

export default function FocusReportModal({ visible, onClose, accent }: Props) {
  const settings = useFocusStore((st) => st.settings);
  const [range, setRange] = useState<ReportRange>('week');
  const [tab, setTab] = useState<Tab>('summary');
  const [rows, setRows] = useState<FocusSessionRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Sıralama gizliyse ve o sekmedeysek özete dön
  useEffect(() => {
    if (!settings.showRanking && tab === 'ranking') setTab('summary');
  }, [settings.showRanking, tab]);

  const timeFmt = (d: Date) =>
    settings.hourFormat === '12h'
      ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', hour12: true })
      : d.toTimeString().slice(0, 5);

  useEffect(() => {
    if (!visible) return;
    setRange(settings.defaultReportRange);
    setTab('summary');
    let active = true;
    (async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      const yearAgo = new Date();
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      const { data } = await supabase
        .from('focus_sessions')
        .select('id,task_id,task_title,mode,started_at,ended_at,planned_seconds,completed_seconds,completed')
        .eq('user_id', user.id)
        .gte('started_at', yearAgo.toISOString())
        .order('started_at', { ascending: false });
      if (active) { setRows((data as FocusSessionRow[]) ?? []); setLoading(false); }
    })();
    return () => { active = false; };
  }, [visible]);

  const sessions = useMemo(() => inRange(rows, range), [rows, range]);
  const sum = useMemo(() => summary(sessions), [sessions]);
  const tasks = useMemo(() => byTask(sessions), [sessions]);
  const chart = useMemo(() => buckets(sessions, range), [sessions, range]);
  const rank = useMemo(() => ranking(sessions), [sessions]);
  const maxBar = Math.max(1, ...chart.map((b) => b.seconds));
  const chartH = 120;

  async function exportData(fmt: 'csv' | 'json' | 'excel') {
    if (sessions.length === 0) return;
    const content =
      fmt === 'csv' ? toCSV(sessions)
      : fmt === 'excel' ? toExcelXML([sessionsSheet(sessions)])
      : JSON.stringify(sessions, null, 2);
    const { ext, mime } = EXPORT_META[fmt];
    const filename = `odak-raporu-${todayLocal()}.${ext}`;

    // Web: gerçek dosya indir (Share masaüstü tarayıcılarda yok/no-op).
    if (Platform.OS === 'web') { webDownload(filename, mime, content); return; }
    // iOS: paylaşım sayfası Modal üstünde açılamaz → önce kapat, sonra paylaş.
    if (Platform.OS === 'ios') {
      onClose();
      setTimeout(() => { Share.share({ message: content, title: `Odak raporu (${fmt.toUpperCase()})` }).catch(() => {}); }, 350);
      return;
    }
    // Android: doğrudan paylaş.
    try { await Share.share({ message: content, title: `Odak raporu (${fmt.toUpperCase()})` }); } catch { /* iptal/yoksay */ }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        {/* Başlık */}
        <View style={s.header}>
          <Text style={s.title}>Rapor</Text>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <Ionicons name="close" size={24} color={colors.textFaint} />
          </TouchableOpacity>
        </View>

        {/* Sekmeler */}
        <View style={s.tabs}>
          {(settings.showRanking ? TABS : TABS.filter((t) => t.key !== 'ranking')).map((t) => (
            <TouchableOpacity key={t.key} style={[s.tab, tab === t.key && { borderBottomColor: accent }]} onPress={() => setTab(t.key)}>
              <Text style={[s.tabText, tab === t.key && { color: colors.text }]}>{t.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={accent} />
        ) : (
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {/* Range filtresi */}
            <View style={s.rangeRow}>
              {RANGES.map((r) => (
                <TouchableOpacity
                  key={r.key}
                  style={[s.rangeBtn, range === r.key && { backgroundColor: accent + '22', borderColor: accent }]}
                  onPress={() => setRange(r.key)}
                >
                  <Text style={[s.rangeText, range === r.key && { color: accent }]}>{r.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            {sessions.length === 0 ? (
              <View style={s.empty}>
                <Ionicons name="bar-chart-outline" size={40} color={colors.textGhost} />
                <Text style={s.emptyText}>Bu aralıkta odak oturumu yok. Bir pomodoro tamamlayınca burada görünür.</Text>
              </View>
            ) : tab === 'summary' ? (
              <>
                <View style={s.statRow}>
                  <Stat value={`${fmtHours(sum.totalSeconds)}s`} label="Toplam odak" />
                  <Stat value={`${sum.totalSessions}`} label="Oturum" />
                  <Stat value={`${sum.daysFocused}`} label="Odaklı gün" />
                </View>

                {settings.showFocusChart && (
                  <>
                    <Text style={s.sectionTitle}>ODAK SAATLERİ</Text>
                    <View style={[s.chart, { height: chartH }]}>
                      {chart.map((b, i) => (
                        <View key={i} style={s.chartCol}>
                          <View style={[s.chartBar, { height: Math.max(2, Math.round((b.seconds / maxBar) * (chartH - 22))), backgroundColor: accent }]} />
                          <Text style={s.chartLabel} numberOfLines={1}>{b.label}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                <Text style={s.sectionTitle}>GÖREVE GÖRE SÜRE</Text>
                {tasks.map((t) => (
                  <View key={t.title} style={s.ttRow}>
                    <Text style={s.ttName} numberOfLines={1}>{t.title}</Text>
                    <View style={s.ttBar}>
                      <View style={[s.ttBarFill, { width: `${Math.round((t.totalSeconds / Math.max(1, tasks[0].totalSeconds)) * 100)}%`, backgroundColor: accent }]} />
                    </View>
                    <Text style={s.ttVal}>{fmtDuration(t.totalSeconds)}</Text>
                  </View>
                ))}
              </>
            ) : tab === 'detail' ? (
              <View style={{ gap: 8 }}>
                {sessions.map((sn) => {
                  const dt = new Date(sn.started_at);
                  return (
                    <View key={sn.id} style={s.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.detailTask} numberOfLines={1}>{sn.task_title || '(görevsiz)'}</Text>
                        <Text style={s.detailMeta}>
                          {MODE_LABEL[sn.mode] || sn.mode} · {dt.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })} {timeFmt(dt)}
                        </Text>
                      </View>
                      <Text style={s.detailDur}>{fmtDuration(sn.completed_seconds)}</Text>
                      <Text style={[s.detailStatus, { color: sn.completed ? colors.success : colors.error }]}>
                        {sn.completed ? 'Tamam' : 'Kesildi'}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={s.rankGrid}>
                <RankCard label="En çok odaklanılan" value={rank.mostFocusedTask?.title ?? '—'} sub={rank.mostFocusedTask ? fmtDuration(rank.mostFocusedTask.totalSeconds) : ''} />
                <RankCard label="En çok tamamlanan" value={rank.mostCompletedTask ? `${rank.mostCompletedTask.completed} pomodoro` : '—'} sub={rank.mostCompletedTask?.title ?? ''} />
                <RankCard
                  label="En verimli gün"
                  value={rank.topDay ? new Date(rank.topDay.date + 'T00:00:00').toLocaleDateString('tr-TR', { weekday: 'long' }) : '—'}
                  sub={rank.topDay ? fmtDuration(rank.topDay.seconds) : ''}
                />
                <RankCard label="En verimli saat" value={rank.topHour ? `${String(rank.topHour.hour).padStart(2, '0')}:00` : '—'} sub={rank.topHour ? fmtDuration(rank.topHour.seconds) : ''} />
                <RankCard label="Streak" value={`${rank.streak} gün`} sub={rank.streak > 0 ? 'ardışık odak' : 'henüz yok'} accent={accent} />
                <RankCard label="Kesilen oturum" value={`${sum.interruptedCount}`} sub={`${sum.completedCount} tamamlandı`} />
              </View>
            )}
          </ScrollView>
        )}

        {/* Dışa aktarma footer */}
        <View style={s.footer}>
          <Text style={s.footerText}>{settings.enableLocalReports ? 'Yerel rapor · cihazında' : 'Yerel rapor kapalı'}</Text>
          <View style={s.footerBtns}>
            <TouchableOpacity style={s.exportBtn} onPress={() => exportData('csv')}>
              <Text style={s.exportText}>CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.exportBtn} onPress={() => exportData('excel')}>
              <Text style={s.exportText}>Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.exportBtn} onPress={() => exportData('json')}>
              <Text style={s.exportText}>JSON</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
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

function RankCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <View style={s.rankCard}>
      <Text style={s.rankLabel}>{label}</Text>
      <Text style={[s.rankValue, accent ? { color: accent } : null]} numberOfLines={2}>{value}</Text>
      {sub ? <Text style={s.rankSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 18, paddingVertical: 14 },
  title: { fontSize: 20, fontWeight: '800', color: colors.text },

  tabs: { flexDirection: 'row', paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle },
  tab: { paddingVertical: 10, marginRight: 18, borderBottomWidth: 2, borderBottomColor: 'transparent' },
  tabText: { fontSize: 14, fontWeight: '700', color: colors.textFaint },

  content: { padding: 18, paddingBottom: 40 },
  rangeRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  rangeBtn: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  rangeText: { fontSize: 12, fontWeight: '700', color: colors.textFaint },

  statRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  stat: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: 'center' },
  statValue: { fontFamily: fontFamily.mono, fontSize: 22, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: 10, color: colors.textFaint, marginTop: 4, letterSpacing: 0.4 },

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

  detailRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12 },
  detailTask: { fontSize: 13, color: colors.text, fontWeight: '600' },
  detailMeta: { fontSize: 11, color: colors.textFaint, marginTop: 2, fontFamily: fontFamily.mono },
  detailDur: { fontSize: 12, color: colors.textDim, fontFamily: fontFamily.mono },
  detailStatus: { fontSize: 11, fontWeight: '700', minWidth: 48, textAlign: 'right' },

  rankGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  rankCard: { width: '47%', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 4 },
  rankLabel: { fontSize: 10, fontWeight: '700', color: colors.textFaint, letterSpacing: 0.4, textTransform: 'uppercase' },
  rankValue: { fontSize: 15, fontWeight: '800', color: colors.text },
  rankSub: { fontSize: 11, color: colors.textFaint },

  empty: { alignItems: 'center', gap: 12, paddingTop: 50, paddingHorizontal: 30 },
  emptyText: { fontSize: 13, color: colors.textFaint, textAlign: 'center', lineHeight: 19 },

  footer: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 18, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: colors.borderSubtle,
  },
  footerText: { fontSize: 11, color: colors.textFaint },
  footerBtns: { flexDirection: 'row', gap: 8 },
  exportBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  exportText: { fontSize: 12, fontWeight: '700', color: colors.textDim },
});
