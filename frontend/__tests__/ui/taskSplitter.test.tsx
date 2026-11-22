/**
 * The ADHD task splitter: reachable, and the subtasks it produces are real
 * rows in `tasks` linked to their parent (`parent_task_id`, `is_subtask: true`).
 *
 * AC-T00  the tasks screen offers the split action on an open task
 * AC-T01  a completed task does not offer it
 * AC-T02  picking a duration previews WITHOUT writing anything
 * AC-T03  confirming writes subtasks to `tasks`, owned by the caller
 * AC-T04  the subtasks inherit the parent's list, priority, project, due date, and parent_task_id
 * AC-T05  a write failure surfaces and nothing is reported as split
 * AC-T06  archiveParent toggle (default ON) forwards { archiveParent } and archives parent in TasksScreen
 */
import React from 'react';
import { Switch, Text } from 'react-native';
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
const mockArchiveTask = jest.fn(async () => undefined);
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
    archiveTask: mockArchiveTask,
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
  mockArchiveTask.mockClear();
});

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
    expect(labelled(tree, 'Biten iş görevini alt adımlara böl')).toHaveLength(0);
  });

  it('pressing it mounts the splitter and confirming with default archiveParent archives the parent task', async () => {
    const tree = await render(<TasksScreen />);
    await act(async () => { labelled(tree, 'Rapor yaz görevini alt adımlara böl')[0].props.onPress(); });
    expect(allText(tree)).toContain('Rapor yaz');
    expect(mockDb.rows.tasks ?? []).toEqual([]);

    await act(async () => { pressableSaying(tree, 'Pomodoro').props.onPress(); });
    await act(async () => { await pressableSaying(tree, 'Onayla ve Ekle').props.onPress(); });

    expect(mockArchiveTask).toHaveBeenCalledWith('parent-1');
    expect(mockFetchTasks).toHaveBeenCalled();
  });
});

describe('the splitter itself', () => {
  async function toPreview(onSplit = jest.fn(), taskOverride: Task = PARENT) {
    const tree = await render(
      <ADHDTaskSplitter task={taskOverride} visible onClose={jest.fn()} onSplit={onSplit} />,
    );
    await act(async () => { pressableSaying(tree, 'Pomodoro').props.onPress(); });
    return { tree, onSplit };
  }

  it('AC-T02 previewing writes nothing, including on 140+ char parent titles', async () => {
    const longTask = {
      ...PARENT,
      title: `${'Uzun kapsamlı dönem sonu değerlendirme raporu '.repeat(4)}hazırla`,
    } as unknown as Task;
    const { tree } = await toPreview(jest.fn(), longTask);
    expect(allText(tree)).toContain('Onayla ve Ekle');
    expect(mockDb.rows.tasks ?? []).toEqual([]);
    expect(mockDb.inserts).toEqual([]);
  });

  it('AC-T03/T04/T06 confirming persists subtasks with parent_task_id + is_subtask and passes archiveParent=true by default', async () => {
    const { tree, onSplit } = await toPreview();

    await act(async () => { await pressableSaying(tree, 'Onayla ve Ekle').props.onPress(); });

    const written = mockDb.rows.tasks ?? [];
    expect(written.length).toBeGreaterThan(1);

    for (const row of written) {
      expect(row.user_id).toBe('u1');
      expect(row.completed).toBe(false);
      expect(row.status).toBe('pending');
      expect(row.priority).toBe('high');
      expect(row.due_date).toBe('2026-03-01');
      expect(row.project_id).toBe('proj-1');
      expect(row.list_type).toBe('this_week');
      expect(row.parent_task_id).toBe('parent-2');
      expect(row.is_subtask).toBe(true);
      expect(typeof row.title).toBe('string');
      expect((row.title as string).length).toBeGreaterThan(0);
    }

    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(onSplit.mock.calls[0][0]).toHaveLength(written.length);
    expect(onSplit.mock.calls[0][1]).toEqual({ archiveParent: true });
    expect(allText(tree)).toContain('Ana görev arşive alındı; adımlar listende.');
  });

  it('AC-T06 toggling archiveParent Switch OFF passes { archiveParent: false }', async () => {
    const { tree, onSplit } = await toPreview();
    const sw = tree.root.findByType(Switch);
    expect(sw.props.value).toBe(true);

    await act(async () => {
      sw.props.onValueChange(false);
    });
    await act(async () => {
      await pressableSaying(tree, 'Onayla ve Ekle').props.onPress();
    });

    expect(onSplit).toHaveBeenCalledTimes(1);
    expect(onSplit.mock.calls[0][1]).toEqual({ archiveParent: false });
    expect(allText(tree)).toContain('Adımlar ana görevin yanında duruyor.');
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
