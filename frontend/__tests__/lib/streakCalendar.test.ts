/**
 * F13 — Calendar-aware streaks: pending today, pause/range bridging,
 * negative-habit transparency, and DST dates (DOM-07, DOM-09, DOM-17).
 */
import type { Habit } from '../../lib/supabase';
import { addDaysLocal, parseLocalDate, ymd } from '../../lib/date';
import { attachTimeOff, type PauseInterval } from '../../lib/habitPauses';
import { currentStreak, longestStreak, type BIHabit, type BILog } from '../../lib/behaviorIntelligence';

function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'st1',
    user_id: 'u1',
    name: 'Seri Test',
    icon: null,
    color: null,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    willpower_cost: 3,
    status: 'active',
    impact_level: null,
    urgency: null,
    difficulty: 3,
    estimated_minutes: 15,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: '2026-01-01T08:00:00',
    ...over,
  } as Habit;
}

const mkLog = (completed_at: string, state: BILog['state'] = 'done', habit_id = 'st1'): BILog => ({
  habit_id,
  completed_at,
  state,
});

describe('F13 DOM-07 — currentStreak treats unlogged asOf day as pending (no grace for yesterday)', () => {
  const asOf = new Date(2026, 9, 31); // 2026-10-31
  const habit: BIHabit = makeHabit({ created_at: '2026-09-01T08:00:00' });

  const past30Done: BILog[] = Array.from({ length: 30 }, (_, i) =>
    mkLog(ymd(addDaysLocal(asOf, -(i + 1))), 'done'),
  );

  it('30 done days + unlogged scheduled today -> 30; today done -> 31; today skip -> 30', () => {
    expect(currentStreak(habit, past30Done, asOf)).toBe(30);
    expect(currentStreak(habit, [...past30Done, mkLog('2026-10-31', 'done')], asOf)).toBe(31);
    expect(currentStreak(habit, [...past30Done, mkLog('2026-10-31', 'skip')], asOf)).toBe(30);
  });

  it('NEGATIVE — yesterday miss + today unlogged -> 0; yesterday unlogged + today unlogged -> 0; today explicit miss -> 0', () => {
    const yesterdayMiss = [
      ...past30Done.filter((l) => l.completed_at !== '2026-10-30'),
      mkLog('2026-10-30', 'miss'),
    ];
    expect(currentStreak(habit, yesterdayMiss, asOf)).toBe(0);

    const yesterdayUnlogged = past30Done.filter((l) => l.completed_at !== '2026-10-30');
    expect(currentStreak(habit, yesterdayUnlogged, asOf)).toBe(0);

    expect(currentStreak(habit, [...past30Done, mkLog('2026-10-31', 'miss')], asOf)).toBe(0);
  });
});

