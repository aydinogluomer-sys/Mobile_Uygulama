/**
 * R04 — the reconcile against the OS, and acting on reminder buttons once.
 */
const mockOS = {
  scheduled: [] as { identifier: string; data: Record<string, unknown> | null }[],
  permission: true,
  added: [] as any[],
  cancelled: [] as string[],
  snoozes: [] as any[],
  nextId: 1,
};

jest.mock('../../lib/notifications', () => ({
  ensurePermission: jest.fn(async () => mockOS.permission),
  hasPermission: jest.fn(async () => mockOS.permission),
  ensureCategories: jest.fn(async () => undefined),
  listScheduled: jest.fn(async () => mockOS.scheduled.map((s) => ({ ...s }))),
  cancelScheduled: jest.fn(async (ids: string[]) => {
    mockOS.cancelled.push(...ids);
    mockOS.scheduled = mockOS.scheduled.filter((s) => !ids.includes(s.identifier));
  }),
  scheduleReminder: jest.fn(async (p: any, _h: any, measurable: boolean) => {
    mockOS.added.push({ key: p.key, measurable });
    mockOS.scheduled.push({ identifier: `n${mockOS.nextId++}`, data: { kind: 'habit', key: p.key, habitId: p.habitId, day: p.day } });
    return true;
  }),
  scheduleSnooze: jest.fn(async (habitId: string, day: string) => { mockOS.snoozes.push({ habitId, day }); }),
  reminderTitle: (n: string) => n,
}));
jest.mock('../../services/reviewService', () => ({ logsForPeriod: jest.fn(async () => ({ ok: true, data: [] })) }));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { reconcileReminders, handleReminderResponse, HANDLED_KEY } from '../../services/reminderService';
import type { Habit } from '../../lib/supabase';

const NOW = () => new Date(2026, 9, 5, 6, 0, 0);
const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', name: 'Yürüyüş', tracking_type: 'boolean', status: 'active', behavior_type: 'positive',
  frequency_config: { kind: 'daily' }, reminders: { enabled: true, time: '08:00' }, created_at: '2026-09-01T08:00:00',
  daily_goal: null, target_direction: null, end_condition: null,
  ...over,
} as Habit);

beforeEach(async () => {
  mockOS.scheduled = [];
  mockOS.permission = true;
  mockOS.added = [];
  mockOS.cancelled = [];
  mockOS.snoozes = [];
  await AsyncStorage.clear();
});

describe('reconcileReminders', () => {
  it('replaces a legacy DAILY trigger with the planned one-offs; a second run changes nothing', async () => {
    mockOS.scheduled = [{ identifier: 'legacy', data: { habitId: 'h1' } }, { identifier: 'rec', data: { recoveryId: 'r' } }];
    const r1 = await reconcileReminders(() => [habit()], NOW);
    expect(r1).toMatchObject({ permission: true, planned: 7, added: 7, cancelled: 1 });
    expect(mockOS.scheduled.map((s) => s.identifier)).toContain('rec');
    const r2 = await reconcileReminders(() => [habit()], NOW);
    expect(r2).toMatchObject({ added: 0, cancelled: 0 });
  });

  it('without permission nothing is added -- and the report says so', async () => {
    mockOS.permission = false;
    mockOS.scheduled = [{ identifier: 'legacy', data: { habitId: 'h1' } }];
    const r = await reconcileReminders(() => [habit()], NOW);
    expect(r).toMatchObject({ permission: false, added: 0, cancelled: 1 });
  });

  it('permission withdrawn: our pending reminders are cleared, not left pretending', async () => {
    await reconcileReminders(() => [habit()], NOW);
    expect(mockOS.scheduled).toHaveLength(7);
    mockOS.permission = false;
    const r = await reconcileReminders(() => [habit()], NOW);
    expect(r).toMatchObject({ permission: false, cancelled: 7, added: 0 });
    expect(mockOS.scheduled).toHaveLength(0);
  });

  it('a habit turned off is cancelled on the next run', async () => {
    await reconcileReminders(() => [habit()], NOW);
    const r = await reconcileReminders(() => [habit({ reminders: { enabled: false, time: '08:00' } })], NOW);
    expect(r.cancelled).toBe(7);
    expect(mockOS.scheduled).toHaveLength(0);
  });

  it('a request during a run causes one more run with the CURRENT habits', async () => {
    let list = [habit()];
    const first = reconcileReminders(() => list, NOW);
    list = [habit({ reminders: { enabled: false, time: '08:00' } })];
    const second = reconcileReminders(() => list, NOW);
    await Promise.all([first, second]);
    expect(mockOS.scheduled).toHaveLength(0);
  });

  it('measurable habits get the measure buttons', async () => {
    await reconcileReminders(() => [habit({ tracking_type: 'numeric', daily_goal: 8, unit: 'bardak' } as Partial<Habit>)], NOW);
    expect(mockOS.added.every((a) => a.measurable)).toBe(true);
  });
});

describe('handleReminderResponse', () => {
  const response = (action: string, id = 'n1', day = '2026-10-05') => ({
    actionIdentifier: action,
    notification: { request: { identifier: id, content: { data: { kind: 'habit', habitId: 'h1', day } } } },
  });
  function deps(habits: Habit[] = [habit()]) {
    const logs: any[] = [];
    const opened: string[] = [];
    return {
      logs, opened,
      d: {
        habits,
        logHabit: jest.fn(async (p: any) => { logs.push(p); return { ok: true }; }),
        openMeasure: (id: string) => { opened.push(id); },
        reconcile: jest.fn(async () => undefined),
      },
    };
  }

  it('"Tamamla" logs the reminder\'s day once, even if delivered twice', async () => {
    const { logs, d } = deps();
    expect(await handleReminderResponse(response('done'), d)).toBe('logged');
    expect(await handleReminderResponse(response('done'), d)).toBe('duplicate');
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ habitId: 'h1', state: 'done' });
    expect(logs[0].date).toEqual(new Date(2026, 9, 5));
    expect(JSON.parse((await AsyncStorage.getItem(HANDLED_KEY))!)).toHaveLength(1);
  });

  it('a measurable habit is opened for an amount, never logged done', async () => {
    const { logs, opened, d } = deps([habit({ tracking_type: 'numeric' } as Partial<Habit>)]);
    expect(await handleReminderResponse(response('done'), d)).toBe('opened');
    expect(logs).toHaveLength(0);
    expect(opened).toEqual(['h1']);
  });

  it('"Bugünü atla" writes skip; "Ertele" schedules one snooze; then it re-plans', async () => {
    const { logs, d } = deps();
    expect(await handleReminderResponse(response('skip', 'a'), d)).toBe('skipped');
    expect(logs[0].state).toBe('skip');
    expect(await handleReminderResponse(response('snooze', 'b'), d)).toBe('snoozed');
    expect(mockOS.snoozes).toEqual([{ habitId: 'h1', day: '2026-10-05' }]);
    expect(d.reconcile).toHaveBeenCalledTimes(2);
  });

  it('a response for something we do not know is ignored', async () => {
    const { d } = deps();
    expect(await handleReminderResponse({ actionIdentifier: 'done', notification: { request: { identifier: 'x', content: { data: { recoveryId: 'r' } } } } }, d)).toBe('ignored');
  });
});
