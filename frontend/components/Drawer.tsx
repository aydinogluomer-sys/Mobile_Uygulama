import { useEffect, useRef, useState } from 'react';
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
import { TEXTURES } from '../lib/visualAssets';
import TexturedSurface from './ui/TexturedSurface';
import { useReducedMotion } from './seasonalMotion/useReducedMotion';

const DRAWER_WIDTH = 310;

type DrawerItem = {
  label: string;
  shortLabel?: string;
  icon: string;
  color: string;
  route: string;
  badge?: string;
  hint?: string;
};

// Kısayol olarak atanabilecek ekstra özel modüller + tüm grup öğeleri
const EXTRA_MODULES: DrawerItem[] = [
  { label: 'Derin Odak', shortLabel: 'Derin Odak', icon: 'flash', color: colors.teal, route: '/screens/deep-work', hint: 'Odak oturumu' },
  { label: 'Telafi Planı', shortLabel: 'Telafi', icon: 'umbrella-outline', color: colors.warning, route: '/screens/recovery', hint: 'Kaçan alışkanlık telafisi' },
  { label: 'Puan Geçmişi', shortLabel: 'Puanlar', icon: 'receipt-outline', color: colors.primary, route: '/screens/credit-history', hint: 'Focus Points hareketleri' },
];

// Navigasyon Grupları
const GROUPS: { title: string; subtitle?: string; items: DrawerItem[] }[] = [
  {
    title: 'PLANLAMA',
    subtitle: 'Strateji ve Hedefler',
    items: [
      { label: 'OKR', shortLabel: 'OKR', icon: 'flag-outline', color: colors.error, route: '/screens/okr', hint: 'Çeyreklik hedefler & Key Results' },
      { label: 'Hedefler', shortLabel: 'Hedefler', icon: 'trophy-outline', color: colors.warning, route: '/screens/goals', hint: 'Uzun & orta vadeli vizyon' },
      { label: 'Yaşam Alanları', shortLabel: 'Yaşam Alanı', icon: 'pie-chart-outline', color: colors.success, route: '/screens/life-areas', hint: 'Yaşam çarkı & denge alanları' },
      { label: 'Projeler', shortLabel: 'Projeler', icon: 'folder-outline', color: colors.primary, route: '/screens/projects', hint: 'Aktif proje & kilometre taşları' },
      { label: 'Eisenhower Matrisi', shortLabel: 'Eisenhower', icon: 'grid-outline', color: colors.error, route: '/screens/eisenhower', hint: 'Acil / önemli görev matrisi' },
      { label: 'Takvim', shortLabel: 'Takvim', icon: 'calendar-outline', color: colors.primary, route: '/screens/calendar', hint: 'Zaman blokları ve planlama' },
    ],
  },
  {
    title: 'ALIŞKANLIKLAR',
    subtitle: 'Rutinler ve Döngüler',
    items: [
      { label: 'Odak Akışı (Flow)', shortLabel: 'Odak Akışı', icon: 'flame-outline', color: colors.primary, route: '/screens/focus-flow', badge: 'YENİ', hint: 'Dikey verimlilik videoları & Inflow akışı' },
      { label: 'Rutin & Alışkanlık Keşfet', shortLabel: 'Keşfet', icon: 'compass-outline', color: colors.warning, route: '/tabs/hub', hint: 'Hazır koleksiyonlar & atomik alışkanlıklar' },
      { label: 'Rutin Yürütücü', shortLabel: 'Rutin Koş', icon: 'play-circle-outline', color: colors.success, route: '/screens/routine-runner', hint: 'Sabah & akşam adımları' },
      { label: 'Triage & Matris', shortLabel: 'Triage', icon: 'options-outline', color: colors.primary, route: '/screens/dashboard', hint: 'Aktif, bekleyen ve fikir alışkanlıkları' },
      { label: 'İçgörüler', shortLabel: 'İçgörüler', icon: 'bulb-outline', color: colors.accent, route: '/screens/insights', hint: 'Haftalık & aylık davranış analizi' },
      { label: 'Aylık Özet', shortLabel: 'Aylık Özet', icon: 'calendar-number-outline', color: colors.accent, route: '/screens/monthly-review', hint: 'Aylık değerlendirme & rapor' },
      { label: 'Haftalık Rapor', shortLabel: 'Haftalık Özet', icon: 'bar-chart-outline', color: colors.teal, route: '/screens/weekly-review', hint: 'Haftalık kazanımlar' },
    ],
  },
  {
    title: 'KİŞİSEL',
    subtitle: 'Gelişim & Bilgi Kütüphanesi',
    items: [
      { label: 'Başarımlar & Rozetler', shortLabel: 'Rozetler', icon: 'ribbon-outline', color: colors.warning, route: '/screens/achievements', hint: 'Kazanılan rozetler & XP ödülleri' },
      { label: 'Sıralama (Leaderboard)', shortLabel: 'Sıralama', icon: 'podium-outline', color: colors.warning, route: '/screens/leaderboard', hint: 'Puan & seviye ligi' },
      { label: 'Okuma Listesi', shortLabel: 'Kitaplık', icon: 'book-outline', color: colors.teal, route: '/screens/reading-list', hint: 'Kitaplık ve okuma hedefleri' },
      { label: 'Günlük Arşivi', shortLabel: 'Günlükler', icon: 'journal-outline', color: colors.primaryBright, route: '/screens/journal-archive', hint: 'Geçmiş günlük kayıtları & okuyucu' },
      { label: 'Notlar', shortLabel: 'Notlar', icon: 'document-text-outline', color: colors.textDim, route: '/screens/notes', hint: 'Kişisel bilgi kütüphanesi' },
      { label: 'AI Koç', shortLabel: 'AI Koç', icon: 'sparkles-outline', color: colors.info, route: '/screens/ai-coach', hint: 'Akıllı davranış & alışkanlık koçu' },
    ],
  },
  {
    title: 'SİSTEM',
    subtitle: 'Hesap & Yapılandırma',
    items: [
      { label: 'Keşfet (Hub)', shortLabel: 'Keşfet', icon: 'compass-outline', color: colors.primary, route: '/tabs/hub', hint: 'Tüm sistem genel bakış paneli' },
      { label: 'Focus Points', shortLabel: 'Focus Points', icon: 'diamond-outline', color: colors.warning, route: '/screens/focus-points', hint: 'AI kredi bakiyesi & kullanım' },
      { label: 'Entegrasyonlar', shortLabel: 'Bağlantılar', icon: 'git-network-outline', color: colors.teal, route: '/screens/integrations', hint: 'Takvim & dış bağlantılar' },
      { label: 'Gizlilik & Güvenlik', shortLabel: 'Gizlilik', icon: 'shield-checkmark-outline', color: colors.textDim, route: '/screens/privacy', hint: 'Veri ihracı & güvenlik' },
      { label: 'Ayarlar', shortLabel: 'Ayarlar', icon: 'settings-outline', color: colors.textFaint, route: '/tabs/settings', hint: 'Uygulama tercihleri' },
    ],
  },
];

