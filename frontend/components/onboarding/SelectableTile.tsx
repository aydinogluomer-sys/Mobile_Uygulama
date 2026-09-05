import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, hexA, radius, space } from '../../lib/tokens';

type Props = {
  label: string;
  /** Rendered before the label — an emoji, not an icon font, so the dayparts
   *  and paces read the same on every platform. */
  emoji?: string;
  /** Second line: the volume or the explanation. */
  detail?: string;
  meta?: string;
  selected: boolean;
  onPress: () => void;
  /** True when tapping would exceed a maximum. Still announced, still
   *  visible — dimmed and refused rather than silently ignored. */
  disabled?: boolean;
  badge?: string;
  /** `checkbox` for the multi-selects, `radio` for the single ones. The two
   *  behave differently and a screen reader user has no other way to know
   *  whether picking a second one will replace the first. */
  role: 'checkbox' | 'radio';
  size?: 'chip' | 'card';
};

export default function SelectableTile({
  label, emoji, detail, meta, selected, onPress, disabled, badge, role, size = 'chip',
}: Props) {
  const isCard = size === 'card';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled && !selected}
      activeOpacity={0.85}
      accessibilityRole={role}
      accessibilityState={{ checked: selected, disabled: !!disabled && !selected }}
      accessibilityLabel={[label, detail, meta, badge].filter(Boolean).join('. ')}
      style={[
        isCard ? s.card : s.chip,
        selected && s.selected,
        disabled && !selected && s.disabled,
      ]}
    >
      <View style={s.headRow}>
        {!!emoji && <Text style={isCard ? s.emojiCard : s.emoji}>{emoji}</Text>}
        <Text style={[isCard ? s.cardLabel : s.chipLabel, selected && s.labelSelected]} numberOfLines={2}>
          {label}
        </Text>
        {selected && (
          <Ionicons
            name="checkmark-circle"
            size={isCard ? 20 : 16}
            color={colors.primary}
            // Decorative: `accessibilityState.checked` above already carries
            // the fact, and announcing it twice is noise.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        )}
      </View>

      {!!detail && <Text style={s.detail}>{detail}</Text>}
      {!!meta && <Text style={s.meta}>{meta}</Text>}
      {!!badge && (
        <View style={s.badge}>
          <Text style={s.badgeText}>{badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  chip: {
    paddingVertical: space.md,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    minHeight: 48,
    justifyContent: 'center',
  },
  card: {
    padding: space.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 4,
  },
  selected: {
    borderColor: colors.primary,
    backgroundColor: hexA(colors.primary, 0.10),
  },
  disabled: { opacity: 0.4 },

  headRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  emoji: { fontSize: 15 },
  emojiCard: { fontSize: 20 },
  chipLabel: { ...font.bodySm, color: colors.textDim, flex: 1 },
  cardLabel: { ...font.h3, color: colors.text, flex: 1 },
  labelSelected: { color: colors.text },
  detail: { ...font.bodySm, color: colors.textDim, marginTop: 2 },
  meta: { ...font.caption, color: colors.textFaint, marginTop: 2, lineHeight: 17 },

  badge: {
    alignSelf: 'flex-start',
    marginTop: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: hexA(colors.primary, 0.14),
  },
  badgeText: { ...font.overline, color: colors.primary, fontSize: 10 },
});
