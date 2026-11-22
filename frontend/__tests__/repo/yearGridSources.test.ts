import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import { YEAR_CELL_STATE_LABEL } from '../../lib/yearGrid';

const ROOT = join(__dirname, '..', '..');

function readCode(rel: string): string {
  return stripComments(readFileSync(join(ROOT, rel), 'utf8'));
}

describe('repo/yearGridSources (F31 source-level invariants)', () => {
  it('(+) YearlyHeatmap.tsx has zero useLogStore / logStore references and uses parseLocalDate-backed formatting', () => {
    const raw = readFileSync(join(ROOT, 'components/YearlyHeatmap.tsx'), 'utf8');
    expect(raw).not.toContain('useLogStore');
    expect(raw).not.toContain('logStore');
    expect(readCode('components/YearlyHeatmap.tsx')).toContain('KintsugiYearGrid');
    expect(readCode('components/YearlyHeatmap.tsx')).not.toMatch(/new\s+Date\s*\(/);
  });

  it('(+) profile.tsx wires useHeatmapLogs into YearlyHeatmap', () => {
    const code = readCode('app/screens/profile.tsx');
    expect(code).toContain('useHeatmapLogs');
    expect(code).toMatch(/<YearlyHeatmap[\s\S]*rows=\{heat\.rows\}/);
  });

  it('(+) stats.tsx removes per-cell TouchableOpacity / heatmapCell loop while preserving Promise.all and fetchHabitLogsHeatmap', () => {
    const code = readCode('app/tabs/stats.tsx');
    expect(code).not.toContain('heatmapCell');
    expect(code).not.toContain('ratioColor');
    expect(code).toContain('KintsugiYearGrid');
    expect(code).toContain('Promise.all([');
    expect(code).toContain('fetchHabitLogsHeatmap');
  });

  it('(-) KintsugiYearGrid.tsx contains zero colors.error / c.error and zero hardcoded fontSize literals', () => {
    const code = readCode('components/habits/KintsugiYearGrid.tsx');
    expect(code).not.toMatch(/\b(?:colors|c)\.error\b/);
    expect(code).not.toMatch(/\bfontSize\s*:/);
  });

  it('(+) habit-detail.tsx feeds buildHabitYearGrid with cellFor: (d) => dayCellFor( and adds no second isEligibleOn call', () => {
    const code = readCode('app/screens/habit-detail.tsx');
    expect(code).toContain('cellFor: (d) => dayCellFor(');
    const eligibleCalls = code
      .split(/\r?\n/)
      .filter((l) => /\bisEligibleOn\s*\(/.test(l) && !/^import\b/.test(l.trim()));
    expect(eligibleCalls).toHaveLength(1);
  });

  it('(+) YEAR_CELL_STATE_LABEL matches habit-detail.tsx STATE_LABELS verbatim for done/partial/skip/missed/not_scheduled', () => {
    const detail = readCode('app/screens/habit-detail.tsx');
    const m = /const\s+STATE_LABELS[\s\S]*?\{([\s\S]*?)\};/.exec(detail);
    expect(m).not.toBeNull();
    const map: Record<string, string> = {};
    for (const entry of m![1].matchAll(/(\w+)\s*:\s*['"]([^'"]+)['"]/g)) {
      map[entry[1]] = entry[2];
    }
    expect(YEAR_CELL_STATE_LABEL.done).toBe(map.full);
    expect(YEAR_CELL_STATE_LABEL.partial).toBe(map.partial);
    expect(YEAR_CELL_STATE_LABEL.skip).toBe(map.skip);
    expect(YEAR_CELL_STATE_LABEL.missed).toBe(map.miss);
    expect(YEAR_CELL_STATE_LABEL.not_scheduled).toBe(map.not_scheduled);
  });

  it('(-) note modules and components never call console.*, track(, or reportError(', () => {
    const noteFiles = [
      'lib/habitNote.ts',
      'components/habits/HabitDayNote.tsx',
      'services/habitLogService.ts',
    ];
    for (const rel of noteFiles) {
      const code = readCode(rel);
      expect([rel, /\bconsole\.(?:log|warn|error|info|debug)\s*\(/.test(code)]).toEqual([rel, false]);
      expect([rel, /\btrack\s*\(/.test(code)]).toEqual([rel, false]);
      expect([rel, /\breportError\s*\(/.test(code)]).toEqual([rel, false]);
    }
  });
});
