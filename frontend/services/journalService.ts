/**
 * Journal entries: reads, and writes through the core outbox (R02.03).
 *
 * One entry per local day; the day IS the entity id. A save is kept on the
 * device first and delivered after, so an entry written in airplane mode is
 * not lost. The version of an entry is a hash of its text (`contentVersion`):
 * an edit made over a day that another device has meanwhile rewritten is a
 * conflict, and BOTH texts are kept until the user picks (R02.05, T08).
 */
import { coreOutbox, contentVersion } from './coreOutbox';
import {
  fetchJournalEntries, fetchJournalEntry, type JournalEntryRow,
} from '../repositories/journalRepository';
import type { OutboxCommand } from '../lib/outbox';

export type { JournalEntryRow };
export const listJournalEntries = () => fetchJournalEntries();
export const getJournalEntry = (date: string) => fetchJournalEntry(date);
export { contentVersion };

export const JOURNAL_ENTITY = 'journal_entry';

export type SaveOutcome = { ok: true; savedOnDevice: boolean; delivered: boolean } | { ok: false; error: string };

/**
 * Save the day's text. `baseContent` is the server text the edit started
 * from (undefined = unknown / no entry yet). Delivery is attempted before
 * returning; offline, the change waits in the outbox.
 */
export async function saveJournalEntry(input: {
  date: string; content: string; mood: number | null; aiSummary?: boolean; baseContent?: string | null;
}): Promise<SaveOutcome> {
  const payload: Record<string, unknown> = { content: input.content, mood: input.mood };
  if (input.aiSummary !== undefined) payload.ai_summary = input.aiSummary;
  const w = await coreOutbox.write({
    entity: JOURNAL_ENTITY, entityId: input.date, kind: 'update', payload,
    baseVersion: contentVersion(input.baseContent ?? ''),
  });
  if (!w.ok) return w;
  await coreOutbox.flush();
  const still = pendingJournalCommands().some((c) => c.entityId === input.date);
  return { ok: true, savedOnDevice: w.savedOnDevice, delivered: !still };
}

/** Unsent (pending, dead or conflicting) journal commands of the signed-in account. */
export function pendingJournalCommands(): OutboxCommand[] {
  return (coreOutbox.state()?.commands ?? []).filter((c) => c.entity === JOURNAL_ENTITY);
}

export type ConflictChoice = 'mine' | 'theirs' | 'both';

/**
 * Resolve a journal conflict. `mine` writes this device's text over the
 * server's; `theirs` drops this device's change; `both` keeps the server text
 * and appends this device's below a marker -- nothing is lost.
 */
export async function resolveJournalConflict(date: string, choice: ConflictChoice): Promise<{ ok: boolean; error?: string }> {
  const cmd = pendingJournalCommands().find((c) => c.entityId === date && c.status === 'conflict');
  if (!cmd) return { ok: false, error: 'Çakışma bulunamadı.' };
  const server = await fetchJournalEntry(date);
  if (!server.ok) return { ok: false, error: server.error };
  const theirs = server.data?.content ?? '';
  const mine = String((cmd.payload as { content?: string }).content ?? '');
  if (choice === 'theirs') { await coreOutbox.discard(cmd.operationId); return { ok: true }; }
  if (choice === 'mine') { await coreOutbox.retry(cmd.operationId, contentVersion(theirs)); await coreOutbox.flush(); return { ok: true }; }
  const both = `${theirs.trim()}\n\n— Bu cihazdaki sürüm —\n${mine.trim()}`;
  const r = await saveJournalEntry({ date, content: both, mood: server.data?.mood ?? null, baseContent: theirs });
  if (!r.ok) return { ok: false, error: r.error };
  if (!r.savedOnDevice) return { ok: false, error: 'Birleşik metin cihaza kaydedilemedi; çakışma korunuyor, tekrar dene.' };
  await coreOutbox.discard(cmd.operationId);
  await coreOutbox.flush(); // merged command waited behind the conflicted predecessor (outbox.ts ready())
  return { ok: true };
}
