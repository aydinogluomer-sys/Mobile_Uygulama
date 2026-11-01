import { colors, alphaHex } from '../../lib/tokens';
import { useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useProfileStore, LeaderboardScope } from '../../store/profileStore';
import { rankMeta } from '../../lib/ranks';
import {
  AtmosphericScreenCanvas,
  ChapterDivider,
  EditorialBanner,
  EmbeddedFiligree,
  EmblemMedallion,
  EmptyState,
  Skeleton,
} from '../../components/ui';
import { CANVASES, DECOR, getRankCrest, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';

const MEDALS = ['🥇', '🥈', '🥉'];
const ROMAN_PODIUM = ['I', 'II', 'III'] as const;

export default function LeaderboardScreen() {
  const {
    profile, fetchProfile,
    leaderboard, scope, lbLoading, fetchLeaderboard,
    myRank, fetchMyRank,
  } = useProfileStore();

  useEffect(() => {
    fetchProfile();
    fetchMyRank();
    fetchLeaderboard('global');
  }, [fetchProfile, fetchMyRank, fetchLeaderboard]);

  function switchScope(sc: LeaderboardScope) {
    if (sc !== scope) fetchLeaderboard(sc);
  }

  function refresh() {
    fetchMyRank();
    fetchLeaderboard(scope);
  }

  const myTier = profile ? rankMeta(profile.willpower_rank, profile.level) : null;
  const podiumOrder =
    !lbLoading && leaderboard.length >= 3
      ? [leaderboard[1], leaderboard[0], leaderboard[2]]
      : null;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.pantheonHall}
        textureSource={TEXTURES.topographic}
        scrim={0.62}
        tintColor={colors.warning}
      />

      {/* Sekmeler */}
      <View style={s.tabs}>
        {(['global', 'weekly'] as LeaderboardScope[]).map((sc) => (
          <TouchableOpacity
            key={sc}
            style={[s.tab, scope === sc && s.tabActive]}
            onPress={() => switchScope(sc)}
            accessibilityRole="tab"
            accessibilityLabel={`${sc === 'global' ? 'Global' : 'Bu haftanın'} sıralaması`}
            accessibilityState={{ selected: scope === sc }}
          >
            <Text style={[s.tabText, scope === sc && s.tabTextActive]}>
              {sc === 'global' ? 'Global' : 'Bu Hafta'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={lbLoading} onRefresh={refresh} tintColor={colors.warning} />}
      >
        <EditorialBanner
          source={SCREEN_BANNERS.leaderboardPantheon}
          textureSource={TEXTURES.topographic}
          eyebrow="İRADE LİGİ"
          title="Sıralama & Podyum"
          subtitle="Disiplinini koruyanların haftalık ve genel tablosu."
          accentColor={colors.warning}
          minHeight={98}
        />

        {/* Senin sıran kartı */}
        {profile && (
          <View style={s.meCard}>
            <EmbeddedFiligree source={DECOR.guillocheWave} anchor="full-bleed" opacity={0.14} />
            <View style={s.meRankWrap}>
              <Text style={s.meRankLabel}>SIRAN</Text>
              <Text style={s.meRank}>{myRank ? `#${myRank}` : '—'}</Text>
            </View>
            {myTier ? (
              <EmblemMedallion
                source={getRankCrest(myTier.name)}
                size={42}
                unlocked
                accentColor={myTier.color}
              />
            ) : null}
            <View style={{ flex: 1 }}>
              <Text style={s.meName} numberOfLines={1}>
                {profile.username || 'Sen (Gizli Savaşçı)'}
              </Text>
              {myTier && (
                <View style={s.meRankRow}>
                  <Ionicons name={myTier.icon} size={13} color={myTier.color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                  <Text style={[s.meTier, { color: myTier.color }]}>{myTier.name}</Text>
                  <Text style={s.meLevel}>· Lv {profile.level}</Text>
                </View>
              )}
            </View>
            <Text style={s.meXp}>{profile.total_xp} XP</Text>
          </View>
        )}

        {/* Mimari Top-3 Pantheon Podyum Sahnesi (2. - 1. - 3.) */}
        {podiumOrder ? (
          <>
            <ChapterDivider source={DECOR.dividerSundial} label="PANTHEON PODYUMU" />
            <View style={s.podiumStage}>
              {podiumOrder.map((entry) => {
                const idx = entry.rank - 1;
                const isFirst = entry.rank === 1;
                const tier = rankMeta(entry.willpower_rank, entry.level);
                const val = scope === 'weekly' ? (entry.weekly_xp ?? 0) : entry.total_xp;
                const accent =
                  entry.rank === 1 ? colors.warning : entry.rank === 2 ? colors.info : colors.primary;
                return (
                  <View
                    key={`podium-${entry.user_id}`}
                    style={[
                      s.podiumColumn,
                      isFirst ? s.podiumColumnFirst : s.podiumColumnSide,
                      { borderColor: alphaHex(accent, isFirst ? '55' : '30') },
                    ]}
                  >
                    <EmbeddedFiligree
                      source={DECOR.cornerAstrolabe}
                      anchor="bottom-right"
                      opacity={isFirst ? 0.2 : 0.12}
                      size={80}
                    />
                    <View style={[s.podiumRomanPill, { backgroundColor: alphaHex(accent, '20') }]}>
                      <Text style={[s.podiumRomanText, { color: accent }]}>
                        {ROMAN_PODIUM[idx] ?? entry.rank} · {MEDALS[idx] ?? ''}
                      </Text>
                    </View>
                    <EmblemMedallion
                      source={getRankCrest(tier.name)}
                      size={isFirst ? 54 : 44}
                      unlocked
                      accentColor={accent}
                    />
                    <Text style={[s.podiumName, isFirst && s.podiumNameFirst]} numberOfLines={1}>
                      {entry.username}
                    </Text>
                    <Text style={[s.podiumTier, { color: tier.color }]} numberOfLines={1}>
                      {tier.name}
                    </Text>
                    <Text style={[s.podiumXp, { color: accent }]}>{val} XP</Text>
                  </View>
                );
              })}
            </View>
            <ChapterDivider source={DECOR.dividerSundial} label="LİG SIRALAMASI" />
          </>
        ) : null}

        {lbLoading && leaderboard.length === 0 ? (
          // Sıra satırlarının geometrisi sabit — spinner yerine o şekli kur.
          Array.from({ length: 6 }, (_, i) => (
            <View key={i} style={s.row}>
              <View style={s.rankCol}><Skeleton width={18} height={14} /></View>
              <View style={{ flex: 1, gap: 6 }}>
                <Skeleton width="55%" height={13} />
                <Skeleton width="35%" height={10} />
              </View>
              <Skeleton width={54} height={13} />
            </View>
          ))
        ) : leaderboard.length === 0 ? (
          <EmptyState
            icon="trophy-outline"
            title="Sıralama henüz boş"
            hint="Alışkanlıklarını tamamlayıp XP kazandığında burada görünürsün."
            color={colors.warning}
          />
        ) : (
          leaderboard.map((row) => {
            const tier = rankMeta(row.willpower_rank, row.level);
            const isMe = profile?.id === row.user_id;
            const value = scope === 'weekly' ? (row.weekly_xp ?? 0) : row.total_xp;
            const idx = row.rank - 1;
            return (
              <View key={row.user_id} style={[s.row, isMe && s.rowMe]}>
                <View style={s.rankCol}>
                  <Text style={[s.rankNum, idx < 3 && s.rankTop]}>
                    {idx < 3 ? MEDALS[idx] : row.rank}
                  </Text>
                </View>
                <EmblemMedallion
                  source={getRankCrest(tier.name)}
                  size={34}
                  unlocked
                  accentColor={tier.color}
                />
                <View style={{ flex: 1 }}>
                  <Text style={[s.name, isMe && s.nameMe]} numberOfLines={1}>
                    {row.username}{isMe ? ' (sen)' : ''}
                  </Text>
                  <View style={s.rankRow}>
                    <Ionicons name={tier.icon} size={11} color={tier.color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
                    <Text style={[s.tier, { color: tier.color }]}>{tier.name}</Text>
                    <Text style={s.lvl}>· Lv {row.level}</Text>
                  </View>
                </View>
                <Text style={s.xp}>{value} XP</Text>
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

  tabs: { flexDirection: 'row', gap: 8, padding: 12, paddingBottom: 4 },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 12,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: alphaHex(colors.warning, '20'), borderColor: colors.warning },
  tabText: { fontSize: 13, fontWeight: '700', color: colors.textFaint },
  tabTextActive: { color: colors.warning },

  content: { padding: 12, paddingBottom: 40, gap: 8 },

  meCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: alphaHex(colors.warning, '12'), borderRadius: 16, borderWidth: 1, borderColor: alphaHex(colors.warning, '40'),
    padding: 14, marginBottom: 4, overflow: 'hidden', position: 'relative',
  },
  meRankWrap: { alignItems: 'center', minWidth: 48 },
  meRankLabel: { fontSize: 9, fontWeight: '800', color: colors.textFaint, letterSpacing: 1 },
  meRank: { fontSize: 20, fontWeight: '800', color: colors.warning },
  meName: { fontSize: 15, fontWeight: '700', color: colors.text },
  meRankRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  meTier: { fontSize: 12, fontWeight: '700' },
  meLevel: { fontSize: 12, color: colors.textFaint },
  meXp: { fontSize: 15, fontWeight: '800', color: colors.warning },

  podiumStage: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    marginVertical: 4,
  },
  podiumColumn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 8,
    alignItems: 'center',
    gap: 5,
    overflow: 'hidden',
    position: 'relative',
  },
  podiumColumnFirst: {
    paddingVertical: 18,
    backgroundColor: alphaHex(colors.warning, '10'),
  },
  podiumColumnSide: {
    paddingVertical: 12,
  },
  podiumRomanPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
  },
  podiumRomanText: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  podiumName: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
  },
  podiumNameFirst: {
    fontSize: 13,
    fontWeight: '800',
  },
  podiumTier: {
    fontSize: 10,
    fontWeight: '700',
  },
  podiumXp: {
    fontSize: 12,
    fontWeight: '800',
    marginTop: 2,
  },

  row: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border,
    paddingVertical: 12, paddingHorizontal: 12,
  },
  rowMe: { borderColor: colors.warning, backgroundColor: alphaHex(colors.warning, '12') },
  rankCol: { width: 34, alignItems: 'center' },
  rankNum: { fontSize: 15, fontWeight: '800', color: colors.textDim },
  rankTop: { fontSize: 20 },
  name: { fontSize: 14, fontWeight: '600', color: colors.text },
  nameMe: { color: colors.warning },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  tier: { fontSize: 11, fontWeight: '700' },
  lvl: { fontSize: 11, color: colors.textFaint },
  xp: { fontSize: 14, fontWeight: '800', color: colors.textDim },

  empty: { alignItems: 'center', gap: 12, paddingTop: 60, paddingHorizontal: 30 },
  emptyText: { fontSize: 13, color: colors.textFaint, textAlign: 'center', lineHeight: 19 },
});
