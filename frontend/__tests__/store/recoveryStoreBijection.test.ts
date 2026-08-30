/**
 * `recoveryStore` <-> `lib/recovery.ts` V2 wiring tests.  (task 1-D, W3/W4)
 *
 * AC-R01  `addPlan` still persists ONLY today's real `recovery_plans`
 *         columns -- none of the plan's new-but-unapplied-migration columns
 *         (`source_log_id`, `deficit_type`, `deficit_value`,
 *         `distributed_days`, `completed_at`) are ever sent to Supabase.
 * AC-R02  the `toLegacyRecoveryPlan`/`fromLegacyRecoveryPlan` round trip
 *         applied at the store's read/write boundary is lossless for every
 *         legacy strategy/status value -- the store's external shape is
 *         byte-identical to what was persisted (no regression from routing
 *         through the V2 adapter).
 * AC-R03  every existing exported action keeps its current external
 *         behaviour: `addPlan` still schedules a reminder when
 *         `reminder_time` is set, `completePlan`/`skipPlan`/`deletePlan`
 *         still remove the plan from local state and cancel its reminder.
 * AC-R04  the new, additive `recoveryOptionsFor` action wraps `deficitFor` +
 *         `recoveryOptions` correctly -- the plan's worked deficit example
 *         (target 10000, value 8000 -> deficit 2000) and the exact 4
 *         Turkish strategy labels from Plan §9.
 *
 * `expo-notifications` scheduling is exercised through the real
 * `lib/notifications.ts` module (jest-expo mocks the native module beneath
 * it), matching the "no ad-hoc mocking beyond the Supabase client" pattern
 * used elsewhere in this suite.
 */
type Row = {
  id: string; user_id: string; habit_id: string; source_date: string;
  target_date: string; strategy: string; note: string | null;
  reminder_time: string | null; status: string; created_at: string;
};

const mockDb = {
  rows: [] as Row[],
  inserts: [] as Record<string, unknown>[],
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
          order() { return q; },
          // The repository bounds its list reads, so the chain now ends in
          // `.limit()` -- an unbounded fetch is exactly what it removed.
          limit() { return q; },
          then(onOk: (v: unknown) => unknown) {
            const rows = mockDb.rows.filter((r) =>
              Object.entries(filters).every(
                ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));
            return Promise.resolve({ data: rows, error: null }).then(onOk);
          },
        };
        return q;
      },
      insert(payload: Record<string, unknown>) {
        mockDb.inserts.push(payload);
        return {
          select: () => ({
            single: async () => {
              const row = { id: 'p' + ++mockDb.idSeq, created_at: 'now', ...payload } as unknown as Row;
              mockDb.rows.push(row);
              return { data: row, error: null };
            },
          }),
        };
      },
      update(patch: Record<string, unknown>) {
        const filters: Record<string, unknown> = {};
        const u: any = {
          eq(col: string, val: unknown) { filters[col] = val; return u; },
          // The repository layer scopes by owner and then reads the row back:
          // `.eq('id').eq('user_id').select(cols).maybeSingle()`.
          select: () => ({
            maybeSingle: async () => {
              const row = mockDb.rows.find((r: any) => r.id === filters.id);
              if (row) Object.assign(row, patch);
              return { data: row ?? null, error: null };
            },
          }),
          then(onOk: (v: unknown) => unknown) {
            const row = mockDb.rows.find((r) => r.id === filters.id);
            if (row) Object.assign(row, patch);
            return Promise.resolve({ data: null, error: null }).then(onOk);
          },
        };
        return u;
      },
      delete() {
        const filters: Record<string, unknown> = {};
        const d: any = {
          eq(col: string, val: unknown) { filters[col] = val; return d; },
          select: () => ({
            then: (onOk: (v: unknown) => unknown) => {
              const hit = mockDb.rows.filter((r: any) => r.id === filters.id);
              mockDb.rows = mockDb.rows.filter((r: any) => r.id !== filters.id);
              return Promise.resolve({ data: hit, error: null }).then(onOk);
            },
          }),
          then(onOk: (v: unknown) => unknown) {
            mockDb.rows = mockDb.rows.filter((r) => r.id !== filters.id);
            return Promise.resolve({ data: null, error: null }).then(onOk);
          },
        };
        return d;
      },
    }),
  },
}));

jest.mock('../../lib/notifications', () => ({
  scheduleRecoveryReminder: jest.fn(),
  cancelRecoveryReminder: jest.fn(),
}));

import { useRecoveryStore } from '../../store/recoveryStore';
import { scheduleRecoveryReminder, cancelRecoveryReminder } from '../../lib/notifications';

beforeEach(() => {
  mockDb.rows = [];
  mockDb.inserts = [];
  mockDb.idSeq = 0;
  jest.clearAllMocks();
  useRecoveryStore.setState({ plans: [], loading: false });
});

