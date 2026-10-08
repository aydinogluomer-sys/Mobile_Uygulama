/**
 * R09.03 — "Doğru varlık, tarih, birim ve etki önizlemesi sun. Belirsiz adayda
 * soru sor; kullanıcı onayı ile sürüm değişmişse yeniden önizle. İptal geri
 * dönülmez yan etki üretmesin."
 * An ambiguous match asks (the candidates are offered, nothing is applied
 * until one is picked); the picked one is checked against the card's moment;
 * cancelling writes nothing.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockUpdateHabit = jest.fn(async () => undefined);
const mockAddTimeOff = jest.fn(async () => ({ ok: true }));
const mockUpdateTask = jest.fn(async () => undefined);
const mockLog = jest.fn(async () => undefined);
const mockHabits: any[] = [];
const mockTasks: any[] = [];
jest.mock('../../store/habitStore', () => {
  const state = () => ({ habits: mockHabits, updateHabit: mockUpdateHabit, addTimeOff: mockAddTimeOff });
  const useHabitStore: any = (sel?: any) => (sel ? sel(state()) : state());
  useHabitStore.getState = state;
  return { useHabitStore };
});
jest.mock('../../store/taskStore', () => {
  const state = () => ({ tasks: mockTasks, updateTask: mockUpdateTask });
  const useTaskStore: any = (sel?: any) => (sel ? sel(state()) : state());
  useTaskStore.getState = state;
  return { useTaskStore };
});
jest.mock('../../store/logStore', () => ({ useLogStore: { getState: () => ({ logHabit: mockLog }) } }));
jest.mock('../../store/focusStore', () => ({ useFocusStore: { getState: () => ({ startSmallStep: jest.fn(() => true) }) } }));

import CoachActionCardV2 from '../../components/coach/CoachActionCardV2';

const H = (id: string, name: string) => ({ id, name, tracking_type: 'boolean', daily_goal: null, target_direction: null, unit: null, status: 'active', frequency_config: { kind: 'daily' }, behavior_type: 'positive', reminders: null });
const T = (id: string, title: string) => ({ id, title, completed: false, status: 'pending', due_date: '2026-10-08', updated_at: 'v1' });

const byLabel = (r: TestRenderer.ReactTestRenderer, label: string) =>
  r.root.findAll((n) => n.props?.accessibilityLabel === label && typeof n.props.onPress === 'function', { deep: false });
const text = (r: TestRenderer.ReactTestRenderer) => JSON.stringify(r.toJSON());

beforeEach(() => {
  mockHabits.length = 0; mockTasks.length = 0;
  mockHabits.push(H('h1', 'Kitap oku'), H('h2', 'Kitap özetle'), H('h3', 'Yürüyüş'));
  mockTasks.push(T('t1', 'Rapor yaz'), T('t2', 'Rapor oku'));
  for (const m of [mockUpdateHabit, mockAddTimeOff, mockUpdateTask, mockLog]) m.mockClear();
});

async function mount(action: any) {
  const done = jest.fn();
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<CoachActionCardV2 action={action} onDone={done} />); });
  return { r, done };
}

describe('an ambiguous habit asks which one', () => {
  const action = { type: 'pause_habit', habit_query: 'kitap', from: '2026-10-08', until: null };

  it('offers the candidates and no apply button until one is picked', async () => {
    const { r } = await mount(action);
    expect(text(r)).toMatch(/birden fazla kayıtla eşleşti\. Hangisi\?/);
    const opts = r.root.findAll((n) => n.props?.accessibilityRole === 'radio' && typeof n.props.onPress === 'function', { deep: false });
    expect(opts.map((o) => o.props.accessibilityLabel)).toEqual(['Kitap oku', 'Kitap özetle']);
    expect(byLabel(r, 'Uygula')).toHaveLength(0);
  });

  it('the picked one is previewed and applied -- the other is untouched', async () => {
    const { r, done } = await mount(action);
    await act(async () => { byLabel(r, 'Kitap özetle')[0].props.onPress(); });
    expect(text(r)).toMatch(/Kitap özetle: 2026-10-08 → sen açana kadar ara/);
    await act(async () => { await byLabel(r, 'Uygula')[0].props.onPress(); });
    expect(mockAddTimeOff).toHaveBeenCalledTimes(1);
    expect(mockAddTimeOff).toHaveBeenCalledWith('h2', { kind: 'pause', start_date: '2026-10-08', end_date: null });
    expect(done).toHaveBeenCalledWith(true, '✓ Kitap özetle için ara verildi.');
  });

  it('a pick can be undone before applying (tap again)', async () => {
    const { r } = await mount(action);
    await act(async () => { byLabel(r, 'Kitap oku')[0].props.onPress(); });
    expect(byLabel(r, 'Uygula')).toHaveLength(1);
    await act(async () => { byLabel(r, 'Kitap oku')[0].props.onPress(); });
    expect(byLabel(r, 'Uygula')).toHaveLength(0);
  });

  it('the picked candidate changed since the card appeared: not applied, re-ask', async () => {
    const { r } = await mount(action);
    mockHabits[0] = { ...mockHabits[0], status: 'archived' };
    await act(async () => { byLabel(r, 'Kitap oku')[0].props.onPress(); });
    await act(async () => { await byLabel(r, 'Uygula')[0].props.onPress(); });
    expect(mockAddTimeOff).not.toHaveBeenCalled();
    expect(text(r)).toMatch(/sen bakarken değişti/);
  });
});

describe('an ambiguous task asks which one', () => {
  it('moves only the picked task', async () => {
    const { r, done } = await mount({ type: 'move_task', task_query: 'rapor', date: '2026-10-10' });
    expect(text(r)).toMatch(/Hangisi\?/);
    await act(async () => { byLabel(r, 'Rapor oku')[0].props.onPress(); });
    expect(text(r)).toMatch(/\\"Rapor oku\\" → 2026-10-10/);
    await act(async () => { await byLabel(r, 'Uygula')[0].props.onPress(); });
    expect(mockUpdateTask).toHaveBeenCalledWith('t2', { due_date: '2026-10-10' });
    expect(done).toHaveBeenCalledWith(true, '✓ "Rapor oku" 2026-10-10 tarihine taşındı.');
  });
});

describe('cancel leaves no side effect', () => {
  it.each([
    [{ type: 'pause_habit', habit_query: 'Yürüyüş', from: '2026-10-08', until: null }],
    [{ type: 'edit_reminder_time', habit_query: 'Yürüyüş', reminders: { enabled: true, time: '07:00', times: ['07:00'] } }],
    [{ type: 'move_task', task_query: 'Rapor yaz', date: '2026-10-10' }],
    [{ type: 'lighten_today', habit_queries: ['Yürüyüş'] }],
  ])('%j', async (action) => {
    const { r, done } = await mount(action);
    await act(async () => { byLabel(r, 'Vazgeç')[0].props.onPress(); });
    expect(done).toHaveBeenCalledWith(false, 'Vazgeçildi.');
    for (const m of [mockUpdateHabit, mockAddTimeOff, mockUpdateTask, mockLog]) expect(m).not.toHaveBeenCalled();
  });
});
