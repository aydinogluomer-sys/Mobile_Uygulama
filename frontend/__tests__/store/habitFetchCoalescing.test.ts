import { resetAccountMemory } from '../../lib/accountScope';
import type { Habit } from '../../lib/supabase';

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const mockListHabits = jest.fn();
const mockLoadTimeOff = jest.fn();
const mockLoadChecklists = jest.fn();
const mockCreateHabit = jest.fn();
const mockActivateHabit = jest.fn();
const mockPauseHabit = jest.fn();

jest.mock('../../services/habitService', () => ({
  listHabits: (...args: unknown[]) => mockListHabits(...args),
  loadTimeOff: (...args: unknown[]) => mockLoadTimeOff(...args),
  loadChecklists: (...args: unknown[]) => mockLoadChecklists(...args),
  createHabit: (...args: unknown[]) => mockCreateHabit(...args),
  activateHabit: (...args: unknown[]) => mockActivateHabit(...args),
  pauseHabit: (...args: unknown[]) => mockPauseHabit(...args),
  patchHabit: jest.fn(),
  archiveHabit: jest.fn(),
  restoreHabit: jest.fn(),
  purgeHabit: jest.fn(),
  addTimeOff: jest.fn(),
  endTimeOff: jest.fn(),
  recordGoalVersion: jest.fn(),
  addChecklistItem: jest.fn(),
  editChecklistItem: jest.fn(),
  setCheck: jest.fn(),
}));

jest.mock('../../lib/notifications', () => ({
  scheduleHabitReminder: jest.fn(),
  cancelHabitReminder: jest.fn(),
}));

import { HABITS_TTL_MS, invalidateHabitsFetch, useHabitStore } from '../../store/habitStore';
import { useWillpowerStore } from '../../store/willpowerStore';

function makeHabit(id: string, name = `Alışkanlık ${id}`, status: Habit['status'] = 'active'): Habit {
  return {
    id,
    user_id: 'u1',
    name,
    status,
    behavior_type: 'positive',
    tracking_type: 'boolean',
    frequency_config: { kind: 'daily' },
    willpower_cost: 2,
    difficulty: 2,
    estimated_minutes: 15,
    created_at: '2026-11-01T08:00:00Z',
  } as Habit;
}

