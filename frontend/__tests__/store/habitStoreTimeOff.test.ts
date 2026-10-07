/**
 * R01.05 — the habit store attaches time off and goal versions, refuses to
 * write while the server tables are missing, and records a goal version only
 * after the habit write itself was accepted.
 */
const mockSvc = {
  habits: [] as any[],
  timeOff: { ok: true, data: { available: true, pauses: [] as any[], versions: [] as any[] } } as any,
  patchOk: true,
  versionCalls: [] as any[],
  addCalls: [] as any[],
};

jest.mock('../../services/habitService', () => ({
  listHabits: jest.fn(async () => ({ ok: true, data: mockSvc.habits })),
  loadTimeOff: jest.fn(async () => mockSvc.timeOff),
  // R01.04 — fetchHabits also loads checklists; not under test here.
  loadChecklists: jest.fn(async () => ({ ok: true, data: { available: true, items: [], checks: [] } })),
  patchHabit: jest.fn(async (id: string, updates: any) => (mockSvc.patchOk ? { ok: true, data: { id, ...updates } } : { ok: false, error: 'refused' })),
  recordGoalVersion: jest.fn(async (habit: any, next: any, today: string) => {
    mockSvc.versionCalls.push({ habit, next, today });
    return { ok: true, versions: [{ habit_id: habit.id, effective_from: today, ...next }] };
  }),
  addTimeOff: jest.fn(async (p: any) => {
    mockSvc.addCalls.push(p);
    return { ok: true, pause: { id: 'p1', habit_id: p.habitId, kind: p.draft.kind, start_date: p.draft.start_date, end_date: p.draft.end_date } };
  }),
  endTimeOff: jest.fn(async () => ({ ok: true, pause: null })),
  createHabit: jest.fn(), archiveHabit: jest.fn(), purgeHabit: jest.fn(), restoreHabit: jest.fn(),
  activateHabit: jest.fn(), pauseHabit: jest.fn(),
}));
jest.mock('../../lib/notifications', () => ({ scheduleHabitReminder: jest.fn(), cancelHabitReminder: jest.fn() }));
jest.mock('../../store/willpowerStore', () => ({ useWillpowerStore: { getState: () => ({}) } }));

import { useHabitStore } from '../../store/habitStore';
import { todayLocal } from '../../lib/date';

const H = { id: 'h1', name: 'Yürüyüş', status: 'active', frequency_config: { kind: 'daily' }, daily_goal: null, target_direction: null, created_at: '2026-09-01T08:00:00' };

beforeEach(() => {
  mockSvc.habits = [{ ...H }];
  mockSvc.timeOff = { ok: true, data: { available: true, pauses: [], versions: [] } };
  mockSvc.patchOk = true;
  mockSvc.versionCalls = [];
  mockSvc.addCalls = [];
  useHabitStore.setState({ habits: [], pauses: [], goalVersions: [], timeOffAvailable: null, loading: false });
});

describe('R01.05 — loading', () => {
  it('attaches each habit\'s pauses and every holiday', async () => {
    mockSvc.timeOff.data.pauses = [
      { id: 'a', habit_id: 'h1', kind: 'pause', start_date: '2026-10-01', end_date: null },
      { id: 'b', habit_id: null, kind: 'holiday', start_date: '2026-12-20', end_date: '2026-12-31' },
    ];
    await useHabitStore.getState().fetchHabits();
    const s = useHabitStore.getState();
    expect(s.timeOffAvailable).toBe(true);
    expect(s.habits[0].pause_intervals?.map((p) => p.id)).toEqual(['a', 'b']);
  });

  it('missing tables: unavailable, habits unchanged', async () => {
    mockSvc.timeOff = { ok: true, data: { available: false, pauses: [], versions: [] } };
    await useHabitStore.getState().fetchHabits();
    expect(useHabitStore.getState().timeOffAvailable).toBe(false);
    expect('pause_intervals' in useHabitStore.getState().habits[0]).toBe(false);
  });

  it('a failed read leaves availability unknown -- not "no pauses" as a fact', async () => {
    mockSvc.timeOff = { ok: false, error: 'offline' };
    await useHabitStore.getState().fetchHabits();
    expect(useHabitStore.getState().timeOffAvailable).toBeNull();
    expect(useHabitStore.getState().habits).toHaveLength(1);
  });
});

describe('R01.05 — writing a break', () => {
  it('refused while the server tables are missing; nothing is sent', async () => {
    useHabitStore.setState({ timeOffAvailable: false });
    const r = await useHabitStore.getState().addTimeOff('h1', { kind: 'pause', start_date: todayLocal(), end_date: null });
    expect(r.ok).toBe(false);
    expect(mockSvc.addCalls).toHaveLength(0);
  });

  it('when available: written, kept, and attached to the habit at once', async () => {
    await useHabitStore.getState().fetchHabits();
    const r = await useHabitStore.getState().addTimeOff('h1', { kind: 'pause', start_date: todayLocal(), end_date: null });
    expect(r.ok).toBe(true);
    expect(useHabitStore.getState().pauses).toHaveLength(1);
    expect(useHabitStore.getState().habits[0].pause_intervals).toHaveLength(1);
  });

  it('ending a break that never started removes it from the habit', async () => {
    await useHabitStore.getState().fetchHabits();
    await useHabitStore.getState().addTimeOff('h1', { kind: 'pause', start_date: todayLocal(), end_date: null });
    const r = await useHabitStore.getState().endTimeOff('p1');
    expect(r.ok).toBe(true);
    expect(useHabitStore.getState().pauses).toHaveLength(0);
    expect('pause_intervals' in useHabitStore.getState().habits[0]).toBe(false);
  });
});

describe('R01.05 — a goal edit is versioned', () => {
  it('records the version after the habit write, from today', async () => {
    await useHabitStore.getState().fetchHabits();
    await useHabitStore.getState().updateHabit('h1', { frequency_config: { kind: 'weekly', days: [0] } });
    expect(mockSvc.versionCalls).toHaveLength(1);
    expect(mockSvc.versionCalls[0].today).toBe(todayLocal());
    expect(mockSvc.versionCalls[0].habit.frequency_config).toEqual({ kind: 'daily' }); // the OLD config, for the baseline
    expect(useHabitStore.getState().goalVersions).toHaveLength(1);
  });

  it('no version for a refused habit write', async () => {
    await useHabitStore.getState().fetchHabits();
    mockSvc.patchOk = false;
    await useHabitStore.getState().updateHabit('h1', { frequency_config: { kind: 'weekly', days: [0] } });
    expect(mockSvc.versionCalls).toHaveLength(0);
  });

  it('no version when the tables are missing, or for a non-goal edit', async () => {
    await useHabitStore.getState().fetchHabits();
    await useHabitStore.getState().updateHabit('h1', { name: 'Koşu' });
    expect(mockSvc.versionCalls).toHaveLength(0);
    useHabitStore.setState({ timeOffAvailable: false });
    await useHabitStore.getState().updateHabit('h1', { daily_goal: 5 });
    expect(mockSvc.versionCalls).toHaveLength(0);
  });
});
