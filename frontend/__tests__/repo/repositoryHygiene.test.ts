/**
 * F12 (REP-16, REP-18, REP-19, REP-20) — Repository katmanı sorgu hijyeni:
 * açık sütun listeleri ve canlı şema eşitliği, paralel okuma sayımı,
 * analitik sınırı, tek fiyat kaynağı, ölü dışa aktarım temizliği ve
 * AI mesajlarında user_id savunma derinliği + bileşik sayfa imleci.
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '../helpers/sourceText';
import { buildSchemaModel } from '../helpers/sqlSchemaParser';

const mockTransport = {
  session: { user: { id: 'u1' }, access_token: 'jwt' } as { user: { id: string }; access_token: string } | null,
  fromImpl: ((table: string): unknown => {
    throw new Error(`Unexpected supabase.from(${table}) call`);
  }) as (table: string) => unknown,
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(async () => ({ data: { session: mockTransport.session } })),
    },
    from: (table: string) => mockTransport.fromImpl(table),
  },
}));

import { ACTION_COST } from '../../lib/subscription';
import {
  fetchMessagesPage,
  insertMessage,
} from '../../repositories/aiConversationRepository';
import {
  FOCUS_SESSION_EXPORT_COLUMNS,
  fetchAllFocusSessions,
} from '../../repositories/focusSessionRepository';
import {
  FOCUS_TASK_COLUMNS,
  FOCUS_TASK_PROGRESS_COLUMNS,
  fetchAllFocusTasks,
} from '../../repositories/focusTaskRepository';
import { JOURNAL_INSIGHT_COLUMNS } from '../../repositories/journalInsightRepository';
import { JOURNAL_ENTRY_COLUMNS } from '../../repositories/journalRepository';
import { LIFE_AREA_LOG_COLUMNS } from '../../repositories/lifeAreaRepository';
import { fetchReadingCounts } from '../../repositories/readingListRepository';
import { WEEKLY_REVIEW_COLUMNS } from '../../repositories/reviewRepository';
import { WILLPOWER_STATE_COLUMNS } from '../../repositories/willpowerRepository';
import { COST } from '../../services/focusPointService';

const ROOT = join(__dirname, '..', '..');
const REPO_ROOT = join(ROOT, '..');

function walkProductionTs(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules' || name === '.expo' || name === 'dist' || name === 'coverage') {
      continue;
    }
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkProductionTs(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const liveSchemaSql = readFileSync(join(REPO_ROOT, 'supabase', 'live_schema.sql'), 'utf8');
const liveModel = buildSchemaModel([{ label: 'live', file: 'supabase/live_schema.sql', text: liveSchemaSql }]);

function parseColumnConstant(cols: string): string[] {
  if (cols.trim().length === 0) {
    throw new Error('Expected non-empty column list string');
  }
  return cols.split(',').map((c) => c.trim());
}

function exactColumnProblems(selected: readonly string[], liveCols: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const c of selected) {
    if (seen.has(c)) problems.push(`duplicate:${c}`);
    seen.add(c);
    if (!liveCols.has(c)) problems.push(`extra:${c}`);
  }
  for (const liveCol of liveCols) {
    if (!seen.has(liveCol)) problems.push(`missing:${liveCol}`);
  }
  return problems;
}

function parseServerCostLiteral(edgeSrc: string): Record<string, number> {
  const m = /const\s+COST\s*=\s*\{([^}]+)\}\s*as\s+const/.exec(edgeSrc);
  if (!m) throw new Error('generate-routine COST literal not found');
  const out: Record<string, number> = {};
  for (const part of m[1].split(',')) {
    const kv = /^\s*([a-z_]+)\s*:\s*(\d+)\s*$/i.exec(part);
    if (kv) out[kv[1]] = Number(kv[2]);
  }
  return out;
}

function priceMismatch(client: Record<string, number>, server: Record<string, number>): string[] {
  const keys = new Set([...Object.keys(client), ...Object.keys(server)]);
  const diffs: string[] = [];
  for (const k of [...keys].sort()) {
    if (client[k] !== server[k]) diffs.push(`${k}: client=${String(client[k])} vs server=${String(server[k])}`);
  }
  return diffs;
}

beforeEach(() => {
  mockTransport.session = { user: { id: 'u1' }, access_token: 'jwt' };
  mockTransport.fromImpl = (table: string) => {
    throw new Error(`Unexpected supabase.from(${table}) call`);
  };
});

describe('1. REP-16 — Açık sütun listeleri, canlı şema uyumu ve paralel sayım', () => {
  /**
   * İzin listesi yalnız küçülebilir:
   * - profileRepository.ts: F03 liderlik RPC'si ve F15 time_zone ile çakışmaması için dışarıda (en çok 4)
   * - routineRepository.ts: mevcut 1 okuma
   * - restoreRepository.ts: genel tablo geri yükleme okuyucusu (1)
   * - exportRepository.ts: F20 fetchFullTable genel tablo yedek okuyucusu (1)
   * - shared.ts: F11 sahibi olduğu `params.columns ?? '*'` varsayılanı (1)
   */
  const STAR_SELECT_CEILINGS: Readonly<Record<string, number>> = {
    'profileRepository.ts': 4,
    'routineRepository.ts': 1,
    'restoreRepository.ts': 1,
    'exportRepository.ts': 1,
    'shared.ts': 1,
  };

  it('(a) repositories/*.ts içinde .select("*"), .select() ve = "*" yalnız izin listesindedir ve tavanı aşmaz', () => {
    const starPattern = /\.select\(\s*(?:['"]\*['"]\s*(?:,|\))|\))|=\s*['"]\*['"]|\?\?\s*['"]\*['"]/g;
    const repoDir = join(ROOT, 'repositories');
    const violations: string[] = [];

    for (const file of readdirSync(repoDir).filter((f) => f.endsWith('.ts'))) {
      const code = stripComments(readFileSync(join(repoDir, file), 'utf8'));
      const count = (code.match(starPattern) ?? []).length;
      if (count === 0) continue;
      const ceiling = STAR_SELECT_CEILINGS[file];
      if (ceiling === undefined) {
        violations.push(`${file}: unexpected wildcard/bare select (${count})`);
      } else if (count > ceiling) {
        violations.push(`${file}: count ${count} exceeds ceiling ${ceiling}`);
      }
    }

    expect(violations).toEqual([]);
  });

  const COLUMN_SPECS: readonly { exportName: string; value: string; table: string; fullTable?: boolean }[] = [
    { exportName: 'JOURNAL_ENTRY_COLUMNS', value: JOURNAL_ENTRY_COLUMNS, table: 'journal_entries' },
    { exportName: 'JOURNAL_INSIGHT_COLUMNS', value: JOURNAL_INSIGHT_COLUMNS, table: 'journal_insights' },
    { exportName: 'WEEKLY_REVIEW_COLUMNS', value: WEEKLY_REVIEW_COLUMNS, table: 'weekly_reviews' },
    { exportName: 'LIFE_AREA_LOG_COLUMNS', value: LIFE_AREA_LOG_COLUMNS, table: 'life_area_logs' },
    { exportName: 'WILLPOWER_STATE_COLUMNS', value: WILLPOWER_STATE_COLUMNS, table: 'willpower_state' },
    { exportName: 'FOCUS_TASK_COLUMNS', value: FOCUS_TASK_COLUMNS, table: 'focus_tasks', fullTable: true },
    { exportName: 'FOCUS_TASK_PROGRESS_COLUMNS', value: FOCUS_TASK_PROGRESS_COLUMNS, table: 'focus_tasks' },
    { exportName: 'FOCUS_SESSION_EXPORT_COLUMNS', value: FOCUS_SESSION_EXPORT_COLUMNS, table: 'focus_sessions', fullTable: true },
  ];

  it.each(COLUMN_SPECS)(
    '(b) $exportName sabiti canlı $table tablosunun gerçek sütunlarının alt kümesidir',
    ({ value, table }) => {
      const cols = parseColumnConstant(value);
      const tbl = liveModel.tables.get(table);
      expect(tbl).toBeDefined();
      const liveCols = new Set(tbl!.columns.keys());
      const unknownCols = cols.filter((c) => !liveCols.has(c));
      expect(unknownCols).toEqual([]);
      expect(new Set(cols).size).toBe(cols.length);
    },
  );

  it('(c) FOCUS_TASK_COLUMNS ve FOCUS_SESSION_EXPORT_COLUMNS canlı tablonun TÜM sütunlarına eşittir (+ olumsuz kontrol)', () => {
    for (const spec of COLUMN_SPECS.filter((s) => s.fullTable)) {
      const cols = parseColumnConstant(spec.value);
      const liveCols = new Set(liveModel.tables.get(spec.table)!.columns.keys());
      expect(exactColumnProblems(cols, liveCols)).toEqual([]);
    }

    // Olumsuz kontrol: color silinirse eksik sütun yakalanır
    const focusTaskLiveCols = new Set(liveModel.tables.get('focus_tasks')!.columns.keys());
    const withoutColor = [...focusTaskLiveCols].filter((c) => c !== 'color');
    expect(exactColumnProblems(withoutColor, focusTaskLiveCols)).toEqual(['missing:color']);
  });

  it('(d) fetchReadingCounts üç sorguyu ilk yanıttan ÖNCE paralel başlatır ve ilk hatayı durum sırasıyla döndürür', async () => {
    type PendingCount = {
      statusFilter: string;
      resolve: (res: { count: number | null; error: { message: string; code?: string } | null; status?: number }) => void;
    };
    let pending: PendingCount[] = [];

    mockTransport.fromImpl = (table: string) => {
      expect(table).toBe('reading_list');
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return q;
        },
        then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
          new Promise((resolve) => {
            pending.push({
              statusFilter: String(filters.status ?? ''),
              resolve: resolve as PendingCount['resolve'],
            });
          }).then(onOk, onErr),
      };
      return q;
    };

    // 1) Başarı: üç sorgu da ilk yanıt verilmeden önce başlatılmış olmalı
    pending = [];
    const pOk = fetchReadingCounts();
    await new Promise((r) => setTimeout(r, 0));
    expect(pending.map((p) => p.statusFilter)).toEqual(['want_to_read', 'reading', 'completed']);
    pending[0].resolve({ count: 4, error: null, status: 200 });
    pending[1].resolve({ count: 2, error: null, status: 200 });
    pending[2].resolve({ count: 9, error: null, status: 200 });
    await expect(pOk).resolves.toEqual({
      ok: true,
      data: { want_to_read: 4, reading: 2, completed: 9 },
    });

    // 2) Hata: ikinci durum ('reading') hatası durum sırasıyla ilk hata olarak offline/status/code ile döner
    pending = [];
    const pErr = fetchReadingCounts();
    await new Promise((r) => setTimeout(r, 0));
    expect(pending).toHaveLength(3);
    pending[0].resolve({ count: 1, error: null, status: 200 });
    pending[1].resolve({
      count: null,
      error: { message: 'TypeError: Network request failed', code: 'PGRST000' },
      status: 0,
    });
    pending[2].resolve({
      count: null,
      error: { message: 'ikincil hata', code: '50000' },
      status: 500,
    });
    await expect(pErr).resolves.toEqual({
      ok: false,
      error: 'TypeError: Network request failed',
      offline: true,
      status: 0,
      code: 'PGRST000',
    });
  });
});

