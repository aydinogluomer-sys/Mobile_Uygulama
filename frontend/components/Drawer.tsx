/**
 * F28 (NAV-11, NAV-21) — Single-catalog Drawer.
 *
 * Consumes `visibleDestinations('drawer')` from `lib/destinations.ts` instead of
 * a duplicate local module list (legacy shortcut routes such as `/screens/monthly-review`,
 * `/screens/reading-list`, and `/screens/calendar` resolve through `destinationForLegacyRoute`).
 * Shows the 8 `tier === 'core'` destinations up top and groups `more` + `labs` under
 * a collapsible "Daha fazla" section (`moreOpen ?? stage === 'established'`).
 */
import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useShallow } from 'zustand/react/shallow';
import { useDrawerStore } from '../store/drawerStore';
import { useCommandStore } from '../store/commandStore';
import { useProfileStore } from '../store/profileStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useDisclosureStore } from '../store/disclosureStore';
import { currentUser } from '../lib/session';
import {
  destinationForLegacyRoute,
  navigateTo,
  routeKeyOf,
  visibleDestinations,
  type Destination,
  type DestinationId,
  type DrawerGroup,
  type ToneKey,
} from '../lib/destinations';
import { colors, alphaHex, radius } from '../lib/tokens';
import { TEXTURES } from '../lib/visualAssets';
import TexturedSurface from './ui/TexturedSurface';
import IconButton from './ui/IconButton';
import { useReducedMotion } from './seasonalMotion/useReducedMotion';

export const MAX_DRAWER_WIDTH = 310;
const CLOSE_DURATION_MS = 310;

export function drawerWidth(windowWidth: number): number {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return MAX_DRAWER_WIDTH;
  return Math.min(MAX_DRAWER_WIDTH, Math.max(220, Math.round(windowWidth - 45)));
}

export function shouldRenderDrawer(input: {
  isOpen: boolean;
  mounted: boolean;
  platform: string;
}): boolean {
  if (input.platform === 'web') return true;
  return input.isOpen || input.mounted;
}

const DRAWER_GROUPS: readonly DrawerGroup[] = [
  'PLANLAMA',
  'ALIŞKANLIKLAR',
  'KİŞİSEL',
  'SİSTEM',
];

function toneColor(tone: ToneKey): string {
  return colors[tone];
}

function shortcutKeyFor(dest: Destination, shortcutRoutes: readonly string[]): string {
  const existing = shortcutRoutes.find((r) => destinationForLegacyRoute(r)?.id === dest.id);
  if (existing) return existing;
  return dest.legacyRoutes[0] ?? routeKeyOf(dest.href);
}

function ShortcutCard({
  dest,
  routeKey,
  editing,
  onNavigate,
  onRemove,
}: {
  dest: Destination;
  routeKey: string;
  editing: boolean;
  onNavigate: (id: DestinationId) => void;
  onRemove: (route: string) => void;
}) {
  const name = dest.shortLabel || dest.label;
  const color = toneColor(dest.tone);
  const iconName = dest.icon as keyof typeof Ionicons.glyphMap;
  const inner = (
    <>
      <View style={[s.shortcutIcon, { backgroundColor: alphaHex(color, '20') }]}>
        <Ionicons name={iconName} size={18} color={color} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.shortcutLabel} numberOfLines={1}>{name}</Text>
        <Text style={s.shortcutHint} numberOfLines={1}>{dest.hint}</Text>
      </View>
    </>
  );

  if (editing) {
    return (
      <View style={[s.shortcutCard, s.shortcutCardEditing]}>
        {inner}
        <IconButton
          compact
          icon="close"
          size={14}
          color={colors.error}
          label={`${name} kısayolunu kaldır`}
          onPress={() => onRemove(routeKey)}
        />
      </View>
    );
  }

  return (
    <TouchableOpacity
      style={s.shortcutCard}
      onPress={() => onNavigate(dest.id)}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={name}
    >
      {inner}
    </TouchableOpacity>
  );
}

