import {
  POSTGREST_CLIENT_VERSION,
  type Database,
  type TableInsert,
  type TableRow,
  type TableUpdate,
} from '../../lib/database.types';
import {
  FOCUS_PRESETS,
  OVERLAY_LEVELS,
  presetById,
} from '../../lib/focusThemes';
import {
  getMonthBackground,
  monthBackgrounds,
} from '../../lib/monthBackgrounds';
import {
  RANK_TIERS,
  rankForLevel,
  rankMeta,
} from '../../lib/ranks';
import { FOCUS_PLAYLISTS } from '../../lib/spotifyFocus';
import { loadSqlite } from '../../lib/sqliteDriver.native';
import {
  TASK_ESTIMATE_SOURCES,
  type Task,
  type TaskEstimateSource,
} from '../../lib/taskTypes';
import {
  ACHIEVEMENT_BADGES,
  BAD_HABIT_SHIELD,
  BENTO_ART,
  CANVASES,
  DECOR,
  EMPTY_VIGNETTES,
  FLOW_CBT_BACKDROPS,
  FLOW_CHECKPOINT_ZEN,
  FOCUS_BACKDROPS,
  FOCUS_COMPLETE_GONG,
  FOCUS_SWATCHES,
  LIFE_AREA_ART,
  MOOD_SEALS,
  ONBOARDING_ART,
  PACK_COVERS,
  RANK_CRESTS,
  RITUAL_BANNERS,
  SCREEN_BANNERS,
  TEXTURES,
  TODAY_HEROES,
  getAchievementBadge,
  getFocusBackdrop,
  getFocusSwatch,
  getLifeAreaArt,
  getMoodSeal,
  getPackCover,
  getRankCrest,
  getTodayHeroForHour,
} from '../../lib/visualAssets';

jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../helpers/sqliteAdapter').createExpoSqliteModule();
});

describe('lib/database.types runtime & schema helper contracts', () => {
  it('exports POSTGREST_CLIENT_VERSION matching Database.__InternalSupabase.PostgrestVersion', () => {
    const versionCheck: Database['__InternalSupabase']['PostgrestVersion'] =
      POSTGREST_CLIENT_VERSION;
    expect(versionCheck).toBe('12');

    const sampleInsert: TableInsert<'ai_calls'> = { user_id: 'u-1' };
    const sampleUpdate: TableUpdate<'ai_calls'> = { called_at: '2026-01-01T00:00:00Z' };
    const sampleRow: TableRow<'ai_calls'> = {
      id: 'row-1',
      user_id: sampleInsert.user_id,
      called_at: sampleUpdate.called_at ?? '2026-01-01T00:00:00Z',
    };
    expect(sampleRow.user_id).toBe('u-1');
  });
});

describe('lib/taskTypes runtime constants & domain shape', () => {
  it('exports TASK_ESTIMATE_SOURCES aligned with TaskEstimateSource', () => {
    const sources: readonly TaskEstimateSource[] = TASK_ESTIMATE_SOURCES;
    expect(sources).toEqual(['user', 'ai', 'block', 'default']);
    expect(new Set(sources).size).toBe(4);

    const sampleTask: Task = {
      id: 't-1',
      user_id: 'u-1',
      title: 'Plan sprint',
      status: 'pending',
      priority: 'medium',
      estimate_source: TASK_ESTIMATE_SOURCES[0],
      list_type: 'this_week',
      completed: false,
      created_at: '2026-01-01T09:00:00Z',
    };
    expect(sampleTask.estimate_source).toBe('user');
  });
});

describe('lib/focusThemes presets & overlay levels', () => {
  it('defines unique presets starting with default and resolves known/unknown preset ids', () => {
    expect(FOCUS_PRESETS.length).toBeGreaterThanOrEqual(9);
    expect(FOCUS_PRESETS[0].id).toBe('default');

    const ids = FOCUS_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const preset of FOCUS_PRESETS) {
      expect(preset.id.length).toBeGreaterThan(0);
      expect(preset.label.length).toBeGreaterThan(0);
      expect(preset.bg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(preset.cardBg).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(preset.accent).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(presetById(preset.id)).toBe(preset);
    }

    expect(presetById('non-existent-preset')).toBe(FOCUS_PRESETS[0]);
    expect(presetById('')).toBe(FOCUS_PRESETS[0]);
  });

  it('defines ascending overlay opacity levels bounded within [0, 1]', () => {
    expect(OVERLAY_LEVELS.map((l) => l.value)).toEqual([0, 0.15, 0.3, 0.45]);
    for (let i = 1; i < OVERLAY_LEVELS.length; i += 1) {
      expect(OVERLAY_LEVELS[i].value).toBeGreaterThan(OVERLAY_LEVELS[i - 1].value);
      expect(OVERLAY_LEVELS[i].value).toBeLessThanOrEqual(1);
    }
  });
});