describe('2. REP-18 — Analitik katman sınırı ve tek istemci fiyat kaynağı', () => {
  it('repositories/*.ts hiçbir dosyada lib/analytics içe aktarmaz; services/reviewService.ts içe aktarır', () => {
    const repoDir = join(ROOT, 'repositories');
    const offenders = readdirSync(repoDir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => stripComments(readFileSync(join(repoDir, f), 'utf8')).includes('lib/analytics'));
    expect(offenders).toEqual([]);

    const reviewSvc = stripComments(readFileSync(join(ROOT, 'services', 'reviewService.ts'), 'utf8'));
    expect(reviewSvc).toContain('lib/analytics');
  });

  it('focusPointService.COST === ACTION_COST ve sunucu generate-routine COST literaliyle birebir eşittir (+ olumsuz kontrol)', () => {
    expect(COST).toBe(ACTION_COST);

    const { edgeSource } = require('../helpers/edgeSource') as typeof import('../helpers/edgeSource');
    const edgeSrc = stripComments(edgeSource('generate-routine'));
    const serverCost = parseServerCostLiteral(edgeSrc);
    expect(priceMismatch(ACTION_COST, serverCost)).toEqual([]);

    // Olumsuz kontrol: sunucu literalinde bir değer değişirse yardımcı yakalar
    const mutatedServer = parseServerCostLiteral(
      'const COST = { coach: 5, routine: 99, summarize: 3, insights: 5 } as const;',
    );
    expect(priceMismatch(ACTION_COST, mutatedServer)).toEqual(['routine: client=25 vs server=99']);
  });
});

