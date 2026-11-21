/**
 * F13 — recoveryStore.completePlan preserves plan and reminder when local outbox
 * write fails, while keeping device-first behaviour on server rejection (STO-14, DOM-22).
 */
type PgError = { message: string } | null;

const mockState = {
  updateError: null as PgError,
  user: { id: 'u1' } as { id: string } | null,
};

const PLAN_ID = '11111111-2222-4333-8444-555555555555';
const HABIT_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async function (this: any) {
        const r = await this.getUser();
        return { data: { session: r.data.user ? { user: r.data.user, access_token: 'test-jwt' } : null } };
      },
      getUser: async () => ({ data: { user: mockState.user } }),
    },
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        const q: any = {
          eq: () => q,
          select: () => ({
            maybeSingle: async () => {
              if (mockState.updateError) return { data: null, error: mockState.updateError };
              return { data: { id: PLAN_ID, ...patch }, error: null };
            },
          }),
          then: (onOk: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: mockState.updateError }).then(onOk),
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

jest.mock('../../lib/analytics', () => ({
  __esModule: true,
  ...jest.requireActual('../../lib/analytics'),
  emitEvent: jest.fn(),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as analytics from '../../lib/analytics';
import type { AnalyticsEvent } from '../../lib/analytics';
import { cancelRecoveryReminder } from '../../lib/notifications';
import type { RecoveryPlan } from '../../lib/supabase';
import { coreOutbox } from '../../services/coreOutbox';
import { useRecoveryStore } from '../../store/recoveryStore';

const emit = (analytics as unknown as { emitEvent: jest.Mock }).emitEvent;

function makePlan(overrides: Partial<RecoveryPlan> = {}): RecoveryPlan {
  return {
    id: PLAN_ID,
    user_id: 'u1',
    habit_id: HABIT_ID,
    source_log_id: null,
    source_date: '2026-08-29',
    target_date: '2026-08-30',
    deficit_type: null,
    deficit_value: null,
    strategy: 'complete_today',
    distributed_days: null,
    note: null,
    reminder_time: '20:00',
    status: 'planned',
    completed_at: null,
    created_at: '2026-08-29T20:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  coreOutbox.reset();
  await AsyncStorage.clear();
  mockState.updateError = null;
  mockState.user = { id: 'u1' };
  emit.mockReset();
  emit.mockImplementation(() => undefined);
  jest.clearAllMocks();
  useRecoveryStore.setState({ plans: [], loading: false });
});

describe('F13 STO-14 / DOM-22 — completePlan local write failure vs success', () => {
  it('returns false, keeps plan in state, does NOT cancel reminder, and cleans completionMeta when coreOutbox.write fails', async () => {
    const firstPlan = makePlan({ strategy: 'complete_today', target_date: '2026-08-30' });
    useRecoveryStore.setState({ plans: [firstPlan] });

    const writeSpy = jest.spyOn(coreOutbox, 'write').mockResolvedValueOnce({
      ok: false,
      error: 'depolama dolu',
    });

    const ok = await useRecoveryStore.getState().completePlan(PLAN_ID);
    expect(ok).toBe(false);
    expect(useRecoveryStore.getState().plans).toHaveLength(1);
    expect(cancelRecoveryReminder).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();

    writeSpy.mockRestore();

    // Update the staged plan's metadata and retry with working storage:
    // proves stale completionMeta was deleted and fresh metadata is reported.
    useRecoveryStore.setState({
      plans: [makePlan({ strategy: 'push_tomorrow', target_date: '2026-08-31' })],
    });
    const retryOk = await useRecoveryStore.getState().completePlan(PLAN_ID);
    expect(retryOk).toBe(true);
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
    expect(cancelRecoveryReminder).toHaveBeenCalledWith(PLAN_ID);

    const events = emit.mock.calls.map((c) => c[0] as AnalyticsEvent);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      name: 'recovery_completed',
      props: {
        plan_id: PLAN_ID,
        habit_id: HABIT_ID,
        strategy: 'push_tomorrow',
        target_date: '2026-08-31',
      },
    });
  });

  it('device-first contract (AC-4): when local outbox write succeeds but server rejects delivery, completePlan still returns true and removes locally', async () => {
    useRecoveryStore.setState({ plans: [makePlan()] });
    mockState.updateError = { message: 'permission denied' };

    const ok = await useRecoveryStore.getState().completePlan(PLAN_ID);
    expect(ok).toBe(true);
    expect(useRecoveryStore.getState().plans).toHaveLength(0);
    expect(cancelRecoveryReminder).toHaveBeenCalledWith(PLAN_ID);
    expect(emit).not.toHaveBeenCalled();
  });
});
