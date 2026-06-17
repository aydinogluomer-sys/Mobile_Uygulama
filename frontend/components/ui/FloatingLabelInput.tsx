import { ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  StyleSheet,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, hexA, radius, space } from '../../lib/tokens';

type Props = TextInputProps & {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  rightElement?: ReactNode;
  containerStyle?: ViewStyle;
};

export default function FloatingLabelInput({
  label,
  icon,
  rightElement,
  containerStyle,
  value,
  onFocus,
  onBlur,
  style,
  ...props
}: Props) {
  const [focused, setFocused] = useState(false);
  const fill = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(fill, {
      toValue: focused || !!value ? 1 : 0,
      duration: 160,
      useNativeDriver: false,
    }).start();
  }, [fill, focused, value]);

  const top = fill.interpolate({ inputRange: [0, 1], outputRange: [20, -8] });
  const fontSize = fill.interpolate({ inputRange: [0, 1], outputRange: [15, 11] });

  return (
    <View style={[s.wrap, focused && s.wrapFocus, containerStyle]}>
      {icon ? <Ionicons name={icon} size={18} color={focused ? colors.primary : colors.textFaint} /> : null}

      <View style={s.inputSlot}>
        <Animated.Text style={[s.label, { top, fontSize, color: focused ? colors.primary : colors.textFaint }]}>
          {label}
        </Animated.Text>
        <TextInput
          {...props}
          value={value}
          placeholder=""
          placeholderTextColor="transparent"
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
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    minHeight: 62,
    overflow: 'visible',
  },
  wrapFocus: {
    borderColor: colors.primary,
    backgroundColor: hexA(colors.primary, 0.06),
    shadowColor: colors.primary,
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 0,
  },
  inputSlot: {
    flex: 1,
    minHeight: 60,
    justifyContent: 'center',
    position: 'relative',
    paddingTop: 18,
    paddingBottom: 8,
  },
  label: {
    position: 'absolute',
    left: 0,
    fontWeight: '500',
    lineHeight: 16,
    paddingHorizontal: 8,
    backgroundColor: colors.surface,
    borderRadius: 4,
    zIndex: 2,
  },
  input: {
    color: colors.text,
    fontSize: 15,
    padding: 0,
    margin: 0,
    includeFontPadding: false,
    outlineWidth: 0 as any,
    outlineStyle: 'none' as any,
    boxShadow: 'none' as any,
  },
});