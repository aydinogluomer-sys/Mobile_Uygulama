/**
 * §22 analytics emission -- `store/recoveryStore.ts` /
 * `recovery_created` + `recovery_completed`.  (task Phase-4 CODER-O)
 *
 * Behavioural, for the reason spelled out in
 * `habitStoreAnalytics.test.ts`'s header: the real store action runs, the
 * real `buildEvent` filter runs, and the assertions are made on the event
 * object that actually reaches the sink.
 *
 * Invariants:
 *  AC-1  `addPlan` success -> exactly one `recovery_created`.
 *  AC-2  `addPlan` failure (insert rejected / no session) -> no event.
 *  AC-3  `completePlan` success -> exactly one `recovery_completed`, carrying
 *        the habit/strategy read from the plan itself rather than from a
 *        caller argument.
 *  AC-4  `completePlan` whose UPDATE is rejected -> no event, while the
 *        pre-existing local-state and reminder behaviour is unchanged.
 *  AC-5  neither event carries the plan's note or the habit's name.
 *  AC-6  a throwing sink does not break either action.
 */
type PgError = { message: string } | null;
type Row = {
  id: string; user_id: string; habit_id: string; source_date: string;
  target_date: string; strategy: string; note: string | null;
  reminder_time: string | null; status: string; created_at: string;
};

const mockState = {
  inserts: [] as Record<string, unknown>[],
  updates: [] as Record<string, unknown>[],
  insertError: null as PgError,
  updateError: null as PgError,
  user: { id: 'u1' } as { id: string } | null,
};

const PLAN_ID = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const HABIT_ID = 'cccccccc-3333-4333-8333-cccccccccccc';

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
       getUser: async () => ({ data: { user: mockState.user } }) },
    from: () => ({
      insert: (payload: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            mockState.inserts.push(payload);
            if (mockState.insertError) return { data: null, error: mockState.insertError };
            return {
              data: { id: PLAN_ID, created_at: '2026-08-30T09:00:00.000Z', ...payload } as unknown as Row,
              error: null,
            };
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => {
        // `recoveryRepository.setRecoveryPlanStatus` scopes by owner and then
        // reads the row back, so a rejected update is a value the store can
        // see rather than a discarded result. `mockState.updateError` still
        // drives the rejection path -- it now surfaces through `.select()`.
        const q: any = {
          eq: () => q,
          select: () => ({
            maybeSingle: async () => {
              mockState.updates.push(patch);
              if (mockState.updateError) return { data: null, error: mockState.updateError };
              return { data: { id: PLAN_ID, ...patch }, error: null };
            },
          }),
          then: (onOk: (v: unknown) => unknown) => {
            mockState.updates.push(patch);
            return Promise.resolve({ data: null, error: mockState.updateError }).then(onOk);
          },
        };
        return q;
      },
    }),
  },
}));

jest.mock('../../lib/notifications', () => ({
  scheduleRecoveryReminder: jest.fn(),
  cancelRecoveryReminder: jest.fn(),
}));

// The real module plus a spy on its emission funnel. `buildEvent` is NOT
// stubbed: the privacy filter these tests assert on is the shipping one.
// Spying on `emitEvent` (rather than attaching a sink via
// `setAnalyticsSink`) is deliberate -- `emitEvent` swallows a sink's throw
// by design, so a sink-based spy could never show whether THIS STORE is
// safe against an analytics failure. AC "analytics never breaks the
// feature" below needs the throw to originate where the store calls it.
jest.mock('../../lib/analytics', () => ({
  __esModule: true,
  ...jest.requireActual('../../lib/analytics'),
  emitEvent: jest.fn(),
}));

import * as analytics from '../../lib/analytics';
import type { AnalyticsEvent } from '../../lib/analytics';
import { useRecoveryStore } from '../../store/recoveryStore';
import { cancelRecoveryReminder } from '../../lib/notifications';
import type { RecoveryPlan } from '../../lib/supabase';

const emit = (analytics as unknown as { emitEvent: jest.Mock }).emitEvent;

function emitted(name?: string): AnalyticsEvent[] {
  return emit.mock.calls
    .map((c) => c[0] as AnalyticsEvent)
    .filter((e) => name === undefined || e.name === name);
}

const HABIT_NAME = 'Akşam koşusu ve esneme';
const NOTE = 'Dün dizim ağrıdığı için atladım, bugün yarısını yaparım';

function planInput() {
  return {
    habitId: HABIT_ID,
    habitName: HABIT_NAME,
    sourceDate: '2026-08-29',
    targetDate: '2026-08-30',
    strategy: 'split_two_days' as const,
    note: NOTE,
    reminderTime: '19:00',
  };
}

