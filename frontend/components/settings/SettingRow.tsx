import type { ComponentProps, ReactNode } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { alphaHex, font, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

export type SettingRowProps = {
  icon: string;
  label: string;
  hint?: string;
  onPress?: () => void;
  destructive?: boolean;
  disabled?: boolean;
  busy?: boolean;
  tone?: string;
  right?: ReactNode;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
};

export default function SettingRow({
  icon,
  label,
  hint,
  onPress,
  destructive = false,
  disabled = false,
  busy = false,
  tone,
  right,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: SettingRowProps) {
  const c = useThemeColors();
  const styles = useThemedStyles(makeStyles);
  const iconColor = destructive ? c.error : tone ?? c.accent;

  return (
    <TouchableOpacity
      testID={testID}
      style={[styles.row, disabled && styles.rowDisabled]}
      onPress={onPress}
      disabled={disabled || !onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint ?? hint}
      accessibilityState={{ disabled: disabled || !onPress, busy }}
    >
      <View style={styles.left}>
        <View style={[styles.iconBox, { backgroundColor: alphaHex(iconColor, '20') }]}>
          <Ionicons name={icon as IoniconName} size={24} color={iconColor} />
        </View>
        <View style={styles.info}>
          <Text style={[styles.label, destructive && { color: c.error }]}>{label}</Text>
          {hint ? <Text style={styles.hint}>{hint}</Text> : null}
        </View>
      </View>
      {right !== undefined ? (
        right
      ) : busy ? (
        <ActivityIndicator size="small" color={iconColor} />
      ) : (
        <Ionicons name="chevron-forward" size={20} color={c.textFaint} />
      )}
    </TouchableOpacity>
  );
}

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: c.surface,
      borderRadius: radius.md,
      padding: space.md,
      overflow: 'hidden',
      position: 'relative',
      marginBottom: space.md,
      borderWidth: 1,
      borderColor: c.border,
      minHeight: 48,
    },
    rowDisabled: {
      opacity: 0.7,
    },
    left: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    iconBox: {
      width: 48,
      height: 48,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: space.md,
    },
    info: {
      flex: 1,
    },
    label: {
      ...font.body,
      fontWeight: '600',
      color: c.text,
      marginBottom: space.xs,
    },
    hint: {
      ...font.bodySm,
      color: c.textDim,
    },
  });
