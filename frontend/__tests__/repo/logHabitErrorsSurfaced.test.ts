/**
 * Repository invariant: no `logHabit` call discards its result.  (finding N-04)
 *
 * This asserts a property of the SOURCE TEXT and says so, exactly as
 * noUtcDayKeys.test.ts does. That is the honest instrument here: the behaviour
 * lives inside screen components whose rendering is not under test, and what
 * needs guarding is that a caller never goes back to `await logHabit(...)` as a
 * bare statement.
 *
 * Behavioural coverage of the store itself is in store/logStore.test.ts, which
 * proves `logHabit` RETURNS the error. 1B-005 stopped the store swallowing it;
 * this finding is that every caller in `app/**` then threw it away again, so
 * the user still saw a silent no-op on an RLS denial or a dropped network.
 *
 * AC-N04a  no bare `await logHabit(...)` statement remains
 * AC-N04b  recovery.tsx does not complete a plan whose log write failed
 *
 * AC-N04b is the one that is not merely cosmetic. `recovery.tsx:231` called
 * `completePlan()` unconditionally after `logHabit()`, so a failed write still
 * marked the makeup plan done -- the plan and the log disagree permanently.
 *
 * Written BEFORE the fix and observed to fail, per R-01.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const APP = join(__dirname, '..', '..', 'app');

const CALLERS = [
  ['today.tsx', join(APP, 'tabs', 'today.tsx')],
  ['timeline.tsx', join(APP, 'tabs', 'timeline.tsx')],
  ['recovery.tsx', join(APP, 'screens', 'recovery.tsx')],
] as const;

/** `await logHabit(` at the start of a statement — nothing receives the value. */
const BARE_CALL = /(^|[;{}]\s*)\s*await\s+logHabit\s*\(/m;

describe('AC-N04a -- every logHabit result is inspected', () => {
  it.each(CALLERS)('%s keeps no bare await logHabit(...)', (_name, path) => {
    const src = readFileSync(path, 'utf8');
    const lines = src.split('\n');
    const bare = lines
      .map((l, i) => [l, i + 1] as const)
      .filter(([l]) => /^\s*await\s+logHabit\s*\(/.test(l))
      .map(([, n]) => n);
    expect(bare).toEqual([]);
  });

  it.each(CALLERS)('%s still calls logHabit at all', (_name, path) => {
    // Guard against the check passing because the call was deleted.
    expect(readFileSync(path, 'utf8')).toContain('logHabit(');
  });

  it('proves the scanner works', () => {
    expect(BARE_CALL.test('    await logHabit({ habitId });')).toBe(true);
    expect(BARE_CALL.test('    const r = await logHabit({ habitId });')).toBe(false);
  });
});

describe('AC-N04b -- a failed log never completes a plan', () => {
  it('recovery.tsx checks the result before completePlan', () => {
    const src = readFileSync(join(APP, 'screens', 'recovery.tsx'), 'utf8');
    const logAt = src.lastIndexOf('logHabit(');
    const completeAt = src.indexOf('completePlan(', logAt);
    expect(logAt).toBeGreaterThan(-1);
    expect(completeAt).toBeGreaterThan(-1);

    // Between the write and the completion there must be a guard on the result.
    const between = src.slice(logAt, completeAt);
    expect(between).toMatch(/\.ok|!res|!logRes|return;/);
  });
});
