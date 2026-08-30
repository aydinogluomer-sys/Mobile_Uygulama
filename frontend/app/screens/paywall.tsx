import { colors } from '../../lib/tokens';
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import {
  TIERS, PERIOD_LABEL, priceLabel, creditsSummary,
  type Tier, type BillingPeriod,
} from '../../lib/subscription';

const PERIODS: BillingPeriod[] = ['weekly', 'monthly', 'yearly'];

export default function PaywallScreen() {
  const router = useRouter();
  const { tier, focusPoints, billingPeriod, fetch, activateMock, loaded } = useSubscriptionStore();
  const [period, setPeriod] = useState<BillingPeriod>('yearly');
  const [activating, setActivating] = useState<Tier | null>(null);

  useEffect(() => { if (!loaded) fetch(); }, [loaded, fetch]);

  const summary = creditsSummary(focusPoints);

  async function handleActivate(t: Exclude<Tier, 'free'>) {
    // Test activation is a development affordance only. In a release build the
    // underlying RPC is revoked server-side, so we say so plainly instead of
    // firing a call that can only fail.
    if (!__DEV__) {
      Alert.alert(
        'Satın alma henüz kullanılamıyor',
        'Uygulama içi satın alma entegrasyonu (App Store / Google Play) henüz tamamlanmadı. Bu sürümde abonelik satın alınamaz.',
      );
      return;
    }
    const usablePeriod: BillingPeriod = TIERS[t].prices?.[period] != null ? period : 'monthly';
    setActivating(t);
    const ok = await activateMock(t, usablePeriod);
    setActivating(null);
    if (ok) {
      Alert.alert(
        '🎉 Abonelik Aktif (Test)',
        `${TIERS[t].name} aktifleştirildi ve ${TIERS[t].grant} Focus Point yüklendi.\n\nNot: Bu test aktivasyonudur; gerçek ödeme entegrasyonu (App Store / Play) eklendiğinde gerçek satın alma ile değişecek.`,
      );
    } else {
      Alert.alert(
        'Test aktivasyonu başarısız',
        'mock_activate_subscription çağrısı reddedildi. Bu bir oturum sorunu değildir; fonksiyonun EXECUTE yetkisi sunucuda kaldırılmış olabilir.',
      );
    }
  }

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content}>
        {/* Mevcut durum */}
        <View style={s.statusCard}>
          <View>
            <Text style={s.statusLabel}>Mevcut Plan</Text>
            <Text style={[s.statusTier, { color: TIERS[tier].color }]}>{TIERS[tier].name}</Text>
          </View>
          <View style={s.fpBox}>
            <Ionicons name="flash" size={16} color="#D4A84A" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            <Text style={s.fpVal}>{focusPoints}</Text>
            <Text style={s.fpUnit}>FP</Text>
          </View>
        </View>
        <View style={s.fpHintRow}>
          <Text style={s.fpHint}>
            ≈ {summary.coach} koç sohbeti ya da {summary.routine} AI rutin · her ay yenilenir
          </Text>
          <TouchableOpacity
            style={s.historyLink}
            onPress={() => router.push('/screens/credit-history')}
            accessibilityRole="link"
            accessibilityLabel="Kredi geçmişini aç"
          >
            <Ionicons name="receipt-outline" size={13} color="#D97757" />
            <Text style={s.historyLinkText}>Geçmiş</Text>
          </TouchableOpacity>
        </View>

        {/* Periyot seçici */}
        <View style={s.periodRow}>
          {PERIODS.map((p) => {
            const sel = period === p;
            return (
              <TouchableOpacity
                key={p}
                style={[s.periodBtn, sel && s.periodBtnSel]}
                onPress={() => setPeriod(p)}
                accessibilityRole="tab"
                accessibilityLabel={p === 'yearly' ? `${PERIOD_LABEL[p]} — en avantajlı` : PERIOD_LABEL[p]}
                accessibilityState={{ selected: sel }}
              >
                <Text style={[s.periodText, sel && s.periodTextSel]}>{PERIOD_LABEL[p]}</Text>
                {p === 'yearly' && <Text style={s.periodBadge}>en avantajlı</Text>}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Planlar — Pro önce (çıpalama) */}
        {(['pro', 'plus'] as const).map((t) => {
          const cfg = TIERS[t];
          const price = priceLabel(t, period);
          const available = price != null;
          const isCurrent = tier === t && (billingPeriod === period || !available);
          const featured = t === 'pro';
          return (
            <View key={t} style={[s.planCard, { borderColor: cfg.color + '55' }, featured && s.planFeatured]}>
              {featured && (
                <View style={[s.ribbon, { backgroundColor: cfg.color }]}>
                  <Text style={s.ribbonText}>EN POPÜLER</Text>
                </View>
              )}
              <View style={s.planHead}>
                <View>
                  <Text style={[s.planName, { color: cfg.color }]}>{cfg.name}</Text>
                  <Text style={s.planTag}>{cfg.tagline}</Text>
                </View>
                <View style={s.priceCol}>
                  {available ? (
                    <>
                      <Text style={s.planPrice}>{price}</Text>
                      <Text style={s.planPer}>/{PERIOD_LABEL[period].toLowerCase()}</Text>
                    </>
                  ) : (
                    <Text style={s.planNa}>Bu periyot{'\n'}yok</Text>
                  )}
                </View>
              </View>

              <View style={s.grantPill}>
                <Ionicons name="flash" size={13} color="#D4A84A" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                <Text style={s.grantText}>Aylık {cfg.grant} Focus Point</Text>
              </View>

              {cfg.features.map((f) => (
                <View key={f} style={s.featRow}>
                  <Ionicons name="checkmark-circle" size={16} color={cfg.color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                  <Text style={s.featText}>{f}</Text>
                </View>
              ))}

              <TouchableOpacity
                style={[s.subBtn, { backgroundColor: cfg.color }, (isCurrent || activating === t) && s.subBtnDisabled]}
                onPress={() => handleActivate(t)}
                disabled={isCurrent || activating === t}
                accessibilityRole="button"
                accessibilityLabel={
                  activating === t
                    ? `${cfg.name} aboneliği etkinleştiriliyor`
                    : isCurrent
                      ? `${cfg.name}: mevcut planın`
                      : available
                        ? `${cfg.name} planına abone ol, ${price} ${PERIOD_LABEL[period].toLowerCase()}`
                        : `${cfg.name} aylık plana geç`
                }
                accessibilityState={{ disabled: isCurrent || activating === t, busy: activating === t }}
              >
                {activating === t ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Text style={s.subBtnText}>
                    {isCurrent ? 'Mevcut Planın' : available ? `${cfg.name} — Abone Ol` : 'Aylık Plana Geç'}
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          );
        })}

        {/* Mock notu */}
        <View style={s.mockNote}>
          <Ionicons name="information-circle-outline" size={16} color="#827E72" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          <Text style={s.mockText}>
            Test modu: Abone Ol şu an krediyi hemen yükler. Gerçek ödeme (App Store / Google Play / Stripe) entegrasyonu yayına çıkmadan eklenecek.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },

  statusCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: colors.surface, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.border,
  },
  statusLabel: { fontSize: 12, color: colors.textFaint },
  statusTier: { fontSize: 22, fontWeight: '800', marginTop: 2 },
  fpBox: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#D4A84A18', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8 },
  fpVal: { fontSize: 20, fontWeight: '800', color: colors.warning },
  fpUnit: { fontSize: 12, color: colors.warning, fontWeight: '600' },
  fpHintRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 18, paddingHorizontal: 4 },
  fpHint: { flex: 1, fontSize: 12, color: colors.textFaint },
  historyLink: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  historyLinkText: { fontSize: 12, color: colors.accent, fontWeight: '600' },

  periodRow: { flexDirection: 'row', gap: 8, marginBottom: 18 },
  periodBtn: {
    flex: 1, alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.border,
  },
  periodBtnSel: { backgroundColor: '#D9775720', borderColor: colors.accent },
  periodText: { fontSize: 13, color: colors.textDim, fontWeight: '600' },
  periodTextSel: { color: colors.accent },
  periodBadge: { fontSize: 9, color: colors.success, marginTop: 2 },

  planCard: { backgroundColor: colors.surface, borderRadius: 18, padding: 18, borderWidth: 1.5, marginBottom: 14 },
  planFeatured: { borderWidth: 2 },
  ribbon: { position: 'absolute', top: -1, right: 16, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  ribbonText: { fontSize: 10, fontWeight: '800', color: colors.white, letterSpacing: 0.5 },
  planHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12, marginTop: 6 },
  planName: { fontSize: 20, fontWeight: '800' },
  planTag: { fontSize: 12, color: colors.textFaint, marginTop: 2 },
  priceCol: { alignItems: 'flex-end' },
  planPrice: { fontSize: 24, fontWeight: '800', color: colors.white },
  planPer: { fontSize: 11, color: colors.textFaint },
  planNa: { fontSize: 11, color: colors.textFaint, textAlign: 'right' },

  grantPill: {
    flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: '#D4A84A14', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, marginBottom: 12,
  },
  grantText: { fontSize: 12, color: colors.warning, fontWeight: '700' },

  featRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 7 },
  featText: { fontSize: 13, color: colors.text, flex: 1 },

  subBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 12 },
  subBtnDisabled: { opacity: 0.45 },
  subBtnText: { fontSize: 15, fontWeight: '700', color: colors.white },

  mockNote: { flexDirection: 'row', gap: 8, backgroundColor: colors.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: colors.border, marginTop: 6 },
  mockText: { flex: 1, fontSize: 11, color: colors.textFaint, lineHeight: 16 },
});
