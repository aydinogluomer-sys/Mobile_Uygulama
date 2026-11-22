/**
 * R04.01 / R04.02 / F17 — reminders follow the schedule, carry absolute instants
 * in their reconcile keys (DOM-04), defer out of quiet hours when possible in
 * the same local day and enforce a fair, day-stable daily cap (DOM-15), reserve
 * dynamic iOS pending budget, and compute the re-entry nudge instant (DOM-05).
 */
import {
  planReminders,
  reconcile,
  classifyScheduled,
  inQuietHours,
  shiftOutOfQuiet,
  applyDailyCap,
  normaliseMaxPerDay,
  habitSlotBudget,
  reentryTime,
  hasReminderHabits,
  reminderTimes,
  buildReminderConfig,
  reminderKey,
  DEFAULT_REMINDER_SETTINGS,
  DEFAULT_MAX_PER_DAY,
  MAX_PER_DAY_CHOICES,
  MAX_PER_DAY_BOUNDS,
  SHIFT_STEP_MINUTES,
  REENTRY_KIND,
  type PlanLog,
  type ReminderSettings,
} from '../../lib/reminderPlan';
import { shouldRecordHandled, type HandledOutcome } from '../../lib/notificationActions';
import { attachTimeOff } from '../../lib/habitPauses';
import type { Habit } from '../../lib/supabase';

// Mon 5 Oct 2026, 06:00 local
const NOW = new Date(2026, 9, 5, 6, 0, 0);
const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', user_id: 'u', name: 'Yürüyüş', icon: null, color: null, behavior_type: 'positive',
  tracking_type: 'boolean', unit: null, daily_goal: null, target_direction: null,
  frequency_config: { kind: 'daily' }, willpower_cost: 3, status: 'active', impact_level: null,
  urgency: null, difficulty: 3, estimated_minutes: 20, reminders: { enabled: true, time: '08:00' },
  cue_habit_id: null, cue_note: null, life_area: null, end_condition: null, created_at: '2026-09-01T08:00:00', ...over,
} as Habit);
const days = (p: ReturnType<typeof planReminders>) => p.reminders.map((r) => r.day);
const plan = (habits: Habit[], logs: PlanLog[] | null = [], extra: Partial<Parameters<typeof planReminders>[0]> = {}) =>
  planReminders({ habits, logs, settings: DEFAULT_REMINDER_SETTINGS, now: NOW, ...extra });

describe('the schedule decides the days', () => {
  it('a Mon/Thu habit is not reminded on Tuesday', () => {
    const p = plan([habit({ frequency_config: { kind: 'weekly', days: [0, 3] } })]);
    expect(days(p)).toEqual(['2026-10-05', '2026-10-08']);
  });

  it('a daily habit is reminded each of the next 7 days at its time', () => {
    const p = plan([habit()]);
    expect(p.reminders).toHaveLength(7);
    expect(p.reminders[0].at).toEqual(new Date(2026, 9, 5, 8, 0, 0));
  });

  it('"3 a week" already met stops reminding for the rest of the week', () => {
    const logs: PlanLog[] = [
      { habit_id: 'h1', completed_at: '2026-10-05', state: 'done' },
      { habit_id: 'h1', completed_at: '2026-10-06', state: 'done' },
      { habit_id: 'h1', completed_at: '2026-10-07', state: 'done' },
    ];
    const p = planReminders({ habits: [habit({ frequency_config: { kind: 'weekly', count: 3 } })], logs, settings: DEFAULT_REMINDER_SETTINGS, now: new Date(2026, 9, 7, 20, 0) });
    expect(days(p)).toEqual(['2026-10-12', '2026-10-13']);
  });

  it('waiting and legacy-paused habits are not reminded', () => {
    expect(plan([habit({ status: 'waiting' }), habit({ id: 'h2', status: 'paused' })]).reminders).toEqual([]);
  });

  it('a dated break or holiday stops reminders on those days only', () => {
    const [h] = attachTimeOff([habit()], [{ id: 'p', habit_id: null, kind: 'holiday', start_date: '2026-10-06', end_date: '2026-10-08' }], []) as Habit[];
    expect(days(plan([h]))).toEqual(['2026-10-05', '2026-10-09', '2026-10-10', '2026-10-11']);
  });

  it('a day already logged is not reminded; the next days are', () => {
    const p = plan([habit()], [{ habit_id: 'h1', completed_at: '2026-10-05', state: 'done' }]);
    expect(days(p)[0]).toBe('2026-10-06');
    const skipped = plan([habit()], [{ habit_id: 'h1', completed_at: '2026-10-05', state: 'skip' }]);
    expect(days(skipped)[0]).toBe('2026-10-06');
  });

  it('a time already past today is not planned', () => {
    const p = planReminders({ habits: [habit()], logs: [], settings: DEFAULT_REMINDER_SETTINGS, now: new Date(2026, 9, 5, 9, 0) });
    expect(days(p)[0]).toBe('2026-10-06');
  });

  it('a reminder turned off plans nothing', () => {
    expect(plan([habit({ reminders: { enabled: false, time: '08:00' } })]).reminders).toEqual([]);
  });
});

