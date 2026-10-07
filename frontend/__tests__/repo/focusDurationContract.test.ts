/**
 * R05.06 — both focus surfaces are bound to lib/focusDuration, and a break
 * is never focus time.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const read = (p: string) => stripComments(readFileSync(join(__dirname, '..', '..', p), 'utf8'));

describe('R05.06 — one seconds->minutes rule', () => {
  it.each(['lib/reportMetrics.ts', 'lib/focusReport.ts'])('%s converts through secondsToMinutes', (p) => {
    const src = read(p);
    expect(src).toMatch(/import \{ secondsToMinutes \} from '\.\/focusDuration';/);
    // no private seconds->minutes rounding left behind (minutes->hours is fine)
    expect(src).not.toMatch(/Math\.(round|floor|ceil)\(\s*\w*[sS]ec\w*\s*\/\s*60\s*\)/);
  });
});

describe('R05.06 — a typed duration goes through the contract', () => {
  const repo = read('repositories/deepWorkRepository.ts');
  const screen = read('app/screens/deep-work.tsx');

  it('the repository refuses a duration outside the contract before writing', () => {
    expect(repo).toMatch(/const parsed = parseManualMinutes\(input\.minutes\);\s*if \(!parsed\.ok\) return \{ ok: false, error: parsed\.reason \};/);
    expect(repo).not.toMatch(/Math\.max\(0, Math\.round\(input\.minutes\)\)/);
  });

  it('the screen validates with the same contract and keeps the sheet open on a failed save', () => {
    expect(screen).toMatch(/const parsed = parseManualMinutes\(minutes\);/);
    expect(screen).not.toMatch(/parseInt\(minutes/);
    expect(screen).toMatch(/if \(!saved\) \{ setEntryError\(/);
  });

  it('the field says what the number means', () => {
    expect(screen).toMatch(/Aktif süre \(molalar hariç\)/);
  });
});

describe('R05.06 — a break is not focus and earns nothing', () => {
  const store = read('store/focusStore.ts');
  it('only a work phase writes a focus session', () => {
    const body = store.slice(store.indexOf('async function advancePhase('));
    expect(body).toMatch(/if \(phase === 'work'\) \{\s*const selectedTask[\s\S]*?await completeWorkPhase\(/);
    expect(body.match(/completeWorkPhase\(/g)).toHaveLength(1);
  });
  it('neither focus surface awards XP', () => {
    for (const p of ['services/focusService.ts', 'store/focusStore.ts', 'store/deepWorkStore.ts', 'repositories/deepWorkRepository.ts']) {
      expect(read(p)).not.toMatch(/\bxp\b|add_xp|awardXp/i);
    }
  });
});
