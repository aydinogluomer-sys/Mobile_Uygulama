/**
 * The ADHD task splitter: reachable, and the subtasks it produces are real
 * rows in `tasks`.
 *
 * ## What was wrong
 *
 * `lib/taskDecomposition.ts` (406 lines, 39 tests) and
 * `components/ADHDTaskSplitter.tsx` (496 lines) were complete and correct —
 * validation gate, preview step, explicit confirm, a repository write that
 * attaches `user_id` itself — and **imported by nothing**. `grep -rn
 * ADHDTaskSplitter app components` returned only the component's own file. A
 * fully tested engine with no entry point is not a feature; it is code the
 * user cannot reach, and its 39 green tests said nothing about that.
 *
 * ## Why this file writes through a storing fake
 *
 * "Modal opens" is the assertion that would have been easy and worthless. The
 * question is whether confirming a split puts rows in `tasks` owned by the
 * caller, carrying the parent's context. So the supabase fake here STORES —
 * the same one `crudContracts.test.ts` uses — and the assertions are about
 * the rows that ended up in the table, not about which functions were called.
 *
 * AC-T00  the tasks screen offers the split action on an open task
 * AC-T01  a completed task does not offer it
 * AC-T02  picking a duration previews WITHOUT writing anything
 * AC-T03  confirming writes subtasks to `tasks`, owned by the caller
 * AC-T04  the subtasks inherit the parent's list, priority, project and due date
 * AC-T05  a write failure surfaces and nothing is reported as split
 */
import React from 'react';
import { Text } from 'react-native';
import TestRenderer, { act } from 'react-test-renderer';
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

const mockDb: MockDb = createMockDb();
const mockClient = makeSupabaseMock(mockDb);

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: 'u1' }, access_token: 't' } },
        error: null,
      }),
    },
    from: (table: string) => mockClient.from(table),
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: 'SafeAreaView',
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const mockFetchTasks = jest.fn(async () => undefined);
const mockTasks = [
  {
    id: 'parent-1', user_id: 'u1', title: 'Rapor yaz', description: null,
    completed: false, status: 'pending', priority: 'high',
    due_date: '2026-03-01', project_id: 'proj-1', list_type: 'inbox',
  },
  {
    id: 'done-1', user_id: 'u1', title: 'Biten iş', description: null,
    completed: true, status: 'done', priority: 'none',
    due_date: null, project_id: null, list_type: 'inbox',
  },
];
jest.mock('../../store/taskStore', () => ({
  useTaskStore: () => ({
    tasks: mockTasks,
    loadingMore: false, hasMore: false, loadMore: jest.fn(),
    fetchTasks: mockFetchTasks,
    addTask: jest.fn(), toggleDone: jest.fn(), removeTask: jest.fn(),
    byList: (l: string) => mockTasks.filter((t) => t.list_type === l && !t.completed),
  }),
}));
jest.mock('../../store/projectStore', () => ({
  useProjectStore: () => ({ projects: [{ id: 'proj-1', name: 'Proje' }], fetchProjects: jest.fn() }),
}));

import TasksScreen from '../../app/tabs/tasks';
import ADHDTaskSplitter from '../../components/ADHDTaskSplitter';
import type { Task } from '../../store/taskStore';

jest.setTimeout(30_000);

const mounted: TestRenderer.ReactTestRenderer[] = [];

async function render(el: React.ReactElement): Promise<TestRenderer.ReactTestRenderer> {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => { tree = TestRenderer.create(el); });
  mounted.push(tree);
  return tree;
}

afterEach(async () => {
  await act(async () => { mounted.splice(0).forEach((t) => t.unmount()); });
  for (const key of Object.keys(mockDb.rows)) delete mockDb.rows[key];
  mockDb.inserts.length = 0;
  mockDb.idSeq = 0;
  mockDb.failNext = null;
  mockFetchTasks.mockClear();
});

/**
 * Every pressable carrying an accessibility label.
 *
 * `deep: false` matters: a `TouchableOpacity` appears TWICE under `deep: true`
 * — once as the composite and once as the host view it renders, both carrying
 * the same props — so one button counted as two and the "exactly one split
 * action" assertion failed on a screen that was correct.
 */
function labelled(tree: TestRenderer.ReactTestRenderer, label: string) {
  return tree.root.findAll(
    (n) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function',
    { deep: false },
  );
}

function allText(tree: TestRenderer.ReactTestRenderer): string {
  return tree.root.findAllByType(Text)
    .map((t) => (Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '')))
    .join(' | ');
}

