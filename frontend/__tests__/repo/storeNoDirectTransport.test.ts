/**
 * F12 (STO-17, REP-18) — Store katmanında doğrudan taşıma (auth, functions,
 * ham fetch, supabase değer içe aktarımı) yasağı ve katman yönü guard'ı.
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripComments } from '../helpers/sourceText';

let mockGetSession = jest.fn(async () => ({
  data: { session: { user: { id: 'u1' }, access_token: 'test-jwt' } as unknown },
}));
let mockAuthCallbackUrl = 'atlas://notion-callback?code=code-1&state=returned-state';

jest.mock('../../lib/supabase', () => ({
  supabase: {
    auth: { getSession: () => mockGetSession() },
    functions: { invoke: jest.fn() },
  },
}));

jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(async () => ({ type: 'success', url: mockAuthCallbackUrl })),
}));

jest.mock('expo-linking', () => ({
  createURL: (p: string) => `atlas://${p}`,
  parse: (url: string) => {
    const q = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const queryParams: Record<string, string> = {};
    for (const pair of q.split('&').filter(Boolean)) {
      const [k, v] = pair.split('=');
      queryParams[k] = decodeURIComponent(v ?? '');
    }
    return { queryParams };
  },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

import { EdgeTimeoutError } from '../../lib/edgeCall';
import { callEdgeFunction } from '../../services/edgeFunctions';
import { useGoogleCalendarStore } from '../../store/googleCalendarStore';
import { useNotionSessionStore } from '../../store/notionSessionStore';
import { useNotionStore } from '../../store/notionStore';

const ROOT = join(__dirname, '..', '..');

const TRANSPORT = /\bsupabase\s*\.\s*(auth|functions|storage|rpc|channel|realtime|removeChannel)\b/;
const RAW_FETCH = /(?<![\w$.])fetch\s*\(|\b(?:globalThis|global|window|self)\s*\.\s*fetch\b|\bXMLHttpRequest\b/;
const FUNCTIONS_URL = /EXPO_PUBLIC_SUPABASE_URL|SUPABASE_FUNCTIONS_URL|\/functions\/v1/;
const CLIENT_VALUE_IMPORT = /import\s+(?!type\b)[^;]*\bsupabase\b[^;]*from\s*['"][^'"]*lib\/supabase['"]/;

function hasDirectTransport(rawSource: string): string[] {
  const code = stripComments(rawSource);
  const reasons: string[] = [];
  if (TRANSPORT.test(code)) reasons.push('TRANSPORT');
  if (RAW_FETCH.test(code)) reasons.push('RAW_FETCH');
  if (FUNCTIONS_URL.test(code)) reasons.push('FUNCTIONS_URL');
  if (CLIENT_VALUE_IMPORT.test(code)) reasons.push('CLIENT_VALUE_IMPORT');
  return reasons;
}

function sourcesIn(dir: string, exts = ['.ts', '.tsx']): { rel: string; raw: string; code: string }[] {
  const absDir = join(ROOT, dir);
  if (!existsSync(absDir)) return [];
  const out: { rel: string; raw: string; code: string }[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!exts.some((ext) => entry.name.endsWith(ext))) continue;
      const raw = readFileSync(full, 'utf8');
      out.push({
        rel: full.slice(ROOT.length + 1).replace(/\\/g, '/'),
        raw,
        code: stripComments(raw),
      });
    }
  };
  walk(absDir);
  return out;
}

describe('1. Tarayıcı kendini sınar (olumlu ve olumsuz örnekler)', () => {
  const stores = sourcesIn('store', ['.ts']);

  it('store/ altında en az 20 dosya bulur', () => {
    expect(stores.length).toBeGreaterThanOrEqual(20);
  });

  it.each([
    ["await supabase.auth.getSession()", 'TRANSPORT'],
    ["supabase.functions.invoke('x')", 'TRANSPORT'],
    ['await fetch(url)', 'RAW_FETCH'],
    ['globalThis.fetch(url)', 'RAW_FETCH'],
    ["import { supabase } from '../lib/supabase'", 'CLIENT_VALUE_IMPORT'],
    ["import { supabase, Routine } from '../lib/supabase'", 'CLIENT_VALUE_IMPORT'],
  ])('yasaklı kalıbı yakalar: %s -> %s', (snippet, expected) => {
    expect(hasDirectTransport(snippet)).toContain(expected);
  });

  it.each([
    '// supabase.auth.getSession()\nconst x = 1;',
    'prefetch(x)',
    'refetch()',
    'repo.fetch(x)',
    "Linking.createURL('a')",
    "import type { Routine } from '../lib/supabase'",
    "import type { Habit } from '../lib/supabase'",
  ])('meşru kodu veya yorumu yakalamaz: %s', (snippet) => {
    expect(hasDirectTransport(snippet)).toEqual([]);
  });
});

describe('2. Hiçbir store doğrudan taşıma yapmaz', () => {
  const stores = sourcesIn('store', ['.ts']);

  it('store/ altındaki hiçbir dosyada supabase.auth/functions, ham fetch, /functions/v1 veya supabase değer içe aktarımı yoktur', () => {
    const offenders = stores
      .map((s) => ({ file: s.rel.replace(/^store\//, ''), reasons: hasDirectTransport(s.raw) }))
      .filter((x) => x.reasons.length > 0);
    expect(offenders).toEqual([]);
  });
});

describe('3. Ekran içi uç çağrı sayacı (azalabilir, artamaz)', () => {
  const FROZEN_UI_INVOKE = new Set([
    'app/screens/ai-coach.tsx',
    'app/screens/insights.tsx',
    'app/screens/journal-insights.tsx',
  ]);

  it('app/ ve components/ içinde functions.invoke yalnız dondurulmuş 3 ekranda bulunur ve her biri withEdgeDeadline kullanır', () => {
    const uiFiles = [...sourcesIn('app'), ...sourcesIn('components')];
    const callers = uiFiles.filter((f) => /\bfunctions\s*\.\s*invoke\s*\(/.test(f.code));
    const unexpected = callers
      .map((f) => f.rel)
      .filter((rel) => !FROZEN_UI_INVOKE.has(rel));

    if (unexpected.length > 0) {
      throw new Error(
        `Yeni ekran/bileşen uç çağrısı yasak (${unexpected.join(', ')}); taşımayı services/edgeFunctions.ts üzerinden yap`,
      );
    }

    for (const caller of callers) {
      expect({ rel: caller.rel, hasDeadline: caller.code.includes('withEdgeDeadline') }).toEqual({
        rel: caller.rel,
        hasDeadline: true,
      });
    }
  });
});

describe('4. Kimlik kipi davranışı (çalışma zamanlı)', () => {
  const realFetch = global.fetch;

  beforeEach(() => {
    useNotionSessionStore.setState({ session: null, loading: false, error: null });
    useNotionStore.setState({
      connection: null,
      status: 'idle',
      lastSynced: null,
      error: null,
      _pendingOAuthUrl: null,
    });
    useGoogleCalendarStore.setState({
      connection: null,
      status: 'idle',
      error: null,
      available: null,
    });
  });

  afterEach(() => {
    global.fetch = realFetch;
    jest.useRealTimers();
  });

  it('(a) notionSessionStore.login() iki çağrıda da Authorization başlığı GÖNDERMEZ; getSession yalnız aktarımdan sonra storageKey içinde bir kez okunur', async () => {
    const recorded: { url: string; headers: Record<string, string>; getSessionCallsBeforeFetch: number }[] = [];
    let getSessionCalls = 0;

    mockGetSession = jest.fn(async () => {
      getSessionCalls += 1;
      return { data: { session: { user: { id: 'u-login' }, access_token: 'test-jwt' } } };
    });
    mockAuthCallbackUrl = 'atlas://notion-callback?code=code-1&state=state-from-provider';

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      const hdrs = (init?.headers ?? {}) as Record<string, string>;
      recorded.push({
        url: String(url),
        headers: { ...hdrs },
        getSessionCallsBeforeFetch: getSessionCalls,
      });
      if (String(url).includes('action=url')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ url: 'https://api.notion.com/v1/oauth/authorize', state: 'minted-state' }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, workspace_name: 'WS', workspace_id: 'wid-1' }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const ok = await useNotionSessionStore.getState().login();

    expect(ok).toBe(true);
    expect(recorded).toHaveLength(2);
    expect(recorded[0].url).toContain('action=url');
    expect(recorded[1].url).toContain('action=callback');
    expect(recorded[0].headers.Authorization).toBeUndefined();
    expect(recorded[1].headers.Authorization).toBeUndefined();
    expect(recorded[0].getSessionCallsBeforeFetch).toBe(0);
    expect(recorded[1].getSessionCallsBeforeFetch).toBe(0);
    expect(getSessionCalls).toBe(1);
  });

  it('(b) notionStore.connect() iki çağrıda da Authorization: Bearer test-jwt gönderir', async () => {
    const recorded: { url: string; headers: Record<string, string> }[] = [];

    mockGetSession = jest.fn(async () => ({
      data: { session: { user: { id: 'u1' }, access_token: 'test-jwt' } },
    }));
    mockAuthCallbackUrl = 'atlas://notion-callback?code=code-2&state=returned-state';

    global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
      recorded.push({ url: String(url), headers: { ...((init?.headers ?? {}) as Record<string, string>) } });
      if (String(url).includes('action=url')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ url: 'https://api.notion.com/v1/oauth/authorize', state: 'srv-state' }),
        } as unknown as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace_name: 'Notion WS',
          habits_url: 'https://notion.so/h',
          tasks_url: 'https://notion.so/t',
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const ok = await useNotionStore.getState().connect();

    expect(ok).toBe(true);
    expect(recorded).toHaveLength(2);
    expect(recorded[0].headers.Authorization).toBe('Bearer test-jwt');
    expect(recorded[1].headers.Authorization).toBe('Bearer test-jwt');
  });

  it('(c) oturum null iken googleCalendarStore.fetchStatus() hiç fetch çağırmaz ve durumu değiştirmez; connect() hata yazar ve callback atılmaz', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    mockGetSession = jest.fn(async () => ({ data: { session: null } }));

    const before = {
      connection: useGoogleCalendarStore.getState().connection,
      status: useGoogleCalendarStore.getState().status,
      error: useGoogleCalendarStore.getState().error,
      available: useGoogleCalendarStore.getState().available,
    };
    await useGoogleCalendarStore.getState().fetchStatus();
    expect(fetchMock).not.toHaveBeenCalled();
    expect({
      connection: useGoogleCalendarStore.getState().connection,
      status: useGoogleCalendarStore.getState().status,
      error: useGoogleCalendarStore.getState().error,
      available: useGoogleCalendarStore.getState().available,
    }).toEqual(before);

    const connected = await useGoogleCalendarStore.getState().connect();
    expect(connected).toBe(false);
    expect(useGoogleCalendarStore.getState().status).toBe('error');
    expect(useGoogleCalendarStore.getState().error).toBe('Oturum açmanız gerekiyor');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('(d) callEdgeFunction 20 sn içinde yanıt gelmezse EdgeTimeoutError fırlatır ve etiket mesajda görünür', async () => {
    jest.useFakeTimers();

    mockGetSession = jest.fn(async () => ({
      data: { session: { user: { id: 'u1' }, access_token: 'jwt' } },
    }));

    global.fetch = jest.fn((_url: string, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      });
    }) as unknown as typeof fetch;

    const pending = callEdgeFunction('notion-auth', { label: 'Notion bağlantısı', action: 'status' }).catch(
      (e: unknown) => e,
    );
    await Promise.resolve();
    await Promise.resolve();
    jest.advanceTimersByTime(20_000);
    const err = await pending;
    expect(err).toBeInstanceOf(EdgeTimeoutError);
    expect((err as Error).message).toContain('Notion bağlantısı');
  });
});

describe('5. Katman yönü (repositories, services, taskTypes, taskStore)', () => {
  it("repositories/*.ts hiçbir satırda from '../store/ içermez (tip içe aktarımı dahil)", () => {
    const offenders = sourcesIn('repositories', ['.ts'])
      .filter((f) => /from\s+['"]\.\.\/store\//.test(f.code))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it("services/*.ts içinde ../store/ yolundan tip içe aktarımı yoktur", () => {
    const typeFromStore =
      /import\s+type\b[^;]*from\s+['"]\.\.\/store\/|import\s+\{[^}]*\btype\s+\w+[^}]*\}\s+from\s+['"]\.\.\/store\//;
    const offenders = sourcesIn('services', ['.ts'])
      .filter((f) => typeFromStore.test(f.code))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('lib/taskTypes.ts var ve hiçbir şey içe aktarmaz; store/taskStore.ts Task tiplerini yeniden dışa aktarır', () => {
    const taskTypesPath = join(ROOT, 'lib', 'taskTypes.ts');
    expect(existsSync(taskTypesPath)).toBe(true);
    const taskTypesCode = stripComments(readFileSync(taskTypesPath, 'utf8'));
    expect(taskTypesCode).not.toMatch(/\bimport\b/);

    const taskStoreCode = stripComments(readFileSync(join(ROOT, 'store', 'taskStore.ts'), 'utf8'));
    expect(taskStoreCode).toContain(
      "export type { TaskStatus, TaskPriority, ListType, QuadrantType, Task } from '../lib/taskTypes'",
    );
  });
});

describe('6. Olumlu bağlama', () => {
  it.each([
    'store/spotifyStore.ts',
    'store/googleCalendarStore.ts',
    'store/notionStore.ts',
    'store/notionSessionStore.ts',
  ])('%s kaynağı ../services/edgeFunctions içe aktarır', (rel) => {
    const code = stripComments(readFileSync(join(ROOT, rel), 'utf8'));
    expect(code).toContain("from '../services/edgeFunctions'");
  });

  it('routineStore.ts requestRoutineGeneration işlevini ../services/routineService içinden alır', () => {
    const code = stripComments(readFileSync(join(ROOT, 'store', 'routineStore.ts'), 'utf8'));
    expect(code).toMatch(/import\s*\{[^}]*\brequestRoutineGeneration\b[^}]*\}\s*from\s*['"]\.\.\/services\/routineService['"]/);
  });

  it("spotifyStore.ts hâlâ 'spotify-auth' dizesini taşır (run-tests.js uyumu)", () => {
    const code = stripComments(readFileSync(join(ROOT, 'store', 'spotifyStore.ts'), 'utf8'));
    expect(code).toContain("'spotify-auth'");
  });

  it('services/edgeFunctions.ts TEK supabase.auth.getSession() ve TEK fetch( içerir', () => {
    const edgePath = join(ROOT, 'services', 'edgeFunctions.ts');
    expect(existsSync(edgePath)).toBe(true);
    const code = stripComments(readFileSync(edgePath, 'utf8'));
    expect(code.match(/supabase\.auth\.getSession\s*\(\s*\)/g) ?? []).toHaveLength(1);
    expect(code.match(/(?<![\w$.])fetch\s*\(/g) ?? []).toHaveLength(1);
  });
});
