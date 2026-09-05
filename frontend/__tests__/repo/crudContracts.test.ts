/**
 * The behaviour contract for the five CRUD surfaces: journal, notes, goals,
 * OKR and projects.
 *
 * ## Why these five, and why now
 *
 * Each has a complete chain — screen → store → repository → an RLS-protected
 * table — and, until this file, not one line of test anywhere in the suite
 * exercised it. 102 suites and 1487 tests, and the five surfaces a user would
 * describe as "my notes, my goals, my journal" were covered by none of them.
 * Live, all five tables hold zero rows, so "it works" rested on nothing at
 * all: not a test, not a production write.
 *
 * ## What "real behaviour" means here
 *
 * A mock that records `insert` was called proves the code reached a method
 * name. It cannot fail when the row is written under the wrong owner, when an
 * update silently matches nothing, or when a delete takes somebody else's
 * row — which are the failures that matter for tables whose only protection
 * is an owner filter.
 *
 * So the fake here STORES rows and applies the filters the repository builds
 * (`__tests__/helpers/supabaseMock.ts`). Reads come back from what writes put
 * in. A repository that forgot `.eq('user_id', …)` returns the other account's
 * row and the isolation test fails — which is exactly the defect the filter
 * exists to prevent, and exactly what a call-recording mock cannot see.
 *
 * ## The contract, applied to all five
 *
 *   1. create            → the row exists, owned by the CALLER, not the input
 *   2. persisted read    → a fresh read returns what was written
 *   3. reload / refetch  → a second independent read still returns it
 *   4. update            → the change is readable afterwards
 *   5. delete            → it is gone, and only it
 *   6. account isolation → another user's row is invisible, un-updatable and
 *                          un-deletable, and a signed-out caller gets an
 *                          error rather than everyone's data
 *
 * Point 6 is the one that justifies the whole file.
 */
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

const mockDb: MockDb = createMockDb();
const mockSession: { userId: string | null } = { userId: 'u1' };
const mockClient = makeSupabaseMock(mockDb);

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      // The acting account is switchable so ownership can be tested from the
      // other side rather than asserted about the query text.
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

import {
  fetchJournalEntries, fetchJournalEntry, upsertJournalEntry, searchJournalEntries,
} from '../../repositories/journalRepository';
import {
  fetchNotesPage, insertNote, updateNote, deleteNote, searchNotes,
} from '../../repositories/noteRepository';
import {
  fetchGoalsPage, insertGoal, updateGoalProgress, archiveGoal, deleteGoal,
} from '../../repositories/goalRepository';
import {
  fetchOkrs, insertObjective, insertKeyResult, updateKeyResultValue,
  deleteObjective, deleteKeyResult,
} from '../../repositories/okrRepository';
import {
  fetchProjectsPage, insertProject, updateProject, archiveProject, deleteProject, searchProjects,
} from '../../repositories/projectRepository';

/** A row belonging to somebody else, planted directly in the fake table. */
function plantForeignRow(table: string, row: Record<string, unknown>) {
  mockDb.rows[table] ??= [];
  mockDb.rows[table].push({ id: `foreign-${table}`, user_id: 'u2', created_at: 'now', ...row } as never);
}

/** Runs `fn` as a different account, then restores the previous one. */
async function as<T>(userId: string | null, fn: () => Promise<T>): Promise<T> {
  const previous = mockSession.userId;
  mockSession.userId = userId;
  try { return await fn(); } finally { mockSession.userId = previous; }
}

