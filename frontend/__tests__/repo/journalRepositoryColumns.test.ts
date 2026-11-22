import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import { buildSchemaModel } from '../helpers/sqlSchemaParser';

const mockSelectCalls: string[] = [];
const mockLimitCalls: number[] = [];
let mockRows: unknown[] = [];
let mockError: { message: string } | null = null;

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: { user: { id: 'u1' } } } })),
    },
    from: () => {
      const q = {
        select: (cols: string) => {
          mockSelectCalls.push(cols);
          return q;
        },
        eq: () => q,
        order: () => q,
        limit: (n: number) => {
          mockLimitCalls.push(n);
          return Promise.resolve({ data: mockError ? null : mockRows, error: mockError });
        },
      };
      return q;
    },
  },
}));

jest.mock('../../services/coreOutbox', () => ({
  coreOutbox: {
    ensure: jest.fn(async () => undefined),
    onApplied: jest.fn(),
    state: jest.fn(() => ({ commands: [] })),
    write: jest.fn(),
    flush: jest.fn(),
    discard: jest.fn(),
    retry: jest.fn(),
  },
  contentVersion: (s: string) => `v:${s.length}`,
}));

import { resetAccountMemory } from '../../lib/accountScope';
import {
  COLS,
  fetchJournalEntries,
  JOURNAL_ENTRY_COLUMNS,
  JOURNAL_FETCH_LIMIT,
} from '../../repositories/journalRepository';
import { useJournalStore } from '../../store/journalStore';

const ROOT = join(__dirname, '..', '..');
const REPO_ROOT = join(ROOT, '..');

describe('repositories/journalRepository — explicit column list & 365 fetch limit (PRF-20)', () => {
  beforeEach(() => {
    mockSelectCalls.length = 0;
    mockLimitCalls.length = 0;
    mockRows = [];
    mockError = null;
    resetAccountMemory('signed_out');
  });

  it('(+) COLS and JOURNAL_ENTRY_COLUMNS equal the exact 7 journal_entries columns in live_schema.sql', () => {
    expect(COLS).toBe('id,user_id,date,content,mood,created_at,ai_summary');
    expect(JOURNAL_ENTRY_COLUMNS).toBe(COLS);

    const liveSql = readFileSync(join(REPO_ROOT, 'supabase', 'live_schema.sql'), 'utf8');
    const model = buildSchemaModel([{ label: 'live', file: 'supabase/live_schema.sql', text: liveSql }]);
    const table = model.tables.get('journal_entries');
    expect(table).toBeDefined();

    const liveCols = [...table!.columns.keys()];
    const selectedCols = COLS.split(',').map((c) => c.trim());
    expect(selectedCols).toHaveLength(7);
    for (const col of selectedCols) {
      expect(liveCols).toContain(col);
    }
    expect(new Set(selectedCols)).toEqual(new Set(liveCols));
  });

  it('(-) journalRepository contains zero wildcard select("*") and defaults fetchJournalEntries to JOURNAL_FETCH_LIMIT (365)', async () => {
    const src = stripComments(
      readFileSync(join(ROOT, 'repositories', 'journalRepository.ts'), 'utf8'),
    );
    expect(src).not.toMatch(/\.select\(\s*['"]\*['"]\s*\)/);
    expect(src).not.toMatch(/\bCOLS\s*=\s*['"]\*['"]/);
    expect(JOURNAL_FETCH_LIMIT).toBe(365);
    expect(src).toMatch(/fetchJournalEntries\s*\(\s*limit\s*=\s*JOURNAL_FETCH_LIMIT\s*\)/);

    const res = await fetchJournalEntries();
    expect(res.ok).toBe(true);
    expect(mockSelectCalls).toEqual([COLS]);
    expect(mockLimitCalls).toEqual([365]);
  });

  it('(+/-) useJournalStore sets truncated=true at >=365 rows, preserves truncated on error, and resets truncated=false on account reset', async () => {
    expect(useJournalStore.getState().truncated).toBe(false);

    mockRows = Array.from({ length: JOURNAL_FETCH_LIMIT }, (_, i) => ({
      id: `j-${i}`,
      user_id: 'u1',
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      content: 'not',
      mood: 3,
      ai_summary: null,
      created_at: '2026-01-01T00:00:00Z',
    }));
    await useJournalStore.getState().fetchEntries();
    expect(useJournalStore.getState().truncated).toBe(true);

    // Failed fetch does not clobber truncated
    mockError = { message: 'offline' };
    await useJournalStore.getState().fetchEntries();
    expect(useJournalStore.getState().truncated).toBe(true);

    // Account boundary resets truncated to false
    resetAccountMemory('signed_out');
    expect(useJournalStore.getState().truncated).toBe(false);

    // 364 rows -> truncated=false
    mockError = null;
    mockRows = mockRows.slice(0, JOURNAL_FETCH_LIMIT - 1);
    await useJournalStore.getState().fetchEntries();
    expect(useJournalStore.getState().truncated).toBe(false);
  });
});
