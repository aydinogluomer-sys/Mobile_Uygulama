// Seasonal Ambient Motion — renderer (contract §4, §8, §9 RN/Animated yolu)
// RN built-in Animated + useNativeDriver (kod tabanı reanimated kullanmıyor).
// Kurallar: pointerEvents none · off/reduce-motion/görünmez → null · per-frame JS YOK.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import type { MonthNameTR, SeasonalMotionIntensity, AmbientParticle, AmbientBand } from './types';
import { getSeasonalConfig } from './config';
import { generateScene } from './particles';
import { useAppActive } from '../../hooks/useScreenActive';

type Props = {
  month: MonthNameTR;
  intensity: SeasonalMotionIntensity;
  reduceMotion: boolean;
  isVisible: boolean;
};

export default function SeasonalMotion({ month, intensity, reduceMotion, isVisible }: Props) {
  const appActive = useAppActive();
  // Erişilebilirlik: sistem reduce-motion açıksa zorla kapat (contract §6)
  const effective: SeasonalMotionIntensity = reduceMotion ? 'off' : intensity;
  const active = isVisible && appActive && effective !== 'off';

  const [size, setSize] = useState({ w: 0, h: 0 });

  // Sahne ay+yoğunluğa göre bir kez üretilir, memoize (contract §8, §10)
  const scene = useMemo(() => {
    if (effective === 'off') return { particles: [], bands: [] };
    return generateScene(getSeasonalConfig(month), effective);
  }, [month, effective]);

  if (!active) return null;

  function onLayout(e: LayoutChangeEvent) {
    const { width, height } = e.nativeEvent.layout;
    if (width !== size.w || height !== size.h) setSize({ w: width, h: height });
  }

  const ready = size.w > 0 && size.h > 0;

  return (
    <View
      style={s.layer}
      pointerEvents="none"
      onLayout={onLayout}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {ready && scene.bands.map((b) => <Band key={b.id} band={b} w={size.w} h={size.h} />)}
      {ready && scene.particles.map((p) => <Particle key={p.id} p={p} w={size.w} h={size.h} />)}
    </View>
  );
}

function Particle({ p, w, h }: { p: AmbientParticle; w: number; h: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.sequence([
      Animated.delay(p.delay),
      Animated.loop(
        Animated.timing(progress, {
          toValue: 1,
          duration: p.duration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ),
    ]);
    anim.start();
    return () => anim.stop();
  }, [p.delay, p.duration, progress]);

  const translateX = progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.driftX * w] });
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [0, p.driftY * h] });

  const opacity =
    p.kind === 'sparkle'
      ? progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [p.opacity * 0.12, p.opacity, p.opacity * 0.12] })
      : progress.interpolate({ inputRange: [0, 0.12, 0.85, 1], outputRange: [0, p.opacity, p.opacity, 0] });

  const transform: any[] = [{ translateX }, { translateY }];
  if (p.rotation !== 0) {
    transform.push({ rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${p.rotation}deg`] }) });
  }

  // Yumuşak ışıma — küçük noktalar parlak görsellerde okunur olsun (iOS shadow)
  const glow = (p.kind === 'dot' || p.kind === 'sparkle')
    ? { shadowColor: p.color, shadowOpacity: 0.7, shadowRadius: Math.max(2, p.size), shadowOffset: { width: 0, height: 0 } }
    : null;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: p.x * w, top: p.y * h, backgroundColor: p.color, opacity },
        shapeStyle(p),
        glow,
        { transform },
      ]}
    />
  );
}

function shapeStyle(p: AmbientParticle) {
  switch (p.kind) {
    case 'sparkle':
    case 'dot':
      return { width: p.size, height: p.size, borderRadius: p.size / 2 };
    case 'streak':
      return { width: p.size, height: 10 + p.size * 4, borderRadius: p.size };
    case 'petal':
      return { width: p.size, height: p.size * 0.66, borderRadius: p.size };
    case 'leaf':
      return { width: p.size, height: p.size * 0.55, borderTopLeftRadius: p.size, borderBottomRightRadius: p.size, borderTopRightRadius: p.size / 3, borderBottomLeftRadius: p.size / 3 };
  }
}

function Band({ band, w, h }: { band: AmbientBand; w: number; h: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const anim = Animated.sequence([
      Animated.delay(band.delay),
      Animated.loop(
        Animated.timing(progress, {
          toValue: 1,
          duration: band.duration,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ),
    ]);
    anim.start();
    return () => anim.stop();
  }, [band.delay, band.duration, progress]);

  const isPulse = band.motion === 'pulse';
  const opacity = isPulse
    ? progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [band.opacity * 0.3, band.opacity, band.opacity * 0.3] })
    : band.opacity;
  const translateX = isPulse
    ? 0
    : progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-0.12 * w, 0.12 * w, -0.12 * w] });

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: -0.15 * w,
        width: w * 1.3,
        top: band.topPct * h,
        height: band.heightPct * h,
        backgroundColor: band.color,
        borderRadius: band.heightPct * h,
        opacity,
        transform: isPulse ? undefined : [{ translateX: translateX as any }],
      }}
    />
  );
}

const s = StyleSheet.create({
  layer: { ...StyleSheet.absoluteFill, overflow: 'hidden' },
});
