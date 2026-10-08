import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, space } from '../../lib/tokens';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';

type Props = TextInputProps & {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  rightElement?: ReactNode;
  containerStyle?: ViewStyle;
  /**
   * Field-level error. Renders an icon and the text as well as the colour —
   * a red line on its own is not a message, and is invisible to a colour-blind
   * user and to a screen reader alike.
   */
  error?: string;
};

/**
 * The auth text field.
 *
 * ## What this used to look like, and why it was wrong
 *
 * A 62px-tall rounded rectangle: `backgroundColor: colors.surface`,
 * `borderWidth: 1` on all four sides, `borderRadius`, and on focus a primary
 * border PLUS a tinted background PLUS a coloured shadow. Three simultaneous
 * changes to announce one thing. The label carried its own
 * `backgroundColor: colors.surface` so it could punch a notch through the top
 * border — a detail that only exists because the border exists.
 *
 * The result read as a generic web form dropped into a warm editorial app,
 * and it was the first thing anyone saw.
 *
 * ## What replaced it
 *
 * A single baseline. Idle it is a hairline in `colors.border`; focused it is
 * the accent. Nothing else moves.
 *
 * ## Why the focus line is an overlay, not a thicker border
 *
 * Animating `borderBottomWidth` from 1 to 2 reflows the field by a pixel on
 * every focus and blur, and a row of fields visibly twitches as the user tabs
 * through. The accent line is absolutely positioned over the hairline and
 * fades in, so the layout is identical in all three states.
 *
 * Removing the browser outline (`outlineWidth: 0`) is only defensible because
 * this replaces it: the accent baseline IS the focus indicator on web, not
 * merely a decoration on top of a removed one.
 */
export default function FloatingLabelInput({
  label,
  icon,
  rightElement,
  containerStyle,
  error,
  value,
  onFocus,
  onBlur,
  style,
  ...props
}: Props) {
  const [focused, setFocused] = useState(false);
  const fill = useRef(new Animated.Value(value ? 1 : 0)).current;
  const focusLine = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    Animated.timing(fill, {
      toValue: focused || !!value ? 1 : 0,
      duration: reduceMotion ? 0 : 160, // R06.04
      useNativeDriver: false,
    }).start();
  }, [fill, focused, value, reduceMotion]);

  useEffect(() => {
    Animated.timing(focusLine, {
      toValue: focused ? 1 : 0,
      duration: reduceMotion ? 0 : 140, // R06.04
      useNativeDriver: false,
    }).start();
  }, [focusLine, focused, reduceMotion]);

  const top = fill.interpolate({ inputRange: [0, 1], outputRange: [18, 0] });
  const fontSize = fill.interpolate({ inputRange: [0, 1], outputRange: [15, 11] });

  const labelColor = error ? colors.error : focused ? colors.primary : colors.textFaint;
  const lineColor = error ? colors.error : colors.primary;

  return (
    <View style={containerStyle}>
      <View style={s.row}>
        {icon ? (
          <Ionicons
            name={icon}
            size={18}
            color={error ? colors.error : focused ? colors.primary : colors.textFaint}
          />
        ) : null}

        <View style={s.inputSlot}>
          <Animated.Text style={[s.label, { top, fontSize, color: labelColor }]}>
            {label}
          </Animated.Text>
          <TextInput
            {...props}
            value={value}
            placeholder=""
            placeholderTextColor="transparent"
            // The floating label is a sibling `Animated.Text`, so the input
            // itself carries no accessible name unless one is given. A caller
            // that passes an explicit label still wins.
            accessibilityLabel={props.accessibilityLabel ?? label}
            // Announced rather than only drawn: a screen reader user gets the
            // same information the red line gives a sighted one.
            accessibilityState={{ ...props.accessibilityState, ...(error ? { invalid: true } : {}) }}
            style={[s.input, style]}
            onFocus={(event) => {
              setFocused(true);
              onFocus?.(event);
            }}
            onBlur={(event) => {
              setFocused(false);
              onBlur?.(event);
            }}
          />
        </View>

        {rightElement}
      </View>

      {/* The baseline. Two stacked 1px lines, never resized. */}
      <View style={s.lineTrack}>
        <Animated.View
          style={[
            s.lineFocus,
            { backgroundColor: lineColor, opacity: error ? 1 : focusLine },
          ]}
        />
      </View>

      {!!error && (
        <View style={s.errorRow}>
          <Ionicons name="alert-circle" size={13} color={colors.error} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.md,
    paddingBottom: space.sm,
    // No background, no border, no radius. The field is the text and the line
    // beneath it.
  },
  inputSlot: {
    flex: 1,
    minHeight: 44,
    justifyContent: 'flex-end',
    position: 'relative',
    paddingTop: 18,
  },
  label: {
    position: 'absolute',
    left: 0,
    fontWeight: '500',
    lineHeight: 16,
    // Deliberately no backgroundColor: the notch it used to punch through the
    // top border has nothing left to punch through.
  },
  input: {
    color: colors.text,
    fontSize: 16,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    // Replaced by the accent baseline below, not simply removed.
    outlineWidth: 0 as never,
    outlineStyle: 'none' as never,
    boxShadow: 'none' as never,
  },
  lineTrack: {
    height: 1,
    backgroundColor: colors.border,
    // `overflow: visible` is the default; the focus line sits exactly on top.
  },
  lineFocus: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: 1,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 6,
  },
  errorText: {
    ...font.caption,
    color: colors.error,
    flex: 1,
    lineHeight: 17,
  },
});
