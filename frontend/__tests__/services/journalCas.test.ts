/**
 * F19 (SYN-17) — Compare-and-swap (CAS) protection for journal entries so
 * another device writing between `fetchJournalEntry` and `upsertJournalEntry`
 * cannot be silently overwritten.
 */
import { createMockDb, type MockDb } from '../helpers/supabaseMock';

const mockSqlDb: MockDb = createMockDb();

/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('../../lib/session', () => require('../helpers/fakeCoreServer').session);
jest.mock('../../repositories/journalRepository', () => {
  const fake = require('../helpers/fakeCoreServer').journalRepo;
  const actual = jest.requireActual('../../repositories/journalRepository');
  return {
    ...fake,
    JOURNAL_CAS_MISMATCH: actual.JOURNAL_CAS_MISMATCH ?? 'CAS_MISMATCH',
  };
});
jest.mock('../../lib/supabase', () => ({
  get supabase() {
    return require('../helpers/supabaseMock').makeSupabaseMock(mockSqlDb, { userId: 'u1' });
  },
}));
/* eslint-enable @typescript-eslint/no-require-imports */

import { server } from '../helpers/fakeCoreServer';
import type { OutboxCommand } from '../../lib/outbox';
import { contentVersion, journalTransport } from '../../services/coreOutbox';

const actualJournalRepo = jest.requireActual('../../repositories/journalRepository') as typeof import('../../repositories/journalRepository');

function makeJournalCmd(over: Partial<OutboxCommand> & { date: string; content: string; baseContent?: string }): OutboxCommand {
  return {
    operationId: over.operationId ?? 'j-op-1',
    userId: over.userId ?? 'u1',
    entity: 'journal_entry',
    entityId: over.date,
    kind: 'update',
    payload: { content: over.content, mood: 4 },
    baseVersion: over.baseVersion !== undefined ? over.baseVersion : contentVersion(over.baseContent ?? ''),
    dependsOn: [],
    seq: 1,
    attempts: 0,
    status: 'pending',
    readyAt: 0,
    createdAt: 0,
  };
}

