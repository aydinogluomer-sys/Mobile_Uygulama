import { ReactNode, useEffect, useState } from 'react';
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
import { font, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
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

const makeStyles = (c: Palette) =>
  StyleSheet.create({
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
      color: c.text,
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
      backgroundColor: c.border,
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
      color: c.error,
      flex: 1,
      lineHeight: 17,
    },
  });

/**
 * The auth text field.
 *
 * A single baseline. Idle it is a hairline in `c.border`; focused it is
 * the accent. Nothing else moves.
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
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const [focused, setFocused] = useState(false);
  const [fill] = useState(() => new Animated.Value(value ? 1 : 0));
  const [focusLine] = useState(() => new Animated.Value(0));
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

  const labelColor = error ? c.error : focused ? c.primary : c.textFaint;
  const lineColor = error ? c.error : c.primary;

  return (
    <View style={containerStyle}>
      <View style={s.row}>
        {icon ? (
          <Ionicons
            name={icon}
            size={18}
            color={error ? c.error : focused ? c.primary : c.textFaint}
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
          <Ionicons name="alert-circle" size={13} color={c.error} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      )}
    </View>
  );
}
