import { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { currentUser } from '../../lib/session';
import { font, fontFamily, hexA, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { DECOR, FOCUS_COMPLETE_GONG } from '../../lib/visualAssets';
import { EmbeddedFiligree } from '../spatial';
import { Button } from '../ui';
import { CompletedSession, useFocusStore } from '../../store/focusStore';
import { FLOW_COPY } from '../../lib/flowCopy';
import { t } from '../../lib/i18n';
import { acknowledgementFor, interruptionSummary, type IntentAnswer } from '../../lib/focusRitual';
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
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const settings = useFocusStore((st) => st.settings);
  const [rows, setRows] = useState<FocusSessionRow[]>([]);
  const [answer, setAnswer] = useState<IntentAnswer | null>(null);

  const answerResetKey = `${visible}:${session?.sessionNumber ?? 'none'}`;
  const [prevAnswerResetKey, setPrevAnswerResetKey] = useState(answerResetKey);
  if (prevAnswerResetKey !== answerResetKey) {
    setPrevAnswerResetKey(answerResetKey);
    setAnswer(null);
  }

  const [prevVisible, setPrevVisible] = useState(visible);
  if (prevVisible !== visible) {
    setPrevVisible(visible);
    if (visible) {
      setRows([]);
    }
  }

  const awayNote = interruptionSummary(session?.interruptions ?? 0);

  // Açılınca son 1 haftanın gerçek seanslarını çek (rapor mantığının aynısı)
  useEffect(() => {
    if (!visible) return;
    let active = true;
    void (async () => {
      const user = await currentUser();
      if (!user) return;
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 8);
      // focus_sessions okunur — bkz. repositories/focusSessionRepository.ts
      const res = await fetchFocusSessionsSince({ sinceIso: weekAgo.toISOString() });
      if (active) setRows(res.ok ? res.data : []);
    })();
    return () => {
      active = false;
    };
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
          <View style={s.headBanner}>
            <Image source={FOCUS_COMPLETE_GONG} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.52) }]} />
            <View style={s.head}>
              <View style={[s.badge, { backgroundColor: accent + '22', borderColor: accent + '55' }]}>
                <Ionicons name="checkmark" size={26} color={accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{t('focus.complete.title')}</Text>
                <Text style={s.sub} numberOfLines={1}>
                  {session?.taskTitle ? session.taskTitle : t('focus.complete.defaultTask')} · {session ? fmtDuration(session.seconds) : ''}
                </Text>
                {awayNote ? <Text style={s.awayNote}>{awayNote}</Text> : null}
              </View>
              <TouchableOpacity
                onPress={onClose}
                hitSlop={10}
                accessibilityRole="button"
                accessibilityLabel={t('focus.complete.close.a11y')}
              >
                <Ionicons name="close" size={22} color={colors.textFaint} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
            {/* İstatistik kartları (bu hafta — gerçek veri) */}
            <View style={s.statRow}>
              <Stat value={t('focus.stat.hoursValue', { hours: fmtHours(sum.totalSeconds) })} label={t('focus.stat.totalFocus')} />
              <Stat value={`${sum.totalSessions}`} label={t('focus.stat.sessions')} />
              <Stat value={`${sum.daysFocused}`} label={t('focus.stat.daysFocused')} />
            </View>

            {/* ODAK SAATLERİ — gerçek veriyle bar grafiği */}
            {settings.showFocusChart && (
              <>
                <Text style={s.sectionTitle}>{t('focus.complete.hours.overline')}</Text>
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

            {/* PS-11 — Odak öncesi niyet geri çağrısı */}
            {session?.intent ? (
              <View style={s.intentBox}>
                <Text style={s.intentTitle}>{FLOW_COPY.intentRecallTitle}</Text>
                <Text style={s.intentQuote}>{session.intent}</Text>
                {answer === null ? (
                  <>
                    <Text style={s.intentAsk}>{FLOW_COPY.intentRecallAsk}</Text>
                    <View style={s.intentAnswersRow}>
                      <Button
                        label={FLOW_COPY.intentAnswerYes}
                        size="md"
                        variant="secondary"
                        color={accent}
                        onPress={() => setAnswer('yes')}
                      />
                      <Button
                        label={FLOW_COPY.intentAnswerPartly}
                        size="md"
                        variant="secondary"
                        color={accent}
                        onPress={() => setAnswer('partly')}
                      />
                      <Button
                        label={FLOW_COPY.intentAnswerNo}
                        size="md"
                        variant="secondary"
                        color={accent}
                        onPress={() => setAnswer('no')}
                      />
                    </View>
                  </>
                ) : (
                  <Text style={s.intentAck} accessibilityLiveRegion="polite">
                    {acknowledgementFor(answer)}
                  </Text>
                )}
              </View>
            ) : null}

            {/* GÖREVE GÖRE SÜRE — gerçek veri */}
            {tasks.length > 0 && (
              <>
                <Text style={s.sectionTitle}>{t('focus.complete.byTask.overline')}</Text>
                {tasks.slice(0, 5).map((tk) => (
                  <View key={tk.title} style={s.ttRow}>
                    <Text style={s.ttName} numberOfLines={1}>{tk.title}</Text>
                    <View style={s.ttBar}>
                      <View style={[s.ttBarFill, { width: `${Math.round((tk.totalSeconds / Math.max(1, tasks[0].totalSeconds)) * 100)}%`, backgroundColor: accent }]} />
                    </View>
                    <Text style={s.ttVal}>{fmtDuration(tk.totalSeconds)}</Text>
                  </View>
                ))}
              </>
            )}
          </ScrollView>

          {/* Aksiyonlar */}
          <View style={s.foot}>
            <TouchableOpacity
              style={[s.primaryBtn, { backgroundColor: accent }]}
              onPress={onOpenReport}
              accessibilityRole="button"
              accessibilityLabel={t('focus.complete.openReport')}
            >
              <Ionicons name="stats-chart-outline" size={18} color={colors.white} />
              <Text style={s.primaryText}>{t('focus.complete.openReport')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={s.secondaryBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t('common.close')}
            >
              <Text style={s.secondaryText}>{t('common.close')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.stat}>
      <EmbeddedFiligree source={DECOR.guillocheWave} anchor="bottom-right" size={92} opacity={0.14} />
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: hexA(colors.black, 0.7), justifyContent: 'flex-end' },
    sheet: {
      backgroundColor: colors.bgElevated, borderTopLeftRadius: 28, borderTopRightRadius: 28,
      paddingHorizontal: 20, paddingTop: 18, maxHeight: '88%',
      borderTopWidth: 1, borderColor: colors.border,
    },
    headBanner: {
      borderRadius: 18,
      overflow: 'hidden',
      position: 'relative',
      marginBottom: 16,
      paddingHorizontal: 14,
      paddingVertical: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    badge: { width: 48, height: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
    title: { fontSize: 19, fontWeight: '800', color: colors.text },
    sub: { fontSize: 12.5, color: colors.textFaint, marginTop: 3 },
    awayNote: { ...font.caption, color: colors.textDim, marginTop: space.xs },

    intentBox: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: space.md,
      marginBottom: space.lg,
      gap: space.sm,
    },
    intentTitle: { ...font.overline, color: colors.textFaint },
    intentQuote: { ...font.body, color: colors.text, fontWeight: '600' },
    intentAsk: { ...font.bodySm, color: colors.textDim },
    intentAnswersRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
    intentAck: { ...font.bodySm, color: colors.textDim },

    body: { paddingBottom: 16 },
    statRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
    stat: { flex: 1, overflow: 'hidden', position: 'relative', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border, padding: 14, alignItems: 'center' },
    statValue: { fontFamily: fontFamily.mono, fontSize: 22, fontWeight: '800', color: colors.text },
    statLabel: { fontSize: 10, color: colors.textFaint, marginTop: 4, letterSpacing: 0.4, textTransform: 'uppercase' },

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

    foot: { paddingTop: 12, paddingBottom: 20, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
    primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 50, borderRadius: 14, marginBottom: 6 },
    primaryText: { fontSize: 16, fontWeight: '700', color: colors.white },
    secondaryBtn: { paddingVertical: 11, alignItems: 'center' },
    secondaryText: { fontSize: 14, fontWeight: '600', color: colors.textFaint },
  });