describe('habitFetchCoalescing — PRF-09, STO-12, Gemini I2', () => {
  let now = 1_000_000;
  let nowSpy: jest.SpyInstance<number, []>;

  beforeEach(() => {
    jest.clearAllMocks();
    now = 1_000_000;
    nowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    resetAccountMemory('signed_out');
    invalidateHabitsFetch();
    mockLoadTimeOff.mockResolvedValue({ ok: true, data: { available: false, pauses: [], versions: [] } });
    mockLoadChecklists.mockResolvedValue({ ok: true, data: { available: false, items: [], checks: [] } });
    jest.spyOn(useWillpowerStore.getState(), 'fetchToday').mockResolvedValue(undefined);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('coalesces 20 concurrent fetchHabits() calls into 1 repository call and honours the 30s TTL', async () => {
    const gate = deferred<{ ok: true; data: Habit[] }>();
    mockListHabits.mockImplementationOnce(() => gate.promise);

    const calls = Array.from({ length: 20 }, () => useHabitStore.getState().fetchHabits());
    gate.resolve({ ok: true, data: [makeHabit('h1')] });
    await Promise.all(calls);

    expect(mockListHabits).toHaveBeenCalledTimes(1);
    expect(useHabitStore.getState().hasLoaded).toBe(true);
    expect(useHabitStore.getState().error).toBeNull();

    // Within 30s TTL -> no network call
    now += HABITS_TTL_MS - 1_000;
    await useHabitStore.getState().fetchHabits();
    expect(mockListHabits).toHaveBeenCalledTimes(1);

    // Past 30s TTL -> fetches again
    now += 2_000;
    mockListHabits.mockResolvedValueOnce({ ok: true, data: [makeHabit('h1'), makeHabit('h2')] });
    await useHabitStore.getState().fetchHabits();
    expect(mockListHabits).toHaveBeenCalledTimes(2);

    // { force: true } bypasses TTL immediately
    mockListHabits.mockResolvedValueOnce({ ok: true, data: [makeHabit('h1'), makeHabit('h2')] });
    await useHabitStore.getState().fetchHabits({ force: true });
    expect(mockListHabits).toHaveBeenCalledTimes(3);
  });

  it('invalidates TTL on addHabit and re-fetches once when addInstalledHabits mutates during an in-flight fetch', async () => {
    mockListHabits.mockResolvedValueOnce({ ok: true, data: [makeHabit('h1')] });
    await useHabitStore.getState().fetchHabits();
    expect(mockListHabits).toHaveBeenCalledTimes(1);

    // Successful addHabit invalidates TTL
    const created = makeHabit('h2', 'Yeni');
    mockCreateHabit.mockResolvedValueOnce({ ok: true, data: created });
    await useHabitStore.getState().addHabit(created);

    // Next fetchHabits within 30s must NOT skip; simulate addInstalledHabits racing mid-flight
    const firstAttempt = deferred<{ ok: true; data: Habit[] }>();
    mockListHabits
      .mockImplementationOnce(() => firstAttempt.promise)
      .mockResolvedValueOnce({
        ok: true,
        data: [makeHabit('h3', 'Paketten Kurulan'), makeHabit('h2', 'Yeni'), makeHabit('h1')],
      });

    const pFetch = useHabitStore.getState().fetchHabits();
    useHabitStore.getState().addInstalledHabits([makeHabit('h3', 'Paketten Kurulan')]);

    // First attempt carried stale pre-install snapshot; store must re-fetch once
    firstAttempt.resolve({ ok: true, data: [makeHabit('h1')] });
    await pFetch;

    expect(mockListHabits).toHaveBeenCalledTimes(3);
    const ids = useHabitStore.getState().habits.map((h) => h.id);
    expect(ids).toEqual(['h3', 'h2', 'h1']);
  });

  it('surfaces error on failed initial load (hasLoaded: false) and preserves existing list on subsequent failure', async () => {
    // Negative case: never loaded before -> habits [], hasLoaded false, error set
    mockListHabits.mockResolvedValueOnce({ ok: false, error: 'Ağ bağlantısı yok' });
    await useHabitStore.getState().fetchHabits();
    expect(useHabitStore.getState().hasLoaded).toBe(false);
    expect(useHabitStore.getState().habits).toEqual([]);
    expect(useHabitStore.getState().error).toBe('Ağ bağlantısı yok');

    // Recovery -> clears error, sets hasLoaded: true
    mockListHabits.mockResolvedValueOnce({ ok: true, data: [makeHabit('h1')] });
    await useHabitStore.getState().fetchHabits();
    expect(useHabitStore.getState().hasLoaded).toBe(true);
    expect(useHabitStore.getState().error).toBeNull();
    expect(useHabitStore.getState().habits).toHaveLength(1);

    // Subsequent failure -> keeps existing habits AND sets error
    mockListHabits.mockResolvedValueOnce({ ok: false, error: 'Zaman aşımı' });
    await useHabitStore.getState().fetchHabits({ force: true });
    expect(useHabitStore.getState().habits).toHaveLength(1);
    expect(useHabitStore.getState().error).toBe('Zaman aşımı');
  });

  it('drops an in-flight response across resetAccountMemory and fetches fresh for the next account', async () => {
    const staleGate = deferred<{ ok: true; data: Habit[] }>();
    mockListHabits.mockImplementationOnce(() => staleGate.promise);

    const pA = useHabitStore.getState().fetchHabits();
    resetAccountMemory('user_changed');

    staleGate.resolve({ ok: true, data: [makeHabit('h-user-A')] });
    await pA;
    expect(useHabitStore.getState().habits).toEqual([]);

    mockListHabits.mockResolvedValueOnce({ ok: true, data: [makeHabit('h-user-B')] });
    await useHabitStore.getState().fetchHabits();
    expect(useHabitStore.getState().habits.map((h) => h.id)).toEqual(['h-user-B']);
  });

  it('returns structured HabitActionResult from activateHabit and pauseHabit', async () => {
    const waiting = makeHabit('h-wait', 'Bekleyen', 'waiting');
    useHabitStore.setState({ habits: [waiting] });

    mockActivateHabit.mockResolvedValueOnce({
      ok: false,
      verdict: { allowed: false, reason: 'over_capacity' },
    });
    const denied = await useHabitStore.getState().activateHabit('h-wait', 2);
    expect(denied).toEqual({
      ok: false,
      reason: 'over_capacity',
      error: expect.stringContaining('beklemeye'),
    });

    mockActivateHabit.mockResolvedValueOnce({
      ok: true,
      habit: { ...waiting, status: 'active' },
    });
    const ok = await useHabitStore.getState().activateHabit('h-wait', 2);
    expect(ok).toEqual({ ok: true });
    expect(useHabitStore.getState().habits[0].status).toBe('active');

    mockPauseHabit.mockResolvedValueOnce({ ok: false, error: 'Beklemeye alınamadı' });
    expect(await useHabitStore.getState().pauseHabit('h-wait', 2)).toEqual({
      ok: false,
      error: 'Beklemeye alınamadı',
    });
  });
});
