/**
 * R01.05 — dated pauses, holidays and goal versions, through the one
 * schedule engine every screen reads.
 */
import {
  isEligibleOn, periodStatus, scheduledCompletionRate, streakBroken, carriesDayLoad,
} from '../../lib/habitSchedule';
import { attachTimeOff, type PauseInterval, type GoalVersion } from '../../lib/habitPauses';
import type { Habit } from '../../lib/supabase';

const d = (s: string) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd); };
const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', user_id: 'u1', name: 'Yürüyüş', icon: null, color: null, behavior_type: 'positive',
  tracking_type: 'boolean', unit: null, daily_goal: null, target_direction: null,
  frequency_config: { kind: 'daily' }, willpower_cost: 3, status: 'active', impact_level: null,
  urgency: null, difficulty: 3, estimated_minutes: 20, reminders: null, cue_habit_id: null,
  cue_note: null, life_area: null, end_condition: null, created_at: '2026-09-01T08:00:00', ...over,
} as Habit);
const pause = (start: string, end: string | null, habit_id: string | null = 'h1'): PauseInterval =>
  ({ id: `${habit_id}-${start}`, habit_id, kind: habit_id ? 'pause' : 'holiday', start_date: start, end_date: end });
const done = (day: string) => ({ habit_id: 'h1', completed_at: day, state: 'done' as const, value: null });
const withTimeOff = (h: Habit, pauses: PauseInterval[], versions: GoalVersion[] = []) => attachTimeOff([h], pauses, versions)[0] as Habit;

// Week of Mon 5 Oct .. Sun 11 Oct 2026.
describe('R01.05 — a dated pause on a daily habit', () => {
  const h = withTimeOff(habit(), [pause('2026-10-07', '2026-10-09')]); // Wed..Fri

  it('paused days are not eligible; the rest are', () => {
    expect(isEligibleOn(h, d('2026-10-06'))).toBe(true);
    expect(isEligibleOn(h, d('2026-10-08'))).toBe(false);
    expect(isEligibleOn(h, d('2026-10-10'))).toBe(true);
  });

  it('the rate leaves paused days out of the denominator', () => {
    const r = scheduledCompletionRate(h, [done('2026-10-05'), done('2026-10-06')], { from: d('2026-10-05'), to: d('2026-10-11') });
    expect(r.dueDays).toBe(4);
    expect(r.doneDays).toBe(2);
  });

  it('the streak is not broken by a paused day with no log', () => {
    expect(streakBroken(h, [], d('2026-10-08'))).toBe(false);
    expect(streakBroken(h, [], d('2026-10-10'))).toBe(true);
  });

  it('periodStatus says paused, with its reason', () => {
    const st = periodStatus(h, [], d('2026-10-08'), { asOf: d('2026-10-20') });
    expect(st.status).toBe('paused');
    expect(st.reason).toBe('habit_paused');
  });

  it('a paused day carries no load', () => {
    expect(carriesDayLoad(h, [], d('2026-10-08'))).toBe(false);
  });
});

describe('R01.05 — history stays as it happened', () => {
  it('a pause from next week leaves last week exactly as it was', () => {
    const plain = habit();
    const paused = withTimeOff(habit(), [pause('2026-10-12', null)]);
    const lastWeek = { from: d('2026-10-05'), to: d('2026-10-11') };
    const logs = [done('2026-10-05'), done('2026-10-07')];
    expect(scheduledCompletionRate(paused, logs, lastWeek)).toEqual(scheduledCompletionRate(plain, logs, lastWeek));
    expect(periodStatus(paused, logs, d('2026-10-06'), { asOf: d('2026-10-20') }).status).toBe('closed_unmet');
  });

  it('(contrast) the legacy undated status pause hides the past too', () => {
    const legacy = habit({ status: 'paused' });
    expect(periodStatus(legacy, [], d('2026-10-06'), { asOf: d('2026-10-20') }).status).toBe('paused');
  });
});

describe('R01.05 — a pause inside a count period', () => {
  const W3 = { kind: 'weekly', count: 3 } as Habit['frequency_config'];

  it('3 a week with Wed..Sat paused asks for 2', () => {
    const h = withTimeOff(habit({ frequency_config: W3 }), [pause('2026-10-07', '2026-10-10')]);
    const st = periodStatus(h, [done('2026-10-05'), done('2026-10-06')], d('2026-10-06'), { asOf: d('2026-10-12') });
    expect(st.target).toBe(2);
    expect(st.status).toBe('satisfied');
  });

  it('a whole week paused is paused, not failed', () => {
    const h = withTimeOff(habit({ frequency_config: W3 }), [pause('2026-10-05', '2026-10-11')]);
    expect(periodStatus(h, [], d('2026-10-06'), { asOf: d('2026-10-12') }).status).toBe('paused');
  });

  it('the streak judges the shrunken target and the days that can still be worked', () => {
    // Mon..Wed paused; target ceil(3 x 4/7) = 2; on Fri with 0 done, Fri..Sun = 3 days left
    const h = withTimeOff(habit({ frequency_config: W3 }), [pause('2026-10-05', '2026-10-07')]);
    expect(streakBroken(h, [], d('2026-10-09'))).toBe(false);
    // Thu..Sat paused instead: on Sun with 0 done, 1 day left for a target of 2 -> broken
    const h2 = withTimeOff(habit({ frequency_config: W3 }), [pause('2026-10-08', '2026-10-10')]);
    expect(streakBroken(h2, [], d('2026-10-11'))).toBe(true);
  });

  it('paused days still ahead in the week cannot be counted on', () => {
    // Fri..Sun paused; target ceil(3 x 4/7) = 2; on Thu with 0 done only Thu is left -> broken
    const h = withTimeOff(habit({ frequency_config: W3 }), [pause('2026-10-09', '2026-10-11')]);
    expect(streakBroken(h, [], d('2026-10-08'))).toBe(true);
    expect(streakBroken(h, [done('2026-10-05')], d('2026-10-08'))).toBe(false);
  });

  it('a paused day is not eligible for a count habit either', () => {
    const h = withTimeOff(habit({ frequency_config: W3 }), [pause('2026-10-07', '2026-10-07')]);
    expect(isEligibleOn(h, d('2026-10-07'))).toBe(false);
    expect(isEligibleOn(h, d('2026-10-08'))).toBe(true);
  });
});

