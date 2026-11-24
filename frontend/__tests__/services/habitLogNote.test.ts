const mockNotify = jest.fn();
const mockInsert = jest.fn();
const mockUpdate = jest.fn();
const mockFind = jest.fn();
const mockUpdateNote = jest.fn();

jest.mock('../../services/webhookService', () => ({
  notify: (...args: unknown[]) => mockNotify(...args),
}));

jest.mock('../../repositories/habitLogRepository', () => ({
  fetchLogsForDate: jest.fn(),
  findHabitLog: (...args: unknown[]) => mockFind(...args),
  insertHabitLog: (...args: unknown[]) => mockInsert(...args),
  updateHabitLog: (...args: unknown[]) => mockUpdate(...args),
  updateLogNote: (...args: unknown[]) => mockUpdateNote(...args),
}));

import {
  persistCompletion,
  saveLogNote,
  toPatch,
} from '../../services/habitLogService';

beforeEach(() => {
  jest.clearAllMocks();
});

describe('services/habitLogService — habit notes (F31 PS-03)', () => {
  it('(+) toPatch normalizes non-empty note and maps null/blank note to notes: null', () => {
    const p1 = toPatch({ state: 'skip', note: '  yorgundum \n bugün  ' });
    expect(p1.notes).toBe('yorgundum bugün');

    const p2 = toPatch({ state: 'skip', note: null });
    expect(p2.notes).toBeNull();

    const p3 = toPatch({ state: 'partial', value: 2, targetValue: 4, note: '   ' });
    expect(p3.notes).toBeNull();
  });

  it('(-) toPatch omits notes key completely when intent.note is undefined (preserves existing note)', () => {
    const p = toPatch({ state: 'done' });
    expect('notes' in p).toBe(false);
  });

  it('(+) persistCompletion forwards notes across insert, confirmed update, and 23505 recovery; (-) announce webhook never includes notes', async () => {
    const serverRow = {
      id: 'log-1',
      habit_id: 'h1',
      user_id: 'u1',
      completed_at: '2026-08-19',
      value: null,
      is_completed: true,
      state: 'done' as const,
      xp: 10,
      created_at: '2026-08-19T10:00:00Z',
    };

    // 1) Insert branch
    mockInsert.mockResolvedValueOnce({ ok: true, data: serverRow });
    const patch = toPatch({ state: 'done', note: '  sabah bitti ' });
    const r1 = await persistCompletion({ habitId: 'h1', dateStr: '2026-08-19', patch });
    expect(r1.ok).toBe(true);
    expect(mockInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        habitId: 'h1',
        dateStr: '2026-08-19',
        patch: expect.objectContaining({ notes: 'sabah bitti' }),
      }),
    );
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const webhookPayload = mockNotify.mock.calls[0][1] as Record<string, unknown>;
    expect(webhookPayload).toEqual({
      habit_id: 'h1',
      date: '2026-08-19',
      state: 'done',
      value: null,
    });
    expect('notes' in webhookPayload).toBe(false);
    expect('note' in webhookPayload).toBe(false);

    // 2) Confirmed update branch
    mockUpdate.mockResolvedValueOnce({ ok: true, data: serverRow });
    const r2 = await persistCompletion({
      habitId: 'h1',
      dateStr: '2026-08-19',
      patch,
      confirmedId: 'log-1',
    });
    expect(r2.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith(
      'log-1',
      expect.objectContaining({ notes: 'sabah bitti' }),
    );

    // 3) 23505 recovery branch
    mockInsert.mockResolvedValueOnce({ ok: false, error: 'dup', code: '23505' });
    mockFind.mockResolvedValueOnce({ ok: true, data: { ...serverRow, state: 'partial' } });
    mockUpdate.mockResolvedValueOnce({ ok: true, data: serverRow });
    const r3 = await persistCompletion({ habitId: 'h1', dateStr: '2026-08-19', patch });
    expect(r3.ok).toBe(true);
    expect(mockUpdate).toHaveBeenLastCalledWith(
      'log-1',
      expect.objectContaining({ notes: 'sabah bitti' }),
    );
  });

  it('(+) saveLogNote sends ONLY normalized note and (-) NEVER sends xp, state, value, or calls insert', async () => {
    mockUpdateNote.mockResolvedValueOnce({
      ok: true,
      data: { id: 'log-1', notes: 'toplantı uzadı' },
    });

    const res = await saveLogNote({
      habitId: 'h1',
      dateStr: '2026-06-01',
      note: '  toplantı\nuzadı  ',
    });
    expect(res).toEqual({ ok: true, notes: 'toplantı uzadı' });
    expect(mockUpdateNote).toHaveBeenCalledTimes(1);
    const arg = mockUpdateNote.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toEqual({
      habitId: 'h1',
      dateStr: '2026-06-01',
      note: 'toplantı uzadı',
    });
    expect('xp' in arg).toBe(false);
    expect('state' in arg).toBe(false);
    expect('value' in arg).toBe(false);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('(-) saveLogNote surfaces no_row without inserting and preserves offline:true on transport failure', async () => {
    mockUpdateNote.mockResolvedValueOnce({
      ok: false,
      error: 'Bu gün için kayıt bulunamadı.',
      code: 'no_row',
    });
    const missing = await saveLogNote({
      habitId: 'h1',
      dateStr: '2026-08-01',
      note: 'test',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe('no_row');
    }
    expect(mockInsert).not.toHaveBeenCalled();

    mockUpdateNote.mockResolvedValueOnce({
      ok: false,
      error: 'Network request failed',
      offline: true,
    });
    const offline = await saveLogNote({
      habitId: 'h1',
      dateStr: '2026-08-01',
      note: 'test',
    });
    expect(offline.ok).toBe(false);
    if (!offline.ok) {
      expect(offline.offline).toBe(true);
    }
  });
});
