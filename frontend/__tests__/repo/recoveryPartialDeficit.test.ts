/**
 * Plan §9's headline case must work in the UI, not just in the domain layer:
 *
 *   Target 10.000 adım, actual 8.000  ->  Eksik = 2.000
 *
 * `lib/recovery.ts`'s `deficitFor` computes this correctly and is unit-tested.
 * But the recovery SCREEN could not reach it: the repository feeding it
 * (`fetchHabitLogsForHabitsSince`) selected only `habit_id, completed_at,
 * state` -- no `value`. With `value: null` the partial branch of `deficitFor`
 * has nothing to subtract, so a partial day reported the FULL target as owed
 * (10.000 instead of 2.000).
 *
 * This asserts a property of the SOURCE TEXT, and says so rather than
 * pretending to be a runtime test -- the same instrument
 * `rule4NoDirectDbInUi.test.ts` and `noUtcDayKeys.test.ts` use.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

/**
 * Slice from a function declaration to the NEXT top-level export.
 * Deliberately NOT `indexOf('\n}')`: the inline params object type closes with
 * `\n}` too, which truncates the body before `.select(` and makes the
 * assertion pass or fail for entirely the wrong reason.
 */
function bodyOf(src: string, decl: string): string {
  const start = src.indexOf(decl);
  if (start === -1) return '';
  const rest = src.slice(start + 1);
  const next = rest.indexOf('\nexport ');
  return next === -1 ? rest : rest.slice(0, next);
}

describe('plan §9 partial deficit reaches the recovery screen', () => {
  const repo = read('repositories/habitLogRepository.ts');

  it('fetchHabitLogsForHabitsSince selects the value column', () => {
    const body = bodyOf(repo, 'export async function fetchHabitLogsForHabitsSince');
    expect(body).not.toBe('');
    const select = body.match(/\.select\(\s*'([^']+)'\s*\)/);
    expect(select).not.toBeNull();
    expect(select![1].split(',').map((s) => s.trim())).toContain('value');
  });

  it('the body-slicer does not stop at the params object brace', () => {
    // Scanner sanity: proves bodyOf reaches past `}): Promise<...>` so this
    // suite cannot silently start asserting against an empty string.
    const body = bodyOf(repo, 'export async function fetchHabitLogsForHabitsSince');
    expect(body).toMatch(/\.select\(/);
    expect(body).toMatch(/habit_logs/);
  });

  it('StreakLogRow carries value, so callers can compute a real deficit', () => {
    const line = repo.split(/\r?\n/).find((l) => l.includes('export type StreakLogRow'));
    expect(line).toBeDefined();
    expect(line).toMatch(/'value'/);
  });

  it('recovery.tsx passes a real value into deficitFor, not a hardcoded null', () => {
    const scr = read('app/screens/recovery.tsx');
    const call = scr.slice(scr.indexOf('deficitFor({'));
    const args = call.slice(0, call.indexOf('})'));
    expect(args).toMatch(/value:/);
    expect(args).not.toMatch(/value:\s*null\s*[,}]/);
  });
});
