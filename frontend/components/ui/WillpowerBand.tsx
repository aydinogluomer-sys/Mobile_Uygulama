import { View, Text, StyleProp, ViewStyle, TouchableOpacity, type AccessibilityProps } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, space, font } from '../../lib/tokens';
import ProgressBar from './ProgressBar';

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

function wpColor(ratio: number) {
  if (ratio < 0.5) return colors.success;
  if (ratio < 0.8) return colors.warning;
  return colors.error;
}

/**
 * İrade bandı — today + timeline paylaşır. Kullanım oranına göre renk.
 *
 * ERİŞİLEBİLİRLİK. Bant üç ayrı parçaya bölünmüş bir tek bilgi: "3/5" ve
 * "2/3 aktif" metinleri ile aradaki çubuk. Gruplanmadan bunlar ekran
 * okuyucuda birbirinden kopuk iki sayı çifti olarak okunur ve neyin neye ait
 * olduğu kaybolur. Bu yüzden bant `accessible` bir tek öğe olarak duyuruluyor,
 * etiketi Türkçe tam cümle, değeri de `accessibilityValue` ile sayısal.
 * `onPress` varsa rol `button`, yoksa `progressbar`.
 */
export default function WillpowerBand({ wp, onPress, style, ...a11y }: Props) {
  const ratio = wp.daily_budget > 0 ? wp.used / wp.daily_budget : 0;
  const col = wpColor(ratio);
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
      style={[{ flexDirection: 'row', alignItems: 'center', gap: space.md }, style]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, minWidth: 56 }}>
        <Ionicons name="flash" size={14} color={col} />
        <Text style={{ ...font.bodySm, color: col, fontWeight: '700' }}>
          {wp.used}/{wp.daily_budget}
        </Text>
      </View>
      <ProgressBar progress={ratio} color={col} height={5} style={{ flex: 1 }} />
      <Text style={{ ...font.caption, color: colors.textFaint, minWidth: 58, textAlign: 'right' }}>
        {wp.active_count}/{wp.focus_capacity} aktif
      </Text>
    </Wrapper>
  );
}
