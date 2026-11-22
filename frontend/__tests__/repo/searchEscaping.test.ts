/**
 * F12 (REP-17) — Tek merkezli LIKE/ILIKE arama kaçışı (`repositories/likePattern.ts`),
 * kaynak taraması ve `makeSupabaseMock` üzerinde gerçek joker davranışı.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';
import { createMockDb, makeSupabaseMock, type MockDb } from '../helpers/supabaseMock';

const mockSupabaseBridge: {
  auth: { getSession: () => unknown };
  from: (table: string) => unknown;
} = {
  auth: {
    getSession: async () => ({ data: { session: { user: { id: 'u1' }, access_token: 'jwt' } } }),
  },
  from: (table: string) => {
    throw new Error(`Uninitialized mock from(${table})`);
  },
};

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: () => mockSupabaseBridge.auth.getSession(),
    },
    from: (table: string) => mockSupabaseBridge.from(table),
  },
}));

const mockDb: MockDb = createMockDb();
let mockFromCallCount = 0;

import {
  SEARCH_TERM_MAX_LENGTH,
  likeContains,
  normalizeSearchTerm,
  orIlike,
} from '../../repositories/likePattern';
import { searchNotes } from '../../repositories/noteRepository';
import { searchEverything } from '../../services/searchService';

const ROOT = join(__dirname, '..', '..');

/**
 * Test içi bağımsız PostgreSQL ILIKE değerlendiricisi: `supabaseMock.ts` bozulsa bile
 * bu test kendi kendine yanlış yeşil vermez.
 */
function evalIlike(value: string, pattern: string): boolean {
  let src = '^';
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i];
    if (ch === '\\' && i + 1 < pattern.length) {
      i += 1;
      src += pattern[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    } else if (ch === '%') {
      src += '[\\s\\S]*';
    } else if (ch === '_') {
      src += '[\\s\\S]';
    } else {
      src += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${src}$`, 'i').test(value);
}

/** En üst düzey virgülde PostgREST `or()` ifadesini böler. */
function splitTopLevelOr(expr: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inQuotes = false;
  let start = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i];
    if (ch === '"' && expr[i - 1] !== '\\') {
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === '(') depth += 1;
      else if (ch === ')' && depth > 0) depth -= 1;
      else if (ch === ',' && depth === 0) {
        parts.push(expr.slice(start, i));
        start = i + 1;
      }
    }
  }
  parts.push(expr.slice(start));
  return parts;
}

describe('1. likePattern olumlu davranışlar', () => {
  it('50% kalıbı % kaçırır; "yüzde 50% indirim" ile eşleşir, "yüzde 500 indirim" ile eşleşmez', () => {
    const p = likeContains('50%');
    expect(p).toBe('%50\\%%');
    expect(evalIlike('yüzde 50% indirim', p!)).toBe(true);
    expect(evalIlike('yüzde 500 indirim', p!)).toBe(false);
  });

  it('a_b kalıbı _ kaçırır; "a_b" ile eşleşir, "axb" ile eşleşmez', () => {
    const p = likeContains('a_b');
    expect(p).toBe('%a\\_b%');
    expect(evalIlike('a_b', p!)).toBe(true);
    expect(evalIlike('axb', p!)).toBe(false);
  });

  it('C:\\temp ters eğik çizgiyi çiftler ve yalnız "C:\\temp" ile eşleşir', () => {
    const p = likeContains('C:\\temp');
    expect(p).toBe('%C:\\\\temp%');
    expect(evalIlike('C:\\temp', p!)).toBe(true);
    expect(evalIlike('C:temp', p!)).toBe(false);
  });

  it('Türkçe harfleri ve birleşik işaretleri korur; boşlukları daraltır; 500 karakteri 100 kod noktasına kırpar', () => {
    expect(SEARCH_TERM_MAX_LENGTH).toBe(100);
    expect(likeContains('Çay İçmek')).toBe('%Çay İçmek%');
    expect(normalizeSearchTerm('  a \n  b  ')).toBe('a b');

    const longPattern = likeContains('k'.repeat(500));
    expect(longPattern).not.toBeNull();
    expect(longPattern!.length).toBe(102);

    expect(orIlike(['title', 'content'], '50%')).toBe('title.ilike.%50\\%%,content.ilike.%50\\%%');
  });
});

describe('2. likePattern olumsuz ve sınır durumları', () => {
  it.each(['x,id.not.is.null', 'a)or(b', '"q"', 'a*b'])(
    'saldırgan girdi (%s) orIlike içinde ek koşul üretemez, tam iki terimde kalır',
    (hostile) => {
      const out = orIlike(['title', 'content'], hostile);
      expect(out).not.toBeNull();
      const terms = splitTopLevelOr(out!);
      expect(terms).toHaveLength(2);
      for (const term of terms) {
        expect(term).toMatch(/^(title|content)\.ilike\.%[^,()"*]*%$/);
      }
    },
  );

  it.each([',,,', '***', '*', '((((', '   ', '', '"'])(
    'yalnız ayırıcı/joker/boş girdi (%j) için likeContains ve orIlike null döner',
    (emptyish) => {
      expect(likeContains(emptyish)).toBeNull();
      expect(orIlike(['title', 'content'], emptyish)).toBeNull();
    },
  );

  it('geçersiz kolon adında orIlike Error fırlatır; denetim karakterleri boşluğa çevrilir', () => {
    expect(() => orIlike(['title; drop'], 'x')).toThrow();
    expect(() => orIlike([], 'x')).toThrow();
    expect(normalizeSearchTerm('a\u0000b\u001fc\u007fd')).toBe('a b c d');
  });
});

describe('3. Kaynak taraması (tek kaçış noktası)', () => {
  function tsFilesIn(dir: string): { rel: string; code: string }[] {
    const abs = join(ROOT, dir);
    if (!existsSync(abs)) return [];
    return readdirSync(abs)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => ({
        rel: `${dir}/${f}`,
        code: stripComments(readFileSync(join(abs, f), 'utf8')),
      }));
  }

  it('repositories/ ve services/ altında (likePattern.ts dışında) eski kaçış kalıbı ve %${safe}% yoktur', () => {
    const legacyEscape = /\.replace\(\s*\/\[[^\]]*[,()][^\]]*\]\/g/;
    const all = [...tsFilesIn('repositories'), ...tsFilesIn('services')];
    const offenders = all
      .filter(
        (f) =>
          f.code.includes('%${safe}%') ||
          (f.rel !== 'repositories/likePattern.ts' && legacyEscape.test(f.code)),
      )
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('beş arama repository dosyası likeContains veya orIlike kullanır; LIKE joker kaçışı yalnız likePattern.ts içindedir', () => {
    const searchRepos = [
      { rel: 'repositories/noteRepository.ts', helper: 'orIlike(' },
      { rel: 'repositories/taskRepository.ts', helper: 'likeContains(' },
      { rel: 'repositories/habitRepository.ts', helper: 'likeContains(' },
      { rel: 'repositories/projectRepository.ts', helper: 'likeContains(' },
      { rel: 'repositories/journalRepository.ts', helper: 'likeContains(' },
    ];
    for (const r of searchRepos) {
      const code = stripComments(readFileSync(join(ROOT, r.rel), 'utf8'));
      expect({ rel: r.rel, usesHelper: code.includes(r.helper) }).toEqual({
        rel: r.rel,
        usesHelper: true,
      });
      expect(code).not.toMatch(/\.ilike\s*\([^,]+,\s*[`'"]/);
    }

    const escapingFiles = [...tsFilesIn('repositories'), ...tsFilesIn('services')]
      .filter((f) => /replace\(\s*\/\[[^\]]*[\\%_][^\]]*\]\/g/.test(f.code))
      .map((f) => f.rel);
    expect(escapingFiles).toEqual(['repositories/likePattern.ts']);
  });
});