function stagedPlan(): RecoveryPlan {
  return {
    id: PLAN_ID, user_id: 'u1', habit_id: HABIT_ID, source_log_id: null,
    source_date: '2026-08-29', target_date: '2026-08-30',
    deficit_type: null, deficit_value: null,
    strategy: 'skip', distributed_days: null, note: NOTE, reminder_time: null,
    status: 'planned', completed_at: null, created_at: '2026-08-29T20:00:00.000Z',
  };
}

beforeEach(() => {
  mockState.inserts = [];
  mockState.updates = [];
  mockState.insertError = null;
  mockState.updateError = null;
  mockState.user = { id: 'u1' };
  emit.mockReset();
  emit.mockImplementation(() => undefined);
  jest.clearAllMocks();
  useRecoveryStore.setState({ plans: [], loading: false });
});

describe('AC-1 -- addPlan success emits exactly one recovery_created', () => {
  it('emits once with the persisted plan, habit, strategy and dates', async () => {
    const plan = await useRecoveryStore.getState().addPlan(planInput());

    expect(plan).not.toBeNull();
    const evs = emitted('recovery_created');
    expect(evs).toHaveLength(1);
    expect(evs[0].props).toEqual({
      plan_id: PLAN_ID,
      habit_id: HABIT_ID,
      strategy: 'split_two_days',
      source_date: '2026-08-29',
      target_date: '2026-08-30',
      has_reminder: true,
    });
    expect(evs[0].dropped).toEqual([]);
  });
});

describe('AC-2 -- addPlan failure emits nothing', () => {
  it('no event when the insert is rejected', async () => {
    mockState.insertError = { message: 'foreign key violation' };

    const plan = await useRecoveryStore.getState().addPlan(planInput());

    expect(plan).toBeNull();
    expect(emitted()).toHaveLength(0);
  });

  it('no event when there is no signed-in user', async () => {
    mockState.user = null;

    const plan = await useRecoveryStore.getState().addPlan(planInput());

    expect(plan).toBeNull();
    expect(mockState.inserts).toHaveLength(0);
    expect(emitted()).toHaveLength(0);
  });
});

describe('AC-3 -- completePlan success emits exactly one recovery_completed', () => {
  it('reads habit/strategy from the plan in state, not from the caller', async () => {
    useRecoveryStore.setState({ plans: [stagedPlan()] });

    await useRecoveryStore.getState().completePlan(PLAN_ID);

    const evs = emitted('recovery_completed');
    expect(evs).toHaveLength(1);
    expect(evs[0].props).toEqual({
      plan_id: PLAN_ID,
      habit_id: HABIT_ID,
      strategy: 'skip',
      target_date: '2026-08-30',
    });
    expect(evs[0].dropped).toEqual([]);
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
  });
});

describe('AC-4 -- a rejected completion emits nothing but keeps its old behaviour', () => {
  it('no event when the update is rejected', async () => {
    useRecoveryStore.setState({ plans: [stagedPlan()] });
    mockState.updateError = { message: 'permission denied for table recovery_plans' };

    await useRecoveryStore.getState().completePlan(PLAN_ID);

    expect(emitted()).toHaveLength(0);
    // Unchanged pre-existing behaviour: the store still drops the plan and
    // still cancels the reminder. Only the EVENT is gated on the write.
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
    expect(cancelRecoveryReminder).toHaveBeenCalledWith(PLAN_ID);
  });
});

describe('AC-5 -- no free text reaches either event', () => {
  it('neither the habit name nor the recovery note appears on any event', async () => {
    await useRecoveryStore.getState().addPlan(planInput());
    useRecoveryStore.setState({ plans: [stagedPlan()] });
    await useRecoveryStore.getState().completePlan(PLAN_ID);

    const serialised = JSON.stringify(emitted());
    expect(emitted()).toHaveLength(2);
    expect(serialised).not.toContain('koşusu');
    expect(serialised).not.toContain('dizim');

    // The note IS persisted to the user's own recovery_plans row -- §22's
    // boundary is the analytics payload, not the database.
    expect(mockState.inserts[0].note).toBe(NOTE);
  });
});

describe('AC-6 -- analytics never breaks the feature', () => {
  it('a throwing sink still creates and still completes the plan', async () => {
    emit.mockImplementation(() => {
      throw new Error('sink exploded');
    });

    const plan = await useRecoveryStore.getState().addPlan(planInput());
    expect(plan).not.toBeNull();
    expect(useRecoveryStore.getState().plans).toHaveLength(1);

    await useRecoveryStore.getState().completePlan(PLAN_ID);
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});
