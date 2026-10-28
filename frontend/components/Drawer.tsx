import { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated,
  Modal, Pressable, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDrawerStore } from '../store/drawerStore';
import { useCommandStore } from '../store/commandStore';
import { useProfileStore } from '../store/profileStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { colors, alphaHex, radius } from '../lib/tokens';
import { useReducedMotion } from './seasonalMotion/useReducedMotion';

const DRAWER_WIDTH = 310;

type DrawerItem = {
  label: string;
  icon: string;
  color: string;
  route: string;
  badge?: string;
  hint?: string;
};

// Hızlı Eylemler (4'lü Bento Kısayol)
const QUICK_SHORTCUTS: DrawerItem[] = [
  { label: 'OKR', icon: 'flag', color: colors.error, route: '/screens/okr', hint: 'Çeyreklik KR' },
  { label: 'Rutin Koş', icon: 'play-circle', color: colors.success, route: '/screens/routine-runner', hint: 'Adım adım' },
  { label: 'Derin Odak', icon: 'flash', color: colors.teal, route: '/screens/deep-work', hint: 'Odak oturumu' },
  { label: 'Kitaplık', icon: 'book', color: '#06b6d4', route: '/screens/reading-list', hint: 'Okuma listesi' },
];

// Navigasyon Grupları
const GROUPS: { title: string; subtitle?: string; items: DrawerItem[] }[] = [
  {
    title: 'PLANLAMA',
    subtitle: 'Strateji ve Hedefler',
    items: [
      { label: 'OKR', icon: 'flag-outline', color: colors.error, route: '/screens/okr', hint: 'Çeyreklik hedefler & Key Results' },
      { label: 'Hedefler', icon: 'trophy-outline', color: colors.warning, route: '/screens/goals', hint: 'Uzun & orta vadeli vizyon' },
      { label: 'Yaşam Alanları', icon: 'pie-chart-outline', color: colors.success, route: '/screens/life-areas', hint: 'Yaşam çarkı & denge alanları' },
      { label: 'Projeler', icon: 'folder-outline', color: colors.primary, route: '/screens/projects', hint: 'Aktif proje & kilometre taşları' },
      { label: 'Eisenhower Matrisi', icon: 'grid-outline', color: colors.error, route: '/screens/eisenhower', hint: 'Acil / önemli görev matrisi' },
      { label: 'Takvim', icon: 'calendar-outline', color: colors.primary, route: '/screens/calendar', hint: 'Zaman blokları ve planlama' },
    ],
  },
  {
    title: 'ALIŞKANLIKLAR',
    subtitle: 'Rutinler ve Döngüler',
    items: [
      { label: 'Rutin Yürütücü', icon: 'play-circle-outline', color: colors.success, route: '/screens/routine-runner', hint: 'Sabah & akşam adımları' },
      { label: 'Triage & Matris', icon: 'options-outline', color: colors.primary, route: '/screens/dashboard', hint: 'Aktif, bekleyen ve fikir alışkanlıkları' },
      { label: 'İçgörüler', icon: 'bulb-outline', color: colors.accent, route: '/screens/insights', hint: 'Haftalık & aylık davranış analizi' },
      { label: 'Aylık Özet', icon: 'calendar-number-outline', color: colors.accent, route: '/screens/monthly-review', hint: 'Aylık değerlendirme & rapor' },
      { label: 'Haftalık Rapor', icon: 'bar-chart-outline', color: colors.teal, route: '/screens/weekly-review', hint: 'Haftalık kazanımlar' },
    ],
  },
  {
    title: 'KİŞİSEL',
    subtitle: 'Gelişim & Bilgi Kütüphanesi',
    items: [
      { label: 'Başarımlar & Rozetler', icon: 'ribbon-outline', color: colors.warning, route: '/screens/achievements', hint: 'Kazanılan rozetler & XP ödülleri' },
      { label: 'Sıralama (Leaderboard)', icon: 'podium-outline', color: colors.warning, route: '/screens/leaderboard', hint: 'Puan & seviye ligi' },
      { label: 'Okuma Listesi', icon: 'book-outline', color: '#06b6d4', route: '/screens/reading-list', hint: 'Kitaplık ve okuma hedefleri' },
      { label: 'Günlük Arşivi', icon: 'journal-outline', color: '#ec4899', route: '/screens/journal-archive', hint: 'Geçmiş günlük kayıtları & okuyucu' },
      { label: 'Notlar', icon: 'document-text-outline', color: colors.textDim, route: '/screens/notes', hint: 'Kişisel bilgi kütüphanesi' },
      { label: 'AI Koç', icon: 'sparkles-outline', color: '#8b5cf6', route: '/screens/ai-coach', hint: 'Akıllı davranış & alışkanlık koçu' },
    ],
  },
  {
    title: 'SİSTEM',
    subtitle: 'Hesap & Yapılandırma',
    items: [
      { label: 'Keşfet (Hub)', icon: 'compass-outline', color: colors.primary, route: '/tabs/hub', hint: 'Tüm sistem genel bakış paneli' },
      { label: 'Focus Points', icon: 'diamond-outline', color: colors.warning, route: '/screens/focus-points', hint: 'AI kredi bakiyesi & kullanım' },
      { label: 'Entegrasyonlar', icon: 'git-network-outline', color: colors.teal, route: '/screens/integrations', hint: 'Takvim & dış bağlantılar' },
      { label: 'Gizlilik & Güvenlik', icon: 'shield-checkmark-outline', color: colors.textDim, route: '/screens/privacy', hint: 'Veri ihracı & güvenlik' },
      { label: 'Ayarlar', icon: 'settings-outline', color: colors.textFaint, route: '/tabs/settings', hint: 'Uygulama tercihleri' },
    ],
  },
];

