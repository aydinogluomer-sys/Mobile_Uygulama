import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform, Text, type StyleProp, type TextStyle } from 'react-native';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

type Props = {
  value: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
};

/**
 * Tabular mono metrik değeri güncellendiğinde mikro dikey kayma + opaklık
 * geçişiyle ("editorial ticker") canlandırır. Metin içeriği ilk kareden itibaren
 * her zaman gerçek `value` olduğundan Jest ve ekran okuyucularda %100 deterministiktir.
 */
export default function AnimatedMetricValue({ value, style, numberOfLines }: Props) {
  const reduceMotion = useReducedMotion();
  const skip = IS_TEST || reduceMotion;
  const anim = useRef(new Animated.Value(1)).current;
  const prevValue = useRef(value);

  useEffect(() => {
    if (skip) {
      prevValue.current = value;
      return;
    }
    if (prevValue.current !== value) {
      prevValue.current = value;
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: 320,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    }
  }, [value, skip, anim]);

  if (skip) {
    return (
      <Text style={style} numberOfLines={numberOfLines}>
        {value}
      </Text>
    );
  }

  return (
    <Animated.Text
      numberOfLines={numberOfLines}
      style={[
        style,
        {
          opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
          transform: [
            {
              translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [5, 0] }),
            },
          ],
        },
      ]}
    >
      {value}
    </Animated.Text>
  );
}

