import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useIsFocused, useRouter } from 'expo-router';
import * as Speech from 'expo-speech';
import { useShallow } from 'zustand/react/shallow';
import { useFlowKeyboard } from '../hooks/useFlowKeyboard';
import { SEEN_DWELL_MS, useFocusFlowFeed } from '../hooks/useFocusFlowFeed';
import { useTimeoutRef } from '../hooks/useTimeoutRef';
import { buildAtomicHabitInsert } from '../lib/exploreCatalog';
import { FLOW_COPY } from '../lib/flowCopy';
import {
  FOCUS_FLOW_CATEGORIES, findAtomicHabitById,
  type FocusFeedEntry, type FocusFeedItem, type FocusFlowCategoryKey,
} from '../lib/focusFlowCatalog';
import { haptic } from '../lib/haptics';
import { colors, font, hexA, radius, space } from '../lib/tokens';
import { EMPTY_VIGNETTES } from '../lib/visualAssets';
import { useFocusStore } from '../store/focusStore';
import { useHabitStore } from '../store/habitStore';
import { useTaskStore } from '../store/taskStore';
import FlowClosurePage from './focusFlow/FlowClosurePage';
import { FocusFlowPage, type FocusFlowPageContext } from './focusFlow/FocusFlowPage';
import { FocusFlowPager, type FocusFlowPagerHandle } from './focusFlow/FocusFlowPager';
import { useReducedMotion } from './seasonalMotion/useReducedMotion';

export type FocusFlowViewProps = {
  initialItemId?: string | null;
  initialCategory?: FocusFlowCategoryKey;
  showBackButton?: boolean;
  showExpandButton?: boolean;
  onRequestExplorePacks?: () => void;
};

