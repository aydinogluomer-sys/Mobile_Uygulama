/**
 * R09.02 — "Dar eylem listesi: kayıt, hedef/SAAT düzenleme, pause, görevi
 * taşıma ve küçük adım önerme. Her eylem mevcut domain komutuna gider."
 * The reminder-time action: validated by the reminder editor's own rule,
 * previewed old -> new, applied through updateHabit, and refused when the
 * habit changed under the preview.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
const mockUpdate = jest.fn(async () => undefined);
const mockHabits: any[] = [];
jest.mock('../../store/habitStore', () => {
  const state = () => ({ habits: mockHabits, updateHabit: mockUpdate, addTimeOff: jest.fn() });
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
jest.mock('../../store/logStore', () => ({ useLogStore: { getState: () => ({ logHabit: jest.fn() }) } }));
jest.mock('../../store/focusStore', () => ({ useFocusStore: { getState: () => ({ startSmallStep: jest.fn() }) } }));

import { readActionV2 } from '../../lib/coachActionsV2';
import CoachActionCardV2 from '../../components/coach/CoachActionCardV2';

const habit = { id: 'h1', name: 'Kitap', tracking_type: 'boolean', daily_goal: null, target_direction: null, unit: null, status: 'active', frequency_config: { kind: 'daily' }, behavior_type: 'positive', reminders: { enabled: true, time: '09:00', times: ['09:00'] } };

describe('validation (the reminder editor\'s rule)', () => {
  const read = (o: Record<string, unknown>) => readActionV2({ type: 'edit_reminder_time', habit_query: 'Kitap', ...o }, '2026-10-08');
  it('normalises and accepts valid times and weekdays', () => {
    expect(read({ times: ['21:00', '7:05'] })).toEqual({ type: 'edit_reminder_time', habit_query: 'Kitap', reminders: { enabled: true, time: '07:05', times: ['07:05', '21:00'] } });
    expect(read({ times: ['08:30'], days: [0, 2, 4] })).toMatchObject({ reminders: { days: [0, 2, 4] } });
  });
  it('refuses bad times, duplicates, too many, bad days and extra keys', () => {
    expect(read({ times: ['25:00'] })).toMatch(/^invalid reminder/);
    expect(read({ times: ['08:00', '8:00'] })).toMatch(/^invalid reminder: Aynı saat/);
    expect(read({ times: ['06:00', '07:00', '08:00', '09:00', '10:00'] })).toMatch(/^invalid reminder: Günde en fazla/);
    expect(read({ times: ['08:00'], days: [7] })).toMatch(/^invalid reminder/);
    expect(read({ times: [] })).toMatch(/^invalid reminder/);
    expect(read({ times: ['08:00'], habit_id: 'x' })).toBe('unexpected key for edit_reminder_time');
  });
});

describe('the card', () => {
  beforeEach(() => { mockHabits.length = 0; mockHabits.push({ ...habit }); mockUpdate.mockClear(); });
  const action = { type: 'edit_reminder_time' as const, habit_query: 'Kitap', reminders: { enabled: true, time: '21:00', times: ['21:00'] } };

  it('previews old -> new and applies through updateHabit', async () => {
    const done = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<CoachActionCardV2 action={action} onDone={done} />); });
    expect(JSON.stringify(r.toJSON())).toMatch(/Kitap hatırlatması: 09:00 → 21:00/);
    const apply = r.root.findAll((n) => n.props?.accessibilityLabel === 'Uygula' && typeof n.props.onPress === 'function')[0];
    await act(async () => { await apply.props.onPress(); });
    expect(mockUpdate).toHaveBeenCalledWith('h1', { reminders: action.reminders });
    expect(done).toHaveBeenCalledWith(true, '✓ Kitap hatırlatması güncellendi.');
  });

  it('a reminder changed while the card was open is not overwritten', async () => {
    const done = jest.fn();
    let r!: TestRenderer.ReactTestRenderer;
    await act(async () => { r = TestRenderer.create(<CoachActionCardV2 action={action} onDone={done} />); });
    mockHabits[0] = { ...habit, reminders: { enabled: true, time: '10:00', times: ['10:00'] } };
    const apply = r.root.findAll((n) => n.props?.accessibilityLabel === 'Uygula' && typeof n.props.onPress === 'function')[0];
    await act(async () => { await apply.props.onPress(); });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(r.toJSON())).toMatch(/sen bakarken değişti/);
  });
});
