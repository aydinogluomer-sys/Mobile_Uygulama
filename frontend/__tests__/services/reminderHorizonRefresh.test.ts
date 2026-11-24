/**
 * F17 — Horizon refresh, one re-entry nudge, dynamic iOS pending budget,
 * network/OS early-exit savings, and the 2s trailing reconcile trigger
 * (DOM-05, PRF-08, DOM-15 service side).
 */
const mockOS = {
  scheduled: [] as { identifier: string; data: Record<string, unknown> | null }[],
  permission: true,
  added: [] as { key: string; measurable: boolean }[],
  cancelled: [] as string[],
  reentryAt: null as Date | null,
  nextId: 1,
};

const mockEnsurePermission = jest.fn(async () => mockOS.permission);
const mockHasPermission = jest.fn(async () => mockOS.permission);
const mockListScheduled = jest.fn(async () => mockOS.scheduled.map((s) => ({ ...s })));
const mockCancelScheduled = jest.fn(async (ids: readonly string[]) => {
  mockOS.cancelled.push(...ids);
  mockOS.scheduled = mockOS.scheduled.filter((s) => !ids.includes(s.identifier));
});
const mockScheduleReminder = jest.fn(async (p: { key: string; habitId: string; day: string }, _h: unknown, measurable: boolean) => {
  mockOS.added.push({ key: p.key, measurable });
  mockOS.scheduled.push({ identifier: `n${mockOS.nextId++}`, data: { kind: 'habit', key: p.key, habitId: p.habitId, day: p.day } });
  return true;
});
const mockScheduleReentryNudge = jest.fn(async (at: Date) => {
  mockOS.reentryAt = at;
  mockOS.scheduled = mockOS.scheduled.filter((s) => s.identifier !== 'reminder-reentry');
  mockOS.scheduled.push({ identifier: 'reminder-reentry', data: { kind: 'reentry' } });
  return true;
});
const mockCancelReentryNudge = jest.fn(async () => {
  mockOS.reentryAt = null;
  mockOS.scheduled = mockOS.scheduled.filter((s) => s.identifier !== 'reminder-reentry');
});

jest.mock('../../lib/notifications', () => ({
  ensurePermission: (...args: unknown[]) => mockEnsurePermission(...(args as [])),
  hasPermission: (...args: unknown[]) => mockHasPermission(...(args as [])),
  ensureCategories: jest.fn(async () => undefined),
  listScheduled: (...args: unknown[]) => mockListScheduled(...(args as [])),
  cancelScheduled: (ids: readonly string[]) => mockCancelScheduled(ids),
  scheduleReminder: (p: { key: string; habitId: string; day: string }, h: unknown, m: boolean) => mockScheduleReminder(p, h, m),
  scheduleSnooze: jest.fn(async () => undefined),
  scheduleReentryNudge: (at: Date) => mockScheduleReentryNudge(at),
  cancelReentryNudge: () => mockCancelReentryNudge(),
  reminderTitle: (n: string) => n,
}));

const mockFetchHabitLogsForReview = jest.fn(async () => ({ ok: true, data: [] }));
jest.mock('../../repositories/habitLogRepository', () => ({
  fetchHabitLogsForReview: (...args: unknown[]) => mockFetchHabitLogsForReview(...(args as [])),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  reconcileReminders,
  loadReminderSettings,
  saveReminderSettings,
  getLastReconcileReport,
  createReconcileTrigger,
  REPLAN_DEBOUNCE_MS,
  SETTINGS_KEY,
} from '../../services/reminderService';
import {
  DEFAULT_REMINDER_SETTINGS,
  habitSlotBudget,
  hasReminderHabits,
} from '../../lib/reminderPlan';
import type { Habit } from '../../lib/supabase';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Yürüyüş',
  tracking_type: 'boolean',
  status: 'active',
  behavior_type: 'positive',
  frequency_config: { kind: 'daily' },
  reminders: { enabled: true, time: '08:00' },
  created_at: '2026-09-01T08:00:00',
  daily_goal: null,
  target_direction: null,
  end_condition: null,
  ...over,
} as Habit);

beforeEach(async () => {
  jest.clearAllMocks();
  mockOS.scheduled = [];
  mockOS.permission = true;
  mockOS.added = [];
  mockOS.cancelled = [];
  mockOS.reentryAt = null;
  mockOS.nextId = 1;
  await AsyncStorage.clear();
});

