/**
 * R01.02-d A7 — frequency configs that carry NONE of the three newly accepted
 * keys (`interval_days`, `range_start`, `range_end`), valid and invalid alike.
 *
 * `validatorPreservation.test.ts` pins `validateFrequencyConfig`'s result for
 * each of these as captured at HEAD `1cd0bc9`, before the validator learned
 * the new keys. Opening the validator must not change any of them.
 */
export const VALIDATOR_CORPUS_RANGELESS: unknown[] = [
  // valid
  { kind: 'daily' },
  { kind: 'daily', part_of_day: ['morning'] },
  { kind: 'daily', part_of_day: ['morning', 'evening'] },
  { kind: 'weekly', days: [4, 0, 2] },
  { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6] },
  { kind: 'weekly', count: 1 },
  { kind: 'weekly', count: 7 },
  { kind: 'weekly', days: [1], count: 2 },
  { kind: 'monthly', count: 10 },
  { kind: 'monthly', count: 31 },
  { kind: 'monthly' },
  // invalid
  { kind: 'weekly' },
  { kind: 'weekly', count: 8 },
  { kind: 'weekly', count: 0 },
  { kind: 'weekly', count: 2.5 },
  { kind: 'monthly', count: 32 },
  { kind: 'daily', count: 3 },
  { kind: 'daily', days: [0] },
  { kind: 'weekly', days: [] },
  { kind: 'weekly', days: [7] },
  { kind: 'weekly', days: [0, 0] },
  { kind: 'weekly', days: '0,2' },
  { kind: 'daily', part_of_day: [] },
  { kind: 'daily', part_of_day: ['night'] },
  { kind: 'daily', part_of_day: ['morning', 'morning'] },
  { kind: 'fortnightly' },
  {},
  'daily',
  null,
  [],
  { kind: 'daily', foo: 1 },
  { kind: 'weekly', days: [0], bar: true, baz: null },
  JSON.parse('{"kind":"daily","__proto__":{"x":1}}'),
  JSON.parse('{"kind":"daily","constructor":1}'),
];
