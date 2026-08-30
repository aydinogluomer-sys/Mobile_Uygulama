import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { colors, radius, space, font } from '../lib/tokens';
import { useAccent } from '../lib/useAccent';

export type Segment<T extends string> = { key: T; label: string };

/**
 * The switcher the three hub tabs (Plan, İçgörüler, Profil) use to pick which
 * surface they are showing.
 *
 * The target information architecture puts five destinations in the tab bar,
 * but the app has considerably more than five screens. Rather than deleting
 * screens to fit — or nesting a second tab bar — each hub picks between the
 * screens it owns with this, and every one of those screens stays reachable
 * at its original deep route.
 */
export default function SegmentedTabs<T extends string>({
  segments,
  value,
  onChange,
}: {
  segments: readonly Segment<T>[];
  value: T;
  onChange: (key: T) => void;
}) {
  const accent = useAccent();
  return (
    <View style={s.wrap}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.row}
      >
        {segments.map((seg) => {
          const active = seg.key === value;
          return (
            <TouchableOpacity
              key={seg.key}
              onPress={() => onChange(seg.key)}
              style={[s.pill, active && { backgroundColor: accent.bright }]}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={seg.label}
            >
              <Text style={[s.label, active && s.labelActive]} numberOfLines={1}>
                {seg.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: colors.bgElevated,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  row: { flexDirection: 'row', gap: 6, paddingHorizontal: space.md, paddingVertical: space.sm },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  label: { ...font.bodySm, fontWeight: '600' as const, color: colors.textDim },
  labelActive: { color: colors.bg },
});