export default function Drawer() {
  const router = useRouter();
  const { isOpen, close } = useDrawerStore();
  const openCmd = useCommandStore((s) => s.open);
  const profile = useProfileStore((s) => s.profile);
  const focusPoints = useSubscriptionStore((s) => s.focusPoints);
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      translateX.setValue(isOpen ? 0 : -DRAWER_WIDTH);
      backdropOpacity.setValue(isOpen ? 1 : 0);
      return;
    }
    Animated.parallel([
      Animated.spring(translateX, {
        toValue: isOpen ? 0 : -DRAWER_WIDTH,
        useNativeDriver: true,
        damping: 22,
        stiffness: 220,
      }),
      Animated.timing(backdropOpacity, {
        toValue: isOpen ? 1 : 0,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [isOpen, translateX, backdropOpacity, reduceMotion]);

  function navigate(route: string) {
    const base = route.split('?')[0];
    close();
    setTimeout(() => router.push(base as any), 100);
  }

  function handleOpenSearch() {
    close();
    setTimeout(() => openCmd(), 150);
  }

  if (!isOpen && Platform.OS !== 'web') return null;

  const userLevel = profile?.level ?? 1;
  const username = profile?.username || 'Kişisel Sistem';

  return (
    <Modal visible={isOpen} transparent animationType="none" onRequestClose={close}>
      {/* Backdrop */}
      <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Menüyü kapat" />
      </Animated.View>

      {/* Panel */}
      <Animated.View style={[s.panel, { transform: [{ translateX }] }]}>
        <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
          {/* Header & Profil Kartı */}
          <View style={s.header}>
            <TouchableOpacity
              style={s.headerLeft}
              onPress={() => navigate('/screens/profile')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Profile git"
            >
              <View style={s.avatar}>
                <Ionicons name="person" size={18} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.appName} numberOfLines={1}>{username}</Text>
                <View style={s.badgeRow}>
                  <View style={s.levelBadge}>
                    <Text style={s.levelBadgeText}>⚡ Lvl {userLevel}</Text>
                  </View>
                  <View style={s.fpBadge}>
                    <Text style={s.fpBadgeText}>💎 {focusPoints} FP</Text>
                  </View>
                </View>
              </View>
            </TouchableOpacity>
            <TouchableOpacity onPress={close} style={s.closeBtn} accessibilityRole="button" accessibilityLabel="Menüyü kapat">
              <Ionicons name="close" size={20} color={colors.textFaint} />
            </TouchableOpacity>
          </View>

          <View style={s.divider} />

          {/* Nav items */}
          <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
            {/* 1. Hızlı Kısayollar (Bento Grid) */}
            <View style={s.shortcutSection}>
              <Text style={s.sectionHeader}>HIZLI KISAYOLLAR</Text>
              <View style={s.shortcutGrid}>
                {QUICK_SHORTCUTS.map((sc) => (
                  <TouchableOpacity
                    key={sc.label}
                    style={s.shortcutCard}
                    onPress={() => navigate(sc.route)}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={sc.label}
                  >
                    <View style={[s.shortcutIcon, { backgroundColor: alphaHex(sc.color, '20') }]}>
                      <Ionicons name={sc.icon as any} size={18} color={sc.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.shortcutLabel}>{sc.label}</Text>
                      <Text style={s.shortcutHint} numberOfLines={1}>{sc.hint}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* Navigasyon Grupları (PLANLAMA / ALIŞKANLIKLAR / KİŞİSEL / SİSTEM) */}
            {GROUPS.map((group) => (
              <View key={group.title} style={s.group}>
                <Text style={s.groupTitle}>{group.title}</Text>
                {group.items.map((item) => (
                  <TouchableOpacity
                    key={item.label}
                    style={s.item}
                    onPress={() => navigate(item.route)}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                  >
                    <View style={[s.itemIcon, { backgroundColor: alphaHex(item.color, '15') }]}>
                      <Ionicons name={item.icon as any} size={17} color={item.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.itemLabel}>{item.label}</Text>
                      {item.hint && <Text style={s.itemHint}>{item.hint}</Text>}
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={colors.textGhost} />
                  </TouchableOpacity>
                ))}
              </View>
            ))}
          </ScrollView>

          {/* Footer - Hızlı Arama Kısayolu */}
          <View style={s.footer}>
            <TouchableOpacity
              style={s.searchBar}
              onPress={handleOpenSearch}
              accessibilityRole="button"
              accessibilityLabel="Komut paletini veya aramayı aç"
            >
              <Ionicons name="search-outline" size={15} color={colors.textFaint} />
              <Text style={s.searchBarText}>Tüm sistemde ara…</Text>
              <Text style={s.searchShortcut}>⌘ K</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Animated.View>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  panel: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    shadowColor: colors.black,
    shadowOpacity: 0.5,
    shadowRadius: 20,
    shadowOffset: { width: 4, height: 0 },
    elevation: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  avatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: alphaHex(colors.accent, '20'),
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: alphaHex(colors.accent, '35'),
  },
  appName: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: 3 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  levelBadge: {
    backgroundColor: alphaHex(colors.warning, '18'),
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  levelBadgeText: { fontSize: 10, fontWeight: '700', color: colors.warning },
  fpBadge: {
    backgroundColor: alphaHex(colors.primary, '18'),
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  fpBadgeText: { fontSize: 10, fontWeight: '700', color: colors.primary },
  closeBtn: { padding: 6, borderRadius: radius.sm },
  divider: { height: 1, backgroundColor: colors.borderSubtle, marginHorizontal: 0 },
  scroll: { padding: 12, paddingBottom: 24 },

  shortcutSection: { marginBottom: 18 },
  sectionHeader: { fontSize: 10, fontWeight: '700', color: colors.textGhost, letterSpacing: 1.2, marginBottom: 8, paddingLeft: 6 },
  shortcutGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  shortcutCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    padding: 10,
  },
  shortcutIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shortcutLabel: { fontSize: 12, fontWeight: '700', color: colors.text },
  shortcutHint: { fontSize: 10, color: colors.textDim },

  group: { marginBottom: 18 },
  groupTitle: { fontSize: 10, fontWeight: '700', color: colors.textGhost, letterSpacing: 1.2, marginBottom: 6, paddingLeft: 6 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 8, paddingVertical: 7, borderRadius: radius.md,
  },
  itemIcon: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  itemLabel: { fontSize: 13, color: colors.text, fontWeight: '600' },
  itemHint: { fontSize: 11, color: colors.textFaint, marginTop: 1 },

  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.surfaceAlt,
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchBarText: { flex: 1, fontSize: 12, color: colors.textFaint },
  searchShortcut: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textGhost,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
