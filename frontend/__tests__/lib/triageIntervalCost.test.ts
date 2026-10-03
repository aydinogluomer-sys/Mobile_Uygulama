/**
 * R01.02-d2 (KD-07) — willpower cost reads interval_days.
 *
 * `costBreakdown` priced by `frequency_config.kind` only, so "every 3 days"
 * (a 'daily' row) cost the full daily factor 1.0. FREQ_FACTOR is a hand-tuned
 * JUDGEMENT table (daily 1.0 / weekly 0.7 / monthly 0.5 -- a 7x frequency
 * difference is only a 1.43x cost difference), so the interval factor is
 * interpolated between those anchors by occurrences per week, never 1/N:
 * 1/3 = 0.33 would make "every 3 days" cheaper than weekly though it happens
 * more often.
 *
 * A3 monotone in the interval · A4 the kind ordering holds · A5 count · A6 the
 * breakdown says where the factor came from. (A7: costPreservation.test.ts.)
 */
import { costBreakdown, computeWillpowerCost, type CostInput } from '../../lib/triage';

const base: Omit<CostInput, 'frequency_config'> = {
  difficulty: 5, impact_level: null, behavior_type: 'positive', tracking_type: 'boolean', estimated_minutes: 0,
};
const of = (frequency_config: CostInput['frequency_config']) => costBreakdown({ ...base, frequency_config });
const every = (n: number) => of({ kind: 'daily', interval_days: n });
const factor = (b: ReturnType<typeof costBreakdown>) => b.freqFactor;

describe('R01.02-d2 — the interval factor', () => {
  it('A1 — every 3 days sits between weekly (0.7) and daily (1.0), at 0.7 + (7/3 - 1)/6 * 0.3', () => {
    expect(factor(every(3))).toBeCloseTo(0.7 + ((7 / 3 - 1) / 6) * 0.3, 12);
  });

  it('NEGATIVE — every 3 days is not priced as daily (red if 1.0)', () => {
    expect(factor(every(3))).toBeLessThan(factor(of({ kind: 'daily' })));
  });

  it('NEGATIVE — every 3 days is never cheaper than weekly (red if 1/N)', () => {
    expect(factor(every(3))).toBeGreaterThan(factor(of({ kind: 'weekly' })));
    expect(factor(every(3))).not.toBeCloseTo(1 / 3, 3);
  });

  it('A2 — every 2 days and every 7 days land on the anchors\' line; every 7 = weekly', () => {
    expect(factor(every(2))).toBeCloseTo(0.7 + ((3.5 - 1) / 6) * 0.3, 12);
    expect(factor(every(7))).toBeCloseTo(0.7, 12);
  });

  it('A3 — the factor and the final cost never rise as the interval grows (1..14); interval 1 is plain daily', () => {
    const fs = Array.from({ length: 14 }, (_, i) => factor(every(i + 1)));
    for (let i = 1; i < fs.length; i++) expect(fs[i]).toBeLessThanOrEqual(fs[i - 1]);
    const cs = Array.from({ length: 14 }, (_, i) => computeWillpowerCost({ ...base, frequency_config: { kind: 'daily', interval_days: i + 1 } }));
    for (let i = 1; i < cs.length; i++) expect(cs[i]).toBeLessThanOrEqual(cs[i - 1]);
    expect(every(1)).toEqual(of({ kind: 'daily' }));
  });

  it('A3 — also beyond a week, down to the monthly anchor, never below it', () => {
    const fs = [7, 10, 14, 30, 60, 365].map((n) => factor(every(n)));
    for (let i = 1; i < fs.length; i++) expect(fs[i]).toBeLessThanOrEqual(fs[i - 1]);
    for (const f of fs) expect(f).toBeGreaterThanOrEqual(0.5);
    expect(factor(every(365))).toBe(0.5);
  });

  it('A4 — daily >= every 2 >= every 3 >= ... >= every 7 >= weekly >= monthly', () => {
    const chain = [
      factor(of({ kind: 'daily' })),
      ...[2, 3, 4, 5, 6, 7].map((n) => factor(every(n))),
      factor(of({ kind: 'weekly' })),
      factor(of({ kind: 'monthly' })),
    ];
    for (let i = 1; i < chain.length; i++) expect(chain[i]).toBeLessThanOrEqual(chain[i - 1]);
  });

  it('A4 — the same ordering holds for the rounded cost a user actually sees', () => {
    for (const difficulty of [1, 3, 5]) {
      for (const behavior_type of ['positive', 'negative'] as const) {
        const c = (frequency_config: CostInput['frequency_config']) =>
          computeWillpowerCost({ ...base, difficulty, behavior_type, frequency_config });
        const chain = [
          c({ kind: 'daily' }),
          ...[2, 3, 4, 5, 6, 7].map((n) => c({ kind: 'daily', interval_days: n })),
          c({ kind: 'weekly' }),
          c({ kind: 'monthly' }),
        ];
        for (let i = 1; i < chain.length; i++) expect(chain[i]).toBeLessThanOrEqual(chain[i - 1]);
      }
    }
  });

  it('A5 — interval and count together count; the factor never exceeds daily', () => {
    const withCount = (n: number, count: number) =>
      factor(of({ kind: 'daily', interval_days: n, count } as CostInput['frequency_config']));
    expect(withCount(3, 2)).toBeGreaterThan(factor(every(3)));   // 14/3 a week > 7/3
    expect(withCount(2, 5)).toBe(1.0);                            // 17.5 a week: clamped at daily
  });

  it('A6 — the breakdown says the factor came from an interval, and shows the inputs', () => {
    const b = every(3);
    expect(b).toMatchObject({ freqKind: 'daily', freqSource: 'interval', intervalDays: 3 });
    expect(b.perWeek).toBeCloseTo(7 / 3, 12);
    expect(b.base).toBeCloseTo(b.diff * b.freqFactor, 12);
  });

  it('A6 — rows without an interval carry no interval fields (their breakdown is unchanged)', () => {
    for (const f of [{ kind: 'daily' }, { kind: 'weekly' }, { kind: 'monthly' }, { kind: 'daily', interval_days: 1 }] as const) {
      const b = of(f as CostInput['frequency_config']);
      expect(b).not.toHaveProperty('freqSource');
      expect(b).not.toHaveProperty('intervalDays');
    }
  });

  it('interval on a non-daily kind is not "every N days" and keeps the table factor', () => {
    expect(factor(of({ kind: 'weekly', interval_days: 3 }))).toBe(0.7);
    expect(factor(of({ kind: 'monthly', interval_days: 3 }))).toBe(0.5);
  });
});

