/**
 * R01.06 — the zone is captured when the user TAPS, travels with the queued
 * intent, and reaches the database only when LOG_TIMEZONE_ENABLED is on.
 *
 * The repository is mocked so the exact insert payload is observable; the
 * gate is toggled through a mutable mock of lib/featureGates.
 */
jest.mock('../../lib/supabase', () => ({ supabase: { from: jest.fn(), auth: { getUser: jest.fn() } } }));
const mockGates = { LOG_TIMEZONE_ENABLED: false };
jest.mock('../../lib/featureGates', () => {
  // a live getter (not a spread, which would read it once at hoist time)
  const m = { ...jest.requireActual('../../lib/featureGates') };
  Object.defineProperty(m, 'LOG_TIMEZONE_ENABLED', { get: () => mockGates.LOG_TIMEZONE_ENABLED });
  return m;
});

const mockInserts: Record<string, unknown>[] = [];
const mockUpdates: Record<string, unknown>[] = [];
jest.mock('../../repositories/habitLogRepository', () => ({
  ...jest.requireActual('../../repositories/habitLogRepository'),
  insertHabitLog: jest.fn(async (p: { habitId: string; dateStr: string; patch: Record<string, unknown> }) => {
    mockInserts.push(p.patch);
    return { ok: true, data: { id: `r${mockInserts.length}`, habit_id: p.habitId, user_id: 'u1', completed_at: p.dateStr, created_at: '', ...p.patch } };
  }),
  updateHabitLog: jest.fn(async (id: string, patch: Record<string, unknown>) => {
    mockUpdates.push(patch);
    return { ok: true, data: { id, habit_id: 'h1', user_id: 'u1', completed_at: '2026-03-29', created_at: '', ...patch } };
  }),
}));
jest.mock('../../lib/session', () => ({ currentUser: jest.fn(async () => ({ id: 'u1' })) }));

import { persistCompletion, toPatch } from '../../services/habitLogService';
import { useLogStore } from '../../store/logStore';
import { emptyQueueState, enqueue, saveSyncQueue, loadSyncQueue } from '../../lib/syncQueue';

beforeEach(() => { mockInserts.length = 0; mockUpdates.length = 0; mockGates.LOG_TIMEZONE_ENABLED = false; });

describe('R01.06 — the wire', () => {
  it('gate OFF: the insert and the update carry NO tz (the column may not exist yet)', async () => {
    await persistCompletion({ habitId: 'h1', dateStr: '2026-03-29', patch: toPatch({ state: 'done', tz: 'Europe/Istanbul' }) });
    await persistCompletion({ habitId: 'h1', dateStr: '2026-03-29', patch: toPatch({ state: 'done', tz: 'Europe/Istanbul' }), confirmedId: 'r1' });
    expect(mockInserts).toHaveLength(1);
    expect('tz' in mockInserts[0]).toBe(false);
    expect('tz' in mockUpdates[0]).toBe(false);
  });

  it('gate ON: the tap-time zone is written on insert and update', async () => {
    mockGates.LOG_TIMEZONE_ENABLED = true;
    await persistCompletion({ habitId: 'h1', dateStr: '2026-03-29', patch: toPatch({ state: 'done', tz: 'Europe/Istanbul' }) });
    await persistCompletion({ habitId: 'h1', dateStr: '2026-03-29', patch: toPatch({ state: 'done', tz: 'Asia/Tokyo' }), confirmedId: 'r1' });
    expect(mockInserts[0].tz).toBe('Europe/Istanbul');
    expect(mockUpdates[0].tz).toBe('Asia/Tokyo');
  });
});

describe('R01.06 — capture at tap time', () => {
  it('the queue keeps the zone through persist + hydrate (the replay sees the tap-time zone)', async () => {
    const q = enqueue(emptyQueueState(), 'h1', '2026-03-29', { state: 'done', tz: 'Asia/Tokyo' });
    await saveSyncQueue(q.state, 'u1');
    const back = await loadSyncQueue('u1');
    expect(back.ops[0].intent.tz).toBe('Asia/Tokyo');
    expect(toPatch(back.ops[0].intent).tz).toBe('Asia/Tokyo');
  });

  it('a corrupt hydrated zone is never sent', () => {
    expect('tz' in toPatch({ state: 'done', tz: '' })).toBe(false);
    expect('tz' in toPatch({ state: 'done', tz: 'x'.repeat(65) })).toBe(false);
    expect('tz' in toPatch({ state: 'done', tz: 42 as unknown as string })).toBe(false);
  });

  it('a tap with the gate ON sends the zone of the moment of the tap', async () => {
    mockGates.LOG_TIMEZONE_ENABLED = true;
    await useLogStore.getState().logHabit({ habitId: 'h9', date: new Date(2026, 2, 29, 23, 30), state: 'done' });
    const last = mockInserts[mockInserts.length - 1];
    expect(last.tz).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(useLogStore.getState().logs.find((l) => l.habit_id === 'h9')!.completed_at).toBe('2026-03-29');
  });

  it('a queued op from an older build (no tz) replays without one', () => {
    expect('tz' in toPatch({ state: 'done' })).toBe(false);
  });
});
