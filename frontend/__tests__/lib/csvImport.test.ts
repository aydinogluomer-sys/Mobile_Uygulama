/**
 * R08.06 — a mapped CSV import: parse, map, preview, report, import only the
 * valid and new rows.
 */
jest.mock('../../repositories/restoreRepository', () => ({
  fetchExistingRows: jest.fn(async (t: string) => ({ ok: true, data: t === 'tasks' ? [{ id: 'x', title: 'Var olan', due_date: '2026-10-12' }] : [{ id: 'j', date: '2026-10-01' }] })),
  insertRestoredRows: jest.fn(async (_t: string, rows: unknown[]) => ({ ok: true, data: rows.length })),
}));

import { parseCsv, guessMapping, normalizeDate, mapRows, existingKeysFor } from '../../lib/csvImport';
import { previewImport, runImport, rowFor } from '../../services/csvImportService';
import * as repo from '../../repositories/restoreRepository';

describe('parseCsv', () => {
  it('quotes, escaped quotes, newlines inside quotes, ; or , separators, BOM', () => {
    expect(parseCsv('﻿a,b\n"x, y","say ""hi"""\n"line\nbreak",z\n')).toEqual([['a', 'b'], ['x, y', 'say "hi"'], ['line\nbreak', 'z']]);
    expect(parseCsv('a;b\r\n1;2')).toEqual([['a', 'b'], ['1', '2']]);
    expect(parseCsv('\n\n')).toEqual([]);
  });
});

describe('mapping and dates', () => {
  it('guesses from header names', () => {
    expect(guessMapping('tasks', ['Başlık', 'Tarih', 'Not'])).toEqual({ title: 0, due_date: 1, notes_text: 2 });
    expect(guessMapping('journal_entries', ['date', 'entry', 'mood'])).toEqual({ date: 0, content: 1, mood: 2 });
  });
  it('reads the date shapes people use, refuses impossible days', () => {
    expect(normalizeDate('2026-10-12')).toBe('2026-10-12');
    expect(normalizeDate('12.10.2026')).toBe('2026-10-12');
    expect(normalizeDate('1/2/2026')).toBe('2026-02-01');
    expect(normalizeDate('31.02.2026')).toBeNull();
    expect(normalizeDate('dün')).toBeNull();
  });
});

describe('the report', () => {
  const rows = parseCsv('title,date\nRapor yaz,12.10.2026\nRapor yaz,12.10.2026\n,13.10.2026\nVar olan,2026-10-12\nTarihsiz,\nKötü tarih,32.13.2026');
  it('valid, invalid, duplicated in the file, already in the account', () => {
    const r = mapRows({ target: 'tasks', rows, mapping: { title: 0, due_date: 1 }, hasHeader: true, existingKeys: existingKeysFor('tasks', [{ title: 'Var olan', due_date: '2026-10-12' }]) });
    expect(r.ok.map((x) => x.values.title)).toEqual(['Rapor yaz', 'Tarihsiz']);
    expect(r.duplicateInFile).toEqual([3]);
    expect(r.alreadyThere).toEqual([5]);
    expect(r.invalid.map((x) => x.line)).toEqual([4, 7]);
  });
  it('an unmapped required field stops everything, with the reason', () => {
    const r = mapRows({ target: 'tasks', rows, mapping: { due_date: 1 }, hasHeader: true, existingKeys: new Set() });
    expect(r.ok).toEqual([]);
    expect(r.invalid[0].reason).toMatch(/Başlık/);
  });
  it('journal: one entry per date, mood 1-5', () => {
    const j = parseCsv('date,text,mood\n2026-10-01,eski gün,3\n2026-10-02,yeni,4\n2026-10-03,kötü,9');
    const r = mapRows({ target: 'journal_entries', rows: j, mapping: { date: 0, content: 1, mood: 2 }, hasHeader: true, existingKeys: existingKeysFor('journal_entries', [{ date: '2026-10-01' }]) });
    expect(r.ok.map((x) => x.values.date)).toEqual(['2026-10-02']);
    expect(r.alreadyThere).toEqual([2]);
    expect(r.invalid[0].reason).toMatch(/1-5/);
  });
});

describe('the write', () => {
  it('previews against the account, then writes only the valid new rows with fresh ids', async () => {
    const rows = parseCsv('title\nA\nVar olan\nA');
    const p = await previewImport({ target: 'tasks', rows, mapping: { title: 0 }, hasHeader: true });
    if (!p.ok) throw new Error();
    expect(p.report.ok).toHaveLength(2); // "Var olan" has a date in the account, so a dateless one is new
    const r = await runImport('tasks', p.report);
    expect(r).toEqual({ ok: true, inserted: 2 });
    const sent = (repo.insertRestoredRows as jest.Mock).mock.calls[0][1];
    expect(sent[0]).toMatchObject({ title: 'A', status: 'pending', completed: false });
    expect(sent[0].id).not.toBe(sent[1].id);
  });
  it('a journal row keeps its date and mood', () => {
    expect(rowFor('journal_entries', { date: '2026-10-02', content: 'x', mood: 4 })).toMatchObject({ date: '2026-10-02', content: 'x', mood: 4 });
  });
});
