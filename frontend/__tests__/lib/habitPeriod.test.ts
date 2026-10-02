/**
 * L1 — canonical period status (Implementation v3.0, R01.01-a; guide §7.1, T01–T04).
 *
 * `periodStatus` is the single answer every consumer will migrate to in
 * R01.02. These fixtures are therefore the CANONICAL ones: the same weeks,
 * months and logs must produce the same numbers on Bugün, detay, raporlar,
 * recovery, review, bildirim ve AI once they are routed through it.
 *
 * What the cases pin, and why each one exists:
 *   - Tue/Thu/Sun satisfies "3 a week". `isDueOn` still says Mon/Wed/Sat for
 *     that habit (the R01 defect); the evaluator must not.
 *   - Three logs on one day are ONE day. The store's one-row-per-day invariant
 *     makes this hard to hit, so the test hits it on purpose.
 *   - An open period is never `closed_unmet`; a closed one is.
 *   - `sessions` is `unknown`, not a day count wearing a different label.
 *   - `amount` reads the engine's own `state` rather than re-deriving ceilings.
 *   - The week starts Monday and the day is device-local, and the result SAYS so.
 *
 * Two of these are mutation-proven in the R01.01-a report: breaking unique-day
 * counting and calling an open period closed each turn a named case red.
 */
import type { Habit, HabitLog } from '../../lib/supabase';
import { periodStatus, streakBroken, isDueOn, isWindowSatisfied, weekdayIndex } from '../../lib/habitSchedule';
import { ymd } from '../../lib/date';

function habit(over: Partial<Habit> = {}): Habit {
  return {
    id: 'h1',
    user_id: 'u1',
    name: 'test',
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    status: 'active',
    frequency_config: { kind: 'daily' },
    created_at: '2020-01-01T00:00:00Z',
    end_condition: null,
    ...over,
  } as Habit;
}

type Log = Pick<HabitLog, 'habit_id' | 'completed_at' | 'state'> & { value?: number | null };
const log = (d: Date, state: HabitLog['state'] = 'done', value: number | null = null, habit_id = 'h1'): Log =>
  ({ habit_id, completed_at: ymd(d), state, value });

// 2026-08-03 is a Monday; the local week runs Mon 03 .. Sun 09. Next Monday is 10.
const MON = new Date(2026, 7, 3);
const TUE = new Date(2026, 7, 4);
const WED = new Date(2026, 7, 5);
const THU = new Date(2026, 7, 6);
const FRI = new Date(2026, 7, 7);
const SUN = new Date(2026, 7, 9);
const NEXT_MON = new Date(2026, 7, 10);
const PREV_SUN = new Date(2026, 7, 2);

const weekly3 = habit({ frequency_config: { kind: 'weekly', count: 3 } });

describe('T01 — weekly count: different days satisfy the period', () => {
  const logs = [log(TUE), log(THU), log(SUN)];

  it('Tue + Thu + Sun, target 3 -> satisfied, remaining 0', () => {
    const r = periodStatus(weekly3, logs, SUN, { asOf: SUN });
    expect(r.status).toBe('satisfied');
    expect(r.unit).toBe('days');
    expect(r.target).toBe(3);
    expect(r.counted).toBe(3);
    expect(r.actual).toBe(3);
    expect(r.remaining).toBe(0);
    expect(ymd(r.periodStart)).toBe('2026-08-03');
    expect(ymd(r.periodEnd)).toBe('2026-08-09');
  });

  it('stays satisfied after the week closes -- success does not expire', () => {
    expect(periodStatus(weekly3, logs, SUN, { asOf: NEXT_MON }).status).toBe('satisfied');
  });

  it('is the divergence from isDueOn that R01.02 must close', () => {
    // The old predicate maps count=3 to Mon/Wed/Sat, so every one of the days
    // the user actually chose reads as "not due" and the Mon/Wed/Sat gaps read
    // as misses. Recorded here as a fact, not fixed here.
    expect([TUE, THU, SUN].map((d) => isDueOn(weekly3, d))).toEqual([false, false, false]);
    expect([MON, WED].map((d) => isDueOn(weekly3, d))).toEqual([true, true]);
    expect(weekdayIndex(TUE)).toBe(1);
  });
});

