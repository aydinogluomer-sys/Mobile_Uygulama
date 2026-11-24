import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator, Animated, Easing, Platform, StyleSheet, Text, TouchableOpacity, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import * as Speech from 'expo-speech';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { findAtomicHabitById, type FocusFeedEntry, type FocusFeedItem } from '../../lib/focusFlowCatalog';
import { haptic } from '../../lib/haptics';
import { hexA, radius, space, type Palette } from '../../lib/tokens';
import { DECOR, FLOW_CBT_BACKDROPS, FLOW_CHECKPOINT_ZEN, TEXTURES } from '../../lib/visualAssets';
import EmbeddedFiligree from '../spatial/EmbeddedFiligree';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

export type FocusFlowPageContext = {
  pageHeight: number;
  screenFocused: boolean;
  reduceMotion: boolean;
  soundEnabled: boolean;
  takeawayOpen: boolean;
  savedIds: ReadonlySet<string>;
  addingHabitId: string | null;
  existingHabitNames: ReadonlySet<string>;
  kineticOverrideIds: ReadonlySet<string>;
  total: number;
  onToggleSave: (itemId: string) => void;
  onToggleKinetic: (itemId: string) => void;
  onExecuteCta: (item: FocusFeedItem) => void;
  onOpenTakeaways: (item: FocusFeedItem) => void;
  onGo: (delta: -1 | 1) => void;
  onToggleSound: () => void;
  onLaunchSmallFocus?: () => void;
  onBackToToday?: () => void;
};

export type FocusFlowPageProps = {
  entry: Extract<FocusFeedEntry, { entryKind: 'item' | 'checkpoint' }>;
  index: number;
  isActive: boolean;
  ctx: FocusFlowPageContext;
};

