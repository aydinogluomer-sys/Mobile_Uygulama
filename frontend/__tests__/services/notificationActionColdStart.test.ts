/**
 * F17 — Cold-start safety for notification button responses and reconciliation
 * (DOM-14, DOM-V01).
 */
const mockOS = {
  scheduled: [] as { identifier: string; data: Record<string, unknown> | null }[],
  permission: true,
  snoozes: [] as { habitId: string; day: string }[],
};

const mockListScheduled = jest.fn(async () => mockOS.scheduled.map((s) => ({ ...s })));
const mockCancelScheduled = jest.fn(async (ids: readonly string[]) => {
  mockOS.scheduled = mockOS.scheduled.filter((s) => !ids.includes(s.identifier));
});
const mockScheduleReentryNudge = jest.fn(async () => true);
const mockCancelReentryNudge = jest.fn(async () => undefined);

jest.mock('../../lib/notifications', () => ({
  ensurePermission: jest.fn(async () => mockOS.permission),
  hasPermission: jest.fn(async () => mockOS.permission),
  ensureCategories: jest.fn(async () => undefined),
  listScheduled: (...args: unknown[]) => mockListScheduled(...(args as [])),
  cancelScheduled: (ids: readonly string[]) => mockCancelScheduled(ids),
  scheduleReminder: jest.fn(async () => true),
  scheduleSnooze: jest.fn(async (habitId: string, day: string) => { mockOS.snoozes.push({ habitId, day }); }),
  scheduleReentryNudge: (...args: unknown[]) => mockScheduleReentryNudge(...(args as [])),
  cancelReentryNudge: (...args: unknown[]) => mockCancelReentryNudge(...(args as [])),
  scheduleHabitReminder: jest.fn(async () => undefined),
  cancelHabitReminder: jest.fn(async () => undefined),
  reminderTitle: (n: string) => n,
}));

jest.mock('../../repositories/habitLogRepository', () => ({
  fetchHabitLogsForReview: jest.fn(async () => ({ ok: true, data: [] })),
}));

const mockListHabits = jest.fn();
const mockLoadTimeOff = jest.fn();
const mockLoadChecklists = jest.fn();
const mockPatchHabit = jest.fn();