describe('DOM-05 — horizon refresh, single re-entry nudge and dynamic iOS budget', () => {
  it('schedules the re-entry nudge once at 10:00 on the last day of the 7-day horizon', async () => {
    const monMorning = new Date(2026, 9, 5, 6, 0, 0);
    const report = await reconcileReminders(() => [habit()], () => monMorning);
    expect(report.reentry).toBe(true);
    expect(mockScheduleReentryNudge).toHaveBeenCalledTimes(1);
    expect(mockOS.reentryAt).toEqual(new Date(2026, 9, 11, 10, 0, 0, 0));
  });

  it('carries the single re-entry nudge forward by 3 days when reconciled 3 days later', async () => {
    await reconcileReminders(() => [habit()], () => new Date(2026, 9, 5, 6, 0, 0));
    await reconcileReminders(() => [habit()], () => new Date(2026, 9, 8, 6, 0, 0));
    expect(mockScheduleReentryNudge).toHaveBeenCalledTimes(2);
    expect(mockOS.reentryAt).toEqual(new Date(2026, 9, 14, 10, 0, 0, 0));
    expect(mockOS.scheduled.filter((s) => s.identifier === 'reminder-reentry')).toHaveLength(1);
  });

  it('refreshes the horizon on day 6 by adding only the 6 new days and cancelling nothing overlapping', async () => {
    await reconcileReminders(() => [habit()], () => new Date(2026, 9, 5, 6, 0, 0));
    expect(mockOS.added).toHaveLength(7);

    // Delivered reminders (days before 2026-10-11) leave the OS queue naturally.
    mockOS.scheduled = mockOS.scheduled.filter((s) => {
      const d = s.data?.day;
      return typeof d !== 'string' || d >= '2026-10-11';
    });
    mockOS.added = [];
    mockOS.cancelled = [];

    const r2 = await reconcileReminders(() => [habit()], () => new Date(2026, 9, 11, 6, 0, 0));
    expect(r2.added).toBe(6);
    expect(r2.cancelled).toBe(0);
  });

  it('places the re-entry nudge at 10:00 for 22:00-07:00 quiet hours and defers to 12:00 for 08:00-12:00', async () => {
    const mon = () => new Date(2026, 9, 5, 6, 0, 0);
    await saveReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, quietStart: '22:00', quietEnd: '07:00' });
    await reconcileReminders(() => [habit()], mon);
    expect(mockOS.reentryAt).toEqual(new Date(2026, 9, 11, 10, 0, 0, 0));

    await saveReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, quietStart: '08:00', quietEnd: '12:00' });
    await reconcileReminders(() => [habit()], mon);
    expect(mockOS.reentryAt).toEqual(new Date(2026, 9, 11, 12, 0, 0, 0));
  });

  it('shrinks the habit slot budget dynamically when other OS notifications (recovery/snooze) are pending', async () => {
    expect(habitSlotBudget(0)).toBe(56);
    expect(habitSlotBudget(10)).toBe(47);
    expect(habitSlotBudget(49)).toBe(8);
    expect(habitSlotBudget(100)).toBe(8);
    expect(habitSlotBudget(NaN)).toBe(56);

    await saveReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, maxPerDay: null });
    mockOS.scheduled = [
      ...Array.from({ length: 10 }, (_, i) => ({ identifier: `other-${i}`, data: { recoveryId: `r${i}` } })),
      { identifier: 'reminder-reentry', data: { kind: 'reentry' } },
    ];
    const tenHabits = Array.from({ length: 10 }, (_, i) => habit({ id: `h${i}` }));
    const r = await reconcileReminders(() => tenHabits, () => new Date(2026, 9, 5, 6, 0, 0));
    expect(r.planned).toBe(47);
    expect(r.dropped).toBe(70 - 47);
  });

  it('does not schedule re-entry when no habit wants reminders; cancels stale re-entry only if present', async () => {
    const mon = () => new Date(2026, 9, 5, 6, 0, 0);
    await reconcileReminders(() => [habit({ reminders: { enabled: false, time: '08:00' } })], mon);
    expect(mockScheduleReentryNudge).not.toHaveBeenCalled();
    expect(mockCancelReentryNudge).not.toHaveBeenCalled();

    mockOS.scheduled = [{ identifier: 'reminder-reentry', data: { kind: 'reentry' } }];
    await reconcileReminders(() => [habit({ reminders: { enabled: false, time: '08:00' } })], mon);
    expect(mockScheduleReentryNudge).not.toHaveBeenCalled();
    expect(mockCancelReentryNudge).toHaveBeenCalledTimes(1);
  });

  it('when permission is denied, never schedules re-entry and clears stale habit triggers', async () => {
    mockOS.permission = false;
    mockOS.scheduled = [{ identifier: 'stale-1', data: { habitId: 'h1' } }];
    const r = await reconcileReminders(() => [habit()], () => new Date(2026, 9, 5, 6, 0, 0));
    expect(r.permission).toBe(false);
    expect(r.reentry).toBe(false);
    expect(r.cancelled).toBe(1);
    expect(mockScheduleReentryNudge).not.toHaveBeenCalled();
  });
});

