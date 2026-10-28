import { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTaskStore } from '../../store/taskStore';
import { colors, space, radius, font, alphaHex } from '../../lib/tokens';
import { todayLocal } from '../../lib/date';
import { haptic } from '../../lib/haptics';

type HubCategory = 'all' | 'strategy' | 'focus' | 'library' | 'review' | 'system';

type HubItem = {
  id: string;
  label: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  route: string;
  category: HubCategory;
  badgeCount?: number;
  featured?: boolean;
};

const CATEGORIES: { key: HubCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', label: 'Tümü', icon: 'grid-outline' },
  { key: 'strategy', label: 'Strateji & OKR', icon: 'flag-outline' },
  { key: 'focus', label: 'Odak & Rutin', icon: 'flash-outline' },
  { key: 'library', label: 'Kütüphane', icon: 'book-outline' },
  { key: 'review', label: 'Raporlar', icon: 'bar-chart-outline' },
  { key: 'system', label: 'Sistem', icon: 'settings-outline' },
];

const HUB_ITEMS: HubItem[] = [
  // Strateji
  {
    id: 'okr',
    label: 'OKR & Key Results',
    subtitle: 'Çeyreklik hedefler ve ölçülebilir sonuçlar',
    icon: 'flag',
    color: '#ef4444',
    route: '/screens/okr',
    category: 'strategy',
    featured: true,
  },
  {
    id: 'goals',
    label: 'Hedefler',
    subtitle: 'Yıllık ve aylık vizyon hedefleri',
    icon: 'trophy',
    color: '#f59e0b',
    route: '/screens/goals',
    category: 'strategy',
  },
  {
    id: 'life_areas',
    label: 'Yaşam Alanları',
    subtitle: '8 alanlık yaşam dengesi çarkı',
    icon: 'pie-chart',
    color: '#10b981',
    route: '/screens/life-areas',
    category: 'strategy',
  },
  {
    id: 'projects',
    label: 'Projeler',
    subtitle: 'Aktif hedefler ve kilometre taşları',
    icon: 'folder',
    color: '#3b82f6',
    route: '/screens/projects',
    category: 'strategy',
  },
  {
    id: 'calendar',
    label: 'Takvim Planı',
    subtitle: 'Zaman blokları ve gün planı',
    icon: 'calendar',
    color: '#8b5cf6',
    route: '/screens/calendar',
    category: 'strategy',
  },

  // Odak & Yürütme
  {
    id: 'routine_runner',
    label: 'Rutin Yürütücü',
    subtitle: 'Sabah & akşam adımlarını koştur',
    icon: 'play-circle',
    color: '#10b981',
    route: '/screens/routine-runner',
    category: 'focus',
    featured: true,
  },
  {
    id: 'deep_work',
    label: 'Derin Çalışma',
    subtitle: 'Kesintisiz odaklanma oturumu',
    icon: 'flash',
    color: colors.teal,
    route: '/screens/deep-work',
    category: 'focus',
    featured: true,
  },
  {
    id: 'eisenhower',
    label: 'Eisenhower Matrisi',
    subtitle: 'Acil / önemli 4 çeyrek analizi',
    icon: 'grid',
    color: '#f43f5e',
    route: '/screens/eisenhower',
    category: 'focus',
  },
  {
    id: 'recovery',
    label: 'Telafi & Shield',
    subtitle: 'Geciken görevleri toparla',
    icon: 'refresh-circle',
    color: '#f59e0b',
    route: '/screens/recovery',
    category: 'focus',
  },

  // Kütüphane & Kişisel
  {
    id: 'reading_list',
    label: 'Okuma Listesi',
    subtitle: 'Kitaplık ve sayfa hedefleri',
    icon: 'book',
    color: '#06b6d4',
    route: '/screens/reading-list',
    category: 'library',
  },
  {
    id: 'notes',
    label: 'Notlar',
    subtitle: 'Hızlı notlar ve bilgi deposu',
    icon: 'document-text',
    color: colors.textDim,
    route: '/screens/notes',
    category: 'library',
  },
  {
    id: 'journal',
    label: 'Günlük & Yansıma',
    subtitle: 'Duygu ve düşünce günlüğü',
    icon: 'journal',
    color: '#ec4899',
    route: '/screens/journal',
    category: 'library',
  },
  {
    id: 'ai_coach',
    label: 'AI Koç',
    subtitle: 'Alışkanlık ve davranış rehberi',
    icon: 'sparkles',
    color: '#8b5cf6',
    route: '/screens/ai-coach',
    category: 'library',
  },

  // Raporlar & Gelişim
  {
    id: 'monthly_review',
    label: 'Aylık Değerlendirme',
    subtitle: 'Aylık başarı ve gelişim raporu',
    icon: 'calendar-number',
    color: '#8b5cf6',
    route: '/screens/monthly-review',
    category: 'review',
  },
  {
    id: 'weekly_review',
    label: 'Haftalık Rapor',
    subtitle: 'Haftalık kazanımlar ve trendler',
    icon: 'bar-chart',
    color: '#14b8a6',
    route: '/screens/weekly-review',
    category: 'review',
  },
  {
    id: 'achievements',
    label: 'Başarımlar & Rozetler',
    subtitle: 'Kazanılan rozetler ve XP ödülleri',
    icon: 'ribbon',
    color: '#f59e0b',
    route: '/screens/achievements',
    category: 'review',
  },
  {
    id: 'leaderboard',
    label: 'Sıralama Ligi',
    subtitle: 'Seviye ve küresel lig sıralaması',
    icon: 'podium',
    color: '#eab308',
    route: '/screens/leaderboard',
    category: 'review',
  },
  {
    id: 'stats',
    label: 'Detaylı İstatistikler',
    subtitle: 'Alışkanlık oranları ve heatmap',
    icon: 'stats-chart',
    color: '#6366f1',
    route: '/tabs/stats',
    category: 'review',
  },

  // Sistem
  {
    id: 'focus_points',
    label: 'Focus Points',
    subtitle: 'AI kredi bakiyesi ve kullanımı',
    icon: 'diamond',
    color: colors.warning,
    route: '/screens/focus-points',
    category: 'system',
  },
  {
    id: 'integrations',
    label: 'Entegrasyonlar',
    subtitle: '20+ servis, takvim ve cihazlar',
    icon: 'git-network',
    color: colors.teal,
    route: '/screens/integrations',
    category: 'system',
  },
  {
    id: 'settings',
    label: 'Ayarlar',
    subtitle: 'Veri yedeği, bildirim ve tema',
    icon: 'settings',
    color: colors.textFaint,
    route: '/tabs/settings',
    category: 'system',
  },
];

