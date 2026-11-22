import { colors, alphaHex } from '../../lib/tokens';
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { format } from 'date-fns';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { listTransactions } from '../../services/focusPointService';
import { EditorialBanner, EmblemMedallion, EmptyState, Skeleton } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

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
    const res = await listTransactions(80);
    setTxs(res.ok ? res.data : []);
    await refresh();
  }, [refresh]);

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

  // Gelen içeriğin şekli belli: 3'lü özet şeridi + işlem satırları.
  // Spinner yerine aynı geometriyi kuran yer tutucu → yükleme bitince sıçrama olmuyor.
  if (loading) {
    return (
      <SafeAreaView style={s.safe} edges={['bottom']}>
        <AtmosphericScreenCanvas
          source={CANVASES.treasuryVault}
          textureSource={TEXTURES.archivalPaper}
          scrim={0.62}
          tintColor={colors.warning}
        />
        <View style={s.content}>
          <View style={s.summary}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={74} style={{ flex: 1 }} />
            ))}
          </View>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} height={58} style={{ marginBottom: 8 }} />
          ))}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.treasuryVault}
        textureSource={TEXTURES.archivalPaper}
        scrim={0.62}
        tintColor={colors.warning}
      />
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <EditorialBanner
          source={SCREEN_BANNERS.economyFocusCoin}
          textureSource={TEXTURES.archivalPaper}
          eyebrow="ODAK EKONOMİSİ"
          title="Kredi Geçmişi"
          subtitle="Aylık yenilemeler ve AI kullanımlarının kayıt defteri."
          accentColor={colors.warning}
          minHeight={96}
          style={{ marginBottom: 14 }}
          rightSlot={
            <EmblemMedallion
              source={SCREEN_BANNERS.economyFocusCoin}
              size={46}
              unlocked
              accentColor={colors.warning}
            />
          }
        />

        {/* Özet */}
        <View style={s.summary}>
          <View style={s.sumCard}>
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.13} />
            <Ionicons name="flash" size={16} color={colors.warning} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={s.sumVal}>{focusPoints}</Text>
            <Text style={s.sumLabel}>Mevcut</Text>
          </View>
          <View style={s.sumCard}>
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.13} />
            <Ionicons name="add-circle-outline" size={16} color={colors.success} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={[s.sumVal, { color: colors.success }]}>{earned}</Text>
            <Text style={s.sumLabel}>Kazanılan</Text>
          </View>
          <View style={s.sumCard}>
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.13} />
            <Ionicons name="remove-circle-outline" size={16} color={colors.error} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={[s.sumVal, { color: colors.error }]}>{spent}</Text>
            <Text style={s.sumLabel}>Harcanan</Text>
          </View>
        </View>

        <ChapterDivider source={DECOR.dividerSundial} label="İŞLEM KAYIT DEFTERİ" style={{ marginBottom: 10 }} />

        {txs.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title="Henüz işlem yok"
            hint="AI kullandıkça veya abonelik aldıkça burada görünür"
          />
        ) : (
          txs.map((t) => {
            const m = reasonMeta(t.reason);
            const positive = t.delta > 0;
            return (
              <View key={t.id} style={s.row}>
                <View style={[s.rowIcon, { backgroundColor: alphaHex(positive ? colors.success : colors.error, '18') }]}>
                  <Ionicons name={m.icon as any} size={16} color={positive ? colors.success : colors.error} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.rowLabel}>{m.label}</Text>
                  <Text style={s.rowDate}>{format(new Date(t.created_at), 'dd.MM.yyyy HH:mm')}</Text>
                </View>
                <View style={s.rowRight}>
                  <Text style={[s.rowDelta, { color: positive ? colors.success : colors.error }]}>
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
  safe: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },

  summary: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  sumCard: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border, gap: 3,
    overflow: 'hidden', position: 'relative',
  },
  sumVal: { fontSize: 20, fontWeight: '800', color: colors.warning },
  sumLabel: { fontSize: 11, color: colors.textFaint },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: colors.surface, borderRadius: 12, padding: 12, marginBottom: 8,
    borderWidth: 1, borderColor: colors.border,
  },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { fontSize: 14, color: colors.text, fontWeight: '600' },
  rowDate: { fontSize: 11, color: colors.textFaint, marginTop: 2 },
  rowRight: { alignItems: 'flex-end' },
  rowDelta: { fontSize: 15, fontWeight: '800' },
  rowBal: { fontSize: 10, color: colors.textFaint, marginTop: 2 },

  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 16, color: colors.textDim, fontWeight: '600' },
  emptyHint: { fontSize: 12, color: colors.textFaint, textAlign: 'center' },
});
