import { emptyOutbox, type DeliveryOutcome, type OutboxCommand, type OutboxState } from '../../lib/outbox';

const mockUser = { id: 'u-cascade' };
jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => mockUser),
}));

const mockDeliveredOrder: string[] = [];
let mockHoldDelivery = false;
let mockServerGoneIds = new Set<string>();

jest.mock('../../services/taskService', () => {
  const actual = jest.requireActual('../../services/taskService');
  return {
    ...actual,
    deliverTaskCommand: jest.fn(async (cmd: OutboxCommand): Promise<DeliveryOutcome> => {
      if (mockHoldDelivery) return { kind: 'offline' };
      mockDeliveredOrder.push(`${cmd.kind}:${cmd.entityId}`);
      if (cmd.kind === 'delete' && mockServerGoneIds.has(cmd.entityId)) {
        // Row already absent on server still counts as applied (deleteTaskIfPresent contract)
        return { kind: 'applied' };
      }
      return { kind: 'applied' };
    }),
  };
});

import { setTaskOutboxStorage, useTaskStore, type Task } from '../../store/taskStore';

function makeTask(id: string, parent_task_id: string | null = null): Task {
  return {
    id,
    user_id: mockUser.id,
    title: `Görev ${id}`,
    status: 'pending',
    priority: 'medium',
    list_type: 'inbox',
    completed: false,
    parent_task_id,
    is_subtask: parent_task_id !== null,
    created_at: '2026-11-04T10:00:00.000Z',
    updated_at: '2026-11-04T10:00:00.000Z',
  };
}

let persisted: Record<string, OutboxState> = {};

beforeEach(() => {
  mockDeliveredOrder.length = 0;
  mockHoldDelivery = false;
  mockServerGoneIds = new Set();
  persisted = {};
  setTaskOutboxStorage({
    load: async (uid) => persisted[uid] ?? emptyOutbox(uid),
    save: async (state) => {
      persisted[state.userId] = state;
    },
  });
  useTaskStore.getState().resetForAccount();
});

describe('taskStore.removeTask — child subtask cascade through outbox', () => {
  it('(+) enqueues child deletes strictly before parent delete (seq & delivery order) and removes all three locally', async () => {
    mockHoldDelivery = true; // Inspect queued outbox commands before online flush settles them
    useTaskStore.setState({
      tasks: [
        makeTask('parent-1'),
        makeTask('child-1', 'parent-1'),
        makeTask('child-2', 'parent-1'),
        makeTask('other-child', 'parent-2'),
      ],
    });

    await useTaskStore.getState().removeTask('parent-1');

    // Local state drops parent + its two children immediately, leaving unrelated child untouched
    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(['other-child']);

    const cmds = useTaskStore.getState().outbox?.commands ?? [];
    expect(cmds).toHaveLength(3);
    const c1 = cmds.find((c) => c.entityId === 'child-1')!;
    const c2 = cmds.find((c) => c.entityId === 'child-2')!;
    const p1 = cmds.find((c) => c.entityId === 'parent-1')!;
    expect(c1.seq).toBeLessThan(p1.seq);
    expect(c2.seq).toBeLessThan(p1.seq);
    expect(p1.dependsOn).toEqual(expect.arrayContaining([c1.operationId, c2.operationId]));

    // Come back online -> children are delivered strictly before parent
    mockHoldDelivery = false;
    mockDeliveredOrder.length = 0;
    await useTaskStore.getState().flush();
    expect(mockDeliveredOrder).toEqual(['delete:child-1', 'delete:child-2', 'delete:parent-1']);
    expect(useTaskStore.getState().outbox?.commands).toEqual([]);
  });

  it('(-) childless task produces a single delete command; already-deleted child on server settles cleanly as applied', async () => {
    mockHoldDelivery = true;
    useTaskStore.setState({ tasks: [makeTask('solo-1'), makeTask('other-parent')] });

    await useTaskStore.getState().removeTask('solo-1');
    await useTaskStore.getState().flush();
    const soloCmds = useTaskStore.getState().outbox?.commands ?? [];
    expect(soloCmds.map((c) => c.entityId)).toEqual(['solo-1']);

    // Already-gone child on server
    useTaskStore.getState().resetForAccount();
    persisted = {};
    mockDeliveredOrder.length = 0;
    mockHoldDelivery = false;
    mockServerGoneIds = new Set(['gone-child']);
    useTaskStore.setState({
      tasks: [makeTask('p-gone'), makeTask('gone-child', 'p-gone')],
    });

    await useTaskStore.getState().removeTask('p-gone');
    await useTaskStore.getState().flush();
    expect(mockDeliveredOrder).toEqual(['delete:gone-child', 'delete:p-gone']);
    expect(useTaskStore.getState().outbox?.commands).toEqual([]);
  });
});
