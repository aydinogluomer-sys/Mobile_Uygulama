/**
 * F36 — `services/reminderService.ts` uzlaştırma, izin, hesap sınırı, görev-bilinmiyor
 * koruması, yakın geçmiş birincil lookback'i (M5) ve takip düğmesi yanıtları.
 */
const mockOS = {
  scheduled: [] as { identifier: string; data: Record<string, unknown> | null }[],
  permission: true,
  cancelled: [] as string[],
  snoozes: [] as { habitId: string; day: string }[],
  tasksAdded: [] as string[],
  eveningAdded: [] as string[],
  followUpsAdded: [] as string[],
  nextId: 1,
};

const mockListScheduled = jest.fn(async () => mockOS.scheduled.map((s) => ({ ...s })));
const mockCancelScheduled = jest.fn(async (ids: readonly string[]) => {
  mockOS.cancelled.push(...ids);
  mockOS.scheduled = mockOS.scheduled.filter((s) => !ids.includes(s.identifier));
});
const mockScheduleTaskReminder = jest.fn(async (p: { key: string; taskId: string; day: string }) => {
  mockOS.tasksAdded.push(p.key);
  mockOS.scheduled.push({
    identifier: `ts-task-${mockOS.nextId++}`,
    data: { kind: 'task-reminder', key: p.key, taskId: p.taskId, day: p.day },
  });
  return true;
});
const mockScheduleEveningClose = jest.fn(async (p: { key: string; day: string }) => {
  mockOS.eveningAdded.push(p.key);
  mockOS.scheduled.push({
    identifier: `ts-ev-${mockOS.nextId++}`,
    data: { kind: 'evening-close', key: p.key, day: p.day },
  });
  return true;
});
const mockScheduleFollowUp = jest.fn(
  async (p: { key: string; habitId: string; day: string; n: 1 | 2 }) => {
    mockOS.followUpsAdded.push(p.key);
    mockOS.scheduled.push({
      identifier: `ts-fu-${mockOS.nextId++}`,
      data: { kind: 'follow-up', key: p.key, habitId: p.habitId, day: p.day, n: p.n },
    });
    return true;
  },
);

jest.mock('../../lib/notifications', () => ({
  ensurePermission: jest.fn(async () => mockOS.permission),
  hasPermission: jest.fn(async () => mockOS.permission),
  ensureCategories: jest.fn(async () => undefined),
  listScheduled: () => mockListScheduled(),
  cancelScheduled: (ids: readonly string[]) => mockCancelScheduled(ids),
  scheduleReminder: jest.fn(
    async (p: { key: string; habitId: string; day: string }) => {
      mockOS.scheduled.push({
        identifier: `hab-${mockOS.nextId++}`,
        data: { kind: 'habit', key: p.key, habitId: p.habitId, day: p.day },
      });
      return true;
    },
  ),
  scheduleTaskReminder: (p: { key: string; taskId: string; day: string }) =>
    mockScheduleTaskReminder(p),
  scheduleEveningClose: (p: { key: string; day: string }) => mockScheduleEveningClose(p),
  scheduleFollowUp: (p: { key: string; habitId: string; day: string; n: 1 | 2 }) =>
    mockScheduleFollowUp(p),
  scheduleSnooze: jest.fn(async (habitId: string, day: string) => {
    mockOS.snoozes.push({ habitId, day });
  }),
  scheduleReentryNudge: jest.fn(async () => true),
  cancelReentryNudge: jest.fn(async () => undefined),
  reminderTitle: (n: string) => n,
}));

