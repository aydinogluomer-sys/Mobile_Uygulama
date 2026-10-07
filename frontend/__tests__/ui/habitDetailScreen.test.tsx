/**
 * T1 — the habit detail screen, rendered with the real habit store (the
 * service layer is fake). Pins the rows this core round added: schedule with
 * its edit, break, reminder (with the permission state), checklist editor.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({ id: 'h1' }), Stack: Object.assign(() => null, { Screen: () => null }) }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));
jest.mock('../../lib/notifications', () => ({
  hasPermission: jest.fn(async () => false),
  scheduleHabitReminder: jest.fn(), cancelHabitReminder: jest.fn(),
}));
jest.mock('../../services/habitService', () => ({
  logsForHabit: jest.fn(async () => ({ ok: true, data: [] })),
  listHabits: jest.fn(async () => ({ ok: true, data: [] })),
  loadTimeOff: jest.fn(async () => ({ ok: true, data: { available: false, pauses: [], versions: [] } })),
  loadChecklists: jest.fn(async () => ({ ok: true, data: { available: false, items: [], checks: [] } })),
  patchHabit: jest.fn(), recordGoalVersion: jest.fn(), addTimeOff: jest.fn(), endTimeOff: jest.fn(),
  addChecklistItem: jest.fn(), editChecklistItem: jest.fn(), setCheck: jest.fn(),
  createHabit: jest.fn(), archiveHabit: jest.fn(), purgeHabit: jest.fn(), restoreHabit: jest.fn(),
  activateHabit: jest.fn(), pauseHabit: jest.fn(),
}));
jest.mock('../../store/willpowerStore', () => ({ useWillpowerStore: Object.assign(() => ({}), { getState: () => ({}) }) }));

import HabitDetailScreen from '../../app/screens/habit-detail';
import { useHabitStore } from '../../store/habitStore';
import type { Habit } from '../../lib/supabase';

const habit = {
  id: 'h1', user_id: 'u1', name: 'Akşam yürüyüşü', icon: null, color: null, behavior_type: 'positive',
  tracking_type: 'boolean', unit: null, daily_goal: null, target_direction: null,
  frequency_config: { kind: 'weekly', days: [0, 3] }, willpower_cost: 3, status: 'active', impact_level: null,
  urgency: null, difficulty: 3, estimated_minutes: 30, reminders: { enabled: true, time: '19:30' }, cue_habit_id: null,
  cue_note: null, life_area: null, end_condition: null, created_at: '2026-09-01T08:00:00',
} as Habit;

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); };
  walk(r.toJSON());
  return out.join(' ');
}

beforeEach(() => {
  useHabitStore.setState({
    habits: [habit], loading: false, pauses: [], goalVersions: [], timeOffAvailable: false,
    checklistItems: [], checklistChecks: [], checklistAvailable: false,
  } as any);
});

it('renders the habit with its schedule, break, reminder and checklist rows', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<HabitDetailScreen />); });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  const t = textOf(r);
  expect(t).toMatch(/Akşam yürüyüşü/);
  expect(t).toMatch(/Sıklık/);
  expect(t).toMatch(/Ara/);
  expect(t).toMatch(/Yok/);
  expect(t).toMatch(/19:30 · izin kapalı/);              // reminder row says the permission is off
  expect(t).toMatch(/Kontrol listesi sunucu güncellemesini bekliyor/);
});

it('a habit on a break shows its dates and offers to end it', async () => {
  useHabitStore.setState({ pauses: [{ id: 'p1', habit_id: 'h1', kind: 'pause', start_date: '2099-01-01', end_date: null }] } as any);
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<HabitDetailScreen />); });
  const t = textOf(r);
  expect(t).toMatch(/2099-01-01 → sen açana kadar/);
  expect(r.root.findAll((n) => n.props?.accessibilityLabel === 'Arayı bitir').length).toBeGreaterThan(0);
});