jest.mock('../../services/habitService', () => ({
  listHabits: (...args: unknown[]) => mockListHabits(...args),
  loadTimeOff: (...args: unknown[]) => mockLoadTimeOff(...args),
  loadChecklists: (...args: unknown[]) => mockLoadChecklists(...args),
  createHabit: jest.fn(),
  activateHabit: jest.fn(),
  pauseHabit: jest.fn(),
  patchHabit: (...args: unknown[]) => mockPatchHabit(...args),
  archiveHabit: jest.fn(),
  restoreHabit: jest.fn(),
  purgeHabit: jest.fn(),
  addTimeOff: jest.fn(),
  endTimeOff: jest.fn(),
  recordGoalVersion: jest.fn(),
  addChecklistItem: jest.fn(),
  editChecklistItem: jest.fn(),
  setCheck: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { resetAccountMemory } from '../../lib/accountScope';
import { shouldRecordHandled } from '../../lib/notificationActions';
import { reconcileReminders, handleReminderResponse, HANDLED_KEY } from '../../services/reminderService';
import { useHabitStore, whenHabitsLoaded, HABITS_WAIT_MS, invalidateHabitsFetch } from '../../store/habitStore';
import type { Habit } from '../../lib/supabase';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  user_id: 'u1',
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

const response = (action: string, id = 'resp-1', day = '2026-10-05') => ({
  actionIdentifier: action,
  notification: { request: { identifier: id, content: { data: { kind: 'habit', habitId: 'h1', day } } } },
});

beforeEach(async () => {
  jest.clearAllMocks();
  mockOS.scheduled = [];
  mockOS.permission = true;
  mockOS.snoozes = [];
  resetAccountMemory('signed_out');
  invalidateHabitsFetch();
  mockLoadTimeOff.mockResolvedValue({ ok: true, data: { available: false, pauses: [], versions: [] } });
  mockLoadChecklists.mockResolvedValue({ ok: true, data: { available: false, items: [], checks: [] } });
  await AsyncStorage.clear();
});

describe('DOM-14 & DOM-V01 — cold-start notification responses', () => {
  it('waits for whenHabitsReady on cold start and records HANDLED_KEY only AFTER logHabit succeeds', async () => {
    let handledDuringLog: string | null = 'unset';
    const logHabit = jest.fn(async () => {
      handledDuringLog = await AsyncStorage.getItem(HANDLED_KEY);
      return { ok: true };
    });
    const out = await handleReminderResponse(response('done'), {
      habits: [],
      whenHabitsReady: async () => [habit()],
      logHabit,
      openMeasure: () => undefined,
      reconcile: async () => undefined,
    });
    expect(out).toBe('logged');
    expect(logHabit).toHaveBeenCalledTimes(1);
    expect(handledDuringLog).toBeNull();
    expect(JSON.parse((await AsyncStorage.getItem(HANDLED_KEY))!)).toEqual(['resp-1|done']);
  });

  it('does NOT consume the tap when habits time out empty on cold start, so a later retry logs it', async () => {
    const logHabit = jest.fn(async () => ({ ok: true }));
    const first = await handleReminderResponse(response('done', 'cold-1'), {
      habits: [],
      whenHabitsReady: async () => [],
      logHabit,
      openMeasure: () => undefined,
      reconcile: async () => undefined,
    });
    expect(first).toBe('ignored');
    expect(await AsyncStorage.getItem(HANDLED_KEY)).toBeNull();
    expect(logHabit).not.toHaveBeenCalled();

    const second = await handleReminderResponse(response('done', 'cold-1'), {
      habits: [habit()],
      whenHabitsReady: async () => [habit()],
      logHabit,
      openMeasure: () => undefined,
      reconcile: async () => undefined,
    });
    expect(second).toBe('logged');
    expect(logHabit).toHaveBeenCalledTimes(1);
  });

  it('does NOT record HANDLED_KEY when logHabit fails, allowing a second attempt to succeed', async () => {
    const logHabit = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, error: 'offline' })
      .mockResolvedValueOnce({ ok: true });
    const deps = {
      habits: [habit()],
      logHabit,
      openMeasure: () => undefined,
      reconcile: async () => undefined,
    };
    expect(await handleReminderResponse(response('done', 'fail-1'), deps)).toBe('failed');
    expect(await AsyncStorage.getItem(HANDLED_KEY)).toBeNull();

    expect(await handleReminderResponse(response('done', 'fail-1'), deps)).toBe('logged');
    expect(JSON.parse((await AsyncStorage.getItem(HANDLED_KEY))!)).toEqual(['fail-1|done']);
  });

  it('records HANDLED_KEY for logged, skipped, snoozed and measurable opened, and deduplicates sequential repeats', async () => {
    const logHabit = jest.fn(async () => ({ ok: true }));
    const opened: string[] = [];
    const baseDeps = {
      habits: [habit()],
      logHabit,
      openMeasure: (id: string) => { opened.push(id); },
      reconcile: async () => undefined,
    };
    expect(await handleReminderResponse(response('done', 's1'), baseDeps)).toBe('logged');
    expect(await handleReminderResponse(response('done', 's1'), baseDeps)).toBe('duplicate');
    expect(logHabit).toHaveBeenCalledTimes(1);

    expect(await handleReminderResponse(response('skip', 's2'), baseDeps)).toBe('skipped');
    expect(await handleReminderResponse(response('snooze', 's3'), baseDeps)).toBe('snoozed');
    expect(
      await handleReminderResponse(response('done', 's4'), {
        ...baseDeps,
        habits: [habit({ tracking_type: 'numeric' } as Partial<Habit>)],
      }),
    ).toBe('opened');

    const stored = JSON.parse((await AsyncStorage.getItem(HANDLED_KEY))!) as string[];
    expect(stored).toEqual(expect.arrayContaining(['s1|done', 's2|skip', 's3|snooze', 's4|done']));
  });

  it('deduplicates concurrent delivery via inFlight so logHabit runs only once', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const logHabit = jest.fn(async () => {
      await gate;
      return { ok: true };
    });
    const deps = {
      habits: [habit()],
      logHabit,
      openMeasure: () => undefined,
      reconcile: async () => undefined,
    };
    const p1 = handleReminderResponse(response('done', 'race-1'), deps);
    const p2 = handleReminderResponse(response('done', 'race-1'), deps);
    release();
    const outcomes = (await Promise.all([p1, p2])).sort();
    expect(outcomes).toEqual(['duplicate', 'logged']);
    expect(logHabit).toHaveBeenCalledTimes(1);
  });

  it('uses deps.habits directly when whenHabitsReady is omitted', async () => {
    const logHabit = jest.fn(async () => ({ ok: true }));
    const out = await handleReminderResponse(response('done', 'legacy-deps'), {
      habits: [habit()],
      logHabit,
      openMeasure: () => undefined,
      reconcile: async () => undefined,
    });
    expect(out).toBe('logged');
  });
});

