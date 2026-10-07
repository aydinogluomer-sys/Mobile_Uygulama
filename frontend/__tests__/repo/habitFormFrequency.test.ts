/**
 * R01.02-e — the habit form's frequency step, locked at the source.
 *
 * `lib/frequencyForm.test.ts` proves the transitions; this file proves the
 * FORM uses them (and nothing else) to build `frequency_config`, so the state
 * space tested there is the form's real state space. Same instrument as
 * `periodConsumerMigration.test.ts`: anchored to code lines, comments ignored.
 *
 * A9: `screenAccessibility.test.ts` scans `app/screens` only, so this
 * component (in `components/`) was never covered. The new controls block is
 * scanned here, tag by tag, with a tokenizer that ignores comments and strings
 * -- and the tokenizer is tested on a synthetic violation first.
 *
 * KD-09 — the controls were extracted into `components/FrequencyEditor.tsx` so
 * habit-detail can edit a habit's schedule with the SAME controls. Every
 * assertion about the controls now reads that file; the ones about what the
 * FORM does with a change (recost, the Devam gate, the summary, DEFAULT_FORM)
 * still read the form. Nothing was dropped -- each moved with the code it
 * describes, and two were added: the form hands the editor its recosting
 * `updateFreq`, and the editor never writes `frequency_config` itself.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const root = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const codeLines = (src: string) => src.split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(l));

const FORM = 'components/HabitOnboarding.tsx';
const EDITOR = 'components/FrequencyEditor.tsx';
const LIB = 'lib/frequencyForm.ts';

describe('R01.02-e — the form builds frequency_config only through lib/frequencyForm', () => {
  const code = codeLines(read(FORM));
  const ed = codeLines(read(EDITOR));

  it('NEGATIVE — the old `{ kind }` reset is gone (red if it comes back)', () => {
    expect(code.some((l) => /frequency_config:\s*\{\s*kind\s*\}/.test(l))).toBe(false);
    expect(ed.some((l) => /frequency_config:\s*\{\s*kind\s*\}/.test(l))).toBe(false);
  });

  it('setKind goes through setFrequencyKind', () => {
    expect(ed.some((l) => /function setKind\(kind: FrequencyConfig\['kind'\]\) \{ updateFreq\(setFrequencyKind\(freq, kind\)\); \}/.test(l))).toBe(true);
  });

  it('every frequency change is recosted (A10)', () => {
    expect(code.some((l) => /if \(next !== freq\) applyAndRecost\(\{ frequency_config: next \}\);/.test(l))).toBe(true);
  });

  it('KD-09 — the form hands the shared editor its recosting updateFreq', () => {
    expect(code.some((l) => /<FrequencyEditor value=\{freq\} onChange=\{updateFreq\} \/>/.test(l))).toBe(true);
  });

  it('KD-09 — the editor never writes frequency_config itself; it only calls onChange', () => {
    expect(ed.filter((l) => /frequency_config:/.test(l))).toEqual([]);
    expect(ed.some((l) => /if \(next !== freq\) onChange\(next\);/.test(l))).toBe(true);
  });

  it('no other frequency_config is written in the form (only DEFAULT_FORM and updateFreq)', () => {
    const writes = code.filter((l) => /frequency_config:/.test(l));
    expect(writes).toHaveLength(2);
    expect(writes.some((l) => /^\s*frequency_config: \{ kind: 'daily' \},$/.test(l))).toBe(true);  // DEFAULT_FORM, unchanged
  });

  it('has a count input (stepper) for weekly-count and monthly', () => {
    expect(ed.filter((l) => /updateFreq\(setFrequencyCount\(freq, \(freq\.count \?\? 1\) [-+] 1\)\)/.test(l))).toHaveLength(2);
    expect(ed.some((l) => /freq\.kind === 'monthly' \|\| \(freq\.kind === 'weekly' && weeklyMode === 'count'\)/.test(l))).toBe(true);
  });

  it('has the weekly sub-modes, the interval and the date envelope', () => {
    expect(ed.some((l) => /updateFreq\(setWeeklyMode\(freq, m\)\)/.test(l))).toBe(true);
    expect(ed.some((l) => /updateFreq\(setIntervalDays\(freq, n\)\)/.test(l))).toBe(true);
    expect(ed.some((l) => /updateFreq\(setRangeStart\(freq, target\)\)/.test(l))).toBe(true);
    expect(ed.some((l) => /updateFreq\(setRangeEnd\(freq, target\)\)/.test(l))).toBe(true);
  });

  it('"Devam" on step 3 is blocked while the schedule has no target', () => {
    expect(code.some((l) => /if \(step === 3\) return isFrequencyComplete\(form\.frequency_config\);/.test(l))).toBe(true);
  });

  it('the summary says the real schedule, not just the kind', () => {
    expect(code.some((l) => /const freqLabel = frequencySummary\(form\.frequency_config\);/.test(l))).toBe(true);
  });

  it('no new dependency: no date-picker import', () => {
    expect(read(FORM)).not.toMatch(/datetimepicker|date-picker|DateTimePicker/i);
    expect(read(EDITOR)).not.toMatch(/datetimepicker|date-picker|DateTimePicker/i);
  });
});

describe('R01.02-e — bounds come from the validator, not restated', () => {
  const lib = read(LIB);
  const code = codeLines(lib);

  it('imports the count and interval bounds from routineProposal', () => {
    expect(lib).toMatch(/MAX_WEEKLY_COUNT, MAX_MONTHLY_COUNT, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS, validateFrequencyConfig,/);
    expect(lib).toMatch(/from '\.\/routineProposal';/);
  });

  it('no literal 7 / 31 / 365 / 2 used as a bound on a code line', () => {
    expect(code.some((l) => /\b(31|365)\b/.test(l))).toBe(false);
    expect(code.some((l) => /Math\.(min|max)\([^)]*\b(2|7)\b/.test(l))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// A9 — accessibility of the new controls block
// ---------------------------------------------------------------------------

/** Blank comment bodies and string/template contents, keeping indices. `${}` stays code. */
function blankNonCode(src: string): string {
  const out = src.split('');
  let i = 0;
  const blank = (a: number, b: number) => { for (let k = a; k < b; k++) if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' '; };
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); const end = e < 0 ? src.length : e; blank(i, end); i = end; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); const end = e < 0 ? src.length : e + 2; blank(i, end); i = end; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) { if (src[j] === '\\') j++; j++; }
      blank(i + 1, j); i = j + 1; continue;
    }
    if (c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== '`') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1; j += 2;
          while (j < src.length && depth > 0) { if (src[j] === '{') depth++; else if (src[j] === '}') depth--; j++; }
          continue;
        }
        out[j] = ' '; j++;
      }
      i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

