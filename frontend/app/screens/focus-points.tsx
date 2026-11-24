/**
 * Focus Points — what you have, what it buys, when it renews.
 *
 * ## What this screen replaced
 *
 * It used to be `paywall.tsx`: Nexus Plus and Nexus Pro side by side, a
 * weekly/monthly/yearly period switcher, prices in dollars, an "EN POPÜLER"
 * ribbon, an "Abone Ol" button on each card, and a footnote admitting that
 * the button was a test affordance and real payment would arrive "yayına
 * çıkmadan".
 *
 * None of it could complete a purchase. There is no StoreKit product, no Play
 * Billing product and no payment processor, and the RPC the button called had
 * its EXECUTE revoked server-side in `003_emergency_gate_0_revoke_mock_…`. So
 * a release build offered a price and a buy button that could only answer
 * "satın alma henüz kullanılamıyor". That is rejectable under Apple 3.1.1 and
 * Play's payments policy, and it is untrue regardless of any store.
 *
 * The owner's decision is FREE for the MVP (`docs/store/OWNER_DECISIONS.md`),
 * so the honest version of this screen is not a smaller paywall — it is not a
 * paywall. What a user actually needs to know is how many Focus Points they
 * have, what each AI action costs, and that the balance comes back every
 * month. That is the whole screen.
 *
 * ## What did NOT change
 *
 * Focus Point economics. The free grant, `ACTION_COST` and the monthly
 * renewal are exactly as they were; the FREE tier was always the one the
 * server-side grant funds. `lib/subscription.ts` keeps its tier definitions
 * and prices so that turning `PAID_SUBSCRIPTIONS_ENABLED` back on is a
 * rendering change, not archaeology.
 */
