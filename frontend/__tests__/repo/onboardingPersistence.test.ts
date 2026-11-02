/**
 * Onboarding answers survive the app, and never leak between accounts.
 *
 * ## Why this is server-persisted, and why the test proves it that way
 *
 * The brief is explicit: completion state must survive logout/login,
 * reinstall and a second device. That rules out AsyncStorage, and it means
 * the assertions here have to be about a row, not about a flag — so the fake
 * used is the STORING one (`__tests__/helpers/supabaseMock.ts`), which applies
 * the filters the repository actually builds. A repository that forgot
 * `.eq('user_id', …)` returns the other account's answers and AC-OP03 fails,
 * which a call-recording mock could never see.
 *
 * AC-OP00  no row is a value, not an error — that is what "new user" looks like
 * AC-OP01  write → read → re-read: the answers come back
 * AC-OP02  a second write updates the one row rather than adding another
 * AC-OP03  account isolation, in both directions
 * AC-OP04  `completed_at` is derived from `status`, never passed in
 */
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

const mockDb: MockDb = createMockDb();
const mockSession: { userId: string | null } = { userId: 'u1' };
const mockClient = makeSupabaseMock(mockDb);

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: {
          session: mockSession.userId
            ? { user: { id: mockSession.userId }, access_token: 't' }
            : null,
        },
        error: null,
      }),
    },
    from: (table: string) => mockClient.from(table),
  },
}));

import { fetchOnboarding, writeOnboarding } from '../../repositories/onboardingRepository';
import { EMPTY_ANSWERS, type OnboardingAnswers } from '../../lib/onboarding';

const ANSWERS: OnboardingAnswers = {
  goals: ['sleep', 'health_energy'],
  primaryBarrier: 'consistency',
  pace: 'gentle',
  preferredDayparts: ['morning', 'bedtime'],
  reminderIntent: true,
};

async function as<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  const previous = mockSession.userId;
  mockSession.userId = userId;
  try { return await fn(); } finally { mockSession.userId = previous; }
}

function unwrap<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r.data;
}

beforeEach(() => {
  for (const key of Object.keys(mockDb.rows)) delete mockDb.rows[key];
  mockDb.inserts.length = 0;
  mockDb.idSeq = 0;
  mockDb.failNext = null;
  mockSession.userId = 'u1';
});

describe('AC-OP00 a missing row is "new user", not a failure', () => {
  it('returns null rather than an error', () => {
    return fetchOnboarding().then((res) => {
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.data).toBeNull();
    });
  });

  it('a signed-out caller DOES get an error', async () => {
    // The distinction matters: the router must not read "we could not ask" as
    // "they are new" and push somebody into a first-run flow.
    const res = await as(null, () => fetchOnboarding());
    expect(res.ok).toBe(false);
  });
});

describe('AC-OP01/OP02 the answers persist and stay one row', () => {
  it('write → read → re-read', async () => {
    const written = unwrap(await writeOnboarding({ answers: ANSWERS, status: 'pending' }));
    expect(written.user_id).toBe('u1');
    expect(written.goals).toEqual(['sleep', 'health_energy']);

    const read = unwrap(await fetchOnboarding());
    expect(read).not.toBeNull();
    expect(read!.primary_barrier).toBe('consistency');
    expect(read!.pace).toBe('gentle');
    expect(read!.preferred_dayparts).toEqual(['morning', 'bedtime']);
    expect(read!.reminder_intent).toBe(true);

    // A second, independent read — what a relaunch does.
    const again = unwrap(await fetchOnboarding());
    expect(again!.goals).toEqual(['sleep', 'health_energy']);
  });

  it('a second write updates rather than duplicating', async () => {
    await writeOnboarding({ answers: ANSWERS, status: 'pending' });
    await writeOnboarding({ answers: { ...ANSWERS, pace: 'intensive' }, status: 'pending' });

    expect(mockDb.rows.user_onboarding).toHaveLength(1);
    expect(unwrap(await fetchOnboarding())!.pace).toBe('intensive');
  });

  it('an empty answer set is storable — a skipped user still has a row', async () => {
    const row = unwrap(await writeOnboarding({ answers: EMPTY_ANSWERS, status: 'skipped' }));
    expect(row.status).toBe('skipped');
    expect(row.goals).toEqual([]);
    expect(row.primary_barrier).toBeNull();
  });
});

