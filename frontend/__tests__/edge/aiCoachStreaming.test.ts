import { readFileSync } from 'fs';
import { join } from 'path';
import { extractPartialReplyFromToolJson } from '../../../supabase/functions/_shared/coachContractSchema';
import { encodeFrame, SSE_EVENTS } from '../../../supabase/functions/_shared/sseFrames';
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

describe('Item #6 & F21 (TST-13) — AI Coach SSE Token Streaming, Byte-Offset Fuzzing & Wire Contract', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('extractPartialReplyFromToolJson satisfies prefix property across EVERY single-char cut point', () => {
    const finalText = 'Harika adım!\nBugün "20 dk" yürüyüş ve \u015fükür notu ekleyebilirim.';
    const full = JSON.stringify({
      reply: finalText,
      actions: [{ type: 'lighten_week' }],
    });

    const snapshots: string[] = [];
    for (let i = 1; i <= full.length; i += 1) {
      const partial = extractPartialReplyFromToolJson(full.slice(0, i));
      if (partial) {
        expect(finalText.startsWith(partial)).toBe(true);
        snapshots.push(partial);
      }
    }
    expect(snapshots[0]).toBe('H');
    expect(snapshots[snapshots.length - 1]).toBe(finalText);
  });

  it('extractPartialReplyFromToolJson holds prefix invariant over 200 seeded PRNG strings (quotes, slashes, newlines, emojis, surrogate pairs)', () => {
    let seed = 0x20260440;
    const nextRand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed;
    };
    const alphabet = [
      'a', 'ğ', 'ş', 'İ', '"', '\\', '\n', '\r', '\t', '/',
      '🔥', '🌱', '🧘‍♀️', '\u0007', '\u2028', '{', '}', '[', ']', ':',
    ];

    for (let t = 0; t < 200; t += 1) {
      const len = 1 + (nextRand() % 40);
      let s = '';
      for (let k = 0; k < len; k += 1) {
        s += alphabet[nextRand() % alphabet.length];
      }
      const rawJson = JSON.stringify({ reply: s, actions: [] });
      for (let cut = 1; cut <= rawJson.length; cut += 1) {
        const partial = extractPartialReplyFromToolJson(rawJson.slice(0, cut));
        if (partial.length > 0) {
          expect(s.startsWith(partial)).toBe(true);
        }
      }
      expect(extractPartialReplyFromToolJson(rawJson)).toBe(s);
    }
  });

  it('encodeFrame round-trips through client drainSseBuffer (including CRLF), and SSE_EVENTS is pinned with client done/error handlers', () => {
    expect([...SSE_EVENTS]).toEqual(['delta', 'done', 'error']);
    const clientSrc = readFileSync(join(__dirname, '..', '..', 'services', 'aiStreamService.ts'), 'utf8');
    for (const ev of SSE_EVENTS) {
      expect(clientSrc).toContain(`frame.event === '${ev}'`);
    }

    const tricky = { reply: 'Satır 1\n"Tırnak" \\ ters bölü 🌱', actions: [{ type: 'lighten_week' }] };
    const wire = encodeFrame('done', tricky);
    expect(drainSseBuffer(wire)).toEqual({
      frames: [{ event: 'done', data: tricky }],
      rest: '',
    });

    const crlfWire = wire.replace(/\n/g, '\r\n');
    expect(drainSseBuffer(crlfWire)).toEqual({
      frames: [{ event: 'done', data: tricky }],
      rest: '',
    });
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
      transport: 'stream',
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

  it('surfaces SSE error frame arriving AFTER delta frames as definite error (not success or no-answer)', async () => {
    const partials: string[] = [];
    global.fetch = jest.fn(async () =>
      makeSseResponse([
        'event: delta\ndata: {"reply":"Başladı ama..."}\n\n',
        'event: error\ndata: {"status":500,"error":"AI yanıtı yarım kaldı, ücret iade edildi."}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const res = await invokeAiWithStream({
      transport: 'stream',
      forceStreamFetchUrl: 'https://example.supabase.co/functions/v1',
      body: { mode: 'coach', message: 'Deneme', request_id: 'req-delta-then-err' },
      onReplyText: (t) => partials.push(t),
    });

    expect(partials).toEqual(['Başladı ama...']);
    expect(res.data).toBeNull();
    expect(isNoAnswer(res.error)).toBe(false);
    const parsed = await extractInvokeError(res.error);
    expect(parsed.msg).toBe('AI yanıtı yarım kaldı, ücret iade edildi.');
  });

  it('classifies premature mid-stream disconnect as isNoAnswer=true so AttemptKeeper preserves request_id for free replay', async () => {
    global.fetch = jest.fn(async () =>
      makeSseResponse([
        'event: delta\ndata: {"reply":"Yarım kalan akış..."}\n\n',
      ]),
    ) as unknown as typeof fetch;

    const res = await invokeAiWithStream({
      transport: 'stream',
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
      transport: 'stream',
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
