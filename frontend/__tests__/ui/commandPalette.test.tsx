/**
 * The command palette: mounted, reachable, honest about search states, and
 * wired to item-level deep destinations (F28 NAV-12).
 */
import React from 'react';
import { FlatList, TextInput } from 'react-native';

const mockStoredRecents: { raw: string | null } = { raw: null };

jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => mockStoredRecents.raw,
  setItem: async (_k: string, v: string) => {
    mockStoredRecents.raw = v;
  },
}));

const mockPush = jest.fn();
const mockNavigate = jest.fn();
const mockRouter = { push: mockPush, navigate: mockNavigate };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
}));

const mockSearch = jest.fn();
jest.mock('../../services/searchService', () => ({
  searchEverything: (...a: unknown[]) => mockSearch(...a),
}));

const mockHabitState = { habits: [], fetchHabits: jest.fn() };
const mockTaskState = { tasks: [], fetchTasks: jest.fn() };
const mockNoteState = { notes: [], fetchNotes: jest.fn() };
const mockProjectState = { projects: [], fetchProjects: jest.fn() };
const mockJournalState = { fetchEntries: jest.fn() };
const mockDrawerState = { open: jest.fn() };

jest.mock('../../store/habitStore', () => ({
  useHabitStore: (sel?: (s: unknown) => unknown) => (sel ? sel(mockHabitState) : mockHabitState),
}));
jest.mock('../../store/taskStore', () => ({
  useTaskStore: (sel?: (s: unknown) => unknown) => (sel ? sel(mockTaskState) : mockTaskState),
}));
jest.mock('../../store/noteStore', () => ({
  useNoteStore: (sel?: (s: unknown) => unknown) => (sel ? sel(mockNoteState) : mockNoteState),
}));
jest.mock('../../store/projectStore', () => ({
  useProjectStore: (sel?: (s: unknown) => unknown) =>
    sel ? sel(mockProjectState) : mockProjectState,
}));
jest.mock('../../store/journalStore', () => ({
  useJournalStore: (sel?: (s: unknown) => unknown) =>
    sel ? sel(mockJournalState) : mockJournalState,
}));
jest.mock('../../store/drawerStore', () => ({
  useDrawerStore: (sel?: (s: unknown) => unknown) => (sel ? sel(mockDrawerState) : mockDrawerState),
}));

import CommandPalette from '../../components/CommandPalette';
import { routeKeyOf, type DestinationHref } from '../../lib/destinations';
import { useCommandStore } from '../../store/commandStore';
import {
  act,
  fireEvent,
  renderWithProviders,
  type RenderedScreen,
} from '../helpers/renderWithProviders';

jest.setTimeout(30_000);
jest.useFakeTimers();

const mounted: RenderedScreen[] = [];

async function render(): Promise<RenderedScreen> {
  const tree = renderWithProviders(<CommandPalette />, {
    userEventOptions: { advanceTimers: jest.advanceTimersByTime },
  });
  await act(async () => {});
  mounted.push(tree);
  return tree;
}

afterEach(async () => {
  await act(async () => {
    mounted.splice(0).forEach((t) => t.unmount());
  });
  useCommandStore.setState({ visible: false, pendingIntent: null });
  mockStoredRecents.raw = null;
  mockPush.mockReset();
  mockNavigate.mockReset();
  mockSearch.mockReset();
});

function textOf(tree: RenderedScreen): string {
  const out: string[] = [];
  const walk = (n: any): void => {
    if (n == null) return;
    if (typeof n === 'string') {
      out.push(n);
      return;
    }
    if (Array.isArray(n)) {
      n.forEach(walk);
      return;
    }
    (n.children ?? []).forEach(walk);
  };
  walk(tree.toJSON());
  return out.join(' ');
}

async function type(tree: RenderedScreen, q: string) {
  const input = tree.UNSAFE_getAllByType(TextInput)[0];
  await act(async () => {
    fireEvent.changeText(input, q);
  });
}

async function settleDebounce() {
  await act(async () => {
    jest.advanceTimersByTime(300);
  });
}

type Row = {
  type: string;
  id?: string;
  label?: string;
  a11yLabel?: string;
  target?: DestinationHref | string;
};

function rows(tree: RenderedScreen): Row[] {
  return tree.UNSAFE_getAllByType(FlatList)[0].props.data as Row[];
}

