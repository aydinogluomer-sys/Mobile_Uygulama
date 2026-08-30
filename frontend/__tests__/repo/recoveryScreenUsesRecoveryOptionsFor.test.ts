/**
 * W3 source-level invariant (task Phase-1 CODER-F): `app/screens/recovery.tsx`
 * must actually reach `recoveryStore.recoveryOptionsFor` -- today it makes
 * the user pick a raw legacy `strategy` from `STRATEGY_META` with no notion
 * of the real computed deficit (Plan §9).
 *
 * Written in the style of `__tests__/repo/rule4NoDirectDbInUi.test.ts` /
 * `logHabitErrorsSurfaced.test.ts`: a property of the SOURCE TEXT. Genuinely
 * red before W3 -- `recoveryOptionsFor` has zero callers today (per the
 * task: "recoveryOptionsFor exists and is called by nothing").
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const RECOVERY_TSX = join(__dirname, '..', '..', 'app', 'screens', 'recovery.tsx');

describe('W3 -- recovery.tsx reaches recoveryOptionsFor', () => {
  const src = readFileSync(RECOVERY_TSX, 'utf8');

  it('calls recoveryOptionsFor(', () => {
    expect(src).toMatch(/\brecoveryOptionsFor\s*\(/);
  });

  it('destructures recoveryOptionsFor from useRecoveryStore()', () => {
    const line = src.split('\n').find((l) => l.includes('useRecoveryStore()'));
    expect(line).toBeDefined();
    expect(line).toContain('recoveryOptionsFor');
  });

  it('preserves STRATEGY_META -- W3 does not remove the existing strategy picker', () => {
    expect(src).toContain('STRATEGY_META');
  });

  it('preserves the existing plan list/complete/skip/delete flows', () => {
    // `completePlan` is now reached through the service, which owns the
    // log-before-close ordering; the other three are unchanged store actions.
    expect(src).toContain('completePlanWithMakeup(');
    expect(src).toContain('skipPlan(');
    expect(src).toContain('deletePlan(');
    expect(src).toContain('addPlan(');
  });
});
