/**
 * T1 — the recovery screen rendered with the real recovery/habit stores (the
 * service layer faked): a missed day is in the backlog, planning it shows the
 * target day's load (R03.05), and "Yaptım" on a measurable habit asks for an
 * amount instead of inventing one (KD-12).
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }), useLocalSearchParams: () => ({}), Stack: Object.assign(() => null, { Screen: () => null }) }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));
jest.mock('../../lib/notifications', () => ({ scheduleHabitReminder: jest.fn(), cancelHabitReminder: jest.fn(), scheduleRecoveryReminder: jest.fn(), cancelRecoveryReminder: jest.fn() }));
jest.mock('../../services/habitService', () => ({
  logsForHabitsSince: jest.fn(async () => ({ ok: true, data: [] })),
  listHabits: jest.fn(async () => ({ ok: true, data: (globalThis as any).__habits })),
  loadTimeOff: jest.fn(async () => ({ ok: true, data: { available: false, pauses: [], versions: [] } })),
  loadChecklists: jest.fn(async () => ({ ok: true, data: { available: false, items: [], checks: [] } })),
  patchHabit: jest.fn(), recordGoalVersion: jest.fn(), addTimeOff: jest.fn(), endTimeOff: jest.fn(),
  addChecklistItem: jest.fn(), editChecklistItem: jest.fn(), setCheck: jest.fn(),
  createHabit: jest.fn(), archiveHabit: jest.fn(), purgeHabit: jest.fn(), restoreHabit: jest.fn(),
  activateHabit: jest.fn(), pauseHabit: jest.fn(),
}));
jest.mock('../../services/taskService', () => ({
  listTasks: jest.fn(async () => ({ ok: true, data: { rows: [], nextCursor: null, hasMore: false } })),
  completionPatch: jest.fn(), newTaskRow: jest.fn(), deliverTaskCommand: jest.fn(),
}));
jest.mock('../../store/logStore', () => {
  const state = { fetchLogsForDate: jest.fn(async () => undefined), logHabit: jest.fn(async () => ({ ok: true })), getLogForHabit: () => undefined, logs: [] };
  const useLogStore: any = (sel?: any) => (sel ? sel(state) : state);
  useLogStore.getState = () => state;
  return { useLogStore };
});
jest.mock('../../store/willpowerStore', () => ({ useWillpowerStore: Object.assign(() => ({}), { getState: () => ({}) }) }));
jest.mock('../../services/recoveryService', () => ({
  ...jest.requireActual('../../services/recoveryService'),
  listPlans: jest.fn(async () => ({ ok: true, data: [] })),
  completePlanWithMakeup: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../../repositories/recoveryRepository', () => ({
  fetchRecoveryPlansPage: jest.fn(async () => ({ ok: true, data: { rows: [], nextCursor: null, hasMore: false } })),
  fetchPlannedRecoveryPlans: jest.fn(async () => ({ ok: true, data: [] })),
  fetchRecoveryPlansForReview: jest.fn(async () => ({ ok: true, data: [] })),
  insertRecoveryPlan: jest.fn(), updateRecoveryPlan: jest.fn(), deleteRecoveryPlan: jest.fn(),
}));

import RecoveryScreen from '../../app/screens/recovery';
import { useHabitStore } from '../../store/habitStore';

const base = {
  user_id: 'u1', icon: null, color: null, behavior_type: 'positive', target_direction: 'at_least',
  frequency_config: { kind: 'daily' }, willpower_cost: 3, status: 'active', impact_level: null, urgency: null,
  difficulty: 3, estimated_minutes: 20, reminders: null, cue_habit_id: null, cue_note: null, life_area: null,
  end_condition: null, created_at: new Date(Date.now() - 10 * 86400000).toISOString(),
};

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); };
  walk(r.toJSON());
  return out.join(' ');
}

async function render() {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<RecoveryScreen />); });
  for (let i = 0; i < 3; i++) await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  return r;
}
const firstPress = async (r: TestRenderer.ReactTestRenderer, label: string) => {
  const n = r.root.findAll((x) => x.props?.accessibilityLabel === label && typeof x.props.onPress === 'function')[0];
  expect(n).toBeTruthy();
  await act(async () => { n.props.onPress(); });
};

beforeEach(() => {
  (globalThis as any).__habits = [
    { ...base, id: 'h1', name: 'Yürüyüş', tracking_type: 'boolean', unit: null, daily_goal: null, target_direction: null },
  ];
  useHabitStore.setState({ habits: (globalThis as any).__habits, loading: false } as any);
});

it('a missed day is in the backlog; planning it previews the target day\'s load', async () => {
  const r = await render();
  expect(textOf(r)).toMatch(/Kaçırıldı/);
  await firstPress(r, 'Telafi Planla');
  expect(textOf(r)).toMatch(/O GÜNÜN YÜKÜ/);
});

it('"Yaptım" on a measurable habit opens the amount modal instead of writing', async () => {
  (globalThis as any).__habits = [{ ...base, id: 'h2', name: 'Su', tracking_type: 'numeric', unit: 'bardak', daily_goal: 8 }];
  useHabitStore.setState({ habits: (globalThis as any).__habits } as any);
  const r = await render();
  await firstPress(r, 'Yaptım');
  const { useLogStore } = jest.requireMock('../../store/logStore');
  expect(useLogStore.getState().logHabit).not.toHaveBeenCalled();
  expect(textOf(r)).toMatch(/gününe ne kadar ekleyelim|ne kadar/i);
});

it('R06.03: a plan that could not be saved keeps the sheet and says why', async () => {
  const { useRecoveryStore } = jest.requireActual('../../store/recoveryStore');
  const realAdd = useRecoveryStore.getState().addPlan;
  useRecoveryStore.setState({ addPlan: jest.fn(async () => null) });
  const r = await render();
  await firstPress(r, 'Telafi Planla');
  const plan = r.root.findAll((x) => /için planla$/.test(x.props?.label ?? '') && typeof x.props.onPress === 'function')[0];
  await act(async () => { await plan.props.onPress(); });
  expect(textOf(r)).toMatch(/Plan kaydedilemedi\. Seçimlerin duruyor/);
  expect(textOf(r)).toMatch(/O GÜNÜN YÜKÜ/); // the sheet is still open
  useRecoveryStore.setState({ addPlan: realAdd });
});
