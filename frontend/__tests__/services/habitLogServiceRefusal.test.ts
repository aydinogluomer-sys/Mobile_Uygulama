/**
 * F03 — every failure branch of `persistCompletion` leaves through one door that turns the
 * refusals of migration 038 into calm Turkish copy, keeps `offline`, and leaves any other
 * error exactly as it came.
 *
 * The three branches that can fail: the update of a confirmed row, the insert, and the update
 * that recovers a 23505. The repository is mocked; nothing here reaches a database.
 */
const mockRepo = {
  insert: jest.fn(),
  update: jest.fn(),
  find: jest.fn(),
};

jest.mock('../../repositories/habitLogRepository', () => ({
  insertHabitLog: (...a: unknown[]) => mockRepo.insert(...a),
  updateHabitLog: (...a: unknown[]) => mockRepo.update(...a),
  findHabitLog: (...a: unknown[]) => mockRepo.find(...a),
  fetchLogsForDate: jest.fn(),
}));
jest.mock('../../services/webhookService', () => ({ notify: jest.fn() }));

import { persistCompletion, toPatch } from '../../services/habitLogService';
import { LOGGABLE_DAY_MESSAGE, LOG_KEY_IMMUTABLE_MESSAGE } from '../../lib/pgErrors';

const base = { habitId: 'h1', dateStr: '2026-08-04', patch: toPatch({ state: 'done' }) };

beforeEach(() => {
  mockRepo.insert.mockReset();
  mockRepo.update.mockReset();
  mockRepo.find.mockReset();
});

describe('persistCompletion translates the 038 refusals on every branch', () => {
  it('insert refused for the day window -> calm copy, offline kept', async () => {
    mockRepo.insert.mockResolvedValue({ ok: false, error: 'habit_log_day_out_of_range', code: '22023', offline: false });
    expect(await persistCompletion(base)).toEqual({ ok: false, error: LOGGABLE_DAY_MESSAGE, offline: false });
  });

  it('update of a confirmed row refused for a moved key -> the key copy', async () => {
    mockRepo.update.mockResolvedValue({ ok: false, error: 'habit_log_key_immutable', offline: false });
    expect(await persistCompletion({ ...base, confirmedId: 'r1' })).toEqual({ ok: false, error: LOG_KEY_IMMUTABLE_MESSAGE, offline: false });
    expect(mockRepo.insert).not.toHaveBeenCalled();
  });

  it('the update that recovers a 23505 is translated too', async () => {
    mockRepo.insert.mockResolvedValue({ ok: false, error: 'duplicate key', code: '23505', offline: false });
    mockRepo.find.mockResolvedValue({ ok: true, data: { id: 'r9' } });
    mockRepo.update.mockResolvedValue({ ok: false, error: 'ERROR: habit_log_day_out_of_range', offline: false });
    expect(await persistCompletion(base)).toEqual({ ok: false, error: LOGGABLE_DAY_MESSAGE, offline: false });
    expect(mockRepo.update).toHaveBeenCalledWith('r9', expect.any(Object));
  });

  it('keeps offline: true so the store still queues instead of rolling back', async () => {
    mockRepo.insert.mockResolvedValue({ ok: false, error: 'Network request failed', offline: true });
    expect(await persistCompletion(base)).toEqual({ ok: false, error: 'Network request failed', offline: true });
  });

  it('passes any other error through unchanged (nothing is swallowed or renamed)', async () => {
    mockRepo.insert.mockResolvedValue({ ok: false, error: 'permission denied for table habit_logs', code: '42501', offline: false });
    expect(await persistCompletion(base)).toEqual({ ok: false, error: 'permission denied for table habit_logs', offline: false });
  });

  it('a success is returned as it is', async () => {
    const log = { id: 'r1', habit_id: 'h1', user_id: 'u1', completed_at: '2026-08-04', state: 'done', xp: 10 };
    mockRepo.insert.mockResolvedValue({ ok: true, data: log });
    expect(await persistCompletion(base)).toEqual({ ok: true, log });
  });
});
