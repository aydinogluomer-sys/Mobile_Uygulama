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
    // Every session write sits under a work-phase condition (the pomodoro, and
    // since R03.03 the small step) -- the nearest `if (` before each call.
    const calls = [...body.matchAll(/completeWorkPhase\(/g)].map((m) => m.index!);
    expect(calls.length).toBeGreaterThanOrEqual(1);
    for (const at of calls) {
      const before = body.slice(0, at);
      const cond = before.slice(before.lastIndexOf('if ('));
      expect(cond.split('\n')[0]).toMatch(/phase === 'work'/);
    }
  });
  it('partial session writes in focusStore are also gated on work phase only (F16)', () => {
    const partialCalls = [...store.matchAll(/recordPartialWorkPhase\(/g)];
    expect(partialCalls.length).toBeGreaterThanOrEqual(2);
    const abandonedIdx = store.indexOf('function recordAbandoned(');
    const staleIdx = store.indexOf('function recordStaleSnapshot(');
    expect(abandonedIdx).toBeGreaterThan(-1);
    expect(staleIdx).toBeGreaterThan(-1);
    const abandonedBody = store.slice(abandonedIdx, store.indexOf('\n}', abandonedIdx) + 2);
    expect(abandonedBody).toMatch(/st\.phase !== 'work'/);
    expect(store).toMatch(/if \(snap\.phase === 'work'\) recordStaleSnapshot\(snap\)/);
  });
  it('neither focus surface awards XP', () => {
    for (const p of ['services/focusService.ts', 'store/focusStore.ts', 'store/deepWorkStore.ts', 'repositories/deepWorkRepository.ts']) {
      expect(read(p)).not.toMatch(/\bxp\b|add_xp|awardXp/i);
    }
  });
});
