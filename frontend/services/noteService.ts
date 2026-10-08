/**
 * Notes: reads, and writes through the core outbox (R02.03).
 *
 * A note gets its id on the device, so a create delivered twice is one note.
 * An edit carries the `updated_at` it was made against; if the note changed
 * elsewhere meanwhile the edit is a CONFLICT and both versions are kept until
 * the user picks -- "aynı notta çatışan sürümü koru" (R02.05, T08).
 */
import { coreOutbox } from './coreOutbox';
import {
  fetchNotesPage, searchNotes, fetchNoteRow, type NoteRow,
} from '../repositories/noteRepository';
import { newOperationId, type OutboxCommand } from '../lib/outbox';
import type { Cursor } from '../repositories/shared';

export type { NoteRow };
export const listNotesPage = (cursor?: Cursor | null) => fetchNotesPage(cursor);
export const findNotes = (q: string) => searchNotes(q);

export const NOTE_ENTITY = 'note';

type Result = { ok: true; delivered: boolean; savedOnDevice: boolean } | { ok: false; error: string };

const stillPending = (id: string) => pendingNoteCommands().some((c) => c.entityId === id);

export function pendingNoteCommands(): OutboxCommand[] {
  return (coreOutbox.state()?.commands ?? []).filter((c) => c.entity === NOTE_ENTITY);
}

export async function createNote(input: { title: string; content: string; tags?: string[] }): Promise<Result & { id?: string }> {
  const id = newOperationId();
  const w = await coreOutbox.write({ entity: NOTE_ENTITY, entityId: id, kind: 'create', payload: { title: input.title, content: input.content, tags: input.tags ?? [] } });
  if (!w.ok) return w;
  await coreOutbox.flush();
  return { ok: true, id, delivered: !stillPending(id), savedOnDevice: w.savedOnDevice };
}

/** `baseVersion` = the note's `updated_at` as this device last saw it from the server. */
export async function editNote(id: string, patch: { title?: string; content?: string; tags?: string[] }, baseVersion: string | null): Promise<Result> {
  const w = await coreOutbox.write({ entity: NOTE_ENTITY, entityId: id, kind: 'update', payload: patch, baseVersion });
  if (!w.ok) return w;
  await coreOutbox.flush();
  return { ok: true, delivered: !stillPending(id), savedOnDevice: w.savedOnDevice };
}

export async function removeNote(id: string): Promise<Result> {
  const w = await coreOutbox.write({ entity: NOTE_ENTITY, entityId: id, kind: 'delete' });
  if (!w.ok) return w;
  await coreOutbox.flush();
  return { ok: true, delivered: !stillPending(id), savedOnDevice: w.savedOnDevice };
}

export type ConflictChoice = 'mine' | 'theirs' | 'both';

/**
 * `mine`: this device's edit over the server's current version. `theirs`:
 * drop this device's edit. `both`: keep the server's note AND this device's
 * text as a new note "(çakışan sürüm)" -- nothing is lost.
 */
export async function resolveNoteConflict(id: string, choice: ConflictChoice, localTitle: string): Promise<{ ok: boolean; error?: string; copyId?: string }> {
  const cmd = pendingNoteCommands().find((c) => c.entityId === id && c.status === 'conflict');
  if (!cmd) return { ok: false, error: 'Çakışma bulunamadı.' };
  if (choice === 'theirs') { await coreOutbox.discard(cmd.operationId); return { ok: true }; }
  const cur = await fetchNoteRow(id);
  if (!cur.ok) return { ok: false, error: cur.error };
  if (choice === 'mine') {
    await coreOutbox.retry(cmd.operationId, cur.data?.updated_at ?? null);
    await coreOutbox.flush();
    return { ok: true };
  }
  const p = cmd.payload as { title?: string; content?: string; tags?: string[] };
  await coreOutbox.discard(cmd.operationId);
  const copy = await createNote({
    title: `${p.title ?? localTitle} (çakışan sürüm)`,
    content: p.content ?? cur.data?.content ?? '',
    tags: p.tags ?? cur.data?.tags ?? [],
  });
  return copy.ok ? { ok: true, copyId: copy.id } : { ok: false, error: copy.error };
}
