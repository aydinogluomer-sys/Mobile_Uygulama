/**
 * SSE Token-Streaming Client for `generate-routine` (`coach`, `summarize`, `insights`).
 *
 * Contract guarantees:
 * 1. Every network call goes directly through `withEdgeDeadline` (`lib/edgeCall.ts`)
 *    with zero custom `AbortController` instances (`edgeCallDeadline.test.ts`).
 * 2. Preserves `{ data, error }` shape compatible with `isNoAnswer` (`lib/aiAttempt.ts`)
 *    and `extractInvokeError` (`lib/aiInvoke.ts`):
 *    - Premature stream drop before `done`/`error` -> `FunctionsFetchError` (`isNoAnswer === true`,
 *      preserving `request_id` for zero-cost idempotent replay on resend).
 *    - Definite server error (`event: error` or HTTP 4xx/5xx JSON) -> `FunctionsHttpError`
 *      carrying `context.json()` so `INSUFFICIENT_CREDITS` and `balance` propagate cleanly.
 * 3. Automatically falls back to `supabase.functions.invoke` when `SUPABASE_FUNCTIONS_URL`
 *    is unavailable, when `supabase.functions.invoke` is mocked in unit tests, or when
 *    streaming is disabled.
 */
import { withEdgeDeadline } from '../lib/edgeCall';
import { readPublicEnvLoose } from '../lib/env';
import { supabase } from '../lib/supabase';

export type SseFrame = {
  event: string;
  data: Record<string, unknown>;
};

export type InvokeStreamOptions = {
  body: Record<string, unknown>;
  label?: string;
  onReplyText?: (partialText: string) => void;
  /** Force SSE `fetch` transport in streaming tests even if env vars are stubbed. */
  forceStreamFetchUrl?: string;
};

export type InvokeStreamResult = {
  data: Record<string, any> | null;
  error: unknown;
};

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

function isJestMockedInvoke(): boolean {
  const fn = supabase?.functions?.invoke as { _isMockFunction?: boolean; mock?: unknown } | undefined;
  return Boolean(fn && (fn._isMockFunction || 'mock' in fn));
}

export async function invokeAiWithStream(opts: InvokeStreamOptions): Promise<InvokeStreamResult> {
  const label = opts.label ?? 'AI Koç';
  // F08 (BLD-02): the one env reader (lib/env.ts); empty when missing, read at call time, never throws
  const { url: envUrl, anon: anonKey } = readPublicEnvLoose();
  const SUPABASE_FUNCTIONS_URL =
    opts.forceStreamFetchUrl ??
    (envUrl ? `${envUrl.replace(/\/$/, '')}/functions/v1` : '');

  const canUseFetchStream =
    Boolean(SUPABASE_FUNCTIONS_URL) &&
    typeof fetch === 'function' &&
    typeof supabase?.auth?.getSession === 'function' &&
    (Boolean(opts.forceStreamFetchUrl) || (Boolean(anonKey) && !isJestMockedInvoke()));

  if (!canUseFetchStream) {
    const { data, error } = await withEdgeDeadline(label, (signal) =>
      supabase.functions.invoke('generate-routine', { signal, body: opts.body }),
    );
    if (!error && data && typeof data === 'object') {
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
    return { data: (data as Record<string, any> | null) ?? null, error };
  }

  const sessionRes = await supabase.auth.getSession();
  const accessToken = sessionRes?.data?.session?.access_token;
  if (!accessToken) {
    return { data: null, error: makeHttpError({ error: 'Oturum bulunamadı.' }) };
  }

  try {
    return await withEdgeDeadline(label, async (signal) => {
      const response = await withEdgeDeadline(label, (innerSignal) =>
        fetch(`${SUPABASE_FUNCTIONS_URL}/generate-routine`, {
          method: 'POST',
          signal: innerSignal ?? signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream, application/json',
            Authorization: `Bearer ${accessToken}`,
            ...(anonKey ? { apikey: anonKey } : {}),
          },
          body: JSON.stringify({ ...opts.body, stream: true }),
        }),
      );

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
        return { data: null, error: makeHttpError(errBody) };
      }

      if (!contentType.includes('text/event-stream')) {
        const jsonData = (await response.json()) as Record<string, any>;
        if (typeof jsonData?.reply === 'string' && opts.onReplyText) {
          opts.onReplyText(jsonData.reply);
        }
        return { data: jsonData, error: null };
      }

      let doneData: Record<string, any> | null = null;
      let streamError: unknown = null;
      let accumulatedText = '';

      const handleFrames = (frames: SseFrame[]) => {
        for (const frame of frames) {
          if (frame.event === 'delta') {
            if (typeof frame.data.reply === 'string') {
              accumulatedText = frame.data.reply;
              opts.onReplyText?.(accumulatedText);
            } else if (typeof frame.data.text === 'string') {
              accumulatedText += frame.data.text;
              opts.onReplyText?.(accumulatedText);
            }
          } else if (frame.event === 'done') {
            doneData = frame.data as Record<string, any>;
            if (typeof doneData.reply === 'string') {
              opts.onReplyText?.(doneData.reply);
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
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            const drained = drainSseBuffer(buffer);
            buffer = drained.rest;
            handleFrames(drained.frames);
          }
        }
        buffer += decoder.decode();
        if (buffer.trim()) {
          handleFrames(drainSseBuffer(`${buffer}\n\n`).frames);
        }
      } else {
        const fullSseText = await response.text();
        handleFrames(drainSseBuffer(`${fullSseText}\n\n`).frames);
      }

      if (streamError) return { data: null, error: streamError };
      if (doneData) return { data: doneData, error: null };
      return {
        data: null,
        error: makeNoAnswerError('Akış tamamlanmadan bağlantı kesildi.'),
      };
    });
  } catch (err) {
    return { data: null, error: err };
  }
}

