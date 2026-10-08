/**
 * R10.09 / R11.06 — the acceptance report is built from the audit and cannot
 * drift from it; the audit has no PARTIAL or NOT_STARTED card left; every
 * DONE card names a commit; the closure keeps three separate results and
 * does not claim the unmeasured target.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const DOC = join(__dirname, '..', '..', '..', 'docs', 'implementation-v3');
const audit = readFileSync(join(DOC, 'CORE_AUDIT.md'), 'utf8');
const report = readFileSync(join(DOC, 'R10_ACCEPTANCE_REPORT.md'), 'utf8');
const closure = readFileSync(join(DOC, 'R11_CORE_CLOSURE.md'), 'utf8');
const pr = readFileSync(join(DOC, 'PR_DESCRIPTION.md'), 'utf8');

const cards = audit.split('\n').filter((l) => /^\| R\d\d\.\d\d /.test(l)).map((l) => {
  const c = l.split(' | ');
  return { id: c[0].slice(2).trim(), status: c[1].trim(), evidence: c.slice(2).join(' | ') };
});
const kind = (s: string) => s.split(/[\s(]/)[0];
const count = (k: string) => cards.filter((c) => kind(c.status) === k).length;

it('the audit covers R00.01..R11.06 with no PARTIAL or NOT_STARTED left', () => {
  expect(cards).toHaveLength(86);
  expect(cards.filter((c) => ['PARTIAL', 'NOT_STARTED'].includes(kind(c.status))).map((c) => c.id)).toEqual([]);
});

it('every DONE card names a commit (a hash, not a placeholder)', () => {
  const noCommit = cards.filter((c) => kind(c.status) === 'DONE' && !/`[0-9a-f]{7}`/.test(c.evidence) && !/commit R\d\d\.\d\d/.test(c.evidence));
  expect(noCommit.map((c) => c.id)).toEqual([]);
});

it('the report\'s numbers are the audit\'s', () => {
  const cell = (label: string) => Number(new RegExp(`\\| ${label}[^|]*\\| \\**(\\d+)`).exec(report)![1]);
  expect(cell('Kart')).toBe(cards.length);
  expect(cell('DONE')).toBe(count('DONE'));
  expect(cell('BLOCKED')).toBe(count('BLOCKED'));
  expect(cell('N/R')).toBe(count('N/R'));
  expect(report).toMatch(/\| PARTIAL \/ NOT_STARTED \| \*\*0\*\* \|/);
  const pk = [...report.matchAll(/^\| R\d\d [^|]+\| (\d+)\/(\d+)/gm)];
  expect(pk.reduce((s, m) => s + Number(m[1]), 0)).toBe(count('DONE'));
  expect(pk.reduce((s, m) => s + Number(m[2]), 0)).toBe(cards.length);
});

it('no independent PASS is claimed anywhere; the closure keeps three results and the target unproven', () => {
  // every line that mentions a PASS must be a line that denies one
  for (const t of [report, closure, pr]) {
    const claims = t.split('\n').filter((l) => /PASS/.test(l) && !/(yok|yazılmaz|nothing here says)/.test(l));
    expect(claims).toEqual([]);
  }
  expect(closure).toMatch(/## CORE_IMPLEMENTATION:/);
  expect(closure).toMatch(/## CORE_QUALITY: NOT_MEASURED/);
  expect(closure).toMatch(/## RELEASE_READINESS: DEFERRED/);
  // the closure's own result line, not the quoted card text
  expect(closure).toMatch(/^- \*\*9–9,5 hedefi: hedef, henüz kanıtlanmadı\.\*\*/m);
  expect(closure).not.toMatch(/karşılandı|kanıtlandı\b/);
  expect(pr).toContain(`**${count('DONE')} DONE**`);
});
