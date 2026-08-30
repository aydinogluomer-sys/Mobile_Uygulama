/**
 * Cross-domain search — what the command palette runs.  (plan §8, §30)
 *
 * The palette needs one answer assembled from four domains. Doing that in the
 * component meant it reached into four repositories directly, and meant the
 * per-source limits and the failure policy were written inline next to the
 * rendering.
 *
 * The failure policy is the domain decision here: a source that errors
 * contributes NOTHING rather than failing the whole search. A palette that
 * shows no habits because the notes query timed out is worse than one that
 * shows the habits it found.
 */
import { searchHabits } from './habitService';
import { searchTasks } from './taskService';
import { searchNotes } from '../repositories/noteRepository';
import { searchProjects } from '../repositories/projectRepository';

export type SearchResults<T, N, P, H> = {
  tasks: T[];
  notes: N[];
  projects: P[];
  habits: H[];
};

const PER_SOURCE = 5;

export async function searchEverything(query: string, perSource = PER_SOURCE) {
  const q = query.trim();
  if (!q) return { tasks: [], notes: [], projects: [], habits: [] };

  const [t, n, p, h] = await Promise.all([
    searchTasks(q, perSource),
    searchNotes(q, perSource),
    searchProjects(q, perSource),
    searchHabits(q, perSource),
  ]);

  // One failed source degrades that source only.
  return {
    tasks: t.ok ? t.data.slice(0, perSource) : [],
    notes: n.ok ? n.data.slice(0, perSource) : [],
    projects: p.ok ? p.data.slice(0, perSource) : [],
    habits: h.ok ? h.data.slice(0, perSource) : [],
  };
}
