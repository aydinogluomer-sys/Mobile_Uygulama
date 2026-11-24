import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import { catalog } from '../helpers/catalog';
import * as featuresModule from '../../constants/features';

const ROOT = join(__dirname, '..', '..');
const code = (rel: string): string => stripComments(readFileSync(join(ROOT, rel), 'utf8'));

describe('F28 (NAV-14) — noStaleComingSoon', () => {
  it('(-) constants/features.ts does not export UPCOMING_FEATURES', () => {
    expect('UPCOMING_FEATURES' in featuresModule).toBe(false);
    expect(code('constants/features.ts')).not.toContain('UPCOMING_FEATURES');
  });

  it('(-) settings.tsx and components/settings/* contain zero "Yakında" copy', () => {
    const settingsDirFiles = readdirSync(join(ROOT, 'components', 'settings'))
      .filter((f) => f.endsWith('.tsx') || f.endsWith('.ts'))
      .map((f) => `components/settings/${f}`);

    const targets = ['app/tabs/settings.tsx', ...settingsDirFiles];
    expect(targets.length).toBeGreaterThanOrEqual(3);

    for (const rel of targets) {
      expect(code(rel)).not.toContain('Yakında');
    }

    const catalogSettingsHits = Object.entries(catalog)
      .filter(([k, v]) => k.startsWith('settings.') && v.includes('Yakında'))
      .map(([k]) => k);
    expect(catalogSettingsHits).toEqual([]);

    // Negative check: synthetic "Yakında" in settings.* catalog entry is flagged
    const fakeEntries: [string, string][] = [['settings.future.badge', 'Yakında geliyor']];
    expect(fakeEntries.filter(([k, v]) => k.startsWith('settings.') && v.includes('Yakında'))).toHaveLength(1);
  });

  it('(+) every CURRENT_FEATURES item has non-empty title and description', () => {
    expect(featuresModule.CURRENT_FEATURES.length).toBeGreaterThan(0);
    for (const item of featuresModule.CURRENT_FEATURES) {
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.description.trim().length).toBeGreaterThan(0);
    }
  });
});
