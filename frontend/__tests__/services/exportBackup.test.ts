/**
 * The account backup.
 *
 * `GET /api/export` read the whole database with no user filter, on a
 * service with no auth. Scoping is now the repositories' job — what these
 * tests pin is the part that a rewrite gets wrong quietly: a backup is only
 * discovered to be incomplete at restore time, so "incomplete" must be
 * impossible to confuse with "complete".
 */
import {
  drain, buildBackup, backupToCSV, backupToSheets, backupToJSON, renderBackup,
} from '../../services/exportService';
import type { Cursor, Page, RepoResult } from '../../repositories/shared';

type Row = { id: string; n: number };

/** A paginated source of `total` rows, `size` at a time. */
function pagedSource(total: number, size = 30) {
  const all: Row[] = Array.from({ length: total }, (_, i) => ({ id: `r${i}`, n: i }));
  const calls = { n: 0 };
  const page = async (cursor?: Cursor | null): Promise<RepoResult<Page<Row>>> => {
    calls.n++;
    const start = cursor ? all.findIndex((r) => r.id === cursor.id) + 1 : 0;
    const slice = all.slice(start, start + size);
    const hasMore = start + size < all.length;
    return {
      ok: true,
      data: {
        rows: slice,
        hasMore,
        nextCursor: hasMore && slice.length ? { key: String(slice[slice.length - 1].n), id: slice[slice.length - 1].id } : null,
      },
    };
  };
  return { page, calls, all };
}

describe('drain follows the cursor to the end', () => {
  it('collects every row across pages, in order, without duplicates', async () => {
    const src = pagedSource(65, 30);
    const r = await drain(src.page);

    expect(r.rows).toHaveLength(65);
    expect(r.truncated).toBe(false);
    expect(src.calls.n).toBe(3);
    expect(new Set(r.rows.map((x) => x.id)).size).toBe(65);
    expect(r.rows.map((x) => x.n)).toEqual(src.all.map((x) => x.n));
  });

  it('a single short page ends immediately', async () => {
    const src = pagedSource(5, 30);
    const r = await drain(src.page);
    expect(r.rows).toHaveLength(5);
    expect(src.calls.n).toBe(1);
  });

  it('an empty collection is not an error', async () => {
    const src = pagedSource(0, 30);
    await expect(drain(src.page)).resolves.toEqual({ rows: [], truncated: false });
  });

  it('hitting the cap reports truncated instead of pretending', async () => {
    const src = pagedSource(200, 30);
    const r = await drain(src.page, 50);
    expect(r.rows).toHaveLength(50);
    expect(r.truncated).toBe(true);
  });

  it('a read failure surfaces the error and keeps what it had', async () => {
    let n = 0;
    const page = async (): Promise<RepoResult<Page<Row>>> => {
      if (n++ === 0) {
        return { ok: true, data: { rows: [{ id: 'a', n: 0 }], hasMore: true, nextCursor: { key: '0', id: 'a' } } };
      }
      return { ok: false, error: 'connection lost' };
    };
    const r = await drain(page);
    expect(r.error).toBe('connection lost');
    expect(r.rows).toHaveLength(1);
  });

  it('a server that never advances the cursor still terminates', async () => {
    // Otherwise a backup would hang the export screen forever.
    const page = async (): Promise<RepoResult<Page<Row>>> => ({
      ok: true,
      data: { rows: [{ id: 'stuck', n: 0 }], hasMore: true, nextCursor: { key: '0', id: 'nowhere' } },
    });
    const r = await drain(page, 1_000_000);
    expect(r.truncated).toBe(true);
    expect(r.rows.length).toBeLessThan(1_000_000);
  });
});

// ---------------------------------------------------------------------------

const mockRepoState = {
  habits: [{ id: 'h1', name: 'Koşu', user_id: 'u1' }],
  tasks: [{ id: 't1', title: 'Rapor' }],
  webhooks: [{ id: 'w1', url: 'https://ok.example/h', headers: { Authorization: 'Bearer SECRET' }, enabled: true }],
  habitLogsFail: false,
};