function unwrap<T>(r: { ok: true; data: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new Error(`expected ok, got error: ${r.error}`);
  return r.data;
}

beforeEach(() => {
  for (const key of Object.keys(mockDb.rows)) delete mockDb.rows[key];
  mockDb.inserts.length = 0;
  mockDb.idSeq = 0;
  mockDb.failNext = null;
  mockSession.userId = 'u1';
});

// ---------------------------------------------------------------------------
// Sanity: the fake must actually store things, or every assertion below is
// vacuous in the friendliest possible direction.
// ---------------------------------------------------------------------------
describe('the fake persists', () => {
  it('a written row is readable back', async () => {
    await insertNote({ title: 'x', content: 'y' });
    expect(mockDb.rows.notes).toHaveLength(1);
    const page = unwrap(await fetchNotesPage());
    expect(page.rows).toHaveLength(1);
  });

  it('a signed-out caller gets an error, not everybody\'s rows', async () => {
    await insertNote({ title: 'mine', content: 'c' });
    const r = await as(null, () => fetchNotesPage());
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('notes', () => {
  it('create → read → reload → update → delete', async () => {
    const created = unwrap(await insertNote({ title: 'İlk not', content: 'gövde', tags: ['a'] }));
    // Owner comes from the session, never from the caller.
    expect(created.user_id).toBe('u1');

    const read = unwrap(await fetchNotesPage());
    expect(read.rows.map((n) => n.title)).toEqual(['İlk not']);

    // "Reload": an independent second read, as a remount would do.
    const reloaded = unwrap(await fetchNotesPage());
    expect(reloaded.rows.map((n) => n.id)).toEqual([created.id]);

    unwrap(await updateNote(created.id, { title: 'Düzeltildi' }));
    expect(unwrap(await fetchNotesPage()).rows[0].title).toBe('Düzeltildi');

    unwrap(await deleteNote(created.id));
    expect(unwrap(await fetchNotesPage()).rows).toEqual([]);
  });

  it('another account\'s note is invisible, un-updatable and un-deletable', async () => {
    plantForeignRow('notes', { title: 'gizli', content: 'x', tags: [] });
    const mine = unwrap(await insertNote({ title: 'benim', content: 'y' }));

    expect(unwrap(await fetchNotesPage()).rows.map((n) => n.id)).toEqual([mine.id]);
    expect(unwrap(await searchNotes('gizli'))).toEqual([]);

    const upd = await updateNote('foreign-notes', { title: 'ele geçirildi' });
    expect(upd.ok).toBe(false);
    const del = await deleteNote('foreign-notes');
    expect(del.ok).toBe(false);

    // The row is still there, unchanged — the failure was a refusal, not a
    // silent no-op reported as success.
    expect(mockDb.rows.notes.find((r) => r.id === 'foreign-notes')?.title).toBe('gizli');
  });
});

// ---------------------------------------------------------------------------
describe('journal', () => {
  it('create → read → reload → update → same-day upsert does not duplicate', async () => {
    const created = unwrap(await upsertJournalEntry({ date: '2026-02-01', content: 'ilk', mood: 3 }));
    expect(created.user_id).toBe('u1');

    expect(unwrap(await fetchJournalEntry('2026-02-01'))?.content).toBe('ilk');
    expect(unwrap(await fetchJournalEntries()).map((e) => e.date)).toEqual(['2026-02-01']);

    // One entry per (user, day): writing the same date again REPLACES.
    unwrap(await upsertJournalEntry({ date: '2026-02-01', content: 'düzeltildi', mood: 4 }));
    const all = unwrap(await fetchJournalEntries());
    expect(all).toHaveLength(1);
    expect(all[0].content).toBe('düzeltildi');
    expect(all[0].mood).toBe(4);
  });

  it('another account\'s entry is invisible, and the conflict key is per-user', async () => {
    plantForeignRow('journal_entries', { date: '2026-02-01', content: 'onun günlüğü', mood: 1 });

    expect(unwrap(await fetchJournalEntries())).toEqual([]);
    expect(unwrap(await fetchJournalEntry('2026-02-01'))).toBeNull();
    expect(unwrap(await searchJournalEntries('onun'))).toEqual([]);

    // Writing the same DATE must create my own row, not overwrite theirs —
    // the upsert conflict target is (user_id, date), and if it were date
    // alone this would silently rewrite another person's journal.
    unwrap(await upsertJournalEntry({ date: '2026-02-01', content: 'benim' }));
    expect(mockDb.rows.journal_entries).toHaveLength(2);
    expect(mockDb.rows.journal_entries.find((r) => r.user_id === 'u2')?.content).toBe('onun günlüğü');
  });
});

// ---------------------------------------------------------------------------
describe('goals', () => {
  it('create → read → reload → progress update → archive → delete', async () => {
    const created = unwrap(await insertGoal({ kind: 'yearly', title: 'Kitap bitir', year: 2026 }));
    expect(created.user_id).toBe('u1');
    expect(created.progress).toBe(0);

    expect(unwrap(await fetchGoalsPage()).rows.map((g) => g.title)).toEqual(['Kitap bitir']);
    expect(unwrap(await fetchGoalsPage()).rows).toHaveLength(1); // reload

    unwrap(await updateGoalProgress(created.id, 60));
    expect(unwrap(await fetchGoalsPage()).rows[0].progress).toBe(60);

    // Archiving is not deleting: the row survives, and the default list stops
    // showing it because `fetchGoalsPage` excludes archived rows.
    unwrap(await archiveGoal(created.id));
    expect(mockDb.rows.goals).toHaveLength(1);
    expect(unwrap(await fetchGoalsPage()).rows).toEqual([]);

    unwrap(await deleteGoal(created.id));
    expect(mockDb.rows.goals).toEqual([]);
  });

  it('progress is clamped rather than trusted', async () => {
    const g = unwrap(await insertGoal({ kind: 'monthly', title: 'x', progress: 999 }));
    expect(g.progress).toBe(100);
    expect(unwrap(await updateGoalProgress(g.id, -50)).progress).toBe(0);
  });

  it('another account\'s goal is invisible and cannot be advanced or deleted', async () => {
    plantForeignRow('goals', { kind: 'yearly', title: 'onun hedefi', progress: 10, archived: false });
    expect(unwrap(await fetchGoalsPage()).rows).toEqual([]);
    expect((await updateGoalProgress('foreign-goals', 100)).ok).toBe(false);
    expect((await deleteGoal('foreign-goals')).ok).toBe(false);
    expect(mockDb.rows.goals.find((r) => r.id === 'foreign-goals')?.progress).toBe(10);
  });
});

// ---------------------------------------------------------------------------
describe('OKR', () => {
  it('objective + key result → read → value update → delete', async () => {
    const okr = unwrap(await insertObjective({ objective: 'Q1 hedefi', year: 2026, quarter: 1 }));
    expect(okr.user_id).toBe('u1');

    const kr = unwrap(await insertKeyResult({ okrId: okr.id, title: 'KR1', targetValue: 10 }));
    expect(kr.user_id).toBe('u1');
    expect(kr.current_value).toBe(0);

    const listed = unwrap(await fetchOkrs());
    expect(listed.okrs.map((o) => o.objective)).toEqual(['Q1 hedefi']);
    expect(listed.keyResults.map((k) => k.title)).toEqual(['KR1']);

    unwrap(await updateKeyResultValue(kr.id, 7));
    expect(unwrap(await fetchOkrs()).keyResults[0].current_value).toBe(7);

    // Negative progress is not a thing.
    expect(unwrap(await updateKeyResultValue(kr.id, -3)).current_value).toBe(0);

    unwrap(await deleteKeyResult(kr.id));
    expect(unwrap(await fetchOkrs()).keyResults).toEqual([]);
    unwrap(await deleteObjective(okr.id));
    expect(unwrap(await fetchOkrs()).okrs).toEqual([]);
  });

  it('another account\'s objective and key results stay theirs', async () => {
    plantForeignRow('okrs', { objective: 'onun OKR', year: 2026, quarter: 1 });
    plantForeignRow('key_results', { okr_id: 'foreign-okrs', title: 'onun KR', current_value: 5, target_value: 10, unit: null });

    const listed = unwrap(await fetchOkrs());
    expect(listed.okrs).toEqual([]);
    expect(listed.keyResults).toEqual([]);

    expect((await updateKeyResultValue('foreign-key_results', 99)).ok).toBe(false);
    expect((await deleteObjective('foreign-okrs')).ok).toBe(false);
    expect(mockDb.rows.key_results.find((r) => r.id === 'foreign-key_results')?.current_value).toBe(5);
  });
});

// ---------------------------------------------------------------------------
describe('projects', () => {
  it('create → read → reload → update → archive → delete', async () => {
    const created = unwrap(await insertProject({ name: 'Atlas taşıma', color: null }));
    expect(created.user_id).toBe('u1');
    expect(created.status).toBe('active');

    expect(unwrap(await fetchProjectsPage()).rows.map((p) => p.name)).toEqual(['Atlas taşıma']);
    expect(unwrap(await fetchProjectsPage()).rows).toHaveLength(1); // reload

    unwrap(await updateProject(created.id, { name: 'Yeniden adlandırıldı' }));
    expect(unwrap(await fetchProjectsPage()).rows[0].name).toBe('Yeniden adlandırıldı');

    unwrap(await archiveProject(created.id));
    expect(mockDb.rows.projects).toHaveLength(1);
    expect(unwrap(await fetchProjectsPage()).rows).toEqual([]);
    // Search excludes archived too, so an archived project cannot be
    // resurrected by the command palette.
    expect(unwrap(await searchProjects('Yeniden'))).toEqual([]);

    unwrap(await deleteProject(created.id));
    expect(mockDb.rows.projects).toEqual([]);
  });

  it('another account\'s project is invisible, un-renamable and un-deletable', async () => {
    plantForeignRow('projects', { name: 'onun projesi', status: 'active', color: null, description: null });
    expect(unwrap(await fetchProjectsPage()).rows).toEqual([]);
    expect(unwrap(await searchProjects('onun'))).toEqual([]);
    expect((await updateProject('foreign-projects', { name: 'çalındı' })).ok).toBe(false);
    expect((await deleteProject('foreign-projects')).ok).toBe(false);
    expect(mockDb.rows.projects.find((r) => r.id === 'foreign-projects')?.name).toBe('onun projesi');
  });
});
