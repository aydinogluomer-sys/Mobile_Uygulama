/**
 * KD-08 — an active habit outside its date range carries no load today.
 *
 * Every activation gate summed the full weekly-average load of every ACTIVE
 * habit. A habit whose `range_end` had passed ("3 a week, 1-14 August") does
 * nothing in September, yet kept eating capacity and refusing new habits. The
 * day-walk screens were already right (`carriesDayLoad` -> `withinLifetime`);
 * the gates were not.
 *
 * The fix filters by the date ENVELOPE only (`habitsInRangeOn` ->
 * `habitSchedule.isWithinRange`), never by the schedule: `frequencyWeight`
 * already folds the schedule in as a weekly average, so dropping a
 * Mon/Wed/Fri habit on a Tuesday would count its schedule twice.
 */
jest.mock('../../repositories/willpowerRepository', () => ({
  fetchOrCreateWillpowerState: jest.fn(), updateWillpowerState: jest.fn(),
}));

import type { HabitLoadInput } from '../../lib/capacity';
import { habitsInRangeOn, dailyLoad, habitLoadPoints } from '../../lib/capacity';
import { isWithinRange, isEligibleOn } from '../../lib/habitSchedule';
import { evaluateProposal, type RoutineProposal } from '../../lib/routineProposal';
import { evaluateActivation } from '../../services/capacityService';
import type { Habit } from '../../lib/supabase';

const SEP_10 = new Date(2026, 8, 10);   // 10 September 2026, local
const AUG_07 = new Date(2026, 7, 7);

function load(fc: HabitLoadInput['frequency_config'], over: Partial<HabitLoadInput> = {}): HabitLoadInput {
  return { difficulty: 5, estimated_minutes: 90, frequency_config: fc, impact_level: null, ...over };
}
const DAILY = load({ kind: 'daily' });
const ENDED = load({ kind: 'weekly', count: 3, range_start: '2026-08-01', range_end: '2026-08-14' });
const FUTURE = load({ kind: 'daily', range_start: '2026-10-01' });
const OPEN_END = load({ kind: 'daily', range_start: '2026-09-01' });
const OPEN_START = load({ kind: 'daily', range_end: '2026-09-10' });

describe('KD-08 — habitsInRangeOn', () => {
  it('a habit whose range has ended is dropped', () => {
    expect(habitsInRangeOn([DAILY, ENDED], SEP_10)).toEqual([DAILY]);
  });
  it('a habit whose range has not started is dropped', () => {
    expect(habitsInRangeOn([FUTURE], SEP_10)).toEqual([]);
  });
  it('inside the range it counts; both ends are inclusive', () => {
    expect(habitsInRangeOn([ENDED], AUG_07)).toEqual([ENDED]);
    expect(habitsInRangeOn([ENDED], new Date(2026, 7, 1))).toEqual([ENDED]);
    expect(habitsInRangeOn([ENDED], new Date(2026, 7, 14))).toEqual([ENDED]);
    expect(habitsInRangeOn([ENDED], new Date(2026, 7, 15))).toEqual([]);
  });
  it('a one-sided range clips one side only', () => {
    expect(habitsInRangeOn([OPEN_END], SEP_10)).toEqual([OPEN_END]);
    expect(habitsInRangeOn([OPEN_END], new Date(2026, 7, 31))).toEqual([]);
    expect(habitsInRangeOn([OPEN_START], SEP_10)).toEqual([OPEN_START]);
    expect(habitsInRangeOn([OPEN_START], new Date(2026, 8, 11))).toEqual([]);
  });
  it('A7 — range-less habits come back as the same objects, in the same order', () => {
    const xs = [DAILY, load({ kind: 'weekly', days: [0, 2, 4] }), load({ kind: 'monthly', count: 2 }), load({ kind: 'daily', interval_days: 3 })];
    const out = habitsInRangeOn(xs, SEP_10);
    expect(out).toHaveLength(xs.length);
    out.forEach((h, i) => expect(h).toBe(xs[i]));
  });
  it('NEGATIVE — the schedule is NOT applied (that would count it twice)', () => {
    // A Mon/Wed/Fri habit on a Tuesday is not eligible, but it still carries
    // its weekly-average load: 10 Sep 2026 is a Thursday, 8 Sep a Tuesday.
    const mwf = load({ kind: 'weekly', days: [0, 2, 4] });
    const tue = new Date(2026, 8, 8);
    expect(isEligibleOn({ ...mwf, created_at: '2026-01-01T00:00:00Z', status: 'active' } as unknown as Habit, tue)).toBe(false);
    expect(habitsInRangeOn([mwf], tue)).toEqual([mwf]);
  });
  it('isWithinRange is the one reading of the range (same answers as the envelope)', () => {
    expect(isWithinRange(ENDED, AUG_07)).toBe(true);
    expect(isWithinRange(ENDED, SEP_10)).toBe(false);
    expect(isWithinRange(DAILY, SEP_10)).toBe(true);
  });
});

