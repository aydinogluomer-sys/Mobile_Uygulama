/**
 * F19 (STO-11) — all five store create flows (goal, project, OKR objective,
 * OKR key result, reading item) mint their entity id BEFORE the first online
 * attempt and call `insert*WithId`, so an ambiguous transport error after a
 * server commit (lost response / status 0) queues the outbox create with the
 * SAME id and replays into a single server row via 23505 recovery.
 */
/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above imports */
jest.mock('expo-sqlite', () => require('../helpers/sqliteAdapter').createExpoSqliteModule());
jest.mock('../../lib/session', () => require('../helpers/fakeCoreServer').session);
jest.mock('../../repositories/goalRepository', () => require('../helpers/fakeCoreServer').goalRepo);
jest.mock('../../repositories/projectRepository', () => require('../helpers/fakeCoreServer').projectRepo);
jest.mock('../../repositories/okrRepository', () => require('../helpers/fakeCoreServer').okrRepo);
jest.mock('../../repositories/readingListRepository', () => require('../helpers/fakeCoreServer').readingRepo);
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn(), getSession: jest.fn() } } }));
/* eslint-enable @typescript-eslint/no-require-imports */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import {
  commitThenLoseResponse,
  goalRepo,
  okrRepo,
  projectRepo,
  readingRepo,
  server,
} from '../helpers/fakeCoreServer';
import { clearReadCacheMemory } from '../../lib/localReadCache';
import { coreOutbox } from '../../services/coreOutbox';
import { useGoalStore } from '../../store/goalStore';
import { useOKRStore } from '../../store/okrStore';
import { useProjectStore } from '../../store/projectStore';
import { useReadingListStore } from '../../store/readingListStore';

