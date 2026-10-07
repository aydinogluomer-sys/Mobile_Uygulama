/**
 * R08.06 — the write half of a mapped CSV import: only the rows the report
 * marked valid and new, as new rows of the signed-in account. Nothing is
 * updated or overwritten.
 */
import { existingKeysFor, mapRows, type ImportReport, type ImportTarget, type Mapping } from '../lib/csvImport';
import { fetchExistingRows, insertRestoredRows } from '../repositories/restoreRepository';
import { newOperationId } from '../lib/outbox';

export async function previewImport(params: { target: ImportTarget; rows: string[][]; mapping: Mapping; hasHeader: boolean }):
  Promise<{ ok: true; report: ImportReport } | { ok: false; error: string }> {
  const existing = await fetchExistingRows(params.target);
  // An unreadable account is not "empty": refuse rather than import duplicates.
  if (!existing.ok) return { ok: false, error: existing.error };
  return { ok: true, report: mapRows({ ...params, existingKeys: existingKeysFor(params.target, existing.data) }) };
}

export function rowFor(target: ImportTarget, values: Record<string, unknown>): Record<string, unknown> {
  if (target === 'tasks') {
    return {
      id: newOperationId(), title: values.title, due_date: values.due_date ?? null, notes_text: values.notes_text ?? null,
      status: 'pending', priority: 'none', list_type: 'inbox', completed: false,
    };
  }
  return { id: newOperationId(), date: values.date, content: values.content, mood: values.mood ?? null };
}

export async function runImport(target: ImportTarget, report: ImportReport): Promise<{ ok: true; inserted: number } | { ok: false; error: string; inserted: number }> {
  let inserted = 0;
  for (let i = 0; i < report.ok.length; i += 50) {
    const chunk = report.ok.slice(i, i + 50).map((r) => rowFor(target, r.values));
    const res = await insertRestoredRows(target, chunk);
    if (!res.ok) return { ok: false, error: res.error, inserted };
    inserted += res.data;
  }
  return { ok: true, inserted };
}
