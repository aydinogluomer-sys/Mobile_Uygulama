import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { colors, space, radius, font } from '../../lib/tokens';

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

/** "Sırada" — yaklaşan görevlerin yatay sakin şeridi. Boşsa hiç render edilmez. */
export default function NextUpStrip({ items, onPress }: { items: NextUpItem[]; onPress?: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <View style={s.wrap}>
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
              <Text style={[s.due, it.overdue && { color: colors.error }]}>{it.dueLabel}</Text>
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { marginTop: space.xxl, paddingTop: space.lg, borderTopWidth: 1, borderTopColor: colors.borderSubtle },
  label: { ...font.overline, color: colors.textFaint, marginBottom: space.sm },
  strip: { gap: 0, alignItems: 'center', paddingRight: space.md },
  itemWrap: { flexDirection: 'row', alignItems: 'center' },
  arrow: { color: colors.textGhost, fontSize: 14, marginHorizontal: space.sm },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: space.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md,
    maxWidth: 200,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  title: { ...font.bodySm, color: colors.text, flexShrink: 1 },
  due: { ...font.caption, color: colors.textFaint },
});
