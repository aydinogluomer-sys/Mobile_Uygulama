/**
 * R09.06 — "Timeout, provider yok, offline ve maliyet sınırı akışlarını
 * tamamla. ... retry veya başarısız işlem ikinci tahsilat üretmesin."
 * The attempt keeper: an unanswered request keeps its id for the resend.
 */
import { createAttemptKeeper, isNoAnswer, NO_ANSWER_NOTE, IN_PROGRESS_NOTE, retryWhileInProgress } from '../../lib/aiAttempt';
import { EdgeTimeoutError } from '../../lib/edgeCall';

const ids = () => { let n = 0; return () => `id-${++n}`; };

describe('which failures are "no answer"', () => {
  it('timeout, offline fetch, relay failure, abort, RN network error', () => {
    expect(isNoAnswer(new EdgeTimeoutError('AI rutin'))).toBe(true);
    expect(isNoAnswer(Object.assign(new Error('x'), { name: 'FunctionsFetchError' }))).toBe(true);
    expect(isNoAnswer(Object.assign(new Error('x'), { name: 'FunctionsRelayError' }))).toBe(true);
    expect(isNoAnswer(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true);
    expect(isNoAnswer(new TypeError('Network request failed'))).toBe(true);
  });
  it('a server answer -- an HTTP error with a body, or anything else -- is not', () => {
    expect(isNoAnswer(Object.assign(new Error('402'), { name: 'FunctionsHttpError' }))).toBe(false);
    expect(isNoAnswer(new Error('Yetersiz Focus Point'))).toBe(false);
    expect(isNoAnswer(new TypeError('x is not a function'))).toBe(false);
    // the server's own message about ITS upstream is an answer, even if it reads like a network error
    expect(isNoAnswer(new Error('Sağlayıcı: failed to fetch'))).toBe(false);
    expect(isNoAnswer(null)).toBe(false);
  });
  it('the note tells the user a resend is free', () => {
    expect(NO_ANSWER_NOTE).toMatch(/ikinci kez ücret alınmaz/);
  });
});

describe('the keeper', () => {
  it('the same request after no answer reuses the id; after an answer it is new', () => {
    const k = createAttemptKeeper(ids());
    expect(k.begin('a')).toBe('id-1');
    expect(k.begin('a')).toBe('id-1');
    k.answered();
    expect(k.begin('a')).toBe('id-2');
  });
  it('a different request is always new, and replaces the open one', () => {
    const k = createAttemptKeeper(ids());
    expect(k.begin('a')).toBe('id-1');
    expect(k.begin('b')).toBe('id-2');
    expect(k.begin('a')).toBe('id-3');
  });
});

// F07 (INT-03)
describe('rebind', () => {
  it("(+) begin('|Bugün çok yorgunum') -> id1; rebind to 'conv-1|...'; begin('conv-1|...') -> id1", () => {
    const k = createAttemptKeeper(ids());
    expect(k.begin('|Bugün çok yorgunum')).toBe('id-1');
    k.rebind('|Bugün çok yorgunum', 'conv-1|Bugün çok yorgunum');
    expect(k.begin('conv-1|Bugün çok yorgunum')).toBe('id-1');
  });
  it("(+) begin('|Bugün çok yorgunum') (a new thread) is id1 too", () => {
    const k = createAttemptKeeper(ids());
    k.begin('|Bugün çok yorgunum');
    k.rebind('|Bugün çok yorgunum', 'conv-1|Bugün çok yorgunum');
    expect(k.begin('conv-1|Bugün çok yorgunum')).toBe('id-1');
    expect(k.begin('|Bugün çok yorgunum')).toBe('id-1');
  });
  it('(-) rebind with a fromKey that does not match is a no-op', () => {
    const k = createAttemptKeeper(ids());
    k.begin('|Bugün çok yorgunum');
    k.rebind('|başka metin', 'conv-1|başka metin');
    expect(k.begin('conv-1|başka metin')).toBe('id-2');
  });
  it('(-) a different text is a new id', () => {
    const k = createAttemptKeeper(ids());
    expect(k.begin('|Bugün çok yorgunum')).toBe('id-1');
    expect(k.begin('|başka metin')).toBe('id-2');
  });
  it('(-) after answered() the same key is a new id', () => {
    const k = createAttemptKeeper(ids());
    expect(k.begin('|Bugün çok yorgunum')).toBe('id-1');
    k.answered();
    expect(k.begin('|Bugün çok yorgunum')).toBe('id-2');
  });
});

// F07 (EDG-02), with a fake sleep
describe('retryWhileInProgress', () => {
  /** A FunctionsHttpError whose body (a Response) can be read once. */
  const httpError = (body: Record<string, unknown>) => {
    const reads = { n: 0 };
    const error = Object.assign(new Error('Edge Function returned a non-2xx status code'), {
      name: 'FunctionsHttpError',
      context: { json: async () => { reads.n += 1; if (reads.n > 1) throw new TypeError('Body is unusable'); return body; } },
    });
    return { error, reads };
  };
  const inProgress = () => httpError({ error: 'Bu istek hâlâ işleniyor, birazdan tekrar dene.', code: 'REQUEST_IN_PROGRESS' });

  it('(+) 409 twice, then 200 (replay): three calls of the same request, waits of 1500 and 3000', async () => {
    const outcomes = [{ data: null, error: inProgress().error }, { data: null, error: inProgress().error }, { data: { replayed: true }, error: null }];
    const call = jest.fn(async () => outcomes.shift()!);
    const sleep = jest.fn(async () => {});
    const out = await retryWhileInProgress(call, { sleep });
    expect(call).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[1500], [3000]]);
    expect(out.stillInProgress).toBe(false);
  });
  it('(+) the budget runs out (409 four times): stillInProgress, so the attempt stays open', async () => {
    const k = createAttemptKeeper(ids());
    const id = k.begin('conv-1|a');
    const call = jest.fn(async () => ({ data: null, error: inProgress().error }));
    const out = await retryWhileInProgress(call, { sleep: async () => {} });
    expect(call).toHaveBeenCalledTimes(4);
    expect(out.stillInProgress).toBe(true);
    expect(k.begin('conv-1|a')).toBe(id);
  });
  it('(-) 402 INSUFFICIENT_CREDITS: no retry, errorInfo carries the code and the balance', async () => {
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
    await retryWhileInProgress(call, { sleep: async () => {} });
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('(-) isCancelled true: no wait is made', async () => {
    const call = jest.fn(async () => ({ data: null, error: inProgress().error }));
    const sleep = jest.fn(async () => {});
    const out = await retryWhileInProgress(call, { sleep, isCancelled: () => true });
    expect(sleep).not.toHaveBeenCalled();
    expect(out.stillInProgress).toBe(true);
  });
  it('(+) the Response body is read once', async () => {
    const h = httpError({ error: 'Yetersiz Focus Point.', code: 'INSUFFICIENT_CREDITS', balance: 3 });
    await retryWhileInProgress(async () => ({ data: null, error: h.error }), { sleep: async () => {} });
    expect(h.reads.n).toBe(1);
  });
});

describe('IN_PROGRESS_NOTE', () => {
  it('tells the user a resend is free', () => {
    expect(IN_PROGRESS_NOTE).toMatch(/ikinci kez ücret alınmaz/);
  });
});
