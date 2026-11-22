import { withEdgeDeadline } from '../lib/edgeCall';
import { supabase } from '../lib/supabase';

/** edgeCallDeadline.test.ts EDGE_CALL düzenli ifadesi bu adı arar. ADINI DEĞİŞTİRME. */
export const SUPABASE_FUNCTIONS_URL: string = process.env.EXPO_PUBLIC_SUPABASE_URL + '/functions/v1';

/** 'session': Authorization: Bearer <access_token> ekler, oturum yoksa EdgeSessionError fırlatır (varsayılan).
 *  'none': hiçbir kimlik başlığı eklemez. YALNIZ notionSessionStore giriş akışı (notion-auth N-03: kullanıcısız state). */
export type EdgeAuth = 'session' | 'none';

export class EdgeSessionError extends Error {
  constructor() {
    super('Oturum açmanız gerekiyor');
    this.name = 'EdgeSessionError';
  }
}

export type EdgeHttpRequest = {
  /** withEdgeDeadline etiketi; kullanıcıya görünen zaman aşımı cümlesine girer ('Notion', 'Spotify', 'Google Takvim'). */
  label: string;
  /** ?action=<action> */
  action?: string;
  /** Ek sorgu parametreleri; değerler encodeURIComponent ile kodlanır (redirect_uri). */
  query?: Record<string, string>;
  /** Varsayılan: body verilmişse 'POST', verilmemişse 'GET'. */
  method?: 'GET' | 'POST';
  /** JSON.stringify edilir; verilirse Content-Type: application/json eklenir. */
  body?: unknown;
  auth?: EdgeAuth;
  /** Varsayılan EDGE_TIMEOUT_MS (20 sn). */
  timeoutMs?: number;
};

export type EdgeHttpResult<T = Record<string, unknown>> = {
  /** HTTP 2xx. */
  ok: boolean;
  status: number;
  /** Ayrıştırılmış JSON; gövde boş veya geçersizse null (yorum store'a aittir: 404 + HTML bir kurulum durumudur). */
  body: T | null;
};

export async function callEdgeFunction<T = Record<string, unknown>>(
  slug: string,
  req: EdgeHttpRequest,
): Promise<EdgeHttpResult<T>> {
  const auth = req.auth ?? 'session';
  const headers: Record<string, string> = {};
  if (auth === 'session') {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new EdgeSessionError();
    headers.Authorization = `Bearer ${session.access_token}`;
  }
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';
  const method = req.method ?? (req.body === undefined ? 'GET' : 'POST');
  const search = [
    ...(req.action ? [`action=${encodeURIComponent(req.action)}`] : []),
    ...Object.entries(req.query ?? {}).map(([k, v]) => `${k}=${encodeURIComponent(v)}`),
  ].join('&');
  const suffix = search ? `?${search}` : '';
  // withEdgeDeadline ve fetch( AYNI satırda: edgeCallDeadline.test.ts "deadline penceresi" kuralı.
  const res = await withEdgeDeadline(req.label, (signal) => fetch(`${SUPABASE_FUNCTIONS_URL}/${slug}${suffix}`, { signal, method, headers, body: req.body === undefined ? undefined : JSON.stringify(req.body) }), req.timeoutMs);
  const body = await res.json().then((j) => j as T, () => null);
  return { ok: res.ok, status: res.status, body };
}

export type EdgeInvokeError = { message: string; name?: string; context?: unknown };
export type EdgeInvokeResult<T = unknown> = { data: T | null; error: EdgeInvokeError | null };

/** supabase-js functions.invoke: kimlik başlığını kütüphane ekler. İstek gövdesi ve hata şekli bugünkü çağrılarla birebir aynıdır. */
export async function invokeEdgeFunction<T = unknown>(
  slug: string,
  req: { label: string; body?: Record<string, unknown> | string; timeoutMs?: number },
): Promise<EdgeInvokeResult<T>> {
  const { data, error } = await withEdgeDeadline(req.label, (signal) =>
    supabase.functions.invoke(slug, { signal, body: req.body }), req.timeoutMs);
  return { data: (data ?? null) as T | null, error: (error ?? null) as EdgeInvokeError | null };
}