describe('R04.02 & DOM-15 — times, day groups, quiet hours and same-day deferral', () => {
  it('several times a day, each planned', () => {
    const p = plan([habit({ reminders: { enabled: true, time: '08:00', times: ['08:00', '20:00'] } })], [], { horizonDays: 1 });
    expect(p.reminders.map((r) => r.time)).toEqual(['08:00', '20:00']);
  });

  it('a day group narrows the scheduled days', () => {
    const p = plan([habit({ reminders: { enabled: true, time: '08:00', days: [0, 2] } })]);
    expect(days(p)).toEqual(['2026-10-05', '2026-10-07']);
  });

  it('quiet hours defer morning times to quietEnd within the same day', () => {
    const q = { quietStart: '22:00', quietEnd: '07:00' };
    expect(inQuietHours('23:30', q)).toBe(true);
    expect(inQuietHours('06:59', q)).toBe(true);
    expect(inQuietHours('07:00', q)).toBe(false);
    expect(inQuietHours('12:00', { quietStart: '12:00', quietEnd: '14:00' })).toBe(true);
    expect(inQuietHours('14:00', { quietStart: '12:00', quietEnd: '14:00' })).toBe(false);
    const p = planReminders({
      habits: [habit({ reminders: { enabled: true, time: '06:30', times: ['06:30', '08:00'] } })],
      logs: [],
      settings: { ...DEFAULT_REMINDER_SETTINGS, ...q },
      now: NOW,
      horizonDays: 1,
    });
    expect(p.reminders.map((r) => r.time)).toEqual(['07:00', '08:00']);
    expect(p.reminders[0].shiftedFrom).toBe('06:30');
    expect(p.deferred).toBe(1);
    expect(p.quieted).toBe(0);
  });

  it('shiftOutOfQuiet handles same-day deferral, pre-midnight drop, boundaries and malformed inputs', () => {
    const night = { quietStart: '22:00', quietEnd: '07:00' };
    expect(shiftOutOfQuiet('06:30', night)).toBe('07:00');
    expect(shiftOutOfQuiet('23:30', night)).toBeNull();
    expect(shiftOutOfQuiet('12:00', night)).toBe('12:00');
    expect(shiftOutOfQuiet('12:30', { quietStart: '12:00', quietEnd: '14:00' })).toBe('14:00');
    expect(shiftOutOfQuiet('06:59', night)).toBe('07:00');
    expect(shiftOutOfQuiet('07:00', night)).toBe('07:00');
    expect(shiftOutOfQuiet('25:00', night)).toBeNull();
    expect(shiftOutOfQuiet('23:30', { quietStart: '22:00', quietEnd: '00:00' })).toBeNull();
    expect(shiftOutOfQuiet('06:30', { quietStart: null, quietEnd: null })).toBe('06:30');
  });

  it('pre-midnight quiet reminder is quieted (not deferred to tomorrow); already-past deferred reminder does not increment quieted', () => {
    const night = { ...DEFAULT_REMINDER_SETTINGS, quietStart: '22:00', quietEnd: '07:00' };
    const late = planReminders({
      habits: [habit({ reminders: { enabled: true, time: '23:30' } })],
      logs: [],
      settings: night,
      now: NOW,
      horizonDays: 1,
    });
    expect(late.reminders).toEqual([]);
    expect(late.quieted).toBe(1);
    expect(late.deferred).toBe(0);

    const pastShifted = planReminders({
      habits: [habit({ reminders: { enabled: true, time: '06:30' } })],
      logs: [],
      settings: night,
      now: new Date(2026, 9, 5, 7, 10, 0),
      horizonDays: 1,
    });
    expect(pastShifted.reminders).toEqual([]);
    expect(pastShifted.quieted).toBe(0);
    expect(pastShifted.deferred).toBe(0);
  });

  it('spreads multiple deferred reminders by 5 minutes and never moves natural reminders', () => {
    expect(SHIFT_STEP_MINUTES).toBe(5);
    const night = { ...DEFAULT_REMINDER_SETTINGS, quietStart: '22:00', quietEnd: '07:00', maxPerDay: null };
    const twoShifted = planReminders({
      habits: [
        habit({ id: 'a', reminders: { enabled: true, time: '06:30' } }),
        habit({ id: 'b', reminders: { enabled: true, time: '06:45' } }),
      ],
      logs: [],
      settings: night,
      now: NOW,
      horizonDays: 1,
    });
    expect(twoShifted.reminders.map((r) => [r.habitId, r.time, r.shiftedFrom])).toEqual([
      ['a', '07:00', '06:30'],
      ['b', '07:05', '06:45'],
    ]);

    const collisionWithNatural = planReminders({
      habits: [
        habit({ id: 'a', reminders: { enabled: true, time: '06:30' } }),
        habit({ id: 'b', reminders: { enabled: true, time: '07:00' } }),
      ],
      logs: [],
      settings: night,
      now: NOW,
      horizonDays: 1,
    });
    expect(collisionWithNatural.reminders.map((r) => [r.habitId, r.time, r.shiftedFrom])).toEqual([
      ['b', '07:00', undefined],
      ['a', '07:05', '06:30'],
    ]);
  });

  it('times are validated, unique and sorted; a malformed one is dropped', () => {
    expect(reminderTimes(habit({ reminders: { enabled: true, time: '8:05', times: ['20:00', '8:05', '20:00', '25:00'] } }))).toEqual(['08:05', '20:00']);
  });

  it('buildReminderConfig checks the edit and keeps `time` for older builds', () => {
    expect(buildReminderConfig(true, ['20:00', '07:30'], [])).toEqual({ ok: true, config: { enabled: true, time: '07:30', times: ['07:30', '20:00'] } });
    expect(buildReminderConfig(true, ['08:00'], [0, 3])).toMatchObject({ ok: true, config: { days: [0, 3] } });
    expect(buildReminderConfig(true, ['08:00'], [0, 1, 2, 3, 4, 5, 6])).toEqual({ ok: true, config: { enabled: true, time: '08:00', times: ['08:00'] } });
    expect(buildReminderConfig(true, ['08:00', '08:00'], []).ok).toBe(false);
    expect(buildReminderConfig(true, ['8'], []).ok).toBe(false);
    expect(buildReminderConfig(true, ['01:00', '02:00', '03:00', '04:00', '05:00'], []).ok).toBe(false);
  });
});

