import {
  Platform,
  StyleSheet,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

const decorativeA11y =
  Platform.OS === 'web'
    ? ({ 'aria-hidden': true } as Record<string, unknown>)
    : {
        accessibilityElementsHidden: true,
        importantForAccessibility: 'no-hide-descendants' as const,
      };

export type FiligreeAnchor =
  | 'bottom-right'
  | 'top-right'
  | 'bottom-left'
  | 'top-left'
  | 'center-watermark'
  | 'full-bleed';

type Props = {
  /** Gömülü gravür / kabartma / guilloché görseli (`DECOR.*`). */
  source: ImageSourcePropType;
  anchor?: FiligreeAnchor;
  size?: number;
  /** Görünürlük yoğunluğu (varsayılan 0.16 — metin okunabilirliğini asla bozmaz). */
  opacity?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Katman 1 — Kartların ve sayfa bölümlerinin arka planına gömülen
 * bakır baskı usturlap, botanik, Kintsugi altın damarı, mimari cetvel veya kadran kabartması.
 */
export default function EmbeddedFiligree({
  source,
  anchor = 'bottom-right',
  size = 124,
  opacity = 0.16,
  style,
}: Props) {
  if (IS_TEST) return null;

  if (anchor === 'full-bleed') {
    return (
      <View style={[StyleSheet.absoluteFill, s.clip, style]} pointerEvents="none" {...decorativeA11y}>
        <Image
          source={source}
          style={[StyleSheet.absoluteFill, { opacity }]}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      </View>
    );
  }

  const posStyle: ViewStyle =
    anchor === 'bottom-right'
      ? { right: -6, bottom: -6, width: size, height: size }
      : anchor === 'top-right'
      ? { right: -6, top: -6, width: size, height: size, transform: [{ scaleY: -1 }] }
      : anchor === 'bottom-left'
      ? { left: -6, bottom: -6, width: size, height: size, transform: [{ scaleX: -1 }] }
      : anchor === 'top-left'
      ? { left: -6, top: -6, width: size, height: size, transform: [{ scaleX: -1 }, { scaleY: -1 }] }
      : {
          left: '50%',
          top: '50%',
          width: size,
          height: size,
          marginLeft: -size / 2,
          marginTop: -size / 2,
        };

  return (
    <View style={[s.abs, posStyle, style]} pointerEvents="none" {...decorativeA11y}>
      <Image
        source={source}
        style={[StyleSheet.absoluteFill, { opacity }]}
        contentFit="contain"
        cachePolicy="memory-disk"
      />
    </View>
  );
}

const s = StyleSheet.create({
  abs: {
    position: 'absolute',
    overflow: 'hidden',
  },
  clip: {
    overflow: 'hidden',
  },
});

