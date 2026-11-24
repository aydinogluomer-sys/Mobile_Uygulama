/**
 * F13 — Schedule-aware habit strength (DOM-06).
 */
import type { Habit, HabitLog } from '../../lib/supabase';
import { addDaysLocal, parseLocalDate, ymd } from '../../lib/date';
import { isEligibleOn } from '../../lib/habitSchedule';
import { attachTimeOff, type PauseInterval } from '../../lib/habitPauses';
import { habitStrength, habitStrengthFor, type StrengthLog } from '../../lib/habitStrength';

const ASOF = new Date(2026, 10, 1); // Sunday 2026-11-01
const CREATED = '2026-08-01T08:00:00';

function makeHabit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'hs1',
    user_id: 'u1',
    name: 'Planlı Alışkanlık',
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
    estimated_minutes: 20,
    reminders: null,
    cue_habit_id: null,
    cue_note: null,
    life_area: null,
    end_condition: null,
    created_at: CREATED,
    ...over,
  } as Habit;
}

type LogRow = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state' | 'value'>;
const mkLog = (day: string, state: HabitLog['state'] = 'done', habitId = 'hs1'): LogRow => ({
  habit_id: habitId,
  completed_at: day,
  state,
  value: null,
});

function walkDueLogs(habit: Habit, fromYmd: string, toYmd: string): LogRow[] {
  const start = parseLocalDate(fromYmd)!;
  const out: LogRow[] = [];
  for (let cur = start; ymd(cur) <= toYmd; cur = addDaysLocal(cur, 1)) {
    if (isEligibleOn(habit, cur)) {
      out.push(mkLog(ymd(cur), 'done', habit.id));
    }
  }
  return out;
}

describe('F13 DOM-06 — habitStrengthFor on scheduled habits (positive)', () => {
  it('Mon/Wed/Fri kept flawlessly over 90 days scores 100 (not 43)', () => {
    const h = makeHabit({ frequency_config: { kind: 'weekly', days: [0, 2, 4] } });
    const logs = walkDueLogs(h, '2026-08-01', '2026-11-01');
    expect(habitStrengthFor(h, logs, { asOf: ASOF })).toBe(100);
  });

  it('every_n_days: 3 kept flawlessly over 90 days scores 100 (not ~33)', () => {
    const h = makeHabit({ frequency_config: { kind: 'daily', interval_days: 3 } });
    const logs = walkDueLogs(h, '2026-08-01', '2026-11-01');
    expect(habitStrengthFor(h, logs, { asOf: ASOF })).toBe(100);
  });

  it('weekly_count: 3 kept every week on Tue/Thu/Sat scores 100', () => {
    const h = makeHabit({ frequency_config: { kind: 'weekly', count: 3 } });
    const logs: LogRow[] = [];
    for (let cur = parseLocalDate('2026-08-03')!; ymd(cur) <= '2026-11-01'; cur = addDaysLocal(cur, 1)) {
      const dow = cur.getDay(); // 2=Tue, 4=Thu, 6=Sat
      if (dow === 2 || dow === 4 || dow === 6) {
        logs.push(mkLog(ymd(cur), 'done'));
      }
    }
    expect(habitStrengthFor(h, logs, { asOf: ASOF })).toBe(100);
  });

  it('monthly_count: 4 kept flawlessly in each month scores 100', () => {
    const h = makeHabit({ frequency_config: { kind: 'monthly', count: 4 } });
    const days = [
      '2026-08-02', '2026-08-09', '2026-08-16', '2026-08-23',
      '2026-09-03', '2026-09-10', '2026-09-17', '2026-09-24',
      '2026-10-04', '2026-10-11', '2026-10-18', '2026-10-25',
    ];
    const logs = days.map((d) => mkLog(d, 'done'));
    expect(habitStrengthFor(h, logs, { asOf: ASOF })).toBe(100);
  });

  it('a paused week (attachTimeOff pause_intervals) does not lower strength even with zero logs that week', () => {
    const pauses: PauseInterval[] = [
      { id: 'p1', habit_id: 'hs1', kind: 'pause', start_date: '2026-10-19', end_date: '2026-10-25' },
    ];
    const h = attachTimeOff([makeHabit({ frequency_config: { kind: 'weekly', days: [0, 2, 4] } })], pauses, [])[0];
    const logs = walkDueLogs(h, '2026-08-01', '2026-11-01');
    expect(logs.some((l) => l.completed_at >= '2026-10-19' && l.completed_at <= '2026-10-25')).toBe(false);
    expect(habitStrengthFor(h, logs, { asOf: ASOF })).toBe(100);
  });

  it('created_at in the future or zero evaluable expected days returns null (never 0)', () => {
    const futureHabit = makeHabit({ created_at: '2026-11-10T08:00:00' });
    expect(habitStrengthFor(futureHabit, [], { asOf: ASOF })).toBeNull();

    // Created today with no log yet -> today is pending, so zero evaluable days -> null
    const bornToday = makeHabit({ created_at: '2026-11-01T08:00:00' });
    expect(habitStrengthFor(bornToday, [], { asOf: ASOF })).toBeNull();
  });
});

