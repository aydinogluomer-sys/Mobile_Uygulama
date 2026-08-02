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
import { moodMeta } from '../../lib/journalMoods';
import { extractInvokeError } from '../../lib/aiInvoke';

const PERIODS: { key: InsightPeriod; label: string }[] = [
  { key: 'weekly', label: 'Haftalık' },
  { key: 'monthly', label: 'Aylık' },
  { key: 'yearly', label: 'Yıllık' },
];

const COST = ACTION_COST.insights;

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

  useEffect(() => { fetchEntries(); fetchSub(); }, []);
  useEffect(() => { fetchInsight(period, win.key); setError(null); setLowCredits(false); }, [period]);

  async function generate() {
    if (loading || periodEntries.length === 0) return;
    setLoading(true);
    setError(null);
    setLowCredits(false);

    // Kronolojik metin (eski→yeni)
    const text = [...periodEntries]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((e) => {
        const m = moodMeta(e.mood);
        const moodLabel = m ? ` [${m.label}]` : '';
        return `${e.date}${moodLabel}: ${e.content}`;
      })
      .join('\n\n')
      .slice(0, 7000);

    try {
      const { data, error: invErr } = await supabase.functions.invoke('generate-routine', {
        body: { mode: 'insights', period, entries: text },
      });

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
      await saveInsight(period, win.key, insight, periodEntries.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Bir hata oluştu');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      {/* FP barı */}
      <View style={[s.fpBar, lowCredits && s.fpBarWarn]}>
        <View style={s.fpLeft}>
          <Ionicons name="flash" size={15} color="#D4A84A" />
          <Text style={s.fpText}>{focusPoints} FP</Text>
          <Text style={s.fpSub}>· içgörü {COST} FP</Text>
        </View>
        <TouchableOpacity style={s.upgradeBtn} onPress={() => router.push('/screens/paywall' as any)}>
          <Ionicons name="diamond-outline" size={13} color="#fff" />
          <Text style={s.upgradeText}>Yükselt</Text>
        </TouchableOpacity>
      </View>

      {/* Dönem sekmeleri */}
      <View style={s.tabs}>
        {PERIODS.map((p) => (
          <TouchableOpacity
            key={p.key}
            style={[s.tab, period === p.key && s.tabActive]}
            onPress={() => setPeriod(p.key)}
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
          <View style={s.empty}>
            <Ionicons name="bulb-outline" size={40} color="#56544B" />
            <Text style={s.emptyText}>
              Bu dönemde günlük kaydın yok. Birkaç gün yazdıktan sonra AI sana içgörü sunabilir.
            </Text>
          </View>
        ) : (
          <>
            {/* İçgörü kartı */}
            <View style={s.card}>
              <View style={s.cardHead}>
                <View style={s.cardTitleWrap}>
                  <Ionicons name="sparkles" size={15} color="#8b5cf6" />
                  <Text style={s.cardTitle}>AI İçgörüsü</Text>
                </View>
                {cached && (
                  <Text style={s.cardMeta}>{cached.entry_count} kayıttan</Text>
                )}
              </View>

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

            {error && (
              <View style={s.errorBox}>
                <Ionicons name="alert-circle-outline" size={15} color="#C76A6A" />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[s.genBtn, loading && s.genBtnOff]}
              onPress={generate}
              disabled={loading}
            >
              <Ionicons name={cached ? 'refresh' : 'sparkles'} size={16} color="#fff" />
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
  safe: { flex: 1, backgroundColor: '#15140F' },

  fpBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 8,
    backgroundColor: '#1D1C17', borderBottomWidth: 1, borderBottomColor: '#28261F',
  },
  fpBarWarn: { backgroundColor: '#C76A6A12', borderBottomColor: '#C76A6A30' },
  fpLeft: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  fpText: { fontSize: 14, fontWeight: '700', color: '#D4A84A' },
  fpSub: { fontSize: 11, color: '#827E72' },
  upgradeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: '#D4A84A', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
  },
  upgradeText: { fontSize: 12, fontWeight: '700', color: '#fff' },

  tabs: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 4 },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12,
    borderWidth: 1, borderColor: '#383528', backgroundColor: '#1D1C17',
  },
  tabActive: { backgroundColor: '#8b5cf620', borderColor: '#8b5cf6' },
  tabText: { fontSize: 13, fontWeight: '700', color: '#827E72' },
  tabTextActive: { color: '#a78bfa' },

  content: { padding: 16, paddingBottom: 40 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  metaLabel: { fontSize: 15, fontWeight: '700', color: '#EDEAE0' },
  metaCount: { fontSize: 12, color: '#827E72', fontWeight: '600' },

  card: {
    backgroundColor: '#1D1C17', borderRadius: 16, borderWidth: 1, borderColor: '#383528',
    padding: 16, marginBottom: 12,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  cardTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#EDEAE0' },
  cardMeta: { fontSize: 11, color: '#827E72' },
  insightText: { fontSize: 14, color: '#E3DDD0', lineHeight: 22 },
  placeholder: { fontSize: 13, color: '#827E72', lineHeight: 20, fontStyle: 'italic' },
  loadingBox: { alignItems: 'center', gap: 10, paddingVertical: 20 },
  loadingText: { fontSize: 13, color: '#827E72' },

  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#C76A6A15', borderColor: '#C76A6A30', borderWidth: 1,
    borderRadius: 12, padding: 12, marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 13, color: '#C76A6A' },

  genBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: '#8b5cf6', borderRadius: 14, paddingVertical: 14,
  },
  genBtnOff: { opacity: 0.5 },
  genBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  empty: { alignItems: 'center', gap: 12, paddingTop: 50, paddingHorizontal: 30 },
  emptyText: { fontSize: 13, color: '#827E72', textAlign: 'center', lineHeight: 19 },
});
