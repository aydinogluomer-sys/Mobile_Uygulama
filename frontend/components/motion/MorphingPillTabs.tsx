import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Animated,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { font, hexA, onColor, radius, space, type Palette } from '../../lib/tokens';
import { useThemeColors, useThemedStyles } from '../../hooks/useThemeColors';
import { haptic } from '../../lib/haptics';
import { useAccent } from '../../lib/useAccent';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';

const NATIVE = Platform.OS !== 'web';

export type MorphingSegment<T extends string> = {
  key: T;
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  badgeCount?: number;
};

type Props<T extends string> = {
  segments: readonly MorphingSegment<T>[];
  value: T;
  onChange: (key: T) => void;
  /** 'filled' = parlak aksan dolgu (SegmentedTabs stili), 'glass' = yumuşak aksan cam çerçeve */
  variant?: 'filled' | 'glass';
  scrollable?: boolean;
  style?: StyleProp<ViewStyle>;
};

const makeStyles = (c: Palette) =>
  StyleSheet.create({
    scrollOuter: {
      backgroundColor: hexA(c.bgElevated, 0.88),
      borderBottomWidth: 1,
      borderBottomColor: c.borderSubtle,
    },
    scrollContent: {
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
    track: {
      flexDirection: 'row',
      alignItems: 'center',
      position: 'relative',
      backgroundColor: hexA(c.surface, 0.86),
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: c.border,
      padding: 3,
      gap: 4,
    },
    trackFlex: {
      width: '100%',
    },
    indicator: {
      position: 'absolute',
      top: 3,
      bottom: 3,
      left: 0,
      borderRadius: radius.pill,
      borderWidth: 1,
      transformOrigin: 'left center',
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingHorizontal: 13,
      paddingVertical: Platform.OS === 'web' ? 7 : 6,
      borderRadius: radius.pill,
      zIndex: 1,
    },
    pillFlex: {
      flex: 1,
    },
    label: {
      ...font.bodySm,
      fontSize: 12,
      fontWeight: '600',
    },
    labelActive: {
      fontWeight: '700',
    },
    badge: {
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.pill,
    },
    badgeText: {
      fontSize: 10,
      fontWeight: '700',
    },
  });

/**
 * Yay fiziğiyle sekmeler arasında yerel sürücülü (`translateX` + `scaleX`) kayan aktif kapsüllü sekme çubuğu (GEM-09).
 */
export default function MorphingPillTabs<T extends string>({
  segments,
  value,
  onChange,
  variant = 'filled',
  scrollable = false,
  style,
}: Props<T>) {
  const c = useThemeColors();
  const s = useThemedStyles(makeStyles);
  const accent = useAccent();
  const reduceMotion = useReducedMotion();
  const canAnimate = !reduceMotion;

  const [layouts, setLayouts] = useState<Record<string, { x: number; width: number }>>({});
  const [baseW, setBaseW] = useState(0);
  const baseWRef = useRef(0);
  const lastTargetRef = useRef<{ x: number; width: number } | null>(null);
  const [animX] = useState(() => new Animated.Value(0));
  const [animScale] = useState(() => new Animated.Value(1));

  const activeRect = layouts[value];

  useEffect(() => {
    if (!activeRect) return;
    const prev = lastTargetRef.current;
    if (prev && Math.abs(prev.x - activeRect.x) < 0.5 && Math.abs(prev.width - activeRect.width) < 0.5) {
      return;
    }
    lastTargetRef.current = activeRect;

    const curBaseW = baseWRef.current;
    if (!canAnimate || curBaseW <= 0) {
      animX.setValue(activeRect.x);
      animScale.setValue(1);
      baseWRef.current = activeRect.width;
      setBaseW(activeRect.width);
      return;
    }

    Animated.parallel([
      Animated.spring(animX, {
        toValue: activeRect.x,
        tension: 260,
        friction: 24,
        useNativeDriver: NATIVE,
      }),
      Animated.spring(animScale, {
        toValue: activeRect.width / curBaseW,
        tension: 260,
        friction: 24,
        useNativeDriver: NATIVE,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        baseWRef.current = activeRect.width;
        setBaseW(activeRect.width);
      }
    });
  }, [activeRect, animScale, animX, canAnimate]);

  useLayoutEffect(() => {
    if (baseW > 0) animScale.setValue(1);
  }, [animScale, baseW]);

  function handleLayout(key: string, e: LayoutChangeEvent) {
    const { x, width } = e.nativeEvent.layout;
    setLayouts((prev) => {
      const cur = prev[key];
      if (cur && Math.abs(cur.x - x) < 0.5 && Math.abs(cur.width - width) < 0.5) return prev;
      return { ...prev, [key]: { x, width } };
    });
  }

  const indicatorStyle =
    variant === 'filled'
      ? { backgroundColor: accent.bright, borderColor: accent.bright }
      : { backgroundColor: hexA(accent.primary, 0.16), borderColor: accent.primary };

  const filledInk = onColor(accent.bright);

  const pills = (
    <View style={[s.track, !scrollable && s.trackFlex]}>
      {activeRect && baseW > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={[
            s.indicator,
            indicatorStyle,
            {
              width: baseW,
              transform: [{ translateX: animX }, { scaleX: animScale }],
            },
          ]}
        />
      ) : null}

      {segments.map((seg) => {
        const active = seg.key === value;
        const fg =
          variant === 'filled'
            ? active
              ? filledInk
              : c.textDim
            : active
              ? accent.primary
              : c.textDim;

        return (
          <TouchableOpacity
            key={seg.key}
            onLayout={(e) => handleLayout(seg.key, e)}
            onPress={() => {
              if (seg.key !== value) haptic.select();
              onChange(seg.key);
            }}
            activeOpacity={0.8}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={seg.label}
            style={[
              s.pill,
              !scrollable && s.pillFlex,
              !activeRect && active ? indicatorStyle : null,
            ]}
          >
            {seg.icon ? <Ionicons name={seg.icon} size={14} color={fg} /> : null}
            <Text
              style={[
                s.label,
                { color: fg },
                active && s.labelActive,
              ]}
              numberOfLines={1}
            >
              {seg.label}
            </Text>
            {seg.badgeCount !== undefined && seg.badgeCount > 0 ? (
              <View
                style={[
                  s.badge,
                  {
                    backgroundColor:
                      variant === 'filled' && active
                        ? hexA(filledInk, 0.2)
                        : hexA(accent.primary, 0.2),
                  },
                ]}
              >
                <Text
                  style={[
                    s.badgeText,
                    { color: variant === 'filled' && active ? filledInk : accent.primary },
                  ]}
                >
                  {seg.badgeCount}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );

  if (scrollable) {
    return (
      <View style={[s.scrollOuter, style]}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.scrollContent}
        >
          {pills}
        </ScrollView>
      </View>
    );
  }

  return <View style={style}>{pills}</View>;
}
