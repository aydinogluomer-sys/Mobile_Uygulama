/**
 * F05 (SYN-15) — the network success signal and the fetch that publishes it.
 *
 * The signal is what lets the sync coordinator notice that the connection is back without a
 * network-state library: every successful Supabase answer publishes it, at most once a second.
 * The wrapping fetch must never change an answer or swallow a failure.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import {
  markNetworkSuccess,
  onNetworkSuccess,
  resetNetworkSignalForTests,
  signalOnSuccess,
} from '../../lib/networkSignal';

beforeEach(() => resetNetworkSignalForTests());

describe('the signal', () => {
  it('reaches every listener, at most once a second', () => {
    const a = jest.fn();
    const b = jest.fn();
    onNetworkSuccess(a);
    onNetworkSuccess(b);
    markNetworkSuccess(10_000);
    markNetworkSuccess(10_500); // inside the second: dropped
    markNetworkSuccess(10_999);
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
    markNetworkSuccess(11_000);
    expect(a).toHaveBeenCalledTimes(2);
  });

  it('an unsubscribed listener hears nothing; a throwing listener does not stop the others', () => {
    const gone = jest.fn();
    const bad = jest.fn(() => { throw new Error('listener broke'); });
    const good = jest.fn();
    const off = onNetworkSuccess(gone);
    onNetworkSuccess(bad);
    onNetworkSuccess(good);
    off();
    expect(() => markNetworkSuccess(1)).not.toThrow();
    expect(gone).not.toHaveBeenCalled();
    expect(good).toHaveBeenCalledTimes(1);
  });
});

describe('signalOnSuccess (the fetch lib/supabase uses)', () => {
  const res = (ok: boolean, status: number) => ({ ok, status, marker: Symbol('same') }) as unknown as Response;

  it('an ok answer publishes the signal and is returned untouched', async () => {
    const heard = jest.fn();
    onNetworkSuccess(heard);
    const answer = res(true, 200);
    const inner = jest.fn(async () => answer);
    const wrapped = signalOnSuccess(() => inner as unknown as typeof fetch);
    await expect(wrapped('https://x.supabase.co/rest/v1/t', { method: 'GET' })).resolves.toBe(answer);
    expect(inner).toHaveBeenCalledWith('https://x.supabase.co/rest/v1/t', { method: 'GET' });
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('a non-ok answer publishes nothing and is returned untouched', async () => {
    const heard = jest.fn();
    onNetworkSuccess(heard);
    const answer = res(false, 503);
    const wrapped = signalOnSuccess(() => (async () => answer) as unknown as typeof fetch);
    await expect(wrapped('u')).resolves.toBe(answer);
    expect(heard).not.toHaveBeenCalled();
  });

  it('a failed request fails exactly as before, with no signal', async () => {
    const heard = jest.fn();
    onNetworkSuccess(heard);
    const err = new TypeError('Network request failed');
    const wrapped = signalOnSuccess(() => (async () => { throw err; }) as unknown as typeof fetch);
    await expect(wrapped('u')).rejects.toBe(err);
    expect(heard).not.toHaveBeenCalled();
  });

  it('the fetch is read at call time, not when the wrapper is made', async () => {
    let current = jest.fn(async () => res(true, 200));
    const wrapped = signalOnSuccess(() => current as unknown as typeof fetch);
    const later = jest.fn(async () => res(true, 201));
    current = later;
    await wrapped('u');
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('lib/supabase hands exactly this fetch to its client, and nothing else creates a client', () => {
    const src = stripComments(readFileSync(join(__dirname, '..', '..', 'lib', 'supabase.ts'), 'utf8'));
    expect(src).toMatch(/global:\s*\{\s*fetch:\s*signalOnSuccess\(\(\) => fetch\)\s*\}/);
    expect((src.match(/createClient</g) ?? []).length).toBe(1);
  });
});
