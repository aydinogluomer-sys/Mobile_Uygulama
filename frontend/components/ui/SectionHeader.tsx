import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, font, tabularNums } from '../../lib/tokens';

type Props = {
  title: string;
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  count?: number;
  /** Sağ aksiyon (örn. "Tümü →") */
  actionLabel?: string;
  onAction?: () => void;
  /** overline (küçük, uppercase) · title (sans) · serif (editöryel başlık) */
  variant?: 'overline' | 'title' | 'serif';
  style?: any;
};

/** Bölüm başlığı — overline/serif başlık + opsiyonel count/aksiyon. */
export default function SectionHeader({
  title, icon, iconColor = colors.textFaint, count, actionLabel, onAction, variant = 'title', style,
}: Props) {
  const titleStyle = variant === 'overline'
    ? { ...font.overline, color: colors.textFaint }
    : variant === 'serif'
      ? { ...font.title, fontSize: 19, color: colors.text }
      : { ...font.h3, color: colors.text };

  return (
    <View style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginBottom: space.md }, style]}>
      {icon && <Ionicons name={icon} size={18} color={iconColor} />}
      <Text style={[titleStyle, { flex: 1 }]}>{title}</Text>
      {typeof count === 'number' && (
        <Text style={{ ...tabularNums, fontSize: 13, color: colors.textFaint }}>{count}</Text>
      )}
      {actionLabel && (
        <TouchableOpacity onPress={onAction} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <Text style={{ fontSize: 12, color: colors.primaryBright, fontWeight: '600' }}>{actionLabel}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}