describe('F13 DOM-06 — habitStrengthFor negative & contrast cases', () => {
  it('Mon/Wed/Fri with half of scheduled days missed scores between 45 and 55', () => {
    // asOf Monday 2026-11-02 (planned, unlogged -> pending). Alternating done/miss
    // puts exactly half of each bucket's planned days on each side: recent 1/2,
    // mid 5/10, long 13/26 -> 50.
    const asOfMon = new Date(2026, 10, 2);
    const h = makeHabit({ frequency_config: { kind: 'weekly', days: [0, 2, 4] } });
    const dueLogs = walkDueLogs(h, '2026-08-01', '2026-11-01');
    const mixed = dueLogs.map((l, idx) => ({ ...l, state: (idx % 2 === 0 ? 'done' : 'miss') as HabitLog['state'] }));
    const score = habitStrengthFor(h, mixed, { asOf: asOfMon });
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThanOrEqual(45);
    expect(score!).toBeLessThanOrEqual(55);
  });

  it('weekly_count: 3 with a closed week at 2/3 drops bucket rate to 2/3 (not 100)', () => {
    // Born Monday 2026-10-19; closed week Oct 19-25 has 2/3, current open week Oct 26-Nov 1 has 1/3 (pending).
    const h = makeHabit({ created_at: '2026-10-19T08:00:00', frequency_config: { kind: 'weekly', count: 3 } });
    const asOfSat = new Date(2026, 9, 31); // Saturday 2026-10-31, so Oct 26-Nov 1 is still open
    const logs = [mkLog('2026-10-20', 'done'), mkLog('2026-10-22', 'done'), mkLog('2026-10-27', 'done')];
    expect(habitStrengthFor(h, logs, { asOf: asOfSat })).toBe(Math.round((2 / 3) * 100));
  });

  it('unlogged scheduled asOf day does NOT lower strength (flawless past + pending today = 100)', () => {
    const asOfFri = new Date(2026, 9, 30); // Friday 2026-10-30 (scheduled for Mon/Wed/Fri)
    const h = makeHabit({ frequency_config: { kind: 'weekly', days: [0, 2, 4] } });
    const logs = walkDueLogs(h, '2026-08-01', '2026-10-29'); // Friday Oct 30 omitted
    expect(habitStrengthFor(h, logs, { asOf: asOfFri })).toBe(100);
  });

  it('same Mon/Wed/Fri logs through schedule-blind habitStrength(logs, { asOf, since }) keep the pre-F13 ~3/7 score (42 here)', () => {
    const h = makeHabit({ frequency_config: { kind: 'weekly', days: [0, 2, 4] } });
    const logs = walkDueLogs(h, '2026-08-01', '2026-11-01');
    const strengthLogs: StrengthLog[] = logs.map((l) => ({ completed_at: l.completed_at, state: l.state }));
    // BY HAND (every calendar day expected): recent Oct 26..Nov 1 = 3/7, mid
    // Oct 3..25 = 9/23, long Aug 4..Oct 2 = 26/60 ->
    // 0.5*3/7 + 0.35*9/23 + 0.15*26/60 = 0.4162 -> 42 (the "~43" of DOM-06).
    const blind = habitStrength(strengthLogs, { asOf: ASOF, since: parseLocalDate('2026-08-01')! });
    expect(blind).toBe(Math.round((0.5 * (3 / 7) + 0.35 * (9 / 23) + 0.15 * (26 / 60)) * 100));
    expect(blind).toBe(42);
    expect(habitStrengthFor(h, logs, { asOf: ASOF })).toBe(100);
  });
});

describe('F13 DOM-06 — count-lane creation week rule', () => {
  it('a week starting before created_at is ignored when unmet, but counted when satisfied', () => {
    // Created Saturday 2026-10-17 (week started Monday 2026-10-12).
    // Week Oct 19-25 satisfied (3/3); asOf = Wednesday 2026-10-28 (open week).
    const h = makeHabit({ created_at: '2026-10-17T09:00:00', frequency_config: { kind: 'weekly', count: 3 } });
    const asOfWed = new Date(2026, 9, 28);
    const unmetCreationWeek = [
      mkLog('2026-10-17', 'done'), // only 1 in creation week Oct 12-18 -> unmet, ignored
      mkLog('2026-10-20', 'done'),
      mkLog('2026-10-22', 'done'),
      mkLog('2026-10-24', 'done'),
    ];
    expect(habitStrengthFor(h, unmetCreationWeek, { asOf: asOfWed })).toBe(100);

    // If creation week itself WAS satisfied (e.g. only week with data), it counts as 100 instead of null.
    const asOfMon = new Date(2026, 9, 19);
    const metCreationWeek = [
      mkLog('2026-10-16', 'done'),
      mkLog('2026-10-17', 'done'),
      mkLog('2026-10-18', 'done'),
    ];
    expect(habitStrengthFor(h, metCreationWeek, { asOf: asOfMon })).toBe(100);
  });
});
