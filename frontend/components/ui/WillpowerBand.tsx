import { View, Text, StyleProp, ViewStyle, TouchableOpacity, type AccessibilityProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { space, font, type Palette } from '../../lib/tokens';
import { useThemeColors } from '../../hooks/useThemeColors';
import { TEXTURES } from '../../lib/visualAssets';
import ProgressBar from './ProgressBar';
import TexturedSurface from './TexturedSurface';

type WP = {
  used: number;
  daily_budget: number;
  focus_capacity: number;
  active_count: number;
};

type Props = AccessibilityProps & {
  wp: WP;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
};

function wpColor(ratio: number, c: Palette) {
  if (ratio < 0.5) return c.success;
  if (ratio < 0.8) return c.warning;
  return c.error;
}

/**
 * İrade bandı — today + timeline paylaşır. Kullanım oranına göre renk.
 */
export default function WillpowerBand({ wp, onPress, style, ...a11y }: Props) {
  const c = useThemeColors();
  const ratio = wp.daily_budget > 0 ? wp.used / wp.daily_budget : 0;
  const col = wpColor(ratio, c);
  const Wrapper: any = onPress ? TouchableOpacity : View;

  return (
    <Wrapper
      activeOpacity={0.8}
      onPress={onPress}
      accessible
      accessibilityRole={onPress ? 'button' : 'progressbar'}
      accessibilityLabel={
        `İrade: ${wp.daily_budget} birimin ${wp.used} tanesi kullanıldı. ` +
        `${wp.focus_capacity} odak kapasitesinin ${wp.active_count} tanesi aktif.`
      }
      accessibilityValue={{ min: 0, max: wp.daily_budget, now: wp.used }}
      {...a11y}
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.md, position: 'relative', overflow: 'hidden' }, style]}
    >
      <TexturedSurface source={TEXTURES.topographic} textureOpacity={0.05} overlayOnly />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 56 }}>
        <Ionicons name="flash" size={14} color={col} />
        <Text style={{ ...font.bodySm, color: col, fontWeight: '700' }}>
          {wp.used}/{wp.daily_budget}
        </Text>
      </View>
      <ProgressBar progress={ratio} color={col} height={5} style={{ flex: 1 }} />
      <Text style={{ ...font.caption, color: c.textFaint, minWidth: 58, textAlign: 'right' }}>
        {wp.active_count}/{wp.focus_capacity} aktif
      </Text>
    </Wrapper>
  );
}
