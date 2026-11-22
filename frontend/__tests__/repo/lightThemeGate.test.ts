import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { FIRST_WAVE_THEMED } from '../helpers/firstWaveThemed';
import { stripComments } from '../helpers/sourceText';
import { LIGHT_THEME_ENABLED } from '../../lib/featureGates';

const ROOT = join(__dirname, '..', '..');

export { FIRST_WAVE_THEMED };

/**
 * Surfaces deliberately kept dark even when light theme ships (owner decision open in F25).
 * Starts empty so `LIGHT_THEME_ENABLED` cannot become `true` until remaining screens migrate
 * or are explicitly added here by owner decision.
 */
export const INTENTIONALLY_DARK: ReadonlySet<string> = new Set<string>([]);

const STATIC_COLORS_IMPORT_RE =
  /import\s*\{[^}]*\bcolors\b[^}]*\}\s*from\s*['"][^'"]*tokens['"]/;

function walkTsx(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkTsx(rel));
    else if (e.name.endsWith('.tsx')) out.push(rel);
  }
  return out;
}

export function findStaticColorsImporters(): string[] {
  const files = [...walkTsx('app'), ...walkTsx('components')];
  return files.filter((rel) => {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    return STATIC_COLORS_IMPORT_RE.test(code);
  });
}

export function evaluateLightThemeGate(
  lightEnabled: boolean,
  staticImporters: readonly string[],
  intentionallyDark: ReadonlySet<string>,
): string[] {
  if (!lightEnabled) return [];
  return staticImporters.filter((rel) => !intentionallyDark.has(rel));
}

describe('F25 (DSA-01) — light theme release gate and first-wave migration fence', () => {
  const staticImporters = findStaticColorsImporters();

  it('(+) LIGHT_THEME_ENABLED is false and gate evaluation passes with zero premature exposures', () => {
    expect(LIGHT_THEME_ENABLED).toBe(false);
    expect(evaluateLightThemeGate(LIGHT_THEME_ENABLED, staticImporters, INTENTIONALLY_DARK)).toEqual([]);
  });

  it('(+) all first-wave themed files have zero static colors imports', () => {
    expect(FIRST_WAVE_THEMED).toHaveLength(31);
    const regressed = FIRST_WAVE_THEMED.filter((rel) => {
      const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
      return STATIC_COLORS_IMPORT_RE.test(code);
    });
    expect(regressed).toEqual([]);
  });

  it('(+) Settings ThemeModeRow and tab header toggle are strictly gated on LIGHT_THEME_ENABLED and placebo copy is gone', () => {
    const settings = stripComments(readFileSync(join(ROOT, 'app/tabs/settings.tsx'), 'utf8'));
    expect(settings).toMatch(/\{\s*LIGHT_THEME_ENABLED\s*\?\s*<ThemeModeRow\b/);
    expect(settings).not.toContain('AMOLED dostu');
    expect(settings).toContain('Koyu tema');
    expect(settings).toContain('Açık tema');
    expect(settings).toContain('accessibilityRole="radio"');

    const tabsLayout = stripComments(readFileSync(join(ROOT, 'app/tabs/_layout.tsx'), 'utf8'));
    expect(tabsLayout).toMatch(/LIGHT_THEME_ENABLED\s*\?[\s\S]*?accessibilityLabel="Tema değiştir"/);
  });

  it('(-) flipping LIGHT_THEME_ENABLED to true prematurely is blocked by > 100 unmigrated static importers', () => {
    let mockedEnabled = false;
    jest.isolateModules(() => {
      jest.doMock('../../lib/featureGates', () => ({
        ...jest.requireActual('../../lib/featureGates'),
        LIGHT_THEME_ENABLED: true,
      }));
      /* eslint-disable @typescript-eslint/no-require-imports -- jest.isolateModules requires CJS require */
      const fg = require('../../lib/featureGates') as { LIGHT_THEME_ENABLED: boolean };
      /* eslint-enable @typescript-eslint/no-require-imports */
      mockedEnabled = fg.LIGHT_THEME_ENABLED;
    });
    expect(mockedEnabled).toBe(true);
    const blockers = evaluateLightThemeGate(mockedEnabled, staticImporters, INTENTIONALLY_DARK);
    expect(blockers.length).toBeGreaterThan(100);
  });
});
