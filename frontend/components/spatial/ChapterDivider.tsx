import {
  Platform,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { colors, font, hexA, space } from '../../lib/tokens';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

type Props = {
  /** Güneş/ay evresi gravür görseli (`DECOR.dividerSundial`). */
  source?: ImageSourcePropType;
  label?: string;
  accentColor?: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * Uzun kaydırmalı sayfalarda düz boşluk yerine editoryal kitap bölümü ayrımı sağlar.
 */
export default function ChapterDivider({
  source,
  label,
  accentColor = colors.warning,
  style,
}: Props) {
  return (
    <View style={[s.wrap, style]} pointerEvents="none" {...decorativeA11y}>
      <View style={[s.hairline, { backgroundColor: hexA(accentColor, 0.22) }]} />
      {source && !IS_TEST ? (
        <Image source={source} style={s.ornament} contentFit="contain" cachePolicy="memory-disk" />
      ) : null}
      {label ? <Text style={[s.label, { color: hexA(accentColor, 0.78) }]}>{label}</Text> : null}
      <View style={[s.hairline, { backgroundColor: hexA(accentColor, 0.22) }]} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginVertical: space.sm,
  },
  hairline: {
    flex: 1,
    height: 1,
  },
  ornament: {
    width: 118,
    height: 24,
    opacity: 0.72,
  },
  label: {
    ...font.overline,
    fontSize: 10,
  },
});

