import type { Cursor, Page, RepoResult } from '../../repositories/shared';

const EXPECTED_COLS =
  'id,user_id,name,description,quit_date,cost_per_day,time_wasted_per_day,created_at';

const mockCurrentUserId = jest.fn();
const mockFetchPage = jest.fn();
const mockUpdateOwned = jest.fn();
const mockDeleteOwned = jest.fn();

const mockInsertCalls: { table: string; payload: Record<string, unknown>; columns: string }[] = [];
const mockState: {
  insertResult: { data: unknown; error: { message: string } | null };
} = {
  insertResult: { data: null, error: null },
};

jest.mock('../../repositories/shared', () => ({
  currentUserId: (...args: unknown[]) => mockCurrentUserId(...args),
  fetchPage: (...args: unknown[]) => mockFetchPage(...args),
  updateOwned: (...args: unknown[]) => mockUpdateOwned(...args),
  deleteOwned: (...args: unknown[]) => mockDeleteOwned(...args),
}));

jest.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (payload: Record<string, unknown>) => ({
        select: (columns: string) => ({
          single: async () => {
            mockInsertCalls.push({ table, payload, columns });
            return mockState.insertResult;
          },
        }),
      }),
    }),
  },
}));

import {
  deleteBadHabit,
  fetchBadHabitsPage,
  insertBadHabit,
  updateBadHabit,
  type BadHabitRow,
} from '../../repositories/badHabitRepository';

const USER_ID = '22222222-2222-4222-8222-222222222222';

function makeRow(overrides: Partial<BadHabitRow> = {}): BadHabitRow {
  return {
    id: 'bh-1',
    user_id: USER_ID,
    name: 'Sigara',
    description: null,
    quit_date: '2026-10-15T09:00:00.000Z',
    cost_per_day: 0,
    time_wasted_per_day: 0,
    created_at: '2026-10-15T09:00:00.000Z',
    ...overrides,
  };
}

