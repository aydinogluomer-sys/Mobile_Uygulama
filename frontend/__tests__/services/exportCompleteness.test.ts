/**
 * F20 (SYN-06, SYN-11, SYN-20, Anayasa 0.H) — dışa aktarım tamlığı, cihaz anahtarı süzmesi
 * ve `fetchOwnedTable` / `fetchFullTable` kapsadığı tablolarda `id` sütunu regresyon kilidi.
 */
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const mockDb = {
  serverCap: 1000,
  tables: new Map<string, Record<string, unknown>[]>(),
  errors: new Map<string, { message: string; code?: string }>(),
  notesPages: [] as { id: string; title: string | null; content: string; created_at: string | null }[][],
  notesError: null as string | null,
};

jest.mock('../../lib/supabase', () => {
  function projectCols(row: Record<string, unknown>, cols: string): Record<string, unknown> {
    if (cols.trim() === '*') return { ...row };
    const out: Record<string, unknown> = {};
    for (const col of cols.split(',').map((c) => c.trim()).filter(Boolean)) {
      if (col in row) out[col] = row[col];
    }
    return out;
  }

  const makeQuery = (table: string) => {
    const state = {
      cols: '*',
      eqs: [] as [string, unknown][],
      gtId: null as string | null,
      limitN: null as number | null,
      orderCol: null as string | null,
      orderAsc: true,
    };

    const resolveRows = () => {
      const err = mockDb.errors.get(table);
      if (err) return { data: null as Record<string, unknown>[] | null, error: err, status: 500 };
      let rows = [...(mockDb.tables.get(table) ?? [])];
      for (const [col, val] of state.eqs) {
        rows = rows.filter((r) => r[col] === val);
      }
      if (state.gtId !== null) {
        const gt = state.gtId;
        rows = rows.filter((r) => String(r.id) > gt);
      }
      if (state.orderCol) {
        const col = state.orderCol;
        const dir = state.orderAsc ? 1 : -1;
        rows.sort((a, b) => dir * String(a[col] ?? '').localeCompare(String(b[col] ?? '')));
      }
      const cap = state.limitN === null ? mockDb.serverCap : Math.min(state.limitN, mockDb.serverCap);
      return { data: rows.slice(0, cap).map((r) => projectCols(r, state.cols)), error: null, status: 200 };
    };

    const q = {
      select: (cols = '*') => { state.cols = cols; return q; },
      eq: (col: string, val: unknown) => { state.eqs.push([col, val]); return q; },
      order: (col: string, opts?: { ascending?: boolean }) => {
        state.orderCol = col;
        state.orderAsc = opts?.ascending ?? true;
        return q;
      },
      limit: (n: number) => { state.limitN = n; return q; },
      gt: (_col: string, val: string) => { state.gtId = val; return q; },
      maybeSingle: async () => {
        const res = resolveRows();
        if (res.error) return { data: null, error: res.error, status: res.status };
        return { data: res.data?.[0] ?? null, error: null, status: 200 };
      },
      then: (onOk: (v: unknown) => unknown, onErr?: (e: unknown) => unknown) =>
        Promise.resolve(resolveRows()).then(onOk, onErr),
    };
    return q;
  };

  return { supabase: { from: (table: string) => makeQuery(table) } };
});

jest.mock('../../repositories/shared', () => ({
  ...jest.requireActual('../../repositories/shared'),
  currentUserId: jest.fn(async () => ({ ok: true, userId: 'u1' })),
}));

