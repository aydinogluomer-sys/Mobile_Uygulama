import { Platform, StyleSheet, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { colors, hexA, shadow } from '../../lib/tokens';

type Props = {
  source: ImageSourcePropType;
  size?: number;
  /** Rozet veya rütbe kilitli mi? Kilitliyse koyu mat taş perdesi ve kilit rozeti uygulanır. */
  unlocked?: boolean;
  accentColor?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as const)
    : ({
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      } as const);

/**
 * İrade rütbesi armaları (6 kademe) ve başarım madalyonları (10 rozet) için
 * koleksiyonluk kabartma madalyon sunumu.
 */
export default function EmblemMedallion({
  source,
  size = 56,
  unlocked = true,
  accentColor = colors.primary,
  accessibilityLabel,
  style,
}: Props) {
  const described = Boolean(accessibilityLabel);

  return (
    <View
      {...(described
        ? { accessible: true, accessibilityRole: 'image' as const, accessibilityLabel }
        : decorativeA11y)}
      style={[
        s.outer,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderColor: unlocked ? hexA(accentColor, 0.55) : colors.border,
          backgroundColor: colors.bgSunk,
        },
        unlocked ? shadow.glow(accentColor) : null,
        style,
      ]}
    >
      {!IS_TEST ? (
        <Image
          source={source}
          style={[
            s.img,
            {
              width: size - 4,
              height: size - 4,
              borderRadius: (size - 4) / 2,
              opacity: unlocked ? 1 : 0.34,
            },
          ]}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : null}
      {!unlocked ? (
        <View style={s.lockBadge} pointerEvents="none">
          <Ionicons name="lock-closed" size={Math.max(10, Math.round(size * 0.2))} color={colors.textDim} />
        </View>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  outer: {
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  img: {
    overflow: 'hidden',
  },
  lockBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