export default function HubScreen() {
  const router = useRouter();
  const { tasks } = useTaskStore();
  const [search, setSearch] = useState('');
  const [selectedCat, setSelectedCat] = useState<HubCategory>('all');

  const inboxCount = tasks.filter((t) => t.list_type === 'inbox' && !t.completed).length;
  const recoveryCount = tasks.filter(
    (t) => t.due_date && t.due_date < todayLocal() && !t.completed
  ).length;

  const filteredItems = useMemo(() => {
    let items = HUB_ITEMS;

    if (selectedCat !== 'all') {
      items = items.filter((i) => i.category === selectedCat);
    }

    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (q) {
      items = items.filter(
        (i) =>
          i.label.toLocaleLowerCase('tr-TR').includes(q) ||
          i.subtitle.toLocaleLowerCase('tr-TR').includes(q)
      );
    }

    return items;
  }, [search, selectedCat]);

  function navigate(route: string) {
    haptic.select();
    const base = route.split('?')[0];
    router.push(base as any);
  }

  const isSearching = search.trim().length > 0;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        {/* Başlık & Arama */}
        <View style={s.header}>
          <Text style={s.pageTitle}>Keşfet</Text>
          <Text style={s.pageSub}>Tüm sistem ve modüllere tek noktadan ulaşın</Text>

          {/* Arama Çubuğu */}
          <View style={s.searchWrap}>
            <Ionicons name="search-outline" size={18} color={colors.textFaint} />
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Modül veya araç ara (örn: okr, kitap, odak)..."
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            {search.length > 0 && (
              <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                <Ionicons name="close-circle" size={18} color={colors.textFaint} />
              </TouchableOpacity>
            )}
          </View>

          {/* Kategori Filtre Çipleri */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catList}>
            {CATEGORIES.map((cat) => {
              const active = selectedCat === cat.key;
              return (
                <TouchableOpacity
                  key={cat.key}
                  style={[s.catPill, active && s.catPillActive]}
                  onPress={() => { haptic.select(); setSelectedCat(cat.key); }}
                  accessibilityRole="button"
                  accessibilityLabel={cat.label}
                >
                  <Ionicons name={cat.icon} size={13} color={active ? colors.white : colors.textDim} />
                  <Text style={[s.catText, active && s.catTextActive]}>{cat.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* ── Öne Çıkan Bento Kartları (Arama yapılmıyorken göster) ── */}
        {!isSearching && selectedCat === 'all' && (
          <View style={s.bentoWrap}>
            <Text style={s.sectionHeader}>ÖNE ÇIKAN MERKEZLER</Text>

            {/* OKR Hero Banner */}
            <TouchableOpacity
              style={s.heroCard}
              onPress={() => navigate('/screens/okr')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="OKR ve Strateji Merkezini Aç"
            >
              <View style={s.heroContent}>
                <View style={s.heroBadge}>
                  <Text style={s.heroBadgeText}>BÜYÜK RESİM & STRATEJİ</Text>
                </View>
                <Text style={s.heroTitle}>🎯 OKR & Key Results</Text>
                <Text style={s.heroSub}>
                  Çeyreklik hedeflerini, anahtar sonuçlarını ve stratejik yönünü adım adım takip et.
                </Text>
              </View>
              <View style={s.heroAction}>
                <Text style={s.heroActionText}>Hedeflere Git →</Text>
              </View>
            </TouchableOpacity>

            {/* Twin Bento Kartları (Rutin & Derin Odak) */}
            <View style={s.twinRow}>
              <TouchableOpacity
                style={s.twinCard}
                onPress={() => navigate('/screens/routine-runner')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Rutin Yürütücüyü Başlat"
              >
                <View style={[s.twinIcon, { backgroundColor: alphaHex(colors.success, '20') }]}>
                  <Ionicons name="play" size={20} color={colors.success} />
                </View>
                <Text style={s.twinTitle}>Rutin Yürütücü</Text>
                <Text style={s.twinSub} numberOfLines={2}>Sabah & akşam ritüellerini başlat</Text>
                <View style={s.twinPill}>
                  <Text style={s.twinPillText}>▶ Başlat</Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={s.twinCard}
                onPress={() => navigate('/screens/deep-work')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Derin Çalışma Başlat"
              >
                <View style={[s.twinIcon, { backgroundColor: alphaHex(colors.teal, '20') }]}>
                  <Ionicons name="flash" size={20} color={colors.teal} />
                </View>
                <Text style={s.twinTitle}>Derin Çalışma</Text>
                <Text style={s.twinSub} numberOfLines={2}>Kesintisiz odaklanma oturumu</Text>
                <View style={s.twinPill}>
                  <Text style={s.twinPillText}>⏱️ Odaklan</Text>
                </View>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* ── 2 Sütunlu Pratik Modül Listesi ── */}
        <View style={s.gridWrap}>
          <Text style={s.sectionHeader}>
            {isSearching ? `ARAMA SONUÇLARI (${filteredItems.length})` : 'TÜM MODÜLLER & ARAÇLAR'}
          </Text>

          {filteredItems.length === 0 ? (
            <View style={s.emptyBox}>
              <Ionicons name="search" size={32} color={colors.textFaint} />
              <Text style={s.emptyTitle}>Eşleşen modül bulunamadı</Text>
              <Text style={s.emptySub}>Farklı bir arama terimi deneyin veya filtreyi sıfırlayın.</Text>
            </View>
          ) : (
            <View style={s.grid}>
              {filteredItems.map((item) => {
                const badge = item.id === 'recovery' ? recoveryCount : 0;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={s.card}
                    activeOpacity={0.75}
                    onPress={() => navigate(item.route)}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                  >
                    <View style={s.cardTop}>
                      <View style={[s.cardIcon, { backgroundColor: alphaHex(item.color, '18') }]}>
                        <Ionicons name={item.icon} size={22} color={item.color} />
                      </View>
                      {badge > 0 && (
                        <View style={[s.badge, { backgroundColor: item.color }]}>
                          <Text style={s.badgeText}>{badge}</Text>
                        </View>
                      )}
                    </View>
                    <Text style={s.cardTitle} numberOfLines={1}>{item.label}</Text>
                    <Text style={s.cardSub} numberOfLines={2}>{item.subtitle}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.md, paddingBottom: space.hh },

  header: { marginBottom: space.md },
  pageTitle: { ...font.display, color: colors.text, fontSize: 26, fontWeight: '800' },
  pageSub: { fontSize: 13, color: colors.textDim, marginTop: 3, marginBottom: space.md },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: space.sm,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.text,
  },

  catList: {
    flexDirection: 'row',
    gap: 6,
    paddingVertical: 4,
  },
  catPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  catPillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  catText: { fontSize: 12, fontWeight: '600', color: colors.textDim },
  catTextActive: { color: colors.white },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textGhost,
    letterSpacing: 1.2,
    marginBottom: space.sm,
  },

  // Bento
  bentoWrap: { marginBottom: space.lg },
  heroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: alphaHex(colors.error, '40'),
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.sm,
  },
  heroContent: { marginBottom: space.sm },
  heroBadge: {
    alignSelf: 'flex-start',
    backgroundColor: alphaHex(colors.error, '20'),
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
    marginBottom: 6,
  },
  heroBadgeText: { fontSize: 9, fontWeight: '800', color: colors.error, letterSpacing: 0.8 },
  heroTitle: { fontSize: 18, fontWeight: '800', color: colors.text, marginBottom: 4 },
  heroSub: { fontSize: 12, color: colors.textDim, lineHeight: 17 },
  heroAction: {
    alignSelf: 'flex-start',
    backgroundColor: alphaHex(colors.error, '15'),
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.sm,
  },
  heroActionText: { fontSize: 12, fontWeight: '700', color: colors.error },

  twinRow: {
    flexDirection: 'row',
    gap: space.sm,
  },
  twinCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: space.md,
  },
  twinIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  twinTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: 3 },
  twinSub: { fontSize: 11, color: colors.textDim, lineHeight: 15, marginBottom: 10 },
  twinPill: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  twinPillText: { fontSize: 11, fontWeight: '700', color: colors.text },

  // Grid
  gridWrap: { marginBottom: space.xl },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  card: {
    width: '48.5%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: space.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { fontSize: 10, color: colors.white, fontWeight: '800' },
  cardTitle: { fontSize: 13, fontWeight: '700', color: colors.text, marginBottom: 3 },
  cardSub: { fontSize: 11, color: colors.textDim, lineHeight: 15 },

  emptyBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    padding: space.xl,
    alignItems: 'center',
    gap: 6,
    marginTop: space.sm,
  },
  emptyTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 4 },
  emptySub: { fontSize: 12, color: colors.textDim, textAlign: 'center' },
});
