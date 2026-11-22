import { colors, alphaHex, radius } from '../../lib/tokens';
import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useProfileStore } from '../../store/profileStore';
import { useSubscriptionStore } from '../../store/subscriptionStore';
import { rankMeta, RANK_TIERS } from '../../lib/ranks';
import XPDisplay from '../../components/XPDisplay';
// R04.02 — device-wide reminder settings and the real permission state.
import NotificationSettingsCard from '../../components/NotificationSettingsCard';
import YearlyHeatmap from '../../components/YearlyHeatmap';
import { EmblemMedallion, TexturedSurface } from '../../components/ui';
import { AtmosphericScreenCanvas, BentoVisualCard, ChapterDivider, EmbeddedFiligree } from '../../components/spatial';
import {
  ACHIEVEMENT_BADGES,
  BENTO_ART,
  CANVASES,
  DECOR,
  getAchievementBadge,
  getRankCrest,
  TEXTURES,
} from '../../lib/visualAssets';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, badges, fetchProfile, fetchBadges, setUsername } = useProfileStore();
  const focusPoints = useSubscriptionStore((st) => st.focusPoints);
  const fetchSub = useSubscriptionStore((st) => st.fetch);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { fetchProfile(); fetchBadges(); void fetchSub(); }, [fetchProfile, fetchBadges, fetchSub]);
  useEffect(() => { setName(profile?.username ?? ''); }, [profile?.username]);

  async function save() {
    setSaving(true);
    await setUsername(name);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  const tier = profile ? rankMeta(profile.willpower_rank, profile.level) : null;
  const nextTier = profile
    ? RANK_TIERS.find((t) => t.minLevel > profile.level)
    : undefined;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.pantheonHall}
        textureSource={TEXTURES.topographic}
        scrim={0.62}
        tintColor={colors.warning}
      />
      <ScrollView contentContainerStyle={s.content}>
        <XPDisplay />
        <YearlyHeatmap />
        <NotificationSettingsCard />

        {/* Rütbe kartı */}
        {tier && profile && (
          <View style={[s.rankCard, { borderColor: alphaHex(tier.color, '50'), backgroundColor: alphaHex(tier.color, '14') }]}>
            <TexturedSurface source={TEXTURES.topographic} textureOpacity={0.07} overlayOnly />
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.14} />
            <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="top-right" opacity={0.18} size={104} />
            <EmblemMedallion
              source={getRankCrest(tier.name)}
              size={64}
              unlocked
              accentColor={tier.color}
            />
            <Text style={[s.rankName, { color: tier.color }]}>{tier.name}</Text>
            <Text style={s.rankSub}>
              {nextTier
                ? `Lv ${nextTier.minLevel}'de "${nextTier.name}" rütbesine yüksel`
                : 'En yüksek rütbedesin! 🔥'}
            </Text>
          </View>
        )}

        {/* 3'lü Bento Özet Izgarası: Sıralama · Focus Points · Başarımlar */}
        <View style={s.bentoGrid}>
          <BentoVisualCard
            style={s.bentoItem}
            padding={12}
            artSource={BENTO_ART.profileLeague}
            artOpacity={0.42}
            scrim={0.72}
            accentColor={colors.warning}
            onPress={() => router.push('/screens/leaderboard' as any)}
            accessibilityLabel="Sıralamayı gör"
          >
            <View style={[s.bentoIconWrap, { backgroundColor: alphaHex(colors.warning, '22') }]}>
              <Ionicons name="podium-outline" size={18} color={colors.warning} />
            </View>
            <Text style={s.bentoTitle}>Sıralama</Text>
            <Text style={s.bentoSub}>Haftalık Lig →</Text>
          </BentoVisualCard>

          <BentoVisualCard
            style={s.bentoItem}
            padding={12}
            artSource={BENTO_ART.profileTreasury}
            artOpacity={0.42}
            scrim={0.72}
            accentColor={colors.primary}
            onPress={() => router.push('/screens/focus-points' as any)}
            accessibilityLabel="Focus Points ve kredi geçmişini gör"
          >
            <View style={[s.bentoIconWrap, { backgroundColor: alphaHex(colors.primary, '22') }]}>
              <Ionicons name="diamond-outline" size={18} color={colors.primary} />
            </View>
            <Text style={s.bentoTitle}>{focusPoints} FP</Text>
            <Text style={s.bentoSub}>Focus Points →</Text>
          </BentoVisualCard>

          <BentoVisualCard
            style={s.bentoItem}
            padding={12}
            artSource={BENTO_ART.profileVitrine}
            artOpacity={0.42}
            scrim={0.72}
            accentColor={colors.success}
            onPress={() => router.push('/screens/achievements' as any)}
            accessibilityLabel="Başarımlar ve rozetleri gör"
          >
            <View style={[s.bentoIconWrap, { backgroundColor: alphaHex(colors.success, '22') }]}>
              <Ionicons name="ribbon-outline" size={18} color={colors.success} />
            </View>
            <Text style={s.bentoTitle}>Rozetler</Text>
            <Text style={s.bentoSub}>{badges.length} Kazanım →</Text>
          </BentoVisualCard>
        </View>

        <ChapterDivider source={DECOR.dividerSundial} label="KİMLİK PASAPORTU" />

        {/* Kullanıcı adı */}
        <View style={s.section}>
          <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.11} />
          <Text style={s.sectionTitle}>KULLANICI ADI</Text>
          <Text style={s.sectionHint}>Sıralamada görünecek ad. Boş bırakırsan &quot;Gizli Savaşçı&quot; görünürsün.</Text>
          <View style={s.nameRow}>
            <TextInput
              style={s.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Gizli Savaşçı"
              placeholderTextColor={colors.textFaint}
              maxLength={24}
              autoCapitalize="none"
              accessibilityLabel="Kullanıcı adı"
            />
            <TouchableOpacity
              style={[s.saveBtn, saved && s.saveBtnDone]}
              onPress={save}
              disabled={saving}
              accessibilityRole="button"
              accessibilityLabel={saved ? 'Kullanıcı adı kaydedildi' : 'Kullanıcı adını kaydet'}
              accessibilityState={{ disabled: saving, busy: saving }}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.white} />
              ) : saved ? (
                <Ionicons name="checkmark" size={18} color={colors.white} />
              ) : (
                <Text style={s.saveBtnText}>Kaydet</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Rozetler */}
        <View style={s.section}>
          <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" opacity={0.14} size={110} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={s.sectionTitle}>ROZETLER {badges.length > 0 ? `(${badges.length})` : ''}</Text>
            <TouchableOpacity
              onPress={() => router.push('/screens/achievements' as any)}
              accessibilityRole="link"
              accessibilityLabel="Tüm başarımları ve rozetleri gör"
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: colors.warning }}>Tümünü Gör →</Text>
            </TouchableOpacity>
          </View>
          {badges.length === 0 ? (
            <TouchableOpacity
              onPress={() => router.push('/screens/achievements' as any)}
              style={{ paddingVertical: 4 }}
              accessibilityRole="link"
              accessibilityLabel="Başarımlar galerisini aç"
            >
              <Text style={s.sectionHint}>
                Henüz rozet yok. Alışkanlıklarını tamamladıkça rozet kazanırsın. Dokun ve hedefleri incele.
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={s.badgeGrid}>
              {badges.map((b) => (
                <View key={b.id} style={s.badge}>
                  {b.id in ACHIEVEMENT_BADGES ? (
                    <EmblemMedallion
                      source={getAchievementBadge(b.id)}
                      size={42}
                      unlocked
                      accentColor={colors.warning}
                    />
                  ) : (
                    <Text style={s.badgeIcon}>{b.icon ?? '🏅'}</Text>
                  )}
                  <Text style={s.badgeName} numberOfLines={1}>{b.badge_name}</Text>
                  {b.description ? (
                    <Text style={s.badgeDesc} numberOfLines={2}>{b.description}</Text>
                  ) : null}
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40, gap: 14 },

  rankCard: {
    alignItems: 'center', gap: 6, borderRadius: 18, borderWidth: 1, padding: 18,
    overflow: 'hidden', position: 'relative',
  },
  rankIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  rankName: { fontSize: 20, fontWeight: '800' },
  rankSub: { fontSize: 12, color: colors.textFaint, textAlign: 'center' },

  lbBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 16, paddingVertical: 14,
  },
  lbText: { flex: 1, fontSize: 15, fontWeight: '700', color: colors.text },
  bentoGrid: {
    flexDirection: 'row', gap: 10,
  },
  bentoItem: {
    flex: 1,
  },
  bentoIconWrap: {
    width: 34, height: 34, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', marginBottom: 6,
  },
  bentoTitle: { fontSize: 14, fontWeight: '800', color: colors.text },
  bentoSub: { fontSize: 11, fontWeight: '600', color: colors.textDim, marginTop: 2 },

  section: {
    backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1, borderColor: colors.border,
    padding: 16, gap: 8, overflow: 'hidden', position: 'relative',
  },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: colors.textFaint, letterSpacing: 1 },
  sectionHint: { fontSize: 12, color: colors.textFaint, lineHeight: 17 },

  nameRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  nameInput: {
    flex: 1, backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: colors.text,
  },
  saveBtn: {
    minWidth: 76, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.warning, borderRadius: 12, paddingHorizontal: 16,
  },
  saveBtnDone: { backgroundColor: colors.success },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: colors.white },

  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  badge: {
    width: '47%', backgroundColor: colors.bg, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    padding: 12, gap: 3, alignItems: 'center',
  },
  badgeIcon: { fontSize: 26 },
  badgeName: { fontSize: 12, fontWeight: '700', color: colors.text, textAlign: 'center' },
  badgeDesc: { fontSize: 10, color: colors.textFaint, textAlign: 'center', lineHeight: 14 },
});
