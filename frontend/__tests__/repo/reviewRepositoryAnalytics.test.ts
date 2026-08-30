/**
 * §22 analytics emission -- `repositories/reviewRepository.ts` /
 * `weekly_review_completed`.  (Phase 4)
 *
 * Behavioural, following `__tests__/store/*Analytics.test.ts`: the real
 * repository function runs against a stateful fake of `weekly_reviews`, the
 * REAL `buildEvent` privacy filter runs, and every assertion is made on the
 * event object that actually reaches the sink.
 *
 * The fake is stateful on purpose. The whole point of this event is "once per
 * review, not once per Kaydet", and that is only observable if the second
 * save can genuinely see what the first save wrote -- a stub that always
 * answers "no row" would let a double-firing implementation pass.
 *
 * Invariants:
 *  AC-1  first save of a week -> exactly one `weekly_review_completed`.
 *  AC-2  second save of the SAME week -> no further event, while the edit is
 *        still written.
 *  AC-3  first save of a DIFFERENT week -> does emit (the guard is scoped to
 *        `week_key`, not "once per app run").
 *  AC-4  a rejected upsert -> no event at all.
 *  AC-5  no session -> no event and no write.
 *  AC-6  a failed insert-vs-update probe -> no event, but the save still
 *        succeeds (analytics may not fail the user's action).
 *  AC-7  the payload carries no reflection prose, and the prose IS still
 *        persisted to the user's own row.
 *  AC-8  emission happens AFTER the write is confirmed, not alongside it.
 *  AC-9  a throwing sink does not break the save.
 */
type PgError = { message: string; code?: string } | null;
type Row = {
  id: string; user_id: string; week_key: string;
  wins: string | null; challenges: string | null; next_week: string | null;
  created_at: string;
};

const mockDb = {
  rows: [] as Row[],
  probeError: null as PgError,
  upsertError: null as PgError,
  user: { id: 'u1' } as { id: string } | null,
  upserts: [] as Record<string, unknown>[],
  onConflicts: [] as (string | undefined)[],
  /** Every column list `select()` was asked for -- see AC-7's prose note. */
  selectedColumns: [] as string[],
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: mockDb.user }, error: null }) },
    from: () => ({
      select: (cols: string) => {
        mockDb.selectedColumns.push(cols);
        const filters: Record<string, unknown> = {};
        const q = {
          eq(col: string, val: unknown) { filters[col] = val; return q; },
          maybeSingle: async () => {
            if (mockDb.probeError) return { data: null, error: mockDb.probeError };
            const row = mockDb.rows.find((r) =>
              Object.entries(filters).every(([c, v]) => (r as unknown as Record<string, unknown>)[c] === v));
            return { data: row ?? null, error: null };
          },
        };
        return q;
      },
      upsert: async (payload: Record<string, unknown>, opts?: { onConflict?: string }) => {
        mockDb.upserts.push(payload);
        mockDb.onConflicts.push(opts?.onConflict);
        if (mockDb.upsertError) return { error: mockDb.upsertError };
        // Real ON CONFLICT (user_id, week_key) semantics: update in place, or
        // insert. Without this the "second save" case would be theatre.
        const idx = mockDb.rows.findIndex(
          (r) => r.user_id === payload.user_id && r.week_key === payload.week_key,
        );
        if (idx >= 0) mockDb.rows[idx] = { ...mockDb.rows[idx], ...(payload as Partial<Row>) };
        else mockDb.rows.push({ id: `row-${mockDb.rows.length + 1}`, created_at: '2026-08-30T09:00:00.000Z', ...(payload as unknown as Omit<Row, 'id' | 'created_at'>) });
        return { error: null };
      },
    }),
  },
}));

