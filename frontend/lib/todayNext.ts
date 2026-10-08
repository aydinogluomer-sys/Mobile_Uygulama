/**
 * R03.01 — the ONE next actionable step for Today.
 *
 * Today shows several lists (habits, tasks, recovery, the "Sırada" strip);
 * this answers the single question "what do I do now?" in one place, so the
 * screen does not make the user rank them. The order, and why:
 *
 *   1. an open focus session      work already in progress -- finish it first
 *   2. a running routine          same: it is mid-way
 *   3. a make-up planned for today a promise the user made to themselves
 *   4. an overdue task            already late
 *   5. a habit due today, not done
 *   6. a task due today
 *
 * Pure: everything it needs is passed in; nothing is fetched or derived from
 * the clock here. Paused counts as open (it is waiting to be resumed).
 */
export type NextAction =
  | { kind: 'focus'; label: string; detail: string }
  | { kind: 'routine'; label: string; detail: string }
  | { kind: 'recovery'; id: string; label: string; detail: string }
  | { kind: 'task'; id: string; label: string; detail: string }
  | { kind: 'habit'; id: string; label: string; detail: string };

export type NextActionInput = {
  focus: { status: 'idle' | 'running' | 'paused'; title?: string | null };
  routine: { status: 'running' | 'paused' | 'finished'; templateName: string; done: number; total: number } | null;
  recoveryToday: { id: string; habitName: string }[];
  overdueTasks: { id: string; title: string }[];
  habitsToDo: { id: string; name: string }[];
  tasksToday: { id: string; title: string }[];
};

export function nextActionable(i: NextActionInput): NextAction | null {
  if (i.focus.status !== 'idle') {
    return {
      kind: 'focus',
      label: i.focus.title ? `Odak: ${i.focus.title}` : 'Odak oturumu',
      detail: i.focus.status === 'paused' ? 'Duraklatıldı — kaldığın yerden devam et' : 'Sürüyor — devam et',
    };
  }
  if (i.routine && i.routine.status !== 'finished') {
    return {
      kind: 'routine',
      label: i.routine.templateName,
      detail: `${i.routine.done}/${i.routine.total} adım — ${i.routine.status === 'paused' ? 'duraklatıldı, devam et' : 'devam et'}`,
    };
  }
  const r = i.recoveryToday[0];
  if (r) return { kind: 'recovery', id: r.id, label: r.habitName, detail: 'Bugün için planladığın telafi' };
  const o = i.overdueTasks[0];
  if (o) return { kind: 'task', id: o.id, label: o.title, detail: 'Gecikmiş görev' };
  const h = i.habitsToDo[0];
  if (h) return { kind: 'habit', id: h.id, label: h.name, detail: 'Bugünün alışkanlığı' };
  const t = i.tasksToday[0];
  if (t) return { kind: 'task', id: t.id, label: t.title, detail: 'Bugünün görevi' };
  return null;
}