jest.mock('../../repositories/habitLogRepository', () => ({
  fetchHabitLogsForReview: jest.fn(async () => ({ ok: true, data: [] })),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetAccountMemory } from '../../lib/accountScope';
import { saveDayClose } from '../../lib/dayClose';
import type { BlockTask } from '../../lib/nextBlock';
import type { Habit } from '../../lib/supabase';
import { DEFAULT_TIME_SUPPORT_SETTINGS } from '../../lib/taskReminderPlan';
import {
  bindTimeSupportUser,
  followUpStoppedKey,
  handleReminderResponse,
  reconcileReminders,
  saveTimeSupportSettings,
  type TimeSupportContext,
} from '../../services/reminderService';

const makeHabit = (over: Partial<Habit> = {}): Habit =>
  ({
    id: 'h1',
    user_id: 'u1',
    name: 'Yürüyüş',
    tracking_type: 'boolean',
    status: 'active',
    behavior_type: 'positive',
    frequency_config: { kind: 'daily' },
    reminders: { enabled: true, time: '09:00' },
    created_at: '2026-09-01T08:00:00',
    daily_goal: null,
    target_direction: null,
    end_condition: null,
    ...over,
  }) as Habit;

const makeTask = (over: Partial<BlockTask> = {}): BlockTask => ({
  id: 't1',
  title: 'Doktor randevusu',
  due_date: '2026-10-05',
  time_block_start: '15:00',
  time_block_end: '15:30',
  completed: false,
  status: 'pending',
  priority: 'high',
  ...over,
});

const makeCtx = (over: Partial<TimeSupportContext> = {}): TimeSupportContext => ({
  tasks: () => [makeTask()],
  userId: () => 'u1',
  focus: () => ({ active: false, endsAt: null }),
  ...over,
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockOS.scheduled = [];
  mockOS.permission = true;
  mockOS.cancelled = [];
  mockOS.snoozes = [];
  mockOS.tasksAdded = [];
  mockOS.eveningAdded = [];
  mockOS.followUpsAdded = [];
  mockOS.nextId = 1;
  resetAccountMemory('signed_out');
  await AsyncStorage.clear();
});

describe('F36 reminderService — positive reconcile & lookback (M5)', () => {
  it('(+) schedules task reminder once, cancels today evening close after saveDayClose, and preserves post-fire follow-up via lookback (M5)', async () => {
    bindTimeSupportUser('u1');
    await saveTimeSupportSettings({
      taskLeadMin: 10,
      eveningClose: true,
      eveningTime: '21:00',
      followUp: true,
    });

    const r1 = await reconcileReminders(
      () => [makeHabit()],
      () => new Date(2026, 9, 5, 8, 0, 0, 0),
      makeCtx(),
    );
    expect(mockListScheduled).toHaveBeenCalledTimes(1);
    expect(r1.timeSupport).toMatchObject({
      tasks: 1,
      evening: 3,
      followUps: 2, // 24h window at 08:00 includes today's 09:00 primary (2 follow-ups)
      added: 6,
      cancelled: 0,
    });
    expect(mockScheduleTaskReminder).toHaveBeenCalledTimes(1);
    expect(mockScheduleEveningClose).toHaveBeenCalledTimes(3);

    // M5 guard: at 09:15 (15m AFTER 09:00 primary fired), 09:10 passed, 09:40 MUST stay scheduled (not cancelled!)
    mockOS.cancelled = [];
    const rAt0915 = await reconcileReminders(
      () => [makeHabit()],
      () => new Date(2026, 9, 5, 9, 15, 0, 0),
      makeCtx(),
    );
    const remainingTodayFollowUps = mockOS.scheduled.filter(
      (s) => s.data?.kind === 'follow-up' && s.data?.day === '2026-10-05',
    );
    expect(remainingTodayFollowUps).toHaveLength(1);
    expect(remainingTodayFollowUps[0].data?.n).toBe(2);
    expect(rAt0915.timeSupport?.followUps).toBe(3); // 1 remaining today + 2 tomorrow

    // Closing the day cancels ONLY today's evening-close notification, keeping tomorrow & day+2
    await saveDayClose('u1', {
      v: 1,
      date: '2026-10-05',
      movedCount: 0,
      easedCount: 0,
      closedAt: new Date(2026, 9, 5, 20, 0, 0, 0).toISOString(),
    });
    const rClosed = await reconcileReminders(
      () => [makeHabit()],
      () => new Date(2026, 9, 5, 20, 0, 0, 0),
      makeCtx(),
    );
    expect(rClosed.timeSupport?.evening).toBe(2);
    const eveningDays = mockOS.scheduled
      .filter((s) => s.data?.kind === 'evening-close')
      .map((s) => s.data?.day);
    expect(eveningDays).toEqual(['2026-10-06', '2026-10-07']);
  });
});

describe('F36 reminderService — negative guards & isolation', () => {
  it('(-) skips F36 completely when ctx is omitted, preserves task reminders when tasks() is null, handles no-user, no-permission, and mid-flight account change', async () => {
    // 1. ctx omitted -> timeSupport undefined, F36 schedules untouched by habit reconcile
    mockOS.scheduled = [
      { identifier: 'f36-task', data: { kind: 'task-reminder', key: 't:1', taskId: 't1', day: '2026-10-05' } },
    ];
    const noCtx = await reconcileReminders(
      () => [makeHabit()],
      () => new Date(2026, 9, 5, 8, 0, 0, 0),
    );
    expect(noCtx.timeSupport).toBeUndefined();
    expect(mockOS.scheduled.some((s) => s.identifier === 'f36-task')).toBe(true);

    // 2. tasks() === null -> preserves 'f36-task', reports skipped: 'tasks-unknown'
    bindTimeSupportUser('u1');
    await saveTimeSupportSettings({ ...DEFAULT_TIME_SUPPORT_SETTINGS, taskLeadMin: 10 });
    const unknownTasks = await reconcileReminders(
      () => [makeHabit()],
      () => new Date(2026, 9, 5, 8, 0, 0, 0),
      makeCtx({ tasks: () => null }),
    );
    expect(unknownTasks.timeSupport?.skipped).toBe('tasks-unknown');
    expect(mockOS.scheduled.some((s) => s.identifier === 'f36-task')).toBe(true);

    // 3. userId() === null -> skipped: 'no-user'
    const noUser = await reconcileReminders(
      () => [],
      () => new Date(2026, 9, 5, 8, 0, 0, 0),
      makeCtx({ userId: () => null }),
    );
    expect(noUser.timeSupport?.skipped).toBe('no-user');

    // 4. permission === false -> nothing added, stale F36 items ARE cancelled
    mockOS.permission = false;
    const noPerm = await reconcileReminders(
      () => [],
      () => new Date(2026, 9, 5, 8, 0, 0, 0),
      makeCtx({ tasks: () => [] }),
    );
    expect(noPerm.timeSupport?.skipped).toBe('permission');
    expect(noPerm.timeSupport?.cancelled).toBe(1);
    expect(mockOS.scheduled).toEqual([]);

    // 5. mid-flight accountEpoch change -> neither cancels nor adds for the old account
    mockOS.permission = true;
    mockOS.scheduled = [
      { identifier: 'stale-ev', data: { kind: 'evening-close', key: 'e:old' } },
    ];
    await saveTimeSupportSettings({ ...DEFAULT_TIME_SUPPORT_SETTINGS, eveningClose: true }, 'u1');
    mockCancelScheduled.mockClear();
    mockScheduleEveningClose.mockClear();

    const changed = await reconcileReminders(
      () => [],
      () => new Date(2026, 9, 5, 8, 0, 0, 0),
      makeCtx({
        isDayClosed: async () => {
          resetAccountMemory('user_changed');
          return false;
        },
      }),
    );
    expect(changed.timeSupport?.skipped).toBe('account-changed');
    expect(mockCancelScheduled).not.toHaveBeenCalled();
    expect(mockScheduleEveningClose).not.toHaveBeenCalled();
  });
});

describe('F36 reminderService — notification tap & snooze follow-up stop', () => {
  it('(+) ignores task-reminder & evening-close taps, logs follow-up done once, and stops follow-ups on snooze before scheduleSnooze', async () => {
    bindTimeSupportUser('u1');
    await saveTimeSupportSettings({ ...DEFAULT_TIME_SUPPORT_SETTINGS, followUp: true }, 'u1');
    await reconcileReminders(
      () => [makeHabit()],
      () => new Date(2026, 9, 5, 8, 0, 0, 0),
      makeCtx({ tasks: () => [] }),
    );
    expect(mockOS.scheduled.filter((s) => s.data?.kind === 'follow-up')).toHaveLength(2);

    const logHabit = jest.fn(async () => ({ ok: true }));
    const deps = {
      habits: [makeHabit()],
      logHabit,
      openMeasure: () => undefined,
      reconcile: () =>
        reconcileReminders(
          () => [makeHabit()],
          () => new Date(2026, 9, 5, 8, 0, 0, 0),
          makeCtx({ tasks: () => [] }),
        ),
    };

    // Task & evening taps are ignored (app opens, zero habit logs)
    expect(
      await handleReminderResponse(
        {
          actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
          notification: {
            request: {
              identifier: 'tap-t',
              content: { data: { kind: 'task-reminder', key: 't:1', taskId: 't1', day: '2026-10-05' } },
            },
          },
        },
        deps,
      ),
    ).toBe('ignored');
    expect(
      await handleReminderResponse(
        {
          actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
          notification: {
            request: {
              identifier: 'tap-e',
              content: { data: { kind: 'evening-close', key: 'e:1', day: '2026-10-05' } },
            },
          },
        },
        deps,
      ),
    ).toBe('ignored');
    expect(logHabit).not.toHaveBeenCalled();

    // Follow-up 'done' -> logs habit once
    expect(
      await handleReminderResponse(
        {
          actionIdentifier: 'done',
          notification: {
            request: {
              identifier: 'fu-done',
              content: { data: { kind: 'follow-up', key: 'f:1', habitId: 'h1', day: '2026-10-05', n: 1 } },
            },
          },
        },
        deps,
      ),
    ).toBe('logged');
    expect(logHabit).toHaveBeenCalledTimes(1);

    // Follow-up 'snooze' -> persists h1|2026-10-05, schedules snooze once, and cancels today's follow-ups!
    expect(
      await handleReminderResponse(
        {
          actionIdentifier: 'snooze',
          notification: {
            request: {
              identifier: 'fu-snooze',
              content: { data: { kind: 'follow-up', key: 'f:2', habitId: 'h1', day: '2026-10-05', n: 1 } },
            },
          },
        },
        deps,
      ),
    ).toBe('snoozed');

    const storedStopped = JSON.parse((await AsyncStorage.getItem(followUpStoppedKey('u1'))) ?? '[]');
    expect(storedStopped).toContain('h1|2026-10-05');
    expect(mockOS.snoozes).toEqual([{ habitId: 'h1', day: '2026-10-05' }]);
    const remainingTodayFu = mockOS.scheduled.filter(
      (s) => s.data?.kind === 'follow-up' && s.data?.day === '2026-10-05',
    );
    expect(remainingTodayFu).toEqual([]);
  });
});
