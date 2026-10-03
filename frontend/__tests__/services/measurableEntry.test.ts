/**
 * R01.03-a — a measurable row stores THE DAY'S TOTAL, and its state comes
 * from one place.
 *
 * The defect: `app/tabs/timeline.tsx` decided the state itself --
 * `value >= getRemainingValue(...) ? 'done' : 'partial'` for at_least, the raw
 * entry for at_most -- and wrote the ENTRY as `value`. Target 10, 6 already
 * logged, user adds 4: the row became `{ state: 'done', value: 4 }`, 40% to
 * every ratio reader. Now the screen hands the day's prior value and the entry
 * to `measuredEntryFor`, which adds once and lets `completionFor` /
 * `stateForValue` decide from the total.
 *
 * A7 baseline: `stateForValue` / `completionFor` / `toPatch` over the corpus
 * (1848), `xpFor` sweep (396) and the OLD screen decision over habits x
 * prior x entered (20328, copied verbatim from 5ef17bd -- see
 * helpers/legacyMeasurableSubmit.ts) were captured at HEAD 5ef17bd before any
 * edit and are pinned below by SHA-256.
 */
jest.mock('../../repositories/habitLogRepository', () => ({
  fetchLogsForDate: jest.fn(), findHabitLog: jest.fn(), insertHabitLog: jest.fn(), updateHabitLog: jest.fn(),
}));
jest.mock('../../services/webhookService', () => ({ notify: jest.fn() }));

import { createHash } from 'crypto';
import {
  stateForValue, completionFor, toPatch, xpFor, measuredEntryFor, dayTotalAfterEntry,
} from '../../services/habitLogService';
import { completionRatio, adaptTrackingType, isMeasurableTracking } from '../../lib/habitEngine';
import { CORPUS_HABITS, PRIOR_VALUES, ENTERED, STATES, type CorpusHabit } from '../helpers/measurableCorpus';
import { legacyMeasurableSubmit } from '../helpers/legacyMeasurableSubmit';

const sha = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
const SHA_AT_5EF17BD = {
  "service": "782db4c442a7a355e5bc5794088e3751d4e65a0670f5cad49df8dec2bbf1f151",
  "xp": "9052c29711d5c5c0588fe76a85908765e99cdae21cde6287760da381763a6a42",
  "legacy": "37f8ded0419a4f97e35b7287df00923eb17fe995d7ec644f26a9fb71d1ade138"
};

const READ10: CorpusHabit = { id: 'read', tracking_type: 'numeric', behavior_type: 'positive', daily_goal: 10, target_direction: 'at_least' };
const SMOKE2: CorpusHabit = { id: 'smoke', tracking_type: 'numeric', behavior_type: 'negative', daily_goal: 2, target_direction: 'at_most' };

/** Rows the modal can actually produce: measurable habits only; at_least needs > 0, at_most allows 0. */
const reachable = (h: CorpusHabit, entered: number) =>
  isMeasurableTracking(h.tracking_type) && (h.target_direction === 'at_most' ? entered >= 0 : entered > 0);
const hasPrior = (p: number | null | undefined) => typeof p === 'number' && p > 0;

describe('A1 / A2 — the row stores the day total', () => {
  it('A1 — target 10, 6 logged, +4: value 10, done', () => {
    const i = measuredEntryFor(READ10, 6, 4);
    expect(toPatch(i)).toMatchObject({ state: 'done', value: 10, is_completed: true });
  });

  it('A2 — target 10, 6 logged, +1: value 7, partial', () => {
    expect(toPatch(measuredEntryFor(READ10, 6, 1))).toMatchObject({ state: 'partial', value: 7, is_completed: false });
  });

  it('NEGATIVE — the increment is never what is written (red if value 4 / done)', () => {
    const p = toPatch(measuredEntryFor(READ10, 6, 4));
    expect(p.value).not.toBe(4);
    // the old screen, verbatim, wrote exactly that contradiction:
    expect(legacyMeasurableSubmit(READ10, 4, 6)).toMatchObject({ state: 'done', value: 4 });
  });

  it('first entry of the day is the total itself; no row / null / 0 prior all mean nothing yet', () => {
    for (const p of [undefined, null, 0]) expect(measuredEntryFor(READ10, p, 4).value).toBe(4);
  });

  it('dayTotalAfterEntry guards: negative / non-finite prior counts 0, negative / non-finite entry adds 0, float noise rounded', () => {
    expect(dayTotalAfterEntry(-3, 2)).toBe(2);
    expect(dayTotalAfterEntry(Number.NaN, 2)).toBe(2);
    expect(dayTotalAfterEntry(5, -2)).toBe(5);
    expect(dayTotalAfterEntry(5, Number.POSITIVE_INFINITY)).toBe(5);
    expect(dayTotalAfterEntry(0.1, 0.2)).toBe(0.3);
  });
});

