import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { fetchCreditTransactions } from '../../repositories/creditRepository';

type Tx = {
  id: string;
  delta: number;
  reason: string | null;
  balance_after: number | null;
  created_at: string;
};

function reasonMeta(reason: string | null): { label: string; icon: string } {
  const r = reason ?? '';
  if (r === 'monthly_renewal') return { label: 'Aylık yenileme', icon: 'refresh-outline' };
  if (r.startsWith('subscription_activated:pro')) return { label: 'Pro aktivasyonu', icon: 'diamond-outline' };
  if (r.startsWith('subscription_activated:plus')) return { label: 'Plus aktivasyonu', icon: 'diamond-outline' };
  if (r.startsWith('subscription_activated')) return { label: 'Abonelik aktivasyonu', icon: 'diamond-outline' };
  if (r === 'ai_coach') return { label: 'AI Coach mesajı', icon: 'chatbubble-ellipses-outline' };
  if (r === 'ai_routine') return { label: 'AI Rutin oluşturma', icon: 'sparkles-outline' };
  return { label: reason ?? 'İşlem', icon: 'ellipse-outline' };
}

export default function CreditHistoryScreen() {
  const { focusPoints, refresh } = useSubscriptionStore();
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const res = await fetchCreditTransactions({ limit: 80 });
    setTxs(res.ok ? res.data : []);
    await refresh();
  }, []);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const earned = txs.filter((t) => t.delta > 0).reduce((a, t) => a + t.delta, 0);
  const spent = txs.filter((t) => t.delta < 0).reduce((a, t) => a + Math.abs(t.delta), 0);

  if (loading) {
    return <View style={s.center}><ActivityIndicator size="large" color="#D97757" /></View>;
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#D97757" />}
      >
        {/* Özet */}
        <View style={s.summary}>
          <View style={s.sumCard}>
            <Ionicons name="flash" size={16} color="#D4A84A" />
            <Text style={s.sumVal}>{focusPoints}</Text>
            <Text style={s.sumLabel}>Mevcut</Text>
          </View>
          <View style={s.sumCard}>
            <Ionicons name="add-circle-outline" size={16} color="#87A678" />
            <Text style={[s.sumVal, { color: '#87A678' }]}>{earned}</Text>
            <Text style={s.sumLabel}>Kazanılan</Text>
          </View>
          <View style={s.sumCard}>
            <Ionicons name="remove-circle-outline" size={16} color="#C76A6A" />
            <Text style={[s.sumVal, { color: '#C76A6A' }]}>{spent}</Text>
            <Text style={s.sumLabel}>Harcanan</Text>
          </View>
        </View>

        {txs.length === 0 ? (
          <View style={s.empty}>
            <Ionicons name="receipt-outline" size={44} color="#56544B" />
            <Text style={s.emptyText}>Henüz işlem yok</Text>
            <Text style={s.emptyHint}>AI kullandıkça veya abonelik aldıkça burada görünür</Text>
          </View>
        ) : (
          txs.map((t) => {
            const m = reasonMeta(t.reason);
            const positive = t.delta > 0;
            return (
              <View key={t.id} style={s.row}>
                <View style={[s.rowIcon, { backgroundColor: (positive ? '#87A678' : '#C76A6A') + '18' }]}>
                  <Ionicons name={m.icon as any} size={16} color={positive ? '#87A678' : '#C76A6A'} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{m.label}</Text>
                  <Text style={s.rowDate}>{format(new Date(t.created_at), 'dd.MM.yyyy HH:mm')}</Text>
                </View>
                <View style={s.rowRight}>
                  <Text style={[s.rowDelta, { color: positive ? '#87A678' : '#C76A6A' }]}>
                    {positive ? '+' : ''}{t.delta} FP
                  </Text>
                  {t.balance_after != null && <Text style={s.rowBal}>bakiye {t.balance_after}</Text>}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#15140F' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#15140F' },
  content: { padding: 16, paddingBottom: 40 },

  summary: { flexDirection: 'row', gap: 10, marginBottom: 18 },
  sumCard: {
    flex: 1, backgroundColor: '#1D1C17', borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#383528', gap: 3,
  },
  sumVal: { fontSize: 20, fontWeight: '800', color: '#D4A84A' },
  sumLabel: { fontSize: 11, color: '#827E72' },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1D1C17', borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: '#383528',
  },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14, color: '#EDEAE0', fontWeight: '600' },
  rowDate: { fontSize: 11, color: '#827E72', marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowDelta: { fontSize: 15, fontWeight: '800' },
  rowBal: { fontSize: 10, color: '#827E72', marginTop: 2 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, color: '#BFBBAE', fontWeight: '600' },
  emptyHint: { fontSize: 12, color: '#827E72', textAlign: 'center' },
});
