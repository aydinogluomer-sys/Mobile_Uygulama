/**
 * R02.08 — controlled fixtures for the task outbox: airplane mode, app kill,
 * lost responses (timeout), two devices, a delete racing an edit, an account
 * switch, and an expired session. The REAL store, service and outbox run on
 * top of a fake server that keeps versions and can drop the network.
 */
type Row = { id: string; user_id: string; title: string; completed: boolean; status: string; completed_at: string | null; updated_at: string; created_at: string; list_type: string; priority: string; due_date: string | null };

const mockServer = {
  rows: new Map<string, Row>(),
  online: true,
  /** Apply the write, then lose the response (the client sees offline). */
  loseNextResponse: false,
  authExpired: false,
  clock: 0,
  inserts: 0,
};
const mockSession = { user: { id: 'user-a', email: null } as { id: string; email: null } | null };

/** The real repository refuses a write whose session is not the command's account. */
function mockWrongAccount(expected?: string) {
  return expected !== undefined && expected !== mockSession.user?.id ? { ok: false as const, error: 'Oturum başka bir hesaba ait.', status: 401 } : null;
}
function mockVersion() { mockServer.clock += 1; return `2026-10-07T10:00:${String(mockServer.clock).padStart(2, '0')}.000Z`; }
function mockGate<T>(apply: () => T): { ok: false; error: string; offline?: boolean; status?: number } | { ok: true; data: T } {
  if (!mockServer.online) return { ok: false, error: 'Network request failed', offline: true };
  if (mockServer.authExpired) return { ok: false, error: 'JWT expired', status: 401 };
  const data = apply();
  if (mockServer.loseNextResponse) { mockServer.loseNextResponse = false; return { ok: false, error: 'timeout', offline: true }; }
  return { ok: true, data };
}

jest.mock('../../repositories/taskRepository', () => ({
  fetchTasksPage: jest.fn(async () => {
    if (!mockServer.online) return { ok: false, error: 'Network request failed', offline: true };
    const rows = [...mockServer.rows.values()].filter((r) => r.user_id === mockSession.user?.id);
    return { ok: true, data: { rows, nextCursor: null, hasMore: false } };
  }),
  insertTaskRow: jest.fn(async (row: any, expected?: string) => {
    const wrong = mockWrongAccount(expected);
    if (wrong) return wrong;
    if (mockServer.online && !mockServer.authExpired && mockServer.rows.has(row.id)) return { ok: false, error: 'duplicate key', code: '23505', status: 409 };
    return mockGate(() => {
      mockServer.inserts += 1;
      const r = { ...row, user_id: mockSession.user!.id, updated_at: mockVersion() } as Row;
      mockServer.rows.set(r.id, r);
      return r;
    });
  }),
  updateTaskVersioned: jest.fn(async (id: string, patch: any, base: string | null, expected?: string) => mockWrongAccount(expected) ?? mockGate(() => {
    const cur = mockServer.rows.get(id);
    if (!cur) return { row: null, exists: false };
    if (base !== null && cur.updated_at !== base) return { row: null, exists: true };
    const next = { ...cur, ...patch, updated_at: mockVersion() };
    mockServer.rows.set(id, next);
    return { row: next, exists: true };
  })),
  fetchTaskRow: jest.fn(async (id: string) => mockGate(() => mockServer.rows.get(id) ?? null)),
  deleteTaskIfPresent: jest.fn(async (id: string, expected?: string) => mockWrongAccount(expected) ?? mockGate(() => ({ deleted: mockServer.rows.delete(id) }))),
  insertTask: jest.fn(), updateTask: jest.fn(), deleteTask: jest.fn(), searchTasks: jest.fn(), insertSplitTasks: jest.fn(),
}));
jest.mock('../../services/webhookService', () => ({ notify: jest.fn() }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => mockSession.user) }));

import { useTaskStore, setTaskOutboxStorage } from '../../store/taskStore';
import * as repo from '../../repositories/taskRepository';
import { memoryOutboxStorage } from '../../lib/outboxStorage';

let storage = memoryOutboxStorage();
const st = () => useTaskStore.getState();

/** The process dies: memory is gone, only storage survives. */
function kill() {
  useTaskStore.setState({ tasks: [], outbox: null, cursor: null, hasMore: false, error: null });
}

beforeEach(() => {
  mockServer.rows.clear();
  mockServer.online = true;
  mockServer.loseNextResponse = false;
  mockServer.authExpired = false;
  mockServer.clock = 0;
  mockServer.inserts = 0;
  mockSession.user = { id: 'user-a', email: null };
  storage = memoryOutboxStorage();
  setTaskOutboxStorage(storage);
  kill();
});

const serverTitles = () => [...mockServer.rows.values()].map((r) => r.title).sort();