// Tüm atanabilir modüllerin birleştirilmiş kataloğu
const ALL_MODULES: DrawerItem[] = (() => {
  const seen = new Set<string>();
  const list: DrawerItem[] = [];
  for (const item of [...GROUPS.flatMap((g) => g.items), ...EXTRA_MODULES]) {
    if (!seen.has(item.route)) {
      seen.add(item.route);
      list.push(item);
    }
  }
  return list;
})();

const MODULE_BY_ROUTE = new Map<string, DrawerItem>(
  ALL_MODULES.map((m) => [m.route, m]),
);

export default function Drawer() {
  const router = useRouter();
  const {
    isOpen,
    close,
    shortcutRoutes,
    hydrateShortcuts,
    removeShortcut,
    toggleShortcut,
    resetShortcuts,
  } = useDrawerStore();
  const openCmd = useCommandStore((s) => s.open);
  const profile = useProfileStore((s) => s.profile);
  const focusPoints = useSubscriptionStore((s) => s.focusPoints);
  const translateX = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  const [isEditingShortcuts, setIsEditingShortcuts] = useState(false);

  useEffect(() => {
    hydrateShortcuts();
  }, [hydrateShortcuts]);

  useEffect(() => {
    if (!isOpen) {
      setIsEditingShortcuts(false);
    }
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
  const username = profile?.username || 'Aderyth';

  const activeShortcuts: DrawerItem[] = shortcutRoutes
    .map((route) => MODULE_BY_ROUTE.get(route))
    .filter((item): item is DrawerItem => Boolean(item));

  return (
    <Modal visible={isOpen} transparent animationType="none" onRequestClose={close}>
      {/* Backdrop */}
      <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityRole="button" accessibilityLabel="Menüyü kapat" />
      </Animated.View>

      {/* Panel */}
      <Animated.View style={[s.panel, { transform: [{ translateX }] }]}>
        <TexturedSurface source={TEXTURES.linen} textureOpacity={0.07} overlayOnly />
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
            {/* 1. Hızlı Kısayollar (Özelleştirilebilir Bento Grid) */}
            <View style={s.shortcutSection}>
              <View style={s.shortcutHeaderRow}>
                <View style={s.shortcutTitleLeft}>
                  <Text style={s.sectionHeader}>HIZLI KISAYOLLAR</Text>
                  <View style={s.countPill}>
                    <Text style={s.countPillText}>{activeShortcuts.length}</Text>
                  </View>
                </View>
                <View style={s.shortcutActionsRight}>
                  {isEditingShortcuts && (
                    <TouchableOpacity
                      style={s.resetBtn}
                      onPress={resetShortcuts}
                      accessibilityRole="button"
                      accessibilityLabel="Varsayılan kısayollara sıfırla"
                    >
                      <Ionicons name="refresh-outline" size={12} color={colors.textDim} />
                      <Text style={s.resetBtnText}>Sıfırla</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[s.editShortcutsBtn, isEditingShortcuts && s.editShortcutsBtnActive]}
                    onPress={() => setIsEditingShortcuts((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={isEditingShortcuts ? 'Kısayol düzenlemeyi bitir' : 'Hızlı kısayolları düzenle'}
                  >
                    <Ionicons
                      name={isEditingShortcuts ? 'checkmark' : 'options-outline'}
                      size={12}
                      color={isEditingShortcuts ? colors.white : colors.primary}
                    />
                    <Text style={[s.editShortcutsBtnText, isEditingShortcuts && { color: colors.white }]}>
                      {isEditingShortcuts ? 'Bitti' : 'Düzenle'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={s.shortcutGrid}>
                {activeShortcuts.map((sc) => (
                  <TouchableOpacity
                    key={sc.route}
                    style={[s.shortcutCard, isEditingShortcuts && s.shortcutCardEditing]}
                    onPress={() => {
                      if (isEditingShortcuts) {
                        removeShortcut(sc.route);
                      } else {
                        navigate(sc.route);
                      }
                    }}
                    activeOpacity={0.75}
                    accessibilityRole="button"
                    accessibilityLabel={isEditingShortcuts ? `${sc.shortLabel || sc.label} kısayolunu kaldır` : (sc.shortLabel || sc.label)}
                  >
                    <View style={[s.shortcutIcon, { backgroundColor: alphaHex(sc.color, '20') }]}>
                      <Ionicons name={sc.icon as any} size={18} color={sc.color} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.shortcutLabel} numberOfLines={1}>{sc.shortLabel || sc.label}</Text>
                      <Text style={s.shortcutHint} numberOfLines={1}>
                        {isEditingShortcuts ? 'Kaldırmak için dokun' : sc.hint}
                      </Text>
                    </View>
                    {isEditingShortcuts && (
                      <TouchableOpacity
                        style={s.removeBadge}
                        onPress={() => removeShortcut(sc.route)}
                        accessibilityRole="button"
                        accessibilityLabel={`${sc.shortLabel || sc.label} sil`}
                      >
                        <Ionicons name="close" size={12} color={colors.white} />
                      </TouchableOpacity>
                    )}
                  </TouchableOpacity>
                ))}

                {/* + Modül Ata Kartı */}
                <TouchableOpacity
                  style={s.addShortcutCard}
                  onPress={() => setIsEditingShortcuts((v) => !v)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel="Hızlı kısayollara modül ata veya kaldır"
                >
                  <View style={s.addShortcutIcon}>
                    <Ionicons name={isEditingShortcuts ? 'chevron-up' : 'add'} size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.addShortcutLabel}>
                      {isEditingShortcuts ? 'Seçiciyi Kapat' : 'Modül Ata'}
                    </Text>
                    <Text style={s.shortcutHint} numberOfLines={1}>
                      {isEditingShortcuts ? 'Listeyi gizle' : 'Ekle / Çıkar'}
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>

              {/* Düzenleme Modu: Modül Atama / Kaldırma Seçici Paneli */}
              {isEditingShortcuts && (
                <View style={s.pickerBox}>
                  <Text style={s.pickerHelp}>
                    Hızlı kısayollarda görmek istediğiniz modüllere dokunarak ekleyebilir veya çıkarabilirsiniz:
                  </Text>
                  <View style={s.pickerChipsWrap}>
                    {ALL_MODULES.map((mod) => {
                      const isPinned = shortcutRoutes.includes(mod.route);
                      return (
                        <TouchableOpacity
                          key={mod.route}
                          style={[
                            s.pickerChip,
                            isPinned && {
                              backgroundColor: alphaHex(mod.color, '22'),
                              borderColor: mod.color,
                            },
                          ]}
                          onPress={() => toggleShortcut(mod.route)}
                          activeOpacity={0.75}
                          accessibilityRole="button"
                          accessibilityLabel={isPinned ? `${mod.label} kısayolunu çıkar` : `${mod.label} kısayolunu ekle`}
                        >
                          <Ionicons
                            name={mod.icon as any}
                            size={13}
                            color={isPinned ? mod.color : colors.textDim}
                          />
                          <Text
                            style={[
                              s.pickerChipText,
                              isPinned && { color: colors.text, fontWeight: '700' },
                            ]}
                            numberOfLines={1}
                          >
                            {mod.shortLabel || mod.label}
                          </Text>
                          <Ionicons
                            name={isPinned ? 'checkmark-circle' : 'add-circle-outline'}
                            size={14}
                            color={isPinned ? mod.color : colors.textGhost}
                          />
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              )}
            </View>

            {/* Navigasyon Grupları (PLANLAMA / ALIŞKANLIKLAR / KİŞİSEL / SİSTEM) */}
            {GROUPS.map((group) => (
              <View key={group.title} style={s.group}>
                <Text style={s.groupTitle}>{group.title}</Text>
                {group.items.map((item) => {
                  const isPinned = shortcutRoutes.includes(item.route);
                  return (
                    <View key={item.label} style={s.itemRow}>
                      <TouchableOpacity
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
                        {!isEditingShortcuts && (
                          <Ionicons name="chevron-forward" size={14} color={colors.textGhost} />
                        )}
                      </TouchableOpacity>
                      {isEditingShortcuts && (
                        <TouchableOpacity
                          style={[s.pinBtn, isPinned && s.pinBtnActive]}
                          onPress={() => toggleShortcut(item.route)}
                          accessibilityRole="button"
                          accessibilityLabel={isPinned ? `${item.label} kısayollardan çıkar` : `${item.label} kısayollara ekle`}
                        >
                          <Ionicons
                            name={isPinned ? 'trash-outline' : 'add'}
                            size={14}
                            color={isPinned ? colors.error : colors.primary}
                          />
                          <Text style={[s.pinBtnText, isPinned && { color: colors.error }]}>
                            {isPinned ? 'Çıkar' : 'Ata'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  );
                })}
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
  shortcutHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  shortcutTitleLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sectionHeader: { fontSize: 10, fontWeight: '700', color: colors.textFaint, letterSpacing: 1.2 },
  countPill: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: 999,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  countPillText: { fontSize: 9, fontWeight: '700', color: colors.textDim },
  shortcutActionsRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resetBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  resetBtnText: { fontSize: 10, fontWeight: '600', color: colors.textDim },
  editShortcutsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: alphaHex(colors.primary, '16'),
    borderWidth: 1,
    borderColor: alphaHex(colors.primary, '35'),
  },
  editShortcutsBtnActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  editShortcutsBtnText: { fontSize: 10, fontWeight: '700', color: colors.primary },

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
    position: 'relative',
  },
  shortcutCardEditing: {
    borderColor: alphaHex(colors.error, '55'),
    borderStyle: 'dashed',
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
  removeBadge: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.error,
    alignItems: 'center',
    justifyContent: 'center',
  },

  addShortcutCard: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: alphaHex(colors.primary, '08'),
    borderWidth: 1,
    borderColor: alphaHex(colors.primary, '35'),
    borderStyle: 'dashed',
    borderRadius: radius.md,
    padding: 10,
  },
  addShortcutIcon: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    backgroundColor: alphaHex(colors.primary, '18'),
    alignItems: 'center',
    justifyContent: 'center',
  },
  addShortcutLabel: { fontSize: 12, fontWeight: '700', color: colors.primary },

  pickerBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 8,
  },
  pickerHelp: {
    fontSize: 11,
    color: colors.textDim,
    lineHeight: 15,
  },
  pickerChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  pickerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  pickerChipText: {
    fontSize: 11,
    color: colors.textDim,
    fontWeight: '600',
  },

  group: { marginBottom: 18 },
  groupTitle: { fontSize: 10, fontWeight: '700', color: colors.textFaint, letterSpacing: 1.2, marginBottom: 6, paddingLeft: 6 },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  item: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: radius.md,
  },
  itemIcon: { width: 30, height: 30, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  itemLabel: { fontSize: 13, color: colors.text, fontWeight: '600' },
  itemHint: { fontSize: 11, color: colors.textFaint, marginTop: 1 },
  pinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: alphaHex(colors.primary, '14'),
    borderWidth: 1,
    borderColor: alphaHex(colors.primary, '35'),
  },
  pinBtnActive: {
    backgroundColor: alphaHex(colors.error, '14'),
    borderColor: alphaHex(colors.error, '35'),
  },
  pinBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
  },

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
    color: colors.textFaint,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