/** Each `<Name ...>` opening tag's own attribute text (raw), brace-depth aware. */
function openingTags(raw: string, name: string): string[] {
  const blanked = blankNonCode(raw);
  const tags: string[] = [];
  const re = new RegExp(`<${name}\\b`, 'g');
  let m: RegExpExecArray | null;
  while ((m = re.exec(blanked))) {
    let depth = 0;
    let j = m.index + m[0].length;
    for (; j < blanked.length; j++) {
      const ch = blanked[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      else if (ch === '>' && depth === 0) break;
    }
    tags.push(raw.slice(m.index, j + 1));
  }
  return tags;
}

function block(src: string): string {
  const a = src.indexOf('R01.02-e:freq-controls:start');
  const b = src.indexOf('R01.02-e:freq-controls:end');
  if (a < 0 || b < 0 || b < a) throw new Error('controls block markers missing');
  return src.slice(a, b);
}

const a11yProblems = (tag: string): string[] => {
  const p: string[] = [];
  if (!/accessibilityRole=/.test(tag)) p.push('role');
  const label = /accessibilityLabel=(\{[^]*?\}|"[^"]*")\s*(\n|\w+=|>)/.exec(tag);
  if (!label) p.push('label');
  else if (/^""$|^\{''\}$|^\{""\}$/.test(label[1])) p.push('empty label');
  if (!/accessibilityState=/.test(tag)) p.push('state');
  return p;
};

describe('A9 — the scanner itself (a broken scanner must not pass silently)', () => {
  it('catches a real violation and ignores labels hidden in comments and strings', () => {
    const synthetic = [
      '<TouchableOpacity onPress={() => x(">")} accessibilityRole="radio" accessibilityLabel="Günlük" accessibilityState={{ selected: a }}>',
      '<TouchableOpacity onPress={go} /* accessibilityLabel="x" accessibilityRole="button" accessibilityState={{}} */>',
      '<TouchableOpacity title="accessibilityLabel accessibilityRole accessibilityState" onPress={go}>',
    ].join('\n');
    const tags = openingTags(synthetic, 'TouchableOpacity');
    expect(tags).toHaveLength(3);
    expect(a11yProblems(tags[0])).toEqual([]);
    // tags 1 and 2 only mention the props in a comment / a string
    const blankedProblems = (t: string) => a11yProblems(blankNonCode(t));
    expect(blankedProblems(tags[1])).toEqual(['role', 'label', 'state']);
    expect(blankedProblems(tags[2])).toEqual(['role', 'label', 'state']);
  });
});

describe('A9 — every touchable in the new frequency controls is labelled, roled and stateful', () => {
  const raw = block(read(EDITOR));
  const tags = openingTags(raw, 'TouchableOpacity');

  it('the block really contains the controls (not a vacuous pass)', () => {
    expect(tags.length).toBeGreaterThanOrEqual(8);
  });

  it('no touchable lacks role, a non-empty label or state', () => {
    const bad = tags.map((t) => ({ t: t.slice(0, 80), p: a11yProblems(blankNonCodeKeepAttrs(t)) })).filter((x) => x.p.length > 0);
    expect(bad).toEqual([]);
  });

  it('mutually exclusive choices are radios inside a labelled radiogroup; days are checkboxes; steppers are buttons', () => {
    const groups = raw.match(/accessibilityRole="radiogroup" accessibilityLabel="[^"]+"/g) ?? [];
    expect(groups.map((g) => g.replace(/.*accessibilityLabel="/, '').replace('"', ''))).toEqual(
      ['Sıklık türü', 'Tekrar aralığı', 'Haftalık tür', 'Başlangıç tarihi', 'Bitiş tarihi']);
    expect((raw.match(/accessibilityRole="checkbox"/g) ?? []).length).toBe(1);   // the weekday map
    expect((raw.match(/accessibilityRole="button"/g) ?? []).length).toBe(2);     // − / +
  });

  it('the typed interval box is labelled with its range', () => {
    expect(raw).toMatch(/accessibilityLabel="Kaç günde bir, 2 ile 365 arası"/);
  });

  it('weekday labels are full names for screen readers, not "Pzt"', () => {
    expect(read(EDITOR)).toMatch(/const WEEKDAY_NAMES = \['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'\];/);
    expect(raw).toMatch(/accessibilityLabel=\{WEEKDAY_NAMES\[i\]\}/);
  });

  it('focus order follows the decision order: kind -> how often -> which days / how many -> dates -> summary', () => {
    const at = (s: string) => raw.indexOf(s);
    const order = ['"Sıklık türü"', '"Tekrar aralığı"', '"Haftalık tür"', 'WEEKDAY_NAMES[i]', 'bir kez azalt', '"Başlangıç tarihi"', '"Bitiş tarihi"', 'Özet:'];
    const idx = order.map(at);
    expect(idx.every((x) => x >= 0)).toBe(true);
    for (let k = 1; k < idx.length; k++) expect(idx[k]).toBeGreaterThan(idx[k - 1]);
  });

  it('touch targets reuse dayBtn / freqBtn (wideChip only adds horizontal padding)', () => {
    for (const t of tags) expect(t).toMatch(/styles\.(dayBtn|freqBtn)\b/);
    expect(read(EDITOR)).toMatch(/wideChip: \{ paddingHorizontal: 4 \},/);
  });
});

/** The real tags are scanned raw for attribute NAMES (they are code), so only comments matter here. */
function blankNonCodeKeepAttrs(tag: string): string {
  return tag.replace(/\/\*[^]*?\*\//g, (m) => ' '.repeat(m.length)).replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
}
