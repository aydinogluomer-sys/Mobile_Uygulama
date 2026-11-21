/**
 * F13 — Single source of UI streak: server counters (`streak_current`, `current_streak`,
 * `streak_best`) are reserved for the server XP multiplier (`fn_habit_log_award`); UI
 * screens read `behaviorIntelligence.currentStreak` / `longestStreak` (F03 contract, DOM-10).
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const ROOT = join(__dirname, '..', '..');

const ALLOWED_SERVER_STREAK_READERS = new Set([
  'app/screens/achievements.tsx',
  'components/ObsidianExportModal.tsx',
]);

const SERVER_STREAK_FIELD = /\b(?:streak_current|current_streak|streak_best)\b/;

function readsServerStreak(rawSrc: string): boolean {
  return SERVER_STREAK_FIELD.test(stripComments(rawSrc));
}

function listUiFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name === '__tests__') continue;
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listUiFiles(rel));
    else if (/\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out;
}

describe('F13 — streakSingleSource guard', () => {
  it('only allowlisted files in app/ and components/ read server streak counters', () => {
    const uiFiles = [...listUiFiles('app'), ...listUiFiles('components')];
    expect(uiFiles.length).toBeGreaterThan(30);

    const readers = uiFiles.filter((rel) =>
      readsServerStreak(readFileSync(join(ROOT, rel), 'utf8')),
    );

    const unauthorized = readers.filter((rel) => !ALLOWED_SERVER_STREAK_READERS.has(rel));
    if (unauthorized.length > 0) {
      throw new Error(
        `ekran serisi behaviorIntelligence.currentStreak'ten gelir, sunucu sayacı yalnız XP çarpanıdır: ${unauthorized.join(', ')}`,
      );
    }
    expect(unauthorized).toEqual([]);
  });

  it('DOM-10 — recovery.tsx delegates streak calculation to behaviorIntelligence.currentStreak instead of a hand-rolled loop', () => {
    const recoveryCode = stripComments(readFileSync(join(ROOT, 'app/screens/recovery.tsx'), 'utf8'));
    expect(recoveryCode).toMatch(/currentStreak\s*\(/);
    expect(recoveryCode).not.toMatch(/logs\.some\(\(l\)\s*=>\s*l\.completed_at\s*===/);
  });

  it('scanner self-test: catches real property reads and ignores comments', () => {
    expect(readsServerStreak('const x = h.streak_current ?? 0;')).toBe(true);
    expect(readsServerStreak('const y = h.current_streak;')).toBe(true);
    expect(readsServerStreak('const z = h.streak_best;')).toBe(true);
    expect(readsServerStreak('// streak_current yalnız XP çarpanıdır\n/* streak_best */\nconst ok = 1;')).toBe(false);
  });
});
