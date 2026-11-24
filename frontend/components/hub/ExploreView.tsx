import { useState, useMemo, useEffect, type ComponentProps } from 'react';
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
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useShallow } from 'zustand/react/shallow';
import { useHabitStore } from '../../store/habitStore';
import { useRoutineStore } from '../../store/routineStore';
import { space, radius, font, alphaHex, hexA, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { useTimeoutRef } from '../../hooks/useTimeoutRef';
import { haptic } from '../../lib/haptics';
import { navigateTo } from '../../lib/destinations';
import { EditorialBanner, EmblemMedallion, TexturedSurface } from '../ui';
import { getPackCover, SCREEN_BANNERS, TEXTURES } from '../../lib/visualAssets';
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

type IoniconName = ComponentProps<typeof Ionicons>['name'];

function difficultyText(d: 1 | 3 | 5): string {
  if (d === 1) return 'Kolay';
  if (d === 3) return 'Orta';
  return 'Yoğun';
}

export type ExploreViewProps = {
  onOpenFlow?: () => void;
  onOpenAiRoutine?: () => void;
};

export default function ExploreView({ onOpenAiRoutine }: ExploreViewProps) {
  const router = useRouter();
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);

  const { habits, fetchHabits, addHabit } = useHabitStore(
    useShallow((st) => ({
      habits: st.habits,
      fetchHabits: st.fetchHabits,
      addHabit: st.addHabit,
    })),
  );
  const {
    loadPack,
    evaluation,
    installing,
    installed,
    installError,
    confirmInstall,
    clearGenerated,
  } = useRoutineStore(
    useShallow((st) => ({
      loadPack: st.loadPack,
      evaluation: st.evaluation,
      installing: st.installing,
      installed: st.installed,
      installError: st.installError,
      confirmInstall: st.confirmInstall,
      clearGenerated: st.clearGenerated,
    })),
  );

  const [search, setSearch] = useState('');
  const [exploreCat, setExploreCat] = useState<ExploreCategory>('all');
  const [selectedCollection, setSelectedCollection] = useState<ExploreCollection | null>(null);
  const [addingHabitId, setAddingHabitId] = useState<string | null>(null);
  const [feedbackBanner, setFeedbackBanner] = useState<string | null>(null);
  const bannerTimer = useTimeoutRef();

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
          order: ['everyday-foundations'],
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

  function showBanner(msg: string) {
    setFeedbackBanner(msg);
    bannerTimer.set(() => setFeedbackBanner(null), 3500);
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
    <>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <View style={s.header}>
          <View style={s.searchWrap}>
            <Ionicons name="search-outline" size={18} color={c.textFaint} />
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Alışkanlık veya koleksiyon ara (örn: uyku, su, odak)..."
              placeholderTextColor={c.textFaint}
              autoCapitalize="none"
              clearButtonMode="while-editing"
              accessibilityLabel="Alışkanlık veya koleksiyon ara"
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
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons
                    name={cat.icon as IoniconName}
                    size={13}
                    color={active ? c.white : cat.color}
                  />
                  <Text style={[s.catText, active && s.catTextActive]}>{cat.label}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {feedbackBanner && (
          <View style={s.toastBanner}>
            <Ionicons name="checkmark-circle" size={16} color={c.success} />
            <Text style={s.toastBannerText}>{feedbackBanner}</Text>
          </View>
        )}

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
                <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(c.bgSunk, 0.68) }]} />
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
                  <Ionicons name="speedometer-outline" size={12} color={c.textDim} />
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
                    name={recommendedCollection.icon as IoniconName}
                    size={24}
                    color={recommendedCollection.color}
                  />
                </View>
                <View style={s.flex1}>
                  <Text style={s.heroTitle}>{recommendedCollection.pack.title}</Text>
                  <Text style={s.heroGoalText}>{recommendedCollection.pack.goal}</Text>
                </View>
              </View>

              <Text style={s.heroSub}>{recommendedCollection.scientificSummary}</Text>

              <View style={s.exploreHeroFooter}>
                <View style={s.heroMetricsRow}>
                  <View style={s.heroMetricChip}>
                    <Ionicons name="layers-outline" size={12} color={c.textDim} />
                    <Text style={s.heroMetricText}>
                      {recommendedCollection.pack.habits.length} alışkanlık
                    </Text>
                  </View>
                  <View style={s.heroMetricChip}>
                    <Ionicons name="time-outline" size={12} color={c.textDim} />
                    <Text style={s.heroMetricText}>
                      ~{recommendedCollection.totalMinutes} dk/gün
                    </Text>
                  </View>
                </View>

                <View style={[s.heroAction, { backgroundColor: recommendedCollection.color }]}>
                  <Text style={[s.heroActionText, { color: c.white }]}>İncele & Kur →</Text>
                </View>
              </View>
            </TouchableOpacity>
          </View>
        )}

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
                      <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(c.bgSunk, 0.42) }]} />
                      <View style={s.collectionCardHeader}>
                        <View style={[s.collectionIcon, { backgroundColor: hexA(c.bgSunk, 0.72) }]}>
                          <Ionicons name={col.icon as IoniconName} size={18} color={col.color} />
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

                    <View style={s.previewStepsBox}>
                      {col.pack.habits.slice(0, 3).map((h) => {
                        const isOwned = existingHabitNames.has(
                          h.name.trim().toLocaleLowerCase('tr-TR'),
                        );
                        return (
                          <View key={h.name} style={s.previewStepRow}>
                            <Ionicons
                              name={isOwned ? 'checkmark-circle' : (h.icon as IoniconName)}
                              size={12}
                              color={isOwned ? c.success : col.color}
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
                      <Text style={[s.collectionCtaText, { color: col.color }]}>Paketi Aç →</Text>
                      <Text style={s.collectionLoadText}>Yük {col.computedLoad}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        )}

        <View style={s.sectionBlock}>
          <View style={s.sectionTitleRow}>
            <Text style={s.sectionHeader}>MİKRO ALIŞKANLIKLAR · TEK DOKUNUŞLA EKLE</Text>
            <Text style={s.sectionCountText}>{filteredAtomicHabits.length} alışkanlık</Text>
          </View>

          {filteredAtomicHabits.length === 0 ? (
            <View style={s.emptyBox}>
              <Ionicons name="sparkles-outline" size={32} color={c.textFaint} />
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
                      <View style={[s.atomicIconBox, { backgroundColor: alphaHex(item.color, '18') }]}>
                        <Ionicons name={item.icon as IoniconName} size={20} color={item.color} />
                      </View>

                      <View style={s.flex1}>
                        <Text style={s.atomicTitle}>{item.name}</Text>
                        <View style={s.atomicTagsRow}>
                          <View style={s.atomicTagPill}>
                            <Text style={s.atomicTagText}>{item.daypartLabel}</Text>
                          </View>
                          <View style={s.atomicTagPill}>
                            <Text style={s.atomicTagText}>{difficultyText(item.difficulty)}</Text>
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
                              color={isOwned ? c.success : item.color}
                            />
                            <Text
                              style={[
                                s.atomicAddBtnText,
                                { color: isOwned ? c.success : item.color },
                              ]}
                            >
                              {isOwned ? 'Listenizde' : 'Ekle'}
                            </Text>
                          </>
                        )}
                      </TouchableOpacity>
                    </View>

                    <View style={s.whyBox}>
                      <Ionicons name="bulb-outline" size={13} color={item.color} />
                      <Text style={s.whyText}>
                        <Text style={s.whyLabel}>Neden işe yarayabilir? </Text>
                        {item.whyItWorks}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[s.aiStudioCard, { overflow: 'hidden', position: 'relative' }]}
          onPress={() => {
            haptic.select();
            onOpenAiRoutine?.();
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
            accentColor={c.primary}
          />
          <View style={s.flex1}>
            <Text style={s.aiStudioTitle}>Aradığın rutini bulamadın mı?</Text>
            <Text style={s.aiStudioSub}>
              Hedefini veya yaşam temponu yaz; kapasite motoru senin için kişisel bir paket tasarlasın.
            </Text>
            <Text style={s.aiStudioSub}>
              AI Rutin ücretsizdir: para istemez, yalnızca Focus Point harcar.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.info} />
        </TouchableOpacity>
      </ScrollView>

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
                        name={selectedCollection.icon as IoniconName}
                        size={22}
                        color={selectedCollection.color}
                      />
                    </View>
                    <View style={s.flex1}>
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
                    <Ionicons name="close" size={22} color={c.textDim} />
                  </TouchableOpacity>
                </View>

                <ScrollView
                  style={s.modalBody}
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={s.modalScrollContent}
                >
                  <EditorialBanner
                    source={getPackCover(selectedCollection.key)}
                    textureSource={TEXTURES.topographic}
                    eyebrow={selectedCollection.badge}
                    title={selectedCollection.pack.title}
                    subtitle={selectedCollection.pack.goal}
                    accentColor={selectedCollection.color}
                    minHeight={104}
                    style={s.bannerGap}
                  />
                  <Text style={s.modalSummary}>{selectedCollection.scientificSummary}</Text>

                  {evaluation && !installed && (
                    <View style={s.capacityBanner}>
                      <Ionicons name="shield-checkmark-outline" size={18} color={c.primary} />
                      <View style={s.flex1}>
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
                      <Ionicons name="alert-circle-outline" size={16} color={c.error} />
                      <Text style={s.errorBannerText}>{installError}</Text>
                    </View>
                  )}

                  {installed ? (
                    <View style={s.installedSuccessBox}>
                      <Ionicons name="checkmark-done-circle" size={40} color={c.success} />
                      <Text style={s.installedTitle}>Koleksiyon Sisteminize Kuruldu!</Text>
                      <Text style={s.installedSub}>
                        Alışkanlıklarınız kapasite dengenize göre yerleştirildi.
                      </Text>
                      <TouchableOpacity
                        style={[s.primaryModalBtn, { backgroundColor: c.success, marginTop: space.sm }]}
                        onPress={() => {
                          closeCollectionPreview();
                          navigateTo(router, 'habits');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Alışkanlıklarıma Git"
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
                              <View style={s.flex1}>
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
                                  <Ionicons name="checkmark-circle" size={14} color={c.success} />
                                  <Text style={s.stepOwnedText}>Listenizde</Text>
                                </View>
                              ) : matchingAtomic ? (
                                <TouchableOpacity
                                  style={s.singleStepAddBtn}
                                  onPress={() => handleAddAtomicHabit(matchingAtomic)}
                                  disabled={addingHabitId === matchingAtomic.id}
                                  accessibilityRole="button"
                                  accessibilityLabel={`${h.name} tek ekle`}
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
                        installing && s.disabledOpacity,
                      ]}
                      disabled={installing}
                      onPress={handleInstallCollection}
                      accessibilityRole="button"
                      accessibilityLabel="Tüm Koleksiyonu Kur"
                    >
                      {installing ? (
                        <ActivityIndicator size="small" color={c.white} />
                      ) : (
                        <>
                          <Ionicons name="download-outline" size={18} color={c.white} />
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
    </>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    flex1: { flex: 1 },
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
    catText: { ...font.caption, fontWeight: '600', color: c.textDim },
    catTextActive: { color: c.white },
    toastBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      backgroundColor: alphaHex(c.success, '18'),
      borderWidth: 1,
      borderColor: alphaHex(c.success, '40'),
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
      marginBottom: space.md,
    },
    toastBannerText: { ...font.caption, flex: 1, fontWeight: '700', color: c.text },
    sectionHeader: {
      ...font.overline,
      color: c.textFaint,
      marginBottom: space.sm,
    },
    sectionBlock: { marginBottom: space.lg },
    sectionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: space.xs,
    },
    sectionCountText: { ...font.caption, fontWeight: '600', color: c.textDim, marginBottom: space.sm },
    bentoWrap: { marginBottom: space.lg },
    exploreHeroCard: {
      backgroundColor: c.surface,
      borderWidth: 1,
      borderRadius: radius.lg,
      padding: space.md,
      gap: space.sm,
    },
    exploreHeroTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    heroBadge: {
      alignSelf: 'flex-start',
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.xs,
    },
    heroBadgeText: { ...font.overline },
    loadPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.borderSubtle,
    },
    loadPillText: { ...font.caption, fontWeight: '700', color: c.textDim },
    exploreHeroTitleRow: { flexDirection: 'row', alignItems: 'center', gap: space.md },
    exploreHeroIconBox: {
      width: 46,
      height: 46,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroTitle: { ...font.h3, fontWeight: '800', color: c.text },
    heroGoalText: { ...font.caption, color: c.textDim, fontWeight: '600' },
    heroSub: { ...font.bodySm, color: c.textDim },
    exploreHeroFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: space.xs,
    },
    heroMetricsRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    heroMetricChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.sm,
    },
    heroMetricText: { ...font.caption, color: c.textDim, fontWeight: '600' },
    heroAction: {
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      borderRadius: radius.sm,
    },
    heroActionText: { ...font.caption, fontWeight: '700' },
    collectionGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      rowGap: 10,
    },
    collectionCard: {
      width: '48.5%',
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.md,
      justifyContent: 'space-between',
    },
    collectionCoverWrap: {
      height: 80,
      borderRadius: radius.md,
      overflow: 'hidden',
      position: 'relative',
      padding: space.sm,
      marginBottom: space.sm,
      borderWidth: 1,
      borderColor: c.borderSubtle,
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
    collectionHeaderBadges: { alignItems: 'flex-end', gap: space.xs },
    ownedBadge: {
      backgroundColor: alphaHex(c.success, '18'),
      paddingHorizontal: space.xs,
      paddingVertical: space.xs,
      borderRadius: radius.xs,
    },
    ownedBadgeText: { ...font.caption, fontWeight: '700', color: c.success },
    collectionMetaPill: {
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: space.xs,
      paddingVertical: space.xs,
      borderRadius: radius.xs,
    },
    collectionMetaPillText: { ...font.caption, fontWeight: '700', color: c.textDim },
    collectionTitle: { ...font.body, fontWeight: '800', color: c.text, marginBottom: space.xs },
    collectionGoal: { ...font.caption, color: c.textDim, marginBottom: space.sm },
    previewStepsBox: {
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.sm,
      padding: space.sm,
      gap: space.xs,
      marginBottom: space.sm,
    },
    previewStepRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
    previewStepText: { ...font.caption, flex: 1, color: c.text, fontWeight: '500' },
    moreStepsText: { ...font.caption, color: c.textFaint, fontWeight: '600', marginTop: space.xs },
    collectionFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    collectionCtaText: { ...font.caption, fontWeight: '800' },
    collectionLoadText: { ...font.caption, color: c.textFaint, fontWeight: '600' },
    atomicList: { gap: space.sm },
    atomicCard: {
      backgroundColor: c.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.md,
      gap: space.sm,
    },
    atomicTopRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    atomicIconBox: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    atomicTitle: { ...font.body, fontWeight: '700', color: c.text, marginBottom: space.xs },
    atomicTagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
    atomicTagPill: {
      backgroundColor: c.surfaceAlt,
      paddingHorizontal: space.xs,
      paddingVertical: space.xs,
      borderRadius: radius.xs,
    },
    atomicTagText: { ...font.caption, fontWeight: '600', color: c.textDim },
    atomicAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      minHeight: 36,
    },
    atomicAddBtnOwned: {
      backgroundColor: alphaHex(c.success, '14'),
      borderColor: alphaHex(c.success, '35'),
    },
    atomicAddBtnText: { ...font.caption, fontWeight: '700' },
    whyBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.xs,
      backgroundColor: c.surfaceAlt,
      padding: space.sm,
      borderRadius: radius.sm,
    },
    whyLabel: { fontWeight: '700', color: c.text },
    whyText: { ...font.caption, flex: 1, color: c.textDim },
    aiStudioCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: alphaHex(c.info, '45'),
      borderRadius: radius.lg,
      padding: space.md,
      marginBottom: space.xl,
    },
    aiStudioTitle: { ...font.body, fontWeight: '800', color: c.text, marginBottom: space.xs },
    aiStudioSub: { ...font.caption, color: c.textDim },
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
    modalBackdrop: {
      flex: 1,
      backgroundColor: hexA(c.black, 0.65),
      justifyContent: 'flex-end',
    },
    modalSheet: {
      maxHeight: '85%',
      backgroundColor: c.surface,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.lg,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: space.md,
    },
    modalHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flex: 1 },
    modalIconBox: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalBadgeText: { ...font.overline, color: c.textFaint },
    modalTitle: { ...font.h3, fontWeight: '800', color: c.text },
    modalCloseBtn: { padding: space.xs, minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
    modalBody: { flexGrow: 0 },
    modalScrollContent: { paddingBottom: space.lg },
    bannerGap: { marginBottom: space.md },
    modalSummary: { ...font.bodySm, color: c.textDim, marginBottom: space.md },
    capacityBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.sm,
      backgroundColor: alphaHex(c.primary, '14'),
      borderWidth: 1,
      borderColor: alphaHex(c.primary, '35'),
      borderRadius: radius.md,
      padding: space.md,
      marginBottom: space.md,
    },
    capacityBannerTitle: { ...font.caption, fontWeight: '800', color: c.text, marginBottom: space.xs },
    capacityBannerSub: { ...font.caption, color: c.textDim },
    errorBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      backgroundColor: alphaHex(c.error, '16'),
      borderRadius: radius.md,
      padding: space.sm,
      marginBottom: space.md,
    },
    errorBannerText: { ...font.bodySm, flex: 1, color: c.error },
    modalSectionLabel: { ...font.overline, color: c.textFaint, marginBottom: space.sm },
    packStepList: { gap: space.sm },
    packStepRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.md,
      padding: space.sm,
      borderWidth: 1,
      borderColor: c.borderSubtle,
    },
    packStepIndex: {
      width: 24,
      height: 24,
      borderRadius: radius.pill,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: c.border,
    },
    packStepIndexText: { ...font.caption, fontWeight: '800', color: c.textDim },
    packStepName: { ...font.body, fontWeight: '700', color: c.text },
    packStepMeta: { ...font.caption, color: c.textDim, marginTop: space.xs },
    stepOwnedPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.sm,
      backgroundColor: alphaHex(c.success, '15'),
    },
    stepOwnedText: { ...font.caption, fontWeight: '700', color: c.success },
    singleStepAddBtn: {
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
      borderRadius: radius.sm,
      backgroundColor: alphaHex(c.primary, '16'),
      borderWidth: 1,
      borderColor: alphaHex(c.primary, '35'),
    },
    singleStepAddText: { ...font.caption, fontWeight: '700', color: c.primary },
    installedSuccessBox: { alignItems: 'center', paddingVertical: space.lg, gap: space.xs },
    installedTitle: { ...font.h3, fontWeight: '800', color: c.text },
    installedSub: { ...font.bodySm, color: c.textDim, textAlign: 'center' },
    modalFooter: {
      paddingTop: space.md,
      borderTopWidth: 1,
      borderTopColor: c.borderSubtle,
    },
    primaryModalBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.sm,
      paddingVertical: space.md,
      borderRadius: radius.md,
      minHeight: 48,
    },
    primaryModalBtnText: { ...font.body, fontWeight: '800', color: c.white },
    disabledOpacity: { opacity: 0.6 },
  });
