import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');
const raw = (rel: string): string => readFileSync(join(ROOT, rel), 'utf8');
const code = (rel: string): string => stripComments(raw(rel));

describe('F29 — dayClose static wiring & boundary guard', () => {
  it('(+) lib/dayClose.ts registers account storage, stays pure of React/store/DB/analytics, and defines no constant literal key', () => {
    const lib = code('lib/dayClose.ts');
    expect(lib).toContain('registerAccountStorage(');
    expect(lib).toMatch(/name:\s*'dayClose'/);
    expect(lib).toMatch(/transient:\s*false/);
    expect(lib).toContain('export const dayCloseKey = (userId: string): string =>');

    expect(lib).not.toMatch(/\bfrom\s+['"](?:react|react-native)['"]/);
    expect(lib).not.toMatch(/\bfrom\s+['"][^'"]*(?:supabase|repositories\/|store\/|analytics)/);
    expect(lib).not.toMatch(/toISOString\s*\(/);
    expect(lib).not.toMatch(/\bconst\s+[A-Za-z0-9_]+\s*=\s*['"`]aderyth:day_close/);
  });

  it('(+) hooks/useDayClose.ts mutates tasks strictly via updateTask and never calls removeTask or archiveTask', () => {
    const hook = code('hooks/useDayClose.ts');
    expect(hook).toContain('updateTask(');
    expect(hook).not.toContain('removeTask(');
    expect(hook).not.toContain('archiveTask(');
  });

  it('(+) app/tabs/today.tsx wires useDayClose, DayCloseEcho, DayCloseMood, DayCloseTasks, closeFlow.finish, markFirstClose, and uses no Alert.alert', () => {
    const today = code('app/tabs/today.tsx');
    expect(today).toContain('useDayClose(');
    expect(today).toContain('<DayCloseEcho');
    expect(today).toContain('<DayCloseMood');
    expect(today).toContain('<DayCloseTasks');
    expect(today).toContain('closeFlow.finish(');
    expect(today).toContain('markFirstClose(clock.today)');
    expect(today).toContain('lightDayFromCloseRef');
    expect(today).not.toMatch(/\bAlert\s*\.\s*alert\b/);
  });

  it('(-) components/today/DayClose*.tsx contain zero error tokens, zero raw hexes, zero static colors imports, and DayCloseEcho is strictly non-interactive', () => {
    const files = [
      'components/today/DayCloseTasks.tsx',
      'components/today/DayCloseMood.tsx',
      'components/today/DayCloseEcho.tsx',
    ];
    for (const rel of files) {
      const c = code(rel);
      const r = raw(rel);
      expect({ rel, hasErrorToken: /\b(?:colors|c)\.error\b/.test(c) }).toEqual({
        rel,
        hasErrorToken: false,
      });
      expect({ rel, hexes: [...r.matchAll(/["'](#[0-9A-Fa-f]{3,8})["']/g)].map((m) => m[1]) }).toEqual({
        rel,
        hexes: [],
      });
      expect({
        rel,
        staticColors: /import\s*\{[^}]*\bcolors\b[^}]*\}\s*from\s*['"][^'"]*tokens['"]/.test(c),
      }).toEqual({
        rel,
        staticColors: false,
      });
    }

    const echo = code('components/today/DayCloseEcho.tsx');
    expect(echo).toContain('accessibilityRole="text"');
    expect(echo).not.toMatch(/\bonPress\b/);
    expect(echo).not.toMatch(/<(?:TouchableOpacity|Pressable|Button|Chip)\b/);
  });
});