describe('DOM-15 — Calm-Tech daily cap, fairness and intra-day stability', () => {
  it('caps 12 habits x 4 times to 3 by default and allows unlimited when maxPerDay is null', () => {
    const twelve = Array.from({ length: 12 }, (_, i) =>
      habit({
        id: `h${String(i).padStart(2, '0')}`,
        reminders: { enabled: true, time: '08:00', times: ['08:00', '12:00', '16:00', '20:00'] },
      }),
    );
    const cappedPlan = plan(twelve, [], { horizonDays: 1 });
    expect(cappedPlan.reminders).toHaveLength(3);
    expect(cappedPlan.capped).toBe(45);

    const uncappedPlan = plan(twelve, [], {
      horizonDays: 1,
      settings: { ...DEFAULT_REMINDER_SETTINGS, maxPerDay: null },
    });
    expect(uncappedPlan.reminders).toHaveLength(48);
    expect(uncappedPlan.capped).toBe(0);
  });

  it('two-pass selection gives every habit one slot before a second slot goes to an earlier habit, and stays stable across the day', () => {
    const habits = [
      habit({ id: 'A', reminders: { enabled: true, time: '08:00', times: ['08:00', '12:00', '18:00'] } }),
      habit({ id: 'B', reminders: { enabled: true, time: '20:00', times: ['20:00'] } }),
    ];
    const morning = planReminders({
      habits,
      logs: [],
      settings: DEFAULT_REMINDER_SETTINGS,
      now: new Date(2026, 9, 5, 6, 0, 0),
      horizonDays: 1,
    });
    expect(morning.reminders.map((r) => `${r.habitId}@${r.time}`)).toEqual(['A@08:00', 'A@12:00', 'B@20:00']);
    expect(morning.capped).toBe(1);

    // At 13:00, A@08:00 and A@12:00 are in the past; A@18:00 MUST STILL be eliminated so the day does not reshuffle.
    const afternoon = planReminders({
      habits,
      logs: [],
      settings: DEFAULT_REMINDER_SETTINGS,
      now: new Date(2026, 9, 5, 13, 0, 0),
      horizonDays: 1,
    });
    expect(afternoon.reminders.map((r) => `${r.habitId}@${r.time}`)).toEqual(['B@20:00']);
    expect(afternoon.capped).toBe(1);
  });

  it('a habit logged today still occupies its daily cap slot so logging never triggers extra evening notifications', () => {
    const habits = [
      habit({ id: 'A', reminders: { enabled: true, time: '08:00' } }),
      habit({ id: 'B', reminders: { enabled: true, time: '12:00' } }),
      habit({ id: 'C', reminders: { enabled: true, time: '18:00' } }),
      habit({ id: 'D', reminders: { enabled: true, time: '20:00' } }),
    ];
    const p = planReminders({
      habits,
      logs: [{ habit_id: 'A', completed_at: '2026-10-05', state: 'done' }],
      settings: DEFAULT_REMINDER_SETTINGS,
      now: new Date(2026, 9, 5, 13, 0, 0),
      horizonDays: 1,
    });
    expect(p.reminders.map((r) => `${r.habitId}@${r.time}`)).toEqual(['C@18:00']);
    expect(p.capped).toBe(1);
  });

  it('normalises maxPerDay and treats legacy settings missing maxPerDay as DEFAULT_MAX_PER_DAY (3)', () => {
    expect(DEFAULT_MAX_PER_DAY).toBe(3);
    expect(MAX_PER_DAY_CHOICES).toEqual([3, 5, 8, null]);
    expect(MAX_PER_DAY_BOUNDS).toEqual({ min: 1, max: 12 });
    expect(normaliseMaxPerDay(undefined)).toBe(3);
    expect(normaliseMaxPerDay(null)).toBeNull();
    expect(normaliseMaxPerDay(1)).toBe(1);
    expect(normaliseMaxPerDay(12)).toBe(12);
    expect(normaliseMaxPerDay(5)).toBe(5);
    expect(normaliseMaxPerDay(0)).toBe(3);
    expect(normaliseMaxPerDay(13)).toBe(3);
    expect(normaliseMaxPerDay(2.5)).toBe(3);
    expect(normaliseMaxPerDay('x')).toBe(3);
    expect(normaliseMaxPerDay(NaN)).toBe(3);

    const legacySettings = { quietStart: null, quietEnd: null, hideTitles: false } as unknown as ReminderSettings;
    const four = ['a', 'b', 'c', 'd'].map((id) => habit({ id, reminders: { enabled: true, time: '09:00' } }));
    const p = planReminders({ habits: four, logs: [], settings: legacySettings, now: NOW, horizonDays: 1 });
    expect(p.reminders).toHaveLength(3);
    expect(p.capped).toBe(1);

    expect(applyDailyCap([{ habitId: 'a', at: new Date(2026, 9, 5, 8, 0) }], null).removed).toEqual([]);
  });
});

