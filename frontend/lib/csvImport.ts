/**
 * R08.06 — importing a CSV the user maps by hand: tasks or journal entries.
 *
 * Generic on purpose. No app-specific adapter (Habitify, Daylio) is claimed:
 * an adapter is written only from a real anonymised export (stop point S6).
 * Habit check-ins are not importable at all -- every log row is scored by
 * the server (XP), the same reason a restore never writes them.
 *
 * Flow: parse -> the user maps columns to fields -> preview (first rows, as
 * they will be written) -> a report of what is invalid, duplicated within the
 * file, or already in the account -> only the valid, new rows are imported.
 *
 * Pure.
 */
import { parseLocalDate, ymd } from './date';

/** RFC 4180-ish: quoted fields, "" escapes, commas/newlines inside quotes, `;` or `,` separators. */
export function parseCsv(text: string): string[][] {
  const src = String(text ?? '').replace(/^﻿/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [], field = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

export type ImportTarget = 'tasks' | 'journal_entries';

export const TARGET_FIELDS: Record<ImportTarget, { field: string; label: string; required: boolean }[]> = {
  tasks: [
    { field: 'title', label: 'Başlık', required: true },
    { field: 'due_date', label: 'Tarih', required: false },
    { field: 'notes_text', label: 'Not', required: false },
  ],
  journal_entries: [
    { field: 'date', label: 'Tarih', required: true },
    { field: 'content', label: 'Metin', required: true },
    { field: 'mood', label: 'Ruh hali (1-5)', required: false },
  ],
};

/** field -> column index (or undefined = not mapped). */
export type Mapping = Record<string, number | undefined>;

/** A first guess from the header names; the user corrects it. */
export function guessMapping(target: ImportTarget, header: readonly string[]): Mapping {
  const h = header.map((x) => x.trim().toLocaleLowerCase('tr'));
  const find = (...names: string[]) => { const i = h.findIndex((x) => names.includes(x)); return i >= 0 ? i : undefined; };
  if (target === 'tasks') return { title: find('title', 'başlık', 'görev', 'task', 'name'), due_date: find('due_date', 'date', 'tarih'), notes_text: find('notes', 'not', 'description', 'açıklama') };
  return { date: find('date', 'tarih', 'gün'), content: find('content', 'metin', 'note', 'not', 'entry'), mood: find('mood', 'ruh hali', 'duygu') };
}

/** Dates as the user's files write them: YYYY-MM-DD, DD.MM.YYYY, DD/MM/YYYY. */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return parseLocalDate(s) ? s : null;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  return d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[1]) ? ymd(d) : null;
}

export type ImportRow = { line: number; values: Record<string, unknown>; id?: string };
export type ImportReport = {
  ok: ImportRow[];
  invalid: { line: number; reason: string }[];
  duplicateInFile: number[];
  alreadyThere: number[];
};

/** The duplicate key per target: a task by title+date, a journal entry by date (one per day). */
function keyOf(target: ImportTarget, v: Record<string, unknown>): string {
  return target === 'tasks' ? `${String(v.title).toLocaleLowerCase('tr')}|${v.due_date ?? ''}` : String(v.date);
}

export function mapRows(params: {
  target: ImportTarget;
  rows: readonly string[][];
  mapping: Mapping;
  hasHeader: boolean;
  /** Keys already in the account (same shape as keyOf). */
  existingKeys: ReadonlySet<string>;
}): ImportReport {
  const { target, rows, mapping, hasHeader, existingKeys } = params;
  const report: ImportReport = { ok: [], invalid: [], duplicateInFile: [], alreadyThere: [] };
  const seen = new Set<string>();
  const fields = TARGET_FIELDS[target];
  const missing = fields.filter((f) => f.required && mapping[f.field] === undefined);
  if (missing.length > 0) {
    report.invalid.push({ line: 0, reason: `Eşlenmemiş zorunlu alan: ${missing.map((m) => m.label).join(', ')}` });
    return report;
  }
  rows.forEach((r, i) => {
    if (hasHeader && i === 0) return;
    const line = i + 1;
    const cell = (f: string) => { const c = mapping[f]; return c === undefined ? '' : (r[c] ?? '').trim(); };
    const v: Record<string, unknown> = {};
    if (target === 'tasks') {
      const title = cell('title');
      if (!title) { report.invalid.push({ line, reason: 'Başlık boş' }); return; }
      if (title.length > 200) { report.invalid.push({ line, reason: 'Başlık 200 karakteri aşıyor' }); return; }
      v.title = title;
      const d = cell('due_date');
      if (d) { const n = normalizeDate(d); if (!n) { report.invalid.push({ line, reason: `Tarih okunamadı: ${d}` }); return; } v.due_date = n; }
      const note = cell('notes_text');
      if (note) v.notes_text = note;
    } else {
      const d = normalizeDate(cell('date'));
      if (!d) { report.invalid.push({ line, reason: `Tarih okunamadı: ${cell('date')}` }); return; }
      const content = cell('content');
      if (!content) { report.invalid.push({ line, reason: 'Metin boş' }); return; }
      v.date = d;
      v.content = content;
      const m = cell('mood');
      if (m) { const n = Number(m); if (!Number.isInteger(n) || n < 1 || n > 5) { report.invalid.push({ line, reason: `Ruh hali 1-5 olmalı: ${m}` }); return; } v.mood = n; }
    }
    const k = keyOf(target, v);
    if (seen.has(k)) { report.duplicateInFile.push(line); return; }
    seen.add(k);
    if (existingKeys.has(k)) { report.alreadyThere.push(line); return; }
    report.ok.push({ line, values: v });
  });
  return report;
}

export function existingKeysFor(target: ImportTarget, rows: readonly Record<string, unknown>[]): Set<string> {
  return new Set(rows.map((r) => keyOf(target, r)));
}

/** CSV hücresinin başında formül gibi yorumlanabilecek karakterler: = + - @ sekme satır-başı. */
export const FORMULA_PREFIX = /^(?:[\t\r]|\s*[=+\-@])/;

/**
 * Bir CSV hücresini yazar. YALNIZ `string` değerlere formül öneki (`'`) eklenir; `number` ve `boolean`
 * dokunulmaz (negatif sayı bozulmaz). Virgül, tırnak, \n ve \r içeren hücre tırnaklanır.
 */
export function escapeCsvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (typeof v === 'string' && FORMULA_PREFIX.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
