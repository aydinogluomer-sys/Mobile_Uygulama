/**
 * R06.06 — "Bölüm 8 ekran durumlarını uygun render/test ortamında doğrula."
 * docs/implementation-v3/R06_SCREEN_STATES.md holds the full matrix; this
 * file renders the states the earlier cards did not: first use, "could not
 * load" vs "nothing here", no search results, long content.
 */
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import * as fs from 'fs';
import * as path from 'path';

// Several full screens per test, each waiting out the search debounce: under
// the full parallel suite this exceeds jest's 5 s default.
jest.setTimeout(30_000);
jest.mock('@expo/vector-icons', () => ({ Ionicons: 'Ionicons' }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: ({ children }: any) => children }));
jest.mock('../../lib/supabase', () => ({ supabase: {} }));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1', email: null })) }));
const mockLists: any = { notes: [], goals: [], projects: [], error: null as string | null, loading: false, search: [] as any[] };
const mockRetry = jest.fn(async () => undefined);
jest.mock('../../store/noteStore', () => {
  const make = (): any => ({
    notes: mockLists.notes, loading: mockLists.loading, loadingMore: false, hasMore: false, error: mockLists.error,
    loadMore: jest.fn(), fetchNotes: mockRetry, addNote: jest.fn(), updateNote: jest.fn(), removeNote: jest.fn(),
    search: jest.fn(async () => mockLists.search), conflicts: () => [], resolveConflict: jest.fn(),
  });
  const useNoteStore: any = () => make();
  useNoteStore.getState = make;
  return { useNoteStore };
});
jest.mock('../../store/goalStore', () => {
  const make = (): any => ({
    goals: mockLists.goals, loading: mockLists.loading, loadingMore: false, hasMore: false, error: mockLists.error,
    loadGoals: mockRetry, loadMore: jest.fn(), addGoal: jest.fn(), updateProgress: jest.fn(), archiveGoal: jest.fn(), removeGoal: jest.fn(),
  });
  const useGoalStore: any = () => make();
  useGoalStore.getState = make;
  return { useGoalStore };
});
jest.mock('../../store/projectStore', () => {
  const make = (): any => ({
    projects: mockLists.projects, hasMore: false, loadingMore: false, error: mockLists.error,
    loadMore: jest.fn(), fetchProjects: mockRetry, addProject: jest.fn(), removeProject: jest.fn(),
  });
  const useProjectStore: any = () => make();
  useProjectStore.getState = make;
  return { useProjectStore };
});
jest.mock('../../store/taskStore', () => {
  const state = { tasks: [], fetchTasks: jest.fn(async () => undefined), toggleDone: jest.fn(), addTask: jest.fn() };
  const useTaskStore: any = (sel?: any) => (sel ? sel(state) : state);
  useTaskStore.getState = () => state;
  return { useTaskStore };
});

import NotesScreen from '../../app/screens/notes';
import GoalsScreen from '../../app/screens/goals';
import ProjectsScreen from '../../app/screens/projects';
import { listState } from '../../components/ui';

function textOf(r: TestRenderer.ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (n: any) => { if (n == null) return; if (typeof n === 'string') { out.push(n); return; } if (Array.isArray(n)) { n.forEach(walk); return; } walk(n.children); };
  walk(r.toJSON());
  return out.join(' ');
}
// Unmount after every test: the loading skeleton runs an Animated.loop, and a
// renderer left mounted keeps it (and jest) alive after the suite is done.
const mounted: TestRenderer.ReactTestRenderer[] = [];
afterEach(async () => { await act(async () => { while (mounted.length) mounted.pop()!.unmount(); }); });
async function render(el: React.ReactElement) {
  let r!: TestRenderer.ReactTestRenderer;
  await act(async () => { r = TestRenderer.create(el); });
  mounted.push(r);
  await act(async () => { await new Promise((x) => setTimeout(x, 450)); }); // past the search debounce
  return r;
}

beforeEach(() => { Object.assign(mockLists, { notes: [], goals: [], projects: [], error: null, loading: false, search: [] }); mockRetry.mockClear(); });

describe('the rule', () => {
  it('data > loading > error > no results > empty', () => {
    expect(listState({ loading: true, error: 'x', count: 2 })).toBe('data');
    expect(listState({ loading: true, error: 'x', count: 0 })).toBe('loading');
    expect(listState({ loading: false, error: 'x', count: 0, query: 'a' })).toBe('error');
    expect(listState({ loading: false, error: null, count: 0, query: 'a' })).toBe('no-results');
    expect(listState({ loading: false, error: null, count: 0, query: '  ' })).toBe('empty');
  });
});

describe('first use: what to do is clear, no fake history', () => {
  it('notes, goals and projects each say how to start', async () => {
    expect(textOf(await render(<NotesScreen />))).toMatch(/Henüz not yok/);
    expect(textOf(await render(<GoalsScreen />))).toMatch(/Henüz hedef yok/);
    expect(textOf(await render(<ProjectsScreen />))).toMatch(/Henüz proje yok/);
  });
});

describe('"could not load" is not "nothing here"', () => {
  for (const [name, el, what, emptyText] of [
    ['notes', <NotesScreen key="n" />, 'Notlar yüklenemedi', /Henüz not yok/],
    ['goals', <GoalsScreen key="g" />, 'Hedefler yüklenemedi', /Henüz hedef yok/],
    ['projects', <ProjectsScreen key="p" />, 'Projeler yüklenemedi', /Henüz proje yok/],
  ] as const) {
    it(`${name}: says it was not reached, nothing was deleted, and retries`, async () => {
      mockLists.error = 'Network request failed';
      const r = await render(el);
      const t = textOf(r);
      expect(t).toMatch(new RegExp(what));
      expect(t).toMatch(/kayıtların silinmedi/);
      expect(t).not.toMatch(emptyText);
      const retry = r.root.findAll((n) => n.props?.accessibilityLabel === 'Tekrar dene' && typeof n.props.onPress === 'function')[0];
      await act(async () => { retry.props.onPress(); });
      expect(mockRetry).toHaveBeenCalled();
    });
  }
});

describe('loading never shows an empty state', () => {
  it('notes and goals show their skeleton, not "nothing here"', async () => {
    mockLists.loading = true;
    expect(textOf(await render(<NotesScreen />))).not.toMatch(/Henüz not yok/);
    expect(textOf(await render(<GoalsScreen />))).not.toMatch(/Henüz hedef yok/);
  });
});

describe('long content keeps the actions reachable', () => {
  it('a very long note is clamped on its card and the add button stays', async () => {
    const long = 'Çok uzun bir not başlığı '.repeat(20);
    mockLists.notes = [{ id: 'n1', user_id: 'u1', title: long, content: long.repeat(5), tags: [], created_at: '', updated_at: '2026-10-08T10:00:00Z' }];
    const r = await render(<NotesScreen />);
    const clamped = r.root.findAll((n) => typeof n.type === 'string' && n.props?.numberOfLines && typeof n.props.children === 'string' && n.props.children.startsWith('Çok uzun'));
    expect(clamped.length).toBeGreaterThanOrEqual(2);
    expect(r.root.findAll((n) => typeof n.type === 'string' && n.props?.accessibilityLabel === 'Yeni not').length).toBe(1);
  });
});

it('the reading list uses the same error state (source guard; its store is tab-paged)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../app/screens/reading-list.tsx'), 'utf8');
  expect(src).toMatch(/filtered\.length === 0 && loadError \? \(\s*\/\/[^\n]*\n\s*<LoadErrorState what="Okuma listesi"/);
});