describe('airplane mode, then the app is killed, then the network returns', () => {
  it('100 mixed offline actions arrive as the user left them, once each', async () => {
    mockServer.online = false;
    const ids: string[] = [];
    for (let i = 0; i < 40; i++) {
      const t = await st().addTask({ title: `t${i}` });
      ids.push(t!.id);
    }
    for (let i = 0; i < 30; i++) await st().toggleDone(ids[i]);            // 30 done
    for (let i = 0; i < 20; i++) await st().updateTask(ids[i + 10], { title: `r${i}` }); // renames
    for (let i = 0; i < 10; i++) await st().removeTask(ids[30 + i]);       // 10 deleted, never sent
    expect(mockServer.rows.size).toBe(0);
    expect(st().tasks).toHaveLength(30);
    const intended = st().tasks.map((t) => ({ title: t.title, completed: t.completed })).sort((a, b) => a.title.localeCompare(b.title));

    kill();
    mockServer.online = true;
    await st().fetchTasks();          // reload from storage, overlay, flush
    await st().flush();
    expect(st().sync).toMatchObject({ pending: 0, dead: 0, conflict: 0 });
    expect(mockServer.inserts).toBe(30);
    const onServer = [...mockServer.rows.values()].map((r) => ({ title: r.title, completed: r.completed })).sort((a, b) => a.title.localeCompare(b.title));
    expect(onServer).toEqual(intended);
  });
});

describe('a response is lost after the server applied the write', () => {
  it('a create re-delivered five times is one row', async () => {
    const t = await st().addTask({ title: 'tek' });
    for (let i = 0; i < 4; i++) {
      // each re-delivery after the first finds the row and settles as applied
      mockServer.loseNextResponse = i === 0;
      await st().flush();
    }
    expect(mockServer.rows.size).toBe(1);
    expect(mockServer.rows.get(t!.id)?.title).toBe('tek');
    expect(st().sync.pending).toBe(0);
  });

  it('an update that landed but was not recorded is not reported as a conflict with ourselves', async () => {
    const t = await st().addTask({ title: 'a' });
    await st().flush();
    mockServer.loseNextResponse = true;
    (repo.fetchTaskRow as jest.Mock).mockClear();
    await st().toggleDone(t!.id);           // server applies, client sees offline ...
    await st().flush();                     // ... re-sent: the version moved, but the row already holds our values
    expect(mockServer.rows.get(t!.id)?.completed).toBe(true);
    expect(repo.fetchTaskRow).toHaveBeenCalled();
    expect(st().sync).toMatchObject({ pending: 0, conflict: 0 });
  });
});

describe('two devices', () => {
  it('an edit made against an old version is a conflict, never applied silently', async () => {
    const t = await st().addTask({ title: 'ortak' });
    await st().flush();
    // device B renames it
    const row = mockServer.rows.get(t!.id)!;
    mockServer.rows.set(t!.id, { ...row, title: 'B değiştirdi', updated_at: mockVersion() });
    // device A, offline, ticks it against the version it saw
    mockServer.online = false;
    await st().toggleDone(t!.id);
    mockServer.online = true;
    await st().flush();
    expect(st().sync.conflict).toBe(1);
    expect(mockServer.rows.get(t!.id)?.completed).toBe(false);
    expect(mockServer.rows.get(t!.id)?.title).toBe('B değiştirdi');

    // the user chooses "Benimkini uygula" after seeing the server's version
    await st().fetchTasks();
    const opId = st().outbox!.commands[0].operationId;
    await st().retryChange(opId);
    await st().flush();
    expect(st().sync.conflict).toBe(0);
    expect(mockServer.rows.get(t!.id)).toMatchObject({ completed: true, title: 'B değiştirdi' });
  });

  it('a task deleted elsewhere is not brought back by a late edit', async () => {
    const t = await st().addTask({ title: 'silinecek' });
    await st().flush();
    mockServer.online = false;
    await st().updateTask(t!.id, { title: 'geç düzenleme' });
    mockServer.rows.delete(t!.id);          // device B deleted it meanwhile
    mockServer.online = true;
    await st().flush();
    expect(mockServer.rows.has(t!.id)).toBe(false);
    expect(st().sync.pending).toBe(0);
  });

  it('a local delete then a late local edit sends only the delete', async () => {
    const t = await st().addTask({ title: 'x' });
    await st().flush();
    mockServer.online = false;
    await st().removeTask(t!.id);
    await st().updateTask(t!.id, { title: 'zombi' }); // the row is gone locally: no-op
    mockServer.online = true;
    await st().flush();
    expect(mockServer.rows.size).toBe(0);
  });
});

describe('accounts', () => {
  it('A\'s unsent work is never sent as B, and is still there when A returns', async () => {
    mockServer.online = false;
    await st().addTask({ title: 'A işi' });
    // A signs out, B signs in
    st().resetForAccount();
    mockSession.user = { id: 'user-b', email: null };
    mockServer.online = true;
    await st().fetchTasks();
    await st().flush();
    expect(mockServer.rows.size).toBe(0);
    expect(st().tasks).toHaveLength(0);
    // A comes back
    st().resetForAccount();
    mockSession.user = { id: 'user-a', email: null };
    await st().fetchTasks();
    await st().authRefreshed();             // what the root layout does on SIGNED_IN
    await st().flush();
    expect(serverTitles()).toEqual(['A işi']);
    expect([...mockServer.rows.values()][0].user_id).toBe('user-a');
  });
});

describe('an expired session', () => {
  it('pauses delivery without using attempts, and resumes after a refresh', async () => {
    mockServer.authExpired = true;
    await st().addTask({ title: 'oturum' });
    await st().flush();
    expect(st().sync.authBlocked).toBe(true);
    expect(st().outbox!.commands[0].attempts).toBe(0);
    mockServer.authExpired = false;
    await st().authRefreshed();
    await st().flush();
    expect(serverTitles()).toEqual(['oturum']);
  });
});
