import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Platform,
  ActivityIndicator,
  NativeSyntheticEvent,
  NativeScrollEvent,
  LayoutChangeEvent,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Speech from 'expo-speech';
import { useRouter } from 'expo-router';
import { colors, space, radius, hexA } from '../lib/tokens';
import {
  DECOR,
  EMPTY_VIGNETTES,
  FLOW_CBT_BACKDROPS,
  FLOW_CHECKPOINT_ZEN,
  TEXTURES,
} from '../lib/visualAssets';
import { todayLocal } from '../lib/date';
import EmbeddedFiligree from './spatial/EmbeddedFiligree';
import { useReducedMotion } from './seasonalMotion/useReducedMotion';


import { haptic } from '../lib/haptics';
import { useHabitStore } from '../store/habitStore';
import { useTaskStore } from '../store/taskStore';
import { useFocusStore } from '../store/focusStore';
import { buildAtomicHabitInsert } from '../lib/exploreCatalog';
import {
  FOCUS_FLOW_CATEGORIES,
  FOCUS_FLOW_ITEMS,
  buildFeedEntries,
  findAtomicHabitById,
  rankFocusFlowForUser,
  type FocusFeedEntry,
  type FocusFeedItem,
  type FocusFlowCategoryKey,
} from '../lib/focusFlowCatalog';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

const SAVED_FLOW_STORAGE_KEY = 'aderyth:focus_flow_saved_v1';

type FocusFlowViewProps = {
  /** Optional item ID to place first in the feed (e.g. from Today's Daily Spark). */
  initialItemId?: string | null;
  /** Optional initial category filter. */
  initialCategory?: FocusFlowCategoryKey;
  /** Show top-left back/close button (true on full-screen `/screens/focus-flow`). */
  showBackButton?: boolean;
  /** Show expand-to-fullscreen button (true when embedded inside `hub.tsx`). */
  showExpandButton?: boolean;
  /** Callback when CTA requests opening Explore Routine Packs inside `hub.tsx`. */
  onRequestExplorePacks?: () => void;
};

