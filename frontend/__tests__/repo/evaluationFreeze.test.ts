/**
 * R11.01 — the frozen CP/CE weights and targets are exactly the plan's, and
 * nothing in the freeze claims a measured user result.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const DOCS = join(__dirname, '..', '..', '..', 'docs');
const plan = readFileSync(join(DOCS, 'plan', '22_ADERYTH_CORE_IMPLEMENTATION_V3.md'), 'utf8');
const freeze = readFileSync(join(DOCS, 'implementation-v3', 'R11_EVALUATION_FREEZE.md'), 'utf8');
const rounds = readFileSync(join(DOCS, 'implementation-v3', 'R11_USER_ROUNDS_PLAN.md'), 'utf8');

type Row = { id: string; weight: number; target: number };
const num = (s: string) => Number(s.replace(',', '.'));
function rows(text: string, prefix: 'CP' | 'CE', percent: boolean): Row[] {
  const re = percent
    ? new RegExp(`^\\| (${prefix}0\\d) [^|]+\\| %(\\d+) \\| ([\\d,]+) \\|`, 'gm')
    : new RegExp(`^\\| (${prefix}0\\d) [^|]+\\| (\\d+) \\| ([\\d,]+) \\|`, 'gm');
  return [...text.matchAll(re)].map((m) => ({ id: m[1], weight: Number(m[2]), target: num(m[3]) }));
}

describe.each(['CP', 'CE'] as const)('%s matrix', (p) => {
  const fromPlan = rows(plan, p, true);
  const frozen = rows(freeze, p, false);
  it('frozen = plan, row for row', () => {
    expect(fromPlan.length).toBe(p === 'CP' ? 8 : 7);
    expect(frozen).toEqual(fromPlan);
  });
  it('weights sum to 100; the weighted target is the plan\'s', () => {
    expect(frozen.reduce((s, r) => s + r.weight, 0)).toBe(100);
    const t = frozen.reduce((s, r) => s + r.weight * r.target, 0) / 100;
    expect(t).toBeCloseTo(p === 'CP' ? 9.31 : 9.275, 3);
  });
});

it('no user-task or device measure is claimed: each CP row says N/R for what was not observed', () => {
  const cp = freeze.split('\n').filter((l) => /^\| CP0\d /.test(l));
  expect(cp).toHaveLength(8);
  for (const l of cp) expect(l).toMatch(/\*\*N\/R\*\*/);
  expect(freeze).not.toMatch(/\b9[,.]\d+ (puan|aldı|ölçüldü)/);
});

it('the rounds plan keeps the card\'s sample and separates the measures', () => {
  expect(rounds).toMatch(/5–8 hedef kullanıcı/);
  expect(rounds).toMatch(/yürütme N\/R/);
  for (const m of ['Yardımsız başarı', 'Süre', 'Yardım sayısı', 'Yanlış yan etki']) expect(rounds).toContain(`| ${m} |`);
  expect((rounds.match(/^\| G\d /gm) ?? []).length).toBe(7);
});