function renderRowElement(tree: RenderedScreen, label: string) {
  const list = tree.UNSAFE_getAllByType(FlatList)[0];
  const item = (list.props.data as Row[]).find((r) => r.label === label);
  if (!item) throw new Error(`no row labelled ${JSON.stringify(label)}`);
  return list.props.renderItem({ item, index: 0, separators: undefined });
}

async function pressRow(tree: RenderedScreen, label: string) {
  const element = renderRowElement(tree, label);
  await act(async () => {
    element.props.onPress();
  });
}

const EMPTY = { tasks: [], habits: [], notes: [], projects: [], journal: [], failed: [] };

async function open() {
  await act(async () => {
    useCommandStore.getState().open();
  });
}

describe('AC-P00 the palette is rendered by the store flag', () => {
  it('is closed until something opens it, then shows the search field', async () => {
    const tree = await render();
    expect(textOf(tree)).not.toContain('Hızlı Eylemler');

    await open();
    expect(textOf(tree)).toContain('Hızlı Eylemler');
  });
});

describe('AC-P01/02/03/04 the three terminal states are distinct', () => {
  it('says it is searching while the request is in flight', async () => {
    mockSearch.mockImplementation(() => new Promise(() => {}));
    const tree = await render();
    await open();
    await type(tree, 'zzzz-nothing-matches');

    const shown = textOf(tree);
    expect(shown).toContain('Aranıyor');
    expect(shown).not.toContain('Sonuç yok');
  });

  it('says there are no results only after the search answered', async () => {
    mockSearch.mockResolvedValue(EMPTY);
    const tree = await render();
    await open();
    await type(tree, 'zzzz-nothing-matches');
    await settleDebounce();

    const shown = textOf(tree);
    expect(shown).toContain('Sonuç yok');
    expect(shown).not.toContain('Aranıyor');
  });

  it('reports a failure instead of pretending there was nothing', async () => {
    mockSearch.mockResolvedValue({
      ...EMPTY,
      failed: ['tasks', 'habits', 'notes', 'projects', 'journal'],
    });
    const tree = await render();
    await open();
    await type(tree, 'zzzz-nothing-matches');
    await settleDebounce();

    const shown = textOf(tree);
    expect(shown).toContain('Arama şu anda yapılamadı');
    expect(shown).not.toContain('Sonuç yok');
  });

  it('shows what it found AND warns when only some sources failed', async () => {
    mockSearch.mockResolvedValue({
      ...EMPTY,
      notes: [{ id: 'n1', title: 'Bulunan not' }],
      failed: ['tasks', 'journal'],
    });
    const tree = await render();
    await open();
    await type(tree, 'not');
    await settleDebounce();

    const shown = textOf(tree);
    expect(shown).toContain('Bulunan not');
    expect(shown).toContain('Bazı kaynaklar yanıt vermedi');
    expect(shown).toContain('tasks');
  });
});