describe('lib/monthBackgrounds seasonal calendar assets', () => {
  it('maps 0..11 directly and wraps negative or overflow month indices modulo 12', () => {
    expect(monthBackgrounds).toHaveLength(12);
    for (let m = 0; m < 12; m += 1) {
      expect(monthBackgrounds[m]).toBeDefined();
      expect(getMonthBackground(m)).toBe(monthBackgrounds[m]);
    }

    expect(getMonthBackground(12)).toBe(monthBackgrounds[0]);
    expect(getMonthBackground(14)).toBe(monthBackgrounds[2]);
    expect(getMonthBackground(-1)).toBe(monthBackgrounds[11]);
    expect(getMonthBackground(-12)).toBe(monthBackgrounds[0]);
    expect(getMonthBackground(-13)).toBe(monthBackgrounds[11]);
  });
});

describe('lib/ranks tier progression & lookup', () => {
  it('keeps RANK_TIERS strictly ascending by minLevel and resolves boundary levels', () => {
    expect(RANK_TIERS.map((t) => t.minLevel)).toEqual([1, 5, 10, 20, 30, 50]);

    expect(rankForLevel(0)).toBe(RANK_TIERS[0]);
    expect(rankForLevel(1)).toBe(RANK_TIERS[0]);
    expect(rankForLevel(4)).toBe(RANK_TIERS[0]);
    expect(rankForLevel(5)).toBe(RANK_TIERS[1]);
    expect(rankForLevel(9)).toBe(RANK_TIERS[1]);
    expect(rankForLevel(10)).toBe(RANK_TIERS[2]);
    expect(rankForLevel(19)).toBe(RANK_TIERS[2]);
    expect(rankForLevel(20)).toBe(RANK_TIERS[3]);
    expect(rankForLevel(30)).toBe(RANK_TIERS[4]);
    expect(rankForLevel(50)).toBe(RANK_TIERS[5]);
    expect(rankForLevel(120)).toBe(RANK_TIERS[5]);
  });

  it('resolves rankMeta by exact tier name and falls back to level when missing or unknown', () => {
    for (const tier of RANK_TIERS) {
      expect(rankMeta(tier.name, 1)).toBe(tier);
    }

    expect(rankMeta(null, 25)).toBe(RANK_TIERS[3]);
    expect(rankMeta(undefined, 35)).toBe(RANK_TIERS[4]);
    expect(rankMeta('', 12)).toBe(RANK_TIERS[2]);
    expect(rankMeta('UnknownTierName', 50)).toBe(RANK_TIERS[5]);
    expect(rankMeta(null)).toBe(RANK_TIERS[0]);
  });
});

describe('lib/spotifyFocus curated playlists', () => {
  it('provides unique playlists with matching spotify URI and HTTPS fallback URL', () => {
    expect(FOCUS_PLAYLISTS.length).toBeGreaterThanOrEqual(6);
    const ids = FOCUS_PLAYLISTS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const playlist of FOCUS_PLAYLISTS) {
      expect(playlist.name.length).toBeGreaterThan(0);
      expect(playlist.emoji.length).toBeGreaterThan(0);
      expect(playlist.uri).toBe(`spotify:playlist:${playlist.id}`);
      expect(playlist.openUrl).toBe(`https://open.spotify.com/playlist/${playlist.id}`);
    }
  });
});

