/**
 * Aderyth Görsel Sanat Yönetimi Kayıt Defteri — "Paper, Clay & Brass Nocturnal Sanctuary"
 * React Native / Metro Bundler statik `require()` zorunluluğu nedeniyle tüm 146 `.webp`
 * varlık (89 Faz-1 + 57 Faz-2 Header-Dışı Uzamsal Sahne, Filigran, Bento, Tarot ve Mühür)
 * burada tek merkezden, tip güvenli olarak dışa aktarılır.
 */
import type { ImageSourcePropType } from 'react-native';

export type TextureKey =
  | 'clay'
  | 'archivalPaper'
  | 'topographic'
  | 'botanical'
  | 'sacredGrid'
  | 'neural'
  | 'linen'
  | 'kintsugi';

export const TEXTURES: Record<TextureKey, ImageSourcePropType> = {
  clay: require('../assets/images/textures/tex-clay-grain.webp'),
  archivalPaper: require('../assets/images/textures/tex-archival-paper.webp'),
  topographic: require('../assets/images/textures/tex-topographic-contour.webp'),
  botanical: require('../assets/images/textures/tex-botanical-etching.webp'),
  sacredGrid: require('../assets/images/textures/tex-sacred-grid.webp'),
  neural: require('../assets/images/textures/tex-neural-constellation.webp'),
  linen: require('../assets/images/textures/tex-linen-weave.webp'),
  kintsugi: require('../assets/images/textures/tex-ceramic-kintsugi.webp'),
};

export type TodayPhaseKey = 'dawn' | 'zenith' | 'dusk' | 'night';

export const TODAY_HEROES: Record<TodayPhaseKey, ImageSourcePropType> = {
  dawn: require('../assets/images/today/today-dawn.webp'),
  zenith: require('../assets/images/today/today-zenith.webp'),
  dusk: require('../assets/images/today/today-dusk.webp'),
  night: require('../assets/images/today/today-night.webp'),
};

/** Yerel saate göre Bugün ekranı atmosferik hero görselini seçer. */
export function getTodayHeroForHour(hour: number = new Date().getHours()): ImageSourcePropType {
  if (hour >= 5 && hour < 11) return TODAY_HEROES.dawn;
  if (hour >= 11 && hour < 17) return TODAY_HEROES.zenith;
  if (hour >= 17 && hour < 21) return TODAY_HEROES.dusk;
  return TODAY_HEROES.night;
}

export type RitualSlotKey = 'morning' | 'afternoon' | 'evening' | 'anytime';

export const RITUAL_BANNERS: Record<RitualSlotKey, ImageSourcePropType> = {
  morning: require('../assets/images/rituals/ritual-morning.webp'),
  afternoon: require('../assets/images/rituals/ritual-afternoon.webp'),
  evening: require('../assets/images/rituals/ritual-evening.webp'),
  anytime: require('../assets/images/rituals/ritual-anytime.webp'),
};

export const BAD_HABIT_SHIELD: ImageSourcePropType = require('../assets/images/rituals/bad-habit-shield.webp');

export const FOCUS_BACKDROPS: Record<string, ImageSourcePropType> = {
  default: require('../assets/images/focus-themes/focus-bg-default.webp'),
  forest: require('../assets/images/focus-themes/focus-bg-forest.webp'),
  cosmic: require('../assets/images/focus-themes/focus-bg-cosmic.webp'),
  warm: require('../assets/images/focus-themes/focus-bg-warm.webp'),
  ocean: require('../assets/images/focus-themes/focus-bg-ocean.webp'),
  sunset: require('../assets/images/focus-themes/focus-bg-sunset.webp'),
  midnight: require('../assets/images/focus-themes/focus-bg-midnight.webp'),
  rose: require('../assets/images/focus-themes/focus-bg-rose.webp'),
  mono: require('../assets/images/focus-themes/focus-bg-mono.webp'),
};

export function getFocusBackdrop(presetId: string): ImageSourcePropType {
  return FOCUS_BACKDROPS[presetId] ?? FOCUS_BACKDROPS.default;
}

export const FOCUS_SWATCHES: Record<string, ImageSourcePropType> = {
  default: require('../assets/images/focus-themes/swatch-default.webp'),
  forest: require('../assets/images/focus-themes/swatch-forest.webp'),
  cosmic: require('../assets/images/focus-themes/swatch-cosmic.webp'),
  warm: require('../assets/images/focus-themes/swatch-warm.webp'),
  ocean: require('../assets/images/focus-themes/swatch-ocean.webp'),
  sunset: require('../assets/images/focus-themes/swatch-sunset.webp'),
  midnight: require('../assets/images/focus-themes/swatch-midnight.webp'),
  rose: require('../assets/images/focus-themes/swatch-rose.webp'),
  mono: require('../assets/images/focus-themes/swatch-mono.webp'),
};