export default function Drawer() {
  const router = useRouter();
  const { width: winWidth } = useWindowDimensions();
  const panelWidth = drawerWidth(winWidth);

  const {
    isOpen,
    close,
    moreOpen,
    setMoreOpen,
    shortcutRoutes,
    hydrateShortcuts,
    removeShortcut,
    toggleShortcut,
    resetShortcuts,
  } = useDrawerStore(
    useShallow((st) => ({
      isOpen: st.isOpen,
      close: st.close,
      moreOpen: st.moreOpen,
      setMoreOpen: st.setMoreOpen,
      shortcutRoutes: st.shortcutRoutes,
      hydrateShortcuts: st.hydrateShortcuts,
      removeShortcut: st.removeShortcut,
      toggleShortcut: st.toggleShortcut,
      resetShortcuts: st.resetShortcuts,
    })),
  );
  const openCmd = useCommandStore((st) => st.open);
  const profile = useProfileStore((st) => st.profile);
  const focusPoints = useSubscriptionStore((st) => st.focusPoints);
  const stage = useDisclosureStore((st) => st.stage);

  const translateX = useRef(new Animated.Value(-panelWidth)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();
  const [mounted, setMounted] = useState(isOpen);
  const [isEditingShortcuts, setIsEditingShortcuts] = useState(false);

  useEffect(() => {
    let alive = true;
    void currentUser()
      .then((u) => {
        if (alive && u?.id) void hydrateShortcuts(u.id);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [hydrateShortcuts, isOpen]);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      if (reduceMotion) {
        translateX.setValue(0);
        backdropOpacity.setValue(1);
        return;
      }
      Animated.parallel([
        Animated.spring(translateX, {
          toValue: 0,
          useNativeDriver: true,
          damping: 22,
          stiffness: 220,
        }),
        Animated.timing(backdropOpacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
      return;
    }

    setIsEditingShortcuts(false);
    if (reduceMotion) {
      translateX.setValue(-panelWidth);
      backdropOpacity.setValue(0);
      setMounted(false);
      return;
    }
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: -panelWidth,
        duration: CLOSE_DURATION_MS,
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: CLOSE_DURATION_MS,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [isOpen, panelWidth, translateX, backdropOpacity, reduceMotion]);

  function handleNavigate(id: DestinationId) {
    close();
    setTimeout(() => navigateTo(router, id), 100);
  }

  function handleOpenSearch() {
    close();
    setTimeout(() => openCmd(), 150);
  }

  if (!shouldRenderDrawer({ isOpen, mounted, platform: Platform.OS })) return null;

  const userLevel = profile?.level ?? 1;
  const username = profile?.username || 'Aderyth';
  const allDestinations = visibleDestinations('drawer');
  const coreItems = allDestinations.filter((d) => d.tier === 'core');
  const moreItems = allDestinations.filter((d) => d.tier !== 'core');
  const expanded = moreOpen ?? stage === 'established';

  const activeShortcuts: { routeKey: string; dest: Destination }[] = [];
  const seenShortcutIds = new Set<DestinationId>();
  for (const r of shortcutRoutes) {
    const dest = destinationForLegacyRoute(r);
    if (dest && !seenShortcutIds.has(dest.id)) {
      seenShortcutIds.add(dest.id);
      activeShortcuts.push({ routeKey: r, dest });
    }
  }

  const hiddenA11yProps =
    !isOpen && Platform.OS === 'web'
      ? ({ 'aria-hidden': true } as Record<string, unknown>)
      : !isOpen
        ? {
            accessibilityElementsHidden: true,
            importantForAccessibility: 'no-hide-descendants' as const,
          }
        : {};

  const renderNavRow = (item: Destination) => {
    const color = toneColor(item.tone);
    const iconName = item.icon as keyof typeof Ionicons.glyphMap;
    const isPinned = seenShortcutIds.has(item.id);
    const pinRouteKey = shortcutKeyFor(item, shortcutRoutes);

    return (
      <View key={item.id} style={s.itemRow}>
        <TouchableOpacity
          style={s.item}
          onPress={() => handleNavigate(item.id)}
          accessibilityRole="button"
          accessibilityLabel={item.label}
        >
          <View style={[s.itemIcon, { backgroundColor: alphaHex(color, '15') }]}>
            <Ionicons name={iconName} size={17} color={color} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.itemLabel} numberOfLines={2}>{item.label}</Text>
            {item.hint ? <Text style={s.itemHint} numberOfLines={2}>{item.hint}</Text> : null}
          </View>
          {!isEditingShortcuts && (
            <Ionicons name="chevron-forward" size={14} color={colors.textGhost} />
          )}
        </TouchableOpacity>
        {isEditingShortcuts && (
          <TouchableOpacity
            style={[s.pinBtn, isPinned && s.pinBtnActive]}
            onPress={() => toggleShortcut(pinRouteKey)}
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
  };

  return (
    <Modal
      visible={Platform.OS === 'web' ? isOpen : isOpen || mounted}
      transparent
      animationType="none"
      onRequestClose={close}
    >
      <View
        style={StyleSheet.absoluteFill}
        pointerEvents={isOpen ? 'auto' : 'none'}
        {...hiddenA11yProps}
      >
        {/* Backdrop */}
        <Animated.View style={[s.backdrop, { opacity: backdropOpacity }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Menüyü kapat"
          />
        </Animated.View>

        {/* Panel */}
        <Animated.View style={[s.panel, { width: panelWidth, transform: [{ translateX }] }]}>
          <TexturedSurface source={TEXTURES.linen} textureOpacity={0.07} overlayOnly />
          <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
            {/* Header & Profil Kartı */}
            <View style={s.header}>
              <TouchableOpacity
                style={s.headerLeft}
                onPress={() => handleNavigate('profile')}
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
              <TouchableOpacity
                onPress={close}
                style={s.closeBtn}
                accessibilityRole="button"
                accessibilityLabel="Menüyü kapat"
              >
                <Ionicons name="close" size={20} color={colors.textFaint} />
              </TouchableOpacity>
            </View>

            <View style={s.divider} />

            {/* Nav items */}
            <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>
              {/* 1. Hızlı Kısayollar */}
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
                  {activeShortcuts.map(({ routeKey, dest }) => (
                    <ShortcutCard
                      key={dest.id}
                      dest={dest}
                      routeKey={routeKey}
                      editing={isEditingShortcuts}
                      onNavigate={handleNavigate}
                      onRemove={removeShortcut}
                    />
                  ))}

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

                {isEditingShortcuts && (
                  <View style={s.pickerBox}>
                    <Text style={s.pickerHelp}>
                      Hızlı kısayollarda görmek istediğiniz modüllere dokunarak ekleyebilir veya çıkarabilirsiniz:
                    </Text>
                    <View style={s.pickerChipsWrap}>
                      {allDestinations.map((mod) => {
                        const isPinned = seenShortcutIds.has(mod.id);
                        const color = toneColor(mod.tone);
                        const iconName = mod.icon as keyof typeof Ionicons.glyphMap;
                        const pinRouteKey = shortcutKeyFor(mod, shortcutRoutes);
                        return (
                          <TouchableOpacity
                            key={mod.id}
                            style={[
                              s.pickerChip,
                              isPinned && {
                                backgroundColor: alphaHex(color, '22'),
                                borderColor: color,
                              },
                            ]}
                            onPress={() => toggleShortcut(pinRouteKey)}
                            activeOpacity={0.75}
                            accessibilityRole="button"
                            accessibilityLabel={isPinned ? `${mod.label} kısayolunu çıkar` : `${mod.label} kısayolunu ekle`}
                          >
                            <Ionicons
                              name={iconName}
                              size={13}
                              color={isPinned ? color : colors.textDim}
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
                              color={isPinned ? color : colors.textGhost}
                            />
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                )}
              </View>

              {/* 2. Çekirdek Gezinme (tier === 'core', 8 öğe) */}
              <View style={s.group}>
                <Text style={s.groupTitle}>TEMEL YÜZEYLER</Text>
                {coreItems.map(renderNavRow)}
              </View>

              {/* 3. Katlanır "Daha fazla" (more + labs) */}
              <TouchableOpacity
                style={s.moreToggle}
                onPress={() => setMoreOpen(!expanded)}
                accessibilityRole="button"
                accessibilityLabel="Daha fazla"
                accessibilityState={{ expanded }}
              >
                <Text style={s.moreToggleText}>Daha fazla</Text>
                <Ionicons
                  name={expanded ? 'chevron-up' : 'chevron-down'}
                  size={16}
                  color={colors.textDim}
                />
              </TouchableOpacity>

              {expanded &&
                DRAWER_GROUPS.map((groupTitle) => {
                  const groupItems = moreItems.filter((item) => item.drawerGroup === groupTitle);
                  if (groupItems.length === 0) return null;
                  return (
                    <View key={groupTitle} style={s.group}>
                      <Text style={s.groupTitle}>{groupTitle}</Text>
                      {groupItems.map(renderNavRow)}
                    </View>
                  );
                })}
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
      </View>
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
  closeBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm },
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

  moreToggle: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  moreToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textDim,
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
    minHeight: 44,
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
    minHeight: 44,
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
    minHeight: 44,
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
