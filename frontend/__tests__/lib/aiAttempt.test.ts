/**
 * R09.06 — "Timeout, provider yok, offline ve maliyet sınırı akışlarını
 * tamamla. ... retry veya başarısız işlem ikinci tahsilat üretmesin."
 * The attempt keeper: an unanswered request keeps its id for the resend.
 */
import { createAttemptKeeper, isNoAnswer, NO_ANSWER_NOTE } from '../../lib/aiAttempt';
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
