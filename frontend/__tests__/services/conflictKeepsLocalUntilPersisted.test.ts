/**
 * F19 (REP-12, INT-17) — resolving a note or journal conflict with 'both'
 * persists the replacement write BEFORE discarding the conflicted local
 * command; if device persistence fails (`savedOnDevice: false`), the conflict
 * and local text stay intact and a subsequent retry creates a single copy /
 * single merged entry.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('../../lib/session', () => require('../helpers/fakeCoreServer').session);
jest.mock('../../repositories/noteRepository', () => require('../helpers/fakeCoreServer').noteRepo);
jest.mock('../../repositories/journalRepository', () => require('../helpers/fakeCoreServer').journalRepo);
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn(), getSession: jest.fn() } } }));
/* eslint-enable @typescript-eslint/no-require-imports */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { server, stamp } from '../helpers/fakeCoreServer';
import { CORE_OUTBOX_NAMESPACE, coreOutbox, CORE_TRANSPORTS, contentVersion } from '../../services/coreOutbox';
import { createOutboxChannel } from '../../services/outboxChannel';
import { asyncStorageOutboxNs } from '../../lib/outboxStorage';
import { pendingNoteCommands, resolveNoteConflict } from '../../services/noteService';
import { pendingJournalCommands, resolveJournalConflict } from '../../services/journalService';
import { useNoteStore } from '../../store/noteStore';
import { useJournalStore } from '../../store/journalStore';

beforeEach(async () => {
  server.reset();
  coreOutbox.reset();
  await AsyncStorage.clear();
  jest.restoreAllMocks();
  useNoteStore.setState({ notes: [], error: null });
  useJournalStore.setState({ entries: [] });
});

async function seedNoteConflict() {
  const n = (await useNoteStore.getState().addNote('Plan', 'v1'))!;
  await useNoteStore.getState().fetchNotes();
  server.notes.set(n.id, { ...server.notes.get(n.id)!, content: 'sunucu sürümü', updated_at: stamp() });
  await useNoteStore.getState().updateNote(n.id, { content: 'yerel sürümüm' });
  expect(useNoteStore.getState().conflicts().map((c) => c.entityId)).toEqual([n.id]);
  return n;
}

async function seedJournalConflict(date = '2026-10-04') {
  await useJournalStore.getState().fetchEntries();
  server.journal.set(date, { content: 'sunucu günlüğü', mood: 2 });
  await useJournalStore.getState().saveEntry(date, 'yerel günlüğüm', 4);
  expect(useJournalStore.getState().conflicts().map((c) => c.entityId)).toEqual([date]);
}

