/**
 * Journal entries: reads, and writes through the core outbox (R02.03 / F46).
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
 * Resolve a journal conflict. `both` atomically replaces the conflicted command
 * with the combined entry on the same date; if persistence fails, memory rolls back.
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
  const replaced = await coreOutbox.replace(cmd.operationId, {
    entity: JOURNAL_ENTITY,
    entityId: date,
    kind: 'update',
    payload: { content: both, mood: server.data?.mood ?? null },
    baseVersion: contentVersion(theirs),
  });
  if (!replaced.ok || !replaced.savedOnDevice) {
    return { ok: false, error: 'Çakışma çözümü cihaza kaydedilemedi; çakışma korunuyor.' };
  }
  await coreOutbox.flush();
  return { ok: true };
}
