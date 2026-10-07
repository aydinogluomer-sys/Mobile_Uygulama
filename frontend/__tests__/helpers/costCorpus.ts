/**
 * R01.02-d2 A7 — frequency configs and cost/load inputs WITHOUT an effective
 * `interval_days` (absent, or <= 1, which must keep today's behaviour), across
 * every shape, `count` variant, negative and measurable habits.
 *
 * `costPreservation.test.ts` pins every output below as captured at HEAD
 * `70bd0d6`, before capacity/triage learned `interval_days`.
 */
import type { FrequencyConfig } from '../../lib/supabase';
import type { CostInput } from '../../lib/triage';

const R = { range_start: '2026-08-05', range_end: '2026-08-20' };

/** Every frequency shape the app can hold, plus the degenerate ones. */
export const FREQ_CORPUS: (FrequencyConfig | null | undefined)[] = [
  undefined,
  null,
  { kind: 'daily' },
  { kind: 'daily', count: 2 },
  { kind: 'daily', count: 5 },
  { kind: 'daily', part_of_day: ['morning'] },
  { kind: 'daily', ...R },
  { kind: 'daily', range_end: '2026-01-01' },
  // interval_days present but <= 1: must behave exactly as plain daily (card step 1)
  { kind: 'daily', interval_days: 1 },
  { kind: 'daily', interval_days: 0 },
  { kind: 'daily', interval_days: -3 },
  { kind: 'daily', interval_days: 1, count: 2 },
  // interval on a non-daily kind is not "every N days" (validator refuses it);
  // capacity must not start reading it there
  { kind: 'weekly', count: 3, interval_days: 3 } as FrequencyConfig,
  { kind: 'monthly', count: 4, interval_days: 3 } as FrequencyConfig,
  { kind: 'weekly', days: [0] },
  { kind: 'weekly', days: [0, 2, 4] },
  { kind: 'weekly', days: [0, 1, 2, 3, 4, 5, 6] },
  { kind: 'weekly', days: [] },
  { kind: 'weekly', days: [], count: 4 },
  { kind: 'weekly', count: 1 },
  { kind: 'weekly', count: 3 },
  { kind: 'weekly', count: 7 },
  { kind: 'weekly' },
  { kind: 'weekly', count: 3, ...R },
  { kind: 'monthly' },
  { kind: 'monthly', count: 1 },
  { kind: 'monthly', count: 10 },
  { kind: 'monthly', count: 31 },
  { kind: 'monthly', count: 10, ...R },
  // An UNKNOWN kind (falls to the default branch). Was `'yearly'` until R01.02
  // made yearly a real kind; the case is still the unknown-kind fallback, so the
  // pinned outputs (and their sha256) are unchanged.
  { kind: 'fortnightly' } as unknown as FrequencyConfig,
];

const DIFFICULTIES = [1, 3, 5];
const MINUTES = [0, 20, 90, 180];

/** Load inputs: every frequency x difficulty x minutes. */
export const LOAD_CORPUS = FREQ_CORPUS.flatMap((f) =>
  DIFFICULTIES.flatMap((difficulty) => MINUTES.map((estimated_minutes) => ({
    difficulty, estimated_minutes, frequency_config: f as FrequencyConfig, impact_level: null,
  }))));

/** Cost inputs: every frequency x behaviour x tracking x impact x a few difficulty/minute points. */
export const COST_CORPUS: CostInput[] = FREQ_CORPUS.flatMap((f) =>
  (['positive', 'negative'] as const).flatMap((behavior_type) =>
    (['boolean', 'numeric', 'duration'] as const).flatMap((tracking_type) =>
      ([null, 'low', 'medium', 'high', 'critical'] as const).flatMap((impact_level) =>
        [[1, 0], [3, 20], [5, 90], [5, 200], [0, 45]].map(([difficulty, estimated_minutes]) => ({
          difficulty, behavior_type, tracking_type, impact_level, estimated_minutes,
          frequency_config: f as CostInput['frequency_config'],
        }))))));

/** A few whole days, mixing shapes, for dailyLoad. */
export const DAY_CORPUS = [
  { habits: LOAD_CORPUS.slice(0, 12) },
  { habits: LOAD_CORPUS.filter((_, i) => i % 7 === 0), tasks: [], focusMinutes: 45, overdueCount: 2 },
  { habits: LOAD_CORPUS.filter((h) => h.difficulty === 5 && h.estimated_minutes === 90) },
  { habits: [] },
];
