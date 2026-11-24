import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { space, radius, font, type Palette } from '../lib/tokens';
import { useThemeColors, useThemedStyles } from '../hooks/useThemeColors';

/**
 * The visible half of pagination.
 *
 * A paginated list that offers no way to continue is indistinguishable, to
 * the user, from a list that simply ends — which is precisely the failure
 * mode a bare `.limit()` would have introduced. This makes "there is more"
 * an explicit state rather than an invisible one, and says so even when the
 * list is also wired to load on scroll, so the affordance does not depend on
 * a gesture landing.
 */
export default function LoadMoreFooter({
  hasMore,
  loading,
  onPress,
  label = 'Daha fazla yükle',
}: {
  hasMore: boolean;
  loading: boolean;
  onPress: () => void;
  label?: string;
}) {
  const colors = useThemeColors();
  const s = useThemedStyles(makeStyles);
  if (!hasMore) return null;
  return (
    <View style={s.wrap}>
      {loading ? (
        <ActivityIndicator color={colors.textDim} accessibilityLabel="Daha fazla yükleniyor" />
      ) : (
        <TouchableOpacity
          onPress={onPress}
          style={s.btn}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Text style={s.text}>{label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const makeStyles = (colors: Palette) =>
  StyleSheet.create({
    wrap: { paddingVertical: space.lg, alignItems: 'center' },
    btn: {
      paddingHorizontal: 18,
      paddingVertical: 9,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    text: { ...font.bodySm, color: colors.textDim },
  });
