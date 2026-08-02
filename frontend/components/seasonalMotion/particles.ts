// Seasonal Ambient Motion — parçacık üretimi (contract §10–11)
// Deterministik: ay+yoğunluğa göre seeded; render içinde Math.random YOK.
import type {
  AmbientBand, AmbientParticle, ParticleKind, SeasonalDrift, SeasonalEffectType,
  SeasonalMotionConfig, SeasonalScene, SeasonalSpeed,
} from './types';

// ── Seeded RNG (mulberry32) ────────────────────────────────────────────────
function hashStr(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Efekt → çizim ilkeli + renk (§11) ───────────────────────────────────────
const EFFECT_KIND: Record<SeasonalEffectType, ParticleKind> = {
  snow: 'dot', softSnow: 'dot', frostDust: 'sparkle', iceSparkle: 'sparkle',
  pollenDrift: 'dot', waterGlint: 'sparkle', petalDrift: 'petal', softLightSpeck: 'sparkle',
  leafSway: 'leaf', bloomShimmer: 'sparkle', pollenMotes: 'dot', summerAir: 'dot',
  waterShimmer: 'dot', seaSparkle: 'sparkle', subtleHeatShimmer: 'dot', goldenDust: 'dot',
  oliveSway: 'leaf', heatHaze: 'dot', transitionLeafDrift: 'leaf', softMist: 'dot',
  autumnLeafFall: 'leaf', amberDust: 'dot', slowFog: 'dot', fineDrizzle: 'streak',
  warmLightPulse: 'sparkle', winterStarSparkle: 'sparkle',
};

const EFFECT_COLOR: Record<SeasonalEffectType, string> = {
  snow: '#FFFFFF', softSnow: '#FFFFFF', frostDust: '#D6EBFF', iceSparkle: '#D6EBFF',
  pollenDrift: '#FFF5D2', waterGlint: '#B4DCEB', petalDrift: '#FFE0E8', softLightSpeck: '#FFFAEB',
  leafSway: '#96AA78', bloomShimmer: '#FFFAEB', pollenMotes: '#FFF5D2', summerAir: '#EAF6FF',
  waterShimmer: '#B4DCEB', seaSparkle: '#C8EBF5', subtleHeatShimmer: '#FFEBC8', goldenDust: '#F5D28C',
  oliveSway: '#9CA86E', heatHaze: '#FFEBC8', transitionLeafDrift: '#C8AA6E', softMist: '#DCE1E6',
  autumnLeafFall: '#D2864B', amberDust: '#DCA05A', slowFog: '#DCE1E6', fineDrizzle: '#C8D7E1',
  warmLightPulse: '#FFDCAA', winterStarSparkle: '#FFFAEB',
};

// Bant (büyük atmosfer katmanı) üreten efektler
const BAND_EFFECTS: Partial<Record<SeasonalEffectType, { color: string; motion: 'driftX' | 'pulse' }>> = {
  slowFog: { color: '#DCE1E6', motion: 'driftX' },
  softMist: { color: '#DCE1E6', motion: 'driftX' },
  heatHaze: { color: '#FFE6BE', motion: 'pulse' },
  subtleHeatShimmer: { color: '#FFEBC8', motion: 'pulse' },
  warmLightPulse: { color: '#FFD79E', motion: 'pulse' },
  waterShimmer: { color: '#A8D2E6', motion: 'driftX' },
};

// ── Sürüklenme yönü (container oranı) ───────────────────────────────────────
// Snow/leaf düşer (dy+), pollen yükselir (dy-), rüzgâr yatay (dx).
const DRIFT_VECTOR: Record<SeasonalDrift, { dx: number; dy: number }> = {
  none: { dx: 0.02, dy: 0.04 },
  slight: { dx: 0.05, dy: 0.55 },        // hafif yana, aşağı süzülme (kar)
  diagonalSoft: { dx: 0.16, dy: 0.5 },   // çapraz esinti
  springBreeze: { dx: 0.14, dy: -0.4 },  // yukarı/yana polen
  gentle: { dx: 0.12, dy: 0.5 },         // yumuşak düşüş (petal)
  warmBreeze: { dx: 0.18, dy: 0.18 },    // yatay ağırlıklı sıcak esinti
  horizontalSoft: { dx: 0.22, dy: 0.05 },
  dryWarmWind: { dx: 0.24, dy: 0.06 },   // kuru sıcak rüzgâr
  coolBreeze: { dx: 0.14, dy: 0.42 },
  fallBreeze: { dx: 0.18, dy: 0.55 },    // yaprak düşüşü
  mistHorizontal: { dx: 0.2, dy: 0.03 },
  gentleSnow: { dx: 0.08, dy: 0.55 },
};

// ── Hız → süre aralığı (ms) (§10: 8–28s) ────────────────────────────────────
const SPEED_DURATION_MS: Record<SeasonalSpeed, [number, number]> = {
  verySlow: [18000, 28000],
  slow: [12000, 22000],
  mediumSlow: [9000, 16000],
};

function rangePick(rnd: () => number, [a, b]: [number, number]): number {
  return a + rnd() * (b - a);
}

// Kenara yaslanmış x: parçacıkların ~%70'i kenar bantlarında (merkez temiz kalır §10)
function edgeBiasedX(rnd: () => number): number {
  if (rnd() < 0.7) {
    const left = rnd() < 0.5;
    const band = rnd() * 0.26;        // 0..0.26
    return left ? band : 1 - band;    // sol/sağ kenar
  }
  return 0.2 + rnd() * 0.6;           // bazıları ortada ama seyrek
}

const PARTICLE_KINDS: ParticleKind[] = ['dot', 'sparkle', 'petal', 'leaf', 'streak'];

function sizeFor(kind: ParticleKind, rnd: () => number): number {
  switch (kind) {
    case 'sparkle': return 2.5 + rnd() * 2.5;    // küçük parıltı
    case 'dot': return 3 + rnd() * 4;            // küçük yumuşak nokta
    case 'streak': return 1.5 + rnd() * 1.5;     // ince çizgi genişliği
    case 'petal': return 7 + rnd() * 5;
    case 'leaf': return 8 + rnd() * 6;
  }
}

/**
 * Aya + yoğunluğa göre deterministik sahne üretir (parçacıklar + bantlar).
 * useMemo ile cache'lenmek üzere tasarlandı; her ay/yoğunluk için bir kez üretilir.
 */
export function generateScene(
  config: SeasonalMotionConfig,
  intensity: 'subtle' | 'normal',
): SeasonalScene {
  const rnd = mulberry32(hashStr(`${config.month}:${intensity}`));
  const count = config.particleCount[intensity];
  const baseOpacity = config.opacity[intensity];
  const drift = DRIFT_VECTOR[config.drift];
  const durRange = SPEED_DURATION_MS[config.speed];

  // Efektleri bant / parçacık olarak ayır
  const bandEffects = config.effects.filter((e) => BAND_EFFECTS[e]);
  const particleEffects = config.effects.filter((e) => !BAND_EFFECTS[e]);
  const effectPool = particleEffects.length > 0 ? particleEffects : config.effects;

  // ── Bantlar (en fazla 2) ──
  const bands: AmbientBand[] = bandEffects.slice(0, 2).map((eff, i) => {
    const meta = BAND_EFFECTS[eff]!;
    return {
      id: `${config.month}-band-${i}`,
      color: meta.color,
      // alt/orta bölgeye yerleştir; üst (tarih başlıkları) bölgesinden uzak
      topPct: 0.45 + i * 0.22 + rnd() * 0.05,
      heightPct: 0.22 + rnd() * 0.12,
      opacity: Math.min(0.22, baseOpacity * 1.1),
      duration: meta.motion === 'pulse' ? 3500 + rnd() * 4000 : rangePick(rnd, [16000, 26000]),
      delay: rnd() * 4000,
      motion: meta.motion,
    };
  });

  // ── Parçacıklar ──
  const particles: AmbientParticle[] = [];
  for (let i = 0; i < count; i++) {
    const eff = effectPool[Math.floor(rnd() * effectPool.length)];
    const kind = EFFECT_KIND[eff];
    const color = EFFECT_COLOR[eff];
    const dirX = (rnd() < 0.5 ? -1 : 1) * drift.dx * (0.5 + rnd());
    const driftY = drift.dy * (0.6 + rnd() * 0.8);
    // Görünürlük: cam paneller arka planı büyük ölçüde kapattığından, baz
    // opaklık belirgin biçimde yükseltilir (yine de premium/sakin aralıkta).
    const op = Math.max(0.22, Math.min(0.72, baseOpacity * (1.8 + rnd() * 1.6)));
    particles.push({
      id: `${config.month}-${intensity}-${i}`,
      kind,
      color,
      x: edgeBiasedX(rnd),
      y: kind === 'sparkle' ? rnd() : rnd() * 0.7, // sparkle her yerde, akış üstten
      size: sizeFor(kind, rnd),
      opacity: op,
      delay: rnd() * rangePick(rnd, durRange),
      duration: rangePick(rnd, durRange),
      driftX: dirX,
      driftY,
      rotation: (kind === 'petal' || kind === 'leaf') ? (rnd() < 0.5 ? -1 : 1) * (120 + rnd() * 180) : 0,
    });
  }

  return { particles, bands };
}

// test/yardımcı: bilinen kind listesi
export const KNOWN_PARTICLE_KINDS = PARTICLE_KINDS;
