/**
 * F07 (EDG-02, INT-03, INT-11, REP-15): a resend carries the SAME request id, so the user pays once.
 *
 * implementation.md F07, section 5, "aiRetrySameRequestId.test.ts":
 *   - key lifecycle: retryWhileInProgress around 409 REQUEST_IN_PROGRESS;
 *   - INT-03: the attempt keeper's rebind;
 *   - integrated (fake server): runIdempotentAiRequest + an in-memory ledger;
 *   - INT-03 + INT-11 chain: runCoachTurn twice against a fake repository;
 *   - the real repository and 23505 (lib/supabase mocked).
 */
import { createAttemptKeeper, retryWhileInProgress, type InvokeOutcome } from '../../lib/aiAttempt';
import { EdgeTimeoutError } from '../../lib/edgeCall';
import {
  fingerprintInput,
  runIdempotentAiRequest,
  type AiResponse,
  type BeginOutcome,
  type IdempotencyDeps,
  type SpendResult,
} from '../../../supabase/functions/_shared/aiIdempotency';
import { runCoachTurn } from '../../services/aiCoachService';

// ---------------------------------------------------------------------------------------
// lib/supabase: the PostgREST chain the real repository builds on ai_messages
// ---------------------------------------------------------------------------------------

type MsgRow = {
  id: string; conversation_id: string; user_id: string; role: 'user' | 'assistant';
  content: string; request_id: string | null; created_at: string;
};

const mockDb = {
  /** Answers of the ai_messages SELECTs, in order (null = no row). */
  selects: [] as (MsgRow | null)[],
  /** What the next ai_messages INSERT returns. */
  insert: { data: null as MsgRow | null, error: null as { code: string; message: string } | null },
  insertCalls: 0,
  selectCalls: 0,
};

jest.mock('../../lib/supabase', () => {
  const chain = () => {
    let inserting = false;
    const c: Record<string, unknown> = {
      insert: () => { inserting = true; return c; },
      select: () => c,
      eq: () => c,
      single: async () => {
        mockDb.insertCalls += 1;
        return { data: mockDb.insert.data, error: mockDb.insert.error };
      },
      maybeSingle: async () => {
        if (inserting) throw new Error('an insert never ends in maybeSingle here');
        mockDb.selectCalls += 1;
        return { data: mockDb.selects.length ? mockDb.selects.shift() ?? null : null, error: null };
      },
    };
    return c;
  };
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'user-A' } } }, error: null }) },
      from: () => chain(),
    },
  };
});

// ---------------------------------------------------------------------------------------
// the fake repository the chain runs against (one row per conversation, request id and role,
// as the database holds them once 039 is applied)
// ---------------------------------------------------------------------------------------

const mockFake = {
  conversations: [] as string[],
  rows: [] as MsgRow[],
  createCalls: 0,
  seq: 0,
  failAssistantCode: null as string | null,
};

jest.mock('../../repositories/aiConversationRepository', () => {
  const actual = jest.requireActual('../../repositories/aiConversationRepository');
  return {
    ...actual,
    createConversation: async ({ title }: { title: string }) => {
      mockFake.createCalls += 1;
      mockFake.seq += 1;
      const id = `conv-${mockFake.seq}`;
      mockFake.conversations.push(id);
      const at = '2026-11-02T00:00:00.000Z';
      return { ok: true, data: { id, user_id: 'user-A', title, project_id: null, created_at: at, updated_at: at, last_message_at: at, archived_at: null } };
    },
    insertMessage: async (input: { conversationId: string; role: 'user' | 'assistant'; content: string; requestId?: string | null }) => {
      if (input.role === 'assistant' && mockFake.failAssistantCode) {
        const code = mockFake.failAssistantCode;
        mockFake.failAssistantCode = null;
        return { ok: false, error: 'new row violates row-level security policy', code };
      }
      const existing = mockFake.rows.find((r) => r.conversation_id === input.conversationId && r.role === input.role && input.requestId && r.request_id === input.requestId);
      if (existing) return { ok: true, data: existing };
      mockFake.seq += 1;
      const row: MsgRow = {
        id: `msg-${mockFake.seq}`, conversation_id: input.conversationId, user_id: 'user-A', role: input.role,
        content: input.content, request_id: input.requestId ?? null, created_at: '2026-11-02T00:00:00.000Z',
      };
      mockFake.rows.push(row);
      return { ok: true, data: row };
    },
  };
});

