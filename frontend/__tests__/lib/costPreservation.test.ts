/**
 * R01.02-d2 A7 — NO REGRESSION for any input without an effective interval.
 *
 * The corpus (`__tests__/helpers/costCorpus.ts`: 30 frequency shapes incl.
 * `interval_days` <= 1 and interval on non-daily kinds, x difficulty x
 * minutes x behaviour x tracking x impact; 30 + 360 + 4 + 4500 inputs) was run
 * through occurrencesPerWeek, frequencyWeight, habitLoad, habitLoadPoints,
 * dailyLoad, costBreakdown and computeWillpowerCost at HEAD 70bd0d6, BEFORE
 * capacity/triage learned interval_days. `occurrencesPerWeek` and
 * `frequencyWeight` were private then; they were captured from a verbatim
 * copy of that file with only the `export` keyword added.
 *
 * The full output is ~730 KB, so it is pinned by SHA-256 of its canonical
 * JSON (byte identity, by definition), per function, and the small arrays are
 * embedded verbatim so a failure is readable. Recomputed after the change:
 * byte-identical.
 *
 * `frequencyWeight` is still private; it is recovered exactly as
 * `habitLoad` at difficulty 5 / 90 minutes, where difficultyWeight and
 * durationWeight are both exactly 1.0.
 */
import { createHash } from 'crypto';
import { FREQ_CORPUS, LOAD_CORPUS, COST_CORPUS, DAY_CORPUS } from '../helpers/costCorpus';
import { habitLoad, habitLoadPoints, dailyLoad, occurrencesPerWeek } from '../../lib/capacity';
import { costBreakdown, computeWillpowerCost } from '../../lib/triage';
import type { FrequencyConfig } from '../../lib/supabase';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

// F14 (INT-04): MIN_DURATION_MINUTES = 1 replaces 0-minute zero-load items in
// LOAD_CORPUS / DAY_CORPUS (days 0 and 1 include estimated_minutes = 0); every
// estimated_minutes > 0 item (including day 2 = 354.8030786559038) and all of
// occurrencesPerWeek, frequencyWeight, costBreakdown, and computeWillpowerCost
// remain byte-identical to HEAD 70bd0d6.
const SHA_ALL_AT_70BD0D6 = 'afeb7105fe01b8109010b737ac62109b46396f1652116f4f49868eeba4ed7bbf';
const SHA_PART_AT_70BD0D6: Record<string, string> = {
  "occurrencesPerWeek": "acf9f71387c2ef52912c83a1c672273d2a4b26fe20d44439e502fe3bc9911ad4",
  "frequencyWeight": "77d44a1cacf14d45f524f74b4a3a1b3a01cf7ee8170395d6d54caafbce37ce6f",
  "habitLoad": "f89b95e9502d7be732235f40b44476081320c4588c5f2265adbcafcaa4ecd79c",
  "habitLoadPoints": "537261f8a98108325c0fe7de4b342eeb18ecf936b03369ea4a880d7c9a9525b6",
  "dailyLoad": "2afb2f5e7e088c6afe0411e0891282e81707ef9db201572a3333cac05cdebff5",
  "costBreakdown": "221c5b93c741e5ad401d2063fd99a0e061448bb5e3b1a858be52c9d2d16b2664",
  "computeWillpowerCost": "7f554c110e2daf4d3028b3670c95308b183add21105e3f2de3c840a1ed56c7af"
};
const OCCURRENCES_PER_WEEK_AT_70BD0D6 = [7,7,7,14,35,7,7,7,7,7,7,14,3,0.9198423127463863,1,3,7,1,4,1,3,7,1,3,0.22996057818659657,0.22996057818659657,2.299605781865966,7.128777923784494,2.299605781865966,7];
const FREQUENCY_WEIGHT_AT_70BD0D6 = [1,1,1,1,1,1,1,1,1,1,1,1,0.42857142857142855,0.1314060446780552,0.14285714285714285,0.42857142857142855,1,0.14285714285714285,0.5714285714285714,0.14285714285714285,0.42857142857142855,1,0.14285714285714285,0.42857142857142855,0.0328515111695138,0.0328515111695138,0.328515111695138,1,0.328515111695138,1];
const DAILY_LOAD_AT_70BD0D6 = [{"raw":109.46357334724956,"normalised":100,"band":"asiri"},{"raw":319.5348435038679,"normalised":100,"band":"asiri"},{"raw":354.8030786559038,"normalised":100,"band":"asiri"},{"raw":0,"normalised":0,"band":"dusuk"}];

describe('R01.02-d2 A7 — cost and load are unchanged for every input without an effective interval', () => {
  const now = {
    occurrencesPerWeek: FREQ_CORPUS.map((f) => occurrencesPerWeek(f as FrequencyConfig)),
    frequencyWeight: FREQ_CORPUS.map((f) => habitLoad({ difficulty: 5, estimated_minutes: 90, frequency_config: f as FrequencyConfig, impact_level: null })),
    habitLoad: LOAD_CORPUS.map((h) => habitLoad(h)),
    habitLoadPoints: LOAD_CORPUS.map((h) => habitLoadPoints(h)),
    dailyLoad: DAY_CORPUS.map((d) => dailyLoad(d)),
    // R01.02: the corpus's unknown-kind case was renamed 'yearly' -> 'fortnightly'
    // (yearly became a real kind). The breakdown echoes the kind label, so it is
    // mapped back before hashing; every number is pinned exactly as before.
    costBreakdown: COST_CORPUS.map((c) => { const r = costBreakdown(c); return (r.freqKind as string) === 'fortnightly' ? { ...r, freqKind: 'yearly' } : r; }),
    computeWillpowerCost: COST_CORPUS.map((c) => computeWillpowerCost(c)),
  };

  it('occurrencesPerWeek (30 shapes) verbatim', () => {
    expect(now.occurrencesPerWeek).toEqual(OCCURRENCES_PER_WEEK_AT_70BD0D6);
  });

  it('frequencyWeight (30 shapes) verbatim', () => {
    expect(now.frequencyWeight).toEqual(FREQUENCY_WEIGHT_AT_70BD0D6);
  });

  it('dailyLoad (4 days) verbatim', () => {
    expect(now.dailyLoad).toEqual(DAILY_LOAD_AT_70BD0D6);
  });

  for (const k of Object.keys(SHA_PART_AT_70BD0D6)) {
    it(`${k}: byte-identical (sha256)`, () => {
      expect(sha(JSON.stringify((now as Record<string, unknown>)[k]))).toBe(SHA_PART_AT_70BD0D6[k]);
    });
  }

  it('the whole output: byte-identical (sha256)', () => {
    expect(sha(JSON.stringify(now))).toBe(SHA_ALL_AT_70BD0D6);
  });

  it('corpus sizes are what was captured', () => {
    expect([FREQ_CORPUS.length, LOAD_CORPUS.length, DAY_CORPUS.length, COST_CORPUS.length]).toEqual([30, 360, 4, 4500]);
  });
});