// The real analytics module plus a spy on its emission funnel. `buildEvent`
// is NOT stubbed: the privacy filter these tests assert on is the shipping
// one. Spying on `emitEvent` rather than attaching a sink via
// `setAnalyticsSink` is deliberate -- `emitEvent` swallows a sink's throw by
// design, so a sink-based spy could never show whether THIS REPOSITORY is
// safe against an analytics failure (AC-9 needs the throw to originate where
// the repository calls it).
jest.mock('../../lib/analytics', () => ({
  __esModule: true,
  ...jest.requireActual('../../lib/analytics'),
  emitEvent: jest.fn(),
}));

import * as analytics from '../../lib/analytics';
import { ANALYTICS_EVENTS, buildEvent, type AnalyticsEvent } from '../../lib/analytics';
import { upsertWeeklyReview } from '../../repositories/reviewRepository';

const emit = (analytics as unknown as { emitEvent: jest.Mock }).emitEvent;

function emitted(name?: string): AnalyticsEvent[] {
  return emit.mock.calls
    .map((c) => c[0] as AnalyticsEvent)
    .filter((e) => name === undefined || e.name === name);
}

const WEEK = '2026-08-24';
const OTHER_WEEK = '2026-08-31';

const WINS = 'Sabah koşusuna üç gün üst üste çıktım, kendimi iyi hissettim';
const CHALLENGES = 'Akşamları telefonu bırakamadım, uykum kaçtı';
const NEXT_WEEK = 'Yatmadan bir saat önce ekranları kapatacağım';

function review(weekKey = WEEK) {
  return { weekKey, wins: WINS, challenges: CHALLENGES, next_week: NEXT_WEEK };
}

beforeEach(() => {
  mockDb.rows = [];
  mockDb.probeError = null;
  mockDb.upsertError = null;
  mockDb.user = { id: 'u1' };
  mockDb.upserts = [];
  mockDb.onConflicts = [];
  mockDb.selectedColumns = [];
  emit.mockReset();
  emit.mockImplementation(() => undefined);
});

describe('AC-1 -- the first save of a week emits exactly one weekly_review_completed', () => {
  it('emits once, carrying the week key and which questions were answered', async () => {
    const res = await upsertWeeklyReview(review());

    expect(res.ok).toBe(true);
    const evs = emitted('weekly_review_completed');
    expect(evs).toHaveLength(1);
    expect(evs[0].props).toEqual({
      week_key: WEEK,
      has_wins: true,
      has_challenges: true,
      has_next_week: true,
    });
    // Nothing was refused by the shape allowlist -- i.e. everything this
    // repository hands over is genuinely id/enum/date/boolean shaped, rather
    // than prose that happened to get filtered out on the way.
    expect(evs[0].dropped).toEqual([]);
    // No OTHER event slipped out of this call path.
    expect(emitted()).toHaveLength(1);
  });

  it('reports an unanswered question as false rather than omitting it', async () => {
    // '   ' is a blank box, not an answer.
    await upsertWeeklyReview({ weekKey: WEEK, wins: WINS, challenges: '   ', next_week: null });

    const evs = emitted('weekly_review_completed');
    expect(evs).toHaveLength(1);
    expect(evs[0].props).toEqual({
      week_key: WEEK,
      has_wins: true,
      has_challenges: false,
      has_next_week: false,
    });
  });

  it('emits a name that is actually declared in ANALYTICS_EVENTS', async () => {
    await upsertWeeklyReview(review());

    const evs = emitted();
    expect(evs).toHaveLength(1);
    expect(ANALYTICS_EVENTS).toContain(evs[0].name);
    expect(evs[0].name).toBe('weekly_review_completed');
  });
});

