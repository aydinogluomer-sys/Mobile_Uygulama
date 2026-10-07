/**
 * R03.05 — the recovery planning sheet previews what a make-up does to the
 * load of the day it is moved to.
 *
 * The baseline is the activation-gate model (active habits at weekly-average
 * weight, date envelope for that day) plus that day's tasks and make-ups
 * already planned onto it. The make-up adds ONE occurrence of the habit,
 * scaled by its share (0.5 per day for split_two_days). A preview only.
 */
import type { HabitLoadInput } from '../../lib/capacity';
import { makeupLoadPreview, oneOccurrencePoints, habitLoadPoints, dailyLoad } from '../../lib/capacity';

const DAY = new Date(2026, 8, 10);
const h = (fc: HabitLoadInput['frequency_config'], over: Partial<HabitLoadInput> = {}): HabitLoadInput =>
  ({ difficulty: 3, estimated_minutes: 30, frequency_config: fc, impact_level: null, ...over });
const DAILY = h({ kind: 'daily' });
const WEEKLY1 = h({ kind: 'weekly', count: 1 });
const HEAVY = h({ kind: 'daily' }, { difficulty: 5, estimated_minutes: 90 });

describe('R03.05 — one occurrence', () => {
  it('a weekly habit\'s make-up is a whole session, not a seventh of one', () => {
    expect(oneOccurrencePoints(WEEKLY1)).toBeCloseTo(habitLoadPoints(DAILY), 10);
    expect(oneOccurrencePoints(WEEKLY1)).toBeGreaterThan(habitLoadPoints(WEEKLY1));
  });
});

describe('R03.05 — makeupLoadPreview', () => {
  it('on an empty day the make-up is the whole load', () => {
    const p = makeupLoadPreview({ day: DAY, activeHabits: [], incoming: DAILY, share: 1 });
    expect(p.before).toBe(0);
    expect(p.after).toBe(Math.round(oneOccurrencePoints(DAILY)));
    expect(p.addedPoints).toBeCloseTo(oneOccurrencePoints(DAILY), 10);
  });

  it('the baseline is the same number the activation gates use', () => {
    const p = makeupLoadPreview({ day: DAY, activeHabits: [DAILY, DAILY, WEEKLY1], incoming: DAILY, share: 1 });
    expect(p.before).toBe(dailyLoad({ habits: [DAILY, DAILY, WEEKLY1] }).normalised);
  });

  it('split_two_days adds half per day', () => {
    const full = makeupLoadPreview({ day: DAY, activeHabits: [], incoming: HEAVY, share: 1 });
    const half = makeupLoadPreview({ day: DAY, activeHabits: [], incoming: HEAVY, share: 0.5 });
    expect(half.addedPoints).toBeCloseTo(full.addedPoints / 2, 10);
  });

  it('share 0 (skip) changes nothing', () => {
    const p = makeupLoadPreview({ day: DAY, activeHabits: [DAILY], incoming: HEAVY, share: 0 });
    expect(p.after).toBe(p.before);
    expect(p.addedPoints).toBe(0);
  });

  it('make-ups already planned onto that day raise the baseline', () => {
    const a = makeupLoadPreview({ day: DAY, activeHabits: [DAILY], incoming: DAILY, share: 1 });
    const b = makeupLoadPreview({ day: DAY, activeHabits: [DAILY], incoming: DAILY, share: 1, plannedMakeups: [{ habit: HEAVY, share: 1 }] });
    expect(b.before).toBe(Math.round(a.before + oneOccurrencePoints(HEAVY)));
  });

  it('tasks due that day raise the baseline', () => {
    const a = makeupLoadPreview({ day: DAY, activeHabits: [DAILY], incoming: DAILY, share: 1 });
    const b = makeupLoadPreview({ day: DAY, activeHabits: [DAILY], incoming: DAILY, share: 1, tasksDue: [{}, {}] });
    expect(b.before).toBeGreaterThan(a.before);
  });

  it('a habit outside its date range that day carries nothing (KD-08 envelope)', () => {
    const ended = h({ kind: 'daily', range_end: '2026-08-31' }, { difficulty: 5, estimated_minutes: 90 });
    const p = makeupLoadPreview({ day: DAY, activeHabits: [ended], incoming: DAILY, share: 1 });
    expect(p.before).toBe(0);
  });

  it('clamps at 100 and reports the band crossing', () => {
    const many = Array.from({ length: 5 }, () => HEAVY);   // 5 x 18 = 90 -> aşırı already
    const p = makeupLoadPreview({ day: DAY, activeHabits: many.slice(0, 4), incoming: HEAVY, share: 1 });
    expect(p.bandBefore).toBe('yuksek');     // 72
    expect(p.bandAfter).toBe('asiri');       // 90
    const q = makeupLoadPreview({ day: DAY, activeHabits: many, incoming: HEAVY, share: 1 });
    expect(q.after).toBe(100);
  });
});