export default function FocusFlowView({
  initialItemId = null,
  initialCategory = 'for_you',
  showBackButton = false,
  showExpandButton = false,
  onRequestExplorePacks,
}: FocusFlowViewProps) {
  const router = useRouter();
  const isFocused = useIsFocused();
  const reduceMotion = useReducedMotion();
  const pagerRef = useRef<FocusFlowPagerHandle | null>(null);
  const toastTimer = useTimeoutRef();
  const dwellTimer = useTimeoutRef();

  const {
    category: feedCategory, setCategory: feedSetCategory, entries: feedEntries,
    savedIds: feedSavedIds, toggleSaved: feedToggleSaved, markSeen: feedMarkSeen,
    lowEnergy: feedLowEnergy, existingHabitNames: feedExistingHabitNames, activeHabits: feedActiveHabits,
  } = useFocusFlowFeed({ initialItemId, initialCategory });

  const addHabit = useHabitStore((st) => st.addHabit);
  const tasks = useTaskStore((st) => st.tasks);
  const { focusStatus, startSmallStep } = useFocusStore(
    useShallow((st) => ({ focusStatus: st.status, startSmallStep: st.startSmallStep })),
  );

  const [containerHeight, setContainerHeight] = useState<number>(640);
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(false);
  const [kineticOverrideIds, setKineticOverrideIds] = useState<Set<string>>(() => new Set());
  const [takeawayItem, setTakeawayItem] = useState<FocusFeedItem | null>(null);
  const [addingHabitId, setAddingHabitId] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const activeIndexRef = useRef(activeIndex);
  const activeKeyRef = useRef<string | null>(feedEntries[0]?.key ?? null);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
    const current = feedEntries[activeIndex];
    if (current) activeKeyRef.current = current.key;
  }, [activeIndex, feedEntries]);

  useEffect(() => {
    const curIdx = activeIndexRef.current;
    if (feedEntries.length === 0) {
      if (curIdx !== 0) setActiveIndex(0);
      return;
    }
    const targetKey = activeKeyRef.current;
    if (targetKey) {
      const idx = feedEntries.findIndex((e) => e.key === targetKey);
      if (idx >= 0) {
        if (idx !== curIdx) {
          setActiveIndex(idx);
          pagerRef.current?.scrollToIndex(idx, false);
        }
        return;
      }
    }
    setActiveIndex(0);
    pagerRef.current?.scrollToIndex(0, false);
  }, [feedEntries]);

  useEffect(() => { if (!isFocused) Speech.stop(); }, [isFocused]);
  useEffect(() => () => { Speech.stop(); }, []);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    toastTimer.set(() => setToastMessage(null), 3200);
  }, [toastTimer]);

  useEffect(() => {
    dwellTimer.clear();
    if (!isFocused) return;
    const entry = feedEntries[activeIndex];
    if (!entry || entry.entryKind !== 'item') return;
    const itemId = entry.item.id;
    dwellTimer.set(() => { feedMarkSeen(itemId); }, SEEN_DWELL_MS);
    return () => dwellTimer.clear();
  }, [activeIndex, feedEntries, feedMarkSeen, isFocused, dwellTimer]);

  const scrollToEntry = useCallback((nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= feedEntries.length) return;
    haptic.select();
    Speech.stop();
    activeKeyRef.current = feedEntries[nextIndex]?.key ?? null;
    setActiveIndex(nextIndex);
    pagerRef.current?.scrollToIndex(nextIndex, true);
  }, [feedEntries]);

  const handleActiveIndexChange = useCallback((nextIndex: number) => {
    Speech.stop();
    activeKeyRef.current = feedEntries[nextIndex]?.key ?? null;
    setActiveIndex(nextIndex);
  }, [feedEntries]);

  useFlowKeyboard({
    enabled: isFocused && takeawayItem == null,
    onNext: () => scrollToEntry(Math.min(feedEntries.length - 1, activeIndexRef.current + 1)),
    onPrev: () => scrollToEntry(Math.max(0, activeIndexRef.current - 1)),
  });

  function handleLayout(e: LayoutChangeEvent) {
    const h = Math.round(e.nativeEvent.layout.height);
    if (h > 200 && Math.abs(h - containerHeight) > 2) setContainerHeight(h);
  }

  function handleSelectCategory(cat: FocusFlowCategoryKey) {
    haptic.select();
    Speech.stop();
    activeKeyRef.current = null;
    feedSetCategory(cat);
    setActiveIndex(0);
    pagerRef.current?.scrollToIndex(0, false);
  }

  const handleToggleSave = useCallback(async (itemId: string) => {
    haptic.medium();
    const added = await feedToggleSaved(itemId);
    showToast(added ? '🔖 Odak koleksiyonuna kaydedildi.' : 'Kaydedilenlerden çıkarıldı.');
  }, [feedToggleSaved, showToast]);

  const handleToggleKinetic = useCallback((itemId: string) => {
    haptic.select();
    Speech.stop();
    setKineticOverrideIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  const launchFiveMinuteFocus = useCallback((title: string, minutes = 5) => {
    haptic.medium();
    Speech.stop();
    const firstTask = tasks.find((t) => !t.completed && t.status === 'pending');
    if (focusStatus === 'idle') {
      startSmallStep(
        { kind: 'task', id: firstTask?.id ?? 'focus-flow-spark', title: firstTask?.title ?? 'Odak Akışı Kıvılcımı' },
        { title, minutes },
      );
    }
    router.push('/tabs/focus' as any);
  }, [tasks, focusStatus, startSmallStep, router]);

  const handleBackToToday = useCallback(() => {
    haptic.select();
    Speech.stop();
    router.push('/tabs/today' as any);
  }, [router]);

  const handleExecuteCta = useCallback(async (item: FocusFeedItem) => {
    const { cta } = item;
    if (cta.actionType === 'add_atomic_habit') {
      const atomic = findAtomicHabitById(cta.atomicHabitId);
      if (!atomic) return;
      const norm = atomic.name.trim().toLocaleLowerCase('tr-TR');
      if (feedExistingHabitNames.has(norm)) {
        showToast(`✓ "${atomic.name}" zaten alışkanlık sisteminde ekli.`);
        return;
      }
      if (addingHabitId) return;
      haptic.medium();
      setAddingHabitId(atomic.id);
      try {
        const { insertPayload, assignedStatus } = buildAtomicHabitInsert(atomic, feedActiveHabits);
        const created = await addHabit(insertPayload);
        if (created) {
          showToast(
            assignedStatus === 'active'
              ? `✓ "${atomic.name}" aktif alışkanlıklarına eklendi!`
              : `⏳ "${atomic.name}" kapasiteni korumak için Bekleyen (Triage) listesine eklendi.`,
          );
        }
      } finally {
        setAddingHabitId(null);
      }
      return;
    }
    if (cta.actionType === 'start_small_focus') {
      launchFiveMinuteFocus(cta.focusTitle ?? 'Odak Akışı: 5 dakikalık başlangıç', cta.focusMinutes ?? 5);
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
      if (onRequestExplorePacks) onRequestExplorePacks();
      else router.push('/tabs/hub' as any);
      return;
    }
    if (cta.actionType === 'open_routine_runner') {
      haptic.select();
      Speech.stop();
      router.push('/screens/routine-runner' as any);
    }
  }, [feedExistingHabitNames, feedActiveHabits, addingHabitId, addHabit, showToast, launchFiveMinuteFocus, onRequestExplorePacks, router]);

  const handleOpenTakeaways = useCallback((item: FocusFeedItem) => { haptic.select(); setTakeawayItem(item); }, []);
  const handleGo = useCallback((delta: -1 | 1) => { scrollToEntry(activeIndexRef.current + delta); }, [scrollToEntry]);
  const handleToggleSound = useCallback(() => { haptic.select(); setSoundEnabled((v) => !v); }, []);
  const handleLaunchCheckpointFocus = useCallback(() => {
    launchFiveMinuteFocus('Odak Akışı Sonrası İlk 5 Dakikalık Adım', 5);
  }, [launchFiveMinuteFocus]);

  const pageCtx = useMemo<FocusFlowPageContext>(() => ({
    pageHeight: containerHeight, screenFocused: isFocused, reduceMotion, soundEnabled,
    takeawayOpen: takeawayItem != null, savedIds: feedSavedIds, addingHabitId,
    existingHabitNames: feedExistingHabitNames, kineticOverrideIds, total: feedEntries.length,
    onToggleSave: handleToggleSave, onToggleKinetic: handleToggleKinetic,
    onExecuteCta: handleExecuteCta, onOpenTakeaways: handleOpenTakeaways,
    onGo: handleGo, onToggleSound: handleToggleSound,
    onLaunchSmallFocus: handleLaunchCheckpointFocus, onBackToToday: handleBackToToday,
  }), [
    containerHeight, isFocused, reduceMotion, soundEnabled, takeawayItem,
    feedSavedIds, addingHabitId, feedExistingHabitNames, kineticOverrideIds,
    feedEntries.length, handleToggleSave, handleToggleKinetic, handleExecuteCta,
    handleOpenTakeaways, handleGo, handleToggleSound, handleLaunchCheckpointFocus, handleBackToToday,
  ]);

  const renderEntry = useCallback((entry: FocusFeedEntry, idx: number, isActive: boolean) => {
    if (entry.entryKind === 'closure') {
      const isAddingClosure =
        entry.action?.cta.atomicHabitId != null && addingHabitId === entry.action.cta.atomicHabitId;
      return (
        <FlowClosurePage
          pageHeight={containerHeight}
          seenCount={entry.seenCount}
          action={entry.action}
          adding={isAddingClosure}
          onTry={(item) => { void handleExecuteCta(item); }}
          onBackToToday={handleBackToToday}
        />
      );
    }
    return <FocusFlowPage entry={entry} index={idx} isActive={isActive} ctx={pageCtx} />;
  }, [addingHabitId, containerHeight, handleExecuteCta, handleBackToToday, pageCtx]);

  const activeEntry = feedEntries[activeIndex] ?? null;
  const itemTotal = feedEntries.filter((e) => e.entryKind !== 'closure').length;

  return (
    <View style={s.root} onLayout={handleLayout}>
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

          <View style={s.spacer} />

          {itemTotal > 0 && (
            <View style={s.counterPill}>
              <Text style={s.counterPillText}>{Math.min(activeIndex + 1, itemTotal)} / {itemTotal}</Text>
            </View>
          )}

          {showExpandButton && (
            <TouchableOpacity
              style={s.iconCircleBtn}
              onPress={() => {
                haptic.select();
                Speech.stop();
                const currentId = activeEntry?.entryKind === 'item' ? activeEntry.item.id : '';
                router.push((currentId ? `/screens/focus-flow?item=${currentId}` : '/screens/focus-flow') as any);
              }}
              accessibilityRole="button"
              accessibilityLabel="Tam Ekran Odak Akışını Aç"
            >
              <Ionicons name="expand-outline" size={17} color={colors.white} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.catStrip}>
          {FOCUS_FLOW_CATEGORIES.map((cat) => {
            const active = feedCategory === cat.key;
            return (
              <TouchableOpacity
                key={cat.key}
                style={[s.catChip, active && { backgroundColor: cat.color, borderColor: cat.color }]}
                onPress={() => handleSelectCategory(cat.key)}
                accessibilityRole="button"
                accessibilityLabel={`Akış kategorisi: ${cat.label}`}
              >
                <Ionicons name={cat.icon as any} size={12} color={active ? colors.white : cat.color} />
                <Text style={[s.catChipText, active && s.catChipTextActive]}>
                  {cat.label}
                  {cat.key === 'saved' && feedSavedIds.size > 0 ? ` (${feedSavedIds.size})` : ''}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {feedLowEnergy ? (
          <Text style={s.lowEnergyNote} accessibilityRole="text">{FLOW_COPY.flowLowEnergyNote}</Text>
        ) : null}
      </View>

      {toastMessage && (
        <View style={s.toastWrap}>
          <Text style={s.toastText}>{toastMessage}</Text>
        </View>
      )}

      {feedEntries.length === 0 ? (
        <View style={[s.emptyStateWrap, { height: containerHeight }]}>
          <Image source={EMPTY_VIGNETTES.focus} style={s.emptyArt} contentFit="cover" cachePolicy="memory-disk" />
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
        <FocusFlowPager
          ref={pagerRef}
          entries={feedEntries}
          activeIndex={activeIndex}
          pageHeight={containerHeight}
          onActiveIndexChange={handleActiveIndexChange}
          renderEntry={renderEntry}
        />
      )}

      <Modal visible={takeawayItem != null} transparent animationType="slide" onRequestClose={() => setTakeawayItem(null)}>
        <View style={s.modalBackdrop}>
          <View style={s.modalSheet}>
            {takeawayItem && (
              <>
                <View style={s.modalHeader}>
                  <View style={s.spacer}>
                    <Text style={[s.modalEyebrow, { color: takeawayItem.accentColor }]}>📌 3 SANİYELİK BİLİMSEL ÖZET</Text>
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
                      <View style={[s.takeawayNumCircle, { backgroundColor: hexA(takeawayItem.accentColor, 0.2) }]}>
                        <Text style={[s.takeawayNumText, { color: takeawayItem.accentColor }]}>{pIdx + 1}</Text>
                      </View>
                      <Text style={s.takeawayPointText}>{point}</Text>
                    </View>
                  ))}
                </View>

                <TouchableOpacity
                  style={[s.modalCtaBtn, { backgroundColor: takeawayItem.accentColor, borderColor: takeawayItem.accentColor }]}
                  onPress={async () => {
                    const target = takeawayItem;
                    setTakeawayItem(null);
                    await handleExecuteCta(target);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={takeawayItem.cta.label}
                >
                  <Ionicons name="flash" size={18} color={colors.white} />
                  <Text style={s.modalCtaText}>{takeawayItem.cta.label}</Text>
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
  root: { flex: 1, backgroundColor: colors.bgSunk, position: 'relative' },
  spacer: { flex: 1 },
  topOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30, paddingTop: space.sm, paddingBottom: space.xs, backgroundColor: hexA(colors.bgSunk, 0.88), borderBottomWidth: 1, borderBottomColor: hexA(colors.white, 0.06) },
  topHeaderRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space.md, gap: space.sm, marginBottom: space.xs },
  iconCircleBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: hexA(colors.white, 0.1), alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: hexA(colors.white, 0.12) },
  brandPill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full, backgroundColor: hexA(colors.primary, 0.14), borderWidth: 1, borderColor: hexA(colors.primary, 0.35) },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.primary },
  brandPillText: { color: colors.primaryBright, fontSize: 10, fontWeight: '700', letterSpacing: 0.7 },
  counterPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.full, backgroundColor: hexA(colors.white, 0.08) },
  counterPillText: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  catStrip: { paddingHorizontal: space.md, gap: 7, paddingVertical: 2 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 11, paddingVertical: 6, borderRadius: radius.full, backgroundColor: hexA(colors.white, 0.06), borderWidth: 1, borderColor: hexA(colors.white, 0.1) },
  catChipText: { color: colors.textDim, fontSize: 12, fontWeight: '500' },
  catChipTextActive: { color: colors.white, fontWeight: '600' },
  lowEnergyNote: { ...font.caption, color: colors.success, paddingHorizontal: space.md, paddingTop: space.xs },
  toastWrap: { position: 'absolute', top: 94, left: space.md, right: space.md, zIndex: 45, backgroundColor: hexA(colors.success, 0.95), paddingHorizontal: space.md, paddingVertical: 10, borderRadius: radius.md, alignItems: 'center' },
  toastText: { color: colors.white, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  emptyStateWrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, gap: space.md },
  emptyArt: { width: 148, height: 110, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
  emptyTitle: { color: colors.white, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptySub: { color: colors.textDim, fontSize: 13.5, lineHeight: 20, textAlign: 'center' },
  emptyActionBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.primary, paddingHorizontal: space.lg, paddingVertical: 12, borderRadius: radius.full },
  emptyActionText: { color: colors.white, fontSize: 13.5, fontWeight: '700' },
  modalBackdrop: { flex: 1, backgroundColor: hexA(colors.black, 0.72), justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: colors.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: space.lg, borderTopWidth: 1, borderColor: hexA(colors.white, 0.12) },
  modalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, marginBottom: space.md },
  modalEyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 0.7, marginBottom: 4 },
  modalTitle: { color: colors.white, fontSize: 17, fontWeight: '700', lineHeight: 23 },
  takeawaysList: { gap: 12 },
  takeawayRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  takeawayNumCircle: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  takeawayNumText: { fontSize: 12, fontWeight: '700' },
  takeawayPointText: { flex: 1, color: colors.text, fontSize: 13.5, lineHeight: 20 },
  modalCtaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, paddingVertical: space.md, paddingHorizontal: space.md, borderRadius: radius.lg, borderWidth: 1, marginTop: space.md },
  modalCtaText: { ...font.bodySm, color: colors.white, fontWeight: '700' },
});