describe('F19 (REP-12, INT-17) — conflict resolution keeps local copy until replacement is persisted', () => {
  describe('notes ("both")', () => {
    it('calls coreOutbox.write BEFORE coreOutbox.discard, removes conflict, and creates "(çakışan sürüm)"', async () => {
      const n = await seedNoteConflict();
      const writeSpy = jest.spyOn(coreOutbox, 'write');
      const discardSpy = jest.spyOn(coreOutbox, 'discard');

      const res = await resolveNoteConflict(n.id, 'both', 'Plan');
      expect(res.ok).toBe(true);
      expect(writeSpy).toHaveBeenCalled();
      expect(discardSpy).toHaveBeenCalled();
      expect(writeSpy.mock.invocationCallOrder[0]).toBeLessThan(discardSpy.mock.invocationCallOrder[0]);

      expect(pendingNoteCommands().filter((c) => c.status === 'conflict')).toEqual([]);
      const all = [...server.notes.values()];
      expect(all).toHaveLength(2);
      expect(all.find((x) => x.id !== n.id)).toMatchObject({
        title: 'Plan (çakışan sürüm)',
        content: 'yerel sürümüm',
      });
    });

    it('keeps conflict command and local payload intact when AsyncStorage.setItem fails, and produces 1 copy on retry', async () => {
      const n = await seedNoteConflict();
      const realSetItem = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
      (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('QuotaExceededError'));
      try {
        const failed = await resolveNoteConflict(n.id, 'both', 'Plan');
        expect(failed.ok).toBe(false);

        const conflictsStill = pendingNoteCommands().filter((c) => c.entityId === n.id && c.status === 'conflict');
        expect(conflictsStill).toHaveLength(1);
        expect(conflictsStill[0].payload).toEqual({ content: 'yerel sürümüm' });
      } finally {
        (AsyncStorage.setItem as jest.Mock).mockImplementation(realSetItem);
      }

      // Storage recovers: retrying resolves cleanly with a single conflict copy
      const retried = await resolveNoteConflict(n.id, 'both', 'Plan');
      expect(retried.ok).toBe(true);
      expect(pendingNoteCommands().filter((c) => c.status === 'conflict')).toEqual([]);

      const copies = [...server.notes.values()].filter((x) => x.id !== n.id);
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatchObject({
        title: 'Plan (çakışan sürüm)',
        content: 'yerel sürümüm',
      });
    });
  });

  describe('journal ("both")', () => {
    it('calls coreOutbox.write BEFORE coreOutbox.discard, merges both texts on server, and clears conflict', async () => {
      await seedJournalConflict('2026-10-04');
      const writeSpy = jest.spyOn(coreOutbox, 'write');
      const discardSpy = jest.spyOn(coreOutbox, 'discard');

      const res = await resolveJournalConflict('2026-10-04', 'both');
      expect(res).toEqual({ ok: true });
      expect(writeSpy.mock.invocationCallOrder[0]).toBeLessThan(discardSpy.mock.invocationCallOrder[0]);
      expect(pendingJournalCommands()).toEqual([]);

      const merged = server.journal.get('2026-10-04')!.content;
      expect(merged).toContain('sunucu günlüğü');
      expect(merged).toContain('yerel günlüğüm');
    });

    it('keeps conflict command and local text when AsyncStorage.setItem fails, and merges once when storage recovers', async () => {
      await seedJournalConflict('2026-10-05');
      const realSetItem = (AsyncStorage.setItem as jest.Mock).getMockImplementation()!;
      (AsyncStorage.setItem as jest.Mock).mockRejectedValue(new Error('QuotaExceededError'));
      try {
        const failed = await resolveJournalConflict('2026-10-05', 'both');
        expect(failed.ok).toBe(false);

        const conflict = pendingJournalCommands().find((c) => c.entityId === '2026-10-05' && c.status === 'conflict');
        expect(conflict).toBeDefined();
        expect(conflict?.payload).toMatchObject({ content: 'yerel günlüğüm' });
        expect(server.journal.get('2026-10-05')?.content).toBe('sunucu günlüğü');
      } finally {
        (AsyncStorage.setItem as jest.Mock).mockImplementation(realSetItem);
      }

      const retried = await resolveJournalConflict('2026-10-05', 'both');
      expect(retried).toEqual({ ok: true });
      expect(pendingJournalCommands()).toEqual([]);
      const merged = server.journal.get('2026-10-05')!.content;
      expect(merged).toContain('sunucu günlüğü');
      expect(merged).toContain('yerel günlüğüm');
    });

    it('app crash between persisting merged command and discarding conflict loses no text and resolves to one merged entry', async () => {
      await seedJournalConflict('2026-10-06');
      const theirs = server.journal.get('2026-10-06')!.content;
      const both = `${theirs}\n\n— Bu cihazdaki sürüm —\nyerel günlüğüm`;

      // Simulate writing the merged command to device storage, then process dies BEFORE discard()
      const w = await coreOutbox.write({
        entity: 'journal_entry',
        entityId: '2026-10-06',
        kind: 'update',
        payload: { content: both, mood: 2 },
        baseVersion: contentVersion(theirs),
      });
      expect(w).toMatchObject({ ok: true, savedOnDevice: true });

      // Cold restart over the same persisted AsyncStorage namespace
      const restarted = createOutboxChannel({
        storage: asyncStorageOutboxNs(CORE_OUTBOX_NAMESPACE),
        transports: CORE_TRANSPORTS,
        currentUserId: async () => server.user,
      });
      const loaded = await restarted.ensure();
      expect(loaded?.commands.map((c) => c.status)).toEqual(['conflict', 'pending']);

      // User resolves conflict again in the fresh session -> single merged entry, empty queue
      coreOutbox.reset();
      await coreOutbox.ensure();
      const resolved = await resolveJournalConflict('2026-10-06', 'both');
      expect(resolved).toEqual({ ok: true });
      expect(pendingJournalCommands()).toEqual([]);
      expect(server.journal.get('2026-10-06')!.content).toBe(both);
    });
  });
});
