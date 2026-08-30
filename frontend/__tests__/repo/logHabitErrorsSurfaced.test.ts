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
  /**
   * The ordering moved from the screen into
   * `services/recoveryService.completePlanWithMakeup`, which is where it
   * belongs: closing a plan with no log leaves the two permanently
   * contradicting each other, and that is a domain rule rather than
   * something each screen should remember. The invariant is unchanged and
   * is now asserted at the service.
   */
  const service = readFileSync(join(APP, '..', 'services', 'recoveryService.ts'), 'utf8');

  it('the service writes the log before closing the plan', () => {
    const logAt = service.indexOf('await params.writeLog(');
    const closeAt = service.indexOf('await completePlan(params.plan.id)');
    expect(logAt).toBeGreaterThan(-1);
    expect(closeAt).toBeGreaterThan(logAt);
  });

  it('a failed log returns before the plan is touched', () => {
    const between = service.slice(
      service.indexOf('await params.writeLog('),
      service.indexOf('await completePlan(params.plan.id)'),
    );
    expect(between).toMatch(/if \(!logged\.ok\) return/);
  });

  it('the screen delegates rather than re-implementing the order', () => {
    const src = readFileSync(join(APP, 'screens', 'recovery.tsx'), 'utf8');
    expect(src).toContain('completePlanWithMakeup(');
  });
});

/**
 * AC-Y05 (task 1C-008) -- the onboarding sheet holds no copy of the willpower
 * rules. A second implementation of a rule drifts from the first; that is what
 * F-04 was, four times over, for `ymd`.
 */
describe('AC-Y05 -- no duplicate willpower arithmetic in HabitOnboarding', () => {
  const src = readFileSync(
    join(__dirname, '..', '..', 'components', 'HabitOnboarding.tsx'), 'utf8');

  it('uses the store rather than reimplementing canActivate', () => {
    expect(src).toContain('useWillpowerStore');
    expect(src).not.toMatch(/active_count\s*<\s*\w+\.focus_capacity/);
  });

  it('does not recompute the score', () => {
    expect(src).not.toMatch(/daily_budget\s*-\s*\w+\.used\)\s*\/\s*\w+\.daily_budget/);
  });

  it('never falls back to a fabricated 100', () => {
    // S-01 removed this from the store; :114 was the surviving copy.
    expect(src).not.toMatch(/:\s*100;/);
  });
});
