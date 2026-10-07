/**
 * T1 — Today, rendered with the real habit/task/runner stores (loaders and
 * I/O stores faked). Pins what this core round put on it: a habit on a break
 * is not today's work and is shown apart, the holiday card, "küçük başla" on
 * each open task, the routine entry, and the light-day / holiday links.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }), useLocalSearchParams: () => ({}), Stack: Object.assign(() => null, { Screen: () => null }) }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));
jest.mock('../../lib/notifications', () => ({ scheduleHabitReminder: jest.fn(), cancelHabitReminder: jest.fn() }));
jest.mock('../../components/XPDisplay', () => () => null);
jest.mock('../../services/reviewService', () => ({ logsForPeriod: jest.fn(async () => ({ ok: true, data: [] })) }));
jest.mock('../../services/habitService', () => ({
  listHabits: jest.fn(async () => ({ ok: true, data: (globalThis as any).__habits })),
  loadTimeOff: jest.fn(async () => ({ ok: true, data: { available: true, pauses: (globalThis as any).__pauses, versions: [] } })),
  loadChecklists: jest.fn(async () => ({ ok: true, data: { available: false, items: [], checks: [] } })),
  patchHabit: jest.fn(), recordGoalVersion: jest.fn(), addTimeOff: jest.fn(), endTimeOff: jest.fn(),
  addChecklistItem: jest.fn(), editChecklistItem: jest.fn(), setCheck: jest.fn(),
  createHabit: jest.fn(), archiveHabit: jest.fn(), purgeHabit: jest.fn(), restoreHabit: jest.fn(),
  activateHabit: jest.fn(), pauseHabit: jest.fn(),
}));
jest.mock('../../services/taskService', () => ({
  listTasks: jest.fn(async () => ({ ok: true, data: { rows: (globalThis as any).__tasks, nextCursor: null, hasMore: false } })),
  completionPatch: jest.fn(), newTaskRow: jest.fn(), deliverTaskCommand: jest.fn(),
}));
jest.mock('../../store/logStore', () => {
  const state = { fetchLogsForDate: jest.fn(async () => undefined), getLogForHabit: () => undefined, logHabit: jest.fn(async () => ({ ok: true })), pendingSyncCount: 0, deadSyncCount: 0, logs: [] };
  const useLogStore: any = (sel?: any) => (sel ? sel(state) : state);
  useLogStore.getState = () => state;
  useLogStore.subscribe = () => () => undefined;
  return { useLogStore };
});
jest.mock('../../store/willpowerStore', () => {
  const state = { state: null, fetchToday: jest.fn(async () => undefined), isStale: () => false };
  const useWillpowerStore: any = (sel?: any) => (sel ? sel(state) : state);
  useWillpowerStore.getState = () => state;
  return { useWillpowerStore };
});
jest.mock('../../store/recoveryStore', () => {
  const state = { plans: [], fetchPlans: jest.fn(async () => undefined) };
  const useRecoveryStore: any = (sel?: any) => (sel ? sel(state) : state);
  useRecoveryStore.getState = () => state;
  return { useRecoveryStore };
});

import TodayScreen from '../../app/tabs/today';
import { useHabitStore } from '../../store/habitStore';
import { ymd, addDaysLocal } from '../../lib/date';

const habit = (id: string, name: string) => ({
  id, user_id: 'u1', name, icon: null, color: null, behavior_type: 'positive', tracking_type: 'boolean', unit: null,
  daily_goal: null, target_direction: null, frequency_config: { kind: 'daily' }, willpower_cost: 3, status: 'active',
  impact_level: null, urgency: null, difficulty: 3, estimated_minutes: 20, reminders: null, cue_habit_id: null,
  cue_note: null, life_area: null, end_condition: null, created_at: '2026-01-01T08:00:00',
});
const today = ymd(new Date());

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); };
  walk(r.toJSON());
  return out.join(' ');
}

beforeEach(() => {
  (globalThis as any).__habits = [habit('h1', 'Yürüyüş'), habit('h2', 'Kitap okuma')];
  (globalThis as any).__pauses = [{ id: 'p1', habit_id: 'h2', kind: 'pause', start_date: today, end_date: ymd(addDaysLocal(new Date(), 3)) }];
  (globalThis as any).__tasks = [{ id: 't1', user_id: 'u1', title: 'Rapor yaz', status: 'pending', priority: 'none', list_type: 'inbox', due_date: today, completed: false, created_at: today }];
  useHabitStore.setState({ habits: [], pauses: [], goalVersions: [], timeOffAvailable: null, checklistItems: [], checklistChecks: [], checklistAvailable: null } as any);
  mockPush.mockClear();
});

async function render() {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<TodayScreen />); });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  return r;
}

it('a habit on a break is shown in ARADA, not as today\'s work', async () => {
  const r = await render();
  const t = textOf(r);
  expect(t).toMatch(/ARADA/);
  expect(t).toMatch(/Kitap okuma/);
  const host = (pred: (n: any) => boolean) => r.root.findAll((n) => typeof n.type === 'string' && pred(n));
  expect(host((n) => n.props?.accessibilityLabel?.startsWith?.('Kitap okuma, arada')).length).toBe(1);
  // today's work rows are labelled with the bare name: the habit on a break has none, the other one does
  expect(host((n) => n.props?.accessibilityLabel === 'Kitap okuma').length).toBe(0);
  expect(host((n) => n.props?.accessibilityLabel === 'Yürüyüş').length).toBe(1);
});

it('each open task offers to start small; the routine card and holiday link are there', async () => {
  const r = await render();
  expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Rapor yaz için küçük başla').length).toBe(1);
  expect(textOf(r)).toMatch(/RUTİN/);
  expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Tatil modu. Birkaç gün bütün alışkanlıklara ara ver.').length).toBe(1);
});

it('during a holiday the TATİL MODU card replaces the link', async () => {
  (globalThis as any).__pauses = [{ id: 'hol', habit_id: null, kind: 'holiday', start_date: today, end_date: null }];
  const r = await render();
  expect(textOf(r)).toMatch(/TATİL MODU/);
  expect(textOf(r)).toMatch(/Sen bitirene kadar/);
  expect(r.root.findAll((n) => n.props?.accessibilityLabel === 'Tatil modu. Birkaç gün bütün alışkanlıklara ara ver.').length).toBe(0);
});
