import { resetAccountMemory } from '../../lib/accountScope';

const mockListOpenTasks = jest.fn();
const mockAddTask = jest.fn();
const mockRemoveTask = jest.fn();
const mockCompleteTask = jest.fn();

jest.mock('../../services/focusService', () => ({
  listOpenTasks: (...args: unknown[]) => mockListOpenTasks(...args),
  addTask: (...args: unknown[]) => mockAddTask(...args),
  removeTask: (...args: unknown[]) => mockRemoveTask(...args),
  completeTask: (...args: unknown[]) => mockCompleteTask(...args),
  completeWorkPhase: jest.fn(),
}));

import { useFocusStore, type FocusTask } from '../../store/focusStore';

const makeFocusTask = (id: string, title: string): FocusTask => ({
  id,
  user_id: 'u1',
  title,
  completed: false,
  selected: false,
  estimated_pomodoros: 2,
  completed_pomodoros: 0,
  total_focus_seconds: 0,
  color: '#D97757',
  created_at: '2026-11-21T10:00:00Z',
});

describe('actionResults — focusStore FocusTaskResult (STO-12)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetAccountMemory('signed_out');
  });

  it('rejects empty title in addFocusTask and returns { ok: false, error } on service failures without mutating list', async () => {
    const emptyRes = await useFocusStore.getState().addFocusTask('   ');
    expect(emptyRes.ok).toBe(false);
    if (!emptyRes.ok) expect(emptyRes.error.length).toBeGreaterThan(0);

    mockListOpenTasks.mockResolvedValueOnce({ ok: false, error: 'Odak listesi okunamadı' });
    expect(await useFocusStore.getState().fetchFocusTasks()).toEqual({
      ok: false,
      error: 'Odak listesi okunamadı',
    });

    const existing = makeFocusTask('ft-1', 'Rapor yaz');
    useFocusStore.setState({ focusTasks: [existing], selectedTaskId: 'ft-1' });

    mockAddTask.mockResolvedValueOnce({ ok: false, error: 'Ekleme reddedildi' });
    expect(await useFocusStore.getState().addFocusTask('Yeni konu', 2)).toEqual({
      ok: false,
      error: 'Ekleme reddedildi',
    });
    expect(useFocusStore.getState().focusTasks).toEqual([existing]);

    mockCompleteTask.mockResolvedValueOnce({ ok: false, error: 'Tamamlama başarısız' });
    expect(await useFocusStore.getState().completeFocusTask('ft-1')).toEqual({
      ok: false,
      error: 'Tamamlama başarısız',
    });
    expect(useFocusStore.getState().focusTasks).toEqual([existing]);

    mockRemoveTask.mockResolvedValueOnce({ ok: false, error: 'Silme başarısız' });
    expect(await useFocusStore.getState().removeFocusTask('ft-1')).toEqual({
      ok: false,
      error: 'Silme başarısız',
    });
    expect(useFocusStore.getState().focusTasks).toEqual([existing]);
  });

  it('returns { ok: true } and updates focusTasks on success (negative case)', async () => {
    const t1 = makeFocusTask('ft-1', 'Derin odak');
    mockListOpenTasks.mockResolvedValueOnce({ ok: true, data: [t1] });
    expect(await useFocusStore.getState().fetchFocusTasks()).toEqual({ ok: true });
    expect(useFocusStore.getState().focusTasks).toEqual([t1]);

    const t2 = makeFocusTask('ft-2', 'İkinci odak');
    mockAddTask.mockResolvedValueOnce({ ok: true, data: t2 });
    expect(await useFocusStore.getState().addFocusTask('İkinci odak', 2)).toEqual({ ok: true });
    expect(useFocusStore.getState().focusTasks.map((t) => t.id)).toEqual(['ft-1', 'ft-2']);

    mockCompleteTask.mockResolvedValueOnce({ ok: true, data: true });
    expect(await useFocusStore.getState().completeFocusTask('ft-1')).toEqual({ ok: true });
    expect(useFocusStore.getState().focusTasks.map((t) => t.id)).toEqual(['ft-2']);

    mockRemoveTask.mockResolvedValueOnce({ ok: true, data: true });
    expect(await useFocusStore.getState().removeFocusTask('ft-2')).toEqual({ ok: true });
    expect(useFocusStore.getState().focusTasks).toEqual([]);
  });
});