jest.mock('../../repositories/exportRepository', () => ({
  MAX_EXPORT_ROWS: 20_000,
  EXPORT_FULL_TABLES: ['habits', 'habit_logs', 'journal_entries', 'focus_sessions', 'webhooks'],
  fetchFullTable: jest.fn(async (table: string) => {
    if (table === 'habit_logs') {
      return mockRepoState.habitLogsFail
        ? { ok: false, error: 'timeout' }
        : { ok: true, data: { rows: [{ id: 'l1', habit_id: 'h1', completed_at: '2026-08-30', state: 'done' }], truncated: false } };
    }
    if (table === 'habits') return { ok: true, data: { rows: mockRepoState.habits, truncated: false } };
    if (table === 'webhooks') return { ok: true, data: { rows: mockRepoState.webhooks, truncated: false } };
    return { ok: true, data: { rows: [], truncated: false } };
  }),
  fetchOwnProfileForExport: jest.fn(async () => ({ ok: true, data: [] })),
  fetchOwnOnboardingForExport: jest.fn(async () => ({ ok: true, data: [] })),
}));
jest.mock('../../repositories/taskRepository', () => ({
  fetchTasksPage: jest.fn(async () => ({ ok: true, data: { rows: mockRepoState.tasks, hasMore: false, nextCursor: null } })),
}));
jest.mock('../../repositories/noteRepository', () => ({ fetchNotesPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/projectRepository', () => ({ fetchProjectsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/goalRepository', () => ({ fetchGoalsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
jest.mock('../../repositories/badHabitRepository', () => ({ fetchBadHabitsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })) }));
// R08.01: the rest of the owned tables are read through one generic reader.
jest.mock('../../repositories/restoreRepository', () => ({
  ...jest.requireActual('../../repositories/restoreRepository'),
  fetchOwnedTable: jest.fn(async () => ({ ok: true, data: { rows: [], truncated: false } })),
}));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));

beforeEach(() => { mockRepoState.habitLogsFail = false; });

describe('buildBackup', () => {
  it('gathers the collections and stamps the format', async () => {
    const b = await buildBackup(new Date('2026-08-30T10:00:00Z'));
    expect(b.export_date).toBe('2026-08-30T10:00:00.000Z');
    // R08: format 3 adds the manifest; the collections are unchanged.
    expect(b.format_version).toBe(3);
    expect(b.habits).toHaveLength(1);
    expect(b.habit_logs).toHaveLength(1);
    expect(b.failed).toEqual([]);
    expect(b.truncated).toEqual([]);
  });

  it('strips webhook headers, which may hold a credential', async () => {
    // The backup goes to Share.share() -- to whatever app the user taps.
    const b = await buildBackup();
    expect(b.webhooks).toHaveLength(1);
    expect(JSON.stringify(b.webhooks)).not.toContain('SECRET');
    expect((b.webhooks[0] as { url: string }).url).toBe('https://ok.example/h');
  });

  it('records a collection it could not read instead of shipping it empty', async () => {
    mockRepoState.habitLogsFail = true;
    const b = await buildBackup();
    expect(b.habit_logs).toEqual([]);
    expect(b.failed).toEqual([{ collection: 'habit_logs', error: 'timeout' }]);
    expect(b.notes_on_contents.join(' ')).toContain('habit_logs');
  });
});

describe('renderers', () => {
  it('CSV labels each collection and keeps embedded commas intact', async () => {
    const b = await buildBackup(new Date('2026-08-30T10:00:00Z'));
    b.tasks = [{ id: 't1', title: 'Rapor, sunum ve "özet"' }];
    const csv = backupToCSV(b);
    expect(csv).toContain('## tasks');
    expect(csv).toContain('"Rapor, sunum ve ""özet"""');
  });

  it('CSV states truncation rather than ending silently', async () => {
    const b = await buildBackup();
    b.truncated = ['notes'];
    expect(backupToCSV(b)).toContain('# EKSİK: notes');
  });

  it('sheets take the union of keys, so a sparse column is not dropped', async () => {
    const b = await buildBackup();
    b.tasks = [{ id: 't1', title: 'a' }, { id: 't2', title: 'b', note: 'only here' }];
    const sheet = backupToSheets(b).find((s) => s.name === 'tasks')!;
    expect(sheet.headers).toContain('note');
    expect(sheet.rows[0][sheet.headers.indexOf('note')]).toBe('');
  });

  it('empty collections do not become empty sheets', async () => {
    const b = await buildBackup();
    expect(backupToSheets(b).map((s) => s.name)).not.toContain('notes');
  });

  it('JSON round-trips', async () => {
    const b = await buildBackup();
    expect(JSON.parse(backupToJSON(b)).habits).toHaveLength(1);
  });

  it('renderBackup dispatches on format', async () => {
    const b = await buildBackup();
    expect(renderBackup(b, 'json').startsWith('{')).toBe(true);
    expect(renderBackup(b, 'csv')).toContain('# Aderyth dışa aktarım');
    expect(renderBackup(b, 'excel')).toContain('<?xml');
  });
});
