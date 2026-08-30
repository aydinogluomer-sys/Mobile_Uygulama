/**
 * §22 analytics emission from the STORE.  (Phase 4)
 *
 * WHY THE STORE AND NOT A SCREEN, restated as the thing these tests actually
 * prove: a habit is completed from `today.tsx`, `timeline.tsx` and
 * `recovery.tsx` today, and from a deep link tomorrow. An event emitted by a
 * screen fires only for the taps that happen to pass through that screen, and
 * the gap is invisible — a missing event looks exactly like a user who did
 * not do the thing. So the assertions below drive `useLogStore.logHabit`
 * directly, with NO component rendered: if the emission depended on a screen,
 * every one of them would be silent.
 *
 * AC-A01  `done` emits `habit_completed`, `partial` -> `habit_partial`,
 *         `miss` -> `habit_missed`. Exactly one event per call.
 * AC-A02  `skip` emits NOTHING and does not throw — plan §22 declares no
 *         `habit_skipped`, and `buildEvent` throws on an undeclared name.
 * AC-A03  a REJECTED write emits nothing. `logHabit` rolls the optimistic
 *         value back; counting a completion the user did not get would make
 *         the metric lie in the one direction that flatters the product.
 * AC-A04  an OFFLINE tap still emits. Under plan §18 the tap IS the
 *         completion; the write is merely owed.
 * AC-A05  the later replay (`flushPendingSync`) does NOT re-emit — one user
 *         completion is one event, not two.
 * AC-A06  the payload carries ids/enum/date/counts ONLY, and `dropped` is
 *         empty: the store's payload is clean BY CONSTRUCTION, not because
 *         the allowlist rescued it. A payload that relies on the scrubber is
 *         one refactor from leaking.
 * AC-A07  a throwing sink does not fail the habit completion.
 *
 * Mock style mirrors `logStoreOfflineSync.test.ts` (a fake
 * `../../lib/supabase`), kept local to this file rather than shared, per the
 * same "no existing test file changes" constraint.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAnalyticsSink, type AnalyticsEvent } from '../../lib/analytics';

type Row = {
  id: string; habit_id: string; user_id: string; completed_at: string;
  value: number | null; is_completed: boolean; state: string;
  xp: number | null; created_at: string;
};
type PgError = { message: string; code?: string };

const mockDb = {
  calls: [] as string[],
  rows: [] as Row[],
  idSeq: 0,
  networkDown: false,
  insertError: null as PgError | null,
};

jest.mock('../../lib/supabase', () => {
  const match = (filters: Record<string, unknown>) =>
    mockDb.rows.filter((r) =>
      Object.entries(filters).every(
        ([k, v]) => (r as unknown as Record<string, unknown>)[k] === v));

  return {
    supabase: {
      auth: {
        getUser: jest.fn().mockImplementation(async () => {
          if (mockDb.networkDown) throw new TypeError('Network request failed');
          return { data: { user: { id: 'u1' } } };
        }),
      },
      from: () => ({
        select: () => {
          const filters: Record<string, unknown> = {};
          const q = {
            eq(col: string, val: unknown) { filters[col] = val; return q; },
            async maybeSingle() {
              if (mockDb.networkDown) throw new TypeError('Network request failed');
              mockDb.calls.push('select');
              return { data: match(filters)[0] ?? null, error: null };
            },
          };
          return q;
        },
        insert(payload: Record<string, unknown>) {
          return {
            select: () => ({
              single: async () => {
                if (mockDb.networkDown) throw new TypeError('Network request failed');
                mockDb.calls.push('insert');
                if (mockDb.insertError) return { data: null, error: mockDb.insertError };
                const dup = mockDb.rows.find((r) =>
                  r.habit_id === payload.habit_id && r.completed_at === payload.completed_at);
                if (dup) {
                  return {
                    data: null,
                    error: { message: 'duplicate key value violates unique constraint', code: '23505' },
                  };
                }
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
                if (mockDb.networkDown) throw new TypeError('Network request failed');
                mockDb.calls.push('update');
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
  };
});

import { useLogStore } from '../../store/logStore';

const DAY = new Date(2026, 7, 4);
const DATE_STR = '2026-08-04';
const HABIT = '2b1a9f60-7c3e-4d21-9f88-0a1b2c3d4e5f';

let events: AnalyticsEvent[] = [];

beforeEach(async () => {
  mockDb.calls.length = 0;
  mockDb.rows.length = 0;
  mockDb.idSeq = 0;
  mockDb.networkDown = false;
  mockDb.insertError = null;
  await AsyncStorage.clear();
  useLogStore.setState({ logs: [], loading: false, pendingSyncCount: 0, deadSyncCount: 0 });
  await useLogStore.getState().hydrateSyncQueue();
  events = [];
  setAnalyticsSink((e) => { events.push(e); });
});

afterEach(() => setAnalyticsSink(null));

describe('AC-A01 — one event per completion, named by log state', () => {
  it('done -> habit_completed', async () => {
    const res = await useLogStore.getState().logHabit({ habitId: HABIT, date: DAY, state: 'done' });
    expect(res.ok).toBe(true);
    expect(events.map((e) => e.name)).toEqual(['habit_completed']);
  });

  it('partial -> habit_partial', async () => {
    await useLogStore.getState().logHabit({
      habitId: HABIT, date: DAY, state: 'partial', value: 2, targetValue: 4,
    });
    expect(events.map((e) => e.name)).toEqual(['habit_partial']);
  });

  it('miss -> habit_missed', async () => {
    await useLogStore.getState().logHabit({ habitId: HABIT, date: DAY, state: 'miss' });
    expect(events.map((e) => e.name)).toEqual(['habit_missed']);
  });

  it('two separate taps are two separate events', async () => {
    await useLogStore.getState().logHabit({ habitId: HABIT, date: DAY, state: 'done' });
    await useLogStore.getState().logHabit({ habitId: HABIT, date: DAY, state: 'miss' });
    expect(events.map((e) => e.name)).toEqual(['habit_completed', 'habit_missed']);
  });
});

describe('AC-A02 — `skip` has no declared event and must not become a crash', () => {
  it('emits nothing and still writes the log', async () => {
    const res = await useLogStore.getState().logHabit({ habitId: HABIT, date: DAY, state: 'skip' });
    expect(res.ok).toBe(true);
    expect(events).toHaveLength(0);
    expect(mockDb.rows).toHaveLength(1);
    expect(mockDb.rows[0].state).toBe('skip');
  });
});

describe('AC-A03 — a rejected write emits nothing', () => {
  it('no completion is counted for a write the user did not get', async () => {
    mockDb.insertError = { message: 'RLS denied' };
    const res = await useLogStore.getState().logHabit({ habitId: HABIT, date: DAY, state: 'done' });
    expect(res.ok).toBe(false);
    expect(events).toHaveLength(0);
    // and the optimistic value really was rolled back, so "no event" matches
    // what the user sees rather than merely being a missing emission.
    expect(useLogStore.getState().getLogForHabit(HABIT, DATE_STR)).toBeUndefined();
  });
});

describe('AC-A04 / AC-A05 — offline counts once, replay does not count again', () => {
  it('an offline tap emits, and the later replay does not re-emit', async () => {
    mockDb.networkDown = true;
    const res = await useLogStore.getState().logHabit({ habitId: HABIT, date: DAY, state: 'done' });
    expect(res.ok).toBe(true);
    expect(events.map((e) => e.name)).toEqual(['habit_completed']);
    expect(useLogStore.getState().pendingSyncCount).toBe(1);

    mockDb.networkDown = false;
    await useLogStore.getState().flushPendingSync();

    expect(mockDb.rows).toHaveLength(1);
    expect(useLogStore.getState().pendingSyncCount).toBe(0);
    // Still ONE event: the completion happened once, however many round trips
    // it took to land.
    expect(events.map((e) => e.name)).toEqual(['habit_completed']);
  });

  it('a cold-start replay of a queue this session never tapped emits nothing at all', async () => {
    const { enqueue, emptyQueueState, saveSyncQueue } = require('../../lib/syncQueue');
    const persisted = enqueue(emptyQueueState(), HABIT, DATE_STR, { state: 'done', baseXp: 30 });
    await saveSyncQueue(persisted.state);
    await useLogStore.getState().hydrateSyncQueue();

    await useLogStore.getState().flushPendingSync();

    expect(mockDb.rows).toHaveLength(1); // the write really did happen
    expect(events).toHaveLength(0);      // but the tap was counted last session
  });
});

describe('AC-A06 — the payload is ids/enum/date/counts only, by construction', () => {
  it('carries exactly the declared keys and nothing was scrubbed', async () => {
    await useLogStore.getState().logHabit({
      habitId: HABIT, date: DAY, state: 'partial', value: 2, targetValue: 4, baseXp: 30,
    });

    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(Object.keys(ev.props).sort()).toEqual(['date', 'habit_id', 'state', 'value', 'xp']);
    expect(ev.props.habit_id).toBe(HABIT);
    expect(ev.props.date).toBe(DATE_STR);
    expect(ev.props.state).toBe('partial');
    expect(ev.props.value).toBe(2);
    expect(typeof ev.props.xp).toBe('number');
    // `dropped` empty is the real assertion: the store never HANDED the
    // allowlist anything prose-shaped. A non-empty `dropped` would mean the
    // call site is passing free text and only the scrubber is saving it.
    expect(ev.dropped).toEqual([]);
  });

  it('no value in the payload is prose-shaped', async () => {
    await useLogStore.getState().logHabit({ habitId: HABIT, date: DAY, state: 'done' });
    for (const v of Object.values(events[0].props)) {
      if (typeof v !== 'string') continue;
      expect(v).not.toMatch(/\s/);       // no sentences
      expect(v.length).toBeLessThan(64); // no essays
    }
  });
});

describe('AC-A07 — analytics can never fail a habit completion', () => {
  it('a throwing sink leaves logHabit successful and the row written', async () => {
    setAnalyticsSink(() => { throw new Error('transport exploded'); });

    const res = await useLogStore.getState().logHabit({ habitId: HABIT, date: DAY, state: 'done' });

    expect(res.ok).toBe(true);
    expect(mockDb.rows).toHaveLength(1);
    expect(mockDb.rows[0].state).toBe('done');
    expect(useLogStore.getState().getLogForHabit(HABIT, DATE_STR)?.state).toBe('done');
  });
});
