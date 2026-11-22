/**
 * T1 — the habit detail screen, rendered with the real habit store (the
 * service layer is fake). Pins the rows this core round added: schedule with
 * its edit, break, reminder (with the permission state), checklist editor,
 * plus F31's Kintsugi year grid, habit color picker, and paginated history notes.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { TouchableOpacity } from 'react-native';

const mockLogsForHabit = jest.fn(async () => ({ ok: true as boolean, data: [] as any[], error: undefined as string | undefined }));
const mockPatchHabit = jest.fn(async (_id: string, updates: any) => ({
  ok: true as const,
  data: { ...habit, ...updates },
}));
const mockRepairedSourceDates = jest.fn(async () => ({ ok: true as const, data: new Set<string>() }));
const mockSaveLogNote = jest.fn(async () => ({ ok: true as const, notes: 'kaydedildi' }));

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('expo-router', () => {
  const ReactActual = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    useLocalSearchParams: () => ({ id: 'h1' }),
    useFocusEffect: (cb: () => void | (() => void)) => {
      ReactActual.useEffect(cb, [cb]);
    },
    Stack: Object.assign(() => null, { Screen: () => null }),
  };
});
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));
jest.mock('../../lib/notifications', () => ({
  hasPermission: jest.fn(async () => false),
  notificationAccess: jest.fn(async () => 'ask'),
  openNotificationSettings: jest.fn(async () => true),
  scheduleHabitReminder: jest.fn(), cancelHabitReminder: jest.fn(),
}));
jest.mock('../../services/habitService', () => ({
  logsForHabit: (...args: any[]) => (mockLogsForHabit as any)(...args),
  listHabits: jest.fn(async () => ({ ok: true, data: [] })),
  loadTimeOff: jest.fn(async () => ({ ok: true, data: { available: false, pauses: [], versions: [] } })),
  loadChecklists: jest.fn(async () => ({ ok: true, data: { available: false, items: [], checks: [] } })),
  patchHabit: (...args: any[]) => (mockPatchHabit as any)(...args),
  recordGoalVersion: jest.fn(), addTimeOff: jest.fn(), endTimeOff: jest.fn(),
  addChecklistItem: jest.fn(), editChecklistItem: jest.fn(), setCheck: jest.fn(),
  createHabit: jest.fn(), archiveHabit: jest.fn(), purgeHabit: jest.fn(), restoreHabit: jest.fn(),
  activateHabit: jest.fn(), pauseHabit: jest.fn(),
}));
jest.mock('../../services/recoveryService', () => ({
  repairedSourceDates: (...args: any[]) => (mockRepairedSourceDates as any)(...args),
}));
jest.mock('../../services/habitLogService', () => ({
  saveLogNote: (...args: any[]) => (mockSaveLogNote as any)(...args),
}));
jest.mock('../../store/willpowerStore', () => ({ useWillpowerStore: Object.assign(() => ({}), { getState: () => ({}) }) }));

import HabitDetailScreen from '../../app/screens/habit-detail';
import { useHabitStore } from '../../store/habitStore';
import { HABIT_HUES } from '../../lib/habitColors';
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
  jest.clearAllMocks();
  mockLogsForHabit.mockResolvedValue({ ok: true, data: [], error: undefined });
  mockRepairedSourceDates.mockResolvedValue({ ok: true, data: new Set() });
  act(() => {
    useHabitStore.setState({
      habits: [habit], loading: false, pauses: [], goalVersions: [], timeOffAvailable: false,
      checklistItems: [], checklistChecks: [], checklistAvailable: false,
    } as any);
  });
});

it('renders the habit with its Yıl izi, Renk, schedule, break, reminder and checklist rows', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<HabitDetailScreen />); });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });
  const t = textOf(r);
  expect(t).toMatch(/Akşam yürüyüşü/);
  expect(t).toMatch(/Yıl izi/);
  expect(t).toMatch(/Renk/);
  expect(t).toMatch(/Varsayılan/);
  expect(t).toMatch(/Sıklık/);
  expect(t).toMatch(/Ara/);
  expect(t).toMatch(/Yok/);
  expect(t).toMatch(/19:30 · izin kapalı/);
  expect(t).toMatch(/Kontrol listesi sunucu güncellemesini bekliyor/);
  act(() => { r.unmount(); });
});

it('a habit on a break shows its dates and offers to end it', async () => {
  useHabitStore.setState({ pauses: [{ id: 'p1', habit_id: 'h1', kind: 'pause', start_date: '2099-01-01', end_date: null }] } as any);
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<HabitDetailScreen />); });
  const t = textOf(r);
  expect(t).toMatch(/2099-01-01 → sen açana kadar/);
  expect(r.root.findAll((n) => n.props?.accessibilityLabel === 'Arayı bitir').length).toBeGreaterThan(0);
  act(() => { r.unmount(); });
});

it('(-) when logsForHabit fails, renders honest error state and ZERO "Kaçırıldı" labels; (-) unlogged selected day offers no "Not ekle" button', async () => {
  mockLogsForHabit.mockResolvedValueOnce({ ok: false, data: [], error: 'ağ hatası' });
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<HabitDetailScreen />); });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });

  const errText = textOf(r);
  expect(errText).toContain('Kayıtlar okunamadı. Tekrar dene.');
  expect(errText).not.toContain('Kaçırıldı');
  act(() => { r.unmount(); });

  // Ready with zero logs -> step to a day -> unlogged day has NO "Not ekle" button
  mockLogsForHabit.mockResolvedValueOnce({ ok: true, data: [], error: undefined });
  let r2!: TestRenderer.ReactTestRenderer;
  await act(async () => { r2 = TestRenderer.create(<HabitDetailScreen />); });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });

  const prevBtn = r2.root.find(
    (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityLabel === 'Önceki gün',
  );
  act(() => { prevBtn.props.onPress(); });
  expect(textOf(r2)).not.toContain('Not ekle');
  act(() => { r2.unmount(); });
});

it('(+) color sheet updates habit color via updateHabit, and GEÇMİŞ paginates 15 rows with "Daha fazla göster (1)"', async () => {
  const fifteenRows = Array.from({ length: 15 }, (_, i) => ({
    habit_id: 'h1',
    completed_at: `2026-09-${String(i + 1).padStart(2, '0')}`,
    state: 'done' as const,
    value: null,
    notes: i === 14 ? 'son gün notu' : null,
  }));
  mockLogsForHabit.mockResolvedValueOnce({ ok: true, data: fifteenRows, error: undefined });

  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<HabitDetailScreen />); });
  await act(async () => { await new Promise((res) => setTimeout(res, 0)); });

  // Open color picker & pick first hue -> saves via patchHabit (updateHabit)
  const editColorBtn = r.root.find(
    (n) => n.type === TouchableOpacity && n.props?.accessibilityLabel === 'Rengi değiştir',
  );
  act(() => { editColorBtn.props.onPress(); });

  const firstHue = r.root.findAll(
    (n) => typeof n.props?.onPress === 'function' && n.props?.accessibilityRole === 'radio',
  )[0];
  act(() => { firstHue.props.onPress(); });

  const saveColorBtn = r.root.find(
    (n) => n.type === TouchableOpacity && n.props?.accessibilityLabel === 'Rengi kaydet',
  );
  await act(async () => { await saveColorBtn.props.onPress(); });
  expect(mockPatchHabit).toHaveBeenCalledWith('h1', { color: HABIT_HUES[0].hex });

  // Switch to GEÇMİŞ tab -> "Son kayıtlar" + "Daha fazla göster (1)"
  const gecmisTab = r.root.findAll(
    (n) => n.type === TouchableOpacity && n.props?.accessibilityRole === 'tab',
  )[1];
  act(() => { gecmisTab.props.onPress(); });

  const gecmisText = textOf(r);
  expect(gecmisText).toContain('Son kayıtlar');
  expect(gecmisText).toContain('son gün notu');
  expect(gecmisText).toContain('Daha fazla göster (1)');
  act(() => { r.unmount(); });
});
