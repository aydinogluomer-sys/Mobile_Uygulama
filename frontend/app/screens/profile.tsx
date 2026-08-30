import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useProfileStore } from '../../store/profileStore';
import { rankMeta, RANK_TIERS } from '../../lib/ranks';
import XPDisplay from '../../components/XPDisplay';

export default function ProfileScreen() {
  const router = useRouter();
  const { profile, badges, fetchProfile, fetchBadges, setUsername } = useProfileStore();
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { fetchProfile(); fetchBadges(); }, [fetchProfile, fetchBadges]);
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
      <ScrollView contentContainerStyle={s.content}>
        <XPDisplay />

        {/* Rütbe kartı */}
        {tier && profile && (
          <View style={[s.rankCard, { borderColor: tier.color + '50', backgroundColor: tier.color + '12' }]}>
            <View style={[s.rankIcon, { backgroundColor: tier.color + '25' }]}>
              <Ionicons name={tier.icon} size={28} color={tier.color} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
            </View>
            <Text style={[s.rankName, { color: tier.color }]}>{tier.name}</Text>
            <Text style={s.rankSub}>
              {nextTier
                ? `Lv ${nextTier.minLevel}'de "${nextTier.name}" rütbesine yüksel`
                : 'En yüksek rütbedesin! 🔥'}
            </Text>
          </View>
        )}

        {/* Sıralama linki */}
        <TouchableOpacity
          style={s.lbBtn}
          onPress={() => router.push('/screens/leaderboard' as any)}
          accessibilityRole="link"
          accessibilityLabel="Sıralamayı gör"
        >
          <Ionicons name="podium-outline" size={18} color="#D4A84A" />
          <Text style={s.lbText}>Sıralamayı Gör</Text>
          <Ionicons name="chevron-forward" size={16} color="#827E72" />
        </TouchableOpacity>

        {/* Kullanıcı adı */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>KULLANICI ADI</Text>
          <Text style={s.sectionHint}>Sıralamada görünecek ad. Boş bırakırsan &quot;Gizli Savaşçı&quot; görünürsün.</Text>
          <View style={s.nameRow}>
            <TextInput
              style={s.nameInput}
              value={name}
              onChangeText={setName}
              placeholder="Gizli Savaşçı"
              placeholderTextColor="#56544B"
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
                <ActivityIndicator size="small" color="#fff" />
              ) : saved ? (
                <Ionicons name="checkmark" size={18} color="#fff" />
              ) : (
                <Text style={s.saveBtnText}>Kaydet</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>

        {/* Rozetler */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>ROZETLER {badges.length > 0 ? `(${badges.length})` : ''}</Text>
          {badges.length === 0 ? (
            <Text style={s.sectionHint}>
              Henüz rozet yok. Alışkanlıklarını tamamladıkça rozet kazanırsın.
            </Text>
          ) : (
            <View style={s.badgeGrid}>
              {badges.map((b) => (
                <View key={b.id} style={s.badge}>
                  <Text style={s.badgeIcon}>{b.icon ?? '🏅'}</Text>
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
  safe: { flex: 1, backgroundColor: '#15140F' },
  content: { padding: 16, paddingBottom: 40, gap: 14 },

  rankCard: {
    alignItems: 'center', gap: 6, borderRadius: 18, borderWidth: 1, padding: 18,
  },
  rankIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  rankName: { fontSize: 20, fontWeight: '800' },
  rankSub: { fontSize: 12, color: '#827E72', textAlign: 'center' },

  lbBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: '#1D1C17', borderRadius: 14, borderWidth: 1, borderColor: '#383528',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  lbText: { flex: 1, fontSize: 15, fontWeight: '700', color: '#EDEAE0' },

  section: {
    backgroundColor: '#1D1C17', borderRadius: 16, borderWidth: 1, borderColor: '#383528', padding: 16, gap: 8,
  },
  sectionTitle: { fontSize: 11, fontWeight: '800', color: '#827E72', letterSpacing: 1 },
  sectionHint: { fontSize: 12, color: '#827E72', lineHeight: 17 },

  nameRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  nameInput: {
    flex: 1, backgroundColor: '#15140F', borderRadius: 12, borderWidth: 1, borderColor: '#383528',
    paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, color: '#EDEAE0',
  },
  saveBtn: {
    minWidth: 76, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#D4A84A', borderRadius: 12, paddingHorizontal: 16,
  },
  saveBtnDone: { backgroundColor: '#87A678' },
  saveBtnText: { fontSize: 14, fontWeight: '700', color: '#fff' },

  badgeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 4 },
  badge: {
    width: '47%', backgroundColor: '#15140F', borderRadius: 12, borderWidth: 1, borderColor: '#383528',
    padding: 12, gap: 3, alignItems: 'center',
  },
  badgeIcon: { fontSize: 26 },
  badgeName: { fontSize: 12, fontWeight: '700', color: '#EDEAE0', textAlign: 'center' },
  badgeDesc: { fontSize: 10, color: '#827E72', textAlign: 'center', lineHeight: 14 },
});
