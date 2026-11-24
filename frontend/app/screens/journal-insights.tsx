import { alphaHex, hexA, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { withEdgeDeadline } from '../../lib/edgeCall';
import { newRequestId } from '../../services/focusPointService';
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { supabase } from '../../lib/supabase';
import { useJournalStore } from '../../store/journalStore';
import { useInsightsStore } from '../../store/insightsStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { ACTION_COST } from '../../lib/subscription';
import { periodWindow, InsightPeriod } from '../../lib/journalStats';
import { insightBasis, insightFacts, insightPrompt } from '../../lib/journalInsightContext';
import { createAttemptKeeper, isNoAnswer, NO_ANSWER_NOTE, IN_PROGRESS_NOTE, retryWhileInProgress } from '../../lib/aiAttempt';
import { decimalTR } from '../../lib/chartText';
import { extractInvokeError } from '../../lib/aiInvoke';
import { EmptyState, EditorialBanner } from '../../components/ui';
import YearInPixels from '../../components/journal/YearInPixels';
import { AtmosphericScreenCanvas, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import { todayLocal } from '../../lib/date';
import { dailyMoods } from '../../lib/moods';
import { buildYearPixels, YEAR_PIXELS_SCOPE_NOTE_DEVICE } from '../../lib/yearPixels';
import { useMoodStore } from '../../store/moodStore';

const PERIODS: { key: InsightPeriod; label: string }[] = [
  { key: 'weekly', label: 'Haftalık' },
  { key: 'monthly', label: 'Aylık' },
  { key: 'yearly', label: 'Yıllık' },
];

const COST = ACTION_COST.insights;
// R09.06 — the same records sent again after a lost answer reuse the id: one charge.
const insightAttempt = createAttemptKeeper(newRequestId);

export default function JournalInsightsScreen() {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const router = useRouter();
  const { entries, fetchEntries, truncated } = useJournalStore(
    useShallow((st) => ({
      entries: st.entries,
      fetchEntries: st.fetchEntries,
      truncated: st.truncated,
    })),
  );
  const checkins = useMoodStore((st) => st.checkins);
  const hydrateMoods = useMoodStore((st) => st.hydrate);
  const { get: getCached, fetchInsight, saveInsight } = useInsightsStore(
    useShallow((st) => ({
      get: st.get,
      fetchInsight: st.fetchInsight,
      saveInsight: st.saveInsight,
    })),
  );
  const { focusPoints, fetch: fetchSub, setBalance } = useSubscriptionStore(
    useShallow((st) => ({
      focusPoints: st.focusPoints,
      fetch: st.fetch,
      setBalance: st.setBalance,
    })),
  );

  const { period: periodParam } = useLocalSearchParams<{ period?: string }>();
  const initialPeriod: InsightPeriod =
    periodParam === 'monthly' || periodParam === 'yearly' ? periodParam : 'weekly';
  const [period, setPeriod] = useState<InsightPeriod>(initialPeriod);
  const [loading, setLoading] = useState(false);

  const win = useMemo(() => periodWindow(period), [period]);
  const scopeKey = `${period}|${win.key}`;
  const periodEntries = useMemo(
    () => entries.filter((e) => win.match(e.date)),
    [entries, win],
  );
  const cached = getCached(period, win.key);
  // R09.05 — the user decides which records go to the model (reset per period);
  // the prompt is built from what is in the journal NOW, so a deleted entry
  // cannot reach it.
  const [excludedState, setExcludedState] = useState<{ key: string; dates: Set<string> }>(
    () => ({ key: scopeKey, dates: new Set() }),
  );
  const excluded = useMemo(
    () => (excludedState.key === scopeKey ? excludedState.dates : new Set<string>()),
    [excludedState, scopeKey],
  );
  const [feedbackState, setFeedbackState] = useState<{
    key: string;
    error: string | null;
    lowCredits: boolean;
  }>(() => ({ key: scopeKey, error: null, lowCredits: false }));
  const error = feedbackState.key === scopeKey ? feedbackState.error : null;
  const lowCredits = feedbackState.key === scopeKey ? feedbackState.lowCredits : false;

  const setError = (msg: string | null) => {
    setFeedbackState((prev) => ({
      key: scopeKey,
      error: msg,
      lowCredits: prev.key === scopeKey ? prev.lowCredits : false,
    }));
  };
  const setLowCredits = (val: boolean) => {
    setFeedbackState((prev) => ({
      key: scopeKey,
      error: prev.key === scopeKey ? prev.error : null,
      lowCredits: val,
    }));
  };

  const prompt = useMemo(() => insightPrompt(periodEntries, excluded), [periodEntries, excluded]);
  const facts = useMemo(() => insightFacts(periodEntries, prompt.used), [periodEntries, prompt.used]);
  const basis = cached
    ? insightBasis(cached, win.label, {
      count: prompt.used.length,
      lastWrite: periodEntries.reduce<string | null>((m, e) => (m === null || e.created_at > m ? e.created_at : m), null),
    })
    : null;

  useEffect(() => { fetchEntries(); fetchSub(); }, [fetchEntries, fetchSub]);
  useEffect(() => { void hydrateMoods(); }, [hydrateMoods]);
  useEffect(() => { void fetchInsight(period, win.key); }, [period, win.key, fetchInsight]);

  const yearModel = useMemo(() => {
    if (period !== 'yearly') return null;
    const moods = dailyMoods(
      checkins,
      entries.map((e) => ({ date: e.date, mood: e.mood })),
    );
    return buildYearPixels({
      year: Number(win.key),
      moods,
      todayYmd: todayLocal(),
    });
  }, [period, win.key, checkins, entries]);

  function toggleExcluded(date: string) {
    setExcludedState((prev) => {
      const base = prev.key === scopeKey ? prev.dates : new Set<string>();
      const next = new Set(base);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return { key: scopeKey, dates: next };
    });
  }

  async function generate() {
    if (loading || prompt.used.length === 0) return;
    setLoading(true);
    setError(null);
    setLowCredits(false);
    // Kronolojik metin (eski→yeni): yalnız kullanıcının bıraktığı, bütün kayıtlar.
    const { text, used } = prompt;
    const requestId = insightAttempt.begin(`${period}|${win.key}|${text}`);

    try {
      const outcome = await retryWhileInProgress(
        () => withEdgeDeadline('Günlük içgörüsü', (signal) =>
          supabase.functions.invoke('generate-routine', {
            signal,
            body: { mode: 'insights', period, entries: text, request_id: requestId },
          })),
      );
      const { data, error: invErr } = outcome;

      if (invErr && isNoAnswer(invErr)) throw invErr;
      if (outcome.stillInProgress) { setError(IN_PROGRESS_NOTE); return; }
      insightAttempt.answered();
      if (invErr) {
        const { msg, code, balance } = outcome.errorInfo ?? await extractInvokeError(invErr);
        if (typeof balance === 'number') setBalance(balance);
        if (code === 'INSUFFICIENT_CREDITS') setLowCredits(true);
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);
      const insight = data?.insight;
      if (!insight) throw new Error('İçgörü alınamadı, tekrar deneyin.');

      if (typeof data?.balance === 'number') setBalance(data.balance);
      await saveInsight(period, win.key, insight, used.length);
    } catch (e) {
      setError(isNoAnswer(e) ? NO_ANSWER_NOTE : e instanceof Error ? e.message : 'Bir hata oluştu');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas source={CANVASES.journalScriptorium} textureSource={TEXTURES.neural} scrim={0.62} tintColor={colors.accent} />
      {/* FP barı */}
      <View style={[s.fpBar, lowCredits && s.fpBarWarn]}>
        <View style={s.fpLeft}>
          <Ionicons name="flash" size={15} color={colors.warning} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <Text style={s.fpText}>{focusPoints} FP</Text>
          <Text style={s.fpSub}>· içgörü {COST} FP</Text>
        </View>
        <TouchableOpacity
          style={s.creditsBtn}
          onPress={() => router.push('/screens/focus-points')}
          accessibilityRole="button"
          accessibilityLabel="Focus Point bakiyeni aç"
        >
          <Ionicons name="flash-outline" size={13} color={colors.white} />
          <Text style={s.creditsText}>Krediler</Text>
        </TouchableOpacity>
      </View>

      {/* Dönem sekmeleri */}
      <View style={s.tabs}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[s.tab, period === p.key && s.tabActive]}
            onPress={() => setPeriod(p.key)}
            accessibilityRole="tab"
            accessibilityLabel={`${p.label} içgörüler`}
            accessibilityState={{ selected: period === p.key }}
          >
            <Text style={[s.tabText, period === p.key && s.tabTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <EditorialBanner
          source={SCREEN_BANNERS.journalAiMirror}
          textureSource={TEXTURES.neural}
          eyebrow="YANSIMA AYNASI"
          title="Dönemsel Günlük İçgörüsü"
          subtitle="Seçtiğin kayıtlardan tekrar eden temaları ve ruh hali örüntüsünü keşfet."
          accentColor={colors.accent}
          minHeight={94}
          style={{ marginBottom: 12 }}
        />
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>{win.label}</Text>
          <Text style={s.metaCount}>{periodEntries.length} kayıt</Text>
        </View>

        {period === 'yearly' && yearModel && (
          <YearInPixels
            model={yearModel}
            truncated={Boolean(truncated)}
            scopeNote={YEAR_PIXELS_SCOPE_NOTE_DEVICE}
          />
        )}

        {periodEntries.length === 0 ? (
          <EmptyState
            icon="bulb-outline"
            title="Bu dönemde günlük kaydın yok"
            hint="Birkaç gün yazdıktan sonra AI sana içgörü sunabilir."
            color={colors.accent}
          />
        ) : (
          <>
            {/* İçgörü kartı */}
            <View style={s.card}>
              <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={114} opacity={0.16} />
              <View style={s.cardHead}>
                <View style={s.cardTitleWrap}>
                  <Ionicons name="sparkles" size={15} color={colors.accent} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                  <Text style={s.cardTitle} accessibilityRole="header">AI İçgörüsü</Text>
                </View>
                {basis && (
                  <Text style={s.cardMeta}>{basis.line}</Text>
                )}
              </View>
              {cached && !loading && (
                <Text style={s.cardMeta}>AI yorumu — içindeki sayılar uygulamanın hesabı değildir.</Text>
              )}
              {basis?.stale && !loading && (
                <Text style={s.staleText} accessibilityRole="alert">Kayıtlar ya da seçimin bu içgörüden sonra değişti; yenileyebilirsin.</Text>
              )}

              {loading ? (
                <View style={s.loadingBox}>
                  <ActivityIndicator color={colors.accent} />
                  <Text style={s.loadingText}>Kayıtların okunuyor...</Text>
                </View>
              ) : cached ? (
                <Text style={s.insightText}>{cached.content}</Text>
              ) : (
                <Text style={s.placeholder}>
                  Bu dönemdeki günlük kayıtlarından tekrar eden temaları, ruh hali eğilimini ve nazik önerileri çıkarmak için içgörü oluştur.
                </Text>
              )}
            </View>

            {/* R09.05 — kaynak: hangi kayıtlar gidecek (kullanıcı seçer) ve uygulamanın kendi hesabı */}
            <View style={s.card}>
              <EmbeddedFiligree source={DECOR.cornerAstrolabe} size={114} opacity={0.16} />
              <Text style={s.cardTitle} accessibilityRole="header">{'AI’ya gidecek kayıtlar'}</Text>
              <Text style={s.cardMeta}>
                {`Uygulamanın hesabı: ${facts.count} kayıt${facts.moodAvg !== null ? ` · ruh hali ort. ${decimalTR(facts.moodAvg)}` : ''}${facts.first ? ` · ${facts.first === facts.last ? facts.first : `${facts.first} – ${facts.last}`}` : ''}`}
                {prompt.excluded ? ` · ${prompt.excluded} kayıt sen çıkardın` : ''}
                {prompt.dropped ? ` · en eski ${prompt.dropped} kayıt sığmadı` : ''}
              </Text>
              <View style={s.srcRow}>
                {[...periodEntries].filter((e) => e.content.trim()).sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
                  const on = !excluded.has(e.date);
                  return (
                    <TouchableOpacity key={e.date} style={[s.srcChip, on && s.srcChipOn]}
                      onPress={() => toggleExcluded(e.date)}
                      accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${e.date} kaydı AI'ya gitsin`}>
                      <Text style={s.srcChipText}>{e.date.slice(5)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={s.cardMeta}>Seçili kayıtların metni, içgörü oluşturduğunda Anthropic’e gönderilir (en fazla 8000 karakter). Ayrıntı Gizlilik ekranında.</Text>
            </View>

            {error && (
              // Hata sonradan belirdiği için ekran okuyucuya tek parça uyarı olarak duyurulur
              <View style={s.errorBox} accessible accessibilityRole="alert" accessibilityLabel={`Hata: ${error}`}>
                <Ionicons name="alert-circle-outline" size={15} color={colors.error} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.genBtn, loading && s.genBtnOff]}
              onPress={generate}
              disabled={loading || prompt.used.length === 0}
              accessibilityRole="button"
              accessibilityLabel={cached ? `İçgörüyü yenile, ${COST} Focus Point` : `İçgörü oluştur, ${COST} Focus Point`}
              accessibilityState={{ disabled: loading || prompt.used.length === 0 }}
              accessibilityHint={`${COST} odak puanı harcar`}
            >
              <Ionicons name={cached ? 'refresh' : 'sparkles'} size={16} color={colors.white} />
              <Text style={s.genBtnText}>
                {cached ? `Yenile · ${COST} FP` : `İçgörü Oluştur · ${COST} FP`}
              </Text>
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },

  fpBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.borderSubtle,
  },
  fpBarWarn: { backgroundColor: alphaHex(colors.error, '12'), borderBottomColor: alphaHex(colors.error, '30') },
  fpLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fpText: { fontSize: 14, fontWeight: '700', color: colors.warning },
  fpSub: { fontSize: 11, color: colors.textFaint },
  creditsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: colors.warning, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  creditsText: { fontSize: 12, fontWeight: '700', color: colors.white },

  tabs: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 4 },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: alphaHex(colors.accent, '20'), borderColor: colors.accent },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.textFaint },
  tabTextActive: { color: colors.accent },

  content: { padding: 16, paddingBottom: 40 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  metaLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  metaCount: { fontSize: 12, color: colors.textFaint, fontWeight: '600' },

  card: {
    backgroundColor: hexA(colors.surface, 0.92), borderRadius: 16, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', position: 'relative',
    padding: 16, marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  cardMeta: { fontSize: 11, color: colors.textFaint },
  insightText: { fontSize: 14, color: colors.paperText, lineHeight: 22 },
  staleText: { fontSize: 12, color: colors.warning, marginBottom: 8 },
  srcRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  srcChip: { paddingVertical: 4, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: colors.border },
  srcChipOn: { borderColor: colors.accent, backgroundColor: colors.surfaceAlt },
  srcChipText: { fontSize: 11, color: colors.textDim },
  placeholder: { fontSize: 13, color: colors.textFaint, lineHeight: 20, fontStyle: 'italic' },
  loadingBox: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  loadingText: { fontSize: 13, color: colors.textFaint },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: alphaHex(colors.error, '15'), borderColor: alphaHex(colors.error, '30'), borderWidth: 1,
    borderRadius: 12, padding: 12, marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 13, color: colors.error },

  genBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: colors.accent, borderRadius: 14, paddingVertical: 14,
  },
  genBtnOff: { opacity: 0.5 },
  genBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },

  empty: { alignItems: 'center', gap: 12, paddingTop: 50, paddingHorizontal: 30 },
  emptyText: { fontSize: 13, color: colors.textFaint, textAlign: 'center', lineHeight: 19 },
});
