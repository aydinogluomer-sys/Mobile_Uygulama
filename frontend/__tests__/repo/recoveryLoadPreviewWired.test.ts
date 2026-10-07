/**
 * R03.05 — the recovery sheet shows the target day's load before planning,
 * sized by the chosen strategy, and never uses it to block the plan.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const src = stripComments(readFileSync(join(__dirname, '..', '..', 'app/screens/recovery.tsx'), 'utf8'));

describe('R03.05 — recovery load preview', () => {
  it('the share follows the strategy: skip adds nothing, split adds half', () => {
    expect(src).toMatch(/const makeupShare = strategy === 'skip' \? 0 : strategy === 'split_two_days' \? 0\.5 : 1;/);
  });
  it('previews the day the plan targets, with that day\'s tasks and planned make-ups', () => {
    expect(src).toMatch(/makeupLoadPreview\(\{/);
    expect(src).toMatch(/day: addDays\(new Date\(\), whenOffset\),/);
    expect(src).toMatch(/t\.due_date === targetDate/);
    expect(src).toMatch(/pl\.status === 'planned' && pl\.target_date === targetDate/);
  });
  it('is shown in the sheet', () => {
    expect(src).toMatch(/O GÜNÜN YÜKÜ/);
    expect(src).toMatch(/\{loadPreview\.before\} → \{loadPreview\.after\} \/ 100/);
  });
  it('does not gate the plan: submitPlan never reads the preview', () => {
    const fn = src.slice(src.indexOf('async function submitPlan('), src.indexOf('\n  }\n', src.indexOf('async function submitPlan(')));
    expect(fn).not.toMatch(/loadPreview/);
  });
});