describe('F13 DOM-09 — count-based streaks bridge dated pauses/holidays and pre-range_start periods', () => {
  it('bridges two holiday weeks between 10 and 2 satisfied weeks -> currentStreak 12, longestStreak >= 12', () => {
    // 14 weeks: Mon 2026-07-06 .. Sun 2026-10-11
    // Weeks 0..9 (Jul 06 .. Sep 13): 10 satisfied weeks
    // Weeks 10..11 (Sep 14 .. Sep 27): 2 full holiday weeks
    // Weeks 12..13 (Sep 28 .. Oct 11): 2 satisfied weeks
    const pauses: PauseInterval[] = [
      { id: 'hol1', habit_id: null, kind: 'holiday', start_date: '2026-09-14', end_date: '2026-09-27' },
    ];
    const base = makeHabit({
      created_at: '2026-07-01T08:00:00',
      frequency_config: { kind: 'weekly', count: 3 },
    });
    const h = attachTimeOff([base], pauses, [])[0];

    const logs: BILog[] = [];
    const firstMon = parseLocalDate('2026-07-06')!;
    for (let w = 0; w < 14; w++) {
      if (w === 10 || w === 11) continue; // holiday weeks have zero logs
      const mon = addDaysLocal(firstMon, w * 7);
      logs.push(mkLog(ymd(addDaysLocal(mon, 0)), 'done'));
      logs.push(mkLog(ymd(addDaysLocal(mon, 2)), 'done'));
      logs.push(mkLog(ymd(addDaysLocal(mon, 4)), 'done'));
    }

    const asOf = parseLocalDate('2026-10-11')!;
    expect(currentStreak(h, logs, asOf)).toBe(12);
    expect(longestStreak(h, logs, { asOf })).toBeGreaterThanOrEqual(12);
  });

  it('count habit whose range_start is after created_at has longestStreak >= currentStreak (not stuck at 0)', () => {
    const h = makeHabit({
      created_at: '2026-07-01T08:00:00',
      frequency_config: { kind: 'weekly', count: 3, range_start: '2026-08-03' },
    });
    const logs: BILog[] = [];
    const firstMon = parseLocalDate('2026-08-03')!;
    for (let w = 0; w < 4; w++) {
      const mon = addDaysLocal(firstMon, w * 7);
      logs.push(mkLog(ymd(addDaysLocal(mon, 1)), 'done'));
      logs.push(mkLog(ymd(addDaysLocal(mon, 3)), 'done'));
      logs.push(mkLog(ymd(addDaysLocal(mon, 5)), 'done'));
    }
    const asOf = parseLocalDate('2026-08-30')!;
    const cur = currentStreak(h, logs, asOf);
    const best = longestStreak(h, logs, { asOf });
    expect(cur).toBe(4);
    expect(best).toBeGreaterThanOrEqual(cur);
    expect(best).toBe(4);
  });

  it('NEGATIVE — legacy undated habit.status === "paused" and 0-target count habit keep streak 0', () => {
    const legacyPaused = makeHabit({
      status: 'paused',
      created_at: '2026-07-01T08:00:00',
      frequency_config: { kind: 'weekly', count: 3 },
    });
    const logs = [mkLog('2026-08-04', 'done'), mkLog('2026-08-06', 'done'), mkLog('2026-08-08', 'done')];
    const asOf = parseLocalDate('2026-08-09')!;
    expect(currentStreak(legacyPaused, logs, asOf)).toBe(0);
    expect(longestStreak(legacyPaused, logs, { asOf })).toBe(0);

    const zeroTarget = makeHabit({
      created_at: '2026-07-01T08:00:00',
      frequency_config: { kind: 'weekly', count: 0 },
    });
    expect(currentStreak(zeroTarget, logs, asOf)).toBe(0);
    expect(longestStreak(zeroTarget, logs, { asOf })).toBe(0);
  });
});

describe('F13 DOM-17 — negative habits treat unlogged days as transparent, explicit miss breaks', () => {
  const asOf = parseLocalDate('2026-08-05')!;
  const since = parseLocalDate('2026-08-01')!;
  const pattern: BILog[] = [
    mkLog('2026-08-01', 'done'),
    mkLog('2026-08-02', 'done'),
    // 2026-08-03 unlogged
    mkLog('2026-08-04', 'done'),
    mkLog('2026-08-05', 'done'),
  ];

  it('negative habit: [done, done, unlogged, done, done(asOf)] -> currentStreak 4 and longestStreak 4', () => {
    const neg = makeHabit({ behavior_type: 'negative', created_at: '2026-08-01T08:00:00' });
    expect(currentStreak(neg, pattern, asOf)).toBe(4);
    expect(longestStreak(neg, pattern, { since, asOf })).toBe(4);
  });

  it('NEGATIVE — positive habit on same pattern -> 2 and 2; explicit miss breaks negative habit', () => {
    const pos = makeHabit({ behavior_type: 'positive', created_at: '2026-08-01T08:00:00' });
    expect(currentStreak(pos, pattern, asOf)).toBe(2);
    expect(longestStreak(pos, pattern, { since, asOf })).toBe(2);

    const neg = makeHabit({ behavior_type: 'negative', created_at: '2026-08-01T08:00:00' });
    const withExplicitMiss = [...pattern, mkLog('2026-08-03', 'miss')];
    expect(currentStreak(neg, withExplicitMiss, asOf)).toBe(2);
    expect(longestStreak(neg, withExplicitMiss, { since, asOf })).toBe(2);
  });
});

describe('F13 DST calendar dates — streak walks across 2026-03-29 and 2026-10-25 without day drift', () => {
  it('counts exact streaks across spring (2026-03-29) and autumn (2026-10-25) DST Sundays', () => {
    const h = makeHabit({ created_at: '2026-01-01T08:00:00' });
    const springLogs = ['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30'].map((d) => mkLog(d, 'done'));
    expect(currentStreak(h, springLogs, parseLocalDate('2026-03-30')!)).toBe(4);

    const autumnLogs = ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'].map((d) => mkLog(d, 'done'));
    expect(currentStreak(h, autumnLogs, parseLocalDate('2026-10-26')!)).toBe(4);
  });
});
