/**
 * The monthly reflection moves to the cloud without losing anything.
 *
 * ## What it was
 *
 *     const REFLECT_KEY = (monthKey) => `monthly_review_${monthKey}`;
 *     await AsyncStorage.setItem(REFLECT_KEY(monthKey), JSON.stringify({ answers, savedAt }));
 *
 * No account in the key, no copy anywhere else. On a shared device the next
 * person to sign in read the previous account's written reflections; a
 * reinstall lost every month ever written; a second device saw an empty form.
 *
 * ## What the tests are about
 *
 * The table and its constraints are verified live in the migration. What
 * cannot be verified there is the PRECEDENCE — which of three copies wins
 * when they disagree — and that is where a careless move silently destroys
 * someone's writing. Each case below is one way to lose text.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

let mockUserId: string | null = 'userA';
const mockCloud: { row: Record<string, unknown> | null; readError: string | null; writeError: string | null } = {
  row: null, readError: null, writeError: null,
};

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => (mockUserId ? { id: mockUserId, email: null } : null)),
}));

jest.mock('../../repositories/monthlyReviewRepository', () => ({
  fetchMonthlyReview: jest.fn(async () =>
    mockCloud.readError ? { ok: false, error: mockCloud.readError } : { ok: true, data: mockCloud.row },
  ),
  upsertMonthlyReview: jest.fn(async (p: { monthKey: string; answers: Record<string, string> }) => {
    if (mockCloud.writeError) return { ok: false, error: mockCloud.writeError };
    mockCloud.row = {
      id: 'r1', user_id: mockUserId, month_key: p.monthKey,
      answers: p.answers, created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-31T12:00:00.000Z',
    };
    return { ok: true, data: mockCloud.row };
  }),
}));

// The rest of the service pulls in repositories that build a Supabase client.
jest.mock('../../repositories/habitLogRepository', () => ({ fetchHabitLogsForReview: jest.fn() }));
jest.mock('../../repositories/recoveryRepository', () => ({ fetchRecoveryPlansForReview: jest.fn() }));
jest.mock('../../repositories/focusSessionRepository', () => ({ fetchFocusSessionsSince: jest.fn() }));
jest.mock('../../repositories/reviewRepository', () => ({ fetchWeeklyReview: jest.fn(), upsertWeeklyReview: jest.fn() }));

import {
  loadMonthlyReflection, saveMonthlyDraft, saveMonthlyReflection,
} from '../../services/reviewService';
import { upsertMonthlyReview } from '../../repositories/monthlyReviewRepository';

const MONTH = '2026-08';
const LEGACY = `monthly_review_${MONTH}`;
const draftKeyFor = (uid: string) => `monthly_review:${uid}:${MONTH}`;

const cloudRow = (answers: Record<string, string>, updatedAt: string) => ({
  id: 'r1', user_id: 'userA', month_key: MONTH, answers,
  created_at: '2026-08-01T00:00:00.000Z', updated_at: updatedAt,
});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockUserId = 'userA';
  mockCloud.row = null;
  mockCloud.readError = null;
  mockCloud.writeError = null;
});

describe('which copy wins', () => {
  it('the cloud row, when it is the only copy', async () => {
    mockCloud.row = cloudRow({ wins: 'from the cloud' }, '2026-08-20T00:00:00.000Z');
    const r = await loadMonthlyReflection(MONTH);
    expect(r.answers).toEqual({ wins: 'from the cloud' });
    expect(r.source).toBe('cloud');
  });

  it('a NEWER local draft, because that is unsaved typing', async () => {
    mockCloud.row = cloudRow({ wins: 'saved yesterday' }, '2026-08-20T00:00:00.000Z');
    await AsyncStorage.setItem(draftKeyFor('userA'), JSON.stringify({
      answers: { wins: 'still typing' }, savedAt: '2026-08-25T00:00:00.000Z',
    }));

    const r = await loadMonthlyReflection(MONTH);
    expect(r.answers).toEqual({ wins: 'still typing' });
    expect(r.source).toBe('draft');
  });

  it('the cloud row over an OLDER draft, because another device saved since', async () => {
    mockCloud.row = cloudRow({ wins: 'saved on the tablet' }, '2026-08-25T00:00:00.000Z');
    await AsyncStorage.setItem(draftKeyFor('userA'), JSON.stringify({
      answers: { wins: 'stale phone draft' }, savedAt: '2026-08-20T00:00:00.000Z',
    }));

    const r = await loadMonthlyReflection(MONTH);
    expect(r.answers).toEqual({ wins: 'saved on the tablet' });
    expect(r.source).toBe('cloud');
  });

  it('an empty form when nothing exists anywhere', async () => {
    const r = await loadMonthlyReflection(MONTH);
    expect(r.answers).toEqual({});
    expect(r.source).toBe('empty');
  });
});

describe('the pre-move local entry', () => {
  it('is adopted when the cloud has nothing for that month', async () => {
    await AsyncStorage.setItem(LEGACY, JSON.stringify({
      answers: { wins: 'written before the move' }, savedAt: '01.08.2026',
    }));

    const r = await loadMonthlyReflection(MONTH);
    expect(r.answers).toEqual({ wins: 'written before the move' });
    expect(r.source).toBe('legacy');
  });

  it('is NOT adopted when the cloud already has an answer', async () => {
    // Otherwise a device that never synced would present its stale copy as
    // current, and saving would overwrite what another device wrote.
    mockCloud.row = cloudRow({ wins: 'the real one' }, '2026-08-25T00:00:00.000Z');
    await AsyncStorage.setItem(LEGACY, JSON.stringify({ answers: { wins: 'stale' }, savedAt: '01.08.2026' }));

    const r = await loadMonthlyReflection(MONTH);
    expect(r.answers).toEqual({ wins: 'the real one' });
    expect(r.source).toBe('cloud');
  });

  it('survives a read — it is not attributable to an account yet', async () => {
    // The key has no owner. Deleting it on sight would discard writing that
    // may belong to whoever signs in next.
    await AsyncStorage.setItem(LEGACY, JSON.stringify({ answers: { wins: 'x' }, savedAt: null }));
    await loadMonthlyReflection(MONTH);
    expect(await AsyncStorage.getItem(LEGACY)).not.toBeNull();
  });

  it('is retired once an account has SAVED the month', async () => {
    await AsyncStorage.setItem(LEGACY, JSON.stringify({ answers: { wins: 'x' }, savedAt: null }));
    const res = await saveMonthlyReflection(MONTH, { wins: 'x' });
    expect(res.ok).toBe(true);
    expect(await AsyncStorage.getItem(LEGACY)).toBeNull();
  });
});

describe('drafts belong to one account', () => {
  it("B does not see A's draft", async () => {
    await AsyncStorage.setItem(draftKeyFor('userA'), JSON.stringify({
      answers: { wins: "A's private reflection" }, savedAt: '2026-08-25T00:00:00.000Z',
    }));

    mockUserId = 'userB';
    const r = await loadMonthlyReflection(MONTH);
    expect(JSON.stringify(r.answers)).not.toContain('private');
    expect(r.source).toBe('empty');
  });

  it("A's draft survives B using the app", async () => {
    // Isolation must not be achieved by deleting the other account's work.
    await AsyncStorage.setItem(draftKeyFor('userA'), JSON.stringify({
      answers: { wins: 'A text' }, savedAt: '2026-08-25T00:00:00.000Z',
    }));

    mockUserId = 'userB';
    await loadMonthlyReflection(MONTH);
    await saveMonthlyDraft(MONTH, { wins: 'B text' });

    mockUserId = 'userA';
    const r = await loadMonthlyReflection(MONTH);
    expect(r.answers).toEqual({ wins: 'A text' });
  });

  it('a signed-out draft is not written anywhere', async () => {
    mockUserId = null;
    await saveMonthlyDraft(MONTH, { wins: 'nobody owns this' });
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((k) => k.includes('monthly_review'))).toEqual([]);
  });
});

describe('saving', () => {
  it('clears the draft only after the write is accepted', async () => {
    await saveMonthlyDraft(MONTH, { wins: 'typed' });
    expect(await AsyncStorage.getItem(draftKeyFor('userA'))).not.toBeNull();

    mockCloud.writeError = 'network down';
    const failed = await saveMonthlyReflection(MONTH, { wins: 'typed' });
    expect(failed.ok).toBe(false);
    // The whole point: a failed save must not be a way to lose the text.
    expect(await AsyncStorage.getItem(draftKeyFor('userA'))).not.toBeNull();

    mockCloud.writeError = null;
    const ok = await saveMonthlyReflection(MONTH, { wins: 'typed' });
    expect(ok.ok).toBe(true);
    expect(await AsyncStorage.getItem(draftKeyFor('userA'))).toBeNull();
  });

  it('returns the row timestamp, not a locally invented one', async () => {
    const res = await saveMonthlyReflection(MONTH, { wins: 'x' });
    expect(res).toEqual({ ok: true, savedAt: '2026-08-31T12:00:00.000Z' });
  });

  it('drops non-string values instead of letting the CHECK reject the save', async () => {
    const res = await saveMonthlyReflection(MONTH, { wins: 'ok', bad: 42 as unknown as string });
    expect(res.ok).toBe(true);
    expect(mockCloud.row?.answers).toEqual({ wins: 'ok' });
  });
});

describe('a failed cloud read', () => {
  it('still shows this account draft rather than an empty form', async () => {
    // Offline is the common case for this screen; falling back to nothing
    // would look like the month had never been written.
    mockCloud.readError = 'offline';
    await AsyncStorage.setItem(draftKeyFor('userA'), JSON.stringify({
      answers: { wins: 'offline text' }, savedAt: '2026-08-25T00:00:00.000Z',
    }));

    const r = await loadMonthlyReflection(MONTH);
    expect(r.answers).toEqual({ wins: 'offline text' });
    expect(r.source).toBe('draft');
    expect(r.cloudError).toBe('offline');
  });

  it('returns source: "error" with cloudError when the cloud fails and no draft or legacy exists', async () => {
    mockCloud.readError = 'connection reset';
    const r = await loadMonthlyReflection(MONTH);
    expect(r.answers).toEqual({});
    expect(r.source).toBe('error');
    expect(r.cloudError).toBe('connection reset');
  });

  it('merges a newer 1-key local draft on top of a 5-key cloud row without losing the other 4 keys', async () => {
    mockCloud.row = cloudRow(
      { k1: 'c1', k2: 'c2', k3: 'c3', k4: 'c4', k5: 'c5' },
      '2026-08-20T00:00:00.000Z',
    );
    await AsyncStorage.setItem(draftKeyFor('userA'), JSON.stringify({
      answers: { k3: 'draft-override' },
      savedAt: '2026-08-25T00:00:00.000Z',
    }));

    const r = await loadMonthlyReflection(MONTH);
    expect(r.source).toBe('draft');
    expect(r.answers).toEqual({
      k1: 'c1',
      k2: 'c2',
      k3: 'draft-override',
      k4: 'c4',
      k5: 'c5',
    });
  });

  it('refuses saveMonthlyReflection without calling upsertMonthlyReview when the cloud cannot be read first', async () => {
    (upsertMonthlyReview as jest.Mock).mockClear();
    mockCloud.readError = 'offline';
    const res = await saveMonthlyReflection(MONTH, { wins: 'local only' });
    expect(res.ok).toBe(false);
    expect(upsertMonthlyReview).not.toHaveBeenCalled();
  });

  it('preserves unseen cloud keys on save while allowing an explicit empty string to clear a key', async () => {
    mockCloud.row = cloudRow(
      { k1: 'c1', k2: 'c2', k3: 'c3', k4: 'c4', k5: 'c5' },
      '2026-08-20T00:00:00.000Z',
    );
    const saved1 = await saveMonthlyReflection(MONTH, { k2: 'updated' });
    expect(saved1.ok).toBe(true);
    expect(mockCloud.row?.answers).toEqual({
      k1: 'c1',
      k2: 'updated',
      k3: 'c3',
      k4: 'c4',
      k5: 'c5',
    });

    const saved2 = await saveMonthlyReflection(MONTH, { k4: '' });
    expect(saved2.ok).toBe(true);
    expect(mockCloud.row?.answers).toEqual({
      k1: 'c1',
      k2: 'updated',
      k3: 'c3',
      k4: '',
      k5: 'c5',
    });
  });
});
