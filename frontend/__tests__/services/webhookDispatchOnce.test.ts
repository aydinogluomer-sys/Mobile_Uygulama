/**
 * F05 (DOM-21, SYN-26, REP-14) — a completion is announced once, delivered with a few patient retries,
 * never through a redirect, and without the user's free text.
 *
 *  - only a real transition INTO `done` announces (`done` -> `done` is not a new completion);
 *  - a replayed write that finds the day already `done` on the server announces nothing;
 *  - up to three attempts per target (1 s, then 4 s), only for a lost connection or a transient
 *    answer, within 15 s; a redirect is refused, not followed;
 *  - one `delivery_id` per event, the same on every attempt and target;
 *  - `task_completed` carries the id only.
 */
import { Platform } from 'react-native';

const mockRepo = { insert: jest.fn(), update: jest.fn(), find: jest.fn(), taskUpdate: jest.fn() };
const listed: { value: { ok: boolean; data?: unknown[]; error?: string } } = { value: { ok: true, data: [] } };

jest.mock('../../repositories/habitLogRepository', () => ({
  insertHabitLog: (...a: unknown[]) => mockRepo.insert(...a),
  updateHabitLog: (...a: unknown[]) => mockRepo.update(...a),
  findHabitLog: (...a: unknown[]) => mockRepo.find(...a),
  fetchLogsForDate: jest.fn(),
}));
jest.mock('../../repositories/taskRepository', () => ({
  updateTask: (...a: unknown[]) => mockRepo.taskUpdate(...a),
  insertSplitTasks: jest.fn(),
  deleteTask: jest.fn(),
  fetchTasksPage: jest.fn(),
  insertTask: jest.fn(),
  searchTasks: jest.fn(),
  insertTaskRow: jest.fn(),
  updateTaskVersioned: jest.fn(async () => ({ ok: true, data: { exists: true, row: { updated_at: 'v2' } } })),
  deleteTaskIfPresent: jest.fn(),
  fetchTaskRow: jest.fn(),
}));
jest.mock('../../repositories/webhookRepository', () => ({
  fetchWebhooks: jest.fn(async () => listed.value),
  insertWebhook: jest.fn(async () => ({ ok: true, data: {} })),
  deleteWebhook: jest.fn(async () => ({ ok: true, data: true })),
  setWebhookEnabled: jest.fn(async () => ({ ok: true, data: {} })),
}));
// `notify` is observed; `deliver` / `dispatch` / `payloadFor` stay the real ones.
jest.mock('../../services/webhookService', () => {
  const actual = jest.requireActual('../../services/webhookService');
  return { ...actual, notify: jest.fn() };
});

import * as webhook from '../../services/webhookService';
import { persistCompletion, toPatch } from '../../services/habitLogService';
import { setCompleted, deliverTaskCommand } from '../../services/taskService';
import type { OutboxCommand } from '../../lib/outbox';

const notify = webhook.notify as unknown as jest.Mock;
const { deliver, dispatch, payloadFor, resetWebhookCache } = webhook;

const base = { habitId: 'h1', dateStr: '2026-08-04', patch: toPatch({ state: 'done' }) };
const row = (state: string, id = 'r1') => ({ id, habit_id: 'h1', completed_at: '2026-08-04', state, value: null });

beforeEach(() => {
  jest.clearAllMocks();
  mockRepo.insert.mockReset();
  mockRepo.update.mockReset();
  mockRepo.find.mockReset();
  mockRepo.taskUpdate.mockReset();
  listed.value = { ok: true, data: [] };
  resetWebhookCache();
});