describe('A3 — at_most (ceiling) rules unchanged', () => {
  // The card's example said "3 giren miss". The ENGINE (habitEngine.deriveState,
  // not changed by this card) grades an overshoot proportionally:
  // ceilingRatio = 1 - (value - limit) / limit -> 3 against 2 is 0.5 = partial,
  // 4 against 2 is 0 = miss. These assert the engine's real rule; that the
  // screen's first entry is UNCHANGED is the test after next.
  it('"en çok 2": 0 is a full day, 2 is done, 3 is partial (overshoot by half), 4 is a miss -- first entry', () => {
    expect(measuredEntryFor(SMOKE2, undefined, 0)).toMatchObject({ state: 'done', value: 0 });
    expect(measuredEntryFor(SMOKE2, undefined, 2)).toMatchObject({ state: 'done', value: 2 });
    expect(measuredEntryFor(SMOKE2, undefined, 3)).toMatchObject({ state: 'partial', value: 3 });
    expect(measuredEntryFor(SMOKE2, undefined, 4)).toMatchObject({ state: 'miss', value: 4 });
  });

  it('NEGATIVE — a ceiling is not read as a floor (red if 0 is not done or an overshoot is done)', () => {
    expect(measuredEntryFor(SMOKE2, undefined, 0).state).toBe('done');
    expect(measuredEntryFor(SMOKE2, undefined, 3).state).not.toBe('done');
    expect(measuredEntryFor(SMOKE2, undefined, 4).state).not.toBe('done');
  });

  it('first entry: identical to the old screen for every reachable ceiling input', () => {
    for (const h of CORPUS_HABITS.filter((x) => x.target_direction === 'at_most')) {
      for (const v of ENTERED) {
        if (!reachable(h, v)) continue;
        expect(toPatch(measuredEntryFor(h, undefined, v))).toEqual(toPatch(legacyMeasurableSubmit(h, v, undefined)));
      }
    }
  });

  it('second entry ADDS for a ceiling too (deliberate, see STATE.md): 2 then +1 is 3 (over), 2 then +2 is 4 (miss)', () => {
    expect(measuredEntryFor(SMOKE2, 2, 1)).toMatchObject({ value: 3, state: 'partial' });
    expect(measuredEntryFor(SMOKE2, 2, 2)).toMatchObject({ value: 4, state: 'miss' });
    // the old screen wrote the latest entry alone and called both days clean:
    expect(legacyMeasurableSubmit(SMOKE2, 1, 2)).toMatchObject({ value: 1, state: 'done' });
    expect(legacyMeasurableSubmit(SMOKE2, 2, 2)).toMatchObject({ value: 2, state: 'done' });
  });
});

describe('A4 — value and state never contradict (fixture sweep)', () => {
  it('every produced row: stateForValue(habit, row.value) === row.state', () => {
    let n = 0;
    for (const h of CORPUS_HABITS) for (const p of PRIOR_VALUES) for (const v of ENTERED) {
      const row = toPatch(measuredEntryFor(h, p, v));
      expect(row.state).toBe(stateForValue(h, row.value as number));
      n++;
    }
    expect(n).toBe(20328);
  });

  it('the old screen produced contradicting rows on reachable inputs (the defect, measured)', () => {
    let bad = 0;
    for (const h of CORPUS_HABITS) for (const p of PRIOR_VALUES) for (const v of ENTERED) {
      if (!reachable(h, v)) continue;
      const row = toPatch(legacyMeasurableSubmit(h, v, p));
      if (row.state !== stateForValue(h, row.value as number)) bad++;
    }
    expect(bad).toBeGreaterThan(0);
  });
});