describe('4. Çalışma zamanlı davranış (makeSupabaseMock)', () => {
  beforeEach(() => {
    for (const k of Object.keys(mockDb.rows)) delete mockDb.rows[k];
    mockDb.inserts.length = 0;
    mockDb.idSeq = 0;
    mockDb.failNext = null;
    mockDb.failNextRead = null;
    mockFromCallCount = 0;
    const base = makeSupabaseMock(mockDb, { userId: 'u1' });
    mockSupabaseBridge.auth = base.auth;
    mockSupabaseBridge.from = (table: string) => {
      mockFromCallCount += 1;
      return base.from(table);
    };
  });

  it('searchNotes("50%") yalnız "50% indirim" döndürür; searchNotes("a_b") yalnız "a_b" döndürür', async () => {
    mockDb.rows.notes = [
      { id: 'n1', user_id: 'u1', title: '50% indirim', content: '', tags: [], created_at: '1', updated_at: '4' },
      { id: 'n2', user_id: 'u1', title: '500 TL', content: '', tags: [], created_at: '1', updated_at: '3' },
      { id: 'n3', user_id: 'u1', title: 'a_b', content: '', tags: [], created_at: '1', updated_at: '2' },
      { id: 'n4', user_id: 'u1', title: 'axb', content: '', tags: [], created_at: '1', updated_at: '1' },
    ];

    const pct = await searchNotes('50%');
    expect(pct.ok).toBe(true);
    if (pct.ok) expect(pct.data.map((r) => r.title)).toEqual(['50% indirim']);

    const under = await searchNotes('a_b');
    expect(under.ok).toBe(true);
    if (under.ok) expect(under.data.map((r) => r.title)).toEqual(['a_b']);
  });

  it('searchNotes("x,id.not.is.null") istisna fırlatmadan { ok: true, data: [] } döner', async () => {
    mockDb.rows.notes = [
      { id: 'n1', user_id: 'u1', title: 'Normal not', content: 'içerik', tags: [], created_at: '1', updated_at: '1' },
    ];
    const res = await searchNotes('x,id.not.is.null');
    expect(res).toEqual({ ok: true, data: [] });
  });

  it('searchEverything(",,,") beş kaynağa HİÇ istek atmadan boş sonuç döner', async () => {
    mockFromCallCount = 0;
    const res = await searchEverything(',,,');
    expect(res).toEqual({
      tasks: [],
      habits: [],
      notes: [],
      projects: [],
      journal: [],
      failed: [],
    });
    expect(mockFromCallCount).toBe(0);
  });
});
