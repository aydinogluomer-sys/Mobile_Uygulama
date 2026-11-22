import type { JSX } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { font, onColor, radius, space, type Palette } from '../../lib/tokens';
import { useThemedStyles } from '../../hooks/useThemeColors';
import Button from '../ui/Button';
import { HABIT_HUES, hueLabel, isHabitHue } from '../../lib/habitColors';
import { haptic } from '../../lib/haptics';

export type HabitColorPickerProps = {
  value: string | null;
  onChange: (hex: string | null) => void;
  disabled?: boolean;
};

const TOUCH_MIN = space.hh + space.xs; // 44dp
const SWATCH_DOT = space.xxl + space.xs; // 28dp

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    root: {
      gap: space.md,
    },
    currentLabel: {
      ...font.caption,
      color: c.textDim,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: space.sm,
    },
    swatchBtn: {
      width: '22%',
      minWidth: TOUCH_MIN,
      minHeight: TOUCH_MIN,
      paddingVertical: space.xs,
      paddingHorizontal: space.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: c.borderSubtle,
      backgroundColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.xs,
    },
    swatchBtnSelected: {
      borderColor: c.text,
      borderWidth: 1.5,
      backgroundColor: c.surfaceAlt,
    },
    swatchCircle: {
      width: SWATCH_DOT,
      height: SWATCH_DOT,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    swatchName: {
      ...font.caption,
      color: c.text,
      textAlign: 'center',
    },
    resetBtn: {
      minWidth: TOUCH_MIN,
      minHeight: TOUCH_MIN,
    },
    disabled: {
      opacity: 0.45,
    },
  });

export default function HabitColorPicker(props: HabitColorPickerProps): JSX.Element {
  const s = useThemedStyles(makeStyles);
  const disabled = Boolean(props.disabled);
  const currentHex = props.value ? props.value.toLowerCase() : null;
  const offPalette = currentHex !== null && !isHabitHue(currentHex);

  return (
    <View style={s.root}>
      <Text style={s.currentLabel}>
        {`Seçili renk: ${offPalette ? 'Özel renk' : hueLabel(props.value)}`}
      </Text>

      <View style={s.grid} accessibilityRole="radiogroup">
        {HABIT_HUES.map((hue) => {
          const selected = currentHex !== null && hue.hex.toLowerCase() === currentHex;
          return (
            <Pressable
              key={hue.key}
              disabled={disabled}
              onPress={() => {
                if (disabled) return;
                haptic.select();
                props.onChange(hue.hex);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={selected ? `${hue.label}, seçili` : hue.label}
              style={[
                s.swatchBtn,
                selected && s.swatchBtnSelected,
                disabled && s.disabled,
              ]}
            >
              <View style={[s.swatchCircle, { backgroundColor: hue.hex }]}>
                {selected ? (
                  <Ionicons name="checkmark" size={16} color={onColor(hue.hex)} />
                ) : null}
              </View>
              <Text style={s.swatchName} numberOfLines={1}>
                {hue.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Button
        label="Varsayılan renge dön"
        variant="ghost"
        size="md"
        disabled={disabled}
        onPress={() => {
          if (disabled) return;
          haptic.select();
          props.onChange(null);
        }}
        accessibilityLabel="Varsayılan renge dön"
        style={s.resetBtn}
      />
    </View>
  );
}