describe('lib/sqliteDriver.native platform seam', () => {
  it('loads and memoizes expo-sqlite and opens a working database handle', async () => {
    const first = loadSqlite();
    const second = loadSqlite();
    expect(first).not.toBeNull();
    expect(second).toBe(first);

    const db = await first!.openDatabaseAsync(':memory:');
    await db.execAsync('CREATE TABLE items (id INTEGER PRIMARY KEY, label TEXT NOT NULL);');
    await db.runAsync('INSERT INTO items (id, label) VALUES (?, ?);', 1, 'alpha');
    const row = await db.getFirstAsync<{ id: number; label: string }>(
      'SELECT id, label FROM items WHERE id = ?;',
      1,
    );
    expect(row).toEqual({ id: 1, label: 'alpha' });
    await db.closeAsync();
  });
});

describe('lib/visualAssets registry & fallback selectors', () => {
  it('exposes defined image sources across every asset collection', () => {
    const collections = [
      TEXTURES,
      TODAY_HEROES,
      RITUAL_BANNERS,
      FOCUS_BACKDROPS,
      FOCUS_SWATCHES,
      FLOW_CBT_BACKDROPS,
      PACK_COVERS,
      RANK_CRESTS,
      ACHIEVEMENT_BADGES,
      SCREEN_BANNERS,
      ONBOARDING_ART,
      EMPTY_VIGNETTES,
      CANVASES,
      DECOR,
      BENTO_ART,
      LIFE_AREA_ART,
      MOOD_SEALS,
    ];

    for (const group of collections) {
      const values = Object.values(group);
      expect(values.length).toBeGreaterThan(0);
      for (const src of values) {
        expect(src).toBeDefined();
      }
    }

    expect(BAD_HABIT_SHIELD).toBeDefined();
    expect(FOCUS_COMPLETE_GONG).toBeDefined();
    expect(FLOW_CHECKPOINT_ZEN).toBeDefined();
  });

  it('selects Today hero by hour bands and falls back to night outside daytime windows', () => {
    expect(getTodayHeroForHour(4)).toBe(TODAY_HEROES.night);
    expect(getTodayHeroForHour(5)).toBe(TODAY_HEROES.dawn);
    expect(getTodayHeroForHour(10)).toBe(TODAY_HEROES.dawn);
    expect(getTodayHeroForHour(11)).toBe(TODAY_HEROES.zenith);
    expect(getTodayHeroForHour(16)).toBe(TODAY_HEROES.zenith);
    expect(getTodayHeroForHour(17)).toBe(TODAY_HEROES.dusk);
    expect(getTodayHeroForHour(20)).toBe(TODAY_HEROES.dusk);
    expect(getTodayHeroForHour(21)).toBe(TODAY_HEROES.night);
    expect(getTodayHeroForHour(0)).toBe(TODAY_HEROES.night);
    expect(getTodayHeroForHour()).toBeDefined();
  });

  it('resolves known keys and safe defaults across all lookup helpers', () => {
    for (const preset of FOCUS_PRESETS) {
      expect(getFocusBackdrop(preset.id)).toBe(FOCUS_BACKDROPS[preset.id]);
      expect(getFocusSwatch(preset.id)).toBe(FOCUS_SWATCHES[preset.id]);
    }
    expect(getFocusBackdrop('missing')).toBe(FOCUS_BACKDROPS.default);
    expect(getFocusSwatch('missing')).toBe(FOCUS_SWATCHES.default);

    expect(getPackCover('deep-work')).toBe(PACK_COVERS['deep-work']);
    expect(getPackCover('missing-pack')).toBe(PACK_COVERS['everyday-foundations']);

    for (const tier of RANK_TIERS) {
      expect(getRankCrest(tier.name)).toBe(RANK_CRESTS[tier.name]);
    }
    expect(getRankCrest('UnknownRank')).toBe(RANK_CRESTS.Acemi);

    expect(getAchievementBadge('hundred_club')).toBe(ACHIEVEMENT_BADGES.hundred_club);
    expect(getAchievementBadge('missing_badge')).toBe(ACHIEVEMENT_BADGES.first_step);

    expect(getLifeAreaArt('kariyer')).toBe(LIFE_AREA_ART.kariyer);
    expect(getLifeAreaArt('unknown_area')).toBe(LIFE_AREA_ART.saglik);

    for (const mood of [1, 2, 3, 4, 5]) {
      expect(getMoodSeal(mood)).toBe(MOOD_SEALS[mood]);
    }
    expect(getMoodSeal(0)).toBe(MOOD_SEALS[3]);
    expect(getMoodSeal(99)).toBe(MOOD_SEALS[3]);
  });
});
