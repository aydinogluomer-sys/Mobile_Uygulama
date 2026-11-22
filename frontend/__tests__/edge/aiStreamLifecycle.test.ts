import { readFileSync } from 'fs';
import { join } from 'path';
import {
  EdgeTimeoutError,
  STREAM_FIRST_BYTE_MS,
  STREAM_IDLE_MS,
  STREAM_TOTAL_MS,
  withStreamDeadline,
} from '../../lib/edgeCall';
import { invokeAiWithStream } from '../../services/aiStreamService';

const mockInvoke = jest.fn();
jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({
        data: { session: { access_token: 'jwt-stream-1', user: { id: 'u1' } } },
        error: null,
      })),
    },
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

describe('F21 (EDG-09, REP-07, EDG-17, INT-26) — AI Stream Deadlines, Cancellation & Transport Selection', () => {
  const originalFetch = global.fetch;
  const originalTransport = process.env.EXPO_PUBLIC_AI_TRANSPORT;

  beforeEach(() => {
    jest.useFakeTimers();
    mockInvoke.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    if (originalTransport === undefined) delete process.env.EXPO_PUBLIC_AI_TRANSPORT;
    else process.env.EXPO_PUBLIC_AI_TRANSPORT = originalTransport;
  });

  it('(+) exports 20s / 20s / 90s stream constants and resets idle timer on every touch() up to 60s', async () => {
    expect(STREAM_FIRST_BYTE_MS).toBe(20_000);
    expect(STREAM_IDLE_MS).toBe(20_000);
    expect(STREAM_TOTAL_MS).toBe(90_000);

    const p = withStreamDeadline('AI Koç', async (signal, touch) => {
      for (let step = 0; step < 12; step += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5_000));
        expect(signal.aborted).toBe(false);
        touch();
      }
      return 'tamamlandı';
    });

    for (let step = 0; step < 12; step += 1) {
      await jest.advanceTimersByTimeAsync(5_000);
    }
    await expect(p).resolves.toBe('tamamlandı');
  });

  it('(+) external AbortSignal aborts the single inner signal immediately without relabelling as EdgeTimeoutError', async () => {
    const outer = new AbortController();
    let innerSignal: AbortSignal | null = null;

    const p = withStreamDeadline(
      'AI Koç',
      (signal) => {
        innerSignal = signal;
        return new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('caller-cancelled')));
        });
      },
      { signal: outer.signal },
    );

    outer.abort();
    const caught = await p.catch((e) => e);
    expect(innerSignal!.aborted).toBe(true);
    expect(caught).not.toBeInstanceOf(EdgeTimeoutError);
    expect((caught as Error).message).toBe('caller-cancelled');
  });

  it('(-) rejects with EdgeTimeoutError on 20s first-byte silence, 20s inter-frame silence, and 90s total ceiling', async () => {
    // 1) First byte never arrives
    const pFirst = withStreamDeadline('AI Koç', () => new Promise<never>(() => {})).catch((e) => e);
    await jest.advanceTimersByTimeAsync(20_001);
    expect(await pFirst).toBeInstanceOf(EdgeTimeoutError);

    // 2) First byte arrives at 5s, then 20s idle silence
    const pIdle = withStreamDeadline('AI Koç', async (_signal, touch) => {
      await new Promise<void>((r) => setTimeout(r, 5_000));
      touch();
      return new Promise<never>(() => {});
    }).catch((e) => e);
    await jest.advanceTimersByTimeAsync(5_000);
    await jest.advanceTimersByTimeAsync(20_001);
    expect(await pIdle).toBeInstanceOf(EdgeTimeoutError);

    // 3) Touches every 10s forever -> cut off at 90s total deadline
    const pTotal = withStreamDeadline('AI Koç', async (signal, touch) => {
      while (!signal.aborted) {
        await new Promise<void>((r) => setTimeout(r, 10_000));
        touch();
      }
      throw new Error('aborted');
    }).catch((e) => e);
    await jest.advanceTimersByTimeAsync(90_001);
    expect(await pTotal).toBeInstanceOf(EdgeTimeoutError);
  });

  it('(-) invokeAiWithStream calls reader.cancel() on timeout and suppresses late frames from firing onReplyText', async () => {
    const partials: string[] = [];
    let cancelCalls = 0;
    const lateSink: { push: ((chunk: Uint8Array) => void) | null } = { push: null };
    const encoder = new TextEncoder();

    let readCall = 0;
    const fakeResponse = {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream; charset=utf-8' },
      body: {
        getReader: () => ({
          read: () => {
            readCall += 1;
            if (readCall === 1) {
              return Promise.resolve({
                done: false,
                value: encoder.encode('event: delta\ndata: {"reply":"İlk parça"}\n\n'),
              });
            }
            return new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
              lateSink.push = (chunk) => resolve({ done: false, value: chunk });
            });
          },
          cancel: async () => {
            cancelCalls += 1;
          },
        }),
      },
    } as unknown as Response;

    global.fetch = jest.fn(async () => fakeResponse) as unknown as typeof fetch;

    const p = invokeAiWithStream({
      transport: 'stream',
      forceStreamFetchUrl: 'http://127.0.0.1:54321/functions/v1',
      body: { mode: 'coach', message: 'Deneme', request_id: 'req-timeout-cancel' },
      onReplyText: (t) => partials.push(t),
    });

    await jest.advanceTimersByTimeAsync(10);
    expect(partials).toEqual(['İlk parça']);

    // Idle 20s -> timeout fires and cancels reader
    await jest.advanceTimersByTimeAsync(20_050);
    const res = await p;
    expect(res.data).toBeNull();
    expect(res.error).toBeInstanceOf(EdgeTimeoutError);
    expect(cancelCalls).toBe(1);

    // Late chunk arriving after timeout must NOT invoke onReplyText
    lateSink.push?.(encoder.encode('event: delta\ndata: {"reply":"Hayalet metin"}\n\n'));
    await Promise.resolve();
    expect(partials).toEqual(['İlk parça']);
  });

  it('(-) external signal abort suppresses subsequent onReplyText updates', async () => {
    const partials: string[] = [];
    const outer = new AbortController();
    const encoder = new TextEncoder();
    const abortSink: { resume: (() => void) | null } = { resume: null };

    const fakeResponse = {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream; charset=utf-8' },
      body: {
        getReader: () => ({
          read: () =>
            new Promise<{ done: boolean; value?: Uint8Array }>((resolve) => {
              abortSink.resume = () =>
                resolve({
                  done: false,
                  value: encoder.encode('event: delta\ndata: {"reply":"İptal sonrası"}\n\n'),
                });
            }),
          cancel: async () => {},
        }),
      },
    } as unknown as Response;

    global.fetch = jest.fn(async () => fakeResponse) as unknown as typeof fetch;

    const p = invokeAiWithStream({
      transport: 'stream',
      signal: outer.signal,
      forceStreamFetchUrl: 'http://127.0.0.1:54321/functions/v1',
      body: { mode: 'coach', message: 'İptal testi', request_id: 'req-ext-abort' },
      onReplyText: (t) => partials.push(t),
    });

    await jest.advanceTimersByTimeAsync(5);
    outer.abort();
    abortSink.resume?.();
    const res = await p;
    expect(res.data).toBeNull();
    expect(partials).toEqual([]);
  });

  it('(+) marks missing ReadableStream body as transport="buffered", uses invoke when EXPO_PUBLIC_AI_TRANSPORT="invoke", and removes isJestMockedInvoke', async () => {
    const bufferedResponse = {
      ok: true,
      status: 200,
      headers: { get: () => 'text/event-stream; charset=utf-8' },
      body: null,
      text: async () => 'event: done\ndata: {"reply":"Tamponlu yanıt","actions":[],"balance":12}\n\n',
    } as unknown as Response;

    global.fetch = jest.fn(async () => bufferedResponse) as unknown as typeof fetch;
    const bufRes = await invokeAiWithStream({
      transport: 'stream',
      forceStreamFetchUrl: 'http://127.0.0.1:54321/functions/v1',
      body: { mode: 'coach', message: 'Buffered test', request_id: 'req-buf-1' },
    });
    expect(bufRes.transport).toBe('buffered');
    expect(bufRes.data?.reply).toBe('Tamponlu yanıt');

    process.env.EXPO_PUBLIC_AI_TRANSPORT = 'invoke';
    mockInvoke.mockResolvedValueOnce({ data: { reply: 'Invoke yanıtı', actions: [] }, error: null });
    const invRes = await invokeAiWithStream({
      body: { mode: 'coach', message: 'Invoke test', request_id: 'req-inv-1' },
    });
    expect(invRes.transport).toBe('invoke');
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    const streamSrc = readFileSync(join(__dirname, '..', '..', 'services', 'aiStreamService.ts'), 'utf8');
    expect(streamSrc).not.toContain('isJestMockedInvoke');
  });
});