describe('PRF-08 — zero-network early exit, cleanup when last reminder turns off, and 2s trailing trigger', () => {
  it('skips fetchHabitLogsForReview and cancelScheduled completely when nothing wants reminders and OS has none of ours', async () => {
    const mon = () => new Date(2026, 9, 5, 6, 0, 0);
    const r0 = await reconcileReminders(() => [habit({ reminders: { enabled: false, time: '08:00' } })], mon);
    expect(mockListScheduled).toHaveBeenCalledTimes(1);
    expect(mockFetchHabitLogsForReview).not.toHaveBeenCalled();
    expect(mockCancelScheduled).not.toHaveBeenCalled();
    expect(r0).toMatchObject({ planned: 0, added: 0, cancelled: 0, reentry: false });

    await reconcileReminders(() => [habit()], mon);
    expect(mockFetchHabitLogsForReview).toHaveBeenCalledTimes(1);
  });

  it('still cancels our OS notifications when the last reminder habit is turned off', async () => {
    const mon = () => new Date(2026, 9, 5, 6, 0, 0);
    await reconcileReminders(() => [habit()], mon);
    expect(mockOS.scheduled.length).toBeGreaterThan(0);

    const rOff = await reconcileReminders(() => [habit({ reminders: { enabled: false, time: '08:00' } })], mon);
    expect(mockFetchHabitLogsForReview).toHaveBeenCalledTimes(1);
    expect(rOff.cancelled).toBe(7);
    expect(mockCancelReentryNudge).toHaveBeenCalledTimes(1);
    expect(mockOS.scheduled).toEqual([]);
  });

  it('coalesces rapid schedule() calls over 2000ms, flushes immediately on flushNow(), honours cancel(), and swallows rejections', async () => {
    jest.useFakeTimers();
    try {
      expect(REPLAN_DEBOUNCE_MS).toBe(2000);
      let runs = 0;
      const trigger = createReconcileTrigger({ run: async () => { runs += 1; } });

      for (let i = 0; i < 5; i++) {
        trigger.schedule();
        jest.advanceTimersByTime(380);
      }
      expect(runs).toBe(0);
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
      expect(runs).toBe(1);

      // flushNow cancels pending timer and executes once immediately
      trigger.schedule();
      await trigger.flushNow();
      expect(runs).toBe(2);
      jest.advanceTimersByTime(3000);
      expect(runs).toBe(2);

      // cancel prevents execution
      trigger.schedule();
      trigger.cancel();
      jest.advanceTimersByTime(3000);
      expect(runs).toBe(2);

      // rejecting run never throws out of flushNow
      const failing = createReconcileTrigger({ run: async () => { throw new Error('boom'); } });
      await expect(failing.flushNow()).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('hasReminderHabits returns false for empty, disabled or non-active habits', () => {
    expect(hasReminderHabits([])).toBe(false);
    expect(hasReminderHabits([habit({ reminders: { enabled: false, time: '08:00' } })])).toBe(false);
    expect(hasReminderHabits([habit({ status: 'waiting' })])).toBe(false);
    expect(hasReminderHabits([habit({ status: 'paused' })])).toBe(false);
  });
});

describe('settings persistence & getLastReconcileReport', () => {
  it('validates maxPerDay on load and save', async () => {
    expect((await loadReminderSettings()).maxPerDay).toBe(3);

    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ quietStart: null, quietEnd: null, hideTitles: false, maxPerDay: null }));
    expect((await loadReminderSettings()).maxPerDay).toBeNull();

    for (const bad of [0, 13, 2.5, 'x']) {
      await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxPerDay: bad }));
      expect((await loadReminderSettings()).maxPerDay).toBe(3);
    }

    await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ maxPerDay: 5 }));
    expect((await loadReminderSettings()).maxPerDay).toBe(5);

    await saveReminderSettings({ quietStart: null, quietEnd: null, hideTitles: false, maxPerDay: 99 as number });
    const raw = JSON.parse((await AsyncStorage.getItem(SETTINGS_KEY))!);
    expect(raw.maxPerDay).toBe(3);
  });

  it('keeps the last non-skipped report across a skipped cold-start pass', async () => {
    const mon = () => new Date(2026, 9, 5, 6, 0, 0);
    const full = await reconcileReminders(() => [habit()], mon);
    expect(getLastReconcileReport()).toEqual(full);

    const skipped = await reconcileReminders(() => null, mon);
    expect(skipped.skipped).toBe('habits-unknown');
    expect(getLastReconcileReport()).toEqual(full);
  });
});
