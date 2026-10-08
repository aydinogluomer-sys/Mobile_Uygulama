/**
 * R03.06 — on screen, a project's percentage says it comes from its tasks and
 * a goal's says it is typed by hand: the two are never shown as one number.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../store/projectStore', () => {
  const state = { projects: [{ id: 'p', user_id: 'u1', name: 'Tez', color: null, description: null, status: 'active', created_at: '' }], hasMore: false, loadingMore: false, loadMore: jest.fn(), fetchProjects: jest.fn(async () => undefined), addProject: jest.fn(), removeProject: jest.fn() };
  const useProjectStore: any = (sel?: any) => (sel ? sel(state) : state);
  useProjectStore.getState = () => state;
  return { useProjectStore };
});
jest.mock('../../store/taskStore', () => {
  const state = {
    tasks: [
      { id: 't1', project_id: 'p', completed: true, status: 'done' },
      { id: 't2', project_id: 'p', completed: false, status: 'pending' },
      { id: 't3', project_id: 'p', completed: false, status: 'pending' },
      { id: 't4', project_id: 'p', completed: false, status: 'cancelled' },
    ],
    fetchTasks: jest.fn(async () => undefined), toggleDone: jest.fn(), addTask: jest.fn(),
  };
  const useTaskStore: any = (sel?: any) => (sel ? sel(state) : state);
  useTaskStore.getState = () => state;
  return { useTaskStore };
});
jest.mock('../../store/goalStore', () => {
  const g = (kind: string) => ({ id: `g-${kind}`, user_id: 'u1', kind, title: 'Maraton', progress: 40, year: 2026, quarter: 4, month: 10, archived: false, created_at: '' });
  const state = { goals: [g('yearly'), g('quarterly'), g('monthly')], loading: false, loadingMore: false, hasMore: false, error: null, loadGoals: jest.fn(async () => undefined), loadMore: jest.fn(), addGoal: jest.fn(), updateProgress: jest.fn(), archiveGoal: jest.fn(), removeGoal: jest.fn() };
  const useGoalStore: any = (sel?: any) => (sel ? sel(state) : state);
  useGoalStore.getState = () => state;
  return { useGoalStore };
});

import ProjectsScreen from '../../app/screens/projects';
import GoalsScreen from '../../app/screens/goals';

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); };
  walk(r.toJSON());
  return out.join(' ');
}

it('a project shows progress computed from its tasks (cancelled not counted)', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<ProjectsScreen />); });
  expect(textOf(r)).toMatch(/Kayıtlardan %33 · 1\/3 görev/);
});

it('a goal shows its percentage as typed by hand, and the hint says it is not computed', async () => {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(<GoalsScreen />); });
  expect(textOf(r)).toMatch(/Elle girilen %40/);
  const card = r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Maraton, Elle girilen %40')[0];
  expect(card.props.accessibilityHint).toMatch(/kayıtlarından hesaplanmaz/);
});