const realInsertMessage = (
  jest.requireActual('../../repositories/aiConversationRepository') as typeof import('../../repositories/aiConversationRepository')
).insertMessage;

beforeEach(() => {
  mockDb.selects = [];
  mockDb.insert = { data: null, error: null };
  mockDb.insertCalls = 0;
  mockDb.selectCalls = 0;
  mockFake.conversations = [];
  mockFake.rows = [];
  mockFake.createCalls = 0;
  mockFake.seq = 0;
});

// ---------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------

/** A FunctionsHttpError whose body (a Response) can be read once; `reads` counts the reads. */
function httpError(body: Record<string, unknown>) {
  const reads = { n: 0 };
  const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
    name: 'FunctionsHttpError',
    context: { json: async () => { reads.n += 1; if (reads.n > 1) throw new TypeError('Body is unusable'); return body; } },
  });
  return { error, reads };
}
const inProgress = () => httpError({ error: 'Bu istek hâlâ işleniyor, birazdan tekrar dene.', code: 'REQUEST_IN_PROGRESS' });

const TEXT = 'Bugün çok yorgunum';
const ids = () => { let n = 0; const f = () => `id${++n}`; return Object.assign(f, { count: () => n }); };

// ---------------------------------------------------------------------------------------
describe('key lifecycle', () => {
  const BODY = { request_id: 'req-1-aaaaaaaa', message: TEXT };

  it('(+) 409 twice, then 200 (replay): three calls, waits of 1500 and 3000, the same request_id each time', async () => {
    const outcomes: InvokeOutcome<Record<string, unknown>>[] = [
      { data: null, error: inProgress().error },
      { data: null, error: inProgress().error },
      { data: { reply: 'ok', replayed: true }, error: null },
    ];
    const sent: unknown[] = [];
    const sleep = jest.fn(async () => {});
    const out = await retryWhileInProgress(async () => { sent.push(BODY.request_id); return outcomes.shift()!; }, { sleep });
    expect(sent).toEqual(['req-1-aaaaaaaa', 'req-1-aaaaaaaa', 'req-1-aaaaaaaa']);
    expect(sleep.mock.calls).toEqual([[1500], [3000]]);
    expect(out.stillInProgress).toBe(false);
  });

  it('(+) the budget runs out (409 four times): stillInProgress, and without answered() the same key gives the same id', async () => {
    const keeper = createAttemptKeeper(ids());
    const id = keeper.begin(`conv-1|${TEXT}`);
    const call = jest.fn(async () => ({ data: null, error: inProgress().error }));
    const out = await retryWhileInProgress(call, { sleep: async () => {} });
    expect(call).toHaveBeenCalledTimes(4);
    expect(out.stillInProgress).toBe(true);
    expect(keeper.begin(`conv-1|${TEXT}`)).toBe(id);
  });

  it('(-) 402 INSUFFICIENT_CREDITS: no retry (one call), errorInfo carries the code and the balance', async () => {
    const call = jest.fn(async () => ({ data: null, error: httpError({ error: 'Yetersiz Focus Point.', code: 'INSUFFICIENT_CREDITS', balance: 3 }).error }));
    const out = await retryWhileInProgress(call, { sleep: async () => {} });
    expect(call).toHaveBeenCalledTimes(1);
    expect(out.errorInfo?.code).toBe('INSUFFICIENT_CREDITS');
    expect(out.errorInfo?.balance).toBe(3);
  });

  it('(-) EdgeTimeoutError: no retry, errorInfo null', async () => {
    const call = jest.fn(async () => ({ data: null, error: new EdgeTimeoutError('AI Koç') }));
    const out = await retryWhileInProgress(call, { sleep: async () => {} });
    expect(call).toHaveBeenCalledTimes(1);
    expect(out.errorInfo).toBeNull();
  });

  it('(-) 500: no retry', async () => {
    const call = jest.fn(async () => ({ data: null, error: httpError({ error: 'Sağlayıcı hatası' }).error }));
    const out = await retryWhileInProgress(call, { sleep: async () => {} });
    expect(call).toHaveBeenCalledTimes(1);
    expect(out.stillInProgress).toBe(false);
  });

  it('(-) isCancelled true: no wait is made', async () => {
    const call = jest.fn(async () => ({ data: null, error: inProgress().error }));
    const sleep = jest.fn(async () => {});
    const out = await retryWhileInProgress(call, { sleep, isCancelled: () => true });
    expect(sleep).not.toHaveBeenCalled();
    expect(out.stillInProgress).toBe(true);
  });

  it('(+) the Response body is read once (the fake context.json call counter is 1)', async () => {
    const h = httpError({ error: 'Yetersiz Focus Point.', code: 'INSUFFICIENT_CREDITS', balance: 3 });
    const out = await retryWhileInProgress(async () => ({ data: null, error: h.error }), { sleep: async () => {} });
    expect(h.reads.n).toBe(1);
    expect(out.errorInfo?.msg).toBe('Yetersiz Focus Point.');
  });
});

