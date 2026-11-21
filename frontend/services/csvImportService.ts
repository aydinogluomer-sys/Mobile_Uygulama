/**
 * R08.06 / F20 (SYN-18) — the write half of a mapped CSV import: each valid row
 * gets a stable id at preview time so a resumed run after a partial failure
 * never duplicates rows from earlier chunks.
 */
import { existingKeysFor, mapRows, type ImportReport, type ImportTarget, type Mapping } from '../lib/csvImport';
import { newOperationId } from '../lib/outbox';
import { currentUser } from '../lib/session';
import { fetchExistingRows, insertRestoredRows } from '../repositories/restoreRepository';

export async function previewImport(params: {
  target: ImportTarget;
  rows: string[][];
  mapping: Mapping;
  hasHeader: boolean;
}): Promise<{ ok: true; report: ImportReport } | { ok: false; error: string }> {
  const existing = await fetchExistingRows(params.target);
  if (!existing.ok) return { ok: false, error: existing.error };
  const report = mapRows({ ...params, existingKeys: existingKeysFor(params.target, existing.data) });
  report.ok = report.ok.map((r) => ({ ...r, id: r.id ?? newOperationId() }));
  return { ok: true, report };
}

export function rowFor(target: ImportTarget, values: Record<string, unknown>, id: string): Record<string, unknown> {
  if (target === 'tasks') {
    return {
      id,
      title: values.title,
      due_date: values.due_date ?? null,
      notes_text: values.notes_text ?? null,
      status: 'pending',
      priority: 'none',
      list_type: 'inbox',
      completed: false,
    };
  }
  return { id, date: values.date, content: values.content, mood: values.mood ?? null };
}

export type ImportRun =
  | { ok: true; inserted: number; skipped: number }
  | { ok: false; error: string; inserted: number; skipped: number; remaining: ImportReport };

export async function runImport(target: ImportTarget, report: ImportReport): Promise<ImportRun> {
  const me = await currentUser();
  if (!me) return { ok: false, error: 'Oturum bulunamadı.', inserted: 0, skipped: 0, remaining: report };
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < report.ok.length; i += 50) {
    const slice = report.ok.slice(i, i + 50);
    const res = await insertRestoredRows(
      target,
      slice.map((r) => rowFor(target, r.values, r.id ?? newOperationId())),
      me.id,
    );
    if (!res.ok) {
      const done = i + (res.partial ?? 0);
      return {
        ok: false,
        error: res.error,
        inserted: inserted + (res.partial ?? 0),
        skipped,
        remaining: { ...report, ok: report.ok.slice(done) },
      };
    }
    inserted += res.data;
    skipped += res.skipped ?? 0;
  }
  return { ok: true, inserted, skipped };
}
