import { extractPartialReplyFromToolJson } from '../../../supabase/functions/_shared/coachContractSchema';
import { isNoAnswer } from '../../lib/aiAttempt';
import { extractInvokeError } from '../../lib/aiInvoke';
import { drainSseBuffer, invokeAiWithStream } from '../../services/aiStreamService';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'jwt-tok-123', user: { id: 'u1' } } },
        error: null,
      }),
    },
    functions: {
      invoke: async () => ({ data: { reply: 'Fallback yanıt', actions: [], balance: 10 }, error: null }),
    },
  },
}));

function makeSseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(encoder.encode(c));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  });
}

describe('Item #6 — AI Coach SSE Token Streaming & Idempotent Error Semantics', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('extractPartialReplyFromToolJson decodes partial tool_use JSON streams safely across escape and Unicode boundaries', () => {
    const full = JSON.stringify({
      reply: 'Harika adım!\nBugün "20 dk" yürüyüş ve \u015fükür notu ekleyebilirim.',
      actions: [{ type: 'lighten_week' }],
    });

    // Cut mid-escape (`\`) and mid-unicode (`\u01`) without emitting garbage
    const snapshots: string[] = [];
    for (let i = 1; i <= full.length; i += 3) {
      const partial = extractPartialReplyFromToolJson(full.slice(0, i));
      if (partial) snapshots.push(partial);
    }
    expect(snapshots[0].startsWith('H')).toBe(true);
    expect(snapshots[snapshots.length - 1]).toBe(
      'Harika adım!\nBugün "20 dk" yürüyüş ve şükür notu ekleyebilirim.',
    );
  });

  it('drainSseBuffer parses chunked SSE events split across arbitrary TCP boundaries', () => {
    const first = drainSseBuffer('event: delta\ndata: {"reply":"Mer');
    expect(first.frames).toEqual([]);
    const second = drainSseBuffer(`${first.rest}haba"}\n\nevent: done\ndata: {"reply":"Merhaba dünya","actions":[],"balance":10}\n\n`);
    expect(second.frames).toHaveLength(2);
    expect(second.frames[0]).toEqual({ event: 'delta', data: { reply: 'Merhaba' } });
    expect(second.frames[1].event).toBe('done');
  });

  it('streams incremental reply tokens via onReplyText and resolves final actions + balance on done event', async () => {
    const partials: string[] = [];
    global.fetch = jest.fn(async () =>
      makeSseResponse([
        'event: delta\ndata: {"reply":"Harika"}\n\n',
        'event: delta\ndata: {"reply":"Harika bir"}\n\n',
        'event: delta\ndata: {"reply":"Harika bir plan!"}\n\n',
        'event: done\ndata: {"reply":"Harika bir plan!","actions":[{"type":"lighten_week"}],"balance":20,"cost":5}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const res = await invokeAiWithStream({
      forceStreamFetchUrl: 'https://example.supabase.co/functions/v1',
      body: { mode: 'coach', message: 'Bu haftayı hafiflet', request_id: 'req-stream-001' },
      onReplyText: (text) => partials.push(text),
    });

    expect(res.error).toBeNull();
    expect(partials).toEqual([
      'Harika',
      'Harika bir',
      'Harika bir plan!',
      'Harika bir plan!',
    ]);
    expect(res.data).toEqual({
      reply: 'Harika bir plan!',
      actions: [{ type: 'lighten_week' }],
      balance: 20,
      cost: 5,
    });
  });

  it('classifies premature mid-stream disconnect as isNoAnswer=true so AttemptKeeper preserves request_id for free replay', async () => {
    global.fetch = jest.fn(async () =>
      makeSseResponse([
        'event: delta\ndata: {"reply":"Yarım kalan akış..."}\n\n',
        // Connection drops before event: done or event: error!
      ]),
    ) as unknown as typeof fetch;

    const res = await invokeAiWithStream({
      forceStreamFetchUrl: 'https://example.supabase.co/functions/v1',
      body: { mode: 'coach', message: 'Deneme mesajı', request_id: 'req-drop-001' },
    });

    expect(res.data).toBeNull();
    expect(isNoAnswer(res.error)).toBe(true);
  });

  it('surfaces definite SSE error events (e.g. INSUFFICIENT_CREDITS) with code & balance via extractInvokeError', async () => {
    global.fetch = jest.fn(async () =>
      makeSseResponse([
        'event: error\ndata: {"status":402,"error":"Yetersiz Focus Point","code":"INSUFFICIENT_CREDITS","balance":2}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const res = await invokeAiWithStream({
      forceStreamFetchUrl: 'https://example.supabase.co/functions/v1',
      body: { mode: 'coach', message: 'Plan öner', request_id: 'req-402-001' },
    });

    expect(res.data).toBeNull();
    expect(isNoAnswer(res.error)).toBe(false);
    const parsed = await extractInvokeError(res.error);
    expect(parsed).toEqual({
      msg: 'Yetersiz Focus Point',
      code: 'INSUFFICIENT_CREDITS',
      balance: 2,
    });
  });
});

