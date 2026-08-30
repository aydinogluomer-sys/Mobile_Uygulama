/**
 * §22 analytics emission -- `store/habitStore.ts` / `habit_created`.
 * (task Phase-4 CODER-O)
 *
 * `lib/analytics.ts` was complete but INERT: it declared an event vocabulary
 * and a privacy filter that nothing in production ever called. These tests
 * exist to keep the wiring honest, and they are deliberately BEHAVIOURAL --
 * they call the real store action and inspect the real `AnalyticsEvent` that
 * comes out the other end. A source-text assertion (`habitStore.ts` contains
 * the string 'habit_created') would go green for a match in a comment, in a
 * dead branch, or in a completely different function in the same file; this
 * repo has been burned by exactly that four times.
 *
 * The mock keeps the REAL `buildEvent` (via `requireActual`) and replaces
 * only `emitEvent`, so every assertion below runs through the actual privacy
 * filter rather than a stand-in for it.
 *
 * Invariants:
 *  AC-1  one successful create -> exactly one `habit_created`.
 *  AC-2  a create that FAILS (insert error, or no session) -> no event.
 *  AC-3  no free text on the event: the habit's Turkish title, cue note and
 *        life area never reach the payload, and nothing is `dropped` either
 *        (a dropped key would mean the call site tried to send prose).
 *  AC-4  a throwing analytics sink does not break the user action.
 */
type PgError = { message: string } | null;

const mockState = {
  insertedRows: [] as Record<string, unknown>[],
  error: null as PgError,
  user: { id: 'u1' } as { id: string } | null,
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
       getUser: async () => ({ data: { user: mockState.user } }) },
    from: () => ({
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            mockState.insertedRows.push(row);
            if (mockState.error) return { data: null, error: mockState.error };
            return {
              data: {
                id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
                user_id: 'u1',
                created_at: '2026-08-30T09:00:00.000Z',
                ...row,
              },
              error: null,
            };
          },
        }),
      }),
    }),
  },
}));

jest.mock('../../lib/notifications', () => ({
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
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
import { useHabitStore } from '../../store/habitStore';
import type { Habit } from '../../lib/supabase';

const emit = (analytics as unknown as { emitEvent: jest.Mock }).emitEvent;

function emitted(name?: string): AnalyticsEvent[] {
  return emit.mock.calls
    .map((c) => c[0] as AnalyticsEvent)
    .filter((e) => name === undefined || e.name === name);
}

/** Prose fields are Turkish user text on purpose -- they must not survive. */
const TITLE = 'Sabah yürüyüşü ve nefes egzersizi';
const CUE_NOTE = 'Kahvaltıdan hemen sonra, balkonda';

function newHabitInput(): Omit<Habit, 'id' | 'created_at' | 'user_id'> {
  return {
    name: TITLE,
    icon: 'walk-outline',
    color: '#4F8A8B',
    behavior_type: 'positive',
    tracking_type: 'boolean',
    unit: null,
    daily_goal: null,
    target_direction: null,
    frequency_config: { kind: 'daily' },
    willpower_cost: 3,
    status: 'active',
    impact_level: 'high',
    urgency: 'not_urgent',
    difficulty: 3,
    estimated_minutes: 20,
    reminders: { time: '07:30', enabled: true },
    cue_habit_id: null,
    cue_note: CUE_NOTE,
    life_area: 'Sağlık ve Zindelik',
    end_condition: null,
  };
}

beforeEach(() => {
  mockState.insertedRows = [];
  mockState.error = null;
  mockState.user = { id: 'u1' };
  emit.mockReset();
  emit.mockImplementation(() => undefined);
  useHabitStore.setState({ habits: [], loading: false });
});

describe('AC-1 -- a successful create emits exactly one habit_created', () => {
  it('emits once, with the row that was actually written', async () => {
    const created = await useHabitStore.getState().addHabit(newHabitInput());

    expect(created).not.toBeNull();
    const evs = emitted('habit_created');
    expect(evs).toHaveLength(1);
    expect(evs[0].props).toEqual({
      habit_id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa',
      behavior_type: 'positive',
      tracking_type: 'boolean',
      status: 'active',
      difficulty: 3,
      estimated_minutes: 20,
      willpower_cost: 3,
      has_reminder: true,
    });
  });

  it('emits once per create, not once per habit in local state', async () => {
    await useHabitStore.getState().addHabit(newHabitInput());
    await useHabitStore.getState().addHabit(newHabitInput());
    expect(emitted('habit_created')).toHaveLength(2);
    expect(useHabitStore.getState().habits).toHaveLength(2);
  });
});

describe('AC-2 -- a create that fails emits nothing', () => {
  it('no event when the insert is rejected', async () => {
    mockState.error = { message: 'new row violates row-level security policy' };

    const created = await useHabitStore.getState().addHabit(newHabitInput());

    expect(created).toBeNull();
    expect(useHabitStore.getState().habits).toHaveLength(0);
    expect(emitted()).toHaveLength(0);
  });

  it('no event when there is no signed-in user (the insert never happens)', async () => {
    mockState.user = null;

    const created = await useHabitStore.getState().addHabit(newHabitInput());

    expect(created).toBeNull();
    expect(mockState.insertedRows).toHaveLength(0);
    expect(emitted()).toHaveLength(0);
  });
});

describe('AC-3 -- no free text reaches the event', () => {
  it('carries no habit title, cue note or life area, and drops nothing', async () => {
    await useHabitStore.getState().addHabit(newHabitInput());

    const ev = emitted('habit_created')[0];
    const serialised = JSON.stringify(ev);
    expect(serialised).not.toContain('yürüyüş');
    expect(serialised).not.toContain('Kahvaltı');
    expect(serialised).not.toContain('Sağlık');

    // The title WAS written to the habits row -- the user's own data in the
    // user's own table. §22's boundary is the analytics payload, and that is
    // the difference this asserts.
    expect(mockState.insertedRows[0].name).toBe(TITLE);

    // Nothing dropped => the call site never even attempted to send prose.
    // (If someone adds `name: h.name` to the payload, the filter refuses it
    // and this turns red, which is exactly the alarm we want.)
    expect(ev.dropped).toEqual([]);
    for (const value of Object.values(ev.props)) {
      expect(typeof value === 'string' ? value.length <= 36 : true).toBe(true);
    }
  });
});

describe('AC-4 -- analytics never breaks the feature', () => {
  it('a throwing sink still leaves the habit created and returned', async () => {
    emit.mockImplementation(() => {
      throw new Error('sink exploded');
    });

    const created = await useHabitStore.getState().addHabit(newHabitInput());

    expect(created).not.toBeNull();
    expect(created!.name).toBe(TITLE);
    expect(useHabitStore.getState().habits).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
