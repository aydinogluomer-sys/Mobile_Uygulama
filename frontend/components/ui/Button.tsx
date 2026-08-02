import { Text, TouchableOpacity, ActivityIndicator, ViewStyle, StyleProp, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, space, hexA, shadow } from '../../lib/tokens';
import { useAccent } from '../../lib/useAccent';

type Variant = 'primary' | 'tonal' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  disabled?: boolean;
  color?: string; // tonal/ghost için accent rengi
  full?: boolean;
  style?: StyleProp<ViewStyle>;
};

const SIZES: Record<Size, { h: number; px: number; fs: number; icon: number; gap: number }> = {
  sm: { h: 36, px: 14, fs: 13, icon: 15, gap: 6 },
  md: { h: 46, px: 18, fs: 15, icon: 18, gap: 8 },
  lg: { h: 54, px: 22, fs: 16, icon: 20, gap: 10 },
};

/** Tutarlı aksiyon butonu — primary/tonal/ghost/danger × sm/md/lg. */
export default function Button({
  label, onPress, variant = 'primary', size = 'md', icon,
  loading, disabled, color, full, style,
}: Props) {
  const sz = SIZES[size];
  const accentTheme = useAccent();
  const accent = color ?? accentTheme.primary;

  let bg: string = 'transparent';
  let fg: string = colors.white;
  let border: string = 'transparent';
  let glow: ViewStyle | null = null;

  if (variant === 'primary') { bg = accentTheme.primary; fg = colors.white; glow = shadow.glow(accentTheme.primary); }
  else if (variant === 'danger') { bg = colors.error; fg = colors.white; }
  else if (variant === 'tonal') { bg = hexA(accent, 0.14); fg = accent; border = hexA(accent, 0.28); }
  else if (variant === 'ghost') { bg = 'transparent'; fg = accent; border = colors.border; }

  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={isDisabled}
      style={[
        {
          height: sz.h,
          paddingHorizontal: sz.px,
          borderRadius: radius.md,
          backgroundColor: bg,
          borderWidth: border === 'transparent' ? 0 : 1,
          borderColor: border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: sz.gap,
          flex: full ? 1 : undefined,
          opacity: isDisabled ? 0.45 : 1,
        },
        variant === 'primary' && !isDisabled ? glow : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg} size="small" />
      ) : (
        <>
          {icon && <Ionicons name={icon} size={sz.icon} color={fg} />}
          <Text style={{ color: fg, fontSize: sz.fs, fontWeight: '700' }}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );
}