describe('DOM-21 — only a transition into done is announced', () => {
  it('miss -> done (update of a confirmed row) announces once, with the op id as the delivery id', async () => {
    mockRepo.update.mockResolvedValue({ ok: true, data: row('done') });
    await persistCompletion({ ...base, confirmedId: 'r1', priorState: 'miss', deliveryKey: 'op-7' });
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(
      'habit_completed',
      { habit_id: 'h1', date: '2026-08-04', state: 'done', value: null },
      { deliveryId: 'op-7' },
    );
  });

  it('done -> done (a measurable habit past its target, a repeated save) announces nothing', async () => {
    mockRepo.update.mockResolvedValue({ ok: true, data: row('done') });
    await persistCompletion({ ...base, confirmedId: 'r1', priorState: 'done', deliveryKey: 'op-8' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('a first row for the day (insert) announces, whatever the caller remembered', async () => {
    mockRepo.insert.mockResolvedValue({ ok: true, data: row('done') });
    await persistCompletion({ ...base, priorState: 'done', deliveryKey: 'op-9' });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it.each(['partial', 'skip', 'miss'])('a %s write announces nothing', async (state) => {
    mockRepo.insert.mockResolvedValue({ ok: true, data: row(state) });
    await persistCompletion({ ...base, patch: toPatch({ state: state as 'partial' }) });
    expect(notify).not.toHaveBeenCalled();
  });

  it('without a delivery key no options are passed (the old call shape)', async () => {
    mockRepo.insert.mockResolvedValue({ ok: true, data: row('done') });
    await persistCompletion(base);
    expect(notify).toHaveBeenCalledWith('habit_completed', expect.any(Object), undefined);
  });
});

describe('SYN-26 — a replayed write does not announce twice', () => {
  it('23505 recovery: the row found on the server is already done -> nothing', async () => {
    mockRepo.insert.mockResolvedValue({ ok: false, error: 'duplicate key', code: '23505', offline: false, status: 409 });
    mockRepo.find.mockResolvedValue({ ok: true, data: row('done', 'r9') });
    mockRepo.update.mockResolvedValue({ ok: true, data: row('done', 'r9') });
    const res = await persistCompletion({ ...base, priorState: null, deliveryKey: 'op-1' });
    expect(res.ok).toBe(true);
    expect(notify).not.toHaveBeenCalled();
  });

  it('23505 recovery: the row found was miss -> announced once', async () => {
    mockRepo.insert.mockResolvedValue({ ok: false, error: 'duplicate key', code: '23505', offline: false, status: 409 });
    mockRepo.find.mockResolvedValue({ ok: true, data: row('miss', 'r9') });
    mockRepo.update.mockResolvedValue({ ok: true, data: row('done', 'r9') });
    await persistCompletion({ ...base, priorState: null, deliveryKey: 'op-2' });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('an op that carries priorState done (replayed) announces nothing', async () => {
    mockRepo.update.mockResolvedValue({ ok: true, data: row('done') });
    await persistCompletion({ ...base, confirmedId: 'r1', priorState: 'done', deliveryKey: 'op-3' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('an op saved by an older build (no priorState) keeps the old behaviour: announced', async () => {
    mockRepo.update.mockResolvedValue({ ok: true, data: row('done') });
    await persistCompletion({ ...base, confirmedId: 'r1', deliveryKey: 'op-4' });
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('a transient server failure is marked retryable, a refusal is not', async () => {
    mockRepo.insert.mockResolvedValueOnce({ ok: false, error: 'unavailable', offline: false, status: 503 });
    expect(await persistCompletion(base)).toMatchObject({ ok: false, retryable: true });
    mockRepo.insert.mockResolvedValueOnce({ ok: false, error: 'denied', offline: false, status: 403 });
    const refused = await persistCompletion(base);
    expect(refused.ok).toBe(false);
    expect('retryable' in refused).toBe(false); // carried only when true: the old shape is kept
  });
});

// ---------------------------------------------------------------------------------------------

type Res = { ok: boolean; status: number; type?: string };
const hook = (url = 'https://ok.example/hook') => ({ url, headers: { Authorization: 'Bearer x' } });
const body = payloadFor('habit_completed', { habit_id: 'h1' }, new Date('2026-08-04T10:00:00Z'), 'dlv-1');

function scripted(...answers: (Res | Error)[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = jest.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = answers.length > 1 ? answers.shift()! : answers[0];
    if (next instanceof Error) throw next;
    return next;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
function sleeper() {
  const waits: number[] = [];
  return { waits, sleep: async (ms: number) => { waits.push(ms); } };
}

describe('REP-14 — a few patient retries, only where they can help', () => {
  it('503, 503, 200 -> delivered on the third attempt, after waiting 1 s then 4 s', async () => {
    const { fetchImpl, calls } = scripted({ ok: false, status: 503 }, { ok: false, status: 503 }, { ok: true, status: 200 });
    const s = sleeper();
    await expect(deliver(hook(), body, fetchImpl, { sleep: s.sleep })).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    expect(s.waits).toEqual([1_000, 4_000]);
  });

  it('503 three times -> failed after exactly three attempts', async () => {
    const { fetchImpl, calls } = scripted({ ok: false, status: 503 });
    const s = sleeper();
    await expect(deliver(hook(), body, fetchImpl, { sleep: s.sleep })).resolves.toEqual({ ok: false, error: 'HTTP 503' });
    expect(calls).toHaveLength(3);
    expect(s.waits).toEqual([1_000, 4_000]);
  });

  it('429 and a lost connection are retried', async () => {
    const a = scripted({ ok: false, status: 429 }, { ok: true, status: 200 });
    await expect(deliver(hook(), body, a.fetchImpl, { sleep: sleeper().sleep })).resolves.toEqual({ ok: true });
    expect(a.calls).toHaveLength(2);
    const b = scripted(new TypeError('Network request failed'), { ok: true, status: 200 });
    await expect(deliver(hook(), body, b.fetchImpl, { sleep: sleeper().sleep })).resolves.toEqual({ ok: true });
    expect(b.calls).toHaveLength(2);
  });

  it.each([400, 401, 403, 404])('%i is final: one attempt, no wait', async (status) => {
    const { fetchImpl, calls } = scripted({ ok: false, status });
    const s = sleeper();
    await expect(deliver(hook(), body, fetchImpl, { sleep: s.sleep })).resolves.toEqual({ ok: false, error: `HTTP ${status}` });
    expect(calls).toHaveLength(1);
    expect(s.waits).toEqual([]);
  });

  it.each([
    [{ ok: false, status: 302 }],
    [{ ok: false, status: 307 }],
    [{ ok: false, status: 0, type: 'opaqueredirect' }],
  ])('a redirect (%j) is refused and not retried', async (res) => {
    const { fetchImpl, calls } = scripted(res);
    await expect(deliver(hook(), body, fetchImpl, { sleep: sleeper().sleep })).resolves.toEqual({ ok: false, error: 'yönlendirme reddedildi' });
    expect(calls).toHaveLength(1);
  });

  it('every request is made with redirect: manual, its own timeout signal, and the configured headers', async () => {
    const { fetchImpl, calls } = scripted({ ok: false, status: 503 }, { ok: true, status: 200 });
    await deliver(hook(), body, fetchImpl, { sleep: sleeper().sleep });
    expect(calls).toHaveLength(2);
    for (const c of calls) {
      expect(c.init.redirect).toBe('manual');
      expect(c.init.signal).toBeDefined();
      expect((c.init.headers as Record<string, string>).Authorization).toBe('Bearer x');
    }
    expect(calls[0].init.signal).not.toBe(calls[1].init.signal); // one controller per attempt
  });

  it('a wait that would pass the 15 s budget is skipped: the attempt that follows it is not made', async () => {
    const { fetchImpl, calls } = scripted({ ok: false, status: 503 });
    let t = 0;
    const s = sleeper();
    // each attempt "takes" 6 s: 6 + 1 + 6 = 13 s; the next wait (4 s) would end at 17 s > 15 s
    const res = await deliver(hook(), body, ((...a: Parameters<typeof fetch>) => { t += 6_000; return fetchImpl(...a); }) as typeof fetch, {
      sleep: async (ms) => { t += ms; await s.sleep(ms); },
      now: () => t,
    });
    expect(res).toEqual({ ok: false, error: 'HTTP 503' });
    expect(calls).toHaveLength(2);
    expect(s.waits).toEqual([1_000]);
  });
});

describe('one delivery id per event', () => {
  const targets = [
    { id: 'a', user_id: 'u1', url: 'https://a.example/h', event_types: ['habit_completed'], headers: null, enabled: true },
    { id: 'b', user_id: 'u1', url: 'https://b.example/h', event_types: ['habit_completed'], headers: null, enabled: true },
  ];

  it('every attempt and every target carries the same delivery_id; the envelope is unchanged', async () => {
    listed.value = { ok: true, data: targets };
    const { fetchImpl, calls } = scripted({ ok: false, status: 503 }, { ok: true, status: 200 });
    const report = await dispatch('habit_completed', { habit_id: 'h1' }, { fetchImpl, sleep: sleeper().sleep, now: new Date('2026-08-04T10:00:00Z') });
    expect(report.attempted).toBe(2);
    const bodies = calls.map((c) => JSON.parse(c.init.body as string));
    expect(bodies.length).toBeGreaterThanOrEqual(3);
    const ids = new Set(bodies.map((b) => b.delivery_id));
    expect(ids.size).toBe(1);
    expect([...ids][0]).toEqual(expect.any(String));
    for (const b of bodies) {
      expect(b).toMatchObject({ event: 'habit_completed', timestamp: '2026-08-04T10:00:00.000Z', data: { habit_id: 'h1' } });
    }
  });

  it('two dispatches make two different ids; a given delivery id is used as is', async () => {
    listed.value = { ok: true, data: [targets[0]] };
    const { fetchImpl, calls } = scripted({ ok: true, status: 200 });
    await dispatch('habit_completed', { habit_id: 'h1' }, { fetchImpl });
    await dispatch('habit_completed', { habit_id: 'h1' }, { fetchImpl });
    await dispatch('habit_completed', { habit_id: 'h1' }, { fetchImpl, deliveryId: 'op-42' });
    const ids = calls.map((c) => JSON.parse(c.init.body as string).delivery_id);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[2]).toBe('op-42');
  });

  it('payloadFor without a delivery id keeps exactly the old envelope', () => {
    expect(Object.keys(payloadFor('habit_completed', {}, new Date(0)))).toEqual(['event', 'timestamp', 'data']);
  });
});

describe('the delivery header: native only', () => {
  const original = Platform.OS;
  afterEach(() => { Object.defineProperty(Platform, 'OS', { value: original, configurable: true }); });

  it('native sends X-Aderyth-Delivery', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'ios', configurable: true });
    const { fetchImpl, calls } = scripted({ ok: true, status: 200 });
    await deliver(hook(), body, fetchImpl);
    expect((calls[0].init.headers as Record<string, string>)['X-Aderyth-Delivery']).toBe('dlv-1');
  });

  it('the web does not (a custom header would widen the CORS preflight); the id is in the body', async () => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
    const { fetchImpl, calls } = scripted({ ok: true, status: 200 });
    await deliver(hook(), body, fetchImpl);
    expect(calls[0].init.headers).not.toHaveProperty('X-Aderyth-Delivery');
    expect(JSON.parse(calls[0].init.body as string).delivery_id).toBe('dlv-1');
  });
});

describe('REP-14 privacy — no free text leaves', () => {
  it('setCompleted announces { task_id } only', async () => {
    mockRepo.taskUpdate.mockResolvedValue({ ok: true, data: { id: 't1', title: 'Gizli başlık' } });
    await setCompleted('t1', true);
    expect(notify).toHaveBeenCalledWith('task_completed', { task_id: 't1' });
    expect(notify.mock.calls[0][1]).not.toHaveProperty('title');
  });

  it('the outbox delivery path announces { task_id } only', async () => {
    const cmd = {
      operationId: 'o', userId: 'u1', entity: 'task', entityId: 't2', kind: 'update',
      payload: { completed: true, title: 'Gizli başlık' }, baseVersion: 'v1', dependsOn: [], seq: 1, attempts: 0,
      status: 'pending', createdAt: 0, readyAt: 0,
    } as unknown as OutboxCommand;
    await deliverTaskCommand(cmd);
    expect(notify).toHaveBeenCalledWith('task_completed', { task_id: 't2' });
    expect(notify.mock.calls[0][1]).not.toHaveProperty('title');
  });

  it('habit_completed carries no name either (regression lock)', async () => {
    mockRepo.insert.mockResolvedValue({ ok: true, data: { ...row('done'), name: 'Su iç' } });
    await persistCompletion(base);
    expect(Object.keys(notify.mock.calls[0][1]).sort()).toEqual(['date', 'habit_id', 'state', 'value']);
  });
});

describe('surface', () => {
  it('toggleWebhook is gone from the service', () => {
    expect('toggleWebhook' in jest.requireActual('../../services/webhookService')).toBe(false);
  });

  it('notify never rejects, even when delivery throws', () => {
    const real = jest.requireActual('../../services/webhookService') as typeof webhook;
    expect(() => real.notify('habit_completed', { habit_id: 'h1' }, { deliveryId: 'x' })).not.toThrow();
    expect(real.notify('habit_completed', { habit_id: 'h1' })).toBeUndefined();
  });
});
