/**
 * R02.03 / R02.05 — the outbox for the core records that are not tasks:
 * journal entries, notes, recovery plans and focus sessions.
 *
 * Each entity has one transport. Every transport is idempotent, so the same
 * command delivered five times (a lost response, an app kill between the
 * server applying it and the outbox saving that) has ONE effect:
 *
 *   create   -> insert with the client-made id; 23505 = it already landed.
 *   update   -> versioned where the table has a version (notes: updated_at;
 *               journal: a hash of the content the edit started from). A moved
 *               version is a CONFLICT and the local text is kept, never
 *               overwritten and never dropped (R02.05, T08 "aynı notta
 *               çatışan sürümü koru"). The user decides: keep mine, keep
 *               theirs, or keep both.
 *   delete   -> delete if present; already gone = applied. The outbox
 *               tombstones the id, so a late edit cannot bring it back.
 *
 * Commands carry the account that queued them; a transport refuses to run as
 * any other account (R02.06).
 */
import { classifyFailure, type Transport } from './outboxRunner';
import { createOutboxChannel } from './outboxChannel';
import { asyncStorageOutboxNs } from '../lib/outboxStorage';
import type { DeliveryOutcome, OutboxCommand } from '../lib/outbox';
import { currentUser } from '../lib/session';
import { fetchJournalEntry, upsertJournalEntry } from '../repositories/journalRepository';
import { insertNoteWithId, updateNoteVersioned, fetchNoteRow, deleteNoteIfPresent, type NoteRow } from '../repositories/noteRepository';
import { insertRecoveryPlanRow, updateRecoveryPlanRow, deleteRecoveryPlanIfPresent } from '../repositories/recoveryRepository';
import { insertFocusSessionRow } from '../repositories/focusSessionRepository';

export const CORE_OUTBOX_NAMESPACE = 'core';

/**
 * The version of a journal entry's text: journal_entries has no updated_at
 * (and its definition is not in this repo, S12), so the content itself is the
 * version. FNV-1a over UTF-16 units plus the length.
 */
export function contentVersion(text: string | null | undefined): string {
  const s = text ?? '';
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `c${s.length}:${h.toString(16)}`;
}

const applied = (version?: string | null): DeliveryOutcome => ({ kind: 'applied', version: version ?? null });

export const journalTransport: Transport = async (cmd) => {
  const p = cmd.payload as { content: string; mood?: number | null; ai_summary?: boolean };
  const cur = await fetchJournalEntry(cmd.entityId);
  if (!cur.ok) return classifyFailure(cur);
  const server = cur.data?.content ?? '';
  // Someone else wrote this day since the edit began (or wrote it while we
  // thought it was empty): keep both sides, let the user choose.
  if (server.trim() !== '' && server !== p.content && contentVersion(server) !== (cmd.baseVersion ?? contentVersion(''))) {
    return { kind: 'conflict', error: 'Bu günün kaydı başka bir yerde değiştirilmiş.' };
  }
  const res = await upsertJournalEntry({ date: cmd.entityId, content: p.content, mood: p.mood ?? null, aiSummary: p.ai_summary }, cmd.userId);
  if (!res.ok) return classifyFailure(res);
  return applied(contentVersion(res.data.content));
};

const holds = (row: NoteRow, payload: Record<string, unknown>) =>
  Object.entries(payload).every(([k, v]) => k === 'updated_at' || JSON.stringify((row as Record<string, unknown>)[k]) === JSON.stringify(v));

export const noteTransport: Transport = async (cmd) => {
  if (cmd.kind === 'create') {
    const p = cmd.payload as { title: string; content: string; tags?: string[] };
    const res = await insertNoteWithId({ id: cmd.entityId, title: p.title, content: p.content, tags: p.tags ?? [] }, cmd.userId);
    if (res.ok) return applied(res.data.updated_at);
    if (res.code === '23505') {
      const cur = await fetchNoteRow(cmd.entityId);
      return cur.ok && cur.data ? applied(cur.data.updated_at) : applied();
    }
    return classifyFailure(res);
  }
  if (cmd.kind === 'update') {
    const res = await updateNoteVersioned(cmd.entityId, { ...cmd.payload, updated_at: new Date().toISOString() }, cmd.baseVersion, cmd.userId);
    if (!res.ok) return classifyFailure(res);
    if (!res.data.exists) return { kind: 'gone' };
    if (!res.data.row) {
      // The version moved. If the server already holds exactly these values,
      // it was THIS command landing before the outbox could record it.
      const cur = await fetchNoteRow(cmd.entityId);
      if (!cur.ok) return classifyFailure(cur);
      if (!cur.data) return { kind: 'gone' };
      if (holds(cur.data, cmd.payload)) return applied(cur.data.updated_at);
      return { kind: 'conflict', error: 'Bu not başka bir yerde değiştirilmiş.' };
    }
    return applied(res.data.row.updated_at);
  }
  const res = await deleteNoteIfPresent(cmd.entityId, cmd.userId);
  return res.ok ? applied() : classifyFailure(res);
};

export const recoveryPlanTransport: Transport = async (cmd) => {
  if (cmd.kind === 'create') {
    const res = await insertRecoveryPlanRow({ ...cmd.payload, id: cmd.entityId }, cmd.userId);
    if (res.ok || res.code === '23505') return applied();
    return classifyFailure(res);
  }
  if (cmd.kind === 'update') {
    const res = await updateRecoveryPlanRow(cmd.entityId, cmd.payload, cmd.userId);
    if (!res.ok) return classifyFailure(res);
    return res.data.exists ? applied() : { kind: 'gone' };
  }
  const res = await deleteRecoveryPlanIfPresent(cmd.entityId, cmd.userId);
  return res.ok ? applied() : classifyFailure(res);
};

export const focusSessionTransport: Transport = async (cmd: OutboxCommand) => {
  if (cmd.kind !== 'create') return { kind: 'rejected', error: 'a focus session is only ever created' };
  const res = await insertFocusSessionRow({ ...cmd.payload, id: cmd.entityId }, cmd.userId);
  if (res.ok || res.code === '23505') return applied();
  return classifyFailure(res);
};

export const CORE_TRANSPORTS = {
  journal_entry: journalTransport,
  note: noteTransport,
  recovery_plan: recoveryPlanTransport,
  focus_session: focusSessionTransport,
} as const;

export const coreOutbox = createOutboxChannel({
  storage: asyncStorageOutboxNs(CORE_OUTBOX_NAMESPACE),
  transports: CORE_TRANSPORTS,
  currentUserId: async () => (await currentUser())?.id ?? null,
});