describe('AC-2 -- a second save of the same week emits nothing', () => {
  it('stays silent when the user reopens the week and edits their answers', async () => {
    const first = await upsertWeeklyReview(review());
    expect(first.ok).toBe(true);
    expect(emitted('weekly_review_completed')).toHaveLength(1);

    emit.mockClear();

    const second = await upsertWeeklyReview({
      weekKey: WEEK,
      wins: 'Düzelttim: dört gün çıkmışım',
      challenges: CHALLENGES,
      next_week: NEXT_WEEK,
    });

    // No second "completed" ...
    expect(emitted()).toHaveLength(0);
    // ... while the edit itself is still saved, in place, on the same row.
    expect(second.ok).toBe(true);
    expect(mockDb.upserts).toHaveLength(2);
    expect(mockDb.rows).toHaveLength(1);
    expect(mockDb.rows[0].wins).toBe('Düzelttim: dört gün çıkmışım');
    expect(mockDb.onConflicts).toEqual(['user_id,week_key', 'user_id,week_key']);
  });

  it('stays silent on the third, fourth and fifth save too', async () => {
    await upsertWeeklyReview(review());
    emit.mockClear();

    for (let i = 0; i < 4; i += 1) await upsertWeeklyReview(review());

    expect(emitted()).toHaveLength(0);
    expect(mockDb.upserts).toHaveLength(5);
  });

  it('stays silent when the week was completed on a previous run of the app', async () => {
    // No event has been emitted by THIS process; the row simply already
    // exists. A guard implemented as in-memory "have I fired yet?" state
    // would wrongly emit here.
    mockDb.rows = [{
      id: 'row-existing', user_id: 'u1', week_key: WEEK,
      wins: WINS, challenges: CHALLENGES, next_week: NEXT_WEEK,
      created_at: '2026-08-24T18:00:00.000Z',
    }];

    const res = await upsertWeeklyReview(review());

    expect(res.ok).toBe(true);
    expect(emitted()).toHaveLength(0);
  });
});

describe('AC-3 -- the guard is scoped to the week, not to the session', () => {
  it('a different week still emits its own completion', async () => {
    await upsertWeeklyReview(review(WEEK));
    await upsertWeeklyReview(review(WEEK));            // edit -- silent
    await upsertWeeklyReview(review(OTHER_WEEK));      // new week -- emits

    const evs = emitted('weekly_review_completed');
    expect(evs).toHaveLength(2);
    expect(evs.map((e) => e.props.week_key)).toEqual([WEEK, OTHER_WEEK]);
  });

  it('another user\'s row for the same week does not suppress this user\'s event', async () => {
    mockDb.rows = [{
      id: 'row-other-user', user_id: 'u2', week_key: WEEK,
      wins: 'x', challenges: 'y', next_week: 'z',
      created_at: '2026-08-24T18:00:00.000Z',
    }];

    await upsertWeeklyReview(review());

    expect(emitted('weekly_review_completed')).toHaveLength(1);
  });
});

describe('AC-4 -- a rejected write emits nothing', () => {
  it('no event when the upsert fails', async () => {
    mockDb.upsertError = { message: 'permission denied for table weekly_reviews' };

    const res = await upsertWeeklyReview(review());

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe('permission denied for table weekly_reviews');
    expect(emitted()).toHaveLength(0);
    // And nothing was persisted, so a later successful save is still a first save.
    expect(mockDb.rows).toHaveLength(0);
  });

  it('a save that failed once and then succeeded emits exactly one event', async () => {
    mockDb.upsertError = { message: 'network' };
    await upsertWeeklyReview(review());
    expect(emitted()).toHaveLength(0);

    mockDb.upsertError = null;
    await upsertWeeklyReview(review());

    expect(emitted('weekly_review_completed')).toHaveLength(1);
  });
});

describe('AC-5 -- no session means no event and no write', () => {
  it('emits nothing and writes nothing when there is no signed-in user', async () => {
    mockDb.user = null;

    const res = await upsertWeeklyReview(review());

    expect(res.ok).toBe(false);
    expect(mockDb.upserts).toHaveLength(0);
    expect(emitted()).toHaveLength(0);
  });
});

describe('AC-6 -- an unusable probe is silent, and never fails the save', () => {
  it('saves successfully but emits nothing when the insert-vs-update probe errors', async () => {
    mockDb.probeError = { message: 'read timeout' };

    const res = await upsertWeeklyReview(review());

    // The save is the user's action and it went through.
    expect(res.ok).toBe(true);
    expect(mockDb.upserts).toHaveLength(1);
    expect(mockDb.rows).toHaveLength(1);
    // The probe could not prove this was a first save, so nothing is claimed.
    expect(emitted()).toHaveLength(0);
  });
});

