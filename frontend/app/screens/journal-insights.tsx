import { colors, alphaHex } from '../../lib/tokens';
import { withEdgeDeadline } from '../../lib/edgeCall';
import { newRequestId } from '../../services/focusPointService';
import { useEffect, useMemo, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useJournalStore } from '../../store/journalStore';
import { useInsightsStore } from '../../store/insightsStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { ACTION_COST } from '../../lib/subscription';
import { periodWindow, InsightPeriod } from '../../lib/journalStats';
import { insightBasis, insightFacts, insightPrompt } from '../../lib/journalInsightContext';
import { createAttemptKeeper, isNoAnswer, NO_ANSWER_NOTE } from '../../lib/aiAttempt';
import { extractInvokeError } from '../../lib/aiInvoke';
import { EmptyState } from '../../components/ui';

const PERIODS: { key: InsightPeriod; label: string }[] = [
  { key: 'weekly', label: 'Haftalık' },
  { key: 'monthly', label: 'Aylık' },
  { key: 'yearly', label: 'Yıllık' },
];

const COST = ACTION_COST.insights;
// R09.06 — the same records sent again after a lost answer reuse the id: one charge.
const insightAttempt = createAttemptKeeper(newRequestId);

export default function JournalInsightsScreen() {
  const router = useRouter();
  const { entries, fetchEntries } = useJournalStore();
  const { get: getCached, fetchInsight, saveInsight } = useInsightsStore();
  const { focusPoints, fetch: fetchSub, setBalance } = useSubscriptionStore();

  const { period: periodParam } = useLocalSearchParams<{ period?: string }>();
  const initialPeriod: InsightPeriod =
    periodParam === 'monthly' || periodParam === 'yearly' ? periodParam : 'weekly';
  const [period, setPeriod] = useState<InsightPeriod>(initialPeriod);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lowCredits, setLowCredits] = useState(false);

  const win = useMemo(() => periodWindow(period), [period]);
  const periodEntries = useMemo(
    () => entries.filter((e) => win.match(e.date)),
    [entries, win],
  );
  const cached = getCached(period, win.key);
  // R09.05 — the user decides which records go to the model (reset per period);
  // the prompt is built from what is in the journal NOW, so a deleted entry
  // cannot reach it.
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  useEffect(() => { setExcluded(new Set()); }, [period, win.key]);
  const prompt = useMemo(() => insightPrompt(periodEntries, excluded), [periodEntries, excluded]);
  const facts = useMemo(() => insightFacts(periodEntries, prompt.used), [periodEntries, prompt.used]);
  const basis = cached
    ? insightBasis(cached, win.label, {
      count: prompt.used.length,
      lastWrite: periodEntries.reduce<string | null>((m, e) => (m === null || e.created_at > m ? e.created_at : m), null),
    })
    : null;

  useEffect(() => { fetchEntries(); fetchSub(); }, [fetchEntries, fetchSub]);
  useEffect(() => { fetchInsight(period, win.key); setError(null); setLowCredits(false); }, [period, win.key, fetchInsight]);

  async function generate() {
    if (loading || prompt.used.length === 0) return;
    setLoading(true);
    setError(null);
    setLowCredits(false);
    // Kronolojik metin (eski→yeni): yalnız kullanıcının bıraktığı, bütün kayıtlar.
    const { text, used } = prompt;
    const requestId = insightAttempt.begin(`${period}|${win.key}|${text}`);

    try {
      const { data, error: invErr } = await withEdgeDeadline('Günlük içgörüsü', (signal) =>
        supabase.functions.invoke('generate-routine', {
        signal,
        body: { mode: 'insights', period, entries: text, request_id: requestId },
      }));

      if (invErr && isNoAnswer(invErr)) throw invErr;
      insightAttempt.answered();
      if (invErr) {
        const { msg, code, balance } = await extractInvokeError(invErr);
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
            accessibilityState={{ selected: period === p.key }}
          >
            <Text style={[s.tabText, period === p.key && s.tabTextActive]}>{p.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.metaRow}>
          <Text style={s.metaLabel}>{win.label}</Text>
          <Text style={s.metaCount}>{periodEntries.length} kayıt</Text>
        </View>

        {periodEntries.length === 0 ? (
          <EmptyState
            icon="bulb-outline"
            title="Bu dönemde günlük kaydın yok"
            hint="Birkaç gün yazdıktan sonra AI sana içgörü sunabilir."
            color="#8b5cf6"
          />
        ) : (
          <>
            {/* İçgörü kartı */}
            <View style={s.card}>
              <View style={s.cardHead}>
                <View style={s.cardTitleWrap}>
                  <Ionicons name="sparkles" size={15} color="#8b5cf6" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
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
                  <ActivityIndicator color="#8b5cf6" />
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
              <Text style={s.cardTitle} accessibilityRole="header">{'AI’ya gidecek kayıtlar'}</Text>
              <Text style={s.cardMeta}>
                {`Uygulamanın hesabı: ${facts.count} kayıt${facts.moodAvg !== null ? ` · ruh hali ort. ${facts.moodAvg}` : ''}${facts.first ? ` · ${facts.first === facts.last ? facts.first : `${facts.first} – ${facts.last}`}` : ''}`}
                {prompt.excluded ? ` · ${prompt.excluded} kayıt sen çıkardın` : ''}
                {prompt.dropped ? ` · en eski ${prompt.dropped} kayıt sığmadı` : ''}
              </Text>
              <View style={s.srcRow}>
                {[...periodEntries].filter((e) => e.content.trim()).sort((a, b) => a.date.localeCompare(b.date)).map((e) => {
                  const on = !excluded.has(e.date);
                  return (
                    <TouchableOpacity key={e.date} style={[s.srcChip, on && s.srcChipOn]}
                      onPress={() => setExcluded((x) => { const n = new Set(x); if (n.has(e.date)) n.delete(e.date); else n.add(e.date); return n; })}
                      accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`${e.date} kaydı AI'ya gitsin`}>
                      <Text style={s.srcChipText}>{e.date.slice(5)}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
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

const s = StyleSheet.create({
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
  tabActive: { backgroundColor: '#8b5cf620', borderColor: '#8b5cf6' },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.textFaint },
  tabTextActive: { color: '#a78bfa' },

  content: { padding: 16, paddingBottom: 40 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  metaLabel: { fontSize: 15, fontWeight: '700', color: colors.text },
  metaCount: { fontSize: 12, color: colors.textFaint, fontWeight: '600' },

  card: {
    backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
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
    backgroundColor: '#8b5cf6', borderRadius: 14, paddingVertical: 14,
  },
  genBtnOff: { opacity: 0.5 },
  genBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },

  empty: { alignItems: 'center', gap: 12, paddingTop: 50, paddingHorizontal: 30 },
  emptyText: { fontSize: 13, color: colors.textFaint, textAlign: 'center', lineHeight: 19 },
});
