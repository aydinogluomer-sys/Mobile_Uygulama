import { colors, hexA } from '../lib/tokens';
import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useProfileStore } from '../store/profileStore';
import { rankMeta } from '../lib/ranks';
import { getRankCrest, TEXTURES } from '../lib/visualAssets';
import EmblemMedallion from './ui/EmblemMedallion';
import TexturedSurface from './ui/TexturedSurface';

/**
 * Kullanıcının XP/level/rütbe özeti. Supabase `profiles` tablosundan beslenir
 * (XP, alışkanlık tamamlamada server-side trigger'larla kazanılır).
 */
export default function XPDisplay() {
  const { profile, fetchProfile } = useProfileStore();

  useEffect(() => { fetchProfile(); }, [fetchProfile]);

  if (!profile) return null;

  const tier = rankMeta(profile.willpower_rank, profile.level);
  const next = profile.next_level_xp || 100;
  const pct = Math.max(0, Math.min(100, Math.round((profile.current_level_xp / next) * 100)));

  return (
    <View style={s.container}>
      <TexturedSurface source={TEXTURES.topographic} textureOpacity={0.06} overlayOnly />
      <EmblemMedallion source={getRankCrest(tier.name)} size={54} unlocked accentColor={tier.color} />

      <View style={s.info}>
        <View style={s.rankRow}>
          <View style={[s.lvlChip, { backgroundColor: hexA(tier.color, 0.18), borderColor: hexA(tier.color, 0.45) }]}>
            <Text style={[s.lvlChipText, { color: tier.color }]}>LVL {profile.level}</Text>
          </View>
          <Text style={[s.rankText, { color: tier.color }]}>{tier.name}</Text>
          <Text style={s.totalXp}>· {profile.total_xp} XP</Text>
        </View>

        <View style={s.barBg}>
          <View style={[s.barFill, { width: `${pct}%`, backgroundColor: tier.color }]} />
        </View>
        <Text style={s.xpText}>{profile.current_level_xp}/{next} XP</Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    paddingHorizontal: 16, paddingVertical: 14,
    backgroundColor: colors.surface, borderRadius: 16,
    borderWidth: 1, borderColor: colors.border,
    overflow: 'hidden', position: 'relative',
  },
  lvlChip: {
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1,
  },
  lvlChipText: { fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },
  info: { flex: 1, gap: 6 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  rankText: { fontSize: 14, fontWeight: '700' },
  totalXp: { fontSize: 12, color: colors.textFaint, fontWeight: '600' },
  barBg: { height: 8, backgroundColor: colors.border, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  xpText: { fontSize: 11, color: colors.textDim, fontWeight: '600' },
});
