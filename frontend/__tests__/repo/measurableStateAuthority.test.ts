/**
 * R01.03-a A6 / A8 — no screen decides a measurable day's state.
 *
 * `services/habitLogService.stateForValue`'s doc claimed "there is one answer
 * and it lives here" while `app/tabs/timeline.tsx` still computed
 * `value >= getRemainingValue(...) ? 'done' : 'partial'`. Source-text
 * invariant, anchored to code lines; comments neither pass nor fail it.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeLines = (src: string) => src.split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(l));

function fnBody(src: string, signature: RegExp): string {
  const m = signature.exec(src);
  if (!m) throw new Error(`not found: ${signature}`);
  let depth = 0;
  let started = false;
  for (let i = m.index; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    else if (src[i] === '}') { depth--; if (started && depth === 0) return src.slice(m.index, i + 1); }
  }
  throw new Error('unbalanced');
}

describe('A6 — timeline hands the day total to the service', () => {
  const src = read('app/tabs/timeline.tsx');
  const submit = codeLines(fnBody(src, /const handleMeasurableSubmit = async \(entered: number\) => \{/)).join('\n');

  it('NEGATIVE — no `value >=` / `>= getRemainingValue` state arithmetic anywhere in the screen (red if it returns)', () => {
    const code = codeLines(src);
    expect(code.some((l) => /\bvalue\s*>=/.test(l))).toBe(false);
    expect(code.some((l) => />=\s*getRemainingValue\(/.test(l))).toBe(false);
  });

  it('the submit handler computes no state: no deriveState, no direction branch, no remaining', () => {
    expect(submit).not.toMatch(/deriveState|stateForValue|getRemainingValue|target_direction|'done'|'partial'|'miss'/);
  });

  it('it asks the service and writes what the service returned', () => {
    expect(submit).toMatch(/const prior = getLogForHabit\(measureHabit\.id, selectedDate\)\?\.value;/);
    expect(submit).toMatch(/const intent = measuredEntryFor\(measureHabit, prior, entered\);/);
    expect(submit).toMatch(/state: intent\.state,/);
    expect(submit).toMatch(/value: intent\.value,/);
  });

  it('getRemainingValue is display-only in the screen (never next to a state)', () => {
    const uses = codeLines(src).filter((l) => /getRemainingValue\(/.test(l));
    for (const l of uses) expect(l).not.toMatch(/state|'done'|'partial'|>=/);
  });

  it('the modal is given the real day total, not goal - remaining', () => {
    expect(codeLines(src).some((l) => /currentValue=\{measureHabit \? \(getLogForHabit\(measureHabit\.id, selectedDate\)\?\.value \?\? 0\) : 0\}/.test(l))).toBe(true);
  });
});

describe('A6 — the modal says what the number means', () => {
  const src = read('components/MeasurableInputModal.tsx');

  it('it adds to today, and says the total is what is saved', () => {
    expect(src).toMatch(/Bugüne ne kadar ekleyelim\?/);
    expect(src).toMatch(/Girdiğin sayı bugünkü toplama eklenir/);
    expect(src).toMatch(/Kaydedince bugün: \$\{totalAfter\}/);
  });

  it('its preview uses the same add as the write', () => {
    expect(src).toMatch(/import \{ dayTotalAfterEntry \} from '\.\.\/services\/habitLogService';/);
    expect(src).toMatch(/dayTotalAfterEntry\(currentValue, parsed\)/);
  });

  it('a ceiling may enter 0 (a clean day); a floor still needs > 0', () => {
    expect(src).toMatch(/const valid = !isNaN\(parsed\) && \(ceiling \? parsed >= 0 : parsed > 0\);/);
  });
});

describe('A6 — no other screen or component derives a measurable state from arithmetic', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((e) => {
    const p = join(d, e);
    return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(e) ? [p] : [];
  });
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'components'))];

  it('the scan covers the UI tree', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('no `>= remaining`-style state choice in app/ or components/', () => {
    const offenders = files.filter((f) => codeLines(readFileSync(f, 'utf8'))
      .some((l) => /(>=|<=)\s*(remaining|getRemainingValue)/.test(l) && /'done'|'partial'/.test(l)));
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([]);
  });
});

describe('A8 — logHabit is still the one write point', () => {
  it('the timeline submit writes through logHabit only', () => {
    const src = read('app/tabs/timeline.tsx');
    const submit = fnBody(src, /const handleMeasurableSubmit = async \(entered: number\) => \{/);
    expect(submit).toMatch(/await logHabit\(\{/);
    expect(submit).not.toMatch(/persistCompletion|insertHabitLog|updateHabitLog|supabase/);
  });

  it('the service helper itself does not write', () => {
    const svc = read('services/habitLogService.ts');
    const helper = fnBody(svc, /export function measuredEntryFor\(/);
    expect(helper).not.toMatch(/repo|insert|update|persist/i);
  });
});