describe('same-day duplicates count once', () => {
  it('three logs on Tuesday are one day, target 3 -> counted 1', () => {
    const logs = [log(TUE, 'done'), log(TUE, 'done'), log(TUE, 'partial')];
    const r = periodStatus(weekly3, logs, WED, { asOf: WED });
    expect(r.counted).toBe(1);
    expect(r.actual).toBe(1);
    expect(r.remaining).toBe(2);
    expect(r.status).toBe('in_progress');
  });

  it('a retried identical completion is not a second day', () => {
    const logs = [log(TUE), log(TUE), log(THU)];
    expect(periodStatus(weekly3, logs, THU, { asOf: THU }).counted).toBe(2);
  });

  it("exposes the older helper's row-counting: isWindowSatisfied says 3 rows satisfy, the evaluator says 1 day", () => {
    // Recorded on purpose, not fixed here: the helper leans on the DB's
    // one-row-per-day invariant, which an in-memory array does not guarantee.
    const logs = [log(TUE, 'done'), log(TUE, 'done'), log(TUE, 'partial')];
    expect(isWindowSatisfied(weekly3, logs, WED)).toBe(true);
    expect(periodStatus(weekly3, logs, WED, { asOf: WED }).status).toBe('in_progress');
  });

  it('within a day, a stale partial row does not demote a done', () => {
    const logs = [log(TUE, 'done'), log(TUE, 'partial')];
    expect(periodStatus(weekly3, logs, TUE, { asOf: TUE }).counted).toBe(1);
  });

  it('logs of another habit never leak into the count', () => {
    const logs = [log(TUE), log(THU, 'done', null, 'other'), log(SUN, 'done', null, 'other')];
    expect(periodStatus(weekly3, logs, SUN, { asOf: SUN }).counted).toBe(1);
  });
});

describe('T02 — open weekly period', () => {
  it('2/3 on Friday -> in_progress, remaining 1, never closed_unmet', () => {
    const r = periodStatus(weekly3, [log(TUE), log(THU)], FRI, { asOf: FRI });
    expect(r.status).toBe('in_progress');
    expect(r.remaining).toBe(1);
    expect(r.reason).toBe('ok');
  });

  it('0/3 on Tuesday -> not_started', () => {
    const r = periodStatus(weekly3, [], TUE, { asOf: TUE });
    expect(r.status).toBe('not_started');
    expect(r.remaining).toBe(3);
  });

  it('1/3 on Sunday is still in_progress, but flagged unreachable -- and agrees with streakBroken', () => {
    const logs = [log(TUE)];
    const r = periodStatus(weekly3, logs, SUN, { asOf: SUN });
    expect(r.status).toBe('in_progress');
    expect(r.reason).toBe('unreachable_in_remaining_days');
    // The older helper says "broken" for the same input. Not a contradiction:
    // it answers "can the streak survive?", the evaluator answers "is the
    // period over?". Both must be visible to the consumer migration.
    expect(streakBroken(weekly3, logs, SUN)).toBe(true);
  });

  it('a future week is not_started with period_not_started', () => {
    const r = periodStatus(weekly3, [], NEXT_MON, { asOf: SUN });
    expect(r.status).toBe('not_started');
    expect(r.reason).toBe('period_not_started');
  });
});

describe('T03 — open monthly period', () => {
  const monthly10 = habit({ frequency_config: { kind: 'monthly', count: 10 } });
  const sep = (d: number) => new Date(2026, 8, d);
  const logs = [log(sep(1)), log(sep(3)), log(sep(5)), log(sep(9))];

  it('4/10 on the 12th -> in_progress, remaining 6, bounded to the calendar month', () => {
    const r = periodStatus(monthly10, logs, sep(12), { asOf: sep(12) });
    expect(r.status).toBe('in_progress');
    expect(r.counted).toBe(4);
    expect(r.remaining).toBe(6);
    expect(ymd(r.periodStart)).toBe('2026-09-01');
    expect(ymd(r.periodEnd)).toBe('2026-09-30');
    expect(r.reason).toBe('ok');
  });

  it('the old predicate says a monthly habit is never due; the evaluator disagrees on purpose', () => {
    expect(isDueOn(monthly10, sep(12))).toBe(false);
    expect(periodStatus(monthly10, logs, sep(12), { asOf: sep(12) }).status).not.toBe('unknown');
  });
});

