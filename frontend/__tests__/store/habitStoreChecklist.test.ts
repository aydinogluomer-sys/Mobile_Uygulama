/**
 * R01.04 — the habit store's checklist state: loaded with the habits,
 * refused while the tables are missing, and a tick is only shown once the
 * server accepted it.
 */
const mockSvc = {
  lists: { ok: true, data: { available: true, items: [] as any[], checks: [] as any[] } } as any,
  setCheckOk: true,
  setCheckCalls: [] as any[],
  addCalls: [] as any[],
};

jest.mock('../../services/habitService', () => ({
  listHabits: jest.fn(async () => ({ ok: true, data: [{ id: 'h1', status: 'active' }] })),
  loadTimeOff: jest.fn(async () => ({ ok: true, data: { available: true, pauses: [], versions: [] } })),
  loadChecklists: jest.fn(async () => mockSvc.lists),
  setCheck: jest.fn(async (check: any, on: boolean) => {
    mockSvc.setCheckCalls.push({ check, on });
    return mockSvc.setCheckOk ? { ok: true, data: true } : { ok: false, error: 'refused' };
  }),
  addChecklistItem: jest.fn(async (p: any) => {
    mockSvc.addCalls.push(p);
    return { ok: true, item: { id: 'new', habit_id: p.habitId, title: p.title, required: p.required, position: 0, created_at: '2026-10-07T08:00:00', archived_at: null } };
  }),
  editChecklistItem: jest.fn(async (id: string, patch: any) => ({ ok: true, data: { id, ...patch } })),
  patchHabit: jest.fn(), recordGoalVersion: jest.fn(), addTimeOff: jest.fn(), endTimeOff: jest.fn(),
  createHabit: jest.fn(), archiveHabit: jest.fn(), purgeHabit: jest.fn(), restoreHabit: jest.fn(),
  activateHabit: jest.fn(), pauseHabit: jest.fn(),
}));
jest.mock('../../lib/notifications', () => ({ scheduleHabitReminder: jest.fn(), cancelHabitReminder: jest.fn() }));
jest.mock('../../store/willpowerStore', () => ({ useWillpowerStore: { getState: () => ({}) } }));

import { useHabitStore } from '../../store/habitStore';

const ITEM = (id: string, required = true) => ({ id, habit_id: 'h1', title: id, required, position: 0, created_at: '2026-09-01T08:00:00', archived_at: null });
const DAY = '2026-10-07';

beforeEach(() => {
  mockSvc.lists = { ok: true, data: { available: true, items: [ITEM('a'), ITEM('b')], checks: [] } };
  mockSvc.setCheckOk = true;
  mockSvc.setCheckCalls = [];
  mockSvc.addCalls = [];
  useHabitStore.setState({ habits: [], checklistItems: [], checklistChecks: [], checklistAvailable: null });
});

describe('R01.04 — loading', () => {
  it('items and checks arrive with the habits', async () => {
    await useHabitStore.getState().fetchHabits();
    expect(useHabitStore.getState().checklistItems).toHaveLength(2);
    expect(useHabitStore.getState().checklistAvailable).toBe(true);
  });

  it('a failed read leaves availability unknown', async () => {
    mockSvc.lists = { ok: false, error: 'offline' };
    await useHabitStore.getState().fetchHabits();
    expect(useHabitStore.getState().checklistAvailable).toBeNull();
  });
});

describe('R01.04 — ticking', () => {
  it('tick then untick: the check comes and goes, progress follows', async () => {
    await useHabitStore.getState().fetchHabits();
    const on = await useHabitStore.getState().toggleCheck('h1', 'a', DAY);
    expect(on.ok && on.progress.state).toBe('partial');
    expect(mockSvc.setCheckCalls[0].on).toBe(true);
    const both = await useHabitStore.getState().toggleCheck('h1', 'b', DAY);
    expect(both.ok && both.progress.state).toBe('done');
    const off = await useHabitStore.getState().toggleCheck('h1', 'a', DAY);
    expect(off.ok && off.progress.state).toBe('partial');
    expect(mockSvc.setCheckCalls[2].on).toBe(false);
    expect(useHabitStore.getState().checklistChecks).toEqual([{ item_id: 'b', habit_id: 'h1', day: DAY }]);
  });

  it('a refused write leaves the tick as it was', async () => {
    await useHabitStore.getState().fetchHabits();
    mockSvc.setCheckOk = false;
    const r = await useHabitStore.getState().toggleCheck('h1', 'a', DAY);
    expect(r.ok).toBe(false);
    expect(useHabitStore.getState().checklistChecks).toEqual([]);
  });

  it('nothing is sent while the tables are missing', async () => {
    useHabitStore.setState({ checklistAvailable: false });
    const r = await useHabitStore.getState().toggleCheck('h1', 'a', DAY);
    expect(r.ok).toBe(false);
    expect(mockSvc.setCheckCalls).toHaveLength(0);
    const a = await useHabitStore.getState().addChecklistItem('h1', 'ısın', true);
    expect(a.ok).toBe(false);
    expect(mockSvc.addCalls).toHaveLength(0);
  });
});

describe('R01.04 — editing', () => {
  it('add, flip to optional, archive', async () => {
    await useHabitStore.getState().fetchHabits();
    await useHabitStore.getState().addChecklistItem('h1', 'esne', false);
    expect(useHabitStore.getState().checklistItems.map((i) => i.id)).toContain('new');
    await useHabitStore.getState().setChecklistItemRequired('a', false);
    expect(useHabitStore.getState().checklistItems.find((i) => i.id === 'a')?.required).toBe(false);
    await useHabitStore.getState().archiveChecklistItem('b');
    expect(useHabitStore.getState().checklistItems.find((i) => i.id === 'b')?.archived_at).not.toBeNull();
  });
});
