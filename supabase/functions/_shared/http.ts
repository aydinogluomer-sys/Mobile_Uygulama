/**
 * Shared HTTP & CORS helpers for Supabase Edge Functions (EDG-05, EDG-14).
 * Pure Web Fetch API (`Request`, `Response`, `TextEncoder`) — zero `Deno.*` globals.
 */

export const ALLOWED_HEADERS =
  'authorization, x-client-info, apikey, content-type, x-supabase-api-version';

const LOCAL_DEV_ORIGIN = 'http://localhost:8081';

/** Returns `null` when unset/blank (meaning wildcard `*`), otherwise trimmed origin list. */
export function parseAllowedOrigins(raw: string | undefined): string[] | null {
  if (!raw) return null;
  const items = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
  return items.length > 0 ? items : null;
}

export function corsHeadersFor(req: Request, allowed: string[] | null): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
  if (allowed === null) {
    return {
      'Access-Control-Allow-Origin': '*',
      ...base,
    };
  }

  const origin = req.headers.get('Origin')?.trim() ?? '';
  if (origin && (allowed.includes(origin) || origin === LOCAL_DEV_ORIGIN)) {
    return {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      ...base,
    };
  }

  return {
    Vary: 'Origin',
    ...base,
  };
}

export function jsonResponse(
  data: unknown,
  status: number,
  cors: Record<string, string>,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

export type JsonBody =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; code: 'BAD_JSON' | 'BODY_TOO_LARGE'; error: string };

export async function readJsonBody(req: Request, maxBytes: number): Promise<JsonBody> {
  const contentLengthRaw = req.headers.get('Content-Length');
  if (contentLengthRaw !== null) {
    const declared = Number(contentLengthRaw);
    if (Number.isFinite(declared) && declared > maxBytes) {
      return {
        ok: false,
        status: 413,
        code: 'BODY_TOO_LARGE',
        error: 'İstek gövdesi çok büyük.',
      };
    }
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'BAD_JSON',
      error: 'Geçersiz JSON gövdesi.',
    };
  }

  const byteLength = new TextEncoder().encode(text).byteLength;
  if (byteLength > maxBytes) {
    return {
      ok: false,
      status: 413,
      code: 'BODY_TOO_LARGE',
      error: 'İstek gövdesi çok büyük.',
    };
  }

  if (!text.trim()) {
    return {
      ok: false,
      status: 400,
      code: 'BAD_JSON',
      error: 'Geçersiz JSON gövdesi.',
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return {
      ok: false,
      status: 400,
      code: 'BAD_JSON',
      error: 'Geçersiz JSON gövdesi.',
    };
  }
}
