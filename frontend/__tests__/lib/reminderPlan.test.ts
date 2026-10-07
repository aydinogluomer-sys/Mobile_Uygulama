/**
 * R04.01 / R04.02 — reminders follow the schedule (KD-04).
 */
import {
  planReminders, reconcile, classifyScheduled, inQuietHours, reminderTimes, buildReminderConfig, reminderKey,
  DEFAULT_REMINDER_SETTINGS, type PlanLog,
} from '../../lib/reminderPlan';
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

describe('R04.02 — times, day groups, quiet hours', () => {
  it('several times a day, each planned', () => {
    const p = plan([habit({ reminders: { enabled: true, time: '08:00', times: ['08:00', '20:00'] } })], [], { horizonDays: 1 });
    expect(p.reminders.map((r) => r.time)).toEqual(['08:00', '20:00']);
  });

  it('a day group narrows the scheduled days', () => {
    const p = plan([habit({ reminders: { enabled: true, time: '08:00', days: [0, 2] } })]);
    expect(days(p)).toEqual(['2026-10-05', '2026-10-07']);
  });

  it('quiet hours, including a window across midnight', () => {
    const q = { quietStart: '22:00', quietEnd: '07:00' };
    expect(inQuietHours('23:30', q)).toBe(true);
    expect(inQuietHours('06:59', q)).toBe(true);
    expect(inQuietHours('07:00', q)).toBe(false);
    expect(inQuietHours('12:00', { quietStart: '12:00', quietEnd: '14:00' })).toBe(true);
    expect(inQuietHours('14:00', { quietStart: '12:00', quietEnd: '14:00' })).toBe(false);
    const p = planReminders({ habits: [habit({ reminders: { enabled: true, time: '06:30', times: ['06:30', '08:00'] } })], logs: [], settings: { ...DEFAULT_REMINDER_SETTINGS, ...q }, now: NOW, horizonDays: 1 });
    expect(p.reminders.map((r) => r.time)).toEqual(['08:00']);
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

describe('R04.04 — OS limit', () => {
  it('keeps the nearest within the cap and reports the rest', () => {
    const many = Array.from({ length: 10 }, (_, i) => habit({ id: `h${i}`, reminders: { enabled: true, time: '08:00' } }));
    const p = plan(many, [], { maxPending: 56 });
    expect(p.reminders).toHaveLength(56);
    expect(p.dropped).toBe(70 - 56);
    expect(p.reminders.every((r, i, a) => i === 0 || a[i - 1].at <= r.at)).toBe(true);
  });
});

describe('reconcile', () => {
  const wanted = plan([habit()], [], { horizonDays: 2 }).reminders;
  it('keeps what is wanted, adds what is missing, cancels the rest -- and every legacy DAILY trigger', () => {
    const scheduled = [
      { identifier: 'keep', data: { kind: 'habit', key: wanted[0].key, habitId: 'h1', day: wanted[0].day } },
      { identifier: 'dupe', data: { kind: 'habit', key: wanted[0].key } },
      { identifier: 'stale', data: { kind: 'habit', key: reminderKey('h1', '2026-10-01', '08:00') } },
      { identifier: 'legacy', data: { habitId: 'h1' } },
      { identifier: 'recovery', data: { recoveryId: 'r1' } },
      { identifier: 'snooze', data: { kind: 'snooze', habitId: 'h1', day: '2026-10-05' } },
      { identifier: 'foreign', data: null },
    ];
    const d = reconcile(scheduled, wanted);
    expect(d.cancel.sort()).toEqual(['dupe', 'legacy', 'stale']);
    expect(d.add.map((a) => a.key)).toEqual([wanted[1].key]);
  });

  it('classifies by data, never touching recovery or snoozes', () => {
    expect(classifyScheduled({ recoveryId: 'x' }).kind).toBe('other');
    expect(classifyScheduled({ kind: 'snooze', habitId: 'h' }).kind).toBe('other');
    expect(classifyScheduled({ habitId: 'h' }).kind).toBe('legacy-habit');
  });

  it('with nothing wanted (e.g. permission off), only our triggers go', () => {
    const d = reconcile([{ identifier: 'a', data: { kind: 'habit', key: 'k' } }, { identifier: 'r', data: { recoveryId: 'r' } }], []);
    expect(d).toEqual({ cancel: ['a'], add: [] });
  });
});
