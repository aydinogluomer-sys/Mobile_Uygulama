/**
 * F13 — Direction-aware recovery deficit and fractional two-day split (DOM-13).
 */
import { deficitFor, recoveryOptions } from '../../lib/recovery';

describe('F13 DOM-13 — deficitFor respects target_direction and avoids floating-point noise', () => {
  it('at_most ceiling habit returns binary deficit (miss -> 1, done -> 0), never inverted t - v', () => {
    expect(deficitFor({ trackingType: 'numeric', target: 2, value: 0, state: 'miss', direction: 'at_most' }))
      .toEqual({ type: 'binary', value: 1 });
    expect(deficitFor({ trackingType: 'numeric', target: 2, value: 0, state: 'done', direction: 'at_most' }))
      .toEqual({ type: 'binary', value: 0 });
  });

  it('omitted direction and at_least preserve Plan §9 example (10000 - 8000 = 2000) and clean 10 - 9.9 = 0.1', () => {
    expect(deficitFor({ trackingType: 'numeric', target: 10000, value: 8000 }))
      .toEqual({ type: 'numeric', value: 2000 });
    expect(deficitFor({ trackingType: 'numeric', target: 10000, value: 8000, direction: 'at_least' }))
      .toEqual({ type: 'numeric', value: 2000 });
    expect(deficitFor({ trackingType: 'numeric', target: 10, value: 9.9, state: 'partial', direction: 'at_least' }))
      .toEqual({ type: 'numeric', value: 0.1 });
  });
});

describe('F13 DOM-13 — splitAcrossDays (via recoveryOptions) splits fractional and integer deficits cleanly', () => {
  const splitOf = (type: 'numeric' | 'binary', value: number) =>
    recoveryOptions({ type, value }, { fromDate: '2026-08-10' })
      .find((o) => o.strategy === 'split_two_days')!.distributed_days;

  it('splits fractional deficits evenly without rounding 0.5 up to 1', () => {
    expect(splitOf('numeric', 0.5)).toEqual([
      { date: '2026-08-11', value: 0.25 },
      { date: '2026-08-12', value: 0.25 },
    ]);
    expect(splitOf('numeric', 0.3)).toEqual([
      { date: '2026-08-11', value: 0.15 },
      { date: '2026-08-12', value: 0.15 },
    ]);
  });

  it('preserves integer splits: 2001 -> 1001 + 1000, 2000 -> 1000 + 1000, binary 1 -> single day 1', () => {
    expect(splitOf('numeric', 2001)).toEqual([
      { date: '2026-08-11', value: 1001 },
      { date: '2026-08-12', value: 1000 },
    ]);
    expect(splitOf('numeric', 2000)).toEqual([
      { date: '2026-08-11', value: 1000 },
      { date: '2026-08-12', value: 1000 },
    ]);
    expect(splitOf('binary', 1)).toEqual([
      { date: '2026-08-11', value: 1 },
    ]);
  });
});
