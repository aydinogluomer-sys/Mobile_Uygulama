/**
 * R03.06 — how goal, project, task, habit and focus relate, and where each
 * progress number comes from.
 *
 * ONE DIRECTION. Records roll up, never down:
 *
 *     focus session ──► task ──► project
 *     habit log     ──► habit
 *     key result    ──► OKR
 *
 * A goal has NO incoming automatic edge: its percentage is what the user
 * typed (`goals.progress`). Nothing computed from records is ever written
 * into it, and it is never written into anything else -- so there is no
 * cycle and nothing is counted twice. (Linking goals to projects or habits
 * would need a link table on `goals`, whose definition is not in this repo
 * -- S12; that is an owner decision, not something to invent here.)
 *
 * MANUAL vs COMPUTED are separate values with separate labels:
 *   - project: computed from its tasks (done / counted), each task once;
 *   - key result: the user's current/target values (manual input, computed ratio);
 *   - goal: manual only.
 */
export type ProgressSource = 'computed' | 'manual';

export type RelationKind = 'focus_session' | 'task' | 'project' | 'habit_log' | 'habit' | 'key_result' | 'okr' | 'goal';

/** The only edges records may form (from -> to). */
export const RELATION_EDGES: readonly (readonly [RelationKind, RelationKind])[] = [
  ['focus_session', 'task'],
  ['task', 'project'],
  ['habit_log', 'habit'],
  ['key_result', 'okr'],
];

export function isAllowedEdge(from: RelationKind, to: RelationKind): boolean {
  return RELATION_EDGES.some(([a, b]) => a === from && b === to);
}

/** No path in the allowed graph leads back to where it started (and none enters a goal). */
export function relationGraphIsAcyclic(edges: readonly (readonly [RelationKind, RelationKind])[] = RELATION_EDGES): boolean {
  const next = new Map<RelationKind, RelationKind[]>();
  for (const [a, b] of edges) next.set(a, [...(next.get(a) ?? []), b]);
  const visiting = new Set<RelationKind>();
  const done = new Set<RelationKind>();
  const visit = (n: RelationKind): boolean => {
    if (visiting.has(n)) return false;
    if (done.has(n)) return true;
    visiting.add(n);
    for (const m of next.get(n) ?? []) if (!visit(m)) return false;
    visiting.delete(n);
    done.add(n);
    return true;
  };
  return [...next.keys()].every(visit);
}

export type ProjectProgress = { source: 'computed'; done: number; counted: number; pct: number | null; label: string };

/**
 * A project's progress from its own tasks. Cancelled tasks are not counted;
 * a task belongs to at most one project (`tasks.project_id`), so no task is
 * counted twice. `pct` is null when there is nothing to count.
 */
export function projectProgress(
  tasks: readonly { id: string; project_id?: string | null; completed: boolean; status?: string | null }[],
  projectId: string,
): ProjectProgress {
  const seen = new Set<string>();
  let done = 0;
  let counted = 0;
  for (const t of tasks) {
    if (t.project_id !== projectId || t.status === 'cancelled' || seen.has(t.id)) continue;
    seen.add(t.id);
    counted += 1;
    if (t.completed) done += 1;
  }
  const pct = counted === 0 ? null : Math.round((done / counted) * 100);
  return { source: 'computed', done, counted, pct, label: pct === null ? 'Henüz görev yok' : `Kayıtlardan %${pct} · ${done}/${counted} görev` };
}

export type GoalProgress = { source: 'manual'; pct: number; label: string };

/** A goal's progress is the user's own number, clamped to 0..100, and says so. */
export function goalProgress(goal: { progress: number }): GoalProgress {
  const pct = Math.max(0, Math.min(100, Math.round(goal.progress)));
  return { source: 'manual', pct, label: `Elle girilen %${pct}` };
}

/** A key result: the ratio of the user's own current/target values (0..100). */
export function keyResultProgress(kr: { current_value: number; target_value: number }): { source: 'manual'; pct: number | null } {
  if (!(kr.target_value > 0)) return { source: 'manual', pct: null };
  return { source: 'manual', pct: Math.max(0, Math.min(100, Math.round((kr.current_value / kr.target_value) * 100))) };
}