function NativeYoutubeEmbed({ videoId, muted }: { videoId: string; muted: boolean }) {
  const uri = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=${
    muted ? 1 : 0
  }&playsinline=1&rel=0&modestbranding=1&controls=1&loop=1&playlist=${videoId}`;

  if (Platform.OS === 'web') {
    return React.createElement('iframe', {
      src: uri,
      title: 'Aderyth Odak Akışı Video',
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowFullScreen: true,
      style: {
        width: '100%',
        height: '100%',
        border: 'none',
        borderRadius: '18px',
        backgroundColor: colors.bgSunk,
      },
    });
  }

  // Lazy load WebView only on native iOS/Android
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview');
  return (
    <WebView
      source={{ uri }}
      style={{ flex: 1, backgroundColor: colors.bgSunk }}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      javaScriptEnabled
    />
  );
}

export default function FocusFlowView({
  initialItemId = null,
  initialCategory = 'for_you',
  showBackButton = false,
  showExpandButton = false,
  onRequestExplorePacks,
}: FocusFlowViewProps) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();
  const breathAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (IS_TEST || reduceMotion) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(breathAnim, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathAnim, reduceMotion]);
  const scrollRef = useRef<ScrollView | null>(null);

  const { habits, fetchHabits, addHabit } = useHabitStore();
  const { tasks } = useTaskStore();
  const { sessionsCompleted, status: focusStatus, startSmallStep } = useFocusStore();

  const [containerHeight, setContainerHeight] = useState<number>(640);
  const [selectedCategory, setSelectedCategory] = useState<FocusFlowCategoryKey>(initialCategory);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  // Per-video toggle allowing user to switch between real video & kinetic Turkish summary
  const [kineticOverrideIds, setKineticOverrideIds] = useState<Set<string>>(new Set());
  // Current slide index per reel
  const [slideMap, setSlideMap] = useState<Record<string, number>>({});
  // Selected diagnostic answer per interactive reel
  const [selectedPromptOption, setSelectedPromptOption] = useState<Record<string, string>>({});
  // Takeaways drawer modal item
  const [takeawayItem, setTakeawayItem] = useState<FocusFeedItem | null>(null);
  const [addingHabitId, setAddingHabitId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  useEffect(() => {
    fetchHabits();
    AsyncStorage.getItem(SAVED_FLOW_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setSavedIds(new Set(parsed.filter((x) => typeof x === 'string')));
        }
      })
      .catch(() => {});
  }, [fetchHabits]);

  useEffect(() => {
    return () => {
      Speech.stop();
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((cur) => (cur === msg ? null : cur));
    }, 3200);
  }, []);

  const activeHabits = useMemo(
    () => habits.filter((h) => h.status === 'active'),
    [habits],
  );

  const existingHabitNames = useMemo(() => {
    const set = new Set<string>();
    for (const h of habits) {
      if (h.status !== 'archived') {
        set.add(h.name.trim().toLocaleLowerCase('tr-TR'));
      }
    }
    return set;
  }, [habits]);

  const overdueCount = useMemo(() => {
    const today = todayLocal();
    return tasks.filter(
      (t) => !t.completed && Boolean(t.due_date && t.due_date < today),
    ).length;
  }, [tasks]);

  const rankedForYou = useMemo(
    () =>
      rankFocusFlowForUser({
        hour: new Date().getHours(),
        overdueCount,
        lowEnergy: false,
        activeHabitCount: activeHabits.length,
        focusSessionsToday: sessionsCompleted,
        startItemId: initialItemId,
      }),
    [overdueCount, activeHabits.length, sessionsCompleted, initialItemId],
  );

  const filteredItems = useMemo<FocusFeedItem[]>(() => {
    if (selectedCategory === 'for_you') return rankedForYou;
    if (selectedCategory === 'all') {
      if (!initialItemId) return FOCUS_FLOW_ITEMS;
      const pin = FOCUS_FLOW_ITEMS.find((i) => i.id === initialItemId);
      if (!pin) return FOCUS_FLOW_ITEMS;
      return [pin, ...FOCUS_FLOW_ITEMS.filter((i) => i.id !== initialItemId)];
    }
    if (selectedCategory === 'saved') {
      return FOCUS_FLOW_ITEMS.filter((i) => savedIds.has(i.id));
    }
    return rankedForYou.filter((i) => i.category === selectedCategory);
  }, [selectedCategory, rankedForYou, savedIds, initialItemId]);

  const feedEntries = useMemo<FocusFeedEntry[]>(
    () => buildFeedEntries(filteredItems, 5),
    [filteredItems],
  );

  const activeEntry = feedEntries[activeIndex] ?? null;

  // Auto-advance kinetic slides on the currently active kinetic reel
  useEffect(() => {
    if (!activeEntry || activeEntry.entryKind !== 'item') return;
    if (takeawayItem) return;

    const item = activeEntry.item;
    const isKineticMode =
      item.kind === 'inflow_interactive' || kineticOverrideIds.has(item.id);
    if (!isKineticMode) return;

    const slides = item.kineticSlides;
    if (!slides || slides.length <= 1) return;

    const curSlideIdx = slideMap[item.id] ?? 0;
    const curSlide = slides[curSlideIdx] ?? slides[0];

    const timer = setTimeout(() => {
      setSlideMap((prev) => ({
        ...prev,
        [item.id]: ((prev[item.id] ?? 0) + 1) % slides.length,
      }));
    }, curSlide.durationMs);

    return () => clearTimeout(timer);
  }, [activeEntry, slideMap, kineticOverrideIds, takeawayItem]);

  // Optional Turkish TTS narration (`expo-speech`) when soundEnabled is ON in kinetic mode
  useEffect(() => {
    Speech.stop();
    if (!soundEnabled || !activeEntry || activeEntry.entryKind !== 'item') return;

    const item = activeEntry.item;
    const isKineticMode =
      item.kind === 'inflow_interactive' || kineticOverrideIds.has(item.id);
    if (!isKineticMode) return;

    const curSlideIdx = slideMap[item.id] ?? 0;
    const curSlide = item.kineticSlides[curSlideIdx];
    if (!curSlide) return;

    try {
      Speech.speak(`${curSlide.text}. ${curSlide.highlight}`, {
        language: 'tr-TR',
        rate: 1.04,
      });
    } catch {
      // Ignore TTS errors in unsupported browsers
    }
  }, [soundEnabled, activeEntry, slideMap, kineticOverrideIds]);

  const scrollToEntry = useCallback(
    (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= feedEntries.length) return;
      haptic.select();
      Speech.stop();
      setActiveIndex(nextIndex);
      scrollRef.current?.scrollTo({
        y: nextIndex * containerHeight,
        animated: true,
      });
    },
    [feedEntries.length, containerHeight],
  );

  // Keyboard Up/Down navigation on Web
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (takeawayItem) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        scrollToEntry(Math.min(feedEntries.length - 1, activeIndex + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        scrollToEntry(Math.max(0, activeIndex - 1));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, feedEntries.length, scrollToEntry, takeawayItem]);

  function handleLayout(e: LayoutChangeEvent) {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 200 && Math.abs(h - containerHeight) > 2) {
      setContainerHeight(h);
    }
  }

  function handleScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (containerHeight <= 0) return;
    const offsetY = e.nativeEvent.contentOffset.y;
    const idx = Math.max(
      0,
      Math.min(feedEntries.length - 1, Math.round(offsetY / containerHeight)),
    );
    if (idx !== activeIndex) {
      Speech.stop();
      setActiveIndex(idx);
    }
  }

  function handleSelectCategory(cat: FocusFlowCategoryKey) {
    haptic.select();
    Speech.stop();
    setSelectedCategory(cat);
    setActiveIndex(0);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }

  async function toggleSaveItem(itemId: string) {
    haptic.medium();
    const next = new Set(savedIds);
    const wasSaved = next.has(itemId);
    if (wasSaved) {
      next.delete(itemId);
      showToast('Kaydedilenlerden çıkarıldı.');
    } else {
      next.add(itemId);
      showToast('🔖 Odak koleksiyonuna kaydedildi.');
    }
    setSavedIds(next);
    try {
      await AsyncStorage.setItem(SAVED_FLOW_STORAGE_KEY, JSON.stringify([...next]));
    } catch {
      // Ignore storage error
    }
  }

  function toggleKineticMode(itemId: string) {
    haptic.select();
    Speech.stop();
    setKineticOverrideIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }

  function launchFiveMinuteFocus(title: string, minutes = 5) {
    haptic.medium();
    Speech.stop();
    const firstTask = tasks.find((t) => !t.completed && t.status === 'pending');
    if (focusStatus === 'idle') {
      startSmallStep(
        {
          kind: 'task',
          id: firstTask?.id ?? 'focus-flow-spark',
          title: firstTask?.title ?? 'Odak Akışı Kıvılcımı',
        },
        {
          title,
          minutes,
        },
      );
    }
    router.push('/tabs/focus' as any);
  }

  async function handleExecuteCta(item: FocusFeedItem) {
    const { cta } = item;
    if (cta.actionType === 'add_atomic_habit') {
      const atomic = findAtomicHabitById(cta.atomicHabitId);
      if (!atomic) return;
      const norm = atomic.name.trim().toLocaleLowerCase('tr-TR');
      if (existingHabitNames.has(norm)) {
        showToast(`✓ "${atomic.name}" zaten alışkanlık sisteminde ekli.`);
        return;
      }
      if (addingHabitId) return;
      haptic.medium();
      setAddingHabitId(atomic.id);
      try {
        const { insertPayload, assignedStatus } = buildAtomicHabitInsert(
          atomic,
          activeHabits,
        );
        const created = await addHabit(insertPayload);
        if (created) {
          if (assignedStatus === 'active') {
            showToast(`✓ "${atomic.name}" aktif alışkanlıklarına eklendi!`);
          } else {
            showToast(
              `⏳ "${atomic.name}" kapasiteni korumak için Bekleyen (Triage) listesine eklendi.`,
            );
          }
        }
      } finally {
        setAddingHabitId(null);
      }
      return;
    }

    if (cta.actionType === 'start_small_focus') {
      launchFiveMinuteFocus(
        cta.focusTitle ?? 'Odak Akışı: 5 dakikalık başlangıç',
        cta.focusMinutes ?? 5,
      );
      return;
    }

    if (cta.actionType === 'open_urge_shield') {
      haptic.select();
      Speech.stop();
      router.push('/tabs/timeline' as any);
      return;
    }

    if (cta.actionType === 'open_explore_pack') {
      haptic.select();
      Speech.stop();
      if (onRequestExplorePacks) {
        onRequestExplorePacks();
      } else {
        router.push('/tabs/hub' as any);
      }
      return;
    }

    if (cta.actionType === 'open_routine_runner') {
      haptic.select();
      Speech.stop();
      router.push('/screens/routine-runner' as any);
    }
  }

  function isHabitCtaAlreadyAdded(item: FocusFeedItem): boolean {
    if (item.cta.actionType !== 'add_atomic_habit') return false;
    const atomic = findAtomicHabitById(item.cta.atomicHabitId);
    if (!atomic) return false;
    return existingHabitNames.has(atomic.name.trim().toLocaleLowerCase('tr-TR'));
  }

  return (
    <View style={s.root} onLayout={handleLayout}>
      {/* Üst Sabit Kategori & Kontrol Katmanı */}
      <View style={s.topOverlay}>
        <View style={s.topHeaderRow}>
          {showBackButton && (
            <TouchableOpacity
              style={s.iconCircleBtn}
              onPress={() => {
                haptic.select();
                Speech.stop();
                if (router.canGoBack()) router.back();
                else router.push('/tabs/today' as any);
              }}
              accessibilityRole="button"
              accessibilityLabel="Odak Akışından Çık"
            >
              <Ionicons name="arrow-back" size={18} color={colors.white} />
            </TouchableOpacity>
          )}

          <View style={s.brandPill}>
            <View style={s.liveDot} />
            <Text style={s.brandPillText}>ODAK AKIŞI · SIFIR GÜRÜLTÜ</Text>
          </View>

          <View style={{ flex: 1 }} />

          {feedEntries.length > 0 && (
            <View style={s.counterPill}>
              <Text style={s.counterPillText}>
                {activeIndex + 1} / {feedEntries.length}
              </Text>
            </View>
          )}

          {showExpandButton && (
            <TouchableOpacity
              style={s.iconCircleBtn}
              onPress={() => {
                haptic.select();
                Speech.stop();
                const currentId =
                  activeEntry?.entryKind === 'item' ? activeEntry.item.id : '';
                router.push(
                  (currentId
                    ? `/screens/focus-flow?item=${currentId}`
                    : '/screens/focus-flow') as any,
                );
              }}
              accessibilityRole="button"
              accessibilityLabel="Tam Ekran Odak Akışını Aç"
            >
              <Ionicons name="expand-outline" size={17} color={colors.white} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.catStrip}
        >
          {FOCUS_FLOW_CATEGORIES.map((cat) => {
            const active = selectedCategory === cat.key;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[
                  s.catChip,
                  active && { backgroundColor: cat.color, borderColor: cat.color },
                ]}
                onPress={() => handleSelectCategory(cat.key)}
                accessibilityRole="button"
                accessibilityLabel={`Akış kategorisi: ${cat.label}`}
              >
                <Ionicons
                  name={cat.icon as any}
                  size={12}
                  color={active ? colors.white : cat.color}
                />
                <Text style={[s.catChipText, active && s.catChipTextActive]}>
                  {cat.label}
                  {cat.key === 'saved' && savedIds.size > 0 ? ` (${savedIds.size})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Bildirim Toast */}
      {toastMessage && (
        <View style={s.toastWrap}>
          <Text style={s.toastText}>{toastMessage}</Text>
        </View>
      )}

      {/* Boş Kaydedilenler Durumu */}
      {feedEntries.length === 0 ? (
        <View style={[s.emptyStateWrap, { height: containerHeight }]}>
          <Image
            source={EMPTY_VIGNETTES.focus}
            style={{ width: 148, height: 110, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border }}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          <Text style={s.emptyTitle}>Henüz kaydedilmiş bir akış yok</Text>
          <Text style={s.emptySub}>
             Sağ taraftaki yer imi ikonuna dokunarak en sevdiğin verimlilik videolarını ve Inflow mikro-derslerini burada toplayabilirsin.
          </Text>
          <TouchableOpacity
            style={s.emptyActionBtn}
            onPress={() => handleSelectCategory('for_you')}
            accessibilityRole="button"
            accessibilityLabel="Sizin İçin Akışına Dön"
          >
            <Ionicons name="flame" size={16} color={colors.white} />
            <Text style={s.emptyActionText}>Sizin İçin Akışına Dön</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          decelerationRate="fast"
          snapToInterval={containerHeight}
          snapToAlignment="start"
          onMomentumScrollEnd={handleScrollEnd}
          onScrollEndDrag={handleScrollEnd}
          scrollEventThrottle={16}
        >
          {feedEntries.map((entry, idx) => {
            const isActive = idx === activeIndex;

            if (entry.entryKind === 'checkpoint') {
              return (
                <View
                  key={entry.key}
                  style={[s.pageContainer, { height: containerHeight }]}
                >
                  <View style={s.checkpointCard}>
                    <View
                      style={StyleSheet.absoluteFill}
                      pointerEvents="none"
                      {...(Platform.OS === 'web'
                        ? { 'aria-hidden': true }
                        : {
                            accessibilityElementsHidden: true,
                            importantForAccessibility: 'no-hide-descendants' as const,
                          })}
                    >
                      <Image
                        source={FLOW_CHECKPOINT_ZEN}
                        style={StyleSheet.absoluteFill}
                        contentFit="cover"
                        cachePolicy="memory-disk"
                      />
                      <View
                        style={[
                          StyleSheet.absoluteFill,
                          { backgroundColor: hexA(colors.bgSunk, 0.58) },
                        ]}
                      />
                      <Animated.View
                        style={[
                          s.zenBreathRing,
                          !IS_TEST && !reduceMotion
                            ? {
                                opacity: breathAnim.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.54] }),
                                transform: [{ scale: breathAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] }) }],
                              }
                            : { opacity: 0.28 },
                        ]}
                      />
                    </View>
                    <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={140} opacity={0.18} />
                    <View style={s.checkpointBadge}>
                      <Ionicons name="leaf" size={14} color={colors.success} />
                      <Text style={s.checkpointBadgeText}>
                        INFLOW 5 DAKİKA KURALI · BİLİNÇLİ DURAĞI
                      </Text>
                    </View>

                    <Text style={s.checkpointTitle}>
                      {entry.watchedCount} odak içeriği izledin. Zihnin şu an harekete hazır!
                    </Text>

                    <Text style={s.checkpointDesc}>
                      Instagram veya TikTok seni saatlerce ekranda tutmak için tasarlanır. Aderyth ise izlediğin tekniği gerçek hayatına taşıman için burada nazik bir nefes molası verir.
                    </Text>

                    <View style={s.checkpointActions}>
                      <TouchableOpacity
                        style={s.checkpointPrimaryBtn}
                        onPress={() =>
                          launchFiveMinuteFocus('Odak Akışı Sonrası İlk 5 Dakikalık Adım', 5)
                        }
                        accessibilityRole="button"
                        accessibilityLabel="5 Dakikalık Odak Sayacını Başlat"
                      >
                        <Ionicons name="flash" size={18} color={colors.white} />
                        <Text style={s.checkpointPrimaryText}>
                          Şimdi 5 Dk Küçük Başla (Odağa Geç)
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={s.checkpointSecondaryBtn}
                        onPress={() => {
                          haptic.select();
                          Speech.stop();
                          router.push('/tabs/today' as any);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="Bugün ekranına dön"
                      >
                        <Ionicons
                          name="checkmark-done-circle-outline"
                          size={18}
                          color={colors.text}
                        />
                        <Text style={s.checkpointSecondaryText}>
                          Bugün Planıma Dön ve Uygula
                        </Text>
                      </TouchableOpacity>

                      {idx + 1 < feedEntries.length && (
                        <TouchableOpacity
                          style={s.checkpointGhostBtn}
                          onPress={() => scrollToEntry(idx + 1)}
                          accessibilityRole="button"
                          accessibilityLabel="Akışta izlemeye devam et"
                        >
                          <Text style={s.checkpointGhostText}>
                            Akışta Kalmaya Devam Et ↓
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>
                </View>
              );
            }

            const { item } = entry;
            const isSaved = savedIds.has(item.id);
            const isKinetic =
              item.kind === 'inflow_interactive' || kineticOverrideIds.has(item.id);
            const curSlideIdx = slideMap[item.id] ?? 0;
            const curSlide = item.kineticSlides[curSlideIdx] ?? item.kineticSlides[0];
            const pickedOptId = selectedPromptOption[item.id];
            const pickedOption = item.interactivePrompt?.options.find(
              (o) => o.id === pickedOptId,
            );
            const alreadyAdded = isHabitCtaAlreadyAdded(item);
            const isAddingThis =
              item.cta.atomicHabitId != null && addingHabitId === item.cta.atomicHabitId;

            return (
              <View
                key={entry.key}
                style={[s.pageContainer, { height: containerHeight }]}
              >
                <View
                  style={[
                    s.reelCard,
                    { borderColor: hexA(item.accentColor, 0.32) },
                  ]}
                >
                    {/* Arka Plan Sanat & Vurgu Işığı */}
                  <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={142} opacity={0.14} />
                  <View
                    style={StyleSheet.absoluteFill}
                    pointerEvents="none"
                    {...(Platform.OS === 'web'
                      ? { 'aria-hidden': true }
                      : {
                          accessibilityElementsHidden: true,
                          importantForAccessibility: 'no-hide-descendants' as const,
                        })}
                  >
                    <Image
                      source={FLOW_CBT_BACKDROPS[item.id] ?? TEXTURES.neural}
                      style={[
                        StyleSheet.absoluteFill,
                        { opacity: FLOW_CBT_BACKDROPS[item.id] ? 0.85 : 0.08 },
                      ]}
                      contentFit="cover"
                      cachePolicy="memory-disk"
                    />
                    {FLOW_CBT_BACKDROPS[item.id] ? (
                      <View
                        style={[
                          StyleSheet.absoluteFill,
                          { backgroundColor: hexA(colors.bgSunk, 0.62) },
                        ]}
                      />
                    ) : null}
                  </View>
                  <View
                    style={[
                      s.ambientGlow,
                      { backgroundColor: hexA(item.accentColor, 0.13) },
                    ]}
                  />

                  {/* Üst Bilgi Başlığı */}
                  <View style={s.reelTopMeta}>
                    <View
                      style={[
                        s.kindBadge,
                        {
                          backgroundColor: hexA(item.accentColor, 0.2),
                          borderColor: hexA(item.accentColor, 0.45),
                        },
                      ]}
                    >
                      <Ionicons
                        name={item.icon as any}
                        size={12}
                        color={item.accentColor}
                      />
                      <Text style={[s.kindBadgeText, { color: item.accentColor }]}>
                        {item.badge}
                      </Text>
                    </View>

                    <View style={s.metaRightGroup}>
                      <View style={s.langBadge}>
                        <Text style={s.langBadgeText}>
                          {item.languageBadge} · {item.durationSec} sn
                        </Text>
                      </View>

                      {item.kind === 'video' && (
                        <TouchableOpacity
                          style={[
                            s.modeToggleChip,
                            isKinetic && {
                              backgroundColor: hexA(item.accentColor, 0.28),
                              borderColor: item.accentColor,
                            },
                          ]}
                          onPress={() => toggleKineticMode(item.id)}
                          accessibilityRole="button"
                          accessibilityLabel={
                            isKinetic ? 'Videoya geç' : 'Türkçe kinetik özete geç'
                          }
                        >
                          <Ionicons
                            name={isKinetic ? 'videocam' : 'reader'}
                            size={12}
                            color={colors.white}
                          />
                          <Text style={s.modeToggleText}>
                            {isKinetic ? 'Video' : 'TR Kart'}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* Ana İçerik Gövdesi + Sağ TikTok Aksiyon Sütunu */}
                  <View style={s.stageAndRailRow}>
                    <View style={s.mainStage}>
                      {/* Başlık & Kaynak */}
                      <Text style={s.hookTitle} numberOfLines={2}>
                        {item.hookTitle}
                      </Text>
                      <Text style={s.creatorLine} numberOfLines={1}>
                        {item.creatorOrSource} — {item.subtitle}
                      </Text>

                      {/* 1) VİDEO SAHNESİ */}
                      {item.kind === 'video' && !isKinetic && item.videoSource ? (
                        <View style={s.videoStageBox}>
                          {isActive ? (
                            <NativeYoutubeEmbed
                              videoId={item.videoSource.videoId}
                              muted={!soundEnabled}
                            />
                          ) : (
                            <View style={s.videoPlaceholder}>
                              <Ionicons
                                name="play-circle"
                                size={48}
                                color={item.accentColor}
                              />
                              <Text style={s.videoPlaceholderText}>
                                Oynatmak için kaydır
                              </Text>
                            </View>
                          )}
                        </View>
                      ) : (
                        /* 2) INFLOW KİNETİK STORY & İNTERAKTİF BDT SAHNESİ */
                        <View style={s.kineticStageBox}>
                          {/* Story İlerleme Çubukları */}
                          <View style={s.storySegmentsRow}>
                            {item.kineticSlides.map((_, sIdx) => {
                              const doneOrCurrent = sIdx <= curSlideIdx;
                              return (
                                <TouchableOpacity
                                  key={sIdx}
                                  style={s.storySegmentHit}
                                  onPress={() => {
                                    haptic.select();
                                    setSlideMap((prev) => ({
                                      ...prev,
                                      [item.id]: sIdx,
                                    }));
                                  }}
                                >
                                  <View
                                    style={[
                                      s.storySegmentBar,
                                      doneOrCurrent && {
                                        backgroundColor: item.accentColor,
                                      },
                                    ]}
                                  />
                                </TouchableOpacity>
                              );
                            })}
                          </View>

                          {/* Aktif Slayt Metni */}
                          {curSlide && (
                            <TouchableOpacity
                              activeOpacity={0.9}
                              style={s.kineticSlideCard}
                              onPress={() => {
                                haptic.light();
                                setSlideMap((prev) => ({
                                  ...prev,
                                  [item.id]:
                                    ((prev[item.id] ?? 0) + 1) %
                                    item.kineticSlides.length,
                                }));
                              }}
                            >
                              <Text
                                style={[
                                  s.slideEyebrow,
                                  { color: item.accentColor },
                                ]}
                              >
                                {curSlide.eyebrow}
                              </Text>
                              <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="top-right" size={96} opacity={0.11} />
                              <Text style={s.slideMainText}>{curSlide.text}</Text>
                              <View
                                style={[
                                  s.slideHighlightBox,
                                  {
                                    backgroundColor: hexA(item.accentColor, 0.14),
                                    borderLeftColor: item.accentColor,
                                  },
                                ]}
                              >
                                <Text style={s.slideHighlightText}>
                                  {curSlide.highlight}
                                </Text>
                              </View>
                              <Text style={s.tapNextHint}>
                                Sonraki slayt için karta dokun ({curSlideIdx + 1}/
                                {item.kineticSlides.length})
                              </Text>
                            </TouchableOpacity>
                          )}

                          {/* Inflow İnteraktif Mini-Teşhis Sorusu */}
                          {item.interactivePrompt && (
                            <View style={s.promptBox}>
                              <Text style={s.promptQuestion}>
                                💬 {item.interactivePrompt.question}
                              </Text>
                              <View style={s.promptOptionsCol}>
                                {item.interactivePrompt.options.map((opt) => {
                                  const selected = pickedOptId === opt.id;
                                  return (
                                    <TouchableOpacity
                                      key={opt.id}
                                      style={[
                                        s.promptOptBtn,
                                        selected && {
                                          borderColor: item.accentColor,
                                          backgroundColor: hexA(
                                            item.accentColor,
                                            0.2,
                                          ),
                                        },
                                      ]}
                                      onPress={() => {
                                        haptic.select();
                                        setSelectedPromptOption((prev) => ({
                                          ...prev,
                                          [item.id]: opt.id,
                                        }));
                                      }}
                                      accessibilityRole="button"
                                      accessibilityLabel={opt.label}
                                    >
                                      <Text style={s.promptOptEmoji}>{opt.emoji}</Text>
                                      <Text
                                        style={[
                                          s.promptOptLabel,
                                          selected && {
                                            color: colors.white,
                                            fontWeight: '600',
                                          },
                                        ]}
                                        numberOfLines={2}
                                      >
                                        {opt.label}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </View>

                              {pickedOption && (
                                <View
                                  style={[
                                    s.coachingReplyBox,
                                    { borderColor: hexA(item.accentColor, 0.5) },
                                  ]}
                                >
                                  <Ionicons
                                    name="sparkles"
                                    size={14}
                                    color={item.accentColor}
                                  />
                                  <Text style={s.coachingReplyText}>
                                    {pickedOption.coachingReply}
                                  </Text>
                                </View>
                              )}
                            </View>
                          )}
                        </View>
                      )}
                    </View>

                    {/* Sağ Dikey TikTok / Reels Etkileşim Sütunu */}
                    <View style={s.rightActionRail}>
                      <TouchableOpacity
                        style={s.railBtn}
                        onPress={() => toggleSaveItem(item.id)}
                        accessibilityRole="button"
                        accessibilityLabel={isSaved ? 'Kaydı kaldır' : 'Kaydet'}
                      >
                        <View
                          style={[
                            s.railIconCircle,
                            isSaved && {
                              backgroundColor: hexA(colors.success, 0.25),
                              borderColor: colors.success,
                            },
                          ]}
                        >
                          <Ionicons
                            name={isSaved ? 'bookmark' : 'bookmark-outline'}
                            size={19}
                            color={isSaved ? colors.success : colors.white}
                          />
                        </View>
                        <Text style={s.railBtnLabel}>
                          {isSaved ? 'Kaydedildi' : 'Kaydet'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={s.railBtn}
                        onPress={() => {
                          haptic.select();
                          setTakeawayItem(item);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel="3 saniyelik özeti aç"
                      >
                        <View style={s.railIconCircle}>
                          <Ionicons
                            name="list-outline"
                            size={19}
                            color={colors.white}
                          />
                        </View>
                        <Text style={s.railBtnLabel}>3 Sn Özet</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={s.railBtn}
                        onPress={() => {
                          haptic.select();
                          setSoundEnabled((v) => !v);
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={
                          soundEnabled ? 'Sesi kapat' : 'Sesli anlatımı aç'
                        }
                      >
                        <View
                          style={[
                            s.railIconCircle,
                            soundEnabled && {
                              backgroundColor: hexA(item.accentColor, 0.28),
                              borderColor: item.accentColor,
                            },
                          ]}
                        >
                          <Ionicons
                            name={soundEnabled ? 'volume-high' : 'volume-mute'}
                            size={19}
                            color={soundEnabled ? item.accentColor : colors.white}
                          />
                        </View>
                        <Text style={s.railBtnLabel}>
                          {soundEnabled ? 'Ses Açık' : 'Ses Kapalı'}
                        </Text>
                      </TouchableOpacity>

                      {/* Masaüstü / Simülatör Hızlı Kaydırma Okları */}
                      <View style={s.railNavGroup}>
                        <TouchableOpacity
                          style={[
                            s.railMiniNavBtn,
                            idx === 0 && { opacity: 0.35 },
                          ]}
                          disabled={idx === 0}
                          onPress={() => scrollToEntry(idx - 1)}
                          accessibilityRole="button"
                          accessibilityLabel="Önceki akış içeriği"
                        >
                          <Ionicons name="chevron-up" size={18} color={colors.white} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            s.railMiniNavBtn,
                            idx === feedEntries.length - 1 && { opacity: 0.35 },
                          ]}
                          disabled={idx === feedEntries.length - 1}
                          onPress={() => scrollToEntry(idx + 1)}
                          accessibilityRole="button"
                          accessibilityLabel="Sonraki akış içeriği"
                        >
                          <Ionicons
                            name="chevron-down"
                            size={18}
                            color={colors.white}
                          />
                        </TouchableOpacity>
                      </View>
                    </View>
                  </View>

                  {/* Alt "İzlemekten Eyleme Geçiş" (Watch-to-Action) Köprüsü */}
                  <View style={s.bottomBridgeRow}>
                    <TouchableOpacity
                      style={[
                        s.ctaBridgeBtn,
                        {
                          backgroundColor: alreadyAdded
                            ? hexA(colors.success, 0.22)
                            : item.accentColor,
                          borderColor: alreadyAdded ? colors.success : item.accentColor,
                        },
                      ]}
                      disabled={isAddingThis}
                      onPress={() => handleExecuteCta(item)}
                      activeOpacity={0.85}
                      accessibilityRole="button"
                      accessibilityLabel={item.cta.label}
                    >
                      {isAddingThis ? (
                        <ActivityIndicator size="small" color={colors.white} />
                      ) : (
                        <>
                          <Ionicons
                            name={
                              alreadyAdded
                                ? 'checkmark-circle'
                                : item.cta.actionType === 'add_atomic_habit'
                                  ? 'add-circle'
                                  : 'flash'
                            }
                            size={18}
                            color={alreadyAdded ? colors.success : colors.white}
                          />
                          <Text
                            style={[
                              s.ctaBridgeText,
                              alreadyAdded && { color: colors.success },
                            ]}
                            numberOfLines={1}
                          >
                            {alreadyAdded
                              ? '✓ Alışkanlık Sisteminde Ekli'
                              : item.cta.label}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* 📌 3 Saniyelik Özet & Hızlı Eylem Çekmecesi (Modal) */}
      <Modal
        visible={takeawayItem != null}
        transparent
        animationType="slide"
        onRequestClose={() => setTakeawayItem(null)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            {takeawayItem && (
              <>
                <View style={s.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={[
                        s.modalEyebrow,
                        { color: takeawayItem.accentColor },
                      ]}
                    >
                      📌 3 SANİYELİK BİLİMSEL ÖZET
                    </Text>
                    <Text style={s.modalTitle}>{takeawayItem.hookTitle}</Text>
                  </View>
                  <TouchableOpacity
                    style={s.iconCircleBtn}
                    onPress={() => setTakeawayItem(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Özeti kapat"
                  >
                    <Ionicons name="close" size={18} color={colors.white} />
                  </TouchableOpacity>
                </View>

                <View style={s.takeawaysList}>
                  {takeawayItem.keyTakeaways.map((point, pIdx) => (
                    <View key={pIdx} style={s.takeawayRow}>
                      <View
                        style={[
                          s.takeawayNumCircle,
                          {
                            backgroundColor: hexA(
                              takeawayItem.accentColor,
                              0.2,
                            ),
                          },
                        ]}
                      >
                        <Text
                          style={[
                            s.takeawayNumText,
                            { color: takeawayItem.accentColor },
                          ]}
                        >
                          {pIdx + 1}
                        </Text>
                      </View>
                      <Text style={s.takeawayPointText}>{point}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity
                  style={[
                    s.ctaBridgeBtn,
                    {
                      backgroundColor: takeawayItem.accentColor,
                      borderColor: takeawayItem.accentColor,
                      marginTop: space.md,
                    },
                  ]}
                  onPress={async () => {
                    const target = takeawayItem;
                    setTakeawayItem(null);
                    await handleExecuteCta(target);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={takeawayItem.cta.label}
                >
                  <Ionicons name="flash" size={18} color={colors.white} />
                  <Text style={s.ctaBridgeText}>{takeawayItem.cta.label}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bgSunk,
    position: 'relative',
  },
  topOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 30,
    paddingTop: space.sm,
    paddingBottom: space.xs,
    backgroundColor: 'rgba(9, 9, 13, 0.84)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  topHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.md,
    gap: space.sm,
    marginBottom: space.xs,
  },
  iconCircleBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: 'rgba(249, 115, 22, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(249, 115, 22, 0.35)',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.primary,
  },
  brandPillText: {
    color: colors.primaryBright,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.7,
  },
  counterPill: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  counterPillText: {
    color: colors.textDim,
    fontSize: 11,
    fontWeight: '600',
  },
  catStrip: {
    paddingHorizontal: space.md,
    gap: 7,
    paddingVertical: 2,
  },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  catChipText: {
    color: colors.textDim,
    fontSize: 12,
    fontWeight: '500',
  },
  catChipTextActive: {
    color: colors.white,
    fontWeight: '600',
  },
  toastWrap: {
    position: 'absolute',
    top: 94,
    left: space.md,
    right: space.md,
    zIndex: 45,
    backgroundColor: 'rgba(16, 185, 129, 0.95)',
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderRadius: radius.md,
    alignItems: 'center',
  },
  toastText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  pageContainer: {
    width: '100%',
    paddingTop: 92,
    paddingBottom: space.sm,
    paddingHorizontal: space.sm,
    justifyContent: 'center',
  },
  reelCard: {
    flex: 1,
    backgroundColor: colors.bg,
    borderRadius: 24,
    borderWidth: 1,
    padding: space.md,
    overflow: 'hidden',
    justifyContent: 'space-between',
    position: 'relative',
  },
  ambientGlow: {
    position: 'absolute',
    top: -60,
    right: -40,
    width: 220,
    height: 220,
    borderRadius: 110,
  },
  reelTopMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.xs,
    marginBottom: space.xs,
  },
  kindBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.full,
    borderWidth: 1,
  },
  kindBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  metaRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  langBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },
  langBadgeText: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '500',
  },
  modeToggleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: radius.full,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  modeToggleText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '600',
  },
  stageAndRailRow: {
    flex: 1,
    flexDirection: 'row',
    gap: space.sm,
    marginVertical: 4,
  },
  mainStage: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  hookTitle: {
    color: colors.white,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: '700',
    marginBottom: 3,
  },
  creatorLine: {
    color: colors.textDim,
    fontSize: 12,
    marginBottom: space.sm,
  },
  videoStageBox: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    backgroundColor: colors.bgSunk,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  videoPlaceholder: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
  },
  videoPlaceholderText: {
    color: colors.textDim,
    fontSize: 12,
  },
  kineticStageBox: {
    flex: 1,
    justifyContent: 'space-between',
    gap: space.xs,
  },
  storySegmentsRow: {
    flexDirection: 'row',
    gap: 5,
    marginBottom: 2,
  },
  storySegmentHit: {
    flex: 1,
    paddingVertical: 3,
  },
  storySegmentBar: {
    height: 3.5,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  zenBreathRing: {
    position: 'absolute',
    alignSelf: 'center',
    top: '22%',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 1.5,
    borderColor: hexA(colors.success, 0.45),
    backgroundColor: hexA(colors.success, 0.06),
  },
  kineticSlideCard: {
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 16,
    padding: space.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    gap: 8,
  },
  slideEyebrow: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  slideMainText: {
    color: colors.white,
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '600',
  },
  slideHighlightBox: {
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 6,
    paddingRight: 8,
    borderRadius: 8,
  },
  slideHighlightText: {
    color: colors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: '500',
  },
  tapNextHint: {
    color: colors.textFaint,
    fontSize: 10,
    textAlign: 'right',
  },
  promptBox: {
    backgroundColor: 'rgba(0,0,0,0.28)',
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    gap: 6,
  },
  promptQuestion: {
    color: colors.neutral200,
    fontSize: 12,
    fontWeight: '600',
  },
  promptOptionsCol: {
    gap: 5,
  },
  promptOptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.09)',
  },
  promptOptEmoji: {
    fontSize: 13,
  },
  promptOptLabel: {
    flex: 1,
    color: colors.textDim,
    fontSize: 11.5,
    lineHeight: 15,
  },
  coachingReplyBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 10,
    padding: 8,
    borderWidth: 1,
    marginTop: 2,
  },
  coachingReplyText: {
    flex: 1,
    color: colors.white,
    fontSize: 11.5,
    lineHeight: 16,
  },
  rightActionRail: {
    width: 54,
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    paddingBottom: 4,
  },
  railBtn: {
    alignItems: 'center',
    gap: 3,
  },
  railIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.09)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  railBtnLabel: {
    color: colors.textDim,
    fontSize: 9.5,
    fontWeight: '500',
    textAlign: 'center',
  },
  railNavGroup: {
    marginTop: 4,
    gap: 5,
    alignItems: 'center',
  },
  railMiniNavBtn: {
    width: 34,
    height: 30,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottomBridgeRow: {
    paddingTop: 6,
  },
  ctaBridgeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: space.md,
    borderRadius: 14,
    borderWidth: 1,
  },
  ctaBridgeText: {
    color: colors.white,
    fontSize: 13.5,
    fontWeight: '700',
  },
  checkpointCard: {
    flex: 1,
    backgroundColor: colors.surfaceAlt,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
    padding: space.lg,
    justifyContent: 'center',
    gap: space.md,
  },
  checkpointBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: radius.full,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.35)',
  },
  checkpointBadgeText: {
    color: colors.success,
    fontSize: 10.5,
    fontWeight: '700',
    letterSpacing: 0.6,
  },
  checkpointTitle: {
    color: colors.white,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: '700',
  },
  checkpointDesc: {
    color: colors.textDim,
    fontSize: 14,
    lineHeight: 21,
  },
  checkpointActions: {
    gap: 10,
    marginTop: space.xs,
  },
  checkpointPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.success,
    paddingVertical: 14,
    borderRadius: 14,
  },
  checkpointPrimaryText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '700',
  },
  checkpointSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
    paddingVertical: 13,
    borderRadius: 14,
  },
  checkpointSecondaryText: {
    color: colors.white,
    fontSize: 13.5,
    fontWeight: '600',
  },
  checkpointGhostBtn: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  checkpointGhostText: {
    color: colors.textDim,
    fontSize: 12.5,
    fontWeight: '500',
  },
  emptyStateWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xl,
    gap: space.md,
  },
  emptyIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.06)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  emptySub: {
    color: colors.textDim,
    fontSize: 13.5,
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: colors.primary,
    paddingHorizontal: space.lg,
    paddingVertical: 12,
    borderRadius: radius.full,
  },
  emptyActionText: {
    color: colors.white,
    fontSize: 13.5,
    fontWeight: '700',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: space.lg,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    marginBottom: space.md,
  },
  modalEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.7,
    marginBottom: 4,
  },
  modalTitle: {
    color: colors.white,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 23,
  },
  takeawaysList: {
    gap: 12,
  },
  takeawayRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  takeawayNumCircle: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  takeawayNumText: {
    fontSize: 12,
    fontWeight: '700',
  },
  takeawayPointText: {
    flex: 1,
    color: colors.neutral200,
    fontSize: 13.5,
    lineHeight: 20,
  },
});
