import { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { useRoutineStore } from '../../store/routineStore';
import { colors, space, radius, font, alphaHex, hexA } from '../../lib/tokens';
import { todayLocal } from '../../lib/date';
import { haptic } from '../../lib/haptics';
import AIRoutineModal from '../../components/AIRoutineModal';
import FocusFlowView from '../../components/FocusFlowView';
import { AtmosphericScreenCanvas, EditorialBanner, EmbeddedFiligree, EmblemMedallion, TexturedSurface } from '../../components/ui';
import { BENTO_ART, CANVASES, DECOR, getPackCover, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
import {
  EXPLORE_CATEGORIES,
  EXPLORE_COLLECTIONS,
  EXPLORE_ATOMIC_HABITS,
  getRecommendedCollectionForHour,
  buildAtomicHabitInsert,
  type ExploreCategory,
  type ExploreCollection,
  type ExploreAtomicHabit,
} from '../../lib/exploreCatalog';

type HubMode = 'flow' | 'explore' | 'tools';
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

const TOOL_CATEGORIES: { key: HubCategory; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'all', label: 'Tümü', icon: 'grid-outline' },
  { key: 'strategy', label: 'Strateji & OKR', icon: 'flag-outline' },
  { key: 'focus', label: 'Odak & Rutin', icon: 'flash-outline' },
  { key: 'library', label: 'Kütüphane', icon: 'book-outline' },
  { key: 'review', label: 'Raporlar', icon: 'bar-chart-outline' },
  { key: 'system', label: 'Sistem', icon: 'settings-outline' },
];

const HUB_ITEMS: HubItem[] = [
  {
    id: 'okr',
    label: 'OKR & Key Results',
    subtitle: 'Çeyreklik hedefler ve ölçülebilir sonuçlar',
    icon: 'flag',
    color: colors.error,
    route: '/screens/okr',
    category: 'strategy',
    featured: true,
  },
  {
    id: 'goals',
    label: 'Hedefler',
    subtitle: 'Yıllık ve aylık vizyon hedefleri',
    icon: 'trophy',
    color: colors.warning,
    route: '/screens/goals',
    category: 'strategy',
  },
  {
    id: 'life_areas',
    label: 'Yaşam Alanları',
    subtitle: '8 alanlık yaşam dengesi çarkı',
    icon: 'pie-chart',
    color: colors.success,
    route: '/screens/life-areas',
    category: 'strategy',
  },
  {
    id: 'projects',
    label: 'Projeler',
    subtitle: 'Aktif hedefler ve kilometre taşları',
    icon: 'folder',
    color: colors.info,
    route: '/screens/projects',
    category: 'strategy',
  },
  {
    id: 'calendar',
    label: 'Takvim Planı',
    subtitle: 'Zaman blokları ve gün planı',
    icon: 'calendar',
    color: colors.info,
    route: '/screens/calendar',
    category: 'strategy',
  },
  {
    id: 'focus_flow',
    label: 'Odak Akışı (Flow)',
    subtitle: 'Dikey verimlilik videoları ve Inflow mikro-dersleri',
    icon: 'play-circle',
    color: colors.primary,
    route: '/screens/focus-flow',
    category: 'focus',
    featured: true,
  },
  {
    id: 'routine_runner',
    label: 'Rutin Yürütücü',
    subtitle: 'Sabah & akşam adımlarını koştur',
    icon: 'play-circle',
    color: colors.success,
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
    color: colors.error,
    route: '/screens/eisenhower',
    category: 'focus',
  },
  {
    id: 'recovery',
    label: 'Telafi & Shield',
    subtitle: 'Geciken görevleri toparla',
    icon: 'refresh-circle',
    color: colors.warning,
    route: '/screens/recovery',
    category: 'focus',
  },
  {
    id: 'reading_list',
    label: 'Okuma Listesi',
    subtitle: 'Kitaplık ve sayfa hedefleri',
    icon: 'book',
    color: colors.teal,
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
    color: colors.primaryBright,
    route: '/screens/journal',
    category: 'library',
  },
  {
    id: 'ai_coach',
    label: 'AI Koç',
    subtitle: 'Alışkanlık ve davranış rehberi',
    icon: 'sparkles',
    color: colors.info,
    route: '/screens/ai-coach',
    category: 'library',
  },
  {
    id: 'monthly_review',
    label: 'Aylık Değerlendirme',
    subtitle: 'Aylık başarı ve gelişim raporu',
    icon: 'calendar-number',
    color: colors.info,
    route: '/screens/monthly-review',
    category: 'review',
  },
  {
    id: 'weekly_review',
    label: 'Haftalık Rapor',
    subtitle: 'Haftalık kazanımlar ve trendler',
    icon: 'bar-chart',
    color: colors.teal,
    route: '/screens/weekly-review',
    category: 'review',
  },
  {
    id: 'achievements',
    label: 'Başarımlar & Rozetler',
    subtitle: 'Kazanılan rozetler ve XP ödülleri',
    icon: 'ribbon',
    color: colors.warning,
    route: '/screens/achievements',
    category: 'review',
  },
  {
    id: 'leaderboard',
    label: 'Sıralama Ligi',
    subtitle: 'Seviye ve küresel lig sıralaması',
    icon: 'podium',
    color: colors.warning,
    route: '/screens/leaderboard',
    category: 'review',
  },
  {
    id: 'stats',
    label: 'Detaylı İstatistikler',
    subtitle: 'Alışkanlık oranları ve heatmap',
    icon: 'stats-chart',
    color: colors.info,
    route: '/tabs/stats',
    category: 'review',
  },
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

function difficultyText(d: 1 | 3 | 5): string {
  if (d === 1) return 'Kolay';
  if (d === 3) return 'Orta';
  return 'Yoğun';
}

export default function HubScreen() {
  const router = useRouter();
  const { tasks } = useTaskStore();
  const { habits, fetchHabits, addHabit } = useHabitStore();
  const {
    loadPack,
    evaluation,
    installing,
    installed,
    installError,
    confirmInstall,
    clearGenerated,
  } = useRoutineStore();

  const [mode, setMode] = useState<HubMode>('flow');
  const [search, setSearch] = useState('');
  const [exploreCat, setExploreCat] = useState<ExploreCategory>('all');
  const [selectedToolCat, setSelectedToolCat] = useState<HubCategory>('all');
  const [selectedCollection, setSelectedCollection] = useState<ExploreCollection | null>(null);
  const [addingHabitId, setAddingHabitId] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const [aiModalVisible, setAiModalVisible] = useState(false);

  useEffect(() => {
    fetchHabits();
  }, [fetchHabits]);

  const existingHabitNames = useMemo(() => {
    const set = new Set<string>();
    for (const h of habits) {
      if (h.status !== 'archived') {
        set.add(h.name.trim().toLocaleLowerCase('tr-TR'));
      }
    }
    return set;
  }, [habits]);

  const activeHabits = useMemo(
    () => habits.filter((h) => h.status === 'active'),
    [habits],
  );

  const recommendedCollection = useMemo(
    () => getRecommendedCollectionForHour(new Date().getHours()),
    [],
  );

  const recoveryCount = tasks.filter(
    (t) => t.due_date && t.due_date < todayLocal() && !t.completed,
  ).length;

  const filteredAtomicHabits = useMemo(() => {
    let list = EXPLORE_ATOMIC_HABITS;
    if (exploreCat !== 'all') {
      list = list.filter((item) => item.category === exploreCat);
    }
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (q) {
      list = list.filter(
        (item) =>
          item.name.toLocaleLowerCase('tr-TR').includes(q) ||
          item.whyItWorks.toLocaleLowerCase('tr-TR').includes(q) ||
          item.life_area.toLocaleLowerCase('tr-TR').includes(q),
      );
    }
    return list;
  }, [exploreCat, search]);

  const filteredCollections = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (!q && exploreCat === 'all') return EXPLORE_COLLECTIONS;

    return EXPLORE_COLLECTIONS.filter((col) => {
      if (exploreCat !== 'all') {
        const catMap: Record<Exclude<ExploreCategory, 'all'>, string[]> = {
          morning: ['morning-reset'],
          focus: ['deep-work'],
          sleep: ['sleep-reset'],
          health: ['fitness-foundation', 'morning-reset'],
          mind: ['everyday-foundations', 'sleep-reset'],
          finance: ['everyday-foundations'],
        };
        if (!catMap[exploreCat].includes(col.key)) return false;
      }
      if (q) {
        const inTitle = col.pack.title.toLocaleLowerCase('tr-TR').includes(q);
        const inGoal = col.pack.goal.toLocaleLowerCase('tr-TR').includes(q);
        const inHabits = col.pack.habits.some((h) =>
          h.name.toLocaleLowerCase('tr-TR').includes(q),
        );
        return inTitle || inGoal || inHabits;
      }
      return true;
    });
  }, [exploreCat, search]);

  const filteredTools = useMemo(() => {
    let items = HUB_ITEMS;
    if (selectedToolCat !== 'all') {
      items = items.filter((i) => i.category === selectedToolCat);
    }
    const q = search.trim().toLocaleLowerCase('tr-TR');
    if (q) {
      items = items.filter(
        (i) =>
          i.label.toLocaleLowerCase('tr-TR').includes(q) ||
          i.subtitle.toLocaleLowerCase('tr-TR').includes(q),
      );
    }
    return items;
  }, [search, selectedToolCat]);

  function navigate(route: string) {
    haptic.select();
    const base = route.split('?')[0];
    router.push(base as any);
  }

  function showBanner(msg: string) {
    setFeedbackBanner(msg);
    setTimeout(() => {
      setFeedbackBanner((cur) => (cur === msg ? null : cur));
    }, 3500);
  }

  async function handleAddAtomicHabit(item: ExploreAtomicHabit) {
    if (addingHabitId) return;
    const norm = item.name.trim().toLocaleLowerCase('tr-TR');
    if (existingHabitNames.has(norm)) return;

    haptic.medium();
    setAddingHabitId(item.id);
    try {
      const { insertPayload, assignedStatus } = buildAtomicHabitInsert(item, activeHabits);
      const created = await addHabit(insertPayload);
      if (created) {
        if (assignedStatus === 'active') {
          showBanner(`✓ "${item.name}" aktif alışkanlıklarınıza eklendi.`);
        } else {
          showBanner(`⏳ "${item.name}" kapasitenizi korumak için bekleme (Triage) listesine eklendi.`);
        }
      }
    } finally {
      setAddingHabitId(null);
    }
  }

  function openCollectionPreview(col: ExploreCollection) {
    haptic.select();
    clearGenerated();
    loadPack(col.key);
    setSelectedCollection(col);
  }

  function closeCollectionPreview() {
    setSelectedCollection(null);
    clearGenerated();
  }

  async function handleInstallCollection() {
    if (installing) return;
    haptic.medium();
    await confirmInstall();
    await fetchHabits({ force: true });
  }

  const isSearching = search.trim().length > 0;

  return (
    <SafeAreaView style={s.safe} edges={['bottom']}>
      <AtmosphericScreenCanvas
        source={CANVASES.todaySanctuary}
        textureSource={TEXTURES.clay}
        scrim={0.66}
        tintColor={colors.primary}
      />
      {/* Sabit Üst Başlık & 3 Modlu Anahtar */}
      <View style={s.topChrome}>
        <View style={s.titleRow}>
          <View style={{ flex: 1 }}>
            <Text style={s.pageTitle}>Keşfet</Text>
            <Text style={s.pageSub}>
              {mode === 'flow'
                ? 'Sıfır dikkat dağınıklığıyla dikey verimlilik videoları & Inflow akışı'
                : mode === 'explore'
                  ? 'Bilimsel rutin koleksiyonları ve tek dokunuşla mikro alışkanlıklar'
                  : 'Tüm sistem modüllerine ve araçlara tek noktadan ulaşın'}
            </Text>
          </View>
          <TouchableOpacity
            style={s.aiQuickBtn}
            onPress={() => {
              haptic.select();
              setAiModalVisible(true);
            }}
            accessibilityRole="button"
            accessibilityLabel="AI Rutin Tasarımcısını Aç"
          >
            <Ionicons name="sparkles" size={14} color={colors.white} />
            <Text style={s.aiQuickBtnText}>AI Rutin</Text>
          </TouchableOpacity>
        </View>

        {/* 3 Modlu Segmented Switch (Odak Akışı vs. Rutin Keşfet vs. Sistem Araçları) */}
        <View style={s.modeBar}>
          <TouchableOpacity
            style={[s.modeTab, mode === 'flow' && s.modeTabFlowActive]}
            onPress={() => {
              haptic.select();
              setMode('flow');
            }}
            accessibilityRole="button"
            accessibilityLabel="Odak Akışı (Flow)"
          >
            <Ionicons
              name="flame"
              size={14}
              color={mode === 'flow' ? colors.white : colors.primary}
            />
            <Text style={[s.modeTabText, mode === 'flow' && s.modeTabTextActive]}>
              Odak Akışı
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.modeTab, mode === 'explore' && s.modeTabActive]}
            onPress={() => {
              haptic.select();
              setMode('explore');
            }}
            accessibilityRole="button"
            accessibilityLabel="Rutin ve Alışkanlık Keşfet"
          >
            <Ionicons
              name="sparkles-outline"
              size={14}
              color={mode === 'explore' ? colors.white : colors.textDim}
            />
            <Text style={[s.modeTabText, mode === 'explore' && s.modeTabTextActive]}>
              Rutin Keşfet
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.modeTab, mode === 'tools' && s.modeTabActive]}
            onPress={() => {
              haptic.select();
              setMode('tools');
            }}
            accessibilityRole="button"
            accessibilityLabel="Sistem ve Araçlar"
          >
            <Ionicons
              name="compass-outline"
              size={14}
              color={mode === 'tools' ? colors.white : colors.textDim}
            />
            <Text style={[s.modeTabText, mode === 'tools' && s.modeTabTextActive]}>
              Araçlar
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {mode === 'flow' ? (
        <View style={s.flowBody}>
          <FocusFlowView
            showExpandButton
            onRequestExplorePacks={() => setMode('explore')}
          />
        </View>
      ) : (
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
          <View style={s.header}>
            {/* Arama Çubuğu */}
            <View style={s.searchWrap}>
            <Ionicons name="search-outline" size={18} color={colors.textFaint} />
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={
                mode === 'explore'
                  ? 'Alışkanlık, koleksiyon veya bilimsel etki ara (örn: uyku, su, odak)...'
                  : 'Modül veya araç ara (örn: okr, kitap, odak)...'
              }
              placeholderTextColor={colors.textFaint}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
            {search.length > 0 && (
              <TouchableOpacity
                onPress={() => setSearch('')}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons name="close-circle" size={18} color={colors.textFaint} />
              </TouchableOpacity>
            )}
          </View>

          {/* Kategori Filtre Çipleri */}
          {mode === 'explore' ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.catList}
            >
              {EXPLORE_CATEGORIES.map((cat) => {
                const active = exploreCat === cat.key;
                return (
                  <TouchableOpacity
                    key={cat.key}
                    style={[
                      s.catPill,
                      active && { backgroundColor: cat.color, borderColor: cat.color },
                    ]}
                    onPress={() => {
                      haptic.select();
                      setExploreCat(cat.key);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={cat.label}
                  >
                    <Ionicons
                      name={cat.icon as any}
                      size={13}
                      color={active ? colors.white : cat.color}
                    />
                    <Text style={[s.catText, active && s.catTextActive]}>{cat.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          ) : (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.catList}
            >
              {TOOL_CATEGORIES.map((cat) => {
                const active = selectedToolCat === cat.key;
                return (
                  <TouchableOpacity
                    key={cat.key}
                    style={[s.catPill, active && s.catPillActive]}
                    onPress={() => {
                      haptic.select();
                      setSelectedToolCat(cat.key);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={cat.label}
                  >
                    <Ionicons
                      name={cat.icon}
                      size={13}
                      color={active ? colors.white : colors.textDim}
                    />
                    <Text style={[s.catText, active && s.catTextActive]}>{cat.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          )}
        </View>

        {/* Canlı Geri Bildirim Toast Banner */}
        {feedbackBanner && (
          <View style={s.toastBanner}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={s.toastBannerText}>{feedbackBanner}</Text>
          </View>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            MOD 1: THEFOR TARZI RUTİN & ALIŞKANLIK KEŞFET VİTRİNİ
            ══════════════════════════════════════════════════════════════════ */}
        {mode === 'explore' ? (
          <>
            {/* 1. Günün Saatine Duyarlı Öne Çıkan Koleksiyon (Hero) */}
            {!isSearching && exploreCat === 'all' && (
              <View style={s.bentoWrap}>
                <Text style={s.sectionHeader}>ŞU AN İÇİN ÖNERİLEN KOLEKSİYON</Text>
                <TouchableOpacity
                  style={[
                    s.exploreHeroCard,
                    { borderColor: alphaHex(recommendedCollection.color, '45'), overflow: 'hidden', position: 'relative' },
                  ]}
                  onPress={() => openCollectionPreview(recommendedCollection)}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel={`${recommendedCollection.pack.title} koleksiyonunu incele`}
                >
                  <View style={StyleSheet.absoluteFill} pointerEvents="none">
                    <Image
                      source={getPackCover(recommendedCollection.key)}
                      style={StyleSheet.absoluteFill}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.68) }]} />
                  </View>
                  <TexturedSurface source={TEXTURES.topographic} textureOpacity={0.06} overlayOnly />
                  <View style={s.exploreHeroTop}>
                    <View
                      style={[
                        s.heroBadge,
                        { backgroundColor: alphaHex(recommendedCollection.color, '22') },
                      ]}
                    >
                      <Text style={[s.heroBadgeText, { color: recommendedCollection.color }]}>
                        {recommendedCollection.badge} · {recommendedCollection.timeWindowLabel}
                      </Text>
                    </View>
                    <View style={s.loadPill}>
                      <Ionicons name="speedometer-outline" size={12} color={colors.textDim} />
                      <Text style={s.loadPillText}>Yük {recommendedCollection.computedLoad}</Text>
                    </View>
                  </View>

                  <View style={s.exploreHeroTitleRow}>
                    <View
                      style={[
                        s.exploreHeroIconBox,
                        { backgroundColor: alphaHex(recommendedCollection.color, '20') },
                      ]}
                    >
                      <Ionicons
                        name={recommendedCollection.icon as any}
                        size={24}
                        color={recommendedCollection.color}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.heroTitle}>{recommendedCollection.pack.title}</Text>
                      <Text style={s.heroGoalText}>{recommendedCollection.pack.goal}</Text>
                    </View>
                  </View>

                  <Text style={s.heroSub}>{recommendedCollection.scientificSummary}</Text>

                  <View style={s.exploreHeroFooter}>
                    <View style={s.heroMetricsRow}>
                      <View style={s.heroMetricChip}>
                        <Ionicons name="layers-outline" size={12} color={colors.textDim} />
                        <Text style={s.heroMetricText}>
                          {recommendedCollection.pack.habits.length} alışkanlık
                        </Text>
                      </View>
                      <View style={s.heroMetricChip}>
                        <Ionicons name="time-outline" size={12} color={colors.textDim} />
                        <Text style={s.heroMetricText}>
                          ~{recommendedCollection.totalMinutes} dk/gün
                        </Text>
                      </View>
                    </View>

                    <View
                      style={[
                        s.heroAction,
                        { backgroundColor: recommendedCollection.color },
                      ]}
                    >
                      <Text style={[s.heroActionText, { color: colors.white }]}>
                        İncele & Kur →
                      </Text>
                    </View>
                  </View>
                </TouchableOpacity>
              </View>
            )}

            {/* 2. Küratörlü Rutin Koleksiyonları */}
            {filteredCollections.length > 0 && (
              <View style={s.sectionBlock}>
                <View style={s.sectionTitleRow}>
                  <Text style={s.sectionHeader}>KÜRATÖRLÜ RUTİN KOLEKSİYONLARI</Text>
                  <Text style={s.sectionCountText}>{filteredCollections.length} paket</Text>
                </View>

                <View style={s.collectionGrid}>
                  {filteredCollections.map((col) => {
                    const ownedCount = col.pack.habits.filter((h) =>
                      existingHabitNames.has(h.name.trim().toLocaleLowerCase('tr-TR')),
                    ).length;

                    return (
                      <TouchableOpacity
                        key={col.key}
                        style={s.collectionCard}
                        onPress={() => openCollectionPreview(col)}
                        activeOpacity={0.8}
                        accessibilityRole="button"
                        accessibilityLabel={`${col.pack.title} paketi`}
                      >
                        <View style={s.collectionCoverWrap}>
                          <Image
                            source={getPackCover(col.key)}
                            style={StyleSheet.absoluteFill}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                          />
                          <View
                            style={[
                              StyleSheet.absoluteFill,
                              { backgroundColor: hexA(colors.bgSunk, 0.42) },
                            ]}
                          />
                          <View style={s.collectionCardHeader}>
                            <View
                              style={[
                                s.collectionIcon,
                                { backgroundColor: hexA(colors.bgSunk, 0.72) },
                              ]}
                            >
                              <Ionicons name={col.icon as any} size={18} color={col.color} />
                            </View>
                            <View style={s.collectionHeaderBadges}>
                              {ownedCount > 0 && (
                                <View style={s.ownedBadge}>
                                  <Text style={s.ownedBadgeText}>
                                    {ownedCount}/{col.pack.habits.length} eklendi
                                  </Text>
                                </View>
                              )}
                              <View style={s.collectionMetaPill}>
                                <Text style={s.collectionMetaPillText}>~{col.totalMinutes} dk</Text>
                              </View>
                            </View>
                          </View>
                        </View>

                        <Text style={s.collectionTitle}>{col.pack.title}</Text>
                        <Text style={s.collectionGoal} numberOfLines={2}>
                          {col.pack.goal}
                        </Text>

                        {/* İlk 3 alışkanlık önizlemesi */}
                        <View style={s.previewStepsBox}>
                          {col.pack.habits.slice(0, 3).map((h) => {
                            const isOwned = existingHabitNames.has(
                              h.name.trim().toLocaleLowerCase('tr-TR'),
                            );
                            return (
                              <View key={h.name} style={s.previewStepRow}>
                                <Ionicons
                                  name={isOwned ? 'checkmark-circle' : (h.icon as any)}
                                  size={12}
                                  color={isOwned ? colors.success : col.color}
                                />
                                <Text style={s.previewStepText} numberOfLines={1}>
                                  {h.name}
                                </Text>
                              </View>
                            );
                          })}
                          {col.pack.habits.length > 3 && (
                            <Text style={s.moreStepsText}>
                              +{col.pack.habits.length - 3} adım daha…
                            </Text>
                          )}
                        </View>

                        <View style={s.collectionFooter}>
                          <Text style={[s.collectionCtaText, { color: col.color }]}>
                            Paketi Aç →
                          </Text>
                          <Text style={s.collectionLoadText}>Yük {col.computedLoad}</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

            {/* 3. Bilimsel Atomik Alışkanlık Rafları ("Neden İşe Yarar?" + Tek Dokunuşla Ekle) */}
            <View style={s.sectionBlock}>
              <View style={s.sectionTitleRow}>
                <Text style={s.sectionHeader}>
                  ATOMİK ALIŞKANLIKLAR · TEK DOKUNUŞLA EKLE
                </Text>
                <Text style={s.sectionCountText}>{filteredAtomicHabits.length} alışkanlık</Text>
              </View>

              {filteredAtomicHabits.length === 0 ? (
                <View style={s.emptyBox}>
                  <Ionicons name="sparkles-outline" size={32} color={colors.textFaint} />
                  <Text style={s.emptyTitle}>Eşleşen alışkanlık bulunamadı</Text>
                  <Text style={s.emptySub}>
                    Farklı bir kategori seçin veya kendi özel rutininizi AI ile oluşturun.
                  </Text>
                </View>
              ) : (
                <View style={s.atomicList}>
                  {filteredAtomicHabits.map((item) => {
                    const isOwned = existingHabitNames.has(
                      item.name.trim().toLocaleLowerCase('tr-TR'),
                    );
                    const isAdding = addingHabitId === item.id;

                    return (
                      <View key={item.id} style={s.atomicCard}>
                        <View style={s.atomicTopRow}>
                          <View
                            style={[
                              s.atomicIconBox,
                              { backgroundColor: alphaHex(item.color, '18') },
                            ]}
                          >
                            <Ionicons name={item.icon as any} size={20} color={item.color} />
                          </View>

                          <View style={{ flex: 1 }}>
                            <Text style={s.atomicTitle}>{item.name}</Text>
                            <View style={s.atomicTagsRow}>
                              <View style={s.atomicTagPill}>
                                <Text style={s.atomicTagText}>{item.daypartLabel}</Text>
                              </View>
                              <View style={s.atomicTagPill}>
                                <Text style={s.atomicTagText}>
                                  {difficultyText(item.difficulty)}
                                </Text>
                              </View>
                              {item.daily_goal && item.unit ? (
                                <View
                                  style={[
                                    s.atomicTagPill,
                                    { backgroundColor: alphaHex(item.color, '18') },
                                  ]}
                                >
                                  <Text style={[s.atomicTagText, { color: item.color }]}>
                                    Hedef: {item.daily_goal} {item.unit}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                          </View>

                          <TouchableOpacity
                            style={[
                              s.atomicAddBtn,
                              isOwned && s.atomicAddBtnOwned,
                              !isOwned && {
                                backgroundColor: alphaHex(item.color, '18'),
                                borderColor: alphaHex(item.color, '45'),
                              },
                            ]}
                            disabled={isOwned || isAdding}
                            onPress={() => handleAddAtomicHabit(item)}
                            activeOpacity={0.75}
                            accessibilityRole="button"
                            accessibilityLabel={
                              isOwned
                                ? `${item.name} zaten listenizde`
                                : `${item.name} alışkanlığını ekle`
                            }
                          >
                            {isAdding ? (
                              <ActivityIndicator size="small" color={item.color} />
                            ) : (
                              <>
                                <Ionicons
                                  name={isOwned ? 'checkmark-circle' : 'add-circle-outline'}
                                  size={15}
                                  color={isOwned ? colors.success : item.color}
                                />
                                <Text
                                  style={[
                                    s.atomicAddBtnText,
                                    { color: isOwned ? colors.success : item.color },
                                  ]}
                                >
                                  {isOwned ? 'Listenizde' : 'Ekle'}
                                </Text>
                              </>
                            )}
                          </TouchableOpacity>
                        </View>

                        {/* Bilimsel / Davranışsal "Neden İşe Yarar?" Kutusu */}
                        <View style={s.whyBox}>
                          <Ionicons name="bulb-outline" size={13} color={item.color} />
                          <Text style={s.whyText}>
                            <Text style={s.whyLabel}>Neden işe yarar? </Text>
                            {item.whyItWorks}
                          </Text>
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {/* 4. Kendi Rutinini AI ile Tasarla Stüdyo Kartı */}
            <TouchableOpacity
              style={[s.aiStudioCard, { overflow: 'hidden', position: 'relative' }]}
              onPress={() => {
                haptic.select();
                setAiModalVisible(true);
              }}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Kendi rutinini AI ile tasarla"
            >
              <TexturedSurface source={TEXTURES.neural} textureOpacity={0.07} overlayOnly />
              <EmblemMedallion
                source={SCREEN_BANNERS.coachOracle}
                size={46}
                unlocked
                accentColor={colors.primary}
              />
              <View style={{ flex: 1 }}>
                <Text style={s.aiStudioTitle}>Aradığın rutini bulamadın mı?</Text>
                <Text style={s.aiStudioSub}>
                  Hedefini veya yaşam temponu yaz; kapasite motoru senin için kişisel bir paket tasarlasın.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.info} />
            </TouchableOpacity>
          </>
        ) : (
          /* ══════════════════════════════════════════════════════════════════
             MOD 2: SİSTEM & ARAÇLAR REHBERİ (Mevcut Modül Kütüphanesi)
             ══════════════════════════════════════════════════════════════════ */
          <>
            {!isSearching && selectedToolCat === 'all' && (
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
                  <View style={StyleSheet.absoluteFill} pointerEvents="none">
                    <Image source={BENTO_ART.hubToolsStrategy} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                    <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.56) }]} />
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

                {/* Twin Bento Kartları (Rutin & Derin Odak) */}
                <View style={s.twinRow}>
                  <TouchableOpacity
                    style={s.twinCard}
                    onPress={() => navigate('/screens/routine-runner')}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Rutin Yürütücüyü Başlat"
                  >
                    <View style={StyleSheet.absoluteFill} pointerEvents="none">
                      <Image source={SCREEN_BANNERS.runnerSteppingStones} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                      <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.62) }]} />
                    </View>
                    <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={96} opacity={0.18} />
                    <View style={[s.twinIcon, { backgroundColor: alphaHex(colors.success, '20') }]}>
                      <Ionicons name="play" size={20} color={colors.success} />
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
                    onPress={() => navigate('/screens/deep-work')}
                    activeOpacity={0.8}
                    accessibilityRole="button"
                    accessibilityLabel="Derin Çalışma Başlat"
                  >
                    <View style={StyleSheet.absoluteFill} pointerEvents="none">
                      <Image source={BENTO_ART.hubToolsDeepfocus} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
                      <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(colors.bgSunk, 0.58) }]} />
                    </View>
                    <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={96} opacity={0.18} />
                    <View style={[s.twinIcon, { backgroundColor: alphaHex(colors.teal, '20') }]}>
                      <Ionicons name="flash" size={20} color={colors.teal} />
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
                  <Ionicons name="search" size={32} color={colors.textFaint} />
                  <Text style={s.emptyTitle}>Eşleşen modül bulunamadı</Text>
                  <Text style={s.emptySub}>
                    Farklı bir arama terimi deneyin veya filtreyi sıfırlayın.
                  </Text>
                </View>
              ) : (
                <View style={s.grid}>
                  {filteredTools.map((item) => {
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
                        <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={82} opacity={0.12} />
                        <View style={s.cardTop}>
                          <View
                            style={[
                              s.cardIcon,
                              { backgroundColor: alphaHex(item.color, '18') },
                            ]}
                          >
                            <Ionicons name={item.icon} size={22} color={item.color} />
                          </View>
                          {badge > 0 && (
                            <View style={[s.badge, { backgroundColor: item.color }]}>
                              <Text style={s.badgeText}>{badge}</Text>
                            </View>
                          )}
                        </View>
                        <Text style={s.cardTitle} numberOfLines={1}>
                          {item.label}
                        </Text>
                        <Text style={s.cardSub} numberOfLines={2}>
                          {item.subtitle}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </View>
          </>
        )}
        </ScrollView>
      )}

      {/* ── KOLEKSİYON DETAY & KAPASİTE ÖNİZLEME MODALI ── */}
      <Modal
        visible={!!selectedCollection}
        transparent
        animationType="slide"
        onRequestClose={closeCollectionPreview}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            {selectedCollection && (
              <>
                <View style={s.modalHeader}>
                  <View style={s.modalHeaderLeft}>
                    <View
                      style={[
                        s.modalIconBox,
                        { backgroundColor: alphaHex(selectedCollection.color, '22') },
                      ]}
                    >
                      <Ionicons
                        name={selectedCollection.icon as any}
                        size={22}
                        color={selectedCollection.color}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.modalBadgeText}>{selectedCollection.badge}</Text>
                      <Text style={s.modalTitle}>{selectedCollection.pack.title}</Text>
                    </View>
                  </View>
                  <TouchableOpacity
                    onPress={closeCollectionPreview}
                    style={s.modalCloseBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Kapat"
                  >
                    <Ionicons name="close" size={22} color={colors.textDim} />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={s.modalBody}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={{ paddingBottom: space.lg }}
                >
                  <EditorialBanner
                    source={getPackCover(selectedCollection.key)}
                    textureSource={TEXTURES.topographic}
                    eyebrow={selectedCollection.badge}
                    title={selectedCollection.pack.title}
                    subtitle={selectedCollection.pack.goal}
                    accentColor={selectedCollection.color}
                    minHeight={104}
                    style={{ marginBottom: space.md }}
                  />
                  <Text style={s.modalSummary}>{selectedCollection.scientificSummary}</Text>

                  {/* Kapasite Değerlendirme Bandı */}
                  {evaluation && !installed && (
                    <View style={s.capacityBanner}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} />
                      <View style={{ flex: 1 }}>
                        <Text style={s.capacityBannerTitle}>
                          Kapasite Koruması ({evaluation.toActivate.length} Aktif ·{' '}
                          {evaluation.toQueue.length} Sırada)
                        </Text>
                        <Text style={s.capacityBannerSub}>
                          {evaluation.toQueue.length > 0
                            ? `Tükenmişliği önlemek için ${evaluation.toActivate.length} alışkanlık hemen aktifleşir, ${evaluation.toQueue.length} alışkanlık Triage bekleme listesine alınır.`
                            : `Mevcut kapasiteniz uygun: paketteki tüm (${evaluation.toActivate.length}) alışkanlık doğrudan aktifleşir.`}
                        </Text>
                      </View>
                    </View>
                  )}

                  {installError && (
                    <View style={s.errorBanner}>
                      <Ionicons name="alert-circle-outline" size={16} color={colors.error} />
                      <Text style={s.errorBannerText}>{installError}</Text>
                    </View>
                  )}

                  {installed ? (
                    <View style={s.installedSuccessBox}>
                      <Ionicons name="checkmark-done-circle" size={40} color={colors.success} />
                      <Text style={s.installedTitle}>Koleksiyon Sisteminize Kuruldu!</Text>
                      <Text style={s.installedSub}>
                        Alışkanlıklarınız kapasite dengenize göre yerleştirildi.
                      </Text>
                      <TouchableOpacity
                        style={[
                          s.primaryModalBtn,
                          { backgroundColor: colors.success, marginTop: space.sm },
                        ]}
                        onPress={() => {
                          closeCollectionPreview();
                          router.push('/tabs/timeline' as any);
                        }}
                      >
                        <Text style={s.primaryModalBtnText}>Alışkanlıklarıma Git →</Text>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <>
                      <Text style={s.modalSectionLabel}>
                        PAKET İÇERİĞİ ({selectedCollection.pack.habits.length} ADIM · ~
                        {selectedCollection.totalMinutes} DK)
                      </Text>

                      <View style={s.packStepList}>
                        {selectedCollection.pack.habits.map((h, idx) => {
                          const isOwned = existingHabitNames.has(
                            h.name.trim().toLocaleLowerCase('tr-TR'),
                          );
                          const willActivate = evaluation?.toActivate.includes(h.name) ?? true;
                          const matchingAtomic = EXPLORE_ATOMIC_HABITS.find(
                            (a) =>
                              a.name.trim().toLocaleLowerCase('tr-TR') ===
                              h.name.trim().toLocaleLowerCase('tr-TR'),
                          );

                          return (
                            <View key={h.name} style={s.packStepRow}>
                              <View style={s.packStepIndex}>
                                <Text style={s.packStepIndexText}>{idx + 1}</Text>
                              </View>
                              <View style={{ flex: 1 }}>
                                <Text style={s.packStepName}>{h.name}</Text>
                                <Text style={s.packStepMeta}>
                                  {h.estimated_minutes} dk · {difficultyText(h.difficulty)}
                                  {h.daily_goal && h.unit ? ` · ${h.daily_goal} ${h.unit}` : ''}
                                  {' · '}
                                  {willActivate ? '⚡ Hemen Aktif' : '⏳ Kuyruğa Alınır'}
                                </Text>
                              </View>

                              {isOwned ? (
                                <View style={s.stepOwnedPill}>
                                  <Ionicons
                                    name="checkmark-circle"
                                    size={14}
                                    color={colors.success}
                                  />
                                  <Text style={s.stepOwnedText}>Listenizde</Text>
                                </View>
                              ) : matchingAtomic ? (
                                <TouchableOpacity
                                  style={s.singleStepAddBtn}
                                  onPress={() => handleAddAtomicHabit(matchingAtomic)}
                                  disabled={addingHabitId === matchingAtomic.id}
                                >
                                  <Text style={s.singleStepAddText}>+ Tek Ekle</Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          );
                        })}
                      </View>
                    </>
                  )}
                </ScrollView>

                {!installed && (
                  <View style={s.modalFooter}>
                    <TouchableOpacity
                      style={[
                        s.primaryModalBtn,
                        { backgroundColor: selectedCollection.color },
                        installing && { opacity: 0.6 },
                      ]}
                      disabled={installing}
                      onPress={handleInstallCollection}
                      accessibilityRole="button"
                      accessibilityLabel="Tüm Koleksiyonu Kur"
                    >
                      {installing ? (
                        <ActivityIndicator size="small" color={colors.white} />
                      ) : (
                        <>
                          <Ionicons name="download-outline" size={18} color={colors.white} />
                          <Text style={s.primaryModalBtnText}>
                            Tüm Koleksiyonu Kur ({selectedCollection.pack.habits.length} Alışkanlık)
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* AI Rutin Stüdyosu Modalı */}
      <AIRoutineModal visible={aiModalVisible} onClose={() => setAiModalVisible(false)} />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  topChrome: {
    paddingHorizontal: space.md,
    paddingTop: space.sm,
    paddingBottom: 2,
    backgroundColor: colors.bg,
  },
  flowBody: {
    flex: 1,
  },
  content: { padding: space.md, paddingTop: space.xs, paddingBottom: space.hh },

  header: { marginBottom: space.md },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space.sm,
    marginBottom: space.sm,
  },
  pageTitle: { ...font.display, color: colors.text, fontSize: 26, fontWeight: '800' },
  pageSub: { fontSize: 13, color: colors.textDim, marginTop: 3 },
  aiQuickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.info,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  aiQuickBtnText: { fontSize: 12, fontWeight: '700', color: colors.white },

  modeBar: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
    marginBottom: space.sm,
  },
  modeTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
    borderRadius: radius.sm,
  },
  modeTabActive: {
    backgroundColor: colors.primary,
  },
  modeTabFlowActive: {
    backgroundColor: colors.primary,
  },
  modeTabText: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.textDim,
  },
  modeTabTextActive: {
    color: colors.white,
  },

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

  toastBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: alphaHex(colors.success, '18'),
    borderWidth: 1,
    borderColor: alphaHex(colors.success, '40'),
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: space.md,
  },
  toastBannerText: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    color: colors.text,
  },

  sectionHeader: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textGhost,
    letterSpacing: 1.2,
    marginBottom: space.sm,
  },
  sectionBlock: {
    marginBottom: space.lg,
  },
  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.xs,
  },
  sectionCountText: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textDim,
    marginBottom: space.sm,
  },

  // Explore Hero
  bentoWrap: { marginBottom: space.lg },
  exploreHeroCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.md,
    gap: 10,
  },
  exploreHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  loadPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  loadPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textDim,
  },
  exploreHeroTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  exploreHeroIconBox: {
    width: 46,
    height: 46,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroGoalText: {
    fontSize: 12,
    color: colors.textDim,
    fontWeight: '600',
  },
  exploreHeroFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 4,
  },
  heroMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  heroMetricChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
  },
  heroMetricText: {
    fontSize: 11,
    color: colors.textDim,
    fontWeight: '600',
  },

  // Collections Grid
  collectionGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 10,
  },
  collectionCard: {
    width: '48.5%',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    justifyContent: 'space-between',
  },
  collectionCoverWrap: {
    height: 80,
    borderRadius: radius.md,
    overflow: 'hidden',
    position: 'relative',
    padding: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  collectionCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  collectionIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  collectionHeaderBadges: {
    alignItems: 'flex-end',
    gap: 4,
  },
  ownedBadge: {
    backgroundColor: alphaHex(colors.success, '18'),
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  ownedBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: colors.success,
  },
  collectionMetaPill: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  collectionMetaPillText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textDim,
  },
  collectionTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 3,
  },
  collectionGoal: {
    fontSize: 11,
    color: colors.textDim,
    lineHeight: 15,
    marginBottom: 8,
  },
  previewStepsBox: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.sm,
    padding: 8,
    gap: 4,
    marginBottom: 10,
  },
  previewStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  previewStepText: {
    flex: 1,
    fontSize: 10,
    color: colors.text,
    fontWeight: '500',
  },
  moreStepsText: {
    fontSize: 9,
    color: colors.textGhost,
    fontWeight: '600',
    marginTop: 2,
  },
  collectionFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  collectionCtaText: {
    fontSize: 11,
    fontWeight: '800',
  },
  collectionLoadText: {
    fontSize: 10,
    color: colors.textGhost,
    fontWeight: '600',
  },

  // Atomic Habits Shelf
  atomicList: {
    gap: 10,
  },
  atomicCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.md,
    gap: 10,
  },
  atomicTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  atomicIconBox: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  atomicTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.text,
    marginBottom: 4,
  },
  atomicTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
  },
  atomicTagPill: {
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  atomicTagText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.textDim,
  },
  atomicAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  atomicAddBtnOwned: {
    backgroundColor: alphaHex(colors.success, '14'),
    borderColor: alphaHex(colors.success, '35'),
  },
  atomicAddBtnText: {
    fontSize: 11,
    fontWeight: '700',
  },
  whyBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: colors.surfaceAlt,
    padding: 8,
    borderRadius: radius.sm,
  },
  whyLabel: {
    fontWeight: '700',
    color: colors.text,
  },
  whyText: {
    flex: 1,
    fontSize: 11,
    color: colors.textDim,
    lineHeight: 15,
  },

  // AI Studio Card
  aiStudioCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: alphaHex(colors.info, '45'),
    borderRadius: radius.lg,
    padding: space.md,
    marginBottom: space.xl,
  },
  aiStudioIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: alphaHex(colors.info, '18'),
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiStudioTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 2,
  },
  aiStudioSub: {
    fontSize: 11,
    color: colors.textDim,
    lineHeight: 15,
  },

  // Existing Tools Mode Styles
  heroCard: {
    overflow: 'hidden',
    position: 'relative',
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
    overflow: 'hidden',
    position: 'relative',
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

  // Collection Preview Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.65)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    maxHeight: '85%',
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space.lg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: space.md,
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  modalIconBox: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBadgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: colors.textGhost,
    letterSpacing: 1,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
  },
  modalCloseBtn: {
    padding: 6,
  },
  modalBody: {
    flexGrow: 0,
  },
  modalSummary: {
    fontSize: 12,
    color: colors.textDim,
    lineHeight: 18,
    marginBottom: space.md,
  },
  capacityBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: alphaHex(colors.primary, '14'),
    borderWidth: 1,
    borderColor: alphaHex(colors.primary, '35'),
    borderRadius: radius.md,
    padding: 12,
    marginBottom: space.md,
  },
  capacityBannerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: colors.text,
    marginBottom: 2,
  },
  capacityBannerSub: {
    fontSize: 11,
    color: colors.textDim,
    lineHeight: 15,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: alphaHex(colors.error, '16'),
    borderRadius: radius.md,
    padding: 10,
    marginBottom: space.md,
  },
  errorBannerText: {
    flex: 1,
    fontSize: 12,
    color: colors.error,
  },
  modalSectionLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textGhost,
    letterSpacing: 1,
    marginBottom: 8,
  },
  packStepList: {
    gap: 8,
  },
  packStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.md,
    padding: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  packStepIndex: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  packStepIndexText: {
    fontSize: 11,
    fontWeight: '800',
    color: colors.textDim,
  },
  packStepName: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.text,
  },
  packStepMeta: {
    fontSize: 11,
    color: colors.textDim,
    marginTop: 2,
  },
  stepOwnedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: alphaHex(colors.success, '15'),
  },
  stepOwnedText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.success,
  },
  singleStepAddBtn: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.sm,
    backgroundColor: alphaHex(colors.primary, '16'),
    borderWidth: 1,
    borderColor: alphaHex(colors.primary, '35'),
  },
  singleStepAddText: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
  },
  installedSuccessBox: {
    alignItems: 'center',
    paddingVertical: space.lg,
    gap: 6,
  },
  installedTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
  },
  installedSub: {
    fontSize: 12,
    color: colors.textDim,
    textAlign: 'center',
  },
  modalFooter: {
    paddingTop: space.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  primaryModalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: radius.md,
  },
  primaryModalBtnText: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.white,
  },
});
