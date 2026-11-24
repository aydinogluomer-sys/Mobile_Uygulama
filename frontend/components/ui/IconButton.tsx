import type React from 'react';
import { TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { radius } from '../../lib/tokens';
import { useThemeColors } from '../../hooks/useThemeColors';

export const ICON_BUTTON_MIN = 44;

/** compact: görsel kutu glif+8 dp, hedef hitSlop ile 44 dp'ye tamamlanır. */
export function iconButtonHitSlop(box: number): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  const pad = Math.max(0, Math.ceil((ICON_BUTTON_MIN - box) / 2));
  return { top: pad, bottom: pad, left: pad, right: pad };
}

export type IconButtonProps = {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  size?: number;
  color?: string;
  hint?: string;
  disabled?: boolean;
  selected?: boolean;
  compact?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export default function IconButton({
  icon,
  label,
  onPress,
  size = 20,
  color,
  hint,
  disabled = false,
  selected,
  compact = false,
  testID,
  style,
}: IconButtonProps): React.JSX.Element {
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new Error('IconButton requires a non-empty label');
  }

  const c = useThemeColors();
  const fg = color ?? c.textDim;
  const box = compact ? size + 8 : ICON_BUTTON_MIN;
  const hitSlop = box < ICON_BUTTON_MIN ? iconButtonHitSlop(box) : undefined;
  const a11yState =
    selected === undefined
      ? { disabled: Boolean(disabled) }
      : { disabled: Boolean(disabled), selected };

  return (
    <TouchableOpacity
      testID={testID}
      activeOpacity={0.75}
      disabled={disabled}
      onPress={onPress}
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={a11yState}
      style={[
        {
          minWidth: box,
          minHeight: box,
          borderRadius: compact ? radius.sm : radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: disabled ? 0.45 : 1,
        },
        style,
      ]}
    >
      <Ionicons
        name={icon}
        size={size}
        color={fg}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </TouchableOpacity>
  );
}