describe('KD-08 — the activation gates no longer count an ended habit', () => {
  const proposal: RoutineProposal = {
    title: 'test',
    goal: 'test',
    habits: [{ name: 'Heavy', tracking_type: 'binary', difficulty: 5, estimated_minutes: 90 }],
  };

  it('evaluateProposal: an ended habit leaves the baseline', () => {
    const with4 = [DAILY, DAILY, DAILY, ENDED];
    const e = evaluateProposal(proposal, { activeHabits: with4, asOf: SEP_10 });
    // 3 live heavy dailies = 54; the ended one used to add its 3/7 share too.
    expect(e.currentLoad).toBe(Math.round(3 * habitLoadPoints(DAILY)));
    const old = dailyLoad({ habits: with4 }).normalised;
    expect(e.currentLoad).toBeLessThan(old);
  });

  it('evaluateProposal: inside the range the same habit still counts', () => {
    const e = evaluateProposal(proposal, { activeHabits: [DAILY, DAILY, DAILY, ENDED], asOf: AUG_07 });
    expect(e.currentLoad).toBe(dailyLoad({ habits: [DAILY, DAILY, DAILY, ENDED] }).normalised);
  });

  it('evaluateProposal: the ended habit can be the difference between queue and activate', () => {
    // 4 live heavy dailies = 72; +18 = 90 > 85 -> queued. With the 4th ENDED
    // (and 3 live) the baseline is 54; +18 = 72 -> fits.
    const live4 = evaluateProposal(proposal, { activeHabits: [DAILY, DAILY, DAILY, DAILY], asOf: SEP_10 });
    expect(live4.toQueue).toEqual(['Heavy']);
    const endedRangeBlocker = load({ kind: 'daily', range_end: '2026-08-31' });
    const three = evaluateProposal(proposal, { activeHabits: [DAILY, DAILY, DAILY, endedRangeBlocker], asOf: SEP_10 });
    expect(three.toActivate).toEqual(['Heavy']);
  });

  it('evaluateActivation: an ended habit no longer refuses activation', () => {
    const state = { used: 0, daily_budget: 100, active_count: 0, focus_capacity: 99 } as never;
    const blocker = load({ kind: 'daily', range_end: '2026-08-31' });
    const incoming = DAILY;
    const verdict = evaluateActivation({
      state, stale: false, cost: 1,
      capacityInput: { habit: incoming, activeHabits: [DAILY, DAILY, DAILY, blocker], asOf: SEP_10 },
    });
    expect(verdict).toEqual({ allowed: true });
    const inRange = evaluateActivation({
      state, stale: false, cost: 1,
      capacityInput: { habit: incoming, activeHabits: [DAILY, DAILY, DAILY, blocker], asOf: AUG_07 },
    });
    expect(inRange).toEqual({ allowed: false, reason: 'over_capacity' });
  });

  it('A7 — for range-less habits the gates give the same answer with or without a date', () => {
    const xs = [DAILY, DAILY, load({ kind: 'weekly', days: [0, 2] }), load({ kind: 'monthly', count: 3 })];
    const a = evaluateProposal(proposal, { activeHabits: xs });
    const b = evaluateProposal(proposal, { activeHabits: xs, asOf: SEP_10 });
    const c = evaluateProposal(proposal, { activeHabits: xs, asOf: new Date(2031, 0, 1) });
    expect(b).toEqual(a);
    expect(c).toEqual(a);
  });
});
