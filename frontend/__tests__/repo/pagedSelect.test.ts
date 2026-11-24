/**
 * F20 (SYN-06 / REP-04) — PostgREST satır tavanından bağımsız sayfalama yardımcıları.
 * Okumalar "kısa sayfa"da değil YALNIZ boş sayfada biter; tavan aşılırsa `truncated: true` döner.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import {
  DEFAULT_MAX_ROWS,
  MIN_SERVER_CAP,
  PAGE_ROWS,
  SERVER_MAX_ROWS,
  keysetAll,
  requireComplete,
  selectAllPages,
} from '../../repositories/pagedSelect';

type Item = { id: string; idx: number };

function makeItems(count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${String(i).padStart(6, '0')}`,
    idx: i,
  }));
}

function parseMaxRowsFromToml(tomlText: string): number | null {
  const apiMatch = /\[api\]([\s\S]*?)(?:\n\[|$)/.exec(tomlText);
  if (!apiMatch) return null;
  const rowMatch = /^\s*max_rows\s*=\s*(\d+)/m.exec(apiMatch[1]);
  return rowMatch ? Number(rowMatch[1]) : null;
}

describe('selectAllPages ve keysetAll — pozitif vakalar', () => {
  it('1500 satırlık kaynakta 500 sayfa boyutuyla 4 istekte 1500 satır ve truncated=false döner', async () => {
    const source = makeItems(1500);
    let rangeCalls = 0;
    const rangeRes = await selectAllPages<Item>(async (from, to) => {
      rangeCalls += 1;
      const count = Math.min(SERVER_MAX_ROWS, to - from + 1);
      return { data: source.slice(from, from + count), error: null, status: 200 };
    });
    expect(rangeRes.ok).toBe(true);
    if (!rangeRes.ok) return;
    expect(rangeCalls).toBe(4);
    expect(rangeRes.data.truncated).toBe(false);
    expect(rangeRes.data.rows).toHaveLength(1500);
    expect(rangeRes.data.rows.map((r) => r.idx)).toEqual(source.map((r) => r.idx));

    let keysetCalls = 0;
    const keysetRes = await keysetAll<Item>(async (afterId, limit) => {
      keysetCalls += 1;
      const filtered = afterId === null ? source : source.filter((r) => r.id > afterId);
      return { data: filtered.slice(0, Math.min(limit, SERVER_MAX_ROWS)), error: null, status: 200 };
    });
    expect(keysetRes.ok).toBe(true);
    if (!keysetRes.ok) return;
    expect(keysetCalls).toBe(4);
    expect(keysetRes.data.truncated).toBe(false);
    expect(keysetRes.data.rows).toHaveLength(1500);
    expect(keysetRes.data.rows.map((r) => r.idx)).toEqual(source.map((r) => r.idx));
  });

  it('canlı sunucu tavanı 100 iken (pageSize=500 üstünde kesildiğinde) her iki yardımcı da 1234 satırı eksiksiz ve tekrarsız döner', async () => {
    const source = makeItems(1234);
    const liveCap = 100;

    const rangeRes = await selectAllPages<Item>(async (from, to) => {
      const requested = to - from + 1;
      const slice = source.slice(from, from + Math.min(requested, liveCap));
      return { data: slice, error: null, status: 200 };
    }, { pageSize: PAGE_ROWS });

    expect(rangeRes.ok).toBe(true);
    if (!rangeRes.ok) return;
    expect(rangeRes.data.truncated).toBe(false);
    expect(rangeRes.data.rows.map((r) => r.idx)).toEqual(source.map((r) => r.idx));

    const keysetRes = await keysetAll<Item>(async (afterId, limit) => {
      const filtered = afterId === null ? source : source.filter((r) => r.id > afterId);
      return { data: filtered.slice(0, Math.min(limit, liveCap)), error: null, status: 200 };
    }, { pageSize: PAGE_ROWS });

    expect(keysetRes.ok).toBe(true);
    if (!keysetRes.ok) return;
    expect(keysetRes.data.truncated).toBe(false);
    expect(keysetRes.data.rows.map((r) => r.idx)).toEqual(source.map((r) => r.idx));
  });

  it('maxRows tam satır sayısına eşitse truncated=false, bir fazlası varsa truncated=true; requireComplete doğru sarmalar', async () => {
    const exactSource = makeItems(100);
    const exact = await selectAllPages<Item>(
      async (from, to) => ({ data: exactSource.slice(from, to + 1), error: null, status: 200 }),
      { pageSize: 50, maxRows: 100 },
    );
    expect(exact).toEqual({ ok: true, data: { rows: exactSource, truncated: false } });
    const unwrappedOk = requireComplete(exact, 'Test koleksiyonu');
    expect(unwrappedOk).toEqual({ ok: true, data: exactSource });

    const overSource = makeItems(101);
    const over = await keysetAll<Item>(
      async (afterId, limit) => {
        const filtered = afterId === null ? overSource : overSource.filter((r) => r.id > afterId);
        return { data: filtered.slice(0, limit), error: null, status: 200 };
      },
      { pageSize: 50, maxRows: 100 },
    );
    expect(over.ok).toBe(true);
    if (!over.ok) return;
    expect(over.data.truncated).toBe(true);
    expect(over.data.rows).toHaveLength(100);

    const unwrappedOver = requireComplete(over, 'Isı haritası');
    expect(unwrappedOver.ok).toBe(false);
    if (!unwrappedOver.ok) {
      expect(unwrappedOver.code).toBe('TOO_LARGE');
      expect(unwrappedOver.error).toContain('Isı haritası');
    }
  });
});

describe('selectAllPages ve keysetAll — negatif vakalar', () => {
  it('sunucu range ve gt süzgeçlerini yok sayıp hep aynı sayfayı dönerse döngü güvenlik sınırında sonlanır', async () => {
    const stuckPage = makeItems(10);
    const maxRows = 200;
    const maxAllowedRequests = Math.ceil(maxRows / MIN_SERVER_CAP) + 2;

    let rangeCalls = 0;
    const rangeRes = await selectAllPages<Item>(async () => {
      rangeCalls += 1;
      return { data: stuckPage, error: null, status: 200 };
    }, { pageSize: 50, maxRows });
    expect(rangeRes.ok).toBe(true);
    if (rangeRes.ok) {
      expect(rangeRes.data.truncated).toBe(true);
      expect(rangeRes.data.rows.length).toBeLessThanOrEqual(maxRows);
    }
    expect(rangeCalls).toBeLessThanOrEqual(maxAllowedRequests);

    let keysetCalls = 0;
    const keysetRes = await keysetAll<Item>(async () => {
      keysetCalls += 1;
      return { data: stuckPage, error: null, status: 200 };
    }, { pageSize: 50, maxRows });
    expect(keysetRes.ok).toBe(true);
    if (keysetRes.ok) {
      expect(keysetRes.data.truncated).toBe(true);
    }
    expect(keysetCalls).toBeLessThanOrEqual(maxAllowedRequests);
  });

  it('ilk sayfada hata varsa ok: false ve doğru offline bayrağı döner', async () => {
    const netErr = await selectAllPages<Item>(async () => ({
      data: null,
      error: { message: 'TypeError: Network request failed', code: '' },
      status: 0,
    }));
    expect(netErr).toEqual({
      ok: false,
      error: 'TypeError: Network request failed',
      code: '',
      status: 0,
      offline: true,
    });

    const dbErr = await keysetAll<Item>(async () => ({
      data: null,
      error: { message: 'permission denied', code: '42501' },
      status: 403,
    }));
    expect(dbErr).toEqual({
      ok: false,
      error: 'permission denied',
      code: '42501',
      status: 403,
      offline: false,
    });

    expect(DEFAULT_MAX_ROWS).toBe(100_000);
  });
});

describe('kaynak taraması — config.toml ve depo sınırları', () => {
  const ROOT = join(__dirname, '..', '..');
  const REPO = join(ROOT, '..');

  it('supabase/config.toml [api] max_rows değeri SERVER_MAX_ROWS ile eşittir', () => {
    const toml = readFileSync(join(REPO, 'supabase', 'config.toml'), 'utf8');
    expect(parseMaxRowsFromToml(toml)).toBe(SERVER_MAX_ROWS);
    // Negatif kontrol: config değişirse ayrıştırıcı farkı yakalar
    expect(parseMaxRowsFromToml('[api]\nmax_rows = 500\n')).not.toBe(SERVER_MAX_ROWS);
  });

  it('restoreRepository ve exportRepository keysetAll kullanır ve yazma sınırlarını korur', () => {
    const restoreRepo = stripComments(readFileSync(join(ROOT, 'repositories', 'restoreRepository.ts'), 'utf8'));
    const exportRepo = stripComments(readFileSync(join(ROOT, 'repositories', 'exportRepository.ts'), 'utf8'));

    expect(restoreRepo).toContain('keysetAll');
    expect(exportRepo).toContain('keysetAll');

    expect(exportRepo).not.toMatch(/\.\s*(insert|update|upsert|delete)\s*\(/);
    expect(restoreRepo).not.toMatch(/\.\s*(update|upsert|delete)\s*\(/);
    expect(restoreRepo).not.toMatch(/'habit_logs'|'focus_sessions'|'webhooks'/);
  });
});