describe('badHabitRepository', () => {
  beforeEach(() => {
    mockInsertCalls.length = 0;
    mockCurrentUserId.mockResolvedValue({ ok: true, userId: USER_ID });
    mockState.insertResult = { data: makeRow(), error: null };
  });

  describe('fetchBadHabitsPage', () => {
    it('scopes page query to currentUserId, explicit columns, cursor, and limit', async () => {
      const cursor: Cursor = { key: '2026-10-15T09:00:00.000Z', id: 'bh-1' };
      const page: RepoResult<Page<BadHabitRow>> = {
        ok: true,
        data: { rows: [makeRow()], nextCursor: null, hasMore: false },
      };
      mockFetchPage.mockResolvedValueOnce(page);

      const res = await fetchBadHabitsPage(cursor, 25);

      expect(res).toEqual(page);
      expect(mockFetchPage).toHaveBeenCalledTimes(1);
      expect(mockFetchPage).toHaveBeenCalledWith({
        table: 'bad_habits',
        columns: EXPECTED_COLS,
        orderBy: 'created_at',
        userId: USER_ID,
        cursor,
        limit: 25,
      });
    });

    it('propagates auth failure without querying fetchPage', async () => {
      const authErr = { ok: false as const, error: 'Oturum bulunamadı.', offline: true };
      mockCurrentUserId.mockResolvedValueOnce(authErr);

      const res = await fetchBadHabitsPage();

      expect(res).toEqual(authErr);
      expect(mockFetchPage).not.toHaveBeenCalled();
    });
  });

  describe('insertBadHabit', () => {
    it('applies defaults for description, cost_per_day, time_wasted_per_day, and quit_date', async () => {
      const created = makeRow({ name: 'Gece atıştırması' });
      mockState.insertResult = { data: created, error: null };

      const res = await insertBadHabit({ name: 'Gece atıştırması' });

      expect(res).toEqual({ ok: true, data: created });
      expect(mockInsertCalls).toHaveLength(1);
      expect(mockInsertCalls[0].table).toBe('bad_habits');
      expect(mockInsertCalls[0].columns).toBe(EXPECTED_COLS);
      expect(mockInsertCalls[0].payload).toMatchObject({
        user_id: USER_ID,
        name: 'Gece atıştırması',
        description: null,
        cost_per_day: 0,
        time_wasted_per_day: 0,
      });
      expect(typeof mockInsertCalls[0].payload.quit_date).toBe('string');
      expect(Number.isNaN(Date.parse(String(mockInsertCalls[0].payload.quit_date)))).toBe(false);
    });

    it('passes explicit optional fields through to Supabase insert', async () => {
      const created = makeRow({
        name: 'Sosyal medya kaydırma',
        description: 'Yatmadan önce reels',
        quit_date: '2026-11-01T00:00:00.000Z',
        cost_per_day: 45,
        time_wasted_per_day: 60,
      });
      mockState.insertResult = { data: created, error: null };

      const res = await insertBadHabit({
        name: 'Sosyal medya kaydırma',
        description: 'Yatmadan önce reels',
        quitDate: '2026-11-01T00:00:00.000Z',
        costPerDay: 45,
        timeWastedPerDay: 60,
      });

      expect(res).toEqual({ ok: true, data: created });
      expect(mockInsertCalls[0].payload).toEqual({
        user_id: USER_ID,
        name: 'Sosyal medya kaydırma',
        description: 'Yatmadan önce reels',
        quit_date: '2026-11-01T00:00:00.000Z',
        cost_per_day: 45,
        time_wasted_per_day: 60,
      });
    });

    it('propagates auth failure and PostgREST insert errors', async () => {
      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum açık değil.' });
      expect(await insertBadHabit({ name: 'Sigara' })).toEqual({
        ok: false,
        error: 'Oturum açık değil.',
      });
      expect(mockInsertCalls).toHaveLength(0);

      mockState.insertResult = { data: null, error: { message: 'new row violates check constraint' } };
      expect(await insertBadHabit({ name: 'Sigara' })).toEqual({
        ok: false,
        error: 'new row violates check constraint',
      });
    });
  });

  describe('updateBadHabit & deleteBadHabit', () => {
    it('delegates updateBadHabit to updateOwned with owner userId and explicit columns', async () => {
      const updated = makeRow({ name: 'Şekerli içecek', cost_per_day: 35 });
      mockUpdateOwned.mockResolvedValueOnce({ ok: true, data: updated });

      const patch = { name: 'Şekerli içecek', cost_per_day: 35 };
      const res = await updateBadHabit('bh-1', patch);

      expect(res).toEqual({ ok: true, data: updated });
      expect(mockUpdateOwned).toHaveBeenCalledWith({
        table: 'bad_habits',
        id: 'bh-1',
        userId: USER_ID,
        patch,
        columns: EXPECTED_COLS,
      });
    });

    it('delegates deleteBadHabit to deleteOwned with owner userId and propagates auth failures', async () => {
      mockDeleteOwned.mockResolvedValueOnce({ ok: true, data: true });
      expect(await deleteBadHabit('bh-1')).toEqual({ ok: true, data: true });
      expect(mockDeleteOwned).toHaveBeenCalledWith({
        table: 'bad_habits',
        id: 'bh-1',
        userId: USER_ID,
      });

      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum bulunamadı.' });
      expect(await updateBadHabit('bh-1', { name: 'X' })).toEqual({
        ok: false,
        error: 'Oturum bulunamadı.',
      });
      expect(mockUpdateOwned).not.toHaveBeenCalled();

      mockCurrentUserId.mockResolvedValueOnce({ ok: false, error: 'Oturum bulunamadı.' });
      expect(await deleteBadHabit('bh-1')).toEqual({
        ok: false,
        error: 'Oturum bulunamadı.',
      });
      expect(mockDeleteOwned).toHaveBeenCalledTimes(1);
    });
  });
});
