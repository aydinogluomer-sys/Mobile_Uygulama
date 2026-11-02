/**
 * F05 (SYN-03, REP-13, SYN-16) — failures are sorted into the right class, a transient server failure
 * costs no attempt, and every change that will not go by itself has a way out.
 *
 *  offline    the request never reached the server            -> waits, costs nothing
 *  auth       the session must be refreshed                   -> pauses, costs nothing
 *  retryable  the server answered "not now" (408/425/429/5xx) -> backs off, costs nothing,
 *                                                                 dead only after 72 h
 *  rejected   the server refused it on its merits             -> costs an attempt
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

const mockAuth: { session: unknown; error: unknown } = { session: null, error: null };

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: mockAuth.session }, error: mockAuth.error }),
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    from: () => {
      throw new Error('no table access in this test');
    },
  },
}));

import { classifyFailure } from '../../services/outboxRunner';
import { currentUserId, isTransientStatus, isTransportFailure } from '../../repositories/shared';
import * as outbox from '../../lib/outbox';
import * as syncQueue from '../../lib/syncQueue';
import { useLogStore } from '../../store/logStore';
import { useTaskStore } from '../../store/taskStore';
import { useHabitStore } from '../../store/habitStore';
import { coreOutbox } from '../../services/coreOutbox';
import {
  describeFlushOutcome,
  discardOutboxIssue,
  listOutboxIssues,
  retryOutboxIssue,
  type OutboxIssue,
  type UnifiedOutboxSummary,
} from '../../services/unifiedOutbox';

const ROOT = join(__dirname, '..', '..');

describe('classifyFailure — the matrix', () => {
  it.each([
    [{ error: 'TypeError: Network request failed', offline: true, status: 0 }, 'offline'],
    [{ error: 'unauthorized', status: 401 }, 'auth'],
    [{ error: 'Oturum bulunamadı.' }, 'auth'],
    [{ error: 'JWT expired', status: 400 }, 'auth'],
    [{ error: 'x', code: 'PGRST301' }, 'auth'],
    [{ error: 'timeout', status: 408 }, 'retryable'],
    [{ error: 'too early', status: 425 }, 'retryable'],
    [{ error: 'slow down', status: 429 }, 'retryable'],
    [{ error: 'boom', status: 500 }, 'retryable'],
    [{ error: 'bad gateway', status: 502 }, 'retryable'],
    [{ error: 'unavailable', status: 503 }, 'retryable'],
    [{ error: 'gateway timeout', status: 504 }, 'retryable'],
    [{ error: 'bad', status: 400 }, 'rejected'],
    [{ error: 'forbidden', status: 403 }, 'rejected'],
    [{ error: 'missing', status: 404 }, 'rejected'],
    [{ error: 'duplicate key value', status: 409, code: '23505' }, 'rejected'],
    [{ error: 'invalid', status: 422 }, 'rejected'],
    [{ error: 'something odd' }, 'rejected'], // no status: the cautious reading
  ])('%j -> %s', (err, kind) => {
    expect(classifyFailure(err).kind).toBe(kind);
  });

  it('a retryable outcome keeps the error text for the UI', () => {
    expect(classifyFailure({ error: 'unavailable', status: 503 })).toEqual({ kind: 'retryable', error: 'unavailable' });
  });
});

describe('isTransportFailure / isTransientStatus', () => {
  it('recognises a request that never completed', () => {
    expect(isTransportFailure(null, new TypeError('Network request failed'))).toBe(true);
    expect(isTransportFailure(0)).toBe(true);
    expect(isTransportFailure(null, { name: 'AbortError' })).toBe(true);
    expect(isTransportFailure(null, { name: 'AuthRetryableFetchError', message: 'x' })).toBe(true);
    expect(isTransportFailure(undefined, { message: 'Failed to fetch' })).toBe(true);
  });

  it('a real HTTP status, a server-side timeout, or nothing at all is NOT a transport failure', () => {
    expect(isTransportFailure(500, new TypeError('x'))).toBe(false);
    expect(isTransportFailure(null, { message: 'canceling statement due to statement timeout' })).toBe(false);
    expect(isTransportFailure(null, { message: 'permission denied' })).toBe(false);
    expect(isTransportFailure(null)).toBe(false);
    expect(isTransportFailure(undefined, 'Network request failed')).toBe(false); // a bare string is not an error object
  });

  it('transient statuses are 408, 425, 429 and 5xx only', () => {
    for (const s of [408, 425, 429, 500, 503, 599]) expect(isTransientStatus(s)).toBe(true);
    for (const s of [0, 200, 301, 400, 401, 403, 404, 409, 422, 600, null, undefined]) expect(isTransientStatus(s)).toBe(false);
  });
});

describe('the core/task outbox: retryable costs nothing, rejected still dies at MAX_ATTEMPTS', () => {
  const U = 'user-a';
  const T0 = 1_000_000;
  function one(): outbox.OutboxState {
    const r = outbox.enqueue(outbox.emptyOutbox(U), { operationId: 'o1', entity: 'task', entityId: 't1', kind: 'update', payload: { title: 'x' } }, U, T0);
    if (!r.ok) throw new Error(r.reason);
    return r.state;
  }

  it('ten transient failures in a row: still pending, no attempt spent, each wait later and longer', () => {
    let s = one();
    let now = T0;
    const waits: number[] = [];
    for (let i = 0; i < 10; i++) {
      s = outbox.settle(s, 'o1', { kind: 'retryable', error: 'HTTP 503' }, now);
      waits.push(s.commands[0].readyAt - now);
      now = s.commands[0].readyAt;
    }
    expect(s.commands[0]).toMatchObject({ status: 'pending', attempts: 0, retryableCount: 10, lastError: 'HTTP 503' });
    for (let i = 1; i < waits.length; i++) expect(waits[i]).toBeGreaterThanOrEqual(waits[i - 1]);
    expect(waits[0]).toBe(5_000);
    expect(Math.max(...waits)).toBe(15 * 60_000);
  });

  it('a Retry-After from the server wins over the computed backoff', () => {
    const s = outbox.settle(one(), 'o1', { kind: 'retryable', retryAfterMs: 42_000 }, T0);
    expect(s.commands[0].readyAt).toBe(T0 + 42_000);
  });

  it('becomes dead once transient failures have lasted RETRYABLE_GIVE_UP_MS', () => {
    let s = outbox.settle(one(), 'o1', { kind: 'retryable', error: 'HTTP 503' }, T0);
    s = outbox.settle(s, 'o1', { kind: 'retryable', error: 'HTTP 503' }, T0 + outbox.RETRYABLE_GIVE_UP_MS - 1);
    expect(s.commands[0].status).toBe('pending');
    s = outbox.settle(s, 'o1', { kind: 'retryable', error: 'HTTP 503' }, T0 + outbox.RETRYABLE_GIVE_UP_MS);
    expect(s.commands[0]).toMatchObject({ status: 'dead', attempts: 0, lastError: 'HTTP 503' });
  });

  it('six refusals (422) still make it dead (MAX_ATTEMPTS unchanged)', () => {
    let s = one();
    for (let i = 0; i < outbox.MAX_ATTEMPTS; i++) s = outbox.settle(s, 'o1', { kind: 'rejected', error: 'HTTP 422' }, T0 + i * 3_600_000);
    expect(outbox.MAX_ATTEMPTS).toBe(6);
    expect(s.commands[0]).toMatchObject({ status: 'dead', attempts: 6 });
  });

  it('retry() gives a dead command a clean slate, transient counters included', () => {
    let s = outbox.settle(one(), 'o1', { kind: 'retryable' }, T0);
    s = outbox.settle(s, 'o1', { kind: 'retryable' }, T0 + outbox.RETRYABLE_GIVE_UP_MS);
    expect(s.commands[0].status).toBe('dead');
    s = outbox.retry(s, 'o1');
    expect(s.commands[0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(s.commands[0].retryableCount ?? 0).toBe(0);
    expect(s.commands[0].firstRetryableAt).toBeUndefined();
  });

  it('nextReadyAt: the soonest deferred pending command; null when nothing is deferred or the outbox is paused', () => {
    let s = one();
    expect(outbox.nextReadyAt(s)).toBeNull(); // ready now: not "deferred"
    s = outbox.settle(s, 'o1', { kind: 'retryable' }, T0);
    expect(outbox.nextReadyAt(s)).toBe(T0 + 5_000);
    expect(outbox.nextReadyAt({ ...s, authBlocked: true })).toBeNull();
    expect(outbox.nextReadyAt(outbox.markSending(s, 'o1'))).toBeNull();
  });
});

describe('the habit-log queue: same classes', () => {
  const T0 = 2_000_000;
  function one() {
    return syncQueue.enqueue(syncQueue.emptyQueueState(), 'h1', '2026-08-04', { state: 'done', baseXp: 30 }, { id: 'op1', now: T0, userId: 'A' }).state;
  }

  it('twelve transient failures: still pending, attempts 0, backing off', () => {
    let s = one();
    let now = T0;
    for (let i = 0; i < 12; i++) {
      s = syncQueue.markFailed(s, 'op1', 'retryable', { error: 'HTTP 503', now });
      now = s.ops[0].readyAt!;
    }
    expect(s.ops[0]).toMatchObject({ status: 'pending', attempts: 0, retryableCount: 12, lastError: 'HTTP 503' });
    expect(syncQueue.nextReadyAt(s, now - 1)).toBe(now);
  });

  it('five refusals make it dead (MAX_ATTEMPTS unchanged)', () => {
    let s = one();
    for (let i = 0; i < syncQueue.MAX_ATTEMPTS; i++) s = syncQueue.markFailed(s, 'op1', 'rejected', { error: 'x', now: T0 + i });
    expect(syncQueue.MAX_ATTEMPTS).toBe(5);
    expect(s.ops[0].status).toBe('dead');
  });

  it('transient failures give up after 72 hours', () => {
    let s = syncQueue.markFailed(one(), 'op1', 'retryable', { now: T0 });
    s = syncQueue.markFailed(s, 'op1', 'retryable', { now: T0 + syncQueue.RETRYABLE_GIVE_UP_MS });
    expect(s.ops[0]).toMatchObject({ status: 'dead', attempts: 0 });
  });

  it('a lost connection still costs nothing and sets no backoff', () => {
    const s = syncQueue.markFailed(one(), 'op1', 'network', { now: T0 });
    expect(s.ops[0]).toMatchObject({ status: 'pending', attempts: 0 });
    expect(s.ops[0].readyAt).toBeUndefined();
  });
});

describe('the two definitions cannot drift', () => {
  it('RETRYABLE_GIVE_UP_MS and retryableDelayMs(1..8) are equal in lib/outbox and lib/syncQueue', () => {
    expect(outbox.RETRYABLE_GIVE_UP_MS).toBe(72 * 3600_000);
    expect(syncQueue.RETRYABLE_GIVE_UP_MS).toBe(outbox.RETRYABLE_GIVE_UP_MS);
    for (let n = 1; n <= 8; n++) expect(syncQueue.retryableDelayMs(n)).toBe(outbox.retryableDelayMs(n));
    expect(outbox.retryableDelayMs(1)).toBe(5_000);
    expect(outbox.retryableDelayMs(2)).toBe(10_000);
    expect(outbox.retryableDelayMs(20)).toBe(15 * 60_000);
  });
});

describe('currentUserId — a refresh that never reached the auth server is offline, not "signed out"', () => {
  afterEach(() => { mockAuth.session = null; mockAuth.error = null; });

  it('AuthRetryableFetchError -> { ok: false, offline: true }', async () => {
    mockAuth.error = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 };
    const r = await currentUserId();
    expect(r).toMatchObject({ ok: false, offline: true });
  });

  it('no session and no error -> the plain "not found" failure, without an offline flag', async () => {
    const r = await currentUserId();
    expect(r).toEqual({ ok: false, error: 'Oturum bulunamadı.' });
    expect('offline' in r).toBe(false);
  });

  it('a session -> its user id', async () => {
    mockAuth.session = { user: { id: 'u9' }, access_token: 't' };
    await expect(currentUserId()).resolves.toMatchObject({ ok: true, userId: 'u9' });
  });
});

describe('repository gate (REP-13): one call shape everywhere', () => {
  function tsFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
    });
  }
  const sources = ['repositories', 'services', 'store'].flatMap((d) => tsFiles(join(ROOT, d)))
    .map((p) => ({ p, text: stripComments(readFileSync(p, 'utf8')) }));

  it('no single-argument isTransportFailure(status) call is left', () => {
    const offenders = sources.filter((f) => /isTransportFailure\(\s*\w+\s*\)/.test(f.text)).map((f) => f.p);
    expect(offenders).toEqual([]);
  });

  it('scanner health: at least 40 two-argument call sites are found in the repositories', () => {
    const repoCalls = sources
      .filter((f) => f.p.includes(`${join('', 'repositories')}`))
      .reduce((n, f) => n + (f.text.match(/isTransportFailure\([^,()]+(?:\.\w+)?,\s*[^)]+\)/g) ?? []).length, 0);
    expect(repoCalls).toBeGreaterThanOrEqual(40);
  });

  it('scanner sanity: a single-argument call would be caught', () => {
    expect(/isTransportFailure\(\s*\w+\s*\)/.test('offline: isTransportFailure(status),')).toBe(true);
    expect(/isTransportFailure\(\s*\w+\s*\)/.test('offline: isTransportFailure(status, error),')).toBe(false);
  });
});

describe('a way out for every stuck change (service level)', () => {
  const T0 = 3_000_000;
  const reviveSyncOp = jest.fn(async () => undefined);
  const dropSyncOp = jest.fn(async () => undefined);
  const retryChange = jest.fn(async () => undefined);
  const discardChange = jest.fn(async () => undefined);
  let coreRetry: jest.SpyInstance;
  let coreDiscard: jest.SpyInstance;
  let coreState: jest.SpyInstance;

  const deadHabitOp: syncQueue.SyncOp = {
    ...syncQueue.enqueue(syncQueue.emptyQueueState(), 'h1', '2026-08-04', { state: 'done', baseXp: 30 }, { id: 'hop', now: T0, userId: 'A' }).op,
    status: 'dead',
    lastError: 'RLS denied',
  };
  const cmd = (over: Partial<outbox.OutboxCommand>): outbox.OutboxCommand => ({
    operationId: 'x', userId: 'A', entity: 'task', entityId: 't1', kind: 'update', payload: {}, baseVersion: null,
    dependsOn: [], seq: 1, attempts: 6, status: 'dead', createdAt: T0, readyAt: 0, ...over,
  } as outbox.OutboxCommand);

  beforeEach(() => {
    jest.clearAllMocks();
    useHabitStore.setState({ habits: [{ id: 'h1', name: 'Su iç' } as never] });
    useLogStore.setState({ deadSyncOps: () => [deadHabitOp], reviveSyncOp, dropSyncOp });
    useTaskStore.setState({
      tasks: [{ id: 't1', title: 'Rapor' } as never],
      outbox: { userId: 'A', commands: [cmd({ operationId: 'tdead' }), cmd({ operationId: 'tok', status: 'pending', attempts: 0 })], nextSeq: 3, tombstones: {}, authBlocked: false },
      retryChange,
      discardChange,
    });
    coreState = jest.spyOn(coreOutbox, 'state').mockReturnValue({
      userId: 'A',
      commands: [
        cmd({ operationId: 'cdead', entity: 'journal_entry', entityId: 'j1', lastError: 'HTTP 422' }),
        cmd({ operationId: 'cconf', entity: 'note', entityId: 'n1', status: 'conflict' }),
      ],
      nextSeq: 3,
      tombstones: {},
      authBlocked: false,
    });
    coreRetry = jest.spyOn(coreOutbox, 'retry').mockResolvedValue(undefined);
    coreDiscard = jest.spyOn(coreOutbox, 'discard').mockResolvedValue(undefined);
  });
  afterEach(() => { coreState.mockRestore(); coreRetry.mockRestore(); coreDiscard.mockRestore(); });

  it('lists the habit dead op, the task dead command and the core dead and conflict commands; never a pending one', () => {
    const issues = listOutboxIssues();
    expect(issues).toEqual([
      { channel: 'habit', id: 'hop', label: 'Su iç · 2026-08-04', reason: 'RLS denied', status: 'dead' },
      { channel: 'task', id: 'tdead', label: 'Görev: Rapor', reason: 'Sunucu kabul etmedi.', status: 'dead' },
      { channel: 'core', id: 'cdead', label: 'Günlük', reason: 'HTTP 422', status: 'dead' },
      { channel: 'core', id: 'cconf', label: 'Not', reason: 'Başka bir yerde değiştirilmiş.', status: 'conflict' },
    ]);
  });

  it('retry calls the right action on each channel', async () => {
    const [habit, task, core] = listOutboxIssues();
    await retryOutboxIssue(habit);
    await retryOutboxIssue(task);
    await retryOutboxIssue(core);
    expect(reviveSyncOp).toHaveBeenCalledWith('hop');
    expect(retryChange).toHaveBeenCalledWith('tdead');
    expect(coreRetry).toHaveBeenCalledWith('cdead', null);
  });

  it('discard calls the right action on each channel', async () => {
    const [habit, task, core] = listOutboxIssues();
    await discardOutboxIssue(habit);
    await discardOutboxIssue(task);
    await discardOutboxIssue(core);
    expect(dropSyncOp).toHaveBeenCalledWith('hop');
    expect(discardChange).toHaveBeenCalledWith('tdead');
    expect(coreDiscard).toHaveBeenCalledWith('cdead');
  });

  it('a core conflict is NOT retried from here (it is resolved on its own screen)', async () => {
    const conflict = listOutboxIssues().find((i) => i.status === 'conflict') as OutboxIssue;
    await retryOutboxIssue(conflict);
    expect(coreRetry).not.toHaveBeenCalled();
    expect(reviveSyncOp).not.toHaveBeenCalled();
    expect(retryChange).not.toHaveBeenCalled();
  });

  it('an unknown core entity still gets a readable label', () => {
    coreState.mockReturnValue({ userId: 'A', commands: [cmd({ operationId: 'z', entity: 'mystery' })], nextSeq: 2, tombstones: {}, authBlocked: false });
    expect(listOutboxIssues().find((i) => i.id === 'z')?.label).toBe('Değişiklik');
  });
});

describe('describeFlushOutcome — the message comes from what is left', () => {
  const summary = (over: Partial<UnifiedOutboxSummary>): UnifiedOutboxSummary => ({
    pending: 0, dead: 0, conflict: 0, authBlocked: false,
    channels: { habitLogs: { pending: 0, dead: 0 }, tasks: { pending: 0, dead: 0, conflict: 0, authBlocked: false }, core: { pending: 0, dead: 0, conflict: 0, authBlocked: false } },
    ...over,
  });

  it('offline with 7 waiting is NOT a success and never says "iletildi"', () => {
    const r = describeFlushOutcome(summary({ pending: 7 }));
    expect(r.tone).toBe('waiting');
    expect(r.tone).not.toBe('success');
    expect(r.message).not.toMatch(/iletildi/);
    expect(r.message).toBe('7 değişiklik bekliyor. Bağlantı gelince kendiliğinden gönderilecek.');
  });

  it('empty queues -> success', () => {
    expect(describeFlushOutcome(summary({}))).toEqual({ tone: 'success', message: 'Her şey eşitlendi.' });
  });

  it('dead or conflict -> attention, counting both', () => {
    expect(describeFlushOutcome(summary({ dead: 2, conflict: 1, pending: 4 }))).toEqual({
      tone: 'attention',
      message: '3 değişiklik gönderilemedi. Aşağıdan yeniden deneyebilir ya da bırakabilirsin.',
    });
  });

  it('a paused session -> auth, before anything else', () => {
    expect(describeFlushOutcome(summary({ authBlocked: true, dead: 1, pending: 2 }))).toEqual({
      tone: 'auth',
      message: 'Oturumun yenilenmesi gerekiyor; yenilenince otomatik denenecek.',
    });
  });
});