// ---------------------------------------------------------------------------------------
describe('INT-03', () => {
  it("(+) begin('|Bugün çok yorgunum') -> id1; rebind to 'conv-1|...'; begin('conv-1|...') -> id1", () => {
    const k = createAttemptKeeper(ids());
    expect(k.begin('|Bugün çok yorgunum')).toBe('id1');
    k.rebind('|Bugün çok yorgunum', 'conv-1|Bugün çok yorgunum');
    expect(k.begin('conv-1|Bugün çok yorgunum')).toBe('id1');
  });

  it("(+) begin('|Bugün çok yorgunum') (a new thread) is id1 too", () => {
    const k = createAttemptKeeper(ids());
    k.begin('|Bugün çok yorgunum');
    k.rebind('|Bugün çok yorgunum', 'conv-1|Bugün çok yorgunum');
    expect(k.begin('conv-1|Bugün çok yorgunum')).toBe('id1');
    expect(k.begin('|Bugün çok yorgunum')).toBe('id1');
  });

  it('(-) rebind with a fromKey that does not match is a no-op', () => {
    const k = createAttemptKeeper(ids());
    k.begin('|Bugün çok yorgunum');
    k.rebind('|başka metin', 'conv-1|başka metin');
    expect(k.begin('conv-1|başka metin')).toBe('id2');
  });

  it('(-) a different text is a new id', () => {
    const k = createAttemptKeeper(ids());
    expect(k.begin('|Bugün çok yorgunum')).toBe('id1');
    expect(k.begin('|başka metin')).toBe('id2');
  });

  it('(-) after answered() the same key is a new id', () => {
    const k = createAttemptKeeper(ids());
    expect(k.begin('|Bugün çok yorgunum')).toBe('id1');
    k.answered();
    expect(k.begin('|Bugün çok yorgunum')).toBe('id2');
  });
});