describe('F19 (SYN-17) — journal compare-and-swap (CAS)', () => {
  beforeEach(() => {
    server.reset();
    for (const k of Object.keys(mockSqlDb.rows)) delete mockSqlDb.rows[k];
    mockSqlDb.inserts.length = 0;
    mockSqlDb.idSeq = 0;
    mockSqlDb.failNext = null;
    mockSqlDb.failNextRead = null;
    mockSqlDb.uniqueKeys = { journal_entries: [['user_id', 'date']] };
  });

  describe('journalRepository.upsertJournalEntry SQL guard', () => {
    it('returns CAS_MISMATCH (409) without overwriting when server content moved away from guard.baseContent', async () => {
      mockSqlDb.rows.journal_entries = [
        { id: 'j-1', user_id: 'u1', date: '2026-10-08', content: 'öteki cihaz yazdı', mood: 3, ai_summary: null, created_at: 'now' },
      ];

      const res = await actualJournalRepo.upsertJournalEntry(
        { date: '2026-10-08', content: 'benim yazım', mood: 5 },
        'u1',
        { baseContent: 'eski metin' },
      );
      expect(res).toMatchObject({
        ok: false,
        status: 409,
        code: actualJournalRepo.JOURNAL_CAS_MISMATCH,
      });
      expect(mockSqlDb.rows.journal_entries[0].content).toBe('öteki cihaz yazdı');

      // Matching baseContent succeeds and updates in place
      const ok = await actualJournalRepo.upsertJournalEntry(
        { date: '2026-10-08', content: 'güncel yazım', mood: 5 },
        'u1',
        { baseContent: 'öteki cihaz yazdı' },
      );
      expect(ok.ok).toBe(true);
      expect(mockSqlDb.rows.journal_entries[0].content).toBe('güncel yazım');
    });

    it('returns 23505 (409) when guard.baseContent is null (row did not exist on read) but another writer inserted meanwhile', async () => {
      mockSqlDb.rows.journal_entries = [
        { id: 'j-1', user_id: 'u1', date: '2026-10-09', content: 'araya giren cihaz', mood: 2, ai_summary: null, created_at: 'now' },
      ];

      const res = await actualJournalRepo.upsertJournalEntry(
        { date: '2026-10-09', content: 'benim ilk kaydım', mood: 4 },
        'u1',
        { baseContent: null },
      );
      expect(res).toMatchObject({
        ok: false,
        status: 409,
        code: '23505',
      });
      expect(mockSqlDb.rows.journal_entries[0].content).toBe('araya giren cihaz');
    });

    it('preserves legacy upsert behaviour when guard is omitted', async () => {
      const first = await actualJournalRepo.upsertJournalEntry({ date: '2026-10-10', content: 'birinci', mood: 3 });
      expect(first.ok).toBe(true);
      const second = await actualJournalRepo.upsertJournalEntry({ date: '2026-10-10', content: 'ikinci', mood: 4 });
      expect(second.ok).toBe(true);
      expect(mockSqlDb.rows.journal_entries).toHaveLength(1);
      expect(mockSqlDb.rows.journal_entries[0].content).toBe('ikinci');
    });
  });

  describe('journalTransport TOCTOU race loop', () => {
    it('detects concurrent edit between read and write (CAS_MISMATCH) and returns conflict without overwriting server text', async () => {
      server.journal.set('2026-10-08', { content: 'sabah', mood: 3 });
      server.beforeJournalWrite = () => {
        server.journal.set('2026-10-08', { content: 'başka cihaz araya girdi', mood: 2 });
      };

      const outcome = await journalTransport(
        makeJournalCmd({ date: '2026-10-08', content: 'akşam eklemesi', baseContent: 'sabah' }),
      );
      expect(outcome.kind).toBe('conflict');
      expect(server.journal.get('2026-10-08')?.content).toBe('başka cihaz araya girdi');
    });

    it('re-evaluates 23505 when row was absent on read: different text -> conflict, identical text -> applied', async () => {
      // Different text raced in -> conflict
      server.beforeJournalWrite = () => {
        server.journal.set('2026-10-11', { content: 'farklı cihaz metni', mood: 3 });
      };
      const conflictOut = await journalTransport(
        makeJournalCmd({ date: '2026-10-11', content: 'benim metnim', baseContent: '' }),
      );
      expect(conflictOut.kind).toBe('conflict');
      expect(server.journal.get('2026-10-11')?.content).toBe('farklı cihaz metni');

      // Identical text raced in (e.g. lost response of our own insert) -> applied
      server.beforeJournalWrite = () => {
        server.journal.set('2026-10-12', { content: 'aynı metin', mood: 4 });
      };
      const appliedOut = await journalTransport(
        makeJournalCmd({ date: '2026-10-12', content: 'aynı metin', baseContent: '' }),
      );
      expect(appliedOut).toEqual({ kind: 'applied', version: contentVersion('aynı metin') });
    });

    it('bounds CAS retries to 3 rounds and returns conflict instead of looping forever', async () => {
      let races = 0;
      const rearm = () => {
        server.beforeJournalWrite = () => {
          races += 1;
          // Whitespace-only server content passes `server.trim() !== ''` check on re-read,
          // but changes exact string so CAS_MISMATCH triggers again on the next write!
          server.journal.set('2026-10-13', { content: ' '.repeat(races), mood: 3 });
          rearm();
        };
      };
      rearm();

      const outcome = await journalTransport(
        makeJournalCmd({ date: '2026-10-13', content: 'yazmaya çalışıyorum', baseContent: '' }),
      );
      expect(outcome.kind).toBe('conflict');
      expect(races).toBe(3);
    });

    it('settles applied on lost-response replay when server already holds our exact content, and writes once on clean path', async () => {
      // Clean write
      const clean = await journalTransport(
        makeJournalCmd({ date: '2026-10-14', content: 'temiz günlük', baseContent: '' }),
      );
      expect(clean).toEqual({ kind: 'applied', version: contentVersion('temiz günlük') });
      expect(server.journal.get('2026-10-14')?.content).toBe('temiz günlük');

      // Lost-response replay with old baseVersion: server already has 'temiz günlük' -> applied
      const replay = await journalTransport(
        makeJournalCmd({ date: '2026-10-14', content: 'temiz günlük', baseContent: '' }),
      );
      expect(replay).toEqual({ kind: 'applied', version: contentVersion('temiz günlük') });
    });
  });
});
