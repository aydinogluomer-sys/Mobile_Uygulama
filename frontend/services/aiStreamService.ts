/**
 * SSE Token-Streaming Client for `generate-routine` (`coach`, `summarize`, `insights`).
 *
 * Contract guarantees:
 * 1. Every network call goes directly through `withEdgeDeadline` or `withStreamDeadline`
 *    (`lib/edgeCall.ts`) with zero custom `AbortController` instances (`edgeCallDeadline.test.ts`).
 * 2. Preserves `{ data, error, transport }` shape compatible with `isNoAnswer` (`lib/aiAttempt.ts`)
 *    and `extractInvokeError` (`lib/aiInvoke.ts`):
 *    - Premature stream drop before `done`/`error` -> `FunctionsFetchError` (`isNoAnswer === true`,
 *      preserving `request_id` for zero-cost idempotent replay on resend).
 *    - Definite server error (`event: error` or HTTP 4xx/5xx JSON) -> `FunctionsHttpError`
 *      carrying `context.json()` so `INSUFFICIENT_CREDITS` and `balance` propagate cleanly.
 * 3. Transport selection is explicit via `opts.transport` / `EXPO_PUBLIC_AI_TRANSPORT`
 *    (never inspecting Jest mock internals).
 */
import { withEdgeDeadline, withStreamDeadline } from '../lib/edgeCall';
import { readPublicEnvLoose } from '../lib/env';
import { supabase } from '../lib/supabase';

export type StreamTransport = 'stream' | 'buffered' | 'invoke';

export type SseFrame = {
  event: string;
  data: Record<string, unknown>;
};

export type InvokeStreamOptions = {
  body: Record<string, unknown>;
  label?: string;
  onReplyText?: (partialText: string) => void;
  transport?: 'stream' | 'invoke';
  signal?: AbortSignal;
  /** Force SSE `fetch` URL in streaming tests even if env vars are stubbed. */
  forceStreamFetchUrl?: string;
};

export type InvokeStreamResult = {
  data: Record<string, any> | null;
  error: unknown;
  transport: StreamTransport;
};

type MinimalStreamReader = {
  read(): Promise<{ value?: Uint8Array; done: boolean }>;
  cancel(): Promise<unknown>;
};

type MinimalFetchResponse = {
  ok: boolean;
  status: number;
  headers?: { get?(name: string): string | null };
  body?: { getReader?(): MinimalStreamReader } | null;
  json(): Promise<unknown>;
  text(): Promise<string>;
};

type StreamingFetchFn = (
  url: string,
  init: {
    method: string;
    signal: AbortSignal;
    headers: Record<string, string>;
    body: string;
  },
) => Promise<MinimalFetchResponse>;

function makeHttpError(payload: Record<string, unknown>): Error & { context: { json: () => Promise<Record<string, unknown>> } } {
  const msg = typeof payload.error === 'string' ? payload.error : 'Yanıt alınamadı, tekrar deneyin.';
  const err = new Error(msg) as Error & { name: string; context: { json: () => Promise<Record<string, unknown>> } };
  err.name = 'FunctionsHttpError';
  err.context = { json: async () => payload };
  return err;
}

function makeNoAnswerError(message: string): Error {
  const err = new Error(message);
  err.name = 'FunctionsFetchError';
  return err;
}

let cachedExpoFetch: StreamingFetchFn | null | undefined;

async function resolveStreamingFetch(): Promise<StreamingFetchFn> {
  if (typeof process !== 'undefined' && process.env?.JEST_WORKER_ID) {
    return globalThis.fetch;
  }
  if (cachedExpoFetch === undefined) {
    try {
      const mod = await import('expo/fetch');
      cachedExpoFetch = typeof mod.fetch === 'function' ? mod.fetch : null;
    } catch {
      cachedExpoFetch = null;
    }
  }
  return cachedExpoFetch ?? globalThis.fetch;
}

/**
 * Parses complete `\n\n`-delimited SSE blocks from a buffer, returning parsed
 * frames and any incomplete trailing remainder.
 */
export function drainSseBuffer(buffer: string): { frames: SseFrame[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const frames: SseFrame[] = [];
  let cursor = 0;

  while (true) {
    const boundary = normalized.indexOf('\n\n', cursor);
    if (boundary === -1) break;
    const rawBlock = normalized.slice(cursor, boundary);
    cursor = boundary + 2;

    if (!rawBlock.trim()) continue;
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of rawBlock.split('\n')) {
      if (line.startsWith(':')) continue;
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim() || 'message';
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trim());
      }
    }

    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join('\n'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        frames.push({ event: eventName, data: parsed as Record<string, unknown> });
      }
    } catch {
      /* ignore malformed frame */
    }
  }

  return { frames, rest: normalized.slice(cursor) };
}