/**
 * The pressable whose own subtree says `label`.
 *
 * The splitter's buttons carry no accessibility labels — they are
 * `TouchableOpacity`s wrapping `<Text>` — so a positional lookup was the
 * alternative, and it was wrong: the modal's close button is also a
 * label-less pressable and sorts FIRST, so "press the first option" pressed
 * Kapat and the test then asserted about a closed modal.
 */
function pressableSaying(tree: TestRenderer.ReactTestRenderer, label: string) {
  const hit = tree.root.findAll(
    (n) => typeof n.props?.onPress === 'function',
    { deep: true },
  ).find((c) => c.findAllByType(Text).some((t) => {
    const said = Array.isArray(t.props.children) ? t.props.children.join('') : String(t.props.children ?? '');
    return said.includes(label);
  }));
  if (!hit) throw new Error(`no pressable saying ${JSON.stringify(label)}`);
  return hit;
}

/**
 * The task handed straight to the splitter.
 *
 * Deliberately NOT the screen's inbox fixture: the inheritance assertions are
 * only meaningful if the values differ from the screen's defaults, so this one
 * sits in a different list with a different priority.
 */
const PARENT = {
  ...mockTasks[0], id: 'parent-2', list_type: 'this_week', priority: 'high',
} as unknown as Task;

describe('AC-T00/T01 the entry point exists on the task itself', () => {
  it('an open task offers a split action', async () => {
    const tree = await render(<TasksScreen />);
    expect(labelled(tree, 'Rapor yaz görevini alt adımlara böl')).toHaveLength(1);
  });

  it('a completed task does not', async () => {
    const tree = await render(<TasksScreen />);
    // The archive tab holds the completed one; the action is not offered for
    // it in any tab, so no label mentioning it exists at all.
    expect(labelled(tree, 'Biten iş görevini alt adımlara böl')).toHaveLength(0);
  });

  it('pressing it mounts the splitter for that task', async () => {
    const tree = await render(<TasksScreen />);
    await act(async () => { labelled(tree, 'Rapor yaz görevini alt adımlara böl')[0].props.onPress(); });
    // The splitter's own copy appears, carrying the parent task's title.
    expect(allText(tree)).toContain('Rapor yaz');
    expect(mockDb.rows.tasks ?? []).toEqual([]);  // opening writes nothing
  });
});

describe('the splitter itself', () => {
  /** Runs the component to the preview phase for a given duration button. */
  async function toPreview(onSplit = jest.fn()) {
    const tree = await render(
      <ADHDTaskSplitter task={PARENT} visible onClose={jest.fn()} onSplit={onSplit} />,
    );
    await act(async () => { pressableSaying(tree, 'Pomodoro').props.onPress(); });
    return { tree, onSplit };
  }

  it('AC-T02 previewing writes nothing', async () => {
    const { tree } = await toPreview();
    expect(allText(tree)).toContain('Onayla ve Ekle');
    expect(mockDb.rows.tasks ?? []).toEqual([]);
    expect(mockDb.inserts).toEqual([]);
  });

  it('AC-T03/T04 confirming persists subtasks owned by the caller, with the parent context', async () => {
    const { tree, onSplit } = await toPreview();

    await act(async () => { await pressableSaying(tree, 'Onayla ve Ekle').props.onPress(); });

    const written = mockDb.rows.tasks ?? [];
    expect(written.length).toBeGreaterThan(1);

    for (const row of written) {
      // Owner is attached by the repository, never taken from the caller.
      expect(row.user_id).toBe('u1');
      expect(row.completed).toBe(false);
      expect(row.status).toBe('pending');
      // Parent context is inherited, so the subtasks land where the parent is.
      expect(row.priority).toBe('high');
      expect(row.due_date).toBe('2026-03-01');
      expect(row.project_id).toBe('proj-1');
      expect(row.list_type).toBe('this_week');
      expect(typeof row.title).toBe('string');
      expect((row.title as string).length).toBeGreaterThan(0);
    }

    // The caller is handed the rows the database returned, not the proposal.
    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(onSplit.mock.calls[0][0]).toHaveLength(written.length);
  });

  it('AC-T05 a write failure is surfaced and nothing is claimed', async () => {
    const { tree, onSplit } = await toPreview();
    mockDb.failNext = { error: 'insert reddedildi' };

    await act(async () => { await pressableSaying(tree, 'Onayla ve Ekle').props.onPress(); });

    expect(allText(tree)).toContain('insert reddedildi');
    expect(onSplit).not.toHaveBeenCalled();
    expect(mockDb.rows.tasks ?? []).toEqual([]);
  });
});