describe('AC-7 -- no free text reaches the event', () => {
  it('carries exactly four keys, none of them the user\'s reflection', async () => {
    await upsertWeeklyReview(review());

    const evs = emitted('weekly_review_completed');
    expect(evs).toHaveLength(1);
    // Key-set equality, not a substring scan: a future author who adds
    // `wins: params.wins` fails HERE, before the filter is even consulted.
    expect(Object.keys(evs[0].props).sort()).toEqual(
      ['has_challenges', 'has_next_week', 'has_wins', 'week_key'],
    );

    const serialised = JSON.stringify(evs);
    expect(serialised).not.toContain('koşusuna');
    expect(serialised).not.toContain('telefonu');
    expect(serialised).not.toContain('ekranları');

    // The reflection IS persisted to the user's own weekly_reviews row --
    // §22's boundary is the analytics payload, not the database.
    expect(mockDb.upserts[0].wins).toBe(WINS);
    expect(mockDb.upserts[0].challenges).toBe(CHALLENGES);
    expect(mockDb.upserts[0].next_week).toBe(NEXT_WEEK);
  });

  it('scanner sanity -- the real buildEvent would have caught this prose', () => {
    // Proves the three `not.toContain` assertions above are load-bearing:
    // these exact strings ARE detectable, and the shipping filter refuses
    // them rather than the test merely failing to look in the right place.
    const leaked = JSON.stringify({ props: { wins: WINS, challenges: CHALLENGES, next_week: NEXT_WEEK } });
    expect(leaked).toContain('koşusuna');
    expect(leaked).toContain('telefonu');
    expect(leaked).toContain('ekranları');

    const ev = buildEvent('weekly_review_completed', {
      week_key: WEEK, wins: WINS, challenges: CHALLENGES, next_week: NEXT_WEEK,
    });
    expect(ev.dropped.sort()).toEqual(['challenges', 'next_week', 'wins']);
    expect(JSON.stringify(ev)).not.toContain('koşusuna');
    expect(ev.props.week_key).toBe(WEEK);
  });

  it('the probe reads only `id`, so prose is never even fetched for analytics', async () => {
    await upsertWeeklyReview(review());

    expect(mockDb.selectedColumns).toEqual(['id']);
    expect(mockDb.selectedColumns).not.toContain('*');
  });
});

describe('AC-8 -- the event follows the write, it does not race it', () => {
  it('the row is already persisted at the moment the event is emitted', async () => {
    let rowsAtEmit: number | null = null;
    emit.mockImplementation(() => {
      rowsAtEmit = mockDb.rows.length;
    });

    await upsertWeeklyReview(review());

    expect(emitted('weekly_review_completed')).toHaveLength(1);
    // Not `toBeTruthy`: if nothing were emitted this would stay null and a
    // truthiness check on 0-vs-null would be a coin flip.
    expect(rowsAtEmit).toBe(1);
  });
});

describe('AC-9 -- analytics never breaks the save', () => {
  it('a throwing sink still saves the review and still returns ok', async () => {
    emit.mockImplementation(() => {
      throw new Error('sink exploded');
    });

    const res = await upsertWeeklyReview(review());

    expect(res.ok).toBe(true);
    expect(mockDb.rows).toHaveLength(1);
    expect(mockDb.rows[0].wins).toBe(WINS);
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it('a throwing sink on the first save does not turn the second save into a first one', async () => {
    emit.mockImplementation(() => {
      throw new Error('sink exploded');
    });
    await upsertWeeklyReview(review());

    emit.mockReset();
    emit.mockImplementation(() => undefined);
    const second = await upsertWeeklyReview(review());

    expect(second.ok).toBe(true);
    expect(emitted()).toHaveLength(0);
  });
});
