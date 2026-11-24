import { useEffect, useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, ScrollView, TouchableOpacity, ActivityIndicator, Share, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { currentUser } from '../../lib/session';
import { fontFamily, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useFocusStore } from '../../store/focusStore';
import { todayLocal } from '../../lib/date';
import { seriesText, redactSessionsForShare } from '../../lib/chartText';
import { reportError } from '../../lib/crashReporting';
import {
  FocusSessionRow, ReportRange, inRange, summary, byTask, buckets, ranking,
  fmtDuration, fmtHours, toCSV, toExcelXML, sessionsSheet, EXPORT_META, webDownload,
} from '../../lib/focusReport';
import { fmt, t } from '../../lib/i18n';
import { sessionsSince as fetchFocusSessionsSince } from '../../services/focusService';

type Props = { visible: boolean; onClose: () => void; accent: string };
type Tab = 'summary' | 'detail' | 'ranking';

const RANGES: { key: ReportRange; label: () => string }[] = [
  { key: 'today', label: () => t('focus.range.today') },
  { key: 'week', label: () => t('focus.range.week') },
  { key: 'month', label: () => t('focus.range.month') },
  { key: 'year', label: () => t('focus.range.year') },
];
const TABS: { key: Tab; label: () => string }[] = [
  { key: 'summary', label: () => t('focus.report.tab.summary') },
  { key: 'detail', label: () => t('focus.report.tab.detail') },
  { key: 'ranking', label: () => t('focus.report.tab.ranking') },
];
function modeLabel(mode: string): string {
  if (mode === 'work') return t('focus.report.mode.work');
  if (mode === 'shortBreak') return t('focus.phase.spoken.shortBreak');
  if (mode === 'longBreak') return t('focus.phase.spoken.longBreak');
  return mode;
}

export default function FocusReportModal({ visible, onClose, accent }: Props) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const settings = useFocusStore((st) => st.settings);
  const [range, setRange] = useState<ReportRange>('week');
  const [tab, setTab] = useState<Tab>('summary');
  const [rows, setRows] = useState<FocusSessionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const openKey = visible ? `open:${settings.defaultReportRange}` : 'closed';
  const [prevOpenKey, setPrevOpenKey] = useState('');
  if (prevOpenKey !== openKey) {
    setPrevOpenKey(openKey);
    if (visible) {
      setRange(settings.defaultReportRange);
      setTab('summary');
      setExportNote(null);
      setLoading(true);
    }
  }

  // Sıralama gizliyse ve o sekmedeysek özete dön
  const activeTab: Tab = !settings.showRanking && tab === 'ranking' ? 'summary' : tab;

  const timeFmt = (d: Date) =>
    settings.hourFormat === '12h'
      ? fmt.date(d, 'time12')
      : d.toTimeString().slice(0, 5);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    void (async () => {
      const user = await currentUser();
      if (!user) {
        if (active) setLoading(false);
        return;
      }
      const yearAgo = new Date();
      yearAgo.setFullYear(yearAgo.getFullYear() - 1);
      const res = await fetchFocusSessionsSince({ sinceIso: yearAgo.toISOString() });
      if (active) {
        setRows(res.ok ? res.data : []);
        setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [visible, settings.defaultReportRange]);

  const workSessions = useMemo(() => rows.filter((r) => r.mode === 'work'), [rows]);
  const sessions = useMemo(() => inRange(rows, range), [rows, range]);
  const sum = useMemo(() => summary(sessions), [sessions]);
  const tasks = useMemo(() => byTask(sessions), [sessions]);
  const chart = useMemo(() => buckets(sessions, range), [sessions, range]);
  const rank = useMemo(() => ranking(sessions, { streakSessions: workSessions }), [sessions, workSessions]);
  const maxBar = Math.max(1, ...chart.map((b) => b.seconds));
  const chartH = 120;

  // R07.07 — before a report leaves the device: task titles only if chosen.
  const [shareTitles, setShareTitles] = useState(false);
  async function exportData(format: 'csv' | 'json' | 'excel') {
    if (sessions.length === 0) return;
    setExportNote(null);
    const out = redactSessionsForShare(sessions, shareTitles);
    const content =
      format === 'csv' ? toCSV(out)
      : format === 'excel' ? toExcelXML([sessionsSheet(out)])
      : JSON.stringify(out, null, 2);
    const { ext, mime } = EXPORT_META[format];
    const filename = `odak-raporu-${todayLocal()}.${ext}`;

    // Web: gerçek dosya indir (Share masaüstü tarayıcılarda yok/no-op).
    if (Platform.OS === 'web') {
      const ok = webDownload(filename, mime, content);
      if (!ok) setExportNote(t('focus.report.downloadBlocked'));
      return;
    }
    // iOS: paylaşım sayfası Modal üstünde açılamaz → önce kapat, sonra paylaş.
    if (Platform.OS === 'ios') {
      onClose();
      setTimeout(() => {
        Share.share({ message: content, title: t('focus.report.shareTitle', { format: format.toUpperCase() }) }).catch((e) => {
          reportError(e, 'manual', 'focus-report-share');
        });
      }, 350);
      return;
    }
    // Android: doğrudan paylaş.
    try {
      await Share.share({ message: content, title: t('focus.report.shareTitle', { format: format.toUpperCase() }) });
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') {
        setExportNote(t('focus.report.shareFailed'));
        reportError(e, 'manual', 'focus-report-share');
      }
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        {/* Başlık */}
        <View style={s.header}>
          <Text style={s.title}>{t('focus.report.title')}</Text>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Ionicons name="close" size={24} color={colors.textFaint} />
          </TouchableOpacity>
        </View>

        {/* Sekmeler */}
        <View style={s.tabs} accessibilityRole="tablist">
          {(settings.showRanking ? TABS : TABS.filter((tb) => tb.key !== 'ranking')).map((tb) => {
            const tbLabel = tb.label();
            const isSel = activeTab === tb.key;
            return (
              <TouchableOpacity
                key={tb.key}
                style={[s.tab, isSel && { borderBottomColor: accent }]}
                onPress={() => setTab(tb.key)}
                accessibilityRole="tab"
                accessibilityLabel={tbLabel}
                accessibilityState={{ selected: isSel }}
              >
                <Text style={[s.tabText, isSel && { color: colors.text }]}>{tbLabel}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 40 }} color={accent} />
        ) : (
          <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
            {/* Range filtresi */}
            <View style={s.rangeRow}>
              {RANGES.map((r) => {
                const rLabel = r.label();
                const isSel = range === r.key;
                return (
                  <TouchableOpacity
                    key={r.key}
                    style={[s.rangeBtn, isSel && { backgroundColor: accent + '22', borderColor: accent }]}
                    onPress={() => setRange(r.key)}
                    accessibilityRole="button"
                    accessibilityLabel={rLabel}
                    accessibilityState={{ selected: isSel }}
                  >
                    <Text style={[s.rangeText, isSel && { color: accent }]}>{rLabel}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {sessions.length === 0 ? (
              <View style={s.empty}>
                <Ionicons name="bar-chart-outline" size={40} color={colors.textGhost} />
                <Text style={s.emptyText}>{t('focus.report.empty')}</Text>
              </View>
            ) : activeTab === 'summary' ? (
              <>
                <View style={s.statRow}>
                  <Stat value={t('focus.stat.hoursValue', { hours: fmtHours(sum.totalSeconds) })} label={t('focus.stat.totalFocus')} />
                  <Stat value={`${sum.totalSessions}`} label={t('focus.stat.sessions')} />
                  <Stat value={`${sum.daysFocused}`} label={t('focus.stat.daysFocused')} />
                </View>

                {settings.showFocusChart && (
                  <>
                    <Text style={s.sectionTitle}>{t('focus.complete.hours.overline')}</Text>
                    <View
                      style={[s.chart, { height: chartH }]}
                      accessible
                      accessibilityRole="image"
                      accessibilityLabel={seriesText(
                        t('focus.report.chart.seriesTitle'),
                        chart.map((b) => ({ label: b.label, value: Math.round(b.seconds / 60) })),
                        t('focus.report.chart.unitMinutes'),
                      )}
                    >
                      {chart.map((b, i) => (
                        <View key={i} style={s.chartCol}>
                          <View style={[s.chartBar, { height: Math.max(2, Math.round((b.seconds / maxBar) * (chartH - 22))), backgroundColor: accent }]} />
                          <Text style={s.chartLabel} numberOfLines={1}>{chart.length > 20 ? (i % 3 === 0 ? b.label : '') : b.label}</Text>
                        </View>
                      ))}
                    </View>
                  </>
                )}

                <Text style={s.sectionTitle}>{t('focus.complete.byTask.overline')}</Text>
                {tasks.map((tk) => (
                  <View key={tk.title} style={s.ttRow}>
                    <Text style={s.ttName} numberOfLines={1}>{tk.title}</Text>
                    <View style={s.ttBar}>
                      <View style={[s.ttBarFill, { width: `${Math.round((tk.totalSeconds / Math.max(1, tasks[0].totalSeconds)) * 100)}%`, backgroundColor: accent }]} />
                    </View>
                    <Text style={s.ttVal}>{fmtDuration(tk.totalSeconds)}</Text>
                  </View>
                ))}
              </>
            ) : activeTab === 'detail' ? (
              <View style={{ gap: 8 }}>
                {sessions.map((sn) => {
                  const dt = new Date(sn.started_at);
                  return (
                    <View key={sn.id} style={s.detailRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={s.detailTask} numberOfLines={1}>{sn.task_title || t('focus.report.unassigned')}</Text>
                        <Text style={s.detailMeta}>
                          {modeLabel(sn.mode)} · {fmt.date(dt, 'dayMonthNumeric')} {timeFmt(dt)}
                        </Text>
                      </View>
                      <Text style={s.detailDur}>{fmtDuration(sn.completed_seconds)}</Text>
                      <Text style={[s.detailStatus, { color: sn.completed ? colors.success : colors.error }]}>
                        {sn.completed ? t('focus.report.status.done') : t('focus.report.status.interrupted')}
                      </Text>
                    </View>
                  );
                })}
              </View>
            ) : (
              <View style={s.rankGrid}>
                <RankCard label={t('focus.report.rank.mostFocused')} value={rank.mostFocusedTask?.title ?? '—'} sub={rank.mostFocusedTask ? fmtDuration(rank.mostFocusedTask.totalSeconds) : ''} />
                <RankCard label={t('focus.report.rank.mostCompleted')} value={rank.mostCompletedTask ? t('focus.pomodoroCount', { count: rank.mostCompletedTask.completed }) : '—'} sub={rank.mostCompletedTask?.title ?? ''} />
                <RankCard
                  label={t('focus.report.rank.topDay')}
                  value={rank.topDay ? fmt.ymd(rank.topDay.date, 'weekdayLong') : '—'}
                  sub={rank.topDay ? fmtDuration(rank.topDay.seconds) : ''}
                />
                <RankCard label={t('focus.report.rank.topHour')} value={rank.topHour ? `${String(rank.topHour.hour).padStart(2, '0')}:00` : '—'} sub={rank.topHour ? fmtDuration(rank.topHour.seconds) : ''} />
                <RankCard label={t('focus.report.rank.streak')} value={t('focus.report.rank.streakDays', { days: rank.streak })} sub={rank.streak > 0 ? t('focus.report.rank.streakActive') : t('focus.report.rank.streakNone')} accent={accent} />
                <RankCard label={t('focus.report.rank.interrupted')} value={`${sum.interruptedCount}`} sub={t('focus.report.rank.completedSub', { count: sum.completedCount })} />
              </View>
            )}
          </ScrollView>
        )}

        {/* Dışa aktarma footer */}
        {exportNote ? (
          <Text style={[s.footerText, { paddingHorizontal: 18, paddingTop: 6, color: colors.error }]} accessibilityLiveRegion="polite">
            {exportNote}
          </Text>
        ) : null}
        <View style={s.footer}>
          <TouchableOpacity
            onPress={() => setShareTitles((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: shareTitles }}
            accessibilityLabel={t('focus.report.shareTitles.a11y')}
          >
            <Text style={s.footerText}>{t('focus.report.shareTitles', { box: shareTitles ? '☑' : '☐' })}</Text>
          </TouchableOpacity>
          <Text style={s.footerText}>{settings.enableLocalReports ? t('focus.report.localActive') : t('focus.report.localDisabled')}</Text>
          <View style={s.footerBtns}>
            <TouchableOpacity
              style={s.exportBtn}
              onPress={() => exportData('csv')}
              accessibilityRole="button"
              accessibilityLabel="CSV"
            >
              <Text style={s.exportText}>CSV</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.exportBtn}
              onPress={() => exportData('excel')}
              accessibilityRole="button"
              accessibilityLabel="Excel"
            >
              <Text style={s.exportText}>Excel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.exportBtn}
              onPress={() => exportData('json')}
              accessibilityRole="button"
              accessibilityLabel="JSON"
            >
              <Text style={s.exportText}>JSON</Text>
            </TouchableOpacity>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.stat}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

function RankCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.rankCard}>
      <Text style={s.rankLabel}>{label}</Text>
      <Text style={[s.rankValue, accent ? { color: accent } : null]} numberOfLines={2}>{value}</Text>
      {sub ? <Text style={s.rankSub} numberOfLines={1}>{sub}</Text> : null}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
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
    chartLabel: { fontSize: 9, color: colors.textFaint, fontFamily: fontFamily.mono },

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
    exportBtn: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
    exportText: { fontSize: 12, fontWeight: '700', color: colors.textDim },
  });