describe('R04.04 & DOM-05 — OS limit, dynamic budget, re-entry instant and hasReminderHabits', () => {
  it('keeps the nearest within maxPending when daily cap is disabled and reports dropped', () => {
    const many = Array.from({ length: 10 }, (_, i) => habit({ id: `h${i}`, reminders: { enabled: true, time: '08:00' } }));
    const p = plan(many, [], { maxPending: 56, settings: { ...DEFAULT_REMINDER_SETTINGS, maxPerDay: null } });
    expect(p.reminders).toHaveLength(56);
    expect(p.dropped).toBe(70 - 56);
    expect(p.reminders.every((r, i, a) => i === 0 || a[i - 1].at <= r.at)).toBe(true);
  });

  it('computes dynamic iOS slot budget clamped between 8 and 56', () => {
    expect(habitSlotBudget(0)).toBe(56);
    expect(habitSlotBudget(10)).toBe(47);
    expect(habitSlotBudget(49)).toBe(8);
    expect(habitSlotBudget(100)).toBe(8);
    expect(habitSlotBudget(NaN)).toBe(56);
    expect(habitSlotBudget(-3)).toBe(56);
  });

  it('computes reentryTime on the last day of the horizon outside quiet hours', () => {
    expect(reentryTime(NOW, 7, { quietStart: null, quietEnd: null })).toEqual(new Date(2026, 9, 11, 10, 0, 0, 0));
    expect(reentryTime(NOW, 7, { quietStart: '22:00', quietEnd: '07:00' })).toEqual(new Date(2026, 9, 11, 10, 0, 0, 0));
    expect(reentryTime(NOW, 7, { quietStart: '08:00', quietEnd: '12:00' })).toEqual(new Date(2026, 9, 11, 12, 0, 0, 0));
    expect(reentryTime(NOW, 7, { quietStart: '09:00', quietEnd: '08:00' })).toEqual(new Date(2026, 9, 12, 8, 0, 0, 0));
  });

  it('hasReminderHabits checks both active status and enabled reminders', () => {
    expect(hasReminderHabits([])).toBe(false);
    expect(hasReminderHabits([habit({ reminders: { enabled: false, time: '08:00' } })])).toBe(false);
    expect(hasReminderHabits([habit({ status: 'waiting' })])).toBe(false);
    expect(hasReminderHabits([habit()])).toBe(true);
  });
});