export async function invokeAiWithStream(opts: InvokeStreamOptions): Promise<InvokeStreamResult> {
  const label = opts.label ?? 'AI Koç';
  const { url: envUrl, anon: anonKey } = readPublicEnvLoose();
  const SUPABASE_FUNCTIONS_URL =
    opts.forceStreamFetchUrl ??
    (envUrl ? `${envUrl.replace(/\/$/, '')}/functions/v1` : '');

  const desiredTransport: 'stream' | 'invoke' =
    opts.transport ??
    (opts.forceStreamFetchUrl
      ? 'stream'
      : process.env.EXPO_PUBLIC_AI_TRANSPORT === 'invoke'
        ? 'invoke'
        : 'stream');

  const canUseFetchStream =
    desiredTransport === 'stream' &&
    Boolean(SUPABASE_FUNCTIONS_URL) &&
    typeof globalThis.fetch === 'function' &&
    typeof supabase?.auth?.getSession === 'function' &&
    (Boolean(opts.forceStreamFetchUrl) || Boolean(anonKey));

  if (!canUseFetchStream) {
    const { data, error } = await withEdgeDeadline(label, (signal) =>
      supabase.functions.invoke('generate-routine', { signal, body: opts.body }),
    );
    if (!error && !opts.signal?.aborted && data && typeof data === 'object') {
      const fullText =
        typeof (data as Record<string, unknown>).reply === 'string'
          ? ((data as Record<string, unknown>).reply as string)
          : typeof (data as Record<string, unknown>).summary === 'string'
            ? ((data as Record<string, unknown>).summary as string)
            : typeof (data as Record<string, unknown>).insight === 'string'
              ? ((data as Record<string, unknown>).insight as string)
              : '';
      if (fullText && opts.onReplyText) opts.onReplyText(fullText);
    }
    return { data: (data as Record<string, any> | null) ?? null, error, transport: 'invoke' };
  }

  const sessionRes = await supabase.auth.getSession();
  const accessToken = sessionRes?.data?.session?.access_token;
  if (!accessToken) {
    return { data: null, error: makeHttpError({ error: 'Oturum bulunamadı.' }), transport: 'stream' };
  }

  const fetch = await resolveStreamingFetch();

  try {
    return await withStreamDeadline(label, async (signal, touch) => {
      const response = await fetch(`${SUPABASE_FUNCTIONS_URL}/generate-routine`, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream, application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(anonKey ? { apikey: anonKey } : {}),
        },
        body: JSON.stringify({ ...opts.body, stream: true }),
      });
      touch();

      const contentType = (response.headers?.get?.('content-type') ?? '').toLowerCase();

      if (!response.ok) {
        let errBody: Record<string, unknown> = {
          error: `Sunucu hatası (${response.status})`,
        };
        try {
          const parsed = await response.json();
          if (parsed && typeof parsed === 'object') errBody = parsed as Record<string, unknown>;
        } catch {
          /* keep fallback message */
        }
        return { data: null, error: makeHttpError(errBody), transport: 'stream' };
      }

      const emitReply = (text: string) => {
        if (!signal.aborted) opts.onReplyText?.(text);
      };

      if (!contentType.includes('text/event-stream')) {
        const jsonData = (await response.json()) as Record<string, any>;
        touch();
        if (typeof jsonData?.reply === 'string') {
          emitReply(jsonData.reply);
        }
        return { data: jsonData, error: null, transport: 'buffered' };
      }

      let doneData: Record<string, any> | null = null;
      let streamError: unknown = null;
      let accumulatedText = '';

      const handleFrames = (frames: SseFrame[]) => {
        if (signal.aborted) return;
        for (const frame of frames) {
          if (signal.aborted) return;
          if (frame.event === 'delta') {
            if (typeof frame.data.reply === 'string') {
              accumulatedText = frame.data.reply;
              emitReply(accumulatedText);
            } else if (typeof frame.data.text === 'string') {
              accumulatedText += frame.data.text;
              emitReply(accumulatedText);
            }
          } else if (frame.event === 'done') {
            doneData = frame.data as Record<string, any>;
            if (typeof doneData.reply === 'string') {
              emitReply(doneData.reply);
            }
          } else if (frame.event === 'error') {
            streamError = makeHttpError(frame.data);
          }
        }
      };

      const reader = response.body?.getReader?.();
      if (reader) {
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let readerCancelled = false;
        const cancelReaderOnce = async () => {
          if (readerCancelled) return;
          readerCancelled = true;
          try {
            await reader.cancel();
          } catch {
            /* ignore cancel errors */
          }
        };
        const onAbort = () => {
          void cancelReaderOnce();
        };
        if (signal.aborted) {
          await cancelReaderOnce();
          return { data: null, error: makeNoAnswerError('Akış iptal edildi.'), transport: 'stream' };
        }
        signal.addEventListener('abort', onAbort, { once: true });

        try {
          while (!signal.aborted) {
            const { value, done } = await reader.read();
            if (signal.aborted) break;
            touch();
            if (done) break;
            if (value) {
              buffer += decoder.decode(value, { stream: true });
              const drained = drainSseBuffer(buffer);
              buffer = drained.rest;
              handleFrames(drained.frames);
            }
          }
          if (!signal.aborted) {
            buffer += decoder.decode();
            if (buffer.trim()) {
              handleFrames(drainSseBuffer(`${buffer}\n\n`).frames);
            }
          }
        } finally {
          signal.removeEventListener('abort', onAbort);
          await cancelReaderOnce();
        }

        if (signal.aborted) {
          return { data: null, error: makeNoAnswerError('Akış iptal edildi.'), transport: 'stream' };
        }
        if (streamError) return { data: null, error: streamError, transport: 'stream' };
        if (doneData) return { data: doneData, error: null, transport: 'stream' };
        return {
          data: null,
          error: makeNoAnswerError('Akış tamamlanmadan bağlantı kesildi.'),
          transport: 'stream',
        };
      }

      const fullSseText = await response.text();
      touch();
      handleFrames(drainSseBuffer(`${fullSseText}\n\n`).frames);
      if (streamError) return { data: null, error: streamError, transport: 'buffered' };
      if (doneData) return { data: doneData, error: null, transport: 'buffered' };
      return {
        data: null,
        error: makeNoAnswerError('Akış tamamlanmadan bağlantı kesildi.'),
        transport: 'buffered',
      };
    }, { signal: opts.signal });
  } catch (err) {
    return { data: null, error: err, transport: 'stream' };
  }
}
