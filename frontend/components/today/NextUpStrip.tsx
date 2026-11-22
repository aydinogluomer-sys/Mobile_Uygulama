import { memo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ExpoRouter from 'expo-router';
import { useMinuteClock } from '../../hooks/useMinuteClock';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { nextBlockChip, nextBlockInfo, type BlockTask } from '../../lib/nextBlock';
import { space, radius, font, type Palette } from '../../lib/tokens';

export type NextUpItem = {
  id: string;
  title: string;
  /** son-tarih etiketi: "gecikmiş" · "bugün" · "Cum" vb. */
  dueLabel: string;
  /** öncelik/durum noktası rengi */
  dotColor: string;
  /** gecikmiş → etiket kırmızı */
  overdue?: boolean;
};

export type NextUpStripProps = {
  items: NextUpItem[];
  onPress?: (id: string) => void;
  blockTasks?: readonly BlockTask[];
};

const useAlwaysFocused = (): boolean => true;
const useResolvedIsFocused: () => boolean =
  typeof ExpoRouter.useIsFocused === 'function' ? ExpoRouter.useIsFocused : useAlwaysFocused;

/** "Sırada" — yaklaşan görevlerin yatay sakin şeridi ve sıradaki blok geri sayımı. Boşsa hiç render edilmez. */
function NextUpStrip({ items, onPress, blockTasks }: NextUpStripProps) {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const isFocused = useResolvedIsFocused();
  const hasBlockCandidates = Boolean(blockTasks && blockTasks.length > 0);
  const now = useMinuteClock(isFocused && hasBlockCandidates);
  const nextInfo = hasBlockCandidates && blockTasks ? nextBlockInfo(blockTasks, now) : null;
  const chip = nextInfo ? nextBlockChip(nextInfo) : null;

  if (items.length === 0 && !chip) return null;

  return (
    <View style={s.wrap}>
      {chip ? (
        <View
          accessible
          accessibilityRole="text"
          accessibilityLabel={chip.a11y}
          style={s.chip}
        >
          <Ionicons
            name="time-outline"
            size={14}
            color={c.textDim}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <Text style={s.chipText}>{chip.text}</Text>
        </View>
      ) : null}

      {items.length > 0 ? (
        <>
          <Text style={s.label}>AKIŞ / SIRADA</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.strip}>
            {items.map((it, i) => (
              <View key={it.id} style={s.itemWrap}>
                {i > 0 && <Text style={s.arrow}>→</Text>}
                <TouchableOpacity
                  activeOpacity={0.8}
                  style={s.item}
                  onPress={() => onPress?.(it.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${it.title}, ${it.dueLabel}`}
                >
                  <View style={[s.dot, { backgroundColor: it.dotColor }]} />
                  <Text style={s.title} numberOfLines={1}>{it.title}</Text>
                  <Text style={[s.due, it.overdue && { color: c.error }]}>{it.dueLabel}</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        </>
      ) : null}
    </View>
  );
}

export default memo(NextUpStrip);

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: { marginTop: space.xxl, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: c.borderSubtle },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: space.xs,
      alignSelf: 'flex-start',
      minHeight: 32,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: radius.md,
      paddingVertical: space.xs,
      paddingHorizontal: space.md,
      marginBottom: space.sm,
    },
    chipText: { ...font.bodySm, color: c.textDim, flexShrink: 1 },
    label: { ...font.overline, color: c.textFaint, marginBottom: space.sm },
    strip: { gap: 0, alignItems: 'center', paddingRight: space.md },
    itemWrap: { flexDirection: 'row', alignItems: 'center' },
    arrow: { ...font.bodySm, color: c.textFaint, marginHorizontal: space.sm },
    item: {
      flexDirection: 'row', alignItems: 'center', gap: space.sm,
      backgroundColor: c.surface, borderWidth: 1, borderColor: c.border,
      borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md,
      maxWidth: 200,
    },
    dot: { width: 8, height: 8, borderRadius: radius.pill },
    title: { ...font.bodySm, color: c.text, flexShrink: 1 },
    due: { ...font.caption, color: c.textFaint },
  });
