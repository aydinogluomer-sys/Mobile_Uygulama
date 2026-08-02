import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useProfileStore } from '../store/profileStore';
import { rankMeta } from '../lib/ranks';

/**
 * Kullanıcının XP/level/rütbe özeti. Supabase `profiles` tablosundan beslenir
 * (XP, alışkanlık tamamlamada server-side trigger'larla kazanılır).
 */
export default function XPDisplay() {
  const { profile, fetchProfile } = useProfileStore();

  useEffect(() => { fetchProfile(); }, []);

  if (!profile) return null;

  const tier = rankMeta(profile.willpower_rank, profile.level);
  const next = profile.next_level_xp || 100;
  const pct = Math.max(0, Math.min(100, Math.round((profile.current_level_xp / next) * 100)));

  return (
    <View style={s.container}>
      <View style={[s.levelBadge, { backgroundColor: tier.color }]}>
        <Text style={s.levelLabel}>LVL</Text>
        <Text style={s.levelNumber}>{profile.level}</Text>
      </View>

      <View style={s.info}>
        <View style={s.rankRow}>
          <Ionicons name={tier.icon} size={13} color={tier.color} />
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
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: '#1D1C17', borderRadius: 16,
    borderWidth: 1, borderColor: '#383528',
  },
  levelBadge: {
    width: 48, height: 48, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
  },
  levelLabel: { fontSize: 9, fontWeight: '800', color: '#fff', opacity: 0.85 },
  levelNumber: { fontSize: 18, fontWeight: '800', color: '#fff' },
  info: { flex: 1, gap: 5 },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rankText: { fontSize: 13, fontWeight: '700' },
  totalXp: { fontSize: 12, color: '#827E72', fontWeight: '600' },
  barBg: { height: 8, backgroundColor: '#383528', borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  xpText: { fontSize: 11, color: '#BFBBAE', fontWeight: '600' },
});
