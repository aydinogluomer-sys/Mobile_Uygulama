import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import {
  FAB_SIZE,
  FLOATING_GAP,
  MAX_CONTENT_WIDTH,
  TAB_BAR_CONTENT_HEIGHT,
  barWidth,
  chartWidth,
  contentWidth,
  heatmapCellSize,
  radarSize,
  tabBarHeight,
  tabBarPaddingBottom,
  undoToastBottom,
} from '../../lib/layoutMetrics';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

function walkUiFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '__tests__' || e.name.startsWith('.')) continue;
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walkUiFiles(rel));
    else if (/\.(?:ts|tsx)$/.test(e.name)) out.push(rel);
  }
  return out.sort();
}

export function findModuleScopeDimensionsGet(rel: string, raw: string): string[] {
  const clean = stripComments(raw);
  const hits: string[] = [];
  clean.split('\n').forEach((line, idx) => {
    if (/^(?:export\s+)?(?:const|let)\b.*Dimensions\.get\s*\(/.test(line)) {
      hits.push(`${rel}:${idx + 1}: ${line.trim()}`);
    }
  });
  return hits;
}

describe('F26 (NAV-16, GEM-05, GEM-06) — window-derived layout metrics and floating geometry guards', () => {
  it('(+) computes pure layout metrics accurately across narrow phones, tablets, and large text scales', () => {
    expect(MAX_CONTENT_WIDTH).toBe(720);
    expect(TAB_BAR_CONTENT_HEIGHT).toBe(56);
    expect(FAB_SIZE).toBe(56);
    expect(FLOATING_GAP).toBe(12);

    expect(contentWidth(360)).toBe(360);
    expect(contentWidth(1200)).toBe(720);

    expect(heatmapCellSize(360)).toBe(5);
    expect(heatmapCellSize(1200)).toBe(12);
    for (const w of [0, 120, 240, 320, 375, 768, 1366]) {
      expect(heatmapCellSize(w)).toBeGreaterThanOrEqual(4);
    }

    expect(chartWidth(360)).toBe(296);
    expect(chartWidth(80)).toBe(160);
    expect(barWidth(296)).toBe(18);
    expect(barWidth(200, 10, 2)).toBe(18);

    expect(radarSize(320)).toBe(240);
    expect(radarSize(900)).toBe(280);

    expect(tabBarPaddingBottom(34)).toBe(34);
    expect(tabBarPaddingBottom(0)).toBe(8);
    expect(tabBarHeight(34, 1)).toBe(90);
    expect(tabBarHeight(0, 1)).toBe(64);
    expect(tabBarHeight(34, 2)).toBe(98);

    expect(undoToastBottom(100)).toBe(168);
    expect(undoToastBottom(80)).toBe(148);
  });

  it('(-) zero module-scope const/let Dimensions.get(...) remain in app/ and components/, and scanner catches synthetic ones', () => {
    const files = [...walkUiFiles('app'), ...walkUiFiles('components')];
    expect(files.length).toBeGreaterThan(120);

    const offenders = files.flatMap((rel) =>
      findModuleScopeDimensionsGet(rel, readFileSync(join(ROOT, rel), 'utf8')),
    );
    expect(offenders).toEqual([]);

    expect(
      findModuleScopeDimensionsGet(
        'synthetic.tsx',
        "const { width } = Dimensions.get('window');\n  const inner = Dimensions.get('window');",
      ),
    ).toEqual(["synthetic.tsx:1: const { width } = Dimensions.get('window');"]);
  });

  it('(-) timeline undoToast sits above FAB via undoToastBottom, and Drawer ShortcutCard avoids nested touchables', () => {
    const timeline = stripComments(readFileSync(join(ROOT, 'app/tabs/timeline.tsx'), 'utf8'));
    expect(timeline).toContain('undoToastBottom(');
    expect((timeline.match(/Platform\.OS\s*===\s*['"]ios['"]\s*\?\s*100\s*:\s*80/g) ?? []).length).toBe(1);
    expect(timeline).toContain('accessibilityRole="alert"');
    expect(timeline).toContain('accessibilityLiveRegion="polite"');

    const drawer = stripComments(readFileSync(join(ROOT, 'components/Drawer.tsx'), 'utf8'));
    expect(drawer).toContain('function ShortcutCard');
    expect(drawer).toContain('<IconButton');
    expect(drawer).not.toContain('s.removeBadge');
  });
});