describe('DOM-V01 — cold-start reconcile skip and whenHabitsLoaded', () => {
  it('skips reconciliation completely when habits provider returns null, preserving all scheduled notifications', async () => {
    mockOS.scheduled = [
      { identifier: 'existing-1', data: { kind: 'habit', key: 'h:h1:2026-10-05:08:00@1791176400000' } },
    ];
    const r = await reconcileReminders(() => null, () => new Date(2026, 9, 5, 6, 0, 0));
    expect(r).toMatchObject({ permission: null, skipped: 'habits-unknown', cancelled: 0, added: 0 });
    expect(mockListScheduled).not.toHaveBeenCalled();
    expect(mockCancelScheduled).not.toHaveBeenCalled();
    expect(mockScheduleReentryNudge).not.toHaveBeenCalled();
    expect(mockOS.scheduled).toHaveLength(1);
  });

  it('cancels our scheduled notifications when habits provider returns [] (loaded and genuinely empty)', async () => {
    mockOS.scheduled = [
      { identifier: 'existing-1', data: { kind: 'habit', key: 'h:h1:2026-10-05:08:00@1791176400000' } },
    ];
    const r = await reconcileReminders(() => [], () => new Date(2026, 9, 5, 6, 0, 0));
    expect(r.cancelled).toBe(1);
    expect(mockOS.scheduled).toEqual([]);
  });

  it('whenHabitsLoaded resolves immediately when loaded, triggers fetchHabits when idle, and times out cleanly after 5000ms', async () => {
    jest.useFakeTimers();
    try {
      expect(HABITS_WAIT_MS).toBe(5000);

      // Case 1: already loaded -> resolves immediately, zero fetchHabits
      useHabitStore.setState({ habits: [habit()], habitsLoaded: true });
      const immediate = await whenHabitsLoaded();
      expect(immediate).toHaveLength(1);
      expect(mockListHabits).not.toHaveBeenCalled();

      // Case 2: not loaded & not loading -> starts fetchHabits once and resolves on habitsLoaded
      resetAccountMemory('signed_out');
      invalidateHabitsFetch();
      expect(useHabitStore.getState().habitsLoaded).toBe(false);
      let resolveFetch!: (v: { ok: true; data: Habit[] }) => void;
      mockListHabits.mockImplementationOnce(() => new Promise((r) => { resolveFetch = r; }));

      const waiting = whenHabitsLoaded();
      expect(mockListHabits).toHaveBeenCalledTimes(1);
      resolveFetch({ ok: true, data: [habit({ id: 'h-loaded' })] });
      const loaded = await waiting;
      expect(loaded.map((h) => h.id)).toEqual(['h-loaded']);
      expect(useHabitStore.getState().habitsLoaded).toBe(true);

      // Case 3: offline / hung fetch -> times out at 5000ms with current list and cleans up subscription
      resetAccountMemory('signed_out');
      invalidateHabitsFetch();
      mockListHabits.mockImplementationOnce(() => new Promise(() => undefined)); // never settles
      const timedOutPromise = whenHabitsLoaded();
      jest.advanceTimersByTime(HABITS_WAIT_MS);
      const timedOut = await timedOutPromise;
      expect(timedOut).toEqual([]);
      // Mutating state afterwards is harmless (unsubscribed)
      useHabitStore.setState({ habits: [habit()], habitsLoaded: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('shouldRecordHandled rejects failed, ignored and duplicate', () => {
    expect(shouldRecordHandled('failed')).toBe(false);
    expect(shouldRecordHandled('ignored')).toBe(false);
    expect(shouldRecordHandled('duplicate')).toBe(false);
    expect(shouldRecordHandled('logged')).toBe(true);
    expect(shouldRecordHandled('skipped')).toBe(true);
    expect(shouldRecordHandled('snoozed')).toBe(true);
    expect(shouldRecordHandled('opened')).toBe(true);
  });

  it('GAP1-03 — updateHabit returns { ok: true } on success and Turkish offline/server error on failure', async () => {
    useHabitStore.setState({ habits: [habit()], habitsLoaded: true });

    mockPatchHabit.mockResolvedValueOnce({ ok: false, offline: true, error: 'Network request failed' });
    const offlineRes = await useHabitStore.getState().updateHabit('h1', { reminders: { enabled: true, time: '09:00' } });
    expect(offlineRes).toEqual({ ok: false, error: 'Bağlantı yok; değişiklik kaydedilmedi.' });

    mockPatchHabit.mockResolvedValueOnce({ ok: false, error: 'Sunucu reddi' });
    const errRes = await useHabitStore.getState().updateHabit('h1', { reminders: { enabled: true, time: '09:00' } });
    expect(errRes).toEqual({ ok: false, error: 'Sunucu reddi' });

    mockPatchHabit.mockResolvedValueOnce({ ok: true, data: habit({ reminders: { enabled: true, time: '09:00' } }) });
    const okRes = await useHabitStore.getState().updateHabit('h1', { reminders: { enabled: true, time: '09:00' } });
    expect(okRes).toEqual({ ok: true });
    expect(useHabitStore.getState().habits[0].reminders?.time).toBe('09:00');
  });
});