describe('R01.05 — a holiday is a pause for every habit', () => {
  it('attached to each habit from one row with habit_id null', () => {
    const [a, b] = attachTimeOff([habit({ id: 'h1' }), habit({ id: 'h2' })], [pause('2026-10-07', '2026-10-08', null)], []) as Habit[];
    expect(isEligibleOn(a, d('2026-10-07'))).toBe(false);
    expect(isEligibleOn(b, d('2026-10-08'))).toBe(false);
    expect(isEligibleOn(b, d('2026-10-09'))).toBe(true);
  });
});

describe('R01.05 — a goal change takes effect from its date', () => {
  const MON = { kind: 'weekly', days: [0] } as Habit['frequency_config'];
  const versions: GoalVersion[] = [
    { habit_id: 'h1', effective_from: '2026-09-01', frequency_config: { kind: 'daily' }, daily_goal: null, target_direction: null },
    { habit_id: 'h1', effective_from: '2026-10-12', frequency_config: MON, daily_goal: null, target_direction: null },
  ];
  const h = withTimeOff(habit({ frequency_config: MON }), [], versions);

  it('days before the change are judged by the old schedule', () => {
    expect(isEligibleOn(h, d('2026-10-07'))).toBe(true);   // Wed, daily then
    expect(isEligibleOn(h, d('2026-10-14'))).toBe(false);  // Wed, Mondays only now
    expect(isEligibleOn(h, d('2026-10-12'))).toBe(true);   // Mon
  });

  it('a rate spanning the change scores each side against its own goal', () => {
    // Mon 5 .. Sun 18: daily for 5..11 (7 due), Mondays for 12..18 (1 due)
    const r = scheduledCompletionRate(h, [done('2026-10-05'), done('2026-10-12')], { from: d('2026-10-05'), to: d('2026-10-18') });
    expect(r.dueDays).toBe(8);
    expect(r.doneDays).toBe(2);
  });

  it('the past is not re-scored: last week\'s Wednesday is still a daily miss', () => {
    expect(periodStatus(h, [], d('2026-10-07'), { asOf: d('2026-10-20') }).status).toBe('closed_unmet');
  });

  it('a change between a day schedule and a count schedule: each day asks its own version', () => {
    const W3 = { kind: 'weekly', count: 3 } as Habit['frequency_config'];
    const vs: GoalVersion[] = [
      { habit_id: 'h1', effective_from: '2026-09-01', frequency_config: MON, daily_goal: null, target_direction: null },
      { habit_id: 'h1', effective_from: '2026-10-12', frequency_config: W3, daily_goal: null, target_direction: null },
    ];
    const hv = withTimeOff(habit({ frequency_config: W3 }), [], vs);
    expect(isEligibleOn(hv, d('2026-10-07'))).toBe(false); // Wed, Mondays-only then
    expect(isEligibleOn(hv, d('2026-10-14'))).toBe(true);  // Wed, 3 a week now
  });

  it('a rate across a day->count change: days for the first part, the period target for the second', () => {
    const W3 = { kind: 'weekly', count: 3 } as Habit['frequency_config'];
    const vs: GoalVersion[] = [
      { habit_id: 'h1', effective_from: '2026-09-01', frequency_config: { kind: 'daily' }, daily_goal: null, target_direction: null },
      { habit_id: 'h1', effective_from: '2026-10-12', frequency_config: W3, daily_goal: null, target_direction: null },
    ];
    const hv = withTimeOff(habit({ frequency_config: W3 }), [], vs);
    const logs = [done('2026-10-05'), done('2026-10-12'), done('2026-10-13'), done('2026-10-14')];
    const r = scheduledCompletionRate(hv, logs, { from: d('2026-10-05'), to: d('2026-10-18') });
    expect(r.dueDays).toBe(10);   // 7 daily days + a target of 3
    expect(r.doneDays).toBe(4);
  });

  it('a habit with no versions is scored exactly as before', () => {
    const plain = habit({ frequency_config: MON });
    expect(isEligibleOn(plain, d('2026-10-07'))).toBe(false);
  });
});
