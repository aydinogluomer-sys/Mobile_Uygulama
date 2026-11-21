/**
 * F20 (SYN-06 / REP-04) — PostgREST sunucu satır tavanından bağımsız sayfalama.
 *
 * Okumalar "istenen sayfa boyutundan kısa yanıt"ta değil YALNIZ boş sayfada biter;
 * böylece canlı projedeki `max_rows` sayfa boyutundan küçük olsa bile hiçbir satır
 * sessizce düşmez. Mantıksal üst sınır (`maxRows`) aşılırsa `truncated: true` döner.
 */
import { isTransportFailure, type RepoResult } from './shared';

/** supabase/config.toml [api] max_rows. pagedSelect.test.ts config.toml'u okuyup bu sayıyla karşılaştırır. */
export const SERVER_MAX_ROWS = 1000;
/** Bilerek tavanın altında: canlı tavan daha küçük olsa bile okuma BOŞ sayfada biter, kısa sayfada değil. */
export const PAGE_ROWS = 500;
/** Tek mantıksal okumanın tavanı; aşılırsa çağıran bilgilendirilir, sessizce kesilmez. */
export const DEFAULT_MAX_ROWS = 100_000;
/** Makul bir sunucu tavanının alt sınırı; yalnız istek sayısı güvenlik tavanını hesaplamak içindir. */
export const MIN_SERVER_CAP = 50;

export type PagedRows<T> = { rows: T[]; truncated: boolean };
export type PageResponse<T> = {
  data: T[] | null;
  error: { message: string; code?: string | null } | null;
  status?: number;
};
export type PageOptions = { pageSize?: number; maxRows?: number };

/** Aralık (offset) tabanlı: sıralama KESİN olmalı (son anahtar `id`). Boş sayfada biter. */
export async function selectAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResponse<T>>,
  opts: PageOptions = {},
): Promise<RepoResult<PagedRows<T>>> {
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? PAGE_ROWS, SERVER_MAX_ROWS));
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const maxRequests = Math.ceil(maxRows / MIN_SERVER_CAP) + 2;
  const rows: T[] = [];
  let from = 0;

  for (let request = 0; request < maxRequests; request += 1) {
    const { data, error, status } = await build(from, from + pageSize - 1);
    if (error) {
      return {
        ok: false,
        error: error.message,
        code: error.code ?? undefined,
        status,
        offline: isTransportFailure(status, error),
      };
    }
    const got = data ?? [];
    if (got.length === 0) {
      return { ok: true, data: { rows, truncated: false } };
    }
    rows.push(...got);
    from += got.length;
    if (rows.length > maxRows) {
      return { ok: true, data: { rows: rows.slice(0, maxRows), truncated: true } };
    }
  }

  return { ok: true, data: { rows: rows.slice(0, maxRows), truncated: true } };
}

/** `id` anahtar-kümeli: eşzamanlı ekleme/silmede satır atlamaz ya da tekrarlamaz. Boş sayfada biter. */
export async function keysetAll<T extends Record<string, unknown>>(
  build: (afterId: string | null, limit: number) => PromiseLike<PageResponse<T>>,
  opts: PageOptions = {},
): Promise<RepoResult<PagedRows<T>>> {
  const pageSize = Math.max(1, Math.min(opts.pageSize ?? PAGE_ROWS, SERVER_MAX_ROWS));
  const maxRows = opts.maxRows ?? DEFAULT_MAX_ROWS;
  const maxRequests = Math.ceil(maxRows / MIN_SERVER_CAP) + 2;
  const rows: T[] = [];
  let after: string | null = null;

  for (let request = 0; request < maxRequests; request += 1) {
    const { data, error, status } = await build(after, pageSize);
    if (error) {
      return {
        ok: false,
        error: error.message,
        code: error.code ?? undefined,
        status,
        offline: isTransportFailure(status, error),
      };
    }
    const got = data ?? [];
    if (got.length === 0) {
      return { ok: true, data: { rows, truncated: false } };
    }
    rows.push(...got);
    if (rows.length > maxRows) {
      return { ok: true, data: { rows: rows.slice(0, maxRows), truncated: true } };
    }
    const next = String(got[got.length - 1].id);
    if (next === after) {
      return { ok: true, data: { rows, truncated: true } };
    }
    after = next;
  }

  return { ok: true, data: { rows: rows.slice(0, maxRows), truncated: true } };
}

/** `truncated` ise `{ ok: false, code: 'TOO_LARGE' }`, değilse satırlar: eksik veriyi "tam" diye döndürmeyen sarmalayıcı. */
export function requireComplete<T>(r: RepoResult<PagedRows<T>>, what: string): RepoResult<T[]> {
  if (!r.ok) return r;
  if (r.data.truncated) {
    return {
      ok: false,
      error: `${what} kayıt sınırını aştığı için tam okunamadı.`,
      code: 'TOO_LARGE',
    };
  }
  return { ok: true, data: r.data.rows };
}