describe('T04 — closed period', () => {
  it('2/3 after the week ended -> closed_unmet', () => {
    const r = periodStatus(weekly3, [log(TUE), log(THU)], SUN, { asOf: NEXT_MON });
    expect(r.status).toBe('closed_unmet');
    expect(r.remaining).toBe(1);
  });

  it('4/10 after the month ended -> closed_unmet', () => {
    const monthly10 = habit({ frequency_config: { kind: 'monthly', count: 10 } });
    const logs = [1, 3, 5, 9].map((d) => log(new Date(2026, 8, d)));
    expect(periodStatus(monthly10, logs, new Date(2026, 8, 12), { asOf: new Date(2026, 9, 1) }).status).toBe('closed_unmet');
  });
});

describe('T05 — paused', () => {
  it('a paused habit evaluates to paused, whatever the logs say', () => {
    const paused = habit({ frequency_config: { kind: 'weekly', count: 3 }, status: 'paused' });
    const r = periodStatus(paused, [log(TUE), log(THU), log(SUN)], SUN, { asOf: SUN });
    expect(r.status).toBe('paused');
    expect(r.reason).toBe('habit_paused');
    expect(r.counted).toBe(0);
  });
});

describe('T06 — no target', () => {
  it('weekly with neither days nor count -> unknown / no_target', () => {
    const r = periodStatus(habit({ frequency_config: { kind: 'weekly' } }), [log(TUE)], TUE, { asOf: TUE });
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('no_target');
    expect(r.target).toBe(0);
  });

  it('monthly count 0 -> unknown / no_target', () => {
    const r = periodStatus(habit({ frequency_config: { kind: 'monthly', count: 0 } }), [], TUE, { asOf: TUE });
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('no_target');
  });
});

describe('T07 — sessions are not supported by the data model', () => {
  it('asking for sessions returns unknown / sessions_unsupported with nothing counted', () => {
    const r = periodStatus(weekly3, [log(TUE), log(THU), log(SUN)], SUN, { asOf: SUN, unit: 'sessions' });
    expect(r.unit).toBe('sessions');
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('sessions_unsupported');
    expect(r.counted).toBe(0);
    expect(r.actual).toBe(0);
  });
});

describe('T08 — amount', () => {
  const minutes20 = habit({ tracking_type: 'duration', daily_goal: 20, unit: 'dakika', target_direction: 'at_least' });

  it('10 of 20 minutes logged (partial) -> amount, actual 10, remaining 10, in_progress', () => {
    const r = periodStatus(minutes20, [log(TUE, 'partial', 10)], TUE, { asOf: TUE });
    expect(r.unit).toBe('amount');
    expect(r.target).toBe(20);
    expect(r.counted).toBe(1);
    expect(r.actual).toBe(10);
    expect(r.remaining).toBe(10);
    expect(r.status).toBe('in_progress');
    expect(ymd(r.periodStart)).toBe(ymd(TUE));
    expect(ymd(r.periodEnd)).toBe(ymd(TUE));
  });

  it('20 of 20 (done) -> satisfied', () => {
    const r = periodStatus(minutes20, [log(TUE, 'done', 20)], TUE, { asOf: TUE });
    expect(r.status).toBe('satisfied');
    expect(r.remaining).toBe(0);
  });

  it('nothing logged and the day is over -> closed_unmet', () => {
    expect(periodStatus(minutes20, [], TUE, { asOf: WED }).status).toBe('closed_unmet');
  });

  it('a ceiling met mid-day is satisfied but provisional; an explicit miss closes the day', () => {
    const atMost2 = habit({ tracking_type: 'numeric', daily_goal: 2, target_direction: 'at_most', behavior_type: 'negative' });
    const ok = periodStatus(atMost2, [log(TUE, 'done', 1)], TUE, { asOf: TUE });
    expect(ok.status).toBe('satisfied');
    expect(ok.reason).toBe('provisional_until_close');
    expect(ok.remaining).toBe(0); // "remaining" has no meaning for a ceiling
    const over = periodStatus(atMost2, [log(TUE, 'miss', 3)], TUE, { asOf: TUE });
    expect(over.status).toBe('closed_unmet');
    expect(over.reason).toBe('explicit_miss');
    // once the day is over, the same ceiling result is no longer provisional
    expect(periodStatus(atMost2, [log(TUE, 'done', 1)], TUE, { asOf: WED }).reason).toBe('ok');
  });

  it('amount requested on a count-mode habit -> unknown / amount_unsupported (no period amount target exists)', () => {
    const r = periodStatus(weekly3, [log(TUE, 'done', 30)], TUE, { asOf: TUE, unit: 'amount' });
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('amount_unsupported');
  });

  it('amount requested on a boolean habit -> unknown / amount_unsupported (no daily_goal)', () => {
    const r = periodStatus(habit(), [log(TUE, 'done')], TUE, { asOf: TUE, unit: 'amount' });
    expect(r.reason).toBe('amount_unsupported');
  });
});