describe('A5 — ratio readers and the state tell the same day', () => {
  it('a done row reads >= 1 for at_least and is within the ceiling for at_most', () => {
    for (const h of CORPUS_HABITS) for (const p of PRIOR_VALUES) for (const v of ENTERED) {
      if (!reachable(h, v)) continue;
      const row = toPatch(measuredEntryFor(h, p, v));
      if (row.state !== 'done' || h.daily_goal == null || h.daily_goal <= 0) continue;
      const ratio = completionRatio({ trackingType: adaptTrackingType(h), state: row.state, value: row.value, target: h.daily_goal, direction: h.target_direction });
      if (h.target_direction === 'at_most') expect(row.value as number).toBeLessThanOrEqual(h.daily_goal);
      else expect(ratio).toBeGreaterThanOrEqual(1);
    }
  });

  it('a partial at_least row reads strictly between 0 and 1', () => {
    for (const p of [0, 3, 6]) for (const v of [1, 2]) {
      const row = toPatch(measuredEntryFor(READ10, p, v));
      const r = completionRatio({ trackingType: 'numeric', state: row.state, value: row.value, target: 10, direction: 'at_least' });
      expect(row.state).toBe('partial');
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThan(1);
    }
  });
});

describe('A7 — nothing else moved', () => {
  it('stateForValue / completionFor / toPatch over the corpus: byte-identical to 5ef17bd', () => {
    const service = CORPUS_HABITS.flatMap((h) => ENTERED.map((v) => ({
      stateForValue: stateForValue(h, v), completionFor: completionFor(h, v), patch: toPatch(completionFor(h, v)),
    })));
    expect(sha(service)).toBe(SHA_AT_5EF17BD.service);
  });

  it('xpFor sweep (every state x value x target x direction): byte-identical to 5ef17bd', () => {
    const xp = STATES.flatMap((state) => ENTERED.flatMap((value) => [10, 0, undefined].flatMap((targetValue) =>
      (['at_least', 'at_most', undefined] as const).map((targetDirection) => xpFor({ state, value, targetValue, targetDirection })))));
    expect(sha(xp)).toBe(SHA_AT_5EF17BD.xp);
  });

  it('the legacy copy still reproduces what was captured at 5ef17bd (the baseline is the real old screen)', () => {
    const legacy = CORPUS_HABITS.flatMap((h) => PRIOR_VALUES.flatMap((p) => ENTERED.map((v) => {
      const args = legacyMeasurableSubmit(h, v, p);
      return { args, patch: toPatch(args) };
    })));
    expect(sha(legacy)).toBe(SHA_AT_5EF17BD.legacy);
  });

  it('every reachable FIRST entry of the day writes exactly what the old screen wrote', () => {
    let n = 0;
    for (const h of CORPUS_HABITS) for (const p of PRIOR_VALUES) for (const v of ENTERED) {
      if (!reachable(h, v) || hasPrior(p)) continue;
      expect(JSON.stringify(toPatch(measuredEntryFor(h, p, v)))).toBe(JSON.stringify(toPatch(legacyMeasurableSubmit(h, v, p))));
      n++;
    }
    expect(n).toBeGreaterThan(500);
  });

  it('the ONE expected change, pinned explicitly: a reachable SECOND entry writes prior + entered, state from that total', () => {
    let changed = 0;
    for (const h of CORPUS_HABITS) for (const p of PRIOR_VALUES) for (const v of ENTERED) {
      if (!reachable(h, v) || !hasPrior(p)) continue;
      const row = toPatch(measuredEntryFor(h, p, v));
      expect(row.value).toBe(dayTotalAfterEntry(p, v));
      expect(row.state).toBe(stateForValue(h, row.value as number));
      if (JSON.stringify(row) !== JSON.stringify(toPatch(legacyMeasurableSubmit(h, v, p)))) changed++;
    }
    expect(changed).toBeGreaterThan(0);
  });
});