describe('3. REP-19 — Ölü dışa aktarımlar silinmiş, korunanlar yerinde', () => {
  /**
   * Not (F12 adım 2 ön doğrulaması): `services/taskService.ts` içindeki `setCompleted`,
   * F05 tarafından eklenen `__tests__/services/webhookDispatchOnce.test.ts:49,297` içinde
   * çağrıldığı için F12 kuralı ("bir önceki faz başvuru eklediyse o dışa aktarım silinmez")
   * gereği bilinçli korunmuştur. `services/webhookService.ts` içindeki `toggleWebhook` ise
   * F05 tarafından silinmiş ve yokluğu `webhookDispatchOnce.test.ts:321` ile kilitlenmiştir.
   */
  const REMOVED_EXPORTS = [
    'deleteThread',
    'patchBadHabit',
    'removeBadHabit',
    'interpretSpend',
    'SpendOutcome',
    'isOverdue',
    'loadPeriodReview',
    'createTask',
    'patchTask',
    'insertFocusSession',
    'setFocusTaskProgress',
    'fetchFocusSecondsForReview',
    'ReviewFocusSecondsRow',
  ] as const;

  const PRESERVED_EXPORTS = [
    'deleteConversation',
    'updateBadHabit',
    'deleteBadHabit',
    'insertFocusSessionRow',
  ] as const;

  const prodFiles = walkProductionTs(ROOT).map((full) => ({
    rel: relative(ROOT, full).split(sep).join('/'),
    code: stripComments(readFileSync(full, 'utf8')),
  }));

  function filesExporting(symbol: string): string[] {
    const re = new RegExp(
      `\\bexport\\s+(?:async\\s+)?(?:function|const|let|type|interface|class)\\s+${symbol}\\b|\\bexport\\s*(?:type\\s*)?\\{[^}]*\\b${symbol}\\b`,
    );
    return prodFiles.filter((f) => re.test(f.code)).map((f) => f.rel);
  }

  it.each(REMOVED_EXPORTS)('silinen dışa aktarım üretim kodunda yoktur: %s', (name) => {
    expect(filesExporting(name)).toEqual([]);
  });

  it.each(PRESERVED_EXPORTS)('korunan dışa aktarım hâlâ mevcuttur: %s', (name) => {
    expect(filesExporting(name).length).toBeGreaterThanOrEqual(1);
  });
});

