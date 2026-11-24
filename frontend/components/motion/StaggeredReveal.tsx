import { useEffect, useState } from 'react';
import { Animated, Easing, Platform, View, type StyleProp, type ViewStyle } from 'react-native';
import { useReducedMotion } from '../seasonalMotion/useReducedMotion';

const IS_TEST = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';

type Props = {
  children: React.ReactNode;
  /** Sıralı giriş indeksi (0, 1, 2... — maksimum ilk 10 öğeye gecikme uygulanır). */
  index?: number;
  /** Kademe başına ms gecikmesi (varsayılan 45ms). */
  stepMs?: number;
  /** Başlangıç dikey kayma miktarı (varsayılan 14px). */
  distance?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Awwwards Kademeli Giriş Koreografisi ("Calm Editorial Physics").
 * `useReducedMotion()` aktifse veya Jest test ortamındaysa zamanlayıcı kurmadan
 * anında tam opaklıkla render eder (sıfır açık timer, %100 erişilebilirlik uyumu).
 */
export default function StaggeredReveal({
  children,
  index = 0,
  stepMs = 45,
  distance = 14,
  style,
}: Props) {
  const reduceMotion = useReducedMotion();
  const skip = IS_TEST || reduceMotion;

  const [progress] = useState(() => new Animated.Value(skip ? 1 : 0));

  useEffect(() => {
    if (skip) {
      progress.setValue(1);
      return;
    }
    progress.setValue(0);
    const delay = Math.min(index, 10) * stepMs;
    const anim = Animated.sequence([
      Animated.delay(delay),
      Animated.timing(progress, {
        toValue: 1,
        duration: 380,
        easing: Easing.bezier(0.22, 1, 0.36, 1),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    anim.start();
    return () => anim.stop();
  }, [index, stepMs, skip, progress]);

  if (skip) {
    return <View style={style}>{children}</View>;
  }

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [distance, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