export function getFocusSwatch(presetId: string): ImageSourcePropType {
  return FOCUS_SWATCHES[presetId] ?? FOCUS_SWATCHES.default;
}

export const FOCUS_COMPLETE_GONG: ImageSourcePropType = require('../assets/images/focus-themes/focus-complete-gong.webp');

export const FLOW_CBT_BACKDROPS: Record<string, ImageSourcePropType> = {
  'cbt-2min-friction': require('../assets/images/focus-flow/flow-cbt-2min.webp'),
  'cbt-dopamine-menu': require('../assets/images/focus-flow/flow-cbt-dopamine.webp'),
  'cbt-zeigarnik-dump': require('../assets/images/focus-flow/flow-cbt-zeigarnik.webp'),
  'cbt-ultradian-90': require('../assets/images/focus-flow/flow-cbt-ultradian.webp'),
  'cbt-never-miss-twice': require('../assets/images/focus-flow/flow-cbt-never-miss-twice.webp'),
  'cbt-phone-foyer': require('../assets/images/focus-flow/flow-cbt-foyer.webp'),
};

export const FLOW_CHECKPOINT_ZEN: ImageSourcePropType = require('../assets/images/focus-flow/flow-checkpoint-zen.webp');

export const PACK_COVERS: Record<string, ImageSourcePropType> = {
  'morning-reset': require('../assets/images/packs/pack-morning-reset.webp'),
  'deep-work': require('../assets/images/packs/pack-deep-work.webp'),
  'sleep-reset': require('../assets/images/packs/pack-sleep-reset.webp'),
  'fitness-foundation': require('../assets/images/packs/pack-fitness-foundation.webp'),
  'everyday-foundations': require('../assets/images/packs/pack-everyday-foundations.webp'),
};

export function getPackCover(packKey: string): ImageSourcePropType {
  return PACK_COVERS[packKey] ?? PACK_COVERS['everyday-foundations'];
}

export const RANK_CRESTS: Record<string, ImageSourcePropType> = {
  Acemi: require('../assets/images/ranks/rank-1-acemi.webp'),
  'Çırak': require('../assets/images/ranks/rank-2-cirak.webp'),
  'Savaşçı': require('../assets/images/ranks/rank-3-savasci.webp'),
  'Şövalye': require('../assets/images/ranks/rank-4-sovalye.webp'),
  Usta: require('../assets/images/ranks/rank-5-usta.webp'),
  Efsane: require('../assets/images/ranks/rank-6-efsane.webp'),
};

export function getRankCrest(rankName: string): ImageSourcePropType {
  return RANK_CRESTS[rankName] ?? RANK_CRESTS.Acemi;
}

export const ACHIEVEMENT_BADGES: Record<string, ImageSourcePropType> = {
  first_step: require('../assets/images/badges/badge-first-step.webp'),
  week_streak: require('../assets/images/badges/badge-week-streak.webp'),
  multitask_master: require('../assets/images/badges/badge-multitask-master.webp'),
  hundred_club: require('../assets/images/badges/badge-hundred-club.webp'),
  discipline_master: require('../assets/images/badges/badge-discipline-master.webp'),
  deep_diver: require('../assets/images/badges/badge-deep-diver.webp'),
  task_slayer: require('../assets/images/badges/badge-task-slayer.webp'),
  journal_keeper: require('../assets/images/badges/badge-journal-keeper.webp'),
  month_streak: require('../assets/images/badges/badge-month-streak.webp'),
  legend_rank: require('../assets/images/badges/badge-legend-rank.webp'),
};

export function getAchievementBadge(id: string): ImageSourcePropType {
  return ACHIEVEMENT_BADGES[id] ?? ACHIEVEMENT_BADGES.first_step;
}