describe('day-based modes: the period is the day, eligibility is unchanged', () => {
  const monWed = habit({ frequency_config: { kind: 'weekly', days: [0, 2] } });

  it('a due day with a done log -> satisfied; unit days, target 1', () => {
    const r = periodStatus(monWed, [log(MON)], MON, { asOf: MON });
    expect(r).toMatchObject({ unit: 'days', target: 1, counted: 1, remaining: 0, status: 'satisfied' });
    expect(ymd(r.periodStart)).toBe(ymd(MON));
  });

  it('a non-due day -> unknown / not_scheduled, exactly where isDueOn says false', () => {
    expect(isDueOn(monWed, TUE)).toBe(false);
    const r = periodStatus(monWed, [], TUE, { asOf: TUE });
    expect(r.status).toBe('unknown');
    expect(r.reason).toBe('not_scheduled');
  });

  it('a due day with no log: not_started while open, closed_unmet once over', () => {
    expect(periodStatus(monWed, [], MON, { asOf: MON }).status).toBe('not_started');
    expect(periodStatus(monWed, [], MON, { asOf: TUE }).status).toBe('closed_unmet');
  });

  it('skip is excused -> unknown / skipped; explicit miss -> closed_unmet / explicit_miss', () => {
    expect(periodStatus(monWed, [log(MON, 'skip')], MON, { asOf: MON })).toMatchObject({ status: 'unknown', reason: 'skipped' });
    expect(periodStatus(monWed, [log(MON, 'miss')], MON, { asOf: MON })).toMatchObject({ status: 'closed_unmet', reason: 'explicit_miss' });
  });

  it('daily habit created after the date -> not_scheduled (created_at guard inherited from isDueOn)', () => {
    const late = habit({ created_at: '2026-08-06T10:00:00Z' });
    expect(periodStatus(late, [], TUE, { asOf: SUN }).reason).toBe('not_scheduled');
  });
});

describe('local date boundaries', () => {
  it('a Sunday log belongs to its own week, not the next Monday\'s', () => {
    const logs = [log(PREV_SUN), log(MON)];
    // Week of Mon 03: only Monday's log is inside.
    expect(periodStatus(weekly3, logs, WED, { asOf: WED }).counted).toBe(1);
    // Week of Mon 27 Jul .. Sun 02 Aug: only Sunday's log is inside.
    expect(periodStatus(weekly3, logs, PREV_SUN, { asOf: WED }).counted).toBe(1);
  });

  it('31 Aug and 1 Sep fall in different months', () => {
    const monthly2 = habit({ frequency_config: { kind: 'monthly', count: 2 } });
    const logs = [log(new Date(2026, 7, 31)), log(new Date(2026, 8, 1))];
    expect(periodStatus(monthly2, logs, new Date(2026, 7, 15), { asOf: new Date(2026, 8, 2) })).toMatchObject({ counted: 1, status: 'closed_unmet' });
    expect(periodStatus(monthly2, logs, new Date(2026, 8, 15), { asOf: new Date(2026, 8, 2) })).toMatchObject({ counted: 1, status: 'in_progress' });
  });

  it('states its basis: device-local day, Monday week -- no per-habit column exists', () => {
    const r = periodStatus(weekly3, [], TUE, { asOf: TUE });
    expect(r.basis).toEqual({ timezone: 'device-local', weekStart: 'monday' });
    expect(weekdayIndex(MON)).toBe(0);
  });

  it('asOf defaults to the real clock when omitted (a 2026 week is closed by now)', () => {
    expect(periodStatus(weekly3, [log(TUE)], TUE).status).toBe('closed_unmet');
  });
});