// ---------------------------------------------------------------------------------------
describe('integrated (fake server)', () => {
  type Row = { mode: string; fingerprint: string; status: 'in_progress' | 'completed' | 'failed'; response?: Record<string, unknown>; error?: string };

  function makeServer(start: number) {
    const rows = new Map<string, Row>();
    const ledger = new Map<string, number>();
    let balance = start;
    let providerCalls = 0;
    let release: () => void = () => {};
    const hold = new Promise<void>((r) => { release = r; });
    const tick = <T,>(v: T): Promise<T> => Promise.resolve().then(() => v);
    const deps: IdempotencyDeps = {
      begin: ({ requestId, mode, fingerprint }) => {
        const r = rows.get(requestId);
        if (!r) { rows.set(requestId, { mode, fingerprint, status: 'in_progress' }); return tick<BeginOutcome>({ kind: 'claimed' }); }
        if (r.mode !== mode || r.fingerprint !== fingerprint) return tick<BeginOutcome>({ kind: 'mismatch' });
        if (r.status === 'completed') return tick<BeginOutcome>({ kind: 'replay', response: r.response! });
        if (r.status === 'failed') return tick<BeginOutcome>({ kind: 'consumed', error: r.error ?? null });
        return tick<BeginOutcome>({ kind: 'in_progress' });
      },
      complete: async ({ requestId, response }) => { const r = rows.get(requestId); if (r?.status === 'in_progress') { r.status = 'completed'; r.response = response; } },
      fail: async ({ requestId, error }) => { const r = rows.get(requestId); if (r?.status === 'in_progress') { r.status = 'failed'; r.error = error; } },
      release: async ({ requestId }) => { if (rows.get(requestId)?.status === 'in_progress') rows.delete(requestId); },
      spend: ({ requestId, cost }) => {
        if (ledger.has(requestId)) return tick<SpendResult>({ kind: 'replayed', balance });
        if (balance < cost) return tick<SpendResult>({ kind: 'insufficient', balance });
        balance -= cost;
        ledger.set(requestId, -cost);
        return tick<SpendResult>({ kind: 'charged', balance });
      },
      refund: async () => true,
      expireLease: async () => {},
      callProvider: async () => { providerCalls += 1; await hold; return { ok: true, payload: { reply: 'Dinlenmek iyi gelir.' } }; },
      readBalance: async () => balance,
      describeError: (raw) => raw,
    };
    return {
      async call(requestId: string): Promise<AiResponse> {
        return runIdempotentAiRequest({ requestId, mode: 'coach', fingerprint: await fingerprintInput('coach', [TEXT]), cost: 5 }, deps);
      },
      /** The fingerprint is an async digest: wait until the first request really holds the claim. */
      async claimed(requestId: string) {
        for (let i = 0; i < 1000 && !rows.has(requestId); i += 1) await new Promise((r) => setTimeout(r, 0));
      },
      finish: () => release(),
      get providerCalls() { return providerCalls; },
      debits: () => [...ledger.keys()],
    };
  }

  const toClient = (res: AiResponse): InvokeOutcome<Record<string, unknown>> =>
    (res.status === 200 ? { data: res.body, error: null } : { data: null, error: httpError(res.body).error });

  it('one debit, one provider call, and the client never produced a new request_id', async () => {
    const server = makeServer(30);
    const newId = ids();
    const keeper = createAttemptKeeper(newId);

    // first call: begin -> claimed -> spend (5), the provider is held (the lease is open)
    const id = keeper.begin(`conv-1|${TEXT}`);
    const first = server.call(id);
    await server.claimed(id);

    // the same request_id again: 409 while the first is in progress; the client waits; the provider
    // finishes; the third call is the replay
    const sent: string[] = [];
    let waits = 0;
    const out = await retryWhileInProgress(
      async () => { const rid = keeper.begin(`conv-1|${TEXT}`); sent.push(rid); return toClient(await server.call(rid)); },
      { sleep: async () => { waits += 1; if (waits === 2) { server.finish(); await first; } } },
    );

    expect(sent).toEqual([id, id, id]);
    expect(out.data).toMatchObject({ replayed: true, reply: 'Dinlenmek iyi gelir.' });
    expect(server.debits()).toEqual([id]);
    expect(server.providerCalls).toBe(1);
    expect(newId.count()).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------
describe('INT-03 + INT-11 chain', () => {
  it('(+) one createConversation, one user row, and invoke gets the same request_id both times', async () => {
    const sent: unknown[] = [];
    const first = await runCoachTurn({
      conversationId: null, text: TEXT, requestId: 'req-1-aaaaaaaa',
      invoke: async (body) => { sent.push(body.request_id); throw new Error('Yanıt alınamadı.'); },
    });
    expect(first.ok).toBe(false);
    const created = mockFake.conversations[0]!;
    const second = await runCoachTurn({
      conversationId: created, text: TEXT, requestId: 'req-1-aaaaaaaa',
      invoke: async (body) => { sent.push(body.request_id); return { reply: 'Dinlenmek iyi gelir.' }; },
    });
    expect(second.ok).toBe(true);
    expect(mockFake.createCalls).toBe(1);
    expect(mockFake.rows.filter((r) => r.role === 'user')).toHaveLength(1);
    expect(sent).toEqual(['req-1-aaaaaaaa', 'req-1-aaaaaaaa']);
  });

  it('(-) a different requestId makes two user rows', async () => {
    await runCoachTurn({ conversationId: null, text: TEXT, requestId: 'req-1-aaaaaaaa', invoke: async () => ({ reply: 'Bir.' }) });
    const created = mockFake.conversations[0]!;
    await runCoachTurn({ conversationId: created, text: TEXT, requestId: 'req-2-aaaaaaaa', invoke: async () => ({ reply: 'İki.' }) });
    expect(mockFake.rows.filter((r) => r.role === 'user')).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------------------
describe('the real repository and 23505', () => {
  const stored = (role: 'user' | 'assistant'): MsgRow => ({
    id: `stored-${role}`, conversation_id: 'conv-x', user_id: 'user-A', role, content: 'önceki',
    request_id: 'req-1-aaaaaaaa', created_at: '2026-11-02T00:00:00.000Z',
  });
  const duplicate = { code: '23505', message: 'duplicate key value violates unique constraint' };

  it('(+) insertMessage({ role: user, requestId }) on 23505 returns { ok: true, data: the stored row }', async () => {
    mockDb.selects = [null, stored('user')];       // the pre-read misses, the read after 23505 finds it
    mockDb.insert = { data: null, error: duplicate };
    const res = await realInsertMessage({ conversationId: 'conv-x', role: 'user', content: TEXT, requestId: 'req-1-aaaaaaaa' });
    expect(res).toEqual({ ok: true, data: stored('user') });
  });

  it('(+) the assistant role too (the behaviour that already existed)', async () => {
    mockDb.selects = [stored('assistant')];
    mockDb.insert = { data: null, error: duplicate };
    const res = await realInsertMessage({ conversationId: 'conv-x', role: 'assistant', content: 'yanıt', requestId: 'req-1-aaaaaaaa' });
    expect(res).toEqual({ ok: true, data: stored('assistant') });
  });

  it('(-) without a requestId 23505 comes back as an error with code', async () => {
    mockDb.insert = { data: null, error: duplicate };
    const res = await realInsertMessage({ conversationId: 'conv-x', role: 'user', content: TEXT, requestId: null });
    expect(res).toEqual({ ok: false, error: duplicate.message, code: '23505' });
  });

  it('(-) another code (42501) comes back as an error with code so runCoachTurn can surface EDG-19 guidance', async () => {
    mockDb.insert = { data: null, error: { code: '42501', message: 'new row violates row-level security policy' } };
    const res = await realInsertMessage({ conversationId: 'conv-x', role: 'user', content: TEXT, requestId: 'req-1-aaaaaaaa' });
    expect(res).toEqual({ ok: false, error: 'new row violates row-level security policy', code: '42501' });
  });

  it('(+) when the pre-read finds the row, the insert is never called', async () => {
    mockDb.selects = [stored('user')];
    const res = await realInsertMessage({ conversationId: 'conv-x', role: 'user', content: TEXT, requestId: 'req-1-aaaaaaaa' });
    expect(res).toEqual({ ok: true, data: stored('user') });
    expect(mockDb.insertCalls).toBe(0);
  });

  it('(+) F21 (EDG-19): runCoachTurn translates assistant 42501 RLS refusal into user-facing Turkish refund-pending guidance', async () => {
    mockFake.failAssistantCode = '42501';
    const out = await runCoachTurn({
      conversationId: 'conv-x',
      text: TEXT,
      requestId: 'req-42501-aaaaaaa',
      invoke: async () => ({ reply: 'Sunucuda kaydı tamamlanmamış yanıt', actions: [] }),
    });
    expect(out).toEqual({
      ok: false,
      error: 'Yanıt kaydedilemedi. Biraz sonra tekrar dene; ücret alındıysa süre dolunca iade edilir.',
      code: '42501',
    });
  });
});
