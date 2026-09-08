/**
 * `recoveryStore` <-> `lib/recovery.ts` V2 wiring tests.  (task 1-D, W3/W4)
 *
 * AC-R01  `addPlan` PERSISTS the deficit and the day distribution.
 *
 *         This acceptance criterion is the inverse of the one it replaces.
 *         The original read: "none of the plan's new-but-unapplied-migration
 *         columns are ever sent to Supabase", and it passed — while the five
 *         columns had existed since migration `005_phase1_core_engine`. The
 *         test was pinning
 *         the data loss as correct behaviour, which is why nobody noticed
 *         that a saved plan could not say what it was answering.
 * AC-R02  there is no round trip to be lossless about. The table speaks the
 *         domain's vocabulary (013_recovery_vocabulary), so a row IS a
 *         plan; the adapter that translated `complete_today <-> full` and
 *         `skip <-> mini` is gone.
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
  id: string; user_id: string; habit_id: string; source_log_id: string | null;
  source_date: string; target_date: string;
  deficit_type: string | null; deficit_value: number | null;
  strategy: string; distributed_days: { date: string; value: number }[] | null;
  note: string | null; reminder_time: string | null; status: string;
  completed_at: string | null; created_at: string;
};

const mockDb = {
  rows: [] as Row[],
  inserts: [] as Record<string, unknown>[],
  idSeq: 0,
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      // The data layer resolves the user id from the LOCAL session -- see
      // `repositories/shared.currentUserId`. Derived from this mock's own
      // getUser so the two can never disagree.
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
       getUser: jest.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
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

describe('AC-R01 -- addPlan persists what the plan is answering', () => {
  it('writes the deficit and the day distribution, not just the timing', async () => {
    await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04',
      strategy: 'split_two_days', note: 'not', reminderTime: '09:00',
      sourceLogId: 'log-1', deficitType: 'numeric', deficitValue: 2000,
      distributedDays: [{ date: '2026-08-04', value: 1000 }, { date: '2026-08-05', value: 1000 }],
    });

    expect(mockDb.inserts).toHaveLength(1);
    expect(mockDb.inserts[0]).toMatchObject({
      source_log_id: 'log-1',
      deficit_type: 'numeric',
      deficit_value: 2000,
      distributed_days: [{ date: '2026-08-04', value: 1000 }, { date: '2026-08-05', value: 1000 }],
    });
  });

  it('omits completed_at, which the table refuses on a plan that is not done', async () => {
    await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04',
      strategy: 'complete_today',
    });
    expect(Object.prototype.hasOwnProperty.call(mockDb.inserts[0], 'completed_at')).toBe(false);
  });

  it('a plan created without a known deficit stores nulls, not absent keys', async () => {
    // Nulls say "we did not know"; missing keys would let a later reader
    // guess. Both are honest only if they are consistent.
    await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04',
      strategy: 'push_tomorrow',
    });
    expect(mockDb.inserts[0]).toMatchObject({
      source_log_id: null, deficit_type: null, deficit_value: null, distributed_days: null,
    });
  });
});

describe('AC-R02 -- a row is a plan, with nothing translated away', () => {
  it.each(['complete_today', 'push_tomorrow', 'split_two_days', 'skip'] as const)(
    'keeps strategy %s exactly as written',
    async (strategy) => {
      const plan = await useRecoveryStore.getState().addPlan({
        habitId: 'h1', habitName: 'X', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy,
      });
      expect(plan?.strategy).toBe(strategy);
    },
  );

  it('a fetched plan arrives with its deficit intact', async () => {
    // Under the adapter this row came back with deficit_value stripped to
    // null, so the recovery screen could not show what was owed.
    mockDb.rows.push({
      id: 'p1', user_id: 'u1', habit_id: 'h1', source_log_id: 'log-9',
      source_date: '2026-08-01', target_date: '2026-08-02',
      deficit_type: 'numeric', deficit_value: 2000,
      strategy: 'split_two_days',
      distributed_days: [{ date: '2026-08-02', value: 1000 }],
      note: null, reminder_time: null, status: 'planned',
      completed_at: null, created_at: 'now',
    } as unknown as Row);

    await useRecoveryStore.getState().fetchPlans();
    const [plan] = useRecoveryStore.getState().plans;
    expect(plan.deficit_value).toBe(2000);
    expect(plan.deficit_type).toBe('numeric');
    expect(plan.source_log_id).toBe('log-9');
    expect(plan.distributed_days).toEqual([{ date: '2026-08-02', value: 1000 }]);
  });
});

describe('AC-R03 -- existing actions keep their external behaviour', () => {
  it('schedules a reminder when reminder_time is set', async () => {
    const plan = await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04',
      strategy: 'complete_today', reminderTime: '08:30',
    });
    expect(scheduleRecoveryReminder).toHaveBeenCalledWith(plan!.id, 'Koşu', '2026-08-04', '08:30');
  });

  it('does not schedule a reminder when reminder_time is absent', async () => {
    await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy: 'complete_today',
    });
    expect(scheduleRecoveryReminder).not.toHaveBeenCalled();
  });

  it('completePlan removes the plan locally and cancels its reminder', async () => {
    const plan = await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy: 'complete_today',
    });
    await useRecoveryStore.getState().completePlan(plan!.id);
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
    expect(cancelRecoveryReminder).toHaveBeenCalledWith(plan!.id);
  });

  it('skipPlan removes the plan locally and cancels its reminder', async () => {
    const plan = await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy: 'complete_today',
    });
    await useRecoveryStore.getState().skipPlan(plan!.id);
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
    expect(cancelRecoveryReminder).toHaveBeenCalledWith(plan!.id);
  });

  it('deletePlan removes the plan locally and cancels its reminder', async () => {
    const plan = await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy: 'complete_today',
    });
    await useRecoveryStore.getState().deletePlan(plan!.id);
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
    expect(cancelRecoveryReminder).toHaveBeenCalledWith(plan!.id);
  });

  it('planForHabit still finds only planned plans for the given habit', async () => {
    await useRecoveryStore.getState().addPlan({
      habitId: 'h1', habitName: 'Koşu', sourceDate: '2026-08-03', targetDate: '2026-08-04', strategy: 'complete_today',
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
