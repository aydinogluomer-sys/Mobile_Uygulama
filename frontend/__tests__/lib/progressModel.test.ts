/**
 * R03.06 — "Hedef/proje/görev/alışkanlık/odak ilişkisini tek yönlü ve
 * açıklanabilir tut. Manuel hedef yüzdesi ile kayıttan hesaplanan ilerleme
 * ayrıdır; döngü ve çift puan yoktur."
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  RELATION_EDGES, isAllowedEdge, relationGraphIsAcyclic, projectProgress, goalProgress, keyResultProgress,
} from '../../lib/progressModel';

describe('one direction, no cycle', () => {
  it('records roll up only: session -> task -> project, log -> habit, KR -> OKR', () => {
    expect(isAllowedEdge('focus_session', 'task')).toBe(true);
    expect(isAllowedEdge('task', 'project')).toBe(true);
    expect(isAllowedEdge('project', 'task')).toBe(false);
    expect(isAllowedEdge('task', 'focus_session')).toBe(false);
  });
  it('nothing flows INTO a goal automatically', () => {
    expect(RELATION_EDGES.filter(([, to]) => to === 'goal')).toEqual([]);
  });
  it('the graph is acyclic; the detector catches a cycle when one is added', () => {
    expect(relationGraphIsAcyclic()).toBe(true);
    expect(relationGraphIsAcyclic([...RELATION_EDGES, ['project', 'focus_session']])).toBe(false);
  });
});

describe('computed: a project from its own tasks, each counted once', () => {
  const tasks = [
    { id: 'a', project_id: 'p', completed: true },
    { id: 'b', project_id: 'p', completed: false },
    { id: 'c', project_id: 'p', completed: true, status: 'cancelled' },
    { id: 'a', project_id: 'p', completed: true },         // the same task twice (a merged page) counts once
    { id: 'd', project_id: 'q', completed: true },          // another project's task
    { id: 'e', project_id: null, completed: true },
  ];
  it('done / counted, cancelled excluded, duplicates once', () => {
    expect(projectProgress(tasks, 'p')).toEqual({ source: 'computed', done: 1, counted: 2, pct: 50, label: 'Kayıtlardan %50 · 1/2 görev' });
  });
  it('no tasks: no number is invented', () => {
    expect(projectProgress(tasks, 'empty')).toMatchObject({ pct: null, label: 'Henüz görev yok' });
  });
});

describe('manual: a goal is the user\'s own number, and says so', () => {
  it('clamped and labelled manual', () => {
    expect(goalProgress({ progress: 40 })).toEqual({ source: 'manual', pct: 40, label: 'Elle girilen %40' });
    expect(goalProgress({ progress: 140 }).pct).toBe(100);
    expect(goalProgress({ progress: -3 }).pct).toBe(0);
  });
  it('a key result is the ratio of the user\'s own values', () => {
    expect(keyResultProgress({ current_value: 3, target_value: 4 })).toEqual({ source: 'manual', pct: 75 });
    expect(keyResultProgress({ current_value: 3, target_value: 0 }).pct).toBeNull();
  });
});

describe('no double scoring: only the goals screen writes a goal percentage', () => {
  it('the one write path is the user editing it', () => {
    const root = path.join(__dirname, '../..');
    const hits: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.join(root, d), { withFileTypes: true })) {
        const rel = `${d}/${e.name}`;
        if (e.isDirectory()) { walk(rel); continue; }
        if (!/\.tsx?$/.test(e.name)) continue;
        const src = fs.readFileSync(path.join(root, rel), 'utf8');
        if (/\bupdateProgress\(|\bupdateGoalProgress\(/.test(src)) hits.push(rel);
      }
    };
    for (const d of ['app', 'components', 'lib', 'services', 'store', 'hooks']) walk(d);
    expect(hits.sort()).toEqual(['app/screens/goals.tsx', 'store/goalStore.ts']);
  });
});