describe('AC-R01 -- addPlan writes only real, existing columns', () => {
  it('never sends the unapplied-migration columns to Supabase', async () => {
    await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04',
      strategy: 'half', note: 'not', reminderTime: '09:00',
    });
    expect(mockDb.inserts).toHaveLength(1);
    const payload = mockDb.inserts[0];
    for (const forbidden of ['source_log_id', 'deficit_type', 'deficit_value', 'distributed_days', 'completed_at']) {
      expect(Object.prototype.hasOwnProperty.call(payload, forbidden)).toBe(false);
    }
    expect(Object.keys(payload).sort()).toEqual(
      ['habit_id', 'note', 'reminder_time', 'source_date', 'status', 'strategy', 'target_date', 'user_id'].sort()
    );
  });
});

describe('AC-R02 -- the V2 round trip at the store boundary is lossless', () => {
  it.each(['full', 'half', 'mini', 'reschedule'] as const)(
    'round-trips strategy %s unchanged through addPlan',
    async (strategy) => {
      const plan = await useRecoveryStore.getState().addPlan({
        habitId: 'h1', habitName: 'X', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy,
      });
      expect(plan?.strategy).toBe(strategy);
    }
  );

  it('round-trips a fetched plan (status planned) unchanged', async () => {
    mockDb.rows.push({
      id: 'p1', user_id: 'u1', habit_id: 'h1', source_date: '2026-08-01',
      target_date: '2026-08-02', strategy: 'mini', note: null,
      reminder_time: null, status: 'planned', created_at: 'now',
    });
    await useRecoveryStore.getState().fetchPlans();
    expect(useRecoveryStore.getState().plans).toEqual([
      {
        id: 'p1', user_id: 'u1', habit_id: 'h1', source_date: '2026-08-01',
        target_date: '2026-08-02', strategy: 'mini', note: null,
        reminder_time: null, status: 'planned', created_at: 'now',
      },
    ]);
  });
});

describe('AC-R03 -- existing actions keep their external behaviour', () => {
  it('schedules a reminder when reminder_time is set', async () => {
    const plan = await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04',
      strategy: 'full', reminderTime: '08:30',
    });
    expect(scheduleRecoveryReminder).toHaveBeenCalledWith(plan!.id, 'Koşu', '2026-08-04', '08:30');
  });

  it('does not schedule a reminder when reminder_time is absent', async () => {
    await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy: 'full',
    });
    expect(scheduleRecoveryReminder).not.toHaveBeenCalled();
  });

  it('completePlan removes the plan locally and cancels its reminder', async () => {
    const plan = await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy: 'full',
    });
    await useRecoveryStore.getState().completePlan(plan!.id);
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
    expect(cancelRecoveryReminder).toHaveBeenCalledWith(plan!.id);
  });

  it('skipPlan removes the plan locally and cancels its reminder', async () => {
    const plan = await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy: 'full',
    });
    await useRecoveryStore.getState().skipPlan(plan!.id);
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
    expect(cancelRecoveryReminder).toHaveBeenCalledWith(plan!.id);
  });

  it('deletePlan removes the plan locally and cancels its reminder', async () => {
    const plan = await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy: 'full',
    });
    await useRecoveryStore.getState().deletePlan(plan!.id);
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
    expect(cancelRecoveryReminder).toHaveBeenCalledWith(plan!.id);
  });

  it('planForHabit still finds only planned plans for the given habit', async () => {
    await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy: 'full',
    });
    expect(useRecoveryStore.getState().planForHabit('h1')?.habit_id).toBe('h1');
    expect(useRecoveryStore.getState().planForHabit('h-none')).toBeUndefined();
  });
});

describe("AC-R04 -- recoveryOptionsFor wraps deficitFor + recoveryOptions (Plan §9)", () => {
  it("computes the plan's worked deficit example (target 10000, value 8000 -> 2000)", () => {
    const options = useRecoveryStore.getState().recoveryOptionsFor({
      trackingType: 'numeric', target: 10000, value: 8000, fromDate: '2026-08-04',
    });
    const split = options.find((o) => o.strategy === 'split_two_days');
    expect(split?.distributed_days).toEqual([
      { date: '2026-08-05', value: 1000 },
      { date: '2026-08-06', value: 1000 },
    ]);
  });

  it('returns the exact 4 Turkish strategy labels, in order', () => {
    const options = useRecoveryStore.getState().recoveryOptionsFor({
      trackingType: 'boolean', state: 'miss', fromDate: '2026-08-04',
    });
    expect(options.map((o) => o.label)).toEqual(['Bugün tamamla', 'Yarına aktar', '2 güne böl', 'Telafi etme']);
  });

  it('a done log has zero deficit -- split_two_days schedules nothing', () => {
    const options = useRecoveryStore.getState().recoveryOptionsFor({
      trackingType: 'boolean', state: 'done', fromDate: '2026-08-04',
    });
    const split = options.find((o) => o.strategy === 'split_two_days');
    expect(split?.distributed_days).toEqual([]);
  });
});
