// Seasonal Ambient Motion — tipler (implementation contract §8)
// İzole modül: takvim aylık arka planlarına çok hafif, mevsimsel canlı atmosfer.

export type MonthNameTR =
  | 'Ocak'
  | 'Şubat'
  | 'Mart'
  | 'Nisan'
  | 'Mayıs'
  | 'Haziran'
  | 'Temmuz'
  | 'Ağustos'
  | 'Eylül'
  | 'Ekim'
  | 'Kasım'
  | 'Aralık';

export type SeasonalMotionIntensity = 'off' | 'subtle' | 'normal';

export type SeasonalEffectType =
  | 'snow'
  | 'softSnow'
  | 'frostDust'
  | 'iceSparkle'
  | 'pollenDrift'
  | 'waterGlint'
  | 'petalDrift'
  | 'softLightSpeck'
  | 'leafSway'
  | 'bloomShimmer'
  | 'pollenMotes'
  | 'summerAir'
  | 'waterShimmer'
  | 'seaSparkle'
  | 'subtleHeatShimmer'
  | 'goldenDust'
  | 'oliveSway'
  | 'heatHaze'
  | 'transitionLeafDrift'
  | 'softMist'
  | 'autumnLeafFall'
  | 'amberDust'
  | 'slowFog'
  | 'fineDrizzle'
  | 'warmLightPulse'
  | 'winterStarSparkle';

export type SeasonalSpeed = 'verySlow' | 'slow' | 'mediumSlow';

export type SeasonalDrift =
  | 'none'
  | 'slight'
  | 'diagonalSoft'
  | 'springBreeze'
  | 'gentle'
  | 'warmBreeze'
  | 'horizontalSoft'
  | 'dryWarmWind'
  | 'coolBreeze'
  | 'fallBreeze'
  | 'mistHorizontal'
  | 'gentleSnow';

export interface SeasonalMotionConfig {
  month: MonthNameTR;
  effects: SeasonalEffectType[];
  particleCount: { subtle: number; normal: number };
  opacity: { subtle: number; normal: number };
  speed: SeasonalSpeed;
  drift: SeasonalDrift;
}

// Bir efektin nasıl çizileceği (düşük seviyeli ilkel)
export type ParticleKind = 'dot' | 'sparkle' | 'petal' | 'leaf' | 'streak';

// Hareketli noktasal parçacık. Konum 0..1 normalize (container ölçüsüyle çarpılır).
export interface AmbientParticle {
  id: string;
  kind: ParticleKind;
  color: string;
  x: number;        // 0..1
  y: number;        // 0..1
  size: number;     // px
  opacity: number;
  delay: number;    // ms
  duration: number; // ms
  driftX: number;   // container genişliğinin oranı (-1..1)
  driftY: number;   // container yüksekliğinin oranı (-1..1)
  rotation: number; // derece (petal/leaf için)
}

// Büyük, çok hafif atmosfer bandı (fog / mist / haze / glow pulse)
export type BandMotion = 'driftX' | 'pulse';

export interface AmbientBand {
  id: string;
  color: string;
  topPct: number;    // 0..1 (container yüksekliği)
  heightPct: number; // 0..1
  opacity: number;
  duration: number;  // ms
  delay: number;     // ms
  motion: BandMotion;
}

export interface SeasonalScene {
  particles: AmbientParticle[];
  bands: AmbientBand[];
}