describe('AC-P05 results are grouped and point to item-level deep destinations (F28 NAV-12)', () => {
  it('(+) groups all 5 sources, prefixes accessibilityLabel with item kind, and never routes to bare list paths (-)', async () => {
    mockSearch.mockResolvedValue({
      tasks: [{ id: 't1', title: 'Görev A' }],
      habits: [{ id: 'h1', name: 'Alışkanlık A', icon: null, color: null }],
      notes: [{ id: 'n1', title: 'Not A' }],
      projects: [{ id: 'p1', name: 'Proje A' }],
      journal: [{ id: 'j1', date: '2026-02-01', content: 'Günlük  metni  burada' }],
      failed: [],
    });
    const tree = await render();
    await open();
    await type(tree, 'a');
    await settleDebounce();

    const allRows = rows(tree);
    const sections = allRows.filter((r) => r.type === 'section').map((r) => r.label);
    expect(sections).toEqual(
      expect.arrayContaining(['Görevler', 'Notlar', 'Projeler', 'Alışkanlıklar', 'Günlük']),
    );

    const journalRow = allRows.find((r) => r.id === 'j:j1');
    expect(journalRow?.label).toBe('2026-02-01 — Günlük metni burada');
    expect(journalRow?.target).toEqual({
      pathname: '/screens/journal-reader',
      params: { date: '2026-02-01' },
    });

    // (-) Negative: no search result row points to bare list routes without focus/id/date
    const resultRows = allRows.filter((r) => r.type === 'go');
    expect(resultRows).toHaveLength(5);
    for (const r of resultRows) {
      const key = r.target ? routeKeyOf(r.target) : '';
      expect(key).not.toBe('/tabs/tasks');
      expect(key).not.toBe('/screens/notes');
      expect(key).not.toBe('/screens/projects');
      expect(key).not.toBe('/screens/journal');
      expect(key).not.toBe('/tabs/timeline');
    }

    // Screen reader label announces the item kind
    const taskEl = renderRowElement(tree, 'Görev A');
    expect(taskEl.props.accessibilityLabel).toBe('Görev: Görev A');
  });

  it('(+) tapping habit, journal, task, note, and project results navigates to their exact item deep links', async () => {
    const fixture = {
      tasks: [{ id: 't42', title: 'Görev 42' }],
      habits: [{ id: 'h42', name: 'Alışkanlık 42', icon: null, color: null }],
      notes: [{ id: 'n42', title: 'Not 42' }],
      projects: [{ id: 'p42', name: 'Proje 42' }],
      journal: [{ id: 'j42', date: '2026-03-15', content: 'Mart günlüğü' }],
      failed: [],
    };
    mockSearch.mockResolvedValue(fixture);
    const tree = await render();

    // Habit -> /screens/habit-detail?id=h42
    await open();
    await type(tree, '42');
    await settleDebounce();
    await pressRow(tree, 'Alışkanlık 42');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/screens/habit-detail',
      params: { id: 'h42' },
    });
    expect(useCommandStore.getState().visible).toBe(false);

    // Journal -> /screens/journal-reader?date=2026-03-15
    mockPush.mockReset();
    await open();
    await type(tree, 'Mart');
    await settleDebounce();
    await pressRow(tree, '2026-03-15 — Mart günlüğü');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/screens/journal-reader',
      params: { date: '2026-03-15' },
    });

    // Note -> /screens/notes?focus=n42
    mockPush.mockReset();
    await open();
    await type(tree, '42');
    await settleDebounce();
    await pressRow(tree, 'Not 42');
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/screens/notes',
      params: { focus: 'n42' },
    });

    // Task -> /tabs/plan?tab=tasks&focus=t42 via router.navigate
    mockNavigate.mockReset();
    await open();
    await type(tree, '42');
    await settleDebounce();
    await pressRow(tree, 'Görev 42');
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/tabs/plan',
      params: { tab: 'tasks', focus: 't42' },
    });

    // Project -> /tabs/plan?tab=projects&focus=p42 via router.navigate
    mockNavigate.mockReset();
    await open();
    await type(tree, '42');
    await settleDebounce();
    await pressRow(tree, 'Proje 42');
    expect(mockNavigate).toHaveBeenCalledWith({
      pathname: '/tabs/plan',
      params: { tab: 'projects', focus: 'p42' },
    });
  });
});

describe('AC-P06 backward-compatible recents migration', () => {
  it('(+) legacy string-only recent entries ({ route }) still render and navigate cleanly', async () => {
    mockStoredRecents.raw = JSON.stringify([
      {
        label: 'Eski Notlar Kısayolu',
        icon: 'document-text-outline',
        color: '#888888',
        route: '/screens/notes',
      },
    ]);
    mockSearch.mockResolvedValue(EMPTY);
    const tree = await render();
    await open();

    expect(rows(tree).some((r) => r.label === 'Eski Notlar Kısayolu')).toBe(true);
    await pressRow(tree, 'Eski Notlar Kısayolu');
    expect(mockPush).toHaveBeenCalledWith('/screens/notes');
  });
});

describe('AC-P07 no quick action is a no-op', () => {
  it('every quick action either navigates or records an intent (/tabs/timeline for both habit intents)', async () => {
    mockSearch.mockResolvedValue(EMPTY);
    const tree = await render();
    await open();

    for (const [label, pathname, intent] of [
      ['Yeni alışkanlık ekle', '/tabs/timeline', 'new-habit'],
      ['AI Rutin oluştur', '/tabs/timeline', 'ai-routine'],
    ] as const) {
      mockNavigate.mockReset();
      await act(async () => {
        useCommandStore.getState().open();
      });
      expect(rows(tree).some((r) => r.label === label)).toBe(true);

      await pressRow(tree, label);
      expect(mockNavigate).toHaveBeenCalledWith(pathname);
      expect(useCommandStore.getState().pendingIntent).toBe(intent);
      useCommandStore.setState({ pendingIntent: null });
    }
  });

  it('consumeIntent clears, so a modal cannot reopen on a later render', () => {
    useCommandStore.getState().requestIntent('new-habit');
    expect(useCommandStore.getState().consumeIntent()).toBe('new-habit');
    expect(useCommandStore.getState().consumeIntent()).toBeNull();
  });
});
