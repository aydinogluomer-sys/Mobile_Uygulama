/**
 * R10.02 — "R01–R09 yeni eylemlerinde kayıt/XP/FP tek etkisini ... doğrula."
 * A coach action applies ONCE, however fast the button is pressed: the second
 * press while the first is in flight, and any press after it finished, write
 * nothing.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockPending: (() => void)[] = [];
const mockRelease = () => { while (mockPending.length) mockPending.shift()!(); };
const mockAddTimeOff = jest.fn(() => new Promise<{ ok: true }>((res) => { mockPending.push(() => res({ ok: true })); }));
const mockUpdateTask = jest.fn(async () => undefined);
const mockLog = jest.fn(async () => undefined);
const mockHabits = [{ id: 'h1', name: 'Koşu', status: 'active', tracking_type: 'boolean', daily_goal: null, target_direction: null, unit: null, behavior_type: 'positive', frequency_config: { kind: 'daily' }, difficulty: 3, estimated_minutes: 20, impact_level: null }];
const mockTasks = [{ id: 't1', title: 'Rapor yaz', completed: false, status: 'pending', due_date: '2026-10-08', updated_at: 'v1' }];
jest.mock('../../store/habitStore', () => {
  const state = () => ({ habits: mockHabits, updateHabit: jest.fn(), addTimeOff: mockAddTimeOff });
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

const apply = (r: TestRenderer.ReactTestRenderer) =>
  r.root.findAll((n) => n.props?.accessibilityLabel === 'Uygula' && typeof n.props.onPress === 'function', { deep: false })[0];

it('two presses while the first write is in flight: one write', async () => {
  const done = jest.fn();
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<CoachActionCardV2 action={{ type: 'pause_habit', habit_query: 'Koşu', from: '2026-10-08', until: null }} onDone={done} />); });
  const press = apply(r).props.onPress;
  let p1!: Promise<void>; let p2!: Promise<void>;
  act(() => { p1 = press(); p2 = press(); });
  await act(async () => { mockRelease(); await Promise.all([p1, p2]); });
  expect(mockAddTimeOff).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenCalledTimes(1);
});

it('a press after the action finished writes nothing more', async () => {
  const done = jest.fn();
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<CoachActionCardV2 action={{ type: 'move_task', task_query: 'Rapor yaz', date: '2026-10-09' }} onDone={done} />); });
  const press = apply(r).props.onPress;
  await act(async () => { await press(); });
  await act(async () => { await press(); });
  expect(mockUpdateTask).toHaveBeenCalledTimes(1);
  expect(done).toHaveBeenCalledTimes(1);
});
