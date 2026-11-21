import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SQLite from 'expo-sqlite';
import { resetAccountMemory } from '../../lib/accountScope';
import { clearReadCacheMemory } from '../../lib/localReadCache';
import { coreOutbox } from '../../services/coreOutbox';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const mockUpdateKR = jest.fn();
jest.mock('../../repositories/okrRepository', () => ({
  fetchOkrs: jest.fn(),
  insertObjective: jest.fn(),
  insertKeyResult: jest.fn(),
  updateKeyResultValue: (...args: unknown[]) => mockUpdateKR(...args),
  deleteObjective: jest.fn(),
  deleteKeyResult: jest.fn(),
}));

const mockUpdateGoalProgress = jest.fn();
jest.mock('../../repositories/goalRepository', () => ({
  fetchGoalsPage: jest.fn(),
  insertGoal: jest.fn(),
  updateGoalProgress: (...args: unknown[]) => mockUpdateGoalProgress(...args),
  archiveGoal: jest.fn(),
  deleteGoal: jest.fn(),
}));

const mockUpdateReadingRating = jest.fn();
jest.mock('../../repositories/readingListRepository', () => ({
  fetchReadingCounts: jest.fn(async () => ({ ok: true, data: { want_to_read: 0, reading: 0, completed: 0 } })),
  fetchReadingListPage: jest.fn(),
  insertReadingItem: jest.fn(),
  updateReadingStatus: jest.fn(),
  updateReadingRating: (...args: unknown[]) => mockUpdateReadingRating(...args),
  updateReadingNotes: jest.fn(),
  deleteReadingItem: jest.fn(),
}));

jest.mock('../../lib/session', () => ({
  currentUser: jest.fn(async () => ({ id: 'u1', email: 'u1@aderyth.app' })),
}));

import { useOKRStore } from '../../store/okrStore';
import { useGoalStore } from '../../store/goalStore';
import { useReadingListStore } from '../../store/readingListStore';

describe('serialisedPatches — STO-19 sequential entity PATCHes', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    resetAccountMemory('signed_out');
    coreOutbox.reset();
    clearReadCacheMemory();
    await AsyncStorage.clear();
    (SQLite as unknown as { __resetForTests: () => void }).__resetForTests();
  });

  it('serialises rapid updateKRValue taps on the same KR while keeping distinct KR IDs concurrent', async () => {
    useOKRStore.setState({
      okrs: [
        {
          id: 'obj-1',
          user_id: 'u1',
          objective: 'Hedef',
          year: 2026,
          quarter: 4,
          created_at: 'now',
          key_results: [
            { id: 'kr-1', okr_id: 'obj-1', user_id: 'u1', title: 'KR 1', current_value: 0, target_value: 10, unit: null, created_at: 'now' },
            { id: 'kr-2', okr_id: 'obj-1', user_id: 'u1', title: 'KR 2', current_value: 0, target_value: 10, unit: null, created_at: 'now' },
          ],
        },
      ],
    });

    const callOrder: string[] = [];
    const kr1First = deferred<{ ok: true; data: Record<string, unknown> }>();

    mockUpdateKR.mockImplementation((krId: string, val: number) => {
      callOrder.push(`${krId}:${val}`);
      if (krId === 'kr-1' && val === 1) return kr1First.promise;
      return Promise.resolve({
        ok: true,
        data: { id: krId, okr_id: 'obj-1', user_id: 'u1', title: krId, current_value: val, target_value: 10, unit: null, created_at: 'now' },
      });
    });

    const p1 = useOKRStore.getState().updateKRValue('kr-1', 1);
    const p2 = useOKRStore.getState().updateKRValue('kr-1', 2);
    // Negative case: different KR id must NOT wait for kr-1's slow request
    const pOther = useOKRStore.getState().updateKRValue('kr-2', 7);

    await pOther;
    expect(callOrder).toEqual(['kr-1:1', 'kr-2:7']);

    kr1First.resolve({
      ok: true,
      data: { id: 'kr-1', okr_id: 'obj-1', user_id: 'u1', title: 'KR 1', current_value: 1, target_value: 10, unit: null, created_at: 'now' },
    });
    await Promise.all([p1, p2]);

    expect(callOrder).toEqual(['kr-1:1', 'kr-2:7', 'kr-1:2']);
    const krs = useOKRStore.getState().okrs[0].key_results;
    expect(krs.find((k) => k.id === 'kr-1')?.current_value).toBe(2);
    expect(krs.find((k) => k.id === 'kr-2')?.current_value).toBe(7);
  });

  it('serialises goalStore.updateProgress and observes coreOutbox pending state when the first tap goes offline', async () => {
    useGoalStore.setState({
      goals: [
        {
          id: 'g-1',
          user_id: 'u1',
          kind: 'yearly',
          title: 'Yıllık',
          progress: 0,
          year: 2026,
          quarter: null,
          month: null,
          archived: false,
          created_at: 'now',
        },
      ],
    });

    const firstOffline = deferred<{ ok: false; error: string; offline: true }>();
    mockUpdateGoalProgress
      .mockImplementationOnce(() => firstOffline.promise)
      .mockResolvedValue({
        ok: true,
        data: {
          id: 'g-1',
          user_id: 'u1',
          kind: 'yearly',
          title: 'Yıllık',
          progress: 80,
          year: 2026,
          quarter: null,
          month: null,
          archived: false,
          created_at: 'now',
        },
      });

    const p1 = useGoalStore.getState().updateProgress('g-1', 30);
    const p2 = useGoalStore.getState().updateProgress('g-1', 80);

    // Second tap has NOT reached updateGoalProgress because it waits in serialByKey
    await new Promise((r) => setTimeout(r, 0));
    expect(mockUpdateGoalProgress).toHaveBeenCalledTimes(1);

    // First tap resolves offline -> queues into coreOutbox -> second tap sees hasPending and coalesces in outbox!
    firstOffline.resolve({ ok: false, error: 'offline', offline: true });
    await Promise.all([p1, p2]);

    expect(mockUpdateGoalProgress).toHaveBeenCalledTimes(1);
    expect(useGoalStore.getState().goals[0].progress).toBe(80);
  });

  it('serialises readingListStore.updateRating on the same reading item', async () => {
    const item = {
      id: 'ri-1',
      user_id: 'u1',
      title: 'Kitap',
      author: null,
      type: 'book' as const,
      status: 'reading' as const,
      url: null,
      notes: null,
      rating: null as number | null,
      created_at: 'now',
      updated_at: 'now',
    };
    useReadingListStore.setState((s) => ({
      tabs: { ...s.tabs, reading: { ...s.tabs.reading, items: [item], loaded: true } },
    }));

    const calls: number[] = [];
    const slow3 = deferred<{ ok: true; data: typeof item }>();
    mockUpdateReadingRating.mockImplementation((_id: string, rating: number) => {
      calls.push(rating);
      if (rating === 3) return slow3.promise;
      return Promise.resolve({ ok: true, data: { ...item, rating } });
    });

    const p1 = useReadingListStore.getState().updateRating('ri-1', 3);
    const p2 = useReadingListStore.getState().updateRating('ri-1', 5);

    await new Promise((r) => setTimeout(r, 0));
    expect(calls).toEqual([3]);

    slow3.resolve({ ok: true, data: { ...item, rating: 3 } });
    await Promise.all([p1, p2]);

    expect(calls).toEqual([3, 5]);
    expect(useReadingListStore.getState().tabs.reading.items[0].rating).toBe(5);
  });
});