describe('DOM-04 — absolute-instant keys, timezone shifts, DST idempotency and reconcile', () => {
  const wanted = plan([habit()], [], { horizonDays: 2 }).reminders;

  it('keeps what is wanted, adds what is missing, cancels the rest -- including @-less legacy keys', () => {
    const scheduled = [
      { identifier: 'keep', data: { kind: 'habit', key: wanted[0].key, habitId: 'h1', day: wanted[0].day } },
      { identifier: 'dupe', data: { kind: 'habit', key: wanted[0].key } },
      { identifier: 'stale', data: { kind: 'habit', key: reminderKey('h1', '2026-10-01', '08:00', new Date(2026, 9, 1, 8, 0)) } },
      { identifier: 'old-format', data: { kind: 'habit', key: 'h:h1:2026-10-05:08:00' } },
      { identifier: 'legacy', data: { habitId: 'h1' } },
      { identifier: 'reentry', data: { kind: REENTRY_KIND } },
      { identifier: 'focus', data: { kind: 'focus-end' } },
      { identifier: 'recovery', data: { recoveryId: 'r1' } },
      { identifier: 'snooze', data: { kind: 'snooze', habitId: 'h1', day: '2026-10-05' } },
      { identifier: 'foreign', data: null },
    ];
    const d = reconcile(scheduled, wanted);
    expect(d.cancel.sort()).toEqual(['dupe', 'legacy', 'old-format', 'stale']);
    expect(d.add.map((a) => a.key)).toEqual([wanted[1].key]);
  });

  it('timezone shift (Istanbul 05:00Z -> Berlin 07:00Z for local 08:00) produces distinct keys and replaces scheduled notification', () => {
    const istanbulAt = new Date(Date.UTC(2026, 10, 3, 5, 0));
    const berlinAt = new Date(Date.UTC(2026, 10, 3, 7, 0));
    const kIst = reminderKey('h1', '2026-11-03', '08:00', istanbulAt);
    const kBer = reminderKey('h1', '2026-11-03', '08:00', berlinAt);
    expect(kIst).not.toBe(kBer);
    expect(kIst).toContain('@');

    const berlinPlanned = { key: kBer, habitId: 'h1', day: '2026-11-03', time: '08:00', at: berlinAt };
    const diffShift = reconcile([{ identifier: 'ist', data: { kind: 'habit', key: kIst } }], [berlinPlanned]);
    expect(diffShift.cancel).toEqual(['ist']);
    expect(diffShift.add).toEqual([berlinPlanned]);

    const diffSame = reconcile([{ identifier: 'ber', data: { kind: 'habit', key: kBer } }], [berlinPlanned]);
    expect(diffSame).toEqual({ cancel: [], add: [] });
  });

  it('is idempotent across spring-forward DST transition days', () => {
    for (const [y, m, d, hh] of [[2026, 2, 8, 2], [2026, 2, 29, 3], [2026, 8, 27, 2]] as const) {
      const h = habit({ reminders: { enabled: true, time: `${String(hh).padStart(2, '0')}:30` } });
      const prevEvening = new Date(y, m, d - 1, 20, 0, 0);
      const p1 = planReminders({ habits: [h], logs: [], settings: DEFAULT_REMINDER_SETTINGS, now: prevEvening, horizonDays: 2 });
      const p2 = planReminders({ habits: [h], logs: [], settings: DEFAULT_REMINDER_SETTINGS, now: prevEvening, horizonDays: 2 });
      expect(p1.reminders.map((r) => r.key)).toEqual(p2.reminders.map((r) => r.key));
      const scheduled = p1.reminders.map((r, idx) => ({ identifier: `id-${idx}`, data: { kind: 'habit', key: r.key } }));
      expect(reconcile(scheduled, p2.reminders)).toEqual({ cancel: [], add: [] });
    }
  });

  it('classifies by data, never touching recovery, snooze, reentry or focus-end', () => {
    expect(classifyScheduled({ recoveryId: 'x' }).kind).toBe('other');
    expect(classifyScheduled({ kind: 'snooze', habitId: 'h' }).kind).toBe('other');
    expect(classifyScheduled({ kind: REENTRY_KIND }).kind).toBe('other');
    expect(classifyScheduled({ kind: 'focus-end' }).kind).toBe('other');
    expect(classifyScheduled({ habitId: 'h' }).kind).toBe('legacy-habit');
    expect(classifyScheduled({ kind: 'habit', key: 'h:h1:2026-10-05:08:00' }).kind).toBe('legacy-habit');
    expect(classifyScheduled({ kind: 'habit', key: 'h:h1:2026-10-05:08:00@1791176400000' }).kind).toBe('habit');
  });

  it('with nothing wanted (e.g. permission off), only our triggers go', () => {
    const d = reconcile(
      [
        { identifier: 'a', data: { kind: 'habit', key: 'h:h1:2026-10-05:08:00@1000' } },
        { identifier: 'legacy', data: { kind: 'habit', key: 'k' } },
        { identifier: 'r', data: { recoveryId: 'r' } },
      ],
      [],
    );
    expect(d).toEqual({ cancel: ['a', 'legacy'], add: [] });
  });
});

describe('DOM-14 — shouldRecordHandled', () => {
  it('records only terminal user/OS completions and never failed, ignored or duplicate', () => {
    const yes: HandledOutcome[] = ['logged', 'skipped', 'snoozed', 'opened'];
    const no: HandledOutcome[] = ['failed', 'ignored', 'duplicate'];
    for (const o of yes) expect(shouldRecordHandled(o)).toBe(true);
    for (const o of no) expect(shouldRecordHandled(o)).toBe(false);
  });
});
