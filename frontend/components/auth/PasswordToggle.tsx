import { TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../lib/tokens';

export type PasswordToggleProps = {
  visible: boolean;
  onToggle: () => void;
  /** Defaults to 'Şifreyi göster'. */
  showLabel?: string;
  /** Defaults to 'Şifreyi gizle'. */
  hideLabel?: string;
};

/**
 * F22 (DSA-03): the show/hide password button. A 44 x 44 pt target with a role and a label
 * that follows the state, so a screen reader says what the next tap does. It holds no state
 * of its own; the screen owns `visible`.
 */
export default function PasswordToggle({
  visible,
  onToggle,
  showLabel = 'Şifreyi göster',
  hideLabel = 'Şifreyi gizle',
}: PasswordToggleProps) {
  return (
    <TouchableOpacity
      onPress={onToggle}
      style={s.target}
      accessibilityRole="button"
      accessibilityLabel={visible ? hideLabel : showLabel}
    >
      <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.textFaint} />
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  target: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