describe('4. REP-20 — aiConversationRepository user_id savunma derinliği ve bileşik MessageCursor', () => {
  it('(a) 23505 sonrası geri okuma .eq("user_id", "u1") uygular; başka kullanıcının satırını DÖNDÜRMEZ', async () => {
    const seenEqs: [string, unknown][][] = [];

    mockTransport.fromImpl = (table: string) => {
      expect(table).toBe('ai_messages');
      return {
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: { message: 'duplicate key value', code: '23505' },
            }),
          }),
        }),
        select: () => {
          const eqs: [string, unknown][] = [];
          const q = {
            eq: (col: string, val: unknown) => {
              eqs.push([col, val]);
              return q;
            },
            maybeSingle: async () => {
              seenEqs.push([...eqs]);
              const foreignRow: Record<string, unknown> = {
                id: 'm-foreign',
                conversation_id: 'c1',
                user_id: 'u2',
                role: 'assistant',
                content: 'başkasının yanıtı',
                request_id: 'req-dup',
                created_at: '2026-10-01T12:00:00.000Z',
              };
              const matched = eqs.every(([c, v]) => foreignRow[c] === v);
              return { data: matched ? foreignRow : null, error: null };
            },
          };
          return q;
        },
      };
    };

    const res = await insertMessage({
      conversationId: 'c1',
      role: 'assistant',
      content: 'yanıt',
      requestId: 'req-dup',
    });
    expect(res.ok).toBe(false);
    expect(seenEqs.length).toBeGreaterThanOrEqual(1);
    for (const eqList of seenEqs) {
      expect(eqList).toContainEqual(['user_id', 'u1']);
    }
  });

  it('(b) aynı created_at değerli 3 mesaj bileşik MessageCursor ile kayıpsız sayfa sayfa okunur ve (c) geçersiz imleç reddedilir', async () => {
    const TS = '2026-10-01T12:00:00.000Z';
    const ID_A = '00000000-0000-4000-8000-00000000000a';
    const ID_B = '00000000-0000-4000-8000-00000000000b';
    const ID_C = '00000000-0000-4000-8000-00000000000c';
    const allMessages = [
      { id: ID_B, conversation_id: 'c1', user_id: 'u1', role: 'user', content: 'M-b', request_id: null, created_at: TS },
      { id: ID_A, conversation_id: 'c1', user_id: 'u1', role: 'user', content: 'M-a', request_id: null, created_at: TS },
      { id: ID_C, conversation_id: 'c1', user_id: 'u1', role: 'assistant', content: 'M-c', request_id: null, created_at: TS },
    ];

    const recordedOrs: string[] = [];
    let queryCount = 0;

    mockTransport.fromImpl = () => {
      queryCount += 1;
      let orExpr: string | null = null;
      let limitN = 100;
      const eqs: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => {
          eqs[c] = v;
          return q;
        },
        order: () => q,
        limit: (n: number) => {
          limitN = n;
          return q;
        },
        or: (expr: string) => {
          orExpr = expr;
          recordedOrs.push(expr);
          return q;
        },
        lt: () => {
          orExpr = '__LEGACY_LT_ALL_DROPPED__';
          return q;
        },
        then: (onOk: (v: unknown) => unknown) => {
          let rows = allMessages
            .filter((m) => Object.entries(eqs).every(([k, v]) => (m as Record<string, unknown>)[k] === v))
            .sort((x, y) => {
              if (x.created_at !== y.created_at) return x.created_at < y.created_at ? 1 : -1;
              return x.id < y.id ? 1 : -1;
            });

          if (orExpr === '__LEGACY_LT_ALL_DROPPED__') {
            rows = [];
          } else if (orExpr) {
            const m = /^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^)]+)\)$/.exec(orExpr);
            if (!m || m[1] !== m[2]) throw new Error(`Unexpected or() cursor expression: ${orExpr}`);
            const [, cursorTs, , cursorId] = m;
            rows = rows.filter(
              (r) => r.created_at < cursorTs || (r.created_at === cursorTs && r.id < cursorId),
            );
          }
          return Promise.resolve({ data: rows.slice(0, limitN), error: null }).then(onOk);
        },
      };
      return q;
    };

    // id DESC sırası: ID_C -> ID_B -> ID_A
    const p1 = await fetchMessagesPage('c1', null, 1);
    expect(p1.ok).toBe(true);
    if (!p1.ok) return;
    expect(p1.data.rows.map((r) => r.id)).toEqual([ID_C]);
    expect(p1.data.hasMore).toBe(true);

    const p2 = await fetchMessagesPage('c1', { createdAt: TS, id: ID_C }, 1);
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    expect(p2.data.rows.map((r) => r.id)).toEqual([ID_B]);
    expect(p2.data.hasMore).toBe(true);
    expect(recordedOrs[0]).toBe(`created_at.lt.${TS},and(created_at.eq.${TS},id.lt.${ID_C})`);

    const p3 = await fetchMessagesPage('c1', { createdAt: TS, id: ID_B }, 1);
    expect(p3.ok).toBe(true);
    if (!p3.ok) return;
    expect(p3.data.rows.map((r) => r.id)).toEqual([ID_A]);
    expect(p3.data.hasMore).toBe(false);

    // (c) Geçersiz imleç: sorgu atılmadan reddedilir
    const beforeInvalidCount = queryCount;
    const badTs = await fetchMessagesPage('c1', { createdAt: 'x,or(1=1', id: ID_A }, 1);
    expect(badTs).toEqual({ ok: false, error: 'Geçersiz sayfa imleci.' });
    const badId = await fetchMessagesPage('c1', { createdAt: TS, id: 'not-a-uuid' }, 1);
    expect(badId).toEqual({ ok: false, error: 'Geçersiz sayfa imleci.' });
    expect(queryCount).toBe(beforeInvalidCount);
  });
});

