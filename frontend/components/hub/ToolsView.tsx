import { useState, useMemo, type ComponentProps } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTaskStore } from '../../store/taskStore';
import { space, radius, font, alphaHex, hexA, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { todayLocal } from '../../lib/date';
import { haptic } from '../../lib/haptics';
import {
  hubDestinations,
  navigateTo,
  type DestinationId,
  type HubCategory,
} from '../../lib/destinations';
import { EmbeddedFiligree } from '../spatial';
import { BENTO_ART, DECOR, SCREEN_BANNERS } from '../../lib/visualAssets';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export const TOOL_CATEGORIES: { key: HubCategory | 'all'; label: string; icon: IoniconName }[] = [
  { key: 'all', label: 'Tümü', icon: 'grid-outline' },
  { key: 'strategy', label: 'Strateji & OKR', icon: 'flag-outline' },
  { key: 'focus', label: 'Odak & Rutin', icon: 'flash-outline' },
  { key: 'library', label: 'Kütüphane', icon: 'book-outline' },
  { key: 'review', label: 'Raporlar', icon: 'bar-chart-outline' },
  { key: 'system', label: 'Sistem', icon: 'settings-outline' },
];

export type ToolsViewProps = {
  category: HubCategory | 'all';
  onCategory: (c: HubCategory | 'all') => void;
};

export default function ToolsView({ category, onCategory }: ToolsViewProps) {
  const router = useRouter();
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const tasks = useTaskStore((st) => st.tasks);
  const [search, setSearch] = useState('');

  const recoveryCount = useMemo(
    () => tasks.filter((t) => t.due_date && t.due_date < todayLocal() && !t.completed).length,
    [tasks],
  );

  const filteredTools = useMemo(() => {
    const items = hubDestinations(category);
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q) return items;
    return items.filter(
      (i) =>
        i.label.toLocaleLowerCase('tr-TR').includes(q) ||
        i.hub.blurb.toLocaleLowerCase('tr-TR').includes(q),
    );
  }, [category, search]);

  function openDestination(id: DestinationId) {
    haptic.select();
    navigateTo(router, id);
  }

  const isSearching = search.trim().length > 0;

  return (
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.header}>
        <View style={s.searchWrap}>
          <Ionicons name="search-outline" size={18} color={c.textFaint} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Modül veya araç ara (örn: okr, kitap, odak)..."
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            accessibilityLabel="Modül veya araç ara"
          />
          {search.length > 0 && (
            <TouchableOpacity
              onPress={() => setSearch('')}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityRole="button"
              accessibilityLabel="Aramayı temizle"
            >
              <Ionicons name="close-circle" size={18} color={c.textFaint} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.catList}
        >
          {TOOL_CATEGORIES.map((cat) => {
            const active = category === cat.key;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[s.catPill, active && s.catPillActive]}
                onPress={() => {
                  haptic.select();
                  onCategory(cat.key);
                }}
                accessibilityRole="button"
                accessibilityLabel={cat.label}
                accessibilityState={{ selected: active }}
              >
                <Ionicons
                  name={cat.icon}
                  size={13}
                  color={active ? c.white : c.textDim}
                />
                <Text style={[s.catText, active && s.catTextActive]}>{cat.label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {!isSearching && category === 'all' && (
        <View style={s.bentoWrap}>
          <Text style={s.sectionHeader}>ÖNE ÇIKAN MERKEZLER</Text>

          <TouchableOpacity
            style={s.heroCard}
            onPress={() => openDestination('okr')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="OKR ve Strateji Merkezini Aç"
          >
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <Image
                source={BENTO_ART.hubToolsStrategy}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                cachePolicy="memory-disk"
              />
              <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(c.bgSunk, 0.56) }]} />
            </View>
            <EmbeddedFiligree source={DECOR.cornerBlueprint} anchor="bottom-right" size={124} opacity={0.18} />
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

          <View style={s.twinRow}>
            <TouchableOpacity
              style={s.twinCard}
              onPress={() => openDestination('routine-runner')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Rutin Yürütücüyü Başlat"
            >
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <Image
                  source={SCREEN_BANNERS.runnerSteppingStones}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(c.bgSunk, 0.62) }]} />
              </View>
              <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={96} opacity={0.18} />
              <View style={[s.twinIcon, { backgroundColor: alphaHex(c.success, '20') }]}>
                <Ionicons name="play" size={20} color={c.success} />
              </View>
              <Text style={s.twinTitle}>Rutin Yürütücü</Text>
              <Text style={s.twinSub} numberOfLines={2}>
                Sabah & akşam ritüellerini başlat
              </Text>
              <View style={s.twinPill}>
                <Text style={s.twinPillText}>▶ Başlat</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.twinCard}
              onPress={() => openDestination('deep-work')}
              activeOpacity={0.8}
              accessibilityRole="button"
              accessibilityLabel="Derin Çalışma Başlat"
            >
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <Image
                  source={BENTO_ART.hubToolsDeepfocus}
                  style={StyleSheet.absoluteFill}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                />
                <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(c.bgSunk, 0.58) }]} />
              </View>
              <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={96} opacity={0.18} />
              <View style={[s.twinIcon, { backgroundColor: alphaHex(c.teal, '20') }]}>
                <Ionicons name="flash" size={20} color={c.teal} />
              </View>
              <Text style={s.twinTitle}>Derin Çalışma</Text>
              <Text style={s.twinSub} numberOfLines={2}>
                Kesintisiz odaklanma oturumu
              </Text>
              <View style={s.twinPill}>
                <Text style={s.twinPillText}>⏱️ Odaklan</Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={s.gridWrap}>
        <Text style={s.sectionHeader}>
          {isSearching
            ? `ARAMA SONUÇLARI (${filteredTools.length})`
            : 'TÜM MODÜLLER & ARAÇLAR'}
        </Text>

        {filteredTools.length === 0 ? (
          <View style={s.emptyBox}>
            <Ionicons name="search" size={32} color={c.textFaint} />
            <Text style={s.emptyTitle}>Eşleşen modül bulunamadı</Text>
            <Text style={s.emptySub}>
              Farklı bir arama terimi deneyin veya filtreyi sıfırlayın.
            </Text>
          </View>
        ) : (
          <View style={s.grid}>
            {filteredTools.map((item) => {
              const badge = item.id === 'recovery' ? recoveryCount : 0;
              const toneColor = c[item.tone];
              return (
                <TouchableOpacity
                  key={item.id}
                  style={s.card}
                  activeOpacity={0.75}
                  onPress={() => openDestination(item.id)}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                >
                  <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={82} opacity={0.12} />
                  <View style={s.cardTop}>
                    <View style={[s.cardIcon, { backgroundColor: alphaHex(toneColor, '18') }]}>
                      <Ionicons name={item.icon as IoniconName} size={22} color={toneColor} />
                    </View>
                    {badge > 0 && (
                      <View style={[s.badge, { backgroundColor: toneColor }]}>
                        <Text style={s.badgeText}>{badge}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={s.cardTitle} numberOfLines={1}>
                    {item.label}
                  </Text>
                  <Text style={s.cardSub} numberOfLines={2}>
                    {item.hub.blurb}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    content: { padding: space.md, paddingTop: space.xs, paddingBottom: space.hh },
    header: { marginBottom: space.md },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      marginBottom: space.sm,
      minHeight: 44,
    },
    searchInput: { ...font.body, flex: 1, color: c.text },
    catList: { flexDirection: 'row', gap: space.xs, paddingVertical: space.xs },
    catPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      borderRadius: radius.pill,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.borderSubtle,
      minHeight: 36,
    },
    catPillActive: {
      backgroundColor: c.primary,
      borderColor: c.primary,
    },
    catText: { ...font.caption, fontWeight: '600', color: c.textDim },
    catTextActive: { color: c.white },
    sectionHeader: {
      ...font.overline,
      color: c.textFaint,
      marginBottom: space.sm,
    },
    bentoWrap: { marginBottom: space.lg },
    heroCard: {
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: alphaHex(c.error, '40'),
      borderRadius: radius.lg,
      padding: space.md,
      marginBottom: space.sm,
    },
    heroContent: { marginBottom: space.sm },
    heroBadge: {
      alignSelf: 'flex-start',
      backgroundColor: alphaHex(c.error, '20'),
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.xs,
      marginBottom: space.xs,
    },
    heroBadgeText: { ...font.overline, color: c.error },
    heroTitle: { ...font.h3, fontWeight: '800', color: c.text, marginBottom: space.xs },
    heroSub: { ...font.bodySm, color: c.textDim },
    heroAction: {
      alignSelf: 'flex-start',
      backgroundColor: alphaHex(c.error, '15'),
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      borderRadius: radius.sm,
    },
    heroActionText: { ...font.caption, fontWeight: '700', color: c.error },
    twinRow: { flexDirection: 'row', gap: space.sm },
    twinCard: {
      overflow: 'hidden',
      position: 'relative',
      flex: 1,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.lg,
      padding: space.md,
    },
    twinIcon: {
      width: 38,
      height: 38,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: space.sm,
    },
    twinTitle: { ...font.body, fontWeight: '700', color: c.text, marginBottom: space.xs },
    twinSub: { ...font.caption, color: c.textDim, marginBottom: space.sm },
    twinPill: {
      alignSelf: 'flex-start',
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.xs,
      borderWidth: 1,
      borderColor: c.borderSubtle,
    },
    twinPillText: { ...font.caption, fontWeight: '700', color: c.text },
    gridWrap: { marginBottom: space.xl },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 10,
    },
    card: {
      overflow: 'hidden',
      position: 'relative',
      width: '48.5%',
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      padding: space.md,
      borderWidth: 1,
      borderColor: c.border,
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: space.sm,
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
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: space.xs,
    },
    badgeText: { ...font.caption, color: c.white, fontWeight: '800' },
    cardTitle: { ...font.bodySm, fontWeight: '700', color: c.text, marginBottom: space.xs },
    cardSub: { ...font.caption, color: c.textDim },
    emptyBox: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.borderSubtle,
      borderRadius: radius.lg,
      padding: space.xl,
      alignItems: 'center',
      gap: space.xs,
      marginTop: space.sm,
    },
    emptyTitle: { ...font.body, fontWeight: '700', color: c.text, marginTop: space.xs },
    emptySub: { ...font.bodySm, color: c.textDim, textAlign: 'center' },
  });
