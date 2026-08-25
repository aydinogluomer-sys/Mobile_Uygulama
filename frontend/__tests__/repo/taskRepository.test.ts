/**
 * Repository tests for `repositories/taskRepository.ts`.  (Phase 1)
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
      auth: { getUser: jest.fn(async () => ({ data: { user: mockDb.user }, error: null })) },
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
  title: 'Rapor — Pomodoro',
  description: '25 dk blok (1/3)',
  status: 'pending',
  priority: 'medium',
  due_date: null,
  project_id: null,
  list_type: 'inbox',
  completed: false,
};

beforeEach(() => {
  mockDb.error = null;
  mockDb.user = { id: 'u1' };
  mockDb.inserted = [];
  mockDb.idSeq = 0;
});

describe('insertSplitTasks', () => {
  it('inserts every row stamped with the current user id, not a caller-supplied one', async () => {
    const res = await insertSplitTasks([baseRow, { ...baseRow, title: 'Rapor — Pomodoro 2' }]);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data).toHaveLength(2);
      expect(res.data.every((t) => (t as any).user_id === 'u1')).toBe(true);
      expect(res.data[0].title).toBe('Rapor — Pomodoro');
    }
    expect(mockDb.inserted.every((r) => r.user_id === 'u1')).toBe(true);
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
