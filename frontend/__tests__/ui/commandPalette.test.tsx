/**
 * The command palette: mounted, reachable, and honest about what it is doing.
 *
 * ## What was broken
 *
 * `app/tabs/_layout.tsx` renders a "Komut veya ara ⌘K" pill in the header of
 * every tab. Tapping it called `useCommandStore.open()`, which set
 * `visible: true` — a flag whose only reader, `components/CommandPalette.tsx`,
 * was imported by nothing. The palette existed, the button existed, and no
 * file connected them, so the search affordance on every screen did nothing
 * at all. Nothing failed; there was simply no palette.
 *
 * ## Three states that used to be one sentence
 *
 * Search is debounced 220 ms and then goes to the server. Until it answers,
 * the list had no rows and rendered "Sonuç yok" — the same words it shows
 * when the search genuinely found nothing. And `searchEverything` swallowed
 * per-source failures, so a total outage also produced empty arrays and
 * therefore also read as "Sonuç yok". Three different situations, one
 * sentence, two of them false.
 *
 * AC-P00  the palette renders when the store says visible (and not before)
 * AC-P01  in flight → "Aranıyor…", never "Sonuç yok"
 * AC-P02  answered with nothing → "Sonuç yok"
 * AC-P03  every source failed → an error, not an absence
 * AC-P04  some sources failed → results shown WITH a partial warning
 * AC-P05  results are grouped per source, journal included
 * AC-P06  tapping a result navigates and closes
 * AC-P07  no quick action is a no-op
 */
import React from 'react';
import { FlatList, TextInput } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('expo-blur', () => ({ BlurView: 'BlurView' }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async () => null,
  setItem: async () => undefined,
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

const mockSearch = jest.fn();
jest.mock('../../services/searchService', () => ({
  searchEverything: (...a: unknown[]) => mockSearch(...a),
}));

// The four stores the palette reads for its instant local answer, plus the
// journal store it primes. Static data and no-op fetches: this file is about
// the palette, not about whether a store can load.
jest.mock('../../store/habitStore', () => ({
  useHabitStore: Object.assign(
    (sel?: (s: unknown) => unknown) => {
      const s = { habits: [], fetchHabits: jest.fn() };
      return sel ? sel(s) : s;
    },
    {},
  ),
}));
jest.mock('../../store/taskStore', () => ({
  useTaskStore: () => ({ tasks: [], fetchTasks: jest.fn() }),
}));
jest.mock('../../store/noteStore', () => ({
  useNoteStore: () => ({ notes: [], fetchNotes: jest.fn() }),
}));
jest.mock('../../store/projectStore', () => ({
  useProjectStore: () => ({ projects: [], fetchProjects: jest.fn() }),
}));
jest.mock('../../store/journalStore', () => ({
  useJournalStore: (sel?: (s: unknown) => unknown) => {
    const s = { fetchEntries: jest.fn() };
    return sel ? sel(s) : s;
  },
}));
jest.mock('../../store/drawerStore', () => ({
  useDrawerStore: (sel?: (s: unknown) => unknown) => {
    const s = { open: jest.fn() };
    return sel ? sel(s) : s;
  },
}));

import CommandPalette from '../../components/CommandPalette';
import { useCommandStore } from '../../store/commandStore';

type Json = TestRenderer.ReactTestRendererJSON;

jest.setTimeout(30_000);
jest.useFakeTimers();

const mounted: TestRenderer.ReactTestRenderer[] = [];

async function render(): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(<CommandPalette />); });
  mounted.push(tree);
  return tree;
}

afterEach(async () => {
  await act(async () => { mounted.splice(0).forEach((t) => t.unmount()); });
  useCommandStore.setState({ visible: false, pendingIntent: null });
  mockPush.mockReset();
  mockSearch.mockReset();
});

function textOf(tree: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: Json | string | null): void => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    (n.children ?? []).forEach(walk);
  };
  const json = tree.toJSON();
  (Array.isArray(json) ? json : [json]).forEach(walk);
  return out.join(' ');
}

