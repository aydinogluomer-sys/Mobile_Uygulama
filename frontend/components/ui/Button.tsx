import { Text, TouchableOpacity, ActivityIndicator, ViewStyle, StyleProp, type AccessibilityProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, hexA, shadow, onColor } from '../../lib/tokens';
import { useAccent } from '../../lib/useAccent';

type Variant = 'primary' | 'tonal' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

/**
 * `AccessibilityProps` ile genişletilmesinin sebebi: prop tipi kapalıyken
 * çağıran taraf `accessibilityLabel`/`accessibilityHint` geçemiyordu, dolayısıyla
 * ekran bazlı erişilebilirlik çalışması bu butona hiç ulaşamıyordu. Yalnızca
 * erişilebilirlik yüzeyi açılıyor — `TouchableOpacityProps`'un tamamı değil —
 * böylece bileşenin API'si (variant/size/full) anlamlı kalıyor.
 */
type Props = AccessibilityProps & {
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

/** R06.04 — the platform minimum touch size (iOS 44pt; Android 48dp is met by md/lg). */
export const MIN_TOUCH = 44;

const SIZES: Record<Size, { h: number; px: number; fs: number; icon: number; gap: number }> = {
  sm: { h: 36, px: 14, fs: 13, icon: 15, gap: 6 },
  md: { h: 46, px: 18, fs: 15, icon: 18, gap: 8 },
  lg: { h: 54, px: 22, fs: 16, icon: 20, gap: 10 },
};

/** Tutarlı aksiyon butonu — primary/tonal/ghost/danger × sm/md/lg. */
export default function Button({
  label, onPress, variant = 'primary', size = 'md', icon,
  loading, disabled, color, full, style, ...a11y
}: Props) {
  const sz = SIZES[size];
  const accentTheme = useAccent();
  const accent = color ?? accentTheme.primary;

  let bg: string = 'transparent';
  let fg: string = colors.white;
  let border: string = 'transparent';
  let glow: ViewStyle | null = null;

  // R06.04 — the label colour is chosen for contrast on the fill (onColor).
  if (variant === 'primary') { bg = accentTheme.primary; fg = onColor(accentTheme.primary); glow = shadow.glow(accentTheme.primary); }
  else if (variant === 'danger') { bg = colors.error; fg = onColor(colors.error); }
  else if (variant === 'tonal' || variant === 'secondary') { bg = hexA(accent, 0.14); fg = accent; border = hexA(accent, 0.28); }
  else if (variant === 'ghost') { bg = 'transparent'; fg = accent; border = colors.border; }

  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={isDisabled}
      // Varsayılanlar ÖNCE gelir, `...a11y` sonra: çağıranın verdiği rol/etiket
      // her zaman kazanır. Etiketin varsayılan olması ayrıca `loading`
      // durumunda buton metninin yerini ActivityIndicator alınca butonun
      // tamamen sessizleşmesini önler.
      accessibilityRole="button"
      accessibilityLabel={label}
      {...a11y}
      // Sahip olunan durum her koşulda duyurulur; çağıran ek anahtar
      // (örn. `selected`) ekleyebilir ve çakışan anahtarda üstün gelir.
      accessibilityState={{ disabled: !!isDisabled, busy: !!loading, ...a11y.accessibilityState }}
      // R06.04 — at least 44pt to touch, whatever the visual size.
      hitSlop={sz.h < MIN_TOUCH ? { top: (MIN_TOUCH - sz.h) / 2, bottom: (MIN_TOUCH - sz.h) / 2, left: 0, right: 0 } : undefined}
      style={[
        {
          // R06.04 — minHeight, not height: large system text grows the button instead of clipping it.
          minHeight: sz.h,
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