describe('5. İhracat bütünlüğü (fetchAllFocusSessions ve fetchAllFocusTasks)', () => {
  it('fetchAllFocusSessions ve fetchAllFocusTasks açık *_COLUMNS sabitini seçer ve satırları eksiksiz döndürür', async () => {
    const selectedByTable: Record<string, string[]> = {};
    const sampleSession = {
      id: 'fs-1',
      user_id: 'u1',
      task_id: 'ft-1',
      task_title: 'Derin odak',
      mode: 'work',
      started_at: '2026-10-01T09:00:00.000Z',
      ended_at: '2026-10-01T09:25:00.000Z',
      planned_seconds: 1500,
      completed_seconds: 1500,
      completed: true,
      created_at: '2026-10-01T09:25:00.000Z',
    };
    const sampleTask = {
      id: 'ft-1',
      user_id: 'u1',
      title: 'Derin odak',
      completed: false,
      selected: true,
      estimated_pomodoros: 4,
      completed_pomodoros: 1,
      total_focus_seconds: 1500,
      color: '#6366f1',
      created_at: '2026-10-01T08:00:00.000Z',
      updated_at: '2026-10-01T09:25:00.000Z',
    };

    mockTransport.fromImpl = (table: string) => {
      let rangeFrom = 0;
      let rangeTo = 499;
      const q = {
        select: (cols: string) => {
          selectedByTable[table] ??= [];
          selectedByTable[table].push(cols);
          return q;
        },
        eq: () => q,
        order: () => q,
        range: (from: number, to: number) => {
          rangeFrom = from;
          rangeTo = to;
          return q;
        },
        then: (onOk: (v: unknown) => unknown) => {
          const all = table === 'focus_sessions' ? [sampleSession] : [sampleTask];
          return Promise.resolve({
            data: all.slice(rangeFrom, rangeTo + 1),
            error: null,
          }).then(onOk);
        },
      };
      return q;
    };

    const sessionsRes = await fetchAllFocusSessions();
    const tasksRes = await fetchAllFocusTasks();

    expect(sessionsRes).toEqual({ ok: true, data: [sampleSession] });
    expect(tasksRes).toEqual({ ok: true, data: [sampleTask] });

    expect(new Set(selectedByTable.focus_sessions)).toEqual(new Set([FOCUS_SESSION_EXPORT_COLUMNS]));
    expect(new Set(selectedByTable.focus_tasks)).toEqual(new Set([FOCUS_TASK_COLUMNS]));
    expect(selectedByTable.focus_sessions).not.toContain('*');
    expect(selectedByTable.focus_tasks).not.toContain('*');
  });
});
