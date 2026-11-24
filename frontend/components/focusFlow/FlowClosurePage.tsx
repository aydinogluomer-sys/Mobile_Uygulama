import React, { useEffect } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { FLOW_COPY } from '../../lib/flowCopy';
import type { FocusFeedItem } from '../../lib/focusFlowCatalog';
import { font, hexA, radius, space, type Palette } from '../../lib/tokens';
import { DECOR, FLOW_CHECKPOINT_ZEN } from '../../lib/visualAssets';
import EmbeddedFiligree from '../spatial/EmbeddedFiligree';
import { Button } from '../ui';

export type FlowClosurePageProps = {
  pageHeight: number;
  seenCount: number;
  action: FocusFeedItem | null;
  adding: boolean;
  onTry: (item: FocusFeedItem) => void;
  onBackToToday: () => void;
};

export default function FlowClosurePage({
  pageHeight,
  action,
  adding,
  onTry,
  onBackToToday,
}: FlowClosurePageProps): React.JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);

  useEffect(() => {
    try {
      AccessibilityInfo.announceForAccessibility?.(FLOW_COPY.flowDailyDoneTitle);
    } catch {
      // Ignore announce errors on unsupported environments
    }
  }, []);

  return (
    <View style={[s.pageWrap, { height: pageHeight }]}>
      <View style={s.card}>
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
              { backgroundColor: hexA(c.bgSunk, 0.72) },
            ]}
          />
        </View>
        <EmbeddedFiligree
          source={DECOR.cornerBotanical}
          anchor="bottom-right"
          size={140}
          opacity={0.18}
        />

        <View style={s.badge}>
          <Ionicons name="leaf" size={14} color={c.success} />
          <Text style={s.badgeText}>GÜNLÜK ODAK DOZU TAMAMLANDI</Text>
        </View>

        <Text style={s.title} accessibilityRole="header">
          {FLOW_COPY.flowDailyDoneTitle}
        </Text>

        <Text style={s.body}>{FLOW_COPY.flowDailyDoneBody}</Text>

        {action ? (
          <View style={s.actionCard}>
            <Text style={s.actionHook} numberOfLines={2}>
              {action.hookTitle}
            </Text>
          </View>
        ) : null}

        <View style={s.ctaRow}>
          {action ? (
            <Button
              label={FLOW_COPY.flowDailyTry}
              icon="add-circle"
              size="lg"
              variant="primary"
              loading={adding}
              onPress={() => onTry(action)}
              full
            />
          ) : (
            <Button
              label={FLOW_COPY.flowDailyBack}
              icon="checkmark-done-circle-outline"
              size="lg"
              variant="primary"
              onPress={onBackToToday}
              full
            />
          )}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    pageWrap: {
      width: '100%',
      paddingTop: space.hh + space.hh + space.md,
      paddingBottom: space.sm,
      paddingHorizontal: space.sm,
      justifyContent: 'center',
    },
    card: {
      flex: 1,
      overflow: 'hidden',
      position: 'relative',
      backgroundColor: c.surfaceAlt,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: hexA(c.success, 0.35),
      padding: space.xl,
      justifyContent: 'center',
      gap: space.md,
    },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: space.xs,
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
      borderRadius: radius.full,
      backgroundColor: hexA(c.success, 0.14),
      borderWidth: 1,
      borderColor: hexA(c.success, 0.35),
    },
    badgeText: {
      ...font.overline,
      color: c.success,
    },
    title: {
      ...font.title,
      color: c.white,
      fontWeight: '700',
    },
    body: {
      ...font.body,
      color: c.textDim,
    },
    actionCard: {
      backgroundColor: hexA(c.bg, 0.62),
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.border,
      padding: space.md,
    },
    actionHook: {
      ...font.bodySm,
      color: c.text,
      fontWeight: '600',
    },
    ctaRow: {
      flexDirection: 'row',
      marginTop: space.xs,
    },
  });
