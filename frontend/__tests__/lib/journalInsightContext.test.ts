/**
 * R09.05 — what a journal insight is built from (the user's choice, whole
 * records, nothing deleted) and the app's own numbers beside it.
 */
import { INSIGHT_PROMPT_LIMIT, insightBasis, insightFacts, insightPrompt, type InsightEntry } from '../../lib/journalInsightContext';

const E = (date: string, content: string, mood: number | null = null): InsightEntry => ({ date, content, mood });

describe('insightPrompt', () => {
  const es = [E('2026-10-07', 'Yorgundum', 2), E('2026-10-05', 'Koşu güzeldi', 4), E('2026-10-06', 'Özel bir şey', 3), E('2026-10-08', '   ')];

  it('old -> new, mood label, empty records send nothing', () => {
    const p = insightPrompt(es, new Set());
    expect(p.used).toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
    expect(p.text.split('\n\n')[0]).toMatch(/^2026-10-05 \[[^\]]+\]: Koşu güzeldi$/);
    expect(p).toMatchObject({ excluded: 0, dropped: 0 });
  });

  it('a record the user left out is not in the text at all', () => {
    const p = insightPrompt(es, new Set(['2026-10-06']));
    expect(p.text).not.toMatch(/Özel bir şey/);
    expect(p.used).toEqual(['2026-10-05', '2026-10-07']);
    expect(p.excluded).toBe(1);
  });

  it('a deleted record is simply not among the entries -- nothing of it is sent', () => {
    const p = insightPrompt(es.filter((e) => e.date !== '2026-10-07'), new Set());
    expect(p.text).not.toMatch(/Yorgundum/);
  });

  it('past the limit: whole records, the oldest dropped and counted -- never a cut one', () => {
    const long = Array.from({ length: 5 }, (_, i) => E(`2026-10-0${i + 1}`, 'x'.repeat(30)));
    const p = insightPrompt(long, new Set(), 100);
    expect(p.used).toEqual(['2026-10-04', '2026-10-05']);
    expect(p.dropped).toBe(3);
    expect(p.text.length).toBeLessThanOrEqual(100);
    for (const part of p.text.split('\n\n')) expect(part).toMatch(/: x{30}$/);
    expect(INSIGHT_PROMPT_LIMIT).toBe(7000);
  });
});

describe('the app\'s numbers and the basis line', () => {
  it('facts are computed from exactly the sent records', () => {
    const es = [E('2026-10-05', 'a', 4), E('2026-10-06', 'b', 1), E('2026-10-07', 'c', null)];
    expect(insightFacts(es, ['2026-10-05', '2026-10-07'])).toEqual({ count: 2, moodAvg: 4, first: '2026-10-05', last: '2026-10-07' });
    expect(insightFacts(es, [])).toEqual({ count: 0, moodAvg: null, first: null, last: null });
  });
  it('basis: records, period, day; stale when the count differs or a record was written after', () => {
    const saved = { entry_count: 3, updated_at: '2026-10-07T12:00:00Z' };
    expect(insightBasis(saved, 'Bu hafta', { count: 3, lastWrite: '2026-10-06T08:00:00Z' })).toEqual({ line: '3 kayıttan · Bu hafta · 2026-10-07', stale: false });
    expect(insightBasis(saved, 'Bu hafta', { count: 2, lastWrite: null }).stale).toBe(true);
    expect(insightBasis(saved, 'Bu hafta', { count: 3, lastWrite: '2026-10-08T08:00:00Z' }).stale).toBe(true);
  });
});
