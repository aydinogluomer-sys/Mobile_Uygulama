/**
 * T1 — Today, rendered with the real habit/task/runner stores (loaders and
 * I/O stores faked). Pins what this core round put on it: a habit on a break
 * is not today's work and is shown apart, the holiday card, "küçük başla" on
 * each open task, the routine entry, and the light-day / holiday links.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import React from 'react';

jest.setTimeout(30_000);

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
const mockPush = jest.fn();
const mockActionSheet = jest.fn<Promise<string | null>, [unknown]>(async () => null);
jest.mock('../../lib/dialog', () => ({
  actionSheet: (arg: unknown) => mockActionSheet(arg),
  confirm: jest.fn(async () => false),
  notify: jest.fn(async () => undefined),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({}),
  Stack: Object.assign(() => null, { Screen: () => null }),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: null })),
}));
jest.mock('../../lib/notifications', () => ({
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
}));
jest.mock('../../components/XPDisplay', () => () => null);
jest.mock('../../services/reviewService', () => ({
  logsForPeriod: jest.fn(async () => ({ ok: true, data: [] })),
}));
jest.mock('../../services/habitService', () => ({
  listHabits: jest.fn(async () => ({ ok: true, data: (globalThis as any).__habits })),
  loadTimeOff: jest.fn(async () => ({
    ok: true,
    data: { available: true, pauses: (globalThis as any).__pauses, versions: [] },
  })),
  loadChecklists: jest.fn(async () => ({
    ok: true,
    data: { available: false, items: [], checks: [] },
  })),
  patchHabit: jest.fn(),
  recordGoalVersion: jest.fn(),
  addTimeOff: jest.fn(),
  endTimeOff: jest.fn(),
  addChecklistItem: jest.fn(),
  editChecklistItem: jest.fn(),
  setCheck: jest.fn(),
  createHabit: jest.fn(),
  archiveHabit: jest.fn(),
  purgeHabit: jest.fn(),
  restoreHabit: jest.fn(),
  activateHabit: jest.fn(),
  pauseHabit: jest.fn(),
}));
jest.mock('../../services/taskService', () => ({
  listTasks: jest.fn(async () => ({
    ok: true,
    data: { rows: (globalThis as any).__tasks, nextCursor: null, hasMore: false },
  })),
  completionPatch: jest.fn(),
  newTaskRow: jest.fn(),
  deliverTaskCommand: jest.fn(),
}));
jest.mock('../../store/logStore', () => {
  const state = {
    fetchLogsForDate: jest.fn(async () => undefined),
    getLogForHabit: () => undefined,
    logHabit: jest.fn(async () => ({ ok: true })),
    pendingSyncCount: 0,
    deadSyncCount: 0,
    logs: [],
  };
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
import { addDaysLocal, ymd } from '../../lib/date';
import { useDisclosureStore } from '../../store/disclosureStore';
import { invalidateHabitsFetch, useHabitStore } from '../../store/habitStore';
import {
  act,
  renderWithProviders,
  type RenderedScreen,
} from '../helpers/renderWithProviders';

const habit = (id: string, name: string) => ({
  id,
  user_id: 'u1',
  name,
  icon: null,
  color: null,
  behavior_type: 'positive',
  tracking_type: 'boolean',
  unit: null,
  daily_goal: null,
  target_direction: null,
  frequency_config: { kind: 'daily' },
  willpower_cost: 3,
  status: 'active',
  impact_level: null,
  urgency: null,
  difficulty: 3,
  estimated_minutes: 20,
  reminders: null,
  cue_habit_id: null,
  cue_note: null,
  life_area: null,
  end_condition: null,
  created_at: '2026-01-01T08:00:00',
});
const today = ymd(new Date());

function textOf(r: RenderedScreen): string {
  const out: string[] = [];
  const walk = (n: any) => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    walk(n.children);
  };
  walk(r.toJSON());
  return out.join(' ');
}

const mountedTrees: RenderedScreen[] = [];

beforeEach(() => {
  (globalThis as any).__habits = [habit('h1', 'Yürüyüş'), habit('h2', 'Kitap okuma')];
  (globalThis as any).__pauses = [
    {
      id: 'p1',
      habit_id: 'h2',
      kind: 'pause',
      start_date: today,
      end_date: ymd(addDaysLocal(new Date(), 3)),
    },
  ];
  (globalThis as any).__tasks = [
    {
      id: 't1',
      user_id: 'u1',
      title: 'Rapor yaz',
      status: 'pending',
      priority: 'none',
      list_type: 'inbox',
      due_date: today,
      completed: false,
      created_at: today,
    },
  ];
  useHabitStore.setState({
    habits: [],
    pauses: [],
    goalVersions: [],
    timeOffAvailable: null,
    checklistItems: [],
    checklistChecks: [],
    checklistAvailable: null,
  } as any);
  const { useFocusStore } = jest.requireActual('../../store/focusStore');
  useFocusStore.setState({
    status: 'idle',
    smallStep: null,
    pausedAt: null,
    sessionStartedAt: null,
  });
  useDisclosureStore.setState(useDisclosureStore.getInitialState(), true);
  mockPush.mockClear();
  mockActionSheet.mockClear();
});

afterEach(async () => {
  while (mountedTrees.length > 0) {
    const tree = mountedTrees.pop()!;
    await act(async () => {
      tree.unmount();
    });
  }
  jest.useRealTimers();
});

async function flushAsync(withFakeTimers = false) {
  await act(async () => {
    if (withFakeTimers) {
      jest.advanceTimersByTime(0);
    }
    for (let i = 0; i < 10; i += 1) {
      await Promise.resolve();
    }
    if (!withFakeTimers) {
      await new Promise((res) => setTimeout(res, 0));
    }
  });
}

async function render(fakeTimers = false): Promise<RenderedScreen> {
  const r = renderWithProviders(
    <TodayScreen />,
    fakeTimers
      ? { userEventOptions: { advanceTimers: jest.advanceTimersByTime } }
      : undefined,
  );
  mountedTrees.push(r);
  await flushAsync(fakeTimers);
  return r;
}

it('F16 (INT-10): a focus session paused > 30m yields Today hero to due work, while a 5m pause stays first', async () => {
  const { useFocusStore } = jest.requireActual('../../store/focusStore');
  const step = {
    title: 'İlk paragraf',
    minutes: 5,
    parent: { kind: 'task' as const, id: 't1', title: 'Rapor yaz' },
  };

  await act(async () => {
    useFocusStore.setState({
      status: 'paused',
      smallStep: step,
      pausedAt: Date.now() - 31 * 60_000,
      sessionStartedAt: new Date(Date.now() - 40 * 60_000).toISOString(),
    });
  });
  const r1 = await render();
  expect(r1.getAllByLabelText('Başla: Yürüyüş')).toHaveLength(1);
  await act(async () => {
    r1.unmount();
  });

  await act(async () => {
    useFocusStore.setState({
      status: 'paused',
      smallStep: step,
      pausedAt: Date.now() - 5 * 60_000,
      sessionStartedAt: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
  });
  const r2 = await render();
  expect(r2.getAllByLabelText('Devam et: Odak: İlk paragraf')).toHaveLength(1);
  await act(async () => {
    r2.unmount();
    useFocusStore.setState({
      status: 'idle',
      smallStep: null,
      pausedAt: null,
      sessionStartedAt: null,
    });
  });
});

it("a habit on a break is shown in ARADA, not as today's work", async () => {
  const r = await render();
  const t = textOf(r);
  expect(t).toMatch(/ARADA/);
  expect(t).toMatch(/Kitap okuma/);
  expect(r.getAllByLabelText(/^Kitap okuma, arada/)).toHaveLength(1);
  expect(r.queryAllByLabelText('Kitap okuma')).toHaveLength(0);
  expect(r.getAllByLabelText('Yürüyüş')).toHaveLength(1);
});

it('each open task offers to start small; the routine card and holiday link are there', async () => {
  useDisclosureStore.getState().setTool('routine', 'on');
  const r = await render();
  expect(r.getAllByLabelText('Rapor yaz için küçük başla')).toHaveLength(1);
  expect(textOf(r)).toMatch(/RUTİN/);
  expect(
    r.getAllByLabelText('Tatil modu. Birkaç gün bütün alışkanlıklara ara ver.'),
  ).toHaveLength(1);
});

it('during a holiday the TATİL MODU card replaces the link', async () => {
  (globalThis as any).__pauses = [
    { id: 'hol', habit_id: null, kind: 'holiday', start_date: today, end_date: null },
  ];
  const r = await render();
  expect(textOf(r)).toMatch(/TATİL MODU/);
  expect(textOf(r)).toMatch(/Sen bitirene kadar/);
  expect(
    r.queryAllByLabelText('Tatil modu. Birkaç gün bütün alışkanlıklara ara ver.'),
  ).toHaveLength(0);
});

it('R02.04: an unsent journal/note/plan/session change shows on the sync badge', async () => {
  const { coreOutbox } = jest.requireActual(
    '../../services/coreOutbox',
  ) as typeof import('../../services/coreOutbox');
  coreOutbox.reset();
  await coreOutbox.write({
    entity: 'journal_entry',
    entityId: today,
    kind: 'update',
    payload: { content: 'x', mood: null },
    baseVersion: null,
  });
  await coreOutbox.flush();
  const r = await render();
  expect(textOf(r)).toMatch(/1 bekliyor/);
  await act(async () => {
    await coreOutbox.flush();
    coreOutbox.reset();
  });
});

it('R03.01: the dominant action names the one next step; an open focus session takes it over', async () => {
  const { useFocusStore } = jest.requireActual('../../store/focusStore');
  useFocusStore.setState({ status: 'idle', smallStep: null });
  const r1 = await render();
  expect(r1.getAllByLabelText('Başla: Yürüyüş')).toHaveLength(1);
  await act(async () => {
    r1.unmount();
  });

  await act(async () => {
    useFocusStore.setState({
      status: 'paused',
      smallStep: {
        title: 'İlk paragraf',
        minutes: 5,
        parent: { kind: 'task', id: 't1', title: 'Rapor yaz' },
      },
    });
  });
  const r2 = await render();
  expect(r2.getAllByLabelText('Devam et: Odak: İlk paragraf')).toHaveLength(1);
  expect(textOf(r2)).toMatch(/Duraklatıldı — kaldığın yerden devam et/);
  await r2.user.press(r2.getByLabelText('Devam et: Odak: İlk paragraf'));
  expect(mockPush).toHaveBeenCalledWith('/tabs/focus');
  await act(async () => {
    r2.unmount();
    useFocusStore.setState({ status: 'idle', smallStep: null });
  });
});

it('R03.07: the day after a holiday, Today says how to come back', async () => {
  (globalThis as any).__pauses = [
    {
      id: 'hol',
      habit_id: null,
      kind: 'holiday',
      start_date: ymd(addDaysLocal(new Date(), -5)),
      end_date: ymd(addDaysLocal(new Date(), -1)),
    },
  ];
  const r = await render();
  expect(textOf(r)).toMatch(/Aradan döndün\. Hepsini birden değil/);
  await act(async () => {
    r.unmount();
  });
  (globalThis as any).__pauses = [];
  invalidateHabitsFetch();
  const r2 = await render();
  expect(textOf(r2)).not.toMatch(/Aradan döndün/);
});

it('R06.02: ONE dominant action on the hero; the rest one tap away; a short capacity line', async () => {
  const r = await render();
  const heroButtons = r.getAllByRole('button', { name: /^(Başla|Devam et)/ });
  expect(heroButtons).toHaveLength(1);
  for (const old of ['Odağa geç', 'Haftayı değerlendir', 'Denge planı']) {
    expect(r.queryAllByLabelText(old)).toHaveLength(0);
  }
  const more = r.getByLabelText('Diğer');
  await r.user.press(more);
  expect(mockActionSheet).toHaveBeenCalledTimes(1);
  const sheetArg = mockActionSheet.mock.calls[0][0] as {
    title?: string;
    options: { id: string; label: string }[];
  };
  const labels = sheetArg.options.map((o) => o.label);
  expect(labels).toEqual(
    expect.arrayContaining([
      'Odağa geç',
      'Günü kapat',
      'Haftayı değerlendir',
      'Denge planı',
      'Projeler',
      'Notlar',
    ]),
  );
  expect(labels).not.toContain('Vazgeç');
  expect(mockPush).not.toHaveBeenCalled();

  mockActionSheet.mockResolvedValueOnce('notes');
  await r.user.press(more);
  expect(mockPush).toHaveBeenCalledWith('/screens/notes');

  mockPush.mockClear();
  mockActionSheet.mockResolvedValueOnce(null);
  await r.user.press(more);
  expect(mockPush).not.toHaveBeenCalled();

  expect(textOf(r)).toMatch(/1 alışkanlık, 1 görev kaldı/);
});

describe('F29 — calm 3-tap day-close ritual & morning echo on TodayScreen', () => {
  it('(+) completes 3-tap day close (mood + 1 task move + finish), persists record, returns from light-day sheet, and shows calm echo next morning', async () => {
    await AsyncStorage.clear();
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 2, 20, 0, 0));

    const closeDay = '2026-11-02';
    const nextDay = '2026-11-03';
    (globalThis as any).__pauses = [];
    (globalThis as any).__tasks = [
      {
        id: 't-ov1',
        user_id: 'u1',
        title: 'Fatura öde',
        status: 'pending',
        priority: 'high',
        list_type: 'inbox',
        due_date: '2026-10-31',
        completed: false,
        created_at: '2026-10-30T09:00:00Z',
      },
      {
        id: 't-ov2',
        user_id: 'u1',
        title: 'Notları topla',
        status: 'pending',
        priority: 'medium',
        list_type: 'inbox',
        due_date: '2026-11-01',
        completed: false,
        created_at: '2026-10-31T09:00:00Z',
      },
      {
        id: 't-tod',
        user_id: 'u1',
        title: 'Mektup yaz',
        status: 'pending',
        priority: 'low',
        list_type: 'inbox',
        due_date: closeDay,
        completed: false,
        created_at: '2026-11-02T09:00:00Z',
      },
    ];

    const { useTaskStore } = jest.requireActual(
      '../../store/taskStore',
    ) as typeof import('../../store/taskStore');
    const updateSpy = jest.spyOn(useTaskStore.getState(), 'updateTask');

    const r = await render(true);

    expect(textOf(r)).not.toContain('Dün günü kapattın');

    await r.user.press(r.getByLabelText('Günü kapat: akşam kapanış ritüelini başlat'));

    expect(textOf(r)).toContain('Açık kalanlar');
    expect(textOf(r)).toContain('Fatura öde');
    expect(textOf(r)).toContain('Notları topla');
    expect(textOf(r)).toContain('Mektup yaz');

    await r.user.press(
      r.getByLabelText('Kalan ritüelleri cezasız olarak bugünlük kenara koy'),
    );
    await r.user.press(r.getByLabelText('Vazgeç'));
    expect(textOf(r)).toContain('Günü Kapat · Zihinsel Kapanış');

    // Tap 1: mood ("İyi")
    await r.user.press(r.getByRole('radio', { name: 'İyi' }));
    await flushAsync(true);

    // Tap 2: move 1 task to tomorrow
    updateSpy.mockClear();
    await r.user.press(r.getByLabelText('Fatura öde: yarına taşı'));
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith('t-ov1', { due_date: nextDay });

    // Tap 3: finish close
    await r.user.press(r.getByLabelText('Bugünlük bitti, ekranı kapat'));
    await flushAsync(true);

    const savedRaw = await AsyncStorage.getItem('aderyth:day_close:v1:u1');
    expect(savedRaw).not.toBeNull();
    expect(JSON.parse(savedRaw!)).toMatchObject({ date: closeDay, movedCount: 1 });
    expect(useDisclosureStore.getState().firstCloseAt).toBe(closeDay);

    updateSpy.mockRestore();
    await act(async () => {
      r.unmount();
    });

    // Next morning: echo line appears below TodayHero
    jest.setSystemTime(new Date(2026, 10, 3, 9, 0, 0));
    const rMorning = await render(true);
    expect(textOf(rMorning)).toContain('Dün günü kapattın; bir işi bugüne taşıdın.');
  });

  it('(-) omits Açık kalanlar section when no open candidate tasks exist and saves record even when mood is skipped', async () => {
    await AsyncStorage.clear();
    jest.useFakeTimers().setSystemTime(new Date(2026, 10, 2, 20, 0, 0));

    (globalThis as any).__pauses = [];
    (globalThis as any).__tasks = [];
    const { useTaskStore } = jest.requireActual(
      '../../store/taskStore',
    ) as typeof import('../../store/taskStore');
    useTaskStore.setState({ tasks: [] });

    const r = await render(true);

    await r.user.press(r.getByLabelText('Günü kapat: akşam kapanış ritüelini başlat'));

    expect(textOf(r)).not.toContain('Açık kalanlar');

    await r.user.press(r.getByLabelText('Bugünlük bitti, ekranı kapat'));
    await flushAsync(true);

    const savedRaw = await AsyncStorage.getItem('aderyth:day_close:v1:u1');
    expect(savedRaw).not.toBeNull();
    expect(JSON.parse(savedRaw!)).toMatchObject({ date: '2026-11-02', movedCount: 0 });
  });
});