import { useEffect, type ComponentProps } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { alphaHex, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { TIERS, ACTION_COST, creditsSummary } from '../../lib/subscription';
import {
  PAID_SUBSCRIPTIONS_ENABLED,
  PAID_SUBSCRIPTIONS_DISABLED_REASON,
} from '../../lib/featureGates';
import { EmblemMedallion, TexturedSurface } from '../../components/ui';
import { AtmosphericScreenCanvas, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import { CANVASES, DECOR, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

/** What a Focus Point is spent on, in the order a new user meets them. */
const SPEND: { icon: ComponentProps<typeof Ionicons>['name']; label: string; cost: number }[] = [
  { icon: 'chatbubbles-outline', label: 'AI Coach mesajı', cost: ACTION_COST.coach },
  { icon: 'sparkles-outline', label: 'AI rutin oluşturma', cost: ACTION_COST.routine },
  { icon: 'document-text-outline', label: 'Günlük özeti', cost: ACTION_COST.summarize },
  { icon: 'analytics-outline', label: 'AI içgörüleri', cost: ACTION_COST.insights },
];

const MONTHS = [
  'Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran',
  'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık',
];

/**
 * `credits_period_end` as "12 Ekim", or null when the server has not set one.
 * Written by hand rather than through `Intl` so the string is identical on
 * every engine and locale setting.
 */
function renewalLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export default function FocusPointsScreen() {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const router = useRouter();
  const { tier, focusPoints, monthlyGrant, creditsPeriodEnd, fetch, loaded } = useSubscriptionStore(
    useShallow((st) => ({
      tier: st.tier,
      focusPoints: st.focusPoints,
      monthlyGrant: st.monthlyGrant,
      creditsPeriodEnd: st.creditsPeriodEnd,
      fetch: st.fetch,
      loaded: st.loaded,
    })),
  );

  useEffect(() => { if (!loaded) fetch(); }, [loaded, fetch]);

  const summary = creditsSummary(focusPoints);
  const renews = renewalLabel(creditsPeriodEnd);
  const plan = TIERS[tier];

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.treasuryVault}
        textureSource={TEXTURES.archivalPaper}
        scrim={0.62}
        tintColor={colors.warning}
      />
      <ScrollView contentContainerStyle={s.content}>
        {/* Balance */}
        <View style={s.balanceCard}>
          <TexturedSurface source={TEXTURES.topographic} textureOpacity={0.07} overlayOnly />
          <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.15} />
          <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="top-right" opacity={0.18} size={110} />
          <EmblemMedallion
            source={SCREEN_BANNERS.economyFocusCoin}
            size={58}
            unlocked
            accentColor={colors.warning}
            style={{ marginBottom: 8 }}
          />
          <Text style={s.balanceLabel}>Focus Point bakiyen</Text>
          <View style={s.balanceRow}>
            <Ionicons
              name="flash"
              size={26}
              color={colors.warning}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={s.balanceVal}>{focusPoints}</Text>
            <Text style={s.balanceUnit}>FP</Text>
          </View>
          <Text style={s.balanceHint}>
            {`≈ ${summary.coach} koç sohbeti ya da ${summary.routine} AI rutin`}
          </Text>
        </View>

        {/* Plan + renewal, stated as fact rather than as an offer */}
        <View style={s.planRow}>
          <View style={s.planCell}>
            <Text style={s.cellLabel}>Planın</Text>
            <Text style={s.cellVal}>{plan.name}</Text>
          </View>
          <View style={s.cellDivider} />
          <View style={s.planCell}>
            <Text style={s.cellLabel}>Her ay</Text>
            <Text style={s.cellVal}>{`${monthlyGrant} FP`}</Text>
          </View>
        </View>
        {renews ? (
          <Text style={s.renewNote}>{`Bakiyen ${renews} tarihinde ${monthlyGrant} FP olarak yenilenir.`}</Text>
        ) : (
          <Text style={s.renewNote}>Bakiyen her ay yenilenir.</Text>
        )}

        {/* What it buys */}
        <Text style={s.sectionTitle}>Focus Point nerede harcanır</Text>
        <View style={s.card}>
          <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.1} />
          {SPEND.map((row, i) => (
            <View key={row.label} style={[s.spendRow, i > 0 && s.spendRowBorder]}>
              <Ionicons
                name={row.icon}
                size={17}
                color={colors.textDim}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
              <Text style={s.spendLabel}>{row.label}</Text>
              <Text style={s.spendCost}>{`${row.cost} FP`}</Text>
            </View>
          ))}
          <Text style={s.spendFoot}>
            Alışkanlık takibi, istatistikler, odak seansları ve raporlar Focus Point harcamaz.
          </Text>
        </View>

        <ChapterDivider source={DECOR.dividerSundial} label="HAZİNE PLANI" style={{ marginTop: 18 }} />

        {/* Üyelik Katmanları & Karşılaştırma */}
        <Text style={[s.sectionTitle, { marginTop: 6 }]}>Üyelik Katmanları</Text>
        <View style={{ gap: 12 }}>
          {([TIERS.free, TIERS.plus, TIERS.pro]).map((t) => (
            <View
              key={t.key}
              style={[
                s.tierCard,
                t.key === tier && s.tierCardActive,
                { borderColor: t.key === tier ? t.color : colors.border },
              ]}
            >
              <EmbeddedFiligree source={DECOR.guillocheWave} anchor="bottom-right" opacity={0.12} size={110} />
              <View style={s.tierHeader}>
                <View>
                  <Text style={[s.tierName, { color: t.color }]}>{t.name}</Text>
                  <Text style={s.tierTagline}>{t.tagline}</Text>
                </View>
                <View style={[s.tierGrantBadge, { backgroundColor: alphaHex(t.color, '18') }]}>
                  <Text style={[s.tierGrantText, { color: t.color }]}>{t.grant} FP / ay</Text>
                </View>
              </View>

              <View style={s.tierDivider} />

              <View style={{ gap: 6 }}>
                {t.features.map((feat) => (
                  <View key={feat} style={s.tierFeatRow}>
                    <Ionicons name="checkmark-circle" size={14} color={t.color} />
                    <Text style={s.tierFeatText}>{feat}</Text>
                  </View>
                ))}
              </View>

              {t.key === tier && (
                <View style={s.activeBadge}>
                  <Text style={s.activeBadgeText}>Şu Anki Planın (Aktif)</Text>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* The one thing a user might otherwise wonder about */}
        {!PAID_SUBSCRIPTIONS_ENABLED && (
          <View style={s.freeCard}>
            <Ionicons
              name="checkmark-circle-outline"
              size={18}
              color={colors.success}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
            <Text style={s.freeText}>{PAID_SUBSCRIPTIONS_DISABLED_REASON}</Text>
          </View>
        )}

        <TouchableOpacity
          style={s.historyBtn}
          onPress={() => router.push('/screens/credit-history')}
          accessibilityRole="button"
          accessibilityLabel="Kredi geçmişini aç"
        >
          <Ionicons
            name="receipt-outline"
            size={16}
            color={colors.accent}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text style={s.historyText}>Kredi geçmişi</Text>
          <Ionicons
            name="chevron-forward"
            size={16}
            color={colors.textFaint}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    content: { padding: 16, paddingBottom: 40 },

    balanceCard: {
      backgroundColor: colors.surface, borderRadius: 18, padding: 20,
      borderWidth: 1, borderColor: colors.border, alignItems: 'center',
      overflow: 'hidden', position: 'relative',
    },
    balanceLabel: { fontSize: 12, color: colors.textFaint },
    balanceRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    balanceVal: { fontSize: 40, fontWeight: '800', color: colors.warning },
    balanceUnit: { fontSize: 15, fontWeight: '700', color: colors.warning, marginTop: 10 },
    balanceHint: { fontSize: 12, color: colors.textFaint, marginTop: 6 },

    planRow: {
      flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
      borderRadius: 14, borderWidth: 1, borderColor: colors.border,
      paddingVertical: 14, marginTop: 12,
    },
    planCell: { flex: 1, alignItems: 'center' },
    cellDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
    cellLabel: { fontSize: 11, color: colors.textFaint },
    cellVal: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: 3 },
    renewNote: { fontSize: 12, color: colors.textFaint, marginTop: 8, paddingHorizontal: 4 },

    sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textDim, marginTop: 22, marginBottom: 8, paddingHorizontal: 4 },
    card: {
      backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
      paddingHorizontal: 14, overflow: 'hidden', position: 'relative',
    },
    spendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
    spendRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
    spendLabel: { flex: 1, fontSize: 14, color: colors.text },
    spendCost: { fontSize: 13, fontWeight: '700', color: colors.warning },
    spendFoot: { fontSize: 12, color: colors.textFaint, lineHeight: 18, paddingBottom: 14, paddingTop: 2 },

    freeCard: {
      flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 16,
      backgroundColor: alphaHex(colors.success, '14'), borderRadius: 14, padding: 14,
    },
    freeText: { flex: 1, fontSize: 13, color: colors.text, lineHeight: 19 },

    historyBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16,
      backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
      paddingVertical: 14, paddingHorizontal: 14,
    },
    historyText: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.accent },

    tierCard: {
      backgroundColor: colors.surface,
      borderRadius: 16,
      borderWidth: 1,
      padding: 16,
      gap: 12,
      overflow: 'hidden',
      position: 'relative',
    },
    tierCardActive: {
      backgroundColor: alphaHex(colors.surface, '95'),
    },
    tierHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
    },
    tierName: {
      fontSize: 16,
      fontWeight: '800',
    },
    tierTagline: {
      fontSize: 11,
      color: colors.textFaint,
      marginTop: 2,
    },
    tierGrantBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 8,
    },
    tierGrantText: {
      fontSize: 11,
      fontWeight: '700',
    },
    tierDivider: {
      height: 1,
      backgroundColor: colors.borderSubtle,
    },
    tierFeatRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    tierFeatText: {
      fontSize: 12,
      color: colors.textDim,
    },
    activeBadge: {
      alignSelf: 'flex-start',
      backgroundColor: alphaHex(colors.success, '20'),
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      marginTop: 4,
    },
    activeBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      color: colors.success,
    },
  });