describe('AC-OP03 account isolation', () => {
  it('another account\'s answers are invisible', async () => {
    mockDb.rows.user_onboarding = [{
      id: 'foreign', user_id: 'u2', onboarding_version: 1,
      goals: ['finance'], primary_barrier: 'motivation', pace: 'intensive',
      preferred_dayparts: ['evening'], reminder_intent: false,
      status: 'completed', completed_at: 'then', created_at: 'now', updated_at: 'now',
    } as never];

    expect(unwrap(await fetchOnboarding())).toBeNull();
  });

  it('writing does not overwrite theirs', async () => {
    mockDb.rows.user_onboarding = [{
      id: 'foreign', user_id: 'u2', onboarding_version: 1,
      goals: ['finance'], primary_barrier: 'motivation', pace: 'intensive',
      preferred_dayparts: ['evening'], reminder_intent: false,
      status: 'completed', completed_at: 'then', created_at: 'now', updated_at: 'now',
    } as never];

    await writeOnboarding({ answers: ANSWERS, status: 'pending' });

    // Two rows now: mine and theirs, untouched. The upsert conflict target is
    // `user_id`, and `user_id` comes from the session — never from a caller —
    // so it cannot be aimed at somebody else's record.
    expect(mockDb.rows.user_onboarding).toHaveLength(2);
    const theirs = mockDb.rows.user_onboarding.find((r) => r.user_id === 'u2');
    expect(theirs?.pace).toBe('intensive');
    expect(theirs?.status).toBe('completed');
  });

  it('each account reads only its own', async () => {
    await writeOnboarding({ answers: ANSWERS, status: 'pending' });
    await as('u2', () => writeOnboarding({
      answers: { ...EMPTY_ANSWERS, pace: 'intensive' }, status: 'completed',
    }));

    expect(unwrap(await fetchOnboarding())!.pace).toBe('gentle');
    const other = unwrap(await as('u2', () => fetchOnboarding()));
    expect(other!.pace).toBe('intensive');
  });
});

describe('AC-OP04 completed_at is derived from status', () => {
  it('completed carries a timestamp', async () => {
    const row = unwrap(await writeOnboarding({ answers: ANSWERS, status: 'completed' }));
    expect(row.status).toBe('completed');
    expect(row.completed_at).not.toBeNull();
    expect(Number.isNaN(Date.parse(row.completed_at!))).toBe(false);
  });

  it.each(['pending', 'skipped', 'legacy'] as const)('%s carries none', async (status) => {
    // The live CHECK `user_onboarding_completed_at_agrees_with_status` rejects
    // any other combination, so a caller that could set this independently
    // would eventually write a row the database refuses — surfacing to the
    // user as a failed save at the end of the flow.
    const row = unwrap(await writeOnboarding({ answers: ANSWERS, status }));
    expect(row.completed_at).toBeNull();
  });

  it('moving from completed back to pending clears the timestamp', async () => {
    await writeOnboarding({ answers: ANSWERS, status: 'completed' });
    const row = unwrap(await writeOnboarding({ answers: ANSWERS, status: 'pending' }));
    expect(row.completed_at).toBeNull();
  });
});

describe('AC-OP05 (F06) a failed read says whether the server was reached', () => {
  afterEach(() => { mockDb.failNextRead = null; });

  it('status 0 (the request never completed) is offline, with its status', async () => {
    mockDb.failNextRead = { error: 'TypeError: Network request failed', status: 0 };
    await expect(fetchOnboarding()).resolves.toMatchObject({ ok: false, offline: true, status: 0 });
  });

  it('a 503 reached a server: not offline, and the status is carried for the caller to decide', async () => {
    mockDb.failNextRead = { error: 'upstream connect error', status: 503 };
    await expect(fetchOnboarding()).resolves.toMatchObject({ ok: false, offline: false, status: 503 });
  });

  it('a refusal (RLS 42501, 403) is not offline and carries its code', async () => {
    mockDb.failNextRead = { error: 'permission denied for table user_onboarding', status: 403, code: '42501' };
    await expect(fetchOnboarding()).resolves.toMatchObject({ ok: false, offline: false, status: 403, code: '42501' });
  });

  it('no session: the repository says so without a request', async () => {
    await expect(as(null, () => fetchOnboarding())).resolves.toEqual({ ok: false, error: 'Oturum bulunamadı.' });
  });
});