describe('R01.02-d2 A8 — one frequency -> occurrences mapping', () => {
  // Source-text check, same instrument as capacitySingleSourceOfTruth: triage
  // must READ capacity's mapping, not grow its own.
  const { readFileSync, readdirSync, statSync } = jest.requireActual<typeof import('fs')>('fs');
  const { join } = jest.requireActual<typeof import('path')>('path');
  const root = join(__dirname, '..', '..');
  const code = (p: string) => readFileSync(join(root, p), 'utf8').split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/)/.test(l));

  it('triage imports occurrencesPerWeek from capacity', () => {
    expect(code('lib/triage.ts').some((l) => /^import \{ occurrencesPerWeek \} from '\.\/capacity';$/.test(l))).toBe(true);
  });

  it('triage computes no frequency of its own (no "7 /", no interval division)', () => {
    const t = code('lib/triage.ts');
    expect(t.some((l) => /\b7\s*\/|\/\s*(fc\.)?interval_days|\/\s*intervalDays/.test(l))).toBe(false);
  });

  it('occurrencesPerWeek is defined in exactly one production module', () => {
    const walk = (d: string): string[] => readdirSync(d).flatMap((e) => {
      const p = join(d, e);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e) ? [p] : [];
    });
    const defs = ['lib', 'services', 'store', 'components', 'app'].flatMap((d) => walk(join(root, d)))
      .filter((f) => /function occurrencesPerWeek\s*\(/.test(readFileSync(f, 'utf8')));
    expect(defs.map((f) => f.slice(root.length + 1).split('\\').join('/'))).toEqual(['lib/capacity.ts']);
  });
});
