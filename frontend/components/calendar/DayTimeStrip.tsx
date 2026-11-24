/**
 * F36 (PS-19) — Seçili günün saatli görev bloklarını ve "şimdi" çizgisini çizen
 * salt-okunur, akış düzenli (flow layout) sunumsal bileşen.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { layoutDayStrip, type DayBlock } from '../../lib/nextBlock';
import { font, radius, space, type Palette } from '../../lib/tokens';

export type DayTimeStripProps = {
  blocks: readonly DayBlock[];
  /** Bugün seçiliyse şimdiki an, başka gündeyse null (şimdi çizgisi çizilmez). */
  now: Date | null;
  maxBlocks?: number;
};

const STATE_LABEL: Readonly<Record<'past' | 'current' | 'upcoming', string>> = {
  past: 'bitti',
  current: 'şu an sürüyor',
  upcoming: 'yaklaşıyor',
};

function nowA11yFromLabel(label: string): string {
  const hhmm = label.replace(/^şimdi\s+/, '');
  return `Şimdi, ${hhmm}`;
}

function blockA11yLabel(block: DayBlock, state: 'past' | 'current' | 'upcoming'): string {
  const span = block.endLabel
    ? `${block.startLabel} ile ${block.endLabel} arası`
    : block.startLabel;
  return `${span}, ${block.title}, ${STATE_LABEL[state]}`;
}

export default function DayTimeStrip({
  blocks,
  now,
  maxBlocks,
}: DayTimeStripProps): React.JSX.Element | null {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);

  if (blocks.length === 0) return null;
  const strip = layoutDayStrip(blocks, now, maxBlocks);
  if (strip.items.length === 0) return null;

  return (
    <View accessibilityRole="list" style={s.root}>
      {strip.items.map((item, idx) => {
        if (item.kind === 'now') {
          return (
            <View
              key={`now-${idx}`}
              accessible
              accessibilityLabel={nowA11yFromLabel(item.label)}
              style={s.nowRow}
            >
              <View style={s.nowDot} />
              <View style={s.nowRule} />
              <Text style={s.nowText}>{item.label}</Text>
            </View>
          );
        }

        if (item.kind === 'gap') {
          return (
            <View key={`gap-${idx}`} style={[s.gapSlot, { minHeight: item.height }]}>
              <View style={s.gapRail} />
              {item.label ? <Text style={s.gapText}>{item.label}</Text> : null}
              {item.nowFraction !== null && strip.nowLabel ? (
                <View
                  accessible
                  accessibilityLabel={nowA11yFromLabel(strip.nowLabel)}
                  pointerEvents="none"
                  style={[s.nowOverlay, { top: `${Math.round(item.nowFraction * 100)}%` }]}
                >
                  <View style={s.nowDot} />
                  <View style={s.nowRule} />
                  <Text style={s.nowText}>{strip.nowLabel}</Text>
                </View>
              ) : null}
            </View>
          );
        }

        const isPast = item.state === 'past';
        const isCurrent = item.state === 'current';
        const timeText = item.block.endLabel
          ? `${item.block.startLabel}–${item.block.endLabel}`
          : item.block.startLabel;

        return (
          <View key={item.block.id} style={s.blockSlot}>
            <View
              accessible
              accessibilityLabel={blockA11yLabel(item.block, item.state)}
              style={[
                s.blockCard,
                { minHeight: item.height },
                isCurrent && { borderColor: c.accent },
              ]}
            >
              <Text style={[s.blockTime, isPast && { color: c.textFaint }]}>{timeText}</Text>
              <Text style={[s.blockTitle, isPast && { color: c.textFaint }]}>
                {item.block.title}
              </Text>
            </View>
            {item.nowFraction !== null && strip.nowLabel ? (
              <View
                accessible
                accessibilityLabel={nowA11yFromLabel(strip.nowLabel)}
                pointerEvents="none"
                style={[s.nowOverlay, { top: `${Math.round(item.nowFraction * 100)}%` }]}
              >
                <View style={s.nowDot} />
                <View style={s.nowRule} />
                <Text style={s.nowText}>{strip.nowLabel}</Text>
              </View>
            ) : null}
          </View>
        );
      })}

      {strip.hiddenCount > 0 ? (
        <Text style={s.moreText}>{`+${strip.hiddenCount} blok daha, Görevler ekranında`}</Text>
      ) : null}
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      marginBottom: space.md,
      gap: space.xs,
    },
    blockSlot: {
      position: 'relative',
    },
    blockCard: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: space.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
    },
    blockTime: {
      ...font.caption,
      color: c.textDim,
    },
    blockTitle: {
      ...font.bodySm,
      color: c.text,
      flex: 1,
    },
    gapSlot: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      paddingHorizontal: space.md,
    },
    gapRail: {
      width: 1,
      alignSelf: 'stretch',
      backgroundColor: c.border,
    },
    gapText: {
      ...font.caption,
      color: c.textFaint,
    },
    nowRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      paddingVertical: space.xs,
    },
    nowOverlay: {
      position: 'absolute',
      left: 0,
      right: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
    },
    nowDot: {
      width: 6,
      height: 6,
      borderRadius: radius.pill,
      backgroundColor: c.accent,
    },
    nowRule: {
      flex: 1,
      height: 1,
      backgroundColor: c.accent,
    },
    nowText: {
      ...font.caption,
      color: c.accent,
    },
    moreText: {
      ...font.caption,
      color: c.textFaint,
      marginTop: space.xs,
    },
  });
