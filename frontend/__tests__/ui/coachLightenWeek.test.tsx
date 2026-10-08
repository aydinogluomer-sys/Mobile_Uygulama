/**
 * R09.04 — the "lighten this week" card: the app's own plan, editable, applied
 * only as dated pauses to Sunday; goals, schedules and logs are untouched.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockUpdateHabit = jest.fn(async () => undefined);
const mockAddTimeOff = jest.fn(async (_id: string, _d: unknown): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true }));
const mockLog = jest.fn(async () => undefined);
const mockHabits: any[] = [];
jest.mock('../../store/habitStore', () => {
  const state = () => ({ habits: mockHabits, updateHabit: mockUpdateHabit, addTimeOff: mockAddTimeOff });
  const useHabitStore: any = (sel?: any) => (sel ? sel(state()) : state());
  useHabitStore.getState = state;
  return { useHabitStore };
});
jest.mock('../../store/taskStore', () => {
  const state = () => ({ tasks: [], updateTask: jest.fn() });
  const useTaskStore: any = (sel?: any) => (sel ? sel(state()) : state());
  useTaskStore.getState = state;
  return { useTaskStore };
});
jest.mock('../../store/logStore', () => ({ useLogStore: { getState: () => ({ logHabit: mockLog }) } }));
jest.mock('../../store/focusStore', () => ({ useFocusStore: { getState: () => ({ startSmallStep: jest.fn() }) } }));

import CoachActionCardV2 from '../../components/coach/CoachActionCardV2';
import { readActionV2 } from '../../lib/coachActionsV2';
import { weekLightenPlan, loadAfter } from '../../lib/weekLighten';

const H = (id: string, name: string, difficulty: number, minutes: number) => ({
  id, name, status: 'active', difficulty, estimated_minutes: minutes, frequency_config: { kind: 'daily' }, impact_level: null,
  tracking_type: 'boolean', daily_goal: null, target_direction: null, unit: null, behavior_type: 'positive',
});
const THU = new Date(2026, 9, 8, 10);
const action = { type: 'lighten_week' as const };

const byLabel = (r: TestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props.onPress === 'function', { deep: false });
const text = (r: TestRenderer.ReactTestRenderer) => JSON.stringify(r.toJSON());

beforeAll(() => {
  jest.useFakeTimers({ now: THU, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'queueMicrotask', 'hrtime', 'performance'] });
});
afterAll(() => { jest.useRealTimers(); });
beforeEach(() => {
  mockHabits.length = 0;
  mockHabits.push(H('h1', 'Koşu', 5, 90), H('h2', 'Kitap', 3, 30), H('h3', 'Su iç', 1, 5));
  for (const m of [mockUpdateHabit, mockAddTimeOff, mockLog]) m.mockClear();
});

async function mount() {
  const done = jest.fn();
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<CoachActionCardV2 action={action} onDone={done} />); });
  return { r, done };
}

describe('validation', () => {
  it('takes no arguments: the model cannot name the habits', () => {
    expect(readActionV2({ type: 'lighten_week' }, '2026-10-08')).toEqual({ type: 'lighten_week' });
    expect(readActionV2({ type: 'lighten_week', habit_queries: ['Koşu'] }, '2026-10-08')).toBe('unexpected key for lighten_week');
  });
});

describe('the card', () => {
  it('shows the week\'s load before → after and pre-selects the plan\'s suggestion', async () => {
    const plan = weekLightenPlan(mockHabits, THU);
    const { r } = await mount();
    const t = text(r);
    expect(t).toContain(`Bu haftanın kalanı (2026-10-08 → 2026-10-11) yükü: ${plan.total} → ${loadAfter(plan, new Set(['h1']))}.`);
    expect(t).toMatch(/Hedefler ve takvim değişmez/);
    const boxes = r.root.findAll((n) => n.props?.accessibilityRole === 'checkbox' && typeof n.props.onPress === 'function', { deep: false });
    expect(boxes.map((b) => [b.props.accessibilityLabel.split(' · ')[0], b.props.accessibilityState.checked])).toEqual([['Koşu', true], ['Kitap', false], ['Su iç', false]]);
  });

  it('the user edits the selection; the after-number follows', async () => {
    const plan = weekLightenPlan(mockHabits, THU);
    const { r } = await mount();
    const kitap = plan.rows.find((x) => x.id === 'h2')!;
    await act(async () => { byLabel(r, `Kitap · ${kitap.points}`)[0].props.onPress(); });
    expect(text(r)).toContain(`yükü: ${plan.total} → ${loadAfter(plan, new Set(['h1', 'h2']))}.`);
  });

  it('applies ONLY dated pauses to Sunday for the kept habits -- no goal, schedule or log write', async () => {
    const plan = weekLightenPlan(mockHabits, THU);
    const { r, done } = await mount();
    await act(async () => { byLabel(r, `Koşu · ${plan.rows[0].points}`)[0].props.onPress(); }); // un-pick the suggestion
    await act(async () => { byLabel(r, `Su iç · ${plan.rows[2].points}`)[0].props.onPress(); }); // pick another
    await act(async () => { await byLabel(r, 'Uygula')[0].props.onPress(); });
    expect(mockAddTimeOff.mock.calls).toEqual([['h3', { kind: 'pause', start_date: '2026-10-08', end_date: '2026-10-11' }]]);
    expect(mockUpdateHabit).not.toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledWith(true, '✓ 1 alışkanlık 2026-10-11 tarihine kadar ara verdi.');
  });

  it('a habit archived or paused since the card appeared is not paused again; a refused pause is reported', async () => {
    const { r, done } = await mount();
    const plan = weekLightenPlan(mockHabits, THU);
    await act(async () => { byLabel(r, `Kitap · ${plan.rows[1].points}`)[0].props.onPress(); });
    await act(async () => { byLabel(r, `Su iç · ${plan.rows[2].points}`)[0].props.onPress(); });
    mockHabits[0] = { ...mockHabits[0], status: 'archived' };
    mockHabits[1] = { ...mockHabits[1], pause_intervals: [{ id: 'p', habit_id: 'h2', kind: 'pause', start_date: '2026-10-08', end_date: null }] };
    mockAddTimeOff.mockResolvedValueOnce({ ok: false, error: 'çakışma' });
    await act(async () => { await byLabel(r, 'Uygula')[0].props.onPress(); });
    expect(mockAddTimeOff.mock.calls.map((c) => c[0])).toEqual(['h3']);
    expect(done).toHaveBeenCalledWith(false, 'Uygulanamadı: Su iç.');
  });

  it('nothing to lighten: says so, offers no apply', async () => {
    mockHabits.length = 0;
    const { r } = await mount();
    expect(text(r)).toMatch(/hafifletilecek aktif alışkanlık yok/);
    expect(byLabel(r, 'Uygula')).toHaveLength(0);
  });
});
