import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import React, { type JSX } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import type { ArchiveRowModel } from '../../lib/archiveRow';
import type { Ymd } from '../../lib/date';
import { alphaHex, font, radius, space, type Palette } from '../../lib/tokens';
import { DECOR, getMoodSeal } from '../../lib/visualAssets';
import { EmbeddedFiligree } from '../spatial';

export type ArchiveRowProps = {
  row: ArchiveRowModel;
  onOpen: (date: Ymd) => void;
};

const TOUCH_MIN = space.hh + space.xs; // 44dp

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    page: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: space.md,
      minHeight: TOUCH_MIN,
      backgroundColor: c.paperSurface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: c.paperBorder,
      padding: space.md,
      marginBottom: space.sm,
      overflow: 'hidden',
      position: 'relative',
    },
    spine: {
      alignItems: 'center',
      minWidth: 38,
      borderRightWidth: 1,
      borderRightColor: c.paperBorder,
      paddingRight: space.md,
    },
    spineDay: {
      ...font.h2,
      color: c.warning,
    },
    spineDow: {
      ...font.caption,
      color: c.textFaint,
    },
    pageBody: {
      flex: 1,
      gap: space.xs,
    },
    chipRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.xs,
    },
    sourceChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      alignSelf: 'flex-start',
      backgroundColor: alphaHex(c.warning, '18'),
      borderColor: alphaHex(c.warning, '40'),
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
    },
    sourceChipText: {
      ...font.caption,
      color: c.warning,
      fontWeight: '700',
    },
    aiChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      alignSelf: 'flex-start',
      backgroundColor: alphaHex(c.accent, '18'),
      borderColor: alphaHex(c.accent, '40'),
      borderWidth: 1,
      borderRadius: radius.pill,
      paddingHorizontal: space.sm,
      paddingVertical: space.xs,
    },
    aiChipText: {
      ...font.caption,
      color: c.accent,
      fontWeight: '700',
    },
    preview: {
      ...font.bodySm,
      color: c.paperTextDim,
      lineHeight: 19,
    },
    moodSeal: {
      width: 28,
      height: 28,
    },
  });

const ArchiveRow: React.NamedExoticComponent<ArchiveRowProps> = React.memo(
  function ArchiveRow({ row, onOpen }: ArchiveRowProps): JSX.Element {
    const c = useThemeColors();
    const s = useThemedStyles(makeStyles);

    const a11yLabel =
      `${row.day} ${row.monthLabel} ${row.year} kaydı` +
      (row.moodLabel ? `, ${row.moodLabel}` : '') +
      (row.aiSummary ? ', AI özeti var' : '');

    return (
      <TouchableOpacity
        testID="archive-row"
        style={s.page}
        activeOpacity={0.8}
        onPress={() => onOpen(row.date)}
        accessibilityRole="button"
        accessibilityLabel={a11yLabel}
        accessibilityHint="Bu günün defter sayfasını açar"
      >
        <EmbeddedFiligree source={DECOR.cornerBotanical} size={84} opacity={0.12} />
        <View style={s.spine}>
          <Text style={s.spineDay}>{row.day}</Text>
          <Text style={s.spineDow}>{row.dow}</Text>
        </View>
        <View style={s.pageBody}>
          {(row.sourceLabel || row.aiSummary) && (
            <View style={s.chipRow}>
              {row.sourceLabel && (
                <View style={s.sourceChip}>
                  <Ionicons name="document-text" size={10} color={c.warning} />
                  <Text style={s.sourceChipText}>{row.sourceLabel}</Text>
                </View>
              )}
              {row.aiSummary && (
                <View style={s.aiChip}>
                  <Ionicons name="sparkles" size={10} color={c.accent} />
                  <Text style={s.aiChipText}>AI&apos;dan özetlenmiştir</Text>
                </View>
              )}
            </View>
          )}
          <Text style={s.preview} numberOfLines={3}>
            {row.preview}
          </Text>
        </View>
        {row.mood ? (
          <Image
            source={getMoodSeal(row.mood)}
            style={s.moodSeal}
            contentFit="contain"
            cachePolicy="memory-disk"
          />
        ) : null}
      </TouchableOpacity>
    );
  },
);

export default ArchiveRow;
