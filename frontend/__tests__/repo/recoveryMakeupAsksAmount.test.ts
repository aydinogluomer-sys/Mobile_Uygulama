/**
 * KD-12 — the recovery screen asks for a measurable make-up's amount.
 *
 * The service refuses a measurable make-up without an amount
 * (`__tests__/services/recoveryMakeup.test.ts`). This pins the other half: the
 * screen actually branches to the prompt BEFORE either write path, so the
 * refusal is never what a user sees, and the backlog "yaptım" can no longer
 * write a bare `done` for a habit that has an amount.
 *
 * Source-text invariant, same instrument as `periodConsumerMigration.test.ts`.
 * Anchored to code lines; a comment mentioning these names must not pass it.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');
const src = readFileSync(join(root, 'app/screens/recovery.tsx'), 'utf8');
const code = src.split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/|\{\/\*)/.test(l)).join('\n');

/** The body of `async function <name>(` up to the next top-level function in the component. */
function body(name: string): string {
  const start = code.indexOf(`async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = code.indexOf('\n  async function ', start + 1);
  const nextFn = code.indexOf('\n  function ', start + 1);
  const ends = [next, nextFn].filter((i) => i > -1);
  return code.slice(start, ends.length ? Math.min(...ends) : undefined);
}

describe('KD-12 — recovery asks before it writes a measurable make-up', () => {
  for (const fn of ['handleLogNow', 'handleCompletePlan']) {
    it(`${fn} checks makeupNeedsValue before its write`, () => {
      const b = body(fn);
      // Anchored to the WHOLE condition: a short-circuit like
      // `if (false && makeupNeedsValue(h))` keeps the name in the text and
      // disables the branch -- a bare indexOf passed that mutation.
      const m = /\n\s*if \(makeupNeedsValue\(\w+\)\) \{/.exec(b);
      const gate = m ? m.index : -1;
      const write = Math.max(b.indexOf('logHabit('), b.indexOf('completePlanWithMakeup('));
      expect(gate).toBeGreaterThan(-1);
      expect(write).toBeGreaterThan(-1);
      expect(gate).toBeLessThan(write);
      // and the gated branch opens the prompt rather than writing
      expect(b.slice(gate, write)).toMatch(/setMakeupTarget\(/);
    });
  }

  it('the confirm handler derives the state from the amount, never chooses it', () => {
    const b = body('handleMakeupConfirm');
    expect(b).toMatch(/measuredEntryFor\(/);
    expect(b).toMatch(/enteredValue:\s*entered/);
    expect(b).toMatch(/state:\s*intent\.state/);
    expect(b).not.toMatch(/state:\s*'done'/);
  });

  it('the prompt is the shared measurable modal, labelled with the day it writes to', () => {
    expect(code).toMatch(/<MeasurableInputModal/);
    expect(code).toMatch(/dayLabel=\{/);
    expect(code).toMatch(/onConfirm=\{handleMakeupConfirm\}/);
  });
});