jest.mock('../../repositories/taskRepository', () => ({
  fetchTasksPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })),
}));
jest.mock('../../repositories/projectRepository', () => ({
  fetchProjectsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })),
}));
jest.mock('../../repositories/goalRepository', () => ({
  fetchGoalsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })),
}));
jest.mock('../../repositories/badHabitRepository', () => ({
  fetchBadHabitsPage: jest.fn(async () => ({ ok: true, data: { rows: [], hasMore: false, nextCursor: null } })),
}));
jest.mock('../../repositories/noteRepository', () => ({
  fetchNotesPage: jest.fn(async (cursor?: { id: string } | null) => {
    if (mockDb.notesError) return { ok: false, error: mockDb.notesError };
    const idx = cursor ? Number(cursor.id) : 0;
    const rows = mockDb.notesPages[idx] ?? [];
    const hasMore = idx + 1 < mockDb.notesPages.length;
    return {
      ok: true,
      data: {
        rows,
        hasMore,
        nextCursor: hasMore ? { key: String(idx + 1), id: String(idx + 1) } : null,
      },
    };
  }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import { verifyBackupText } from '../../lib/backupFormat';
import { EXPORT_FULL_TABLES } from '../../repositories/exportRepository';
import { EXPORT_EXTRA_TABLES, RESTORE_TABLES } from '../../repositories/restoreRepository';
import { MAX_ROWS, buildBackup, collectAllNotes, isBackupComplete } from '../../services/exportService';

function seedHabitLogs(count: number) {
  const states = ['done', 'partial', 'skip', 'miss'] as const;
  mockDb.tables.set(
    'habit_logs',
    Array.from({ length: count }, (_, i) => ({
      id: `hl-${String(i).padStart(6, '0')}`,
      user_id: 'u1',
      habit_id: 'h1',
      completed_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      state: states[i % states.length],
      value: i % 2 === 0 ? 5 : null,
      notes: `not-${i}`,
      mood_rating: (i % 5) + 1,
      is_makeup: i % 7 === 0,
      xp: states[i % states.length] === 'done' ? 30 : 0,
      created_at: '2026-01-01T10:00:00.000Z',
    })),
  );
}

beforeEach(async () => {
  mockDb.serverCap = 1000;
  mockDb.tables.clear();
  mockDb.errors.clear();
  mockDb.notesPages = [];
  mockDb.notesError = null;
  await AsyncStorage.clear();
});

describe('SYN-06 / SYN-20 — tam dışa aktarım ve doğrulama', () => {
  it('1500 habit_logs satırını (skip/miss ve notlar dahil) tavan 1000 ve tavan 100 iken eksiksiz dışa aktarır', async () => {
    seedHabitLogs(1500);
    mockDb.tables.set('habits', [
      { id: 'h1', user_id: 'u1', name: 'Su', status: 'active' },
      { id: 'h2', user_id: 'u1', name: 'Eski Alışkanlık', status: 'archived' },
    ]);
    mockDb.tables.set('webhooks', [
      { id: 'w1', user_id: 'u1', url: 'https://ornek.test/hook', headers: { Authorization: 'Bearer SECRET_TOKEN' } },
    ]);
    mockDb.tables.set('profiles', [
      {
        id: 'u1',
        email: 'ada@ornek.test',
        username: 'ada',
        ai_persona: 'zen',
        last_ai_context: 'son bağlam',
        created_at: '2026-01-01T00:00:00.000Z',
        push_token: 'expo-push-secret',
        coins: 99,
        skill_points: 4,
        total_xp: 900,
        purged_xp: 30,
      },
    ]);
    mockDb.tables.set('user_onboarding', [
      {
        user_id: 'u1',
        onboarding_version: 1,
        goals: ['sleep'],
        primary_barrier: 'consistency',
        pace: 'gentle',
        preferred_dayparts: ['morning'],
        reminder_intent: true,
        status: 'completed',
        completed_at: '2026-01-01T00:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        install_id: 'inst-hidden',
        install_expected_habits: 3,
        install_return_status: 'pending',
      },
    ]);

    const b1000 = await buildBackup(new Date('2026-11-01T10:00:00.000Z'), { userId: 'u1' });
    expect(b1000.habit_logs).toHaveLength(1500);
    const states = new Set((b1000.habit_logs as { state: string }[]).map((r) => r.state));
    expect(states).toEqual(new Set(['done', 'partial', 'skip', 'miss']));
    const sampleLog = b1000.habit_logs[0] as Record<string, unknown>;
    expect(sampleLog).toEqual(expect.objectContaining({
      id: 'hl-000000',
      notes: 'not-0',
      mood_rating: 1,
      is_makeup: true,
      xp: 30,
      created_at: '2026-01-01T10:00:00.000Z',
    }));
    expect((b1000.habits as { status: string }[]).map((h) => h.status)).toContain('archived');
    expect(JSON.stringify(b1000)).not.toContain('SECRET_TOKEN');
    expect(b1000.webhooks[0]).not.toHaveProperty('headers');

    expect(Object.keys(b1000.profiles[0] as Record<string, unknown>).sort()).toEqual([
      'ai_persona', 'created_at', 'email', 'id', 'last_ai_context', 'username',
    ]);
    expect(b1000.profiles[0]).not.toHaveProperty('push_token');
    expect(b1000.profiles[0]).not.toHaveProperty('coins');
    expect(b1000.profiles[0]).not.toHaveProperty('total_xp');

    expect(b1000.user_onboarding[0]).toMatchObject({
      user_id: 'u1',
      goals: ['sleep'],
      primary_barrier: 'consistency',
    });
    expect(b1000.user_onboarding[0]).not.toHaveProperty('install_id');
    expect(b1000.user_onboarding[0]).not.toHaveProperty('install_expected_habits');

    expect(b1000.truncated).toEqual([]);
    expect(b1000.failed).toEqual([]);
    expect(isBackupComplete(b1000)).toBe(true);
    expect(b1000.manifest!.collections.habit_logs.count).toBe(1500);
    expect(b1000.manifest!.collections.profiles.count).toBe(1);
    expect(b1000.manifest!.collections.user_onboarding.count).toBe(1);
    expect(verifyBackupText(JSON.stringify(b1000), 'u1').ok).toBe(true);

    // Tavan 100 iken de aynı 1500 satır gelir
    mockDb.serverCap = 100;
    const b100 = await buildBackup(new Date('2026-11-01T10:00:00.000Z'), { userId: 'u1' });
    expect(b100.habit_logs).toHaveLength(1500);
    expect(isBackupComplete(b100)).toBe(true);
  });

  it('tavan aşımında truncated listesine yazar ve isBackupComplete false döner; okuma hatasında failed listesine yazar', async () => {
    seedHabitLogs(MAX_ROWS + 1);
    const cut = await buildBackup(new Date('2026-11-01T10:00:00.000Z'), { userId: 'u1' });
    expect(cut.truncated).toContain('habit_logs');
    expect(cut.habit_logs).toHaveLength(MAX_ROWS);
    expect(isBackupComplete(cut)).toBe(false);
    expect(cut.notes_on_contents.join(' ')).toContain('Sınıra takılan');

    mockDb.tables.clear();
    mockDb.errors.set('habit_logs', { message: 'bağlantı koptu' });
    const failed = await buildBackup(new Date('2026-11-01T10:00:00.000Z'), { userId: 'u1' });
    expect(failed.failed).toContainEqual({ collection: 'habit_logs', error: 'bağlantı koptu' });
    expect(isBackupComplete(failed)).toBe(false);
  }, 20_000);
});

describe('SYN-11 — cihaz anahtarları multiGet öncesi süzülür ve collectAllNotes sayfaları tüketir', () => {
  it('önceki yerel yedek kopyaları ve outbox anahtarları multiGet çağrısına girmez', async () => {
    await AsyncStorage.multiSet([
      ['backup.local.v1.u1.2026-10-08T09:00:00.000Z', '{"huge":"blob"}'],
      ['outbox.v1.core.u1', '{"commands":[]}'],
      ['moods.v1.u1', '{"v":1}'],
    ]);
    const spy = jest.spyOn(AsyncStorage, 'multiGet');
    spy.mockClear();
    try {
      const b = await buildBackup(new Date('2026-11-01T10:00:00.000Z'), { userId: 'u1' });
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toEqual(['moods.v1.u1']);
      expect(b.device.map((d) => d.key)).toEqual(['moods.v1.u1']);
    } finally {
      spy.mockRestore();
    }
  });

  it('collectAllNotes tüm sayfaları okur ve hata durumunda ok: false döner', async () => {
    mockDb.notesPages = [
      [{ id: 'n1', title: 'Bir', content: 'A', created_at: '2026-10-01' }],
      [{ id: 'n2', title: 'İki', content: 'B', created_at: '2026-10-02' }],
    ];
    const okRes = await collectAllNotes();
    expect(okRes).toEqual({
      ok: true,
      data: {
        rows: [
          { id: 'n1', title: 'Bir', content: 'A', created_at: '2026-10-01' },
          { id: 'n2', title: 'İki', content: 'B', created_at: '2026-10-02' },
        ],
        truncated: false,
      },
    });

    mockDb.notesError = 'ağ hatası';
    const errRes = await collectAllNotes();
    expect(errRes).toEqual({ ok: false, error: 'ağ hatası' });
  });
});

describe('Anayasa 0.H — id sütunu regresyon kilidi', () => {
  const REPO = join(__dirname, '..', '..', '..');

  function tablesWithIdInSchema(): Set<string> {
    const withId = new Set<string>();
    const sources = [
      readFileSync(join(REPO, 'supabase', 'live_schema.sql'), 'utf8'),
      ...readdirSync(join(REPO, 'supabase', 'migrations'))
        .filter((f) => /^0.*\.sql$/.test(f))
        .map((f) => readFileSync(join(REPO, 'supabase', 'migrations', f), 'utf8')),
    ];
    const tableRe = /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:"?public"?\.)?"?([a-z0-9_]+)"?\s*\(([\s\S]*?)\);/gi;
    for (const sql of sources) {
      for (const m of sql.matchAll(tableRe)) {
        const name = m[1];
        const body = m[2];
        if (/^\s*"?id"?\s+/m.test(body)) withId.add(name);
      }
    }
    return withId;
  }

  function missingIdTables(tables: readonly string[], schemaIds: ReadonlySet<string>): string[] {
    return [...new Set(tables)].filter((t) => !schemaIds.has(t));
  }

  it('RESTORE_TABLES, EXPORT_EXTRA_TABLES ve EXPORT_FULL_TABLES içindeki her tablonun şemada id sütunu vardır', () => {
    const schemaIds = tablesWithIdInSchema();
    expect(schemaIds.size).toBeGreaterThan(25);

    const allKeysetTables = [...RESTORE_TABLES, ...EXPORT_EXTRA_TABLES, ...EXPORT_FULL_TABLES];
    expect(allKeysetTables).not.toContain('profiles');
    expect(allKeysetTables).not.toContain('user_onboarding');
    expect(missingIdTables(allKeysetTables, schemaIds)).toEqual([]);

    // Negatif kontrol: id sütunu olmayan tablolar verilirse yardımcı yakalar
    expect(missingIdTables(['habits', 'willpower_state', 'user_onboarding'], schemaIds)).toEqual([
      'willpower_state',
      'user_onboarding',
    ]);
  });
});