export const SCREEN_BANNERS = {
  recoveryKintsugi: require('../assets/images/screens/recovery-kintsugi-bowl.webp'),
  journalDesk: require('../assets/images/screens/journal-desk-header.webp'),
  journalArchive: require('../assets/images/screens/journal-archive-shelf.webp'),
  journalAiMirror: require('../assets/images/screens/journal-ai-mirror.webp'),
  habitDetailAura: require('../assets/images/screens/habit-detail-aura.webp'),
  notesAtelier: require('../assets/images/screens/notes-atelier.webp'),
  readingLibrary: require('../assets/images/screens/reading-library.webp'),
  reviewWeekly: require('../assets/images/screens/review-weekly-horizon.webp'),
  reviewMonthlySeal: require('../assets/images/screens/review-monthly-seal.webp'),
  insightsObservatory: require('../assets/images/screens/insights-observatory-header.webp'),
  coachOracle: require('../assets/images/screens/coach-oracle-emblem.webp'),
  planArchitect: require('../assets/images/screens/plan-architect-banner.webp'),
  projectsWorkshop: require('../assets/images/screens/projects-workshop.webp'),
  eisenhowerCompass: require('../assets/images/screens/eisenhower-compass.webp'),
  lifeAreasHarmony: require('../assets/images/screens/life-areas-harmony.webp'),
  deepWorkChamber: require('../assets/images/screens/deep-work-chamber.webp'),
  goalsSummit: require('../assets/images/screens/goals-summit-cairn.webp'),
  integrationsOrrery: require('../assets/images/screens/integrations-orrery.webp'),
  dashboardCommand: require('../assets/images/screens/dashboard-command.webp'),
  runnerSteppingStones: require('../assets/images/screens/runner-stepping-stones.webp'),
  economyFocusCoin: require('../assets/images/screens/economy-focus-coin.webp'),
  leaderboardPantheon: require('../assets/images/screens/leaderboard-pantheon.webp'),
  privacyVaultSeal: require('../assets/images/screens/privacy-vault-seal.webp'),
} as const;

export const ONBOARDING_ART = {
  authSanctuary: require('../assets/images/onboarding/auth-sanctuary-hero.webp'),
  authKeySeal: require('../assets/images/onboarding/auth-key-seal.webp'),
  privacyMonolith: require('../assets/images/onboarding/privacy-monolith.webp'),
  step1Compass: require('../assets/images/onboarding/onb-step1-compass.webp'),
  step2Rhythm: require('../assets/images/onboarding/onb-step2-rhythm.webp'),
  step3Blueprint: require('../assets/images/onboarding/onb-step3-blueprint.webp'),
} as const;

export type EmptyAssetKey = 'habits' | 'tasks' | 'journal' | 'focus' | 'offline';

export const EMPTY_VIGNETTES: Record<EmptyAssetKey, ImageSourcePropType> = {
  habits: require('../assets/images/empty/empty-habits.webp'),
  tasks: require('../assets/images/empty/empty-tasks.webp'),
  journal: require('../assets/images/empty/empty-journal.webp'),
  focus: require('../assets/images/empty/empty-focus.webp'),
  offline: require('../assets/images/empty/error-offline-calm.webp'),
};

// ── Faz 2: Header-Dışı Tam Ekran Atmosferik Sahne Tualleri (Katman 0) ──────
export const CANVASES = {
  todaySanctuary: require('../assets/images/canvases/canvas-today-sanctuary.webp'),
  planDrafting: require('../assets/images/canvases/canvas-plan-drafting.webp'),
  strategyAltitude: require('../assets/images/canvases/canvas-strategy-altitude.webp'),
  ritualsBotanical: require('../assets/images/canvases/canvas-rituals-botanical.webp'),
  runnerZenGarden: require('../assets/images/canvases/canvas-runner-zen-garden.webp'),
  deepworkMonolith: require('../assets/images/canvases/canvas-deepwork-monolith.webp'),
  kintsugiAtelier: require('../assets/images/canvases/canvas-kintsugi-atelier.webp'),
  journalScriptorium: require('../assets/images/canvases/canvas-journal-scriptorium.webp'),
  observatoryStats: require('../assets/images/canvases/canvas-observatory-stats.webp'),
  oracleChamber: require('../assets/images/canvases/canvas-oracle-chamber.webp'),
  pantheonHall: require('../assets/images/canvases/canvas-pantheon-hall.webp'),
  treasuryVault: require('../assets/images/canvases/canvas-treasury-vault.webp'),
  libraryPinboard: require('../assets/images/canvases/canvas-library-pinboard.webp'),
  authPoster: require('../assets/images/canvases/canvas-auth-poster.webp'),
} as const;

