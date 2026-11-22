import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { DAY_CLOSE_COPY } from '../../lib/dayClose';
import { MOODS } from '../../lib/journalMoods';
import { font, radius, space, type Palette } from '../../lib/tokens';
import { Chip } from '../ui';

export type DayCloseMoodProps = {
  value: number | null;
  onChoose: (value: 1 | 2 | 3 | 4 | 5) => void;
};

function toMoodValue(raw: number): 1 | 2 | 3 | 4 | 5 | null {
  if (raw === 1 || raw === 2 || raw === 3 || raw === 4 || raw === 5) return raw;
  return null;
}

export default function DayCloseMood({ value, onChoose }: DayCloseMoodProps): React.JSX.Element {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);

  return (
    <View
      style={s.wrap}
      accessibilityRole="radiogroup"
      accessibilityLabel={DAY_CLOSE_COPY.moodPrompt}
    >
      <Text style={s.prompt}>{DAY_CLOSE_COPY.moodPrompt}</Text>
      <View style={s.row}>
        {MOODS.map((m) => {
          const moodValue = toMoodValue(m.value);
          if (moodValue === null) return null;
          const selected = value === moodValue;
          return (
            <Chip
              key={moodValue}
              label={`${m.emoji} ${m.label}`}
              color={selected ? c.accent : c.textDim}
              selected={selected}
              onPress={() => onChoose(moodValue)}
              accessibilityRole="radio"
              accessibilityLabel={m.label}
              accessibilityState={{ selected }}
              style={s.chip}
            />
          );
        })}
      </View>
    </View>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    wrap: {
      gap: space.xs,
      marginBottom: space.md,
    },
    prompt: {
      ...font.caption,
      color: c.textDim,
      fontWeight: '600',
    },
    row: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.xs,
    },
    chip: {
      minHeight: 44,
      minWidth: 44,
      justifyContent: 'center',
      borderRadius: radius.md,
    },
  });
