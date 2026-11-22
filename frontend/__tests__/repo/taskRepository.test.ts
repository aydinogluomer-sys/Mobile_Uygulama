/**
 * Repository tests for `repositories/taskRepository.ts`.  (Phase 1 + F30 parent link)
 */
type PgError = { message: string; code?: string };

const mockDb = {
  error: null as PgError | null,
  user: { id: 'u1' } as { id: string } | null,
  inserted: [] as Record<string, unknown>[],
  idSeq: 0,
};

jest.mock('../../lib/supabase', () => {
  return {
    supabase: {
      auth: {
      // The data layer resolves the user id from the LOCAL session -- see
      // `repositories/shared.currentUserId`. Derived from this mock's own
      // getUser so the two can never disagree.
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
       getUser: jest.fn(async () => ({ data: { user: mockDb.user }, error: null })) },
      from: () => ({
        insert: (rows: Record<string, unknown>[]) => ({
          select: async () => {
            if (mockDb.error) return { data: null, error: mockDb.error };
            const saved = rows.map((r) => ({ id: 't' + ++mockDb.idSeq, created_at: 'now', ...r }));
            mockDb.inserted.push(...saved);
            return { data: saved, error: null };
          },
        }),
      }),
    },
  };
});

import { insertSplitTasks, type SplitTaskInput } from '../../repositories/taskRepository';

const baseRow: SplitTaskInput = {
  title: 'Gerekenleri tek bir yere topla — Rapor',
  description: '2 dk · ilk adım · 25 dk blok (1/3)',
  status: 'pending',
  priority: 'medium',
  due_date: null,
  project_id: null,
  list_type: 'inbox',
  completed: false,
  parent_task_id: 'parent-1',
  is_subtask: true,
};

beforeEach(() => {
  mockDb.error = null;
  mockDb.user = { id: 'u1' };
  mockDb.inserted = [];
  mockDb.idSeq = 0;
});

describe('insertSplitTasks', () => {
  it('inserts every row stamped with the current user id and preserves parent_task_id + is_subtask', async () => {
    const res = await insertSplitTasks([baseRow, { ...baseRow, title: 'İlk taslağı 10 dakikada çıkar — Rapor' }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(2);
      expect(res.data.every((t) => (t as any).user_id === 'u1')).toBe(true);
      expect(res.data[0].title).toBe('Gerekenleri tek bir yere topla — Rapor');
      expect(res.data[0].parent_task_id).toBe('parent-1');
      expect(res.data[0].is_subtask).toBe(true);
    }
    expect(mockDb.inserted.every((r) => r.user_id === 'u1' && r.parent_task_id === 'parent-1' && r.is_subtask === true)).toBe(true);
  });

  it('surfaces an insert error instead of swallowing it', async () => {
    mockDb.error = { message: 'insert boom' };
    const res = await insertSplitTasks([baseRow]);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('insert boom');
  });

  it('fails explicitly when there is no session, rather than inserting unscoped rows', async () => {
    mockDb.user = null;
    const res = await insertSplitTasks([baseRow]);
    expect(res.ok).toBe(false);
    expect(mockDb.inserted).toHaveLength(0);
  });
});