beforeEach(async () => {
  server.reset();
  coreOutbox.reset();
  clearReadCacheMemory();
  await AsyncStorage.clear();
  (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();
  jest.restoreAllMocks();

  useGoalStore.setState({ goals: [], loading: false, loadingMore: false, hasMore: false, error: null, cursor: null });
  useProjectStore.setState({ projects: [], loading: false, loadingMore: false, hasMore: false, error: null, cursor: null });
  useOKRStore.setState({ okrs: [], loading: false, error: null });
  useReadingListStore.setState({
    tabs: {
      want_to_read: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
      reading: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
      completed: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
    },
    counts: { want_to_read: 0, reading: 0, completed: 0 },
    error: null,
  });
});

describe('F19 (STO-11) — create flows keep the same operation/entity id across lost responses', () => {
  it('goalStore.addGoal: lost response reuses committed id, flushes via 23505 into 1 row, and online write leaves outbox empty', async () => {
    commitThenLoseResponse('goals', 1);
    expect(await useGoalStore.getState().addGoal({ kind: 'yearly', title: 'Tek Hedef', progress: 25, year: 2026 })).toBe(true);

    expect(server.goals.size).toBe(1);
    const committedId = [...server.goals.keys()][0];
    expect(useGoalStore.getState().goals).toHaveLength(1);
    expect(useGoalStore.getState().goals[0].id).toBe(committedId);

    await coreOutbox.flush();
    expect(server.goals.size).toBe(1);
    expect(coreOutbox.state()?.commands ?? []).toHaveLength(0);

    // Offline from the start -> 1 row once reconnected
    server.reset();
    useGoalStore.setState({ goals: [] });
    server.online = false;
    expect(await useGoalStore.getState().addGoal({ kind: 'monthly', title: 'Uçak Hedefi', year: 2026, month: 10 })).toBe(true);
    expect(server.goals.size).toBe(0);
    server.online = true;
    await coreOutbox.flush();
    expect(server.goals.size).toBe(1);

    // Healthy online -> single insertGoalWithId call, 0 outbox commands
    server.reset();
    useGoalStore.setState({ goals: [] });
    const spy = jest.spyOn(goalRepo, 'insertGoalWithId');
    expect(await useGoalStore.getState().addGoal({ kind: 'yearly', title: 'Çevrimiçi', year: 2026 })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(coreOutbox.state()?.commands ?? []).toHaveLength(0);
  });

  it('projectStore.addProject: lost response reuses committed id into 1 row, offline queues 1 row, online writes directly', async () => {
    commitThenLoseResponse('projects', 1);
    const created = await useProjectStore.getState().addProject({ name: 'Tek Proje', color: '#6366f1', description: 'v1' });
    expect(created).not.toBeNull();

    expect(server.projects.size).toBe(1);
    const committedId = [...server.projects.keys()][0];
    expect(created!.id).toBe(committedId);
    expect(useProjectStore.getState().projects.map((p) => p.id)).toEqual([committedId]);

    await coreOutbox.flush();
    expect(server.projects.size).toBe(1);
    expect(coreOutbox.state()?.commands ?? []).toHaveLength(0);

    // Offline -> online
    server.reset();
    useProjectStore.setState({ projects: [] });
    server.online = false;
    const offProj = await useProjectStore.getState().addProject({ name: 'Uçak Projesi', color: '#10b981' });
    expect(offProj).not.toBeNull();
    expect(server.projects.size).toBe(0);
    server.online = true;
    await coreOutbox.flush();
    expect(server.projects.size).toBe(1);
    expect([...server.projects.keys()]).toEqual([offProj!.id]);

    // Healthy online
    server.reset();
    useProjectStore.setState({ projects: [] });
    const spy = jest.spyOn(projectRepo, 'insertProjectWithId');
    expect(await useProjectStore.getState().addProject({ name: 'Çevrimiçi Proje', color: '#f59e0b' })).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(coreOutbox.state()?.commands ?? []).toHaveLength(0);
  });

  it('okrStore.addObjective & addKeyResult: lost responses produce 1 row each, and pending objective keeps dependsOn link', async () => {
    // 1. Objective lost response
    commitThenLoseResponse('okrs', 1);
    expect(await useOKRStore.getState().addObjective('Tek OKR', 2026, 4)).toBe(true);
    expect(server.okrs.size).toBe(1);
    const okrId = [...server.okrs.keys()][0];
    expect(useOKRStore.getState().okrs[0].id).toBe(okrId);

    await coreOutbox.flush();
    expect(server.okrs.size).toBe(1);
    expect(coreOutbox.state()?.commands ?? []).toHaveLength(0);

    // 2. Key Result lost response on existing objective
    commitThenLoseResponse('keyResults', 1);
    expect(await useOKRStore.getState().addKeyResult(okrId, 'Tek KR', 10, 'adet')).toBe(true);
    expect(server.keyResults.size).toBe(1);
    const krId = [...server.keyResults.keys()][0];
    expect(useOKRStore.getState().okrs[0].key_results[0].id).toBe(krId);

    await coreOutbox.flush();
    expect(server.keyResults.size).toBe(1);
    expect(coreOutbox.state()?.commands ?? []).toHaveLength(0);

    // 3. Offline objective + dependent key result -> dependsOn preserved
    server.reset();
    useOKRStore.setState({ okrs: [] });
    server.online = false;
    expect(await useOKRStore.getState().addObjective('Çevrimdışı OKR', 2026, 4)).toBe(true);
    const offOkrId = useOKRStore.getState().okrs[0].id;
    expect(await useOKRStore.getState().addKeyResult(offOkrId, 'Bağımlı KR', 5, null)).toBe(true);

    const cmds = coreOutbox.state()?.commands ?? [];
    expect(cmds).toHaveLength(2);
    const objCmd = cmds.find((c) => c.entity === 'okr_objective')!;
    const krCmd = cmds.find((c) => c.entity === 'key_result')!;
    expect(krCmd.dependsOn).toEqual([objCmd.operationId]);

    server.online = true;
    await coreOutbox.flush();
    expect(server.okrs.size).toBe(1);
    expect(server.keyResults.size).toBe(1);

    // 4. Healthy online calls
    server.reset();
    useOKRStore.setState({ okrs: [] });
    const objSpy = jest.spyOn(okrRepo, 'insertObjectiveWithId');
    const krSpy = jest.spyOn(okrRepo, 'insertKeyResultWithId');
    expect(await useOKRStore.getState().addObjective('Online OKR', 2026, 4)).toBe(true);
    const liveOkrId = useOKRStore.getState().okrs[0].id;
    expect(await useOKRStore.getState().addKeyResult(liveOkrId, 'Online KR', 3, 'puan')).toBe(true);
    expect(objSpy).toHaveBeenCalledTimes(1);
    expect(krSpy).toHaveBeenCalledTimes(1);
    expect(coreOutbox.state()?.commands ?? []).toHaveLength(0);
  });

  it('readingListStore.addItem: lost response reuses committed id into 1 row, offline queues 1 row, online writes directly', async () => {
    commitThenLoseResponse('readingItems', 1);
    expect(await useReadingListStore.getState().addItem({ title: 'Tek Kitap', author: 'Yazar', type: 'book' })).toBe(true);

    expect(server.readingItems.size).toBe(1);
    const committedId = [...server.readingItems.keys()][0];
    expect(useReadingListStore.getState().byStatus('want_to_read').map((i) => i.id)).toEqual([committedId]);

    await coreOutbox.flush();
    expect(server.readingItems.size).toBe(1);
    expect(coreOutbox.state()?.commands ?? []).toHaveLength(0);

    // Offline -> online
    server.reset();
    useReadingListStore.setState({
      tabs: {
        want_to_read: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
        reading: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
        completed: { items: [], cursor: null, hasMore: false, loading: false, loadingMore: false },
      },
      counts: { want_to_read: 0, reading: 0, completed: 0 },
    });
    server.online = false;
    expect(await useReadingListStore.getState().addItem({ title: 'Uçak Makalesi', type: 'article' })).toBe(true);
    expect(server.readingItems.size).toBe(0);
    server.online = true;
    await coreOutbox.flush();
    expect(server.readingItems.size).toBe(1);

    // Healthy online
    server.reset();
    const spy = jest.spyOn(readingRepo, 'insertReadingItemWithId');
    expect(await useReadingListStore.getState().addItem({ title: 'Çevrimiçi Kitap', type: 'book' })).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(coreOutbox.state()?.commands ?? []).toHaveLength(0);
  });
});
