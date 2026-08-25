/**
 * XP computation tests for `logStore`'s internal `calcXp`.  (task 1-D, W1/W4)
 *
 * `calcXp` is not exported by `logStore.ts` -- these tests go through the
 * public `logHabit` action and assert on the `xp` field of the row it
 * writes, exactly like `logStore.test.ts` asserts on other fields of the
 * same write path.
 *
 * AC-X01  a partial log with value > targetValue is clamped to at most
 *         baseXp -- FAILS against the old ad-hoc maths
 *         (`Math.round(baseXp * (value / targetValue))`, unclamped).
 * AC-X02  a NaN value never produces a NaN xp -- FAILS against the old
 *         ad-hoc maths (finding A-01: `parseFloat('')` -> `NaN` ->
 *         `Math.round(NaN)` -> `NaN` XP written to the database).
 * AC-X03  `done` still returns exactly baseXp; `skip`/`miss` still return 0
 *         (no regression from the W1 rewiring).
 * AC-X04  the plan's Gate B worked example: numeric habit, target 10000,
 *         value 8000, baseXp 30 -> xp === round(30 * 0.8) === 24.
 *
 * Sanity check performed manually while authoring this file, per the task
 * brief: temporarily reverting `logStore.ts`'s `calcXp` partial branch to
 * the old `Math.round(baseXp * (value / targetValue))` --
 *   - AC-X01 then computes `Math.round(30 * (12/10))` = 36, so
 *     `expect(res.log.xp).toBe(30)` fails (36 !== 30) -- red, as required.
 *   - AC-X02 then computes `Math.round(30 * (NaN/10))` = `Math.round(NaN)`
 *     = `NaN`, so `expect(Number.isFinite(res.log.xp)).toBe(true)` fails --
 *     red, as required.
 * Both were confirmed failing against the pre-fix code, then confirmed
 * passing again after restoring the `completionRatio`-based fix.
 */
type Row = {
  id: string; habit_id: string; user_id: string; completed_at: string;
  value: number | null; is_completed: boolean; state: string;
  xp: number | null; created_at: string;
};

const mockDb = {
  rows: [] as Row[],
  idSeq: 0,
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: () => ({
      select: () => {
        const filters: Record<string, unknown> = {};
        const q = {
          eq(col: string, val: unknown) { filters[col] = val; return q; },
          async maybeSingle() {
            const match = mockDb.rows.find((r) =>
              Object.entries(filters).every(
                ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
            return { data: match ?? null, error: null };
          },
        };
        return q;
      },
      insert(payload: Record<string, unknown>) {
        return {
          select: () => ({
            single: async () => {
              const row = { id: 'r' + ++mockDb.idSeq, created_at: 'now', ...payload } as unknown as Row;
              mockDb.rows.push(row);
              return { data: row, error: null };
            },
          }),
        };
      },
      update(payload: Record<string, unknown>) {
        const filters: Record<string, unknown> = {};
        const u = {
          eq(col: string, val: unknown) { filters[col] = val; return u; },
          select: () => ({
            single: async () => {
              const row = mockDb.rows.find((r) => r.id === filters.id);
              if (!row) return { data: null, error: { message: 'no row' } };
              Object.assign(row, payload);
              return { data: row, error: null };
            },
          }),
        };
        return u;
      },
    }),
  },
}));

import { useLogStore } from '../../store/logStore';

const DAY = new Date(2026, 7, 4);

beforeEach(() => {
  mockDb.rows.length = 0;
  mockDb.idSeq = 0;
  useLogStore.setState({ logs: [], loading: false });
});

describe('AC-X01 -- an over-target partial log is clamped, not over-awarded', () => {
  it('does not exceed baseXp when value > targetValue', async () => {
    const res = await useLogStore.getState().logHabit({
      habitId: 'h1', date: DAY, state: 'partial', value: 12, targetValue: 10, baseXp: 30,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.log.xp).toBe(30); // clamped to baseXp, NOT round(30*1.2)=36
      expect(res.log.xp).toBeLessThanOrEqual(30);
    }
  });
});

describe('AC-X02 -- a NaN value never produces NaN xp', () => {
  it('resolves an unparseable ("") -> NaN value to a finite xp', async () => {
    const res = await useLogStore.getState().logHabit({
      habitId: 'h1', date: DAY, state: 'partial', value: Number.NaN, targetValue: 10, baseXp: 30,
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Number.isFinite(res.log.xp)).toBe(true);
      expect(res.log.xp).not.toBeNaN();
      expect(res.log.xp).toBe(0); // NaN value clamped to 0 progress -> ratio 0
    }
  });
});

describe('AC-X03 -- done/skip/miss are unaffected by the W1 rewiring', () => {
  it('done still returns exactly baseXp', async () => {
    const res = await useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'done', baseXp: 30 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.log.xp).toBe(30);
  });

  it('skip still returns 0', async () => {
    const res = await useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'skip', baseXp: 30 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.log.xp).toBe(0);
  });

  it('miss still returns 0', async () => {
    const res = await useLogStore.getState().logHabit({ habitId: 'h1', date: DAY, state: 'miss', baseXp: 30 });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.log.xp).toBe(0);
  });
});

describe("AC-X04 -- the plan's Gate B worked example", () => {
  it('numeric habit, target 10000, value 8000, baseXp 30 -> xp === 24', async () => {
    const res = await useLogStore.getState().logHabit({
      habitId: 'h1', date: DAY, state: 'partial', value: 8000, targetValue: 10000, baseXp: 30,
    });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.log.xp).toBe(24); // round(30 * 0.8)
  });
});