function NativeYoutubeEmbed({ videoId, muted, bgColor }: { videoId: string; muted: boolean; bgColor: string }) {
  const uri = `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=${muted ? 1 : 0}&playsinline=1&rel=0&modestbranding=1&controls=1&loop=1&playlist=${videoId}`;

  if (Platform.OS === 'web') {
    return React.createElement('iframe', {
      src: uri,
      title: 'Aderyth Odak Akışı Video',
      allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
      allowFullScreen: true,
      style: { width: '100%', height: '100%', border: 'none', borderRadius: '18px', backgroundColor: bgColor },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { WebView } = require('react-native-webview');
  return (
    <WebView
      source={{ uri }}
      style={{ flex: 1, backgroundColor: bgColor }}
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction={false}
      javaScriptEnabled
    />
  );
}

function useBreathLoop(active: boolean): Animated.Value {
  const breathAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      breathAnim.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathAnim, { toValue: 1, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(breathAnim, { toValue: 0, duration: 2800, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, breathAnim]);

  return breathAnim;
}

function isHabitCtaAlreadyAdded(item: FocusFeedItem, existingHabitNames: ReadonlySet<string>): boolean {
  if (item.cta.actionType !== 'add_atomic_habit') return false;
  const atomic = findAtomicHabitById(item.cta.atomicHabitId);
  if (!atomic) return false;
  return existingHabitNames.has(atomic.name.trim().toLocaleLowerCase('tr-TR'));
}

export const FocusFlowPage = React.memo(function FocusFlowPage({
  entry,
  index,
  isActive,
  ctx,
}: FocusFlowPageProps) {
  const c = useThemeColors();
  const p = useThemedStyles(makePageStyles);

  const [slideIdx, setSlideIdx] = useState(0);
  const [pickedOptId, setPickedOptId] = useState<string | null>(null);

  const isCheckpoint = entry.entryKind === 'checkpoint';
  const item = entry.entryKind === 'item' ? entry.item : null;
  const isKinetic = item ? item.kind === 'inflow_interactive' || ctx.kineticOverrideIds.has(item.id) : false;

  const breathActive = isActive && ctx.screenFocused && isCheckpoint && !IS_TEST && !ctx.reduceMotion;
  const breathAnim = useBreathLoop(breathActive);

  useEffect(() => {
    if (!item || !isActive || !ctx.screenFocused || ctx.takeawayOpen || !isKinetic) return;
    const slides = item.kineticSlides;
    if (!slides || slides.length <= 1) return;
    const curSlide = slides[slideIdx] ?? slides[0];
    const timer = setTimeout(() => {
      setSlideIdx((prev) => (prev + 1) % slides.length);
    }, curSlide.durationMs);
    return () => clearTimeout(timer);
  }, [item, isActive, ctx.screenFocused, ctx.takeawayOpen, isKinetic, slideIdx]);

  useEffect(() => {
    if (!item || !isActive || !ctx.screenFocused || !ctx.soundEnabled || !isKinetic) return;
    const curSlide = item.kineticSlides[slideIdx];
    if (!curSlide) return;
    try {
      Speech.stop();
      Speech.speak(`${curSlide.text}. ${curSlide.highlight}`, { language: 'tr-TR', rate: 1.04 });
    } catch {
      // Ignore TTS errors in unsupported browsers
    }
    return () => { Speech.stop(); };
  }, [item, isActive, ctx.screenFocused, ctx.soundEnabled, isKinetic, slideIdx]);

  if (entry.entryKind === 'checkpoint') {
    return (
      <View style={[p.pageContainer, { height: ctx.pageHeight }]}>
        <View style={p.checkpointCard}>
          <View
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
            {...(Platform.OS === 'web'
              ? { 'aria-hidden': true }
              : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
          >
            <Image source={FLOW_CHECKPOINT_ZEN} style={StyleSheet.absoluteFill} contentFit="cover" cachePolicy="memory-disk" />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(c.bgSunk, 0.58) }]} />
            <Animated.View
              style={[
                p.zenBreathRing,
                breathActive
                  ? {
                      opacity: breathAnim.interpolate({ inputRange: [0, 1], outputRange: [0.22, 0.54] }),
                      transform: [{ scale: breathAnim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.08] }) }],
                    }
                  : { opacity: 0.28 },
              ]}
            />
          </View>
          <EmbeddedFiligree source={DECOR.cornerBotanical} anchor="bottom-right" size={140} opacity={0.18} />
          <View style={p.checkpointBadge}>
            <Ionicons name="leaf" size={14} color={c.success} />
            <Text style={p.checkpointBadgeText}>INFLOW 5 DAKİKA KURALI · BİLİNÇLİ DURAĞI</Text>
          </View>

          <Text style={p.checkpointTitle}>
            {entry.watchedCount} odak içeriği izledin. Zihnin şu an harekete hazır!
          </Text>
          <Text style={p.checkpointDesc}>
            Instagram veya TikTok seni saatlerce ekranda tutmak için tasarlanır. Aderyth ise izlediğin tekniği gerçek hayatına taşıman için burada nazik bir nefes molası verir.
          </Text>

          <View style={p.checkpointActions}>
            <TouchableOpacity
              style={p.checkpointPrimaryBtn}
              onPress={() => ctx.onLaunchSmallFocus?.()}
              accessibilityRole="button"
              accessibilityLabel="5 Dakikalık Odak Sayacını Başlat"
            >
              <Ionicons name="flash" size={18} color={c.white} />
              <Text style={p.checkpointPrimaryText}>Şimdi 5 Dk Küçük Başla (Odağa Geç)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={p.checkpointSecondaryBtn}
              onPress={() => ctx.onBackToToday?.()}
              accessibilityRole="button"
              accessibilityLabel="Bugün ekranına dön"
            >
              <Ionicons name="checkmark-done-circle-outline" size={18} color={c.text} />
              <Text style={p.checkpointSecondaryText}>Bugün Planıma Dön ve Uygula</Text>
            </TouchableOpacity>

            {index + 1 < ctx.total && (
              <TouchableOpacity
                style={p.checkpointGhostBtn}
                onPress={() => ctx.onGo(1)}
                accessibilityRole="button"
                accessibilityLabel="Akışta izlemeye devam et"
              >
                <Text style={p.checkpointGhostText}>Akışta Kalmaya Devam Et ↓</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    );
  }

  const feedItem = entry.item;
  const isSaved = ctx.savedIds.has(feedItem.id);
  const curSlide = feedItem.kineticSlides[slideIdx] ?? feedItem.kineticSlides[0];
  const pickedOption = feedItem.interactivePrompt?.options.find((o) => o.id === pickedOptId);
  const alreadyAdded = isHabitCtaAlreadyAdded(feedItem, ctx.existingHabitNames);
  const isAddingThis = feedItem.cta.atomicHabitId != null && ctx.addingHabitId === feedItem.cta.atomicHabitId;

  return (
    <View style={[p.pageContainer, { height: ctx.pageHeight }]}>
      <View style={[p.reelCard, { borderColor: hexA(feedItem.accentColor, 0.32) }]}>
        <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="bottom-right" size={142} opacity={0.14} />
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          {...(Platform.OS === 'web'
            ? { 'aria-hidden': true }
            : { accessibilityElementsHidden: true, importantForAccessibility: 'no-hide-descendants' as const })}
        >
          <Image
            source={FLOW_CBT_BACKDROPS[feedItem.id] ?? TEXTURES.neural}
            style={[StyleSheet.absoluteFill, { opacity: FLOW_CBT_BACKDROPS[feedItem.id] ? 0.85 : 0.08 }]}
            contentFit="cover"
            cachePolicy="memory-disk"
          />
          {FLOW_CBT_BACKDROPS[feedItem.id] ? (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: hexA(c.bgSunk, 0.62) }]} />
          ) : null}
        </View>
        <View style={[p.ambientGlow, { backgroundColor: hexA(feedItem.accentColor, 0.13) }]} />

        <View style={p.reelTopMeta}>
          <View style={[p.kindBadge, { backgroundColor: hexA(feedItem.accentColor, 0.2), borderColor: hexA(feedItem.accentColor, 0.45) }]}>
            <Ionicons name={feedItem.icon as any} size={12} color={feedItem.accentColor} />
            <Text style={[p.kindBadgeText, { color: feedItem.accentColor }]}>{feedItem.badge}</Text>
          </View>

          <View style={p.metaRightGroup}>
            <View style={p.langBadge}>
              <Text style={p.langBadgeText}>{feedItem.languageBadge} · {feedItem.durationSec} sn</Text>
            </View>

            {feedItem.kind === 'video' && (
              <TouchableOpacity
                style={[p.modeToggleChip, isKinetic && { backgroundColor: hexA(feedItem.accentColor, 0.28), borderColor: feedItem.accentColor }]}
                onPress={() => ctx.onToggleKinetic(feedItem.id)}
                accessibilityRole="button"
                accessibilityLabel={isKinetic ? 'Videoya geç' : 'Türkçe kinetik özete geç'}
              >
                <Ionicons name={isKinetic ? 'videocam' : 'reader'} size={12} color={c.white} />
                <Text style={p.modeToggleText}>{isKinetic ? 'Video' : 'TR Kart'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <View style={p.stageAndRailRow}>
          <View style={p.mainStage}>
            <Text style={p.hookTitle} numberOfLines={2}>{feedItem.hookTitle}</Text>
            <Text style={p.creatorLine} numberOfLines={1}>{feedItem.creatorOrSource} — {feedItem.subtitle}</Text>

            {feedItem.kind === 'video' && !isKinetic && feedItem.videoSource ? (
              <View style={p.videoStageBox}>
                {isActive && ctx.screenFocused ? (
                  <NativeYoutubeEmbed
                    key={`${feedItem.id}:${ctx.screenFocused}`}
                    videoId={feedItem.videoSource.videoId}
                    muted={!ctx.soundEnabled}
                    bgColor={c.bgSunk}
                  />
                ) : (
                  <View style={p.videoPlaceholder}>
                    <Ionicons name="play-circle" size={48} color={feedItem.accentColor} />
                    <Text style={p.videoPlaceholderText}>Oynatmak için kaydır</Text>
                  </View>
                )}
              </View>
            ) : (
              <View style={p.kineticStageBox}>
                <View style={p.storySegmentsRow}>
                  {feedItem.kineticSlides.map((_, sIdx) => {
                    const doneOrCurrent = sIdx <= slideIdx;
                    return (
                      <TouchableOpacity
                        key={sIdx}
                        style={p.storySegmentHit}
                        onPress={() => { haptic.select(); setSlideIdx(sIdx); }}
                      >
                        <View style={[p.storySegmentBar, doneOrCurrent && { backgroundColor: feedItem.accentColor }]} />
                      </TouchableOpacity>
                    );
                  })}
                </View>

                {curSlide && (
                  <TouchableOpacity
                    activeOpacity={0.9}
                    style={p.kineticSlideCard}
                    onPress={() => {
                      haptic.light();
                      setSlideIdx((prev) => (prev + 1) % feedItem.kineticSlides.length);
                    }}
                  >
                    <Text style={[p.slideEyebrow, { color: feedItem.accentColor }]}>{curSlide.eyebrow}</Text>
                    <EmbeddedFiligree source={DECOR.cornerAstrolabe} anchor="top-right" size={96} opacity={0.11} />
                    <Text style={p.slideMainText}>{curSlide.text}</Text>
                    <View style={[p.slideHighlightBox, { backgroundColor: hexA(feedItem.accentColor, 0.14), borderLeftColor: feedItem.accentColor }]}>
                      <Text style={p.slideHighlightText}>{curSlide.highlight}</Text>
                    </View>
                    <Text style={p.tapNextHint}>
                      Sonraki slayt için karta dokun ({slideIdx + 1}/{feedItem.kineticSlides.length})
                    </Text>
                  </TouchableOpacity>
                )}

                {feedItem.interactivePrompt && (
                  <View style={p.promptBox}>
                    <Text style={p.promptQuestion}>💬 {feedItem.interactivePrompt.question}</Text>
                    <View style={p.promptOptionsCol}>
                      {feedItem.interactivePrompt.options.map((opt) => {
                        const selected = pickedOptId === opt.id;
                        return (
                          <TouchableOpacity
                            key={opt.id}
                            style={[p.promptOptBtn, selected && { borderColor: feedItem.accentColor, backgroundColor: hexA(feedItem.accentColor, 0.2) }]}
                            onPress={() => { haptic.select(); setPickedOptId(opt.id); }}
                            accessibilityRole="button"
                            accessibilityLabel={opt.label}
                          >
                            <Text style={p.promptOptEmoji}>{opt.emoji}</Text>
                            <Text style={[p.promptOptLabel, selected && { color: c.white, fontWeight: '600' }]} numberOfLines={2}>
                              {opt.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {pickedOption && (
                      <View style={[p.coachingReplyBox, { borderColor: hexA(feedItem.accentColor, 0.5) }]}>
                        <Ionicons name="sparkles" size={14} color={feedItem.accentColor} />
                        <Text style={p.coachingReplyText}>{pickedOption.coachingReply}</Text>
                      </View>
                    )}
                  </View>
                )}
              </View>
            )}
          </View>

          <View style={p.rightActionRail}>
            <TouchableOpacity
              style={p.railBtn}
              onPress={() => ctx.onToggleSave(feedItem.id)}
              accessibilityRole="button"
              accessibilityLabel={isSaved ? 'Kaydı kaldır' : 'Kaydet'}
            >
              <View style={[p.railIconCircle, isSaved && { backgroundColor: hexA(c.success, 0.25), borderColor: c.success }]}>
                <Ionicons name={isSaved ? 'bookmark' : 'bookmark-outline'} size={19} color={isSaved ? c.success : c.white} />
              </View>
              <Text style={p.railBtnLabel}>{isSaved ? 'Kaydedildi' : 'Kaydet'}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={p.railBtn}
              onPress={() => ctx.onOpenTakeaways(feedItem)}
              accessibilityRole="button"
              accessibilityLabel="3 saniyelik özeti aç"
            >
              <View style={p.railIconCircle}>
                <Ionicons name="list-outline" size={19} color={c.white} />
              </View>
              <Text style={p.railBtnLabel}>3 Sn Özet</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={p.railBtn}
              onPress={ctx.onToggleSound}
              accessibilityRole="button"
              accessibilityLabel={ctx.soundEnabled ? 'Sesi kapat' : 'Sesli anlatımı aç'}
            >
              <View style={[p.railIconCircle, ctx.soundEnabled && { backgroundColor: hexA(feedItem.accentColor, 0.28), borderColor: feedItem.accentColor }]}>
                <Ionicons name={ctx.soundEnabled ? 'volume-high' : 'volume-mute'} size={19} color={ctx.soundEnabled ? feedItem.accentColor : c.white} />
              </View>
              <Text style={p.railBtnLabel}>{ctx.soundEnabled ? 'Ses Açık' : 'Ses Kapalı'}</Text>
            </TouchableOpacity>

            <View style={p.railNavGroup}>
              <TouchableOpacity
                style={[p.railMiniNavBtn, index === 0 && { opacity: 0.35 }]}
                disabled={index === 0}
                onPress={() => ctx.onGo(-1)}
                accessibilityRole="button"
                accessibilityLabel="Önceki akış içeriği"
              >
                <Ionicons name="chevron-up" size={18} color={c.white} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[p.railMiniNavBtn, index === ctx.total - 1 && { opacity: 0.35 }]}
                disabled={index === ctx.total - 1}
                onPress={() => ctx.onGo(1)}
                accessibilityRole="button"
                accessibilityLabel="Sonraki akış içeriği"
              >
                <Ionicons name="chevron-down" size={18} color={c.white} />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        <View style={p.bottomBridgeRow}>
          <TouchableOpacity
            style={[
              p.ctaBridgeBtn,
              {
                backgroundColor: alreadyAdded ? hexA(c.success, 0.22) : feedItem.accentColor,
                borderColor: alreadyAdded ? c.success : feedItem.accentColor,
              },
            ]}
            disabled={isAddingThis}
            onPress={() => ctx.onExecuteCta(feedItem)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={feedItem.cta.label}
          >
            {isAddingThis ? (
              <ActivityIndicator size="small" color={c.white} />
            ) : (
              <>
                <Ionicons
                  name={alreadyAdded ? 'checkmark-circle' : feedItem.cta.actionType === 'add_atomic_habit' ? 'add-circle' : 'flash'}
                  size={18}
                  color={alreadyAdded ? c.success : c.white}
                />
                <Text style={[p.ctaBridgeText, alreadyAdded && { color: c.success }]} numberOfLines={1}>
                  {alreadyAdded ? '✓ Alışkanlık Sisteminde Ekli' : feedItem.cta.label}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
});

const makePageStyles = (c: Palette) =>
  StyleSheet.create({
    pageContainer: { width: '100%', paddingTop: 92, paddingBottom: space.sm, paddingHorizontal: space.sm, justifyContent: 'center' },
    reelCard: { flex: 1, backgroundColor: c.bg, borderRadius: 24, borderWidth: 1, padding: space.md, overflow: 'hidden', justifyContent: 'space-between', position: 'relative' },
    ambientGlow: { position: 'absolute', top: -60, right: -40, width: 220, height: 220, borderRadius: 110 },
    reelTopMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.xs, marginBottom: space.xs },
    kindBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.full, borderWidth: 1 },
    kindBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
    metaRightGroup: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    langBadge: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: radius.full, backgroundColor: hexA(c.white, 0.07) },
    langBadgeText: { color: c.textDim, fontSize: 10, fontWeight: '500' },
    modeToggleChip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.full, backgroundColor: hexA(c.white, 0.12), borderWidth: 1, borderColor: hexA(c.white, 0.2) },
    modeToggleText: { color: c.white, fontSize: 10, fontWeight: '600' },
    stageAndRailRow: { flex: 1, flexDirection: 'row', gap: space.sm, marginVertical: 4 },
    mainStage: { flex: 1, justifyContent: 'flex-start' },
    hookTitle: { color: c.white, fontSize: 17, lineHeight: 23, fontWeight: '700', marginBottom: 3 },
    creatorLine: { color: c.textDim, fontSize: 12, marginBottom: space.sm },
    videoStageBox: { flex: 1, borderRadius: 18, overflow: 'hidden', backgroundColor: c.bgSunk, borderWidth: 1, borderColor: hexA(c.white, 0.1) },
    videoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xs },
    videoPlaceholderText: { color: c.textDim, fontSize: 12 },
    kineticStageBox: { flex: 1, justifyContent: 'space-between', gap: space.xs },
    storySegmentsRow: { flexDirection: 'row', gap: 5, marginBottom: 2 },
    storySegmentHit: { flex: 1, paddingVertical: 3 },
    storySegmentBar: { height: 3.5, borderRadius: 2, backgroundColor: hexA(c.white, 0.16) },
    zenBreathRing: { position: 'absolute', alignSelf: 'center', top: '22%', width: 220, height: 220, borderRadius: 110, borderWidth: 1.5, borderColor: hexA(c.success, 0.45), backgroundColor: hexA(c.success, 0.06) },
    kineticSlideCard: { overflow: 'hidden', position: 'relative', backgroundColor: hexA(c.white, 0.04), borderRadius: 16, padding: space.md, borderWidth: 1, borderColor: hexA(c.white, 0.08), gap: 8 },
    slideEyebrow: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
    slideMainText: { color: c.white, fontSize: 15, lineHeight: 22, fontWeight: '600' },
    slideHighlightBox: { borderLeftWidth: 3, paddingLeft: 10, paddingVertical: 6, paddingRight: 8, borderRadius: 8 },
    slideHighlightText: { color: c.text, fontSize: 13, lineHeight: 19, fontWeight: '500' },
    tapNextHint: { color: c.textFaint, fontSize: 10, textAlign: 'right' },
    promptBox: { backgroundColor: hexA(c.black, 0.28), borderRadius: 14, padding: 10, borderWidth: 1, borderColor: hexA(c.white, 0.07), gap: 6 },
    promptQuestion: { color: c.text, fontSize: 12, fontWeight: '600' },
    promptOptionsCol: { gap: 5 },
    promptOptBtn: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: hexA(c.white, 0.05), borderWidth: 1, borderColor: hexA(c.white, 0.09) },
    promptOptEmoji: { fontSize: 13 },
    promptOptLabel: { flex: 1, color: c.textDim, fontSize: 11.5, lineHeight: 15 },
    coachingReplyBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: hexA(c.white, 0.06), borderRadius: 10, padding: 8, borderWidth: 1, marginTop: 2 },
    coachingReplyText: { flex: 1, color: c.white, fontSize: 11.5, lineHeight: 16 },
    rightActionRail: { width: 54, alignItems: 'center', justifyContent: 'flex-end', gap: 10, paddingBottom: 4 },
    railBtn: { alignItems: 'center', gap: 3 },
    railIconCircle: { width: 40, height: 40, borderRadius: 20, backgroundColor: hexA(c.white, 0.09), borderWidth: 1, borderColor: hexA(c.white, 0.14), alignItems: 'center', justifyContent: 'center' },
    railBtnLabel: { color: c.textDim, fontSize: 9.5, fontWeight: '500', textAlign: 'center' },
    railNavGroup: { marginTop: 4, gap: 5, alignItems: 'center' },
    railMiniNavBtn: { width: 34, height: 30, borderRadius: 10, backgroundColor: hexA(c.white, 0.08), borderWidth: 1, borderColor: hexA(c.white, 0.12), alignItems: 'center', justifyContent: 'center' },
    bottomBridgeRow: { paddingTop: 6 },
    ctaBridgeBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: space.md, borderRadius: 14, borderWidth: 1 },
    ctaBridgeText: { color: c.white, fontSize: 13.5, fontWeight: '700' },
    checkpointCard: { flex: 1, backgroundColor: c.surfaceAlt, borderRadius: 24, borderWidth: 1, borderColor: hexA(c.success, 0.35), padding: space.lg, justifyContent: 'center', gap: space.md },
    checkpointBadge: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.full, backgroundColor: hexA(c.success, 0.14), borderWidth: 1, borderColor: hexA(c.success, 0.35) },
    checkpointBadgeText: { color: c.success, fontSize: 10.5, fontWeight: '700', letterSpacing: 0.6 },
    checkpointTitle: { color: c.white, fontSize: 22, lineHeight: 29, fontWeight: '700' },
    checkpointDesc: { color: c.textDim, fontSize: 14, lineHeight: 21 },
    checkpointActions: { gap: 10, marginTop: space.xs },
    checkpointPrimaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: c.success, paddingVertical: 14, borderRadius: 14 },
    checkpointPrimaryText: { color: c.white, fontSize: 14, fontWeight: '700' },
    checkpointSecondaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: hexA(c.white, 0.08), borderWidth: 1, borderColor: hexA(c.white, 0.14), paddingVertical: 13, borderRadius: 14 },
    checkpointSecondaryText: { color: c.white, fontSize: 13.5, fontWeight: '600' },
    checkpointGhostBtn: { alignItems: 'center', paddingVertical: 8 },
    checkpointGhostText: { color: c.textDim, fontSize: 12.5, fontWeight: '500' },
  });
