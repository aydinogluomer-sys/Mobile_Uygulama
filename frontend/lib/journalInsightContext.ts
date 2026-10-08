/**
 * R09.05 — what a journal insight is built from, and what it may claim.
 *
 * "R07 içgörülerini kayıt/dönem/örneklemle açıkla. Günlük bağlamı ayrıca
 * kullanıcı kontrolünde olsun; modelin ürettiği sayı hesap otoritesi olmasın.
 * Silinmiş/izin verilmemiş içerik yeni prompt'a girmez."
 *
 * - The prompt is built ONLY from the entries the screen holds now (a deleted
 *   entry is no longer there) minus the ones the user left out. Empty entries
 *   send nothing.
 * - Whole entries, never a cut one: past the limit the OLDEST are dropped and
 *   the count says so; `used` is exactly what was sent.
 * - The explanation (how many records, which period, when) and the numbers
 *   beside the model's text are the APP's arithmetic, labelled as such; the
 *   model's text is labelled as commentary.
 *
 * Pure.
 */
import { moodMeta } from './journalMoods';

export type InsightEntry = { date: string; mood: number | null; content: string };

export const INSIGHT_PROMPT_LIMIT = 7000;

export type InsightPrompt = {
  text: string;
  /** The dates actually sent, old -> new. */
  used: string[];
  /** Left out by the user. */
  excluded: number;
  /** Did not fit (oldest first). */
  dropped: number;
};

function line(e: InsightEntry): string {
  const m = moodMeta(e.mood);
  return `${e.date}${m ? ` [${m.label}]` : ''}: ${e.content.trim()}`;
}

export function insightPrompt(entries: readonly InsightEntry[], excluded: ReadonlySet<string>, limit = INSIGHT_PROMPT_LIMIT): InsightPrompt {
  const withText = entries.filter((e) => e.content.trim().length > 0);
  const allowed = withText.filter((e) => !excluded.has(e.date)).sort((a, b) => a.date.localeCompare(b.date));
  const keep: InsightEntry[] = [];
  let size = 0;
  for (let i = allowed.length - 1; i >= 0; i--) {
    const add = line(allowed[i]).length + (keep.length ? 2 : 0);
    if (size + add > limit) break;
    keep.unshift(allowed[i]);
    size += add;
  }
  return {
    text: keep.map(line).join('\n\n'),
    used: keep.map((e) => e.date),
    excluded: withText.length - allowed.length,
    dropped: allowed.length - keep.length,
  };
}

/** The app's own numbers for the sent entries -- shown beside, never taken from, the model's text. */
export function insightFacts(entries: readonly InsightEntry[], used: readonly string[]): { count: number; moodAvg: number | null; first: string | null; last: string | null } {
  const set = new Set(used);
  const sent = entries.filter((e) => set.has(e.date));
  const moods = sent.map((e) => e.mood).filter((m): m is number => m != null);
  const sorted = [...used].sort();
  return {
    count: sent.length,
    moodAvg: moods.length ? Math.round((moods.reduce((a, b) => a + b, 0) / moods.length) * 10) / 10 : null,
    first: sorted[0] ?? null,
    last: sorted[sorted.length - 1] ?? null,
  };
}

/**
 * The basis line under a saved insight: "N kayıttan · <period> · <day>", and
 * whether the records changed since (count differs, or an entry was written
 * after the insight).
 */
export function insightBasis(
  saved: { entry_count: number; updated_at: string },
  periodLabel: string,
  current: { count: number; lastWrite: string | null },
): { line: string; stale: boolean } {
  const day = saved.updated_at.slice(0, 10);
  const stale = saved.entry_count !== current.count || (current.lastWrite !== null && current.lastWrite > saved.updated_at);
  return { line: `${saved.entry_count} kayıttan · ${periodLabel} · ${day}`, stale };
}