// ── Faz 2: Arka Plana Gömülü Mimari/Botanik Filigranlar & Kadran Armaları ──
export const DECOR = {
  cornerAstrolabe: require('../assets/images/decor/decor-corner-astrolabe.webp'),
  cornerBotanical: require('../assets/images/decor/decor-corner-botanical.webp'),
  cornerKintsugiSeam: require('../assets/images/decor/decor-corner-kintsugi-seam.webp'),
  cornerBlueprint: require('../assets/images/decor/decor-corner-blueprint.webp'),
  dividerSundial: require('../assets/images/decor/decor-divider-sundial.webp'),
  quadrantFlame: require('../assets/images/decor/decor-quadrant-flame.webp'),
  quadrantCompass: require('../assets/images/decor/decor-quadrant-compass.webp'),
  quadrantHourglass: require('../assets/images/decor/decor-quadrant-hourglass.webp'),
  quadrantFeather: require('../assets/images/decor/decor-quadrant-feather.webp'),
  goldenThreadNode: require('../assets/images/decor/decor-golden-thread-node.webp'),
  guillocheWave: require('../assets/images/decor/decor-guilloche-wave.webp'),
  obsidianPrism: require('../assets/images/decor/decor-obsidian-prism.webp'),
} as const;

// ── Faz 2: Kart İçi Bento Vinyetleri & Etkileşimli Sahne Görselleri ────────
export const BENTO_ART = {
  sparkReels: require('../assets/images/bento/bento-spark-reels.webp'),
  lowEnergyMoss: require('../assets/images/bento/bento-low-energy-moss.webp'),
  eveningShutdown: require('../assets/images/bento/bento-evening-shutdown.webp'),
  recoveryToday: require('../assets/images/bento/bento-recovery-today.webp'),
  recoveryTomorrow: require('../assets/images/bento/bento-recovery-tomorrow.webp'),
  recoverySplit: require('../assets/images/bento/bento-recovery-split.webp'),
  recoveryRelease: require('../assets/images/bento/bento-recovery-release.webp'),
  coachAnalyze: require('../assets/images/bento/bento-coach-analyze.webp'),
  coachSuggest: require('../assets/images/bento/bento-coach-suggest.webp'),
  coachShield: require('../assets/images/bento/bento-coach-shield.webp'),
  coachPlan: require('../assets/images/bento/bento-coach-plan.webp'),
  profileLeague: require('../assets/images/bento/bento-profile-league.webp'),
  profileTreasury: require('../assets/images/bento/bento-profile-treasury.webp'),
  profileVitrine: require('../assets/images/bento/bento-profile-vitrine.webp'),
  hubToolsStrategy: require('../assets/images/bento/bento-hub-tools-strategy.webp'),
  hubToolsDeepfocus: require('../assets/images/bento/bento-hub-tools-deepfocus.webp'),
  bookExlibris: require('../assets/images/bento/bento-book-exlibris.webp'),
  noteParchment: require('../assets/images/bento/bento-note-parchment.webp'),
} as const;

// ── Faz 2: 8 Yaşam Alanı Koleksiyon / Tarot Kartları ───────────────────────
export const LIFE_AREA_ART: Record<string, ImageSourcePropType> = {
  saglik: require('../assets/images/life-areas/area-saglik.webp'),
  kariyer: require('../assets/images/life-areas/area-kariyer.webp'),
  egitim: require('../assets/images/life-areas/area-egitim.webp'),
  finans: require('../assets/images/life-areas/area-finans.webp'),
  aile: require('../assets/images/life-areas/area-aile.webp'),
  sosyal: require('../assets/images/life-areas/area-sosyal.webp'),
  ruhsal: require('../assets/images/life-areas/area-ruhsal.webp'),
  hobiler: require('../assets/images/life-areas/area-hobiler.webp'),
};

export function getLifeAreaArt(areaKey: string): ImageSourcePropType {
  return LIFE_AREA_ART[areaKey] ?? LIFE_AREA_ART.saglik;
}

// ── Faz 2: 5 Balmumu Mühür Duygu Damgası (MOODS 1..5) ──────────────────────
export const MOOD_SEALS: Record<number, ImageSourcePropType> = {
  1: require('../assets/images/moods/mood-1-zor.webp'),
  2: require('../assets/images/moods/mood-2-yorgun.webp'),
  3: require('../assets/images/moods/mood-3-orta.webp'),
  4: require('../assets/images/moods/mood-4-iyi.webp'),
  5: require('../assets/images/moods/mood-5-harika.webp'),
};

export function getMoodSeal(moodValue: number): ImageSourcePropType {
  return MOOD_SEALS[moodValue] ?? MOOD_SEALS[3];
}