/** Types into the palette's single TextInput and lets the debounce fire. */
async function type(tree: TestRenderer.ReactTestRenderer, q: string) {
  const input = tree.root.findAllByType(TextInput)[0];
  await act(async () => { input.props.onChangeText(q); });
}

async function settleDebounce() {
  await act(async () => { jest.advanceTimersByTime(300); });
}

type Row = { type: string; id?: string; label?: string; route?: string };

/**
 * The list's own data model, read off the `FlatList`.
 *
 * NOT the rendered text. `FlatList` virtualizes: with the default
 * `initialNumToRender` it mounts about ten rows and leaves the rest
 * unrendered, so a text scan reported the later sections — projects, habits,
 * journal — as missing when the component had produced them correctly. That
 * is React Native's windowing, not a defect in the palette, and asserting
 * against it would have made this file fail for a reason it is not about.
 *
 * `data` is what the component decided to show; `renderItem` is how it shows
 * one. Both are exercised here, so a row that renders wrongly is still caught
 * — see `pressRow`.
 */
function rows(tree: TestRenderer.ReactTestRenderer): Row[] {
  return tree.root.findAllByType(FlatList)[0].props.data as Row[];
}

/** Invokes the real `renderItem` for a row and presses what it produced. */
async function pressRow(tree: TestRenderer.ReactTestRenderer, label: string) {
  const list = tree.root.findAllByType(FlatList)[0];
  const item = (list.props.data as Row[]).find((r) => r.label === label);
  if (!item) throw new Error(`no row labelled ${JSON.stringify(label)}`);
  const element = list.props.renderItem({ item, index: 0, separators: undefined });
  await act(async () => { element.props.onPress(); });
}

const EMPTY = { tasks: [], habits: [], notes: [], projects: [], journal: [], failed: [] };

async function open() {
  await act(async () => { useCommandStore.getState().open(); });
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
    mockSearch.mockImplementation(() => new Promise(() => {}));  // never resolves
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
      ...EMPTY, failed: ['tasks', 'habits', 'notes', 'projects', 'journal'],
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

describe('AC-P05 results are grouped, journal included', () => {
  it('renders a section per source that returned something', async () => {
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

    const sections = rows(tree).filter((r) => r.type === 'section').map((r) => r.label);
    expect(sections).toEqual(
      expect.arrayContaining(['Görevler', 'Notlar', 'Projeler', 'Alışkanlıklar', 'Günlük']),
    );
    // Journal rows are labelled by date plus a whitespace-collapsed excerpt.
    const journalRow = rows(tree).find((r) => r.id === 'j:j1');
    expect(journalRow?.label).toBe('2026-02-01 — Günlük metni burada');
    expect(journalRow?.route).toBe('/screens/journal');
  });
});

describe('AC-P06 a result navigates and closes the palette', () => {
  it('pushes the route and dismisses', async () => {
    mockSearch.mockResolvedValue({ ...EMPTY, notes: [{ id: 'n1', title: 'Not A' }] });
    const tree = await render();
    await open();
    await type(tree, 'not');
    await settleDebounce();

    await pressRow(tree, 'Not A');
    expect(mockPush).toHaveBeenCalledWith('/screens/notes');
    expect(useCommandStore.getState().visible).toBe(false);
  });
});

describe('AC-P07 no quick action is a no-op', () => {
  it('every quick action either navigates or records an intent', async () => {
    mockSearch.mockResolvedValue(EMPTY);
    const tree = await render();
    await open();

    // The two that used to be optional callbacks — and therefore silently
    // did nothing once the palette was mounted by the layout instead of by
    // the screen owning the modal.
    for (const [label, route, intent] of [
      ['Yeni alışkanlık ekle', '/tabs/timeline', 'new-habit'],
      ['AI Rutin oluştur', '/tabs/habits', 'ai-routine'],
    ] as const) {
      mockPush.mockReset();
      await act(async () => { useCommandStore.getState().open(); });
      // Present in the list at all — a quick action that stopped rendering
      // would be a different kind of no-op.
      expect(rows(tree).some((r) => r.label === label)).toBe(true);

      await pressRow(tree, label);
      expect(mockPush).toHaveBeenCalledWith(route);
      // The intent survives the navigation for the destination to consume.
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
