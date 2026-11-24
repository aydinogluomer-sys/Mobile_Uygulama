/**
 * Cross-domain search — what the command palette runs.  (plan §8, §30)
 *
 * The palette needs one answer assembled from every user-owned surface that
 * has a name a person would type. Doing that in the component meant it
 * reached into the repositories directly, and meant the per-source limits and
 * the failure policy were written inline next to the rendering.
 *
 * ## The failure policy, and why it is now reported
 *
 * A source that errors contributes NOTHING rather than failing the whole
 * search: a palette that shows no habits because the notes query timed out is
 * worse than one that shows the habits it found.
 *
 * That policy was silent, and silence is where it went wrong. When every
 * source failed — no network, expired session — the caller received five
 * empty arrays, which is byte-identical to "you have nothing matching". The
 * palette then rendered "Sonuç yok" over a search that had not actually run.
 *
 * So the failures come back with the results. Degrading is still the
 * behaviour; pretending it did not happen is not.
 */
import { searchHabits } from './habitService';
import { searchTasks } from './taskService';
import { likeContains, normalizeSearchTerm } from '../repositories/likePattern';
import { searchNotes } from '../repositories/noteRepository';
import { searchProjects } from '../repositories/projectRepository';
import { searchJournalEntries } from '../repositories/journalRepository';

/** Every source the palette searches. Order is the order results render in. */
export const SEARCH_SOURCES = ['tasks', 'habits', 'notes', 'projects', 'journal'] as const;
export type SearchSource = (typeof SEARCH_SOURCES)[number];

export type SearchResults<T = unknown, H = unknown, N = unknown, P = unknown, J = unknown> = {
  tasks: T[];
  habits: H[];
  notes: N[];
  projects: P[];
  journal: J[];
  /**
   * Sources whose query failed. Empty on a fully successful search.
   *
   * A caller that ignores this gets the old behaviour — the partial results —
   * so nothing breaks by not reading it; but a caller that renders "no
   * results" is obliged to check it first.
   */
  failed: SearchSource[];
};

const PER_SOURCE = 5;

export async function searchEverything(
  query: string,
  perSource = PER_SOURCE,
): Promise<SearchResults> {
  const q = normalizeSearchTerm(query);
  const empty: SearchResults = { tasks: [], habits: [], notes: [], projects: [], journal: [], failed: [] };
  if (q === null || likeContains(q) === null) return empty;

  const limit = Math.max(1, perSource);

  // `Promise.all` rather than `allSettled`: every one of these returns a
  // RepoResult and none of them throws, so a rejection here would be a
  // programming error worth surfacing rather than swallowing.
  const [t, h, n, p, j] = await Promise.all([
    searchTasks(q, limit),
    searchHabits(q, limit),
    searchNotes(q, limit),
    searchProjects(q, limit),
    searchJournalEntries(q, limit),
  ]);

  const failed: SearchSource[] = [];
  const take = <R,>(res: { ok: true; data: R[] } | { ok: false; error: string }, source: SearchSource): R[] => {
    if (!res.ok) { failed.push(source); return []; }
    return res.data.slice(0, limit);
  };

  return {
    tasks: take(t, 'tasks'),
    habits: take(h, 'habits'),
    notes: take(n, 'notes'),
    projects: take(p, 'projects'),
    journal: take(j, 'journal'),
    failed,
  };
}
