/**
 * R07.03 — "Tarihçe, takvim, arama ve etiket filtresi sun. Yeni ses/fotoğraf/
 * dosya altyapısı açma."
 */
import { searchEntries, monthGrid, shiftMonth } from '../../lib/journalBrowse';

const E = (date: string, content: string, mood: number | null = null) => ({ id: `j-${date}`, date, content, mood });
const entries = [
  E('2026-10-01', 'Sabah koşusu, İLAÇ almayı unuttum', 3),
  E('2026-10-05', 'Irmak kenarında yürüdüm #doğa', 4),
  E('2026-10-07', 'Toplantı uzun sürdü; ilaç aldım', 2),
  E('2026-09-30', 'Ay sonu değerlendirmesi'),
];

describe('search', () => {
  it('Turkish case folding: ilaç finds İLAÇ, ırmak finds Irmak', () => {
    expect(searchEntries(entries, 'ilaç').map((e) => e.date)).toEqual(['2026-10-07', '2026-10-01']);
    expect(searchEntries(entries, 'ırmak').map((e) => e.date)).toEqual(['2026-10-05']);
  });
  it('every word must appear, in any order; a #tag is just text', () => {
    expect(searchEntries(entries, 'aldım ilaç').map((e) => e.date)).toEqual(['2026-10-07']);
    expect(searchEntries(entries, '#doğa').map((e) => e.date)).toEqual(['2026-10-05']);
    expect(searchEntries(entries, 'yok böyle')).toEqual([]);
  });
  it('an empty query returns everything', () => {
    expect(searchEntries(entries, '   ')).toHaveLength(4);
  });
});

describe('calendar', () => {
  it('October 2026: Monday-first weeks, every day of the month, entries on their day', () => {
    const g = monthGrid(entries, 2026, 10);
    expect(g[0].map((d) => d.date)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    const inMonth = g.flat().filter((d) => d.inMonth);
    expect(inMonth).toHaveLength(31);
    expect(inMonth.filter((d) => d.entryId).map((d) => d.date)).toEqual(['2026-10-01', '2026-10-05', '2026-10-07']);
    expect(g.flat().find((d) => d.date === '2026-09-30')).toMatchObject({ inMonth: false, entryId: 'j-2026-09-30' });
    expect(g.every((w) => w.length === 7)).toBe(true);
  });
  it('February 2027 starts on a Monday and fits four weeks', () => {
    const g = monthGrid([], 2027, 2);
    expect(g).toHaveLength(4);
    expect(g[0][0].date).toBe('2027-02-01');
  });
  it('month navigation wraps the year', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});
