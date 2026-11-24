import { colors, palettes } from '../../lib/tokens';
import {
  HABIT_HUES,
  MIN_HUE_CONTRAST,
  contrastRatio,
  hueLabel,
  isHabitHue,
} from '../../lib/habitColors';

describe('lib/habitColors (F31 — Thefor F-7 accessible categorical palette)', () => {
  it('(+) exports exactly 12 hues with unique hexes, keys, and Turkish labels', () => {
    expect(HABIT_HUES).toHaveLength(12);
    const keys = HABIT_HUES.map((h) => h.key);
    const labels = HABIT_HUES.map((h) => h.label);
    const hexes = HABIT_HUES.map((h) => h.hex.toLowerCase());

    expect(new Set(keys).size).toBe(12);
    expect(new Set(labels).size).toBe(12);
    expect(new Set(hexes).size).toBe(12);
    expect(labels).toEqual([
      'Mercan',
      'Kehribar',
      'Hardal',
      'Zeytin',
      'Yosun',
      'Nane',
      'Gökyüzü',
      'Mavi',
      'İndigo',
      'Mor',
      'Orkide',
      'Gül',
    ]);
  });

  it('(+) every hue reaches >= 3:1 WCAG contrast on dark and light surfaces', () => {
    const surfaces = [
      colors.surface,
      colors.surfaceAlt,
      palettes.light.bg,
      palettes.light.surface,
      '#ffffff',
      '#f7f4ee',
    ];
    const failures: string[] = [];

    for (const hue of HABIT_HUES) {
      for (const bg of surfaces) {
        const ratio = contrastRatio(hue.hex, bg);
        if (ratio < MIN_HUE_CONTRAST) {
          failures.push(`${hue.key} (${hue.hex}) on ${bg} = ${ratio}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('(+) isHabitHue is case-insensitive and hueLabel resolves known hues', () => {
    expect(isHabitHue('#d46e5e')).toBe(true);
    expect(isHabitHue('#D46E5E')).toBe(true);
    expect(hueLabel('#d46e5e')).toBe('Mercan');
    expect(hueLabel('#8282DE')).toBe('İndigo');
  });

  it('(-) no habit hue hex collides with any semantic colors.* token', () => {
    const semanticHexes = new Set(
      [...Object.values(palettes.dark), ...Object.values(palettes.light)]
        .filter((v): v is string => typeof v === 'string' && v.startsWith('#'))
        .map((v) => v.toLowerCase()),
    );
    const collisions = HABIT_HUES.filter((h) => semanticHexes.has(h.hex.toLowerCase()));
    expect(collisions).toEqual([]);
  });

  it('(-) off-palette hex returns isHabitHue=false and hueLabel="Özel renk"; null/undefined returns "Varsayılan"', () => {
    expect(isHabitHue('#123456')).toBe(false);
    expect(isHabitHue(null)).toBe(false);
    expect(isHabitHue(undefined)).toBe(false);
    expect(isHabitHue('')).toBe(false);

    expect(hueLabel('#123456')).toBe('Özel renk');
    expect(hueLabel(null)).toBe('Varsayılan');
    expect(hueLabel(undefined)).toBe('Varsayılan');
    expect(hueLabel('')).toBe('Varsayılan');
  });
});
