export type EmulatedRequest = {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | null;
};

export type EmulatedResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

export type EmulatorUser = {
  id: string;
  email: string;
  password: string;
};

export type RecordedWrite = {
  table: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  userId: string;
  body: unknown;
};

export type EmulatorRpcContext = {
  rows: (table: string, userId: string) => readonly Record<string, unknown>[];
};

export type EmulatorSeed = {
  users: readonly EmulatorUser[];
  tables: Record<string, readonly Record<string, unknown>[]>;
  rpc?: Record<
    string,
    (args: unknown, userId: string, ctx: EmulatorRpcContext) => { status: number; body: unknown }
  >;
};

export interface SupabaseEmulator {
  handle(req: EmulatedRequest): EmulatedResponse;
  writes(table?: string): readonly RecordedWrite[];
  functionCalls(): readonly string[];
  authCalls(): readonly string[];
  unhandled(): readonly string[];
  rows(table: string, userId: string): readonly Record<string, unknown>[];
}

const CORS_HEADERS: Readonly<Record<string, string>> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, OPTIONS',
  'access-control-allow-headers':
    'apikey, authorization, x-client-info, content-type, prefer, accept, accept-profile, content-profile, range, range-unit',
  'access-control-expose-headers': 'content-range, x-total-count',
};

function toBase64Url(str: string): string {
  return Buffer.from(str, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(b64u: string): string {
  const pad = b64u.length % 4 === 0 ? '' : '='.repeat(4 - (b64u.length % 4));
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + pad;
  return Buffer.from(b64, 'base64').toString('utf8');
}

export function fakeJwt(claims: { sub: string; email: string; expSeconds: number }): string {
  const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = toBase64Url(
    JSON.stringify({
      aud: 'authenticated',
      role: 'authenticated',
      sub: claims.sub,
      email: claims.email,
      exp: claims.expSeconds,
      iat: Math.max(0, claims.expSeconds - 3600),
    }),
  );
  return `${header}.${payload}.e2e`;
}

function decodeJwtPayload(token: string): { sub?: string; email?: string; exp?: number } | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(parts[1])) as Record<string, unknown>;
    return {
      sub: typeof parsed.sub === 'string' ? parsed.sub : undefined,
      email: typeof parsed.email === 'string' ? parsed.email : undefined,
      exp: typeof parsed.exp === 'number' ? parsed.exp : undefined,
    };
  } catch {
    return null;
  }
}

function lowerHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k.toLowerCase()] = v;
  }
  return out;
}

function jsonResp(status: number, body: unknown, extraHeaders?: Record<string, string>): EmulatedResponse {
  return {
    status,
    headers: {
      ...CORS_HEADERS,
      'content-type': 'application/json; charset=utf-8',
      ...(extraHeaders ?? {}),
    },
    body: body === undefined ? '' : JSON.stringify(body),
  };
}

function emptyResp(status: number, extraHeaders?: Record<string, string>): EmulatedResponse {
  return {
    status,
    headers: {
      ...CORS_HEADERS,
      ...(extraHeaders ?? {}),
    },
    body: '',
  };
}

function buildAuthUser(u: EmulatorUser, nowIso: string): Record<string, unknown> {
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: '2026-01-01T00:00:00.000Z',
    confirmed_at: '2026-01-01T00:00:00.000Z',
    last_sign_in_at: nowIso,
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: nowIso,
  };
}

function ownerIdOf(table: string, row: Record<string, unknown>): string | null {
  if (typeof row.user_id === 'string') return row.user_id;
  if (table === 'profiles' && typeof row.id === 'string') return row.id;
  return null;
}

function parseScalar(raw: string): string | number | boolean | null {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function parseInList(inner: string): (string | number | boolean | null)[] {
  const items: (string | number | boolean | null)[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (ch === ',' && !inQuotes) {
      items.push(parseScalar(cur));
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 || inner.length > 0) {
    items.push(parseScalar(cur));
  }
  return items;
}

function compareValues(rowVal: unknown, rawFilterVal: string): number {
  if (typeof rowVal === 'number' && /^-?\d+(?:\.\d+)?$/.test(rawFilterVal)) {
    return rowVal - Number(rawFilterVal);
  }
  const sRow = String(rowVal ?? '');
  if (sRow < rawFilterVal) return -1;
  if (sRow > rawFilterVal) return 1;
  return 0;
}

function matchesColumnExpr(
  row: Record<string, unknown>,
  col: string,
  expr: string,
): { ok: true; match: boolean } | { ok: false; unsupported: string } {
  const val = row[col];
  if (expr.startsWith('eq.')) {
    const target = expr.slice(3);
    if (val === null || val === undefined) return { ok: true, match: target === 'null' };
    if (typeof val === 'boolean') return { ok: true, match: String(val) === target };
    if (typeof val === 'number') return { ok: true, match: String(val) === target || val === Number(target) };
    return { ok: true, match: String(val) === target };
  }
  if (expr.startsWith('neq.')) {
    const sub = matchesColumnExpr(row, col, `eq.${expr.slice(4)}`);
    return sub.ok ? { ok: true, match: !sub.match } : sub;
  }
  if (expr.startsWith('gte.')) {
    if (val === null || val === undefined) return { ok: true, match: false };
    return { ok: true, match: compareValues(val, expr.slice(4)) >= 0 };
  }
  if (expr.startsWith('gt.')) {
    if (val === null || val === undefined) return { ok: true, match: false };
    return { ok: true, match: compareValues(val, expr.slice(3)) > 0 };
  }
  if (expr.startsWith('lte.')) {
    if (val === null || val === undefined) return { ok: true, match: false };
    return { ok: true, match: compareValues(val, expr.slice(4)) <= 0 };
  }
  if (expr.startsWith('lt.')) {
    if (val === null || val === undefined) return { ok: true, match: false };
    return { ok: true, match: compareValues(val, expr.slice(3)) < 0 };
  }
  if (expr === 'is.null') return { ok: true, match: val === null || val === undefined };
  if (expr === 'is.true') return { ok: true, match: val === true };
  if (expr === 'is.false') return { ok: true, match: val === false };
  if (expr.startsWith('not.')) {
    const sub = matchesColumnExpr(row, col, expr.slice(4));
    return sub.ok ? { ok: true, match: !sub.match } : sub;
  }
  if (expr.startsWith('in.(') && expr.endsWith(')')) {
    const list = parseInList(expr.slice(4, -1));
    return {
      ok: true,
      match: list.some((item) => item === val || String(item) === String(val)),
    };
  }
  return { ok: false, unsupported: `${col}=${expr}` };
}

function splitTopLevelCommas(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of input) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ',' && depth === 0) {
      if (cur.trim()) parts.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function evaluateLogicalGroup(
  row: Record<string, unknown>,
  kind: 'or' | 'and',
  inner: string,
): { ok: true; match: boolean } | { ok: false; unsupported: string } {
  const clauses = splitTopLevelCommas(inner);
  const results: boolean[] = [];
  for (const clause of clauses) {
    if (clause.startsWith('and(') && clause.endsWith(')')) {
      const r = evaluateLogicalGroup(row, 'and', clause.slice(4, -1));
      if (!r.ok) return r;
      results.push(r.match);
      continue;
    }
    if (clause.startsWith('or(') && clause.endsWith(')')) {
      const r = evaluateLogicalGroup(row, 'or', clause.slice(3, -1));
      if (!r.ok) return r;
      results.push(r.match);
      continue;
    }
    const dot = clause.indexOf('.');
    if (dot <= 0) return { ok: false, unsupported: `${kind}:(${clause})` };
    const col = clause.slice(0, dot);
    const expr = clause.slice(dot + 1);
    const r = matchesColumnExpr(row, col, expr);
    if (!r.ok) return r;
    results.push(r.match);
  }
  return {
    ok: true,
    match: kind === 'or' ? results.some(Boolean) : results.every(Boolean),
  };
}

const META_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

export function createSupabaseEmulator(seed: EmulatorSeed, nowMs: () => number): SupabaseEmulator {
  const users = new Map<string, EmulatorUser>(seed.users.map((u) => [u.id, { ...u }]));
  const db = new Map<string, Record<string, unknown>[]>();
  for (const [tbl, rows] of Object.entries(seed.tables)) {
    db.set(
      tbl,
      rows.map((r) => ({ ...r })),
    );
  }

  const recordedWrites: RecordedWrite[] = [];
  const recordedFunctions: string[] = [];
  const recordedAuth: string[] = [];
  const unhandledList: string[] = [];
  let autoIdSeq = 1;

  function ensureTable(table: string): Record<string, unknown>[] {
    let arr = db.get(table);
    if (!arr) {
      arr = [];
      db.set(table, arr);
    }
    return arr;
  }

  function extractUserId(headers: Record<string, string>): string | null {
    const auth = headers['authorization'] ?? '';
    if (!auth.toLowerCase().startsWith('bearer ')) return null;
    const token = auth.slice(7).trim();
    const claims = decodeJwtPayload(token);
    if (!claims?.sub) return null;
    if (typeof claims.exp === 'number' && claims.exp < Math.floor(nowMs() / 1000)) {
      return null;
    }
    return claims.sub;
  }

  function filterRows(
    rows: Record<string, unknown>[],
    params: URLSearchParams,
  ): { ok: true; rows: Record<string, unknown>[] } | { ok: false; unsupported: string } {
    let current = [...rows];
    for (const [key, rawVal] of params.entries()) {
      if (META_PARAMS.has(key)) continue;
      if ((key === 'or' || key === 'and') && rawVal.startsWith('(') && rawVal.endsWith(')')) {
        const next: Record<string, unknown>[] = [];
        for (const r of current) {
          const ev = evaluateLogicalGroup(r, key, rawVal.slice(1, -1));
          if (!ev.ok) return ev;
          if (ev.match) next.push(r);
        }
        current = next;
        continue;
      }
      const next: Record<string, unknown>[] = [];
      for (const r of current) {
        const ev = matchesColumnExpr(r, key, rawVal);
        if (!ev.ok) return ev;
        if (ev.match) next.push(r);
      }
      current = next;
    }
    return { ok: true, rows: current };
  }

  function sortAndSlice(
    rows: Record<string, unknown>[],
    params: URLSearchParams,
    rangeHeader?: string,
  ): Record<string, unknown>[] {
    const out = [...rows];
    const orderRaw = params.get('order');
    if (orderRaw) {
      const specs = orderRaw.split(',').map((part) => {
        const segs = part.trim().split('.');
        return {
          col: segs[0],
          desc: segs.includes('desc'),
          nullsFirst: segs.includes('nullsfirst'),
        };
      });
      out.sort((a, b) => {
        for (const sp of specs) {
          const av = a[sp.col];
          const bv = b[sp.col];
          if (av === bv) continue;
          if (av === null || av === undefined) return sp.nullsFirst ? -1 : 1;
          if (bv === null || bv === undefined) return sp.nullsFirst ? 1 : -1;
          const cmp = av < bv ? -1 : 1;
          return sp.desc ? -cmp : cmp;
        }
        return 0;
      });
    }
    if (rangeHeader) {
      const m = /^(?:items=)?(\d+)-(\d+)$/.exec(rangeHeader.trim());
      if (m) {
        const from = Number(m[1]);
        const to = Number(m[2]);
        return out.slice(from, to + 1);
      }
    }
    const offset = Number(params.get('offset') ?? '0');
    const limitParam = params.get('limit');
    const start = Number.isFinite(offset) && offset > 0 ? offset : 0;
    if (limitParam !== null && /^\d+$/.test(limitParam)) {
      return out.slice(start, start + Number(limitParam));
    }
    return start > 0 ? out.slice(start) : out;
  }

  function parseJsonSafe(raw: string | null): { ok: true; value: unknown } | { ok: false } {
    if (!raw || !raw.trim()) return { ok: true, value: {} };
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch {
      return { ok: false };
    }
  }

  return {
    handle(req: EmulatedRequest): EmulatedResponse {
      const method = req.method.toUpperCase();
      const headers = lowerHeaders(req.headers);

      if (method === 'OPTIONS') {
        return emptyResp(204);
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(req.url, 'http://127.0.0.1:54321');
      } catch {
        unhandledList.push(`${method} ${req.url}`);
        return jsonResp(400, { message: 'Malformed URL' });
      }

      const pathname = parsedUrl.pathname;
      const params = parsedUrl.searchParams;
      const nowIso = new Date(nowMs()).toISOString();

      // 1. GoTrue Auth endpoints
      if (pathname === '/auth/v1/token') {
        const grantType = params.get('grant_type') ?? '';
        recordedAuth.push(`${method} ${pathname}?grant_type=${grantType}`);
        if (method !== 'POST') {
          unhandledList.push(`${method} ${pathname}`);
          return jsonResp(405, { error: 'method_not_allowed' });
        }
        const bodyParsed = parseJsonSafe(req.body);
        if (!bodyParsed.ok || typeof bodyParsed.value !== 'object' || bodyParsed.value === null) {
          return jsonResp(400, { error: 'invalid_request' });
        }
        const payload = bodyParsed.value as Record<string, unknown>;

        if (grantType === 'password') {
          const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
          const password = typeof payload.password === 'string' ? payload.password : '';
          const matched = [...users.values()].find(
            (u) => u.email.toLowerCase() === email && u.password === password,
          );
          if (!matched) {
            return jsonResp(400, {
              error: 'invalid_grant',
              error_description: 'Invalid login credentials',
            });
          }
          const expSeconds = Math.floor(nowMs() / 1000) + 3600;
          const accessToken = fakeJwt({ sub: matched.id, email: matched.email, expSeconds });
          return jsonResp(200, {
            access_token: accessToken,
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: expSeconds,
            refresh_token: `rt-${matched.id}`,
            user: buildAuthUser(matched, nowIso),
          });
        }

        if (grantType === 'refresh_token') {
          const rt = typeof payload.refresh_token === 'string' ? payload.refresh_token : '';
          const uid = rt.startsWith('rt-') ? rt.slice(3) : '';
          const matched = users.get(uid);
          if (!matched) {
            return jsonResp(400, {
              error: 'invalid_grant',
              error_description: 'Invalid Refresh Token',
            });
          }
          const expSeconds = Math.floor(nowMs() / 1000) + 3600;
          const accessToken = fakeJwt({ sub: matched.id, email: matched.email, expSeconds });
          return jsonResp(200, {
            access_token: accessToken,
            token_type: 'bearer',
            expires_in: 3600,
            expires_at: expSeconds,
            refresh_token: `rt-${matched.id}`,
            user: buildAuthUser(matched, nowIso),
          });
        }

        unhandledList.push(`${method} ${pathname}?grant_type=${grantType}`);
        return jsonResp(501, { error: 'unsupported_grant_type' });
      }

      if (pathname === '/auth/v1/user' && method === 'GET') {
        recordedAuth.push('GET /auth/v1/user');
        const uid = extractUserId(headers);
        const u = uid ? users.get(uid) : undefined;
        if (!u) return jsonResp(401, { message: 'JWT expired or invalid' });
        return jsonResp(200, buildAuthUser(u, nowIso));
      }

      if (pathname === '/auth/v1/logout' && method === 'POST') {
        recordedAuth.push('POST /auth/v1/logout');
        return emptyResp(204);
      }

      // 2. Edge Functions (/functions/v1/<name>)
      if (pathname.startsWith('/functions/v1/')) {
        const fnName = pathname.slice('/functions/v1/'.length).split('/')[0];
        recordedFunctions.push(fnName);
        return jsonResp(200, {});
      }

      // 3. PostgREST RPC (/rest/v1/rpc/<fn>)
      if (pathname.startsWith('/rest/v1/rpc/')) {
        const fnName = pathname.slice('/rest/v1/rpc/'.length);
        const uid = extractUserId(headers);
        if (!uid) return jsonResp(401, { code: 'PGRST301', message: 'JWT required' });
        const handler = seed.rpc?.[fnName];
        if (!handler) {
          return jsonResp(404, {
            code: 'PGRST202',
            details: null,
            hint: null,
            message: `Could not find the function public.${fnName}`,
          });
        }
        const parsedArgs = parseJsonSafe(req.body);
        const res = handler(parsedArgs.ok ? parsedArgs.value : {}, uid, {
          rows: (tbl, owner) =>
            (db.get(tbl) ?? []).filter((r) => ownerIdOf(tbl, r) === owner).map((r) => ({ ...r })),
        });
        return res.status === 204 ? emptyResp(204) : jsonResp(res.status, res.body);
      }

      // 4. PostgREST Tables (/rest/v1/<table>)
      if (pathname.startsWith('/rest/v1/')) {
        const table = pathname.slice('/rest/v1/'.length);
        if (!table || table.includes('/')) {
          unhandledList.push(`${method} ${pathname}`);
          return jsonResp(501, { message: 'Unsupported REST path' });
        }
        const uid = extractUserId(headers);
        if (!uid) {
          return jsonResp(401, { code: 'PGRST301', message: 'JWT required' });
        }

        const prefer = headers['prefer'] ?? '';
        const accept = headers['accept'] ?? '';
        const wantsSingleObject = accept.includes('application/vnd.pgrst.object+json');
        const wantsRepresentation = prefer.includes('return=representation');
        const wantsExactCount = prefer.includes('count=exact');

        const tableRows = ensureTable(table);
        const ownRows = tableRows.filter((r) => ownerIdOf(table, r) === uid);

        if (method === 'GET' || method === 'HEAD') {
          const filtered = filterRows(ownRows, params);
          if (!filtered.ok) {
            unhandledList.push(`${method} ${pathname}?${filtered.unsupported}`);
            return jsonResp(501, { message: `Unsupported filter: ${filtered.unsupported}` });
          }
          const total = filtered.rows.length;
          const sliced = sortAndSlice(filtered.rows, params, headers['range']);
          const extraHeaders: Record<string, string> = {};
          if (wantsExactCount) {
            extraHeaders['content-range'] =
              sliced.length > 0 ? `0-${sliced.length - 1}/${total}` : `*/${total}`;
          }

          if (wantsSingleObject) {
            if (sliced.length !== 1) {
              return jsonResp(
                406,
                {
                  code: 'PGRST116',
                  details: `The result contains ${sliced.length} rows`,
                  hint: null,
                  message: 'JSON object requested, multiple (or no) rows returned',
                },
                extraHeaders,
              );
            }
            return method === 'HEAD'
              ? emptyResp(200, extraHeaders)
              : jsonResp(200, sliced[0], extraHeaders);
          }

          return method === 'HEAD'
            ? emptyResp(200, extraHeaders)
            : jsonResp(200, sliced, extraHeaders);
        }

        if (method === 'POST') {
          const parsedBody = parseJsonSafe(req.body);
          if (!parsedBody.ok) return jsonResp(400, { code: 'PGRST102', message: 'Invalid JSON' });
          const items = Array.isArray(parsedBody.value)
            ? (parsedBody.value as Record<string, unknown>[])
            : [parsedBody.value as Record<string, unknown>];

          for (const item of items) {
            if (!item || typeof item !== 'object') {
              return jsonResp(400, { code: 'PGRST102', message: 'Expected object row' });
            }
            const explicitOwner = ownerIdOf(table, item);
            if (explicitOwner !== null && explicitOwner !== uid) {
              return jsonResp(403, {
                code: '42501',
                details: null,
                hint: null,
                message: `new row violates row-level security policy for table "${table}"`,
              });
            }
          }

          const conflictCols = (params.get('on_conflict') ?? '')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);
          const mergeDuplicates = prefer.includes('resolution=merge-duplicates');
          const ignoreDuplicates = prefer.includes('resolution=ignore-duplicates');
          const resultRows: Record<string, unknown>[] = [];

          for (const item of items) {
            const normalized: Record<string, unknown> = {
              ...(table === 'profiles' ? { id: uid } : { user_id: uid }),
              ...item,
            };
            if (typeof normalized.id !== 'string' || !normalized.id) {
              normalized.id = `e2e-${table}-${autoIdSeq++}`;
            }
            if (normalized.created_at === undefined) normalized.created_at = nowIso;
            if (normalized.updated_at === undefined) normalized.updated_at = nowIso;

            if ((mergeDuplicates || ignoreDuplicates) && conflictCols.length > 0) {
              const existingIdx = tableRows.findIndex(
                (r) =>
                  ownerIdOf(table, r) === uid &&
                  conflictCols.every((col) => r[col] === normalized[col]),
              );
              if (existingIdx >= 0) {
                if (ignoreDuplicates) {
                  continue;
                }
                const merged: Record<string, unknown> = {
                  ...tableRows[existingIdx],
                  ...item,
                  updated_at: nowIso,
                };
                tableRows[existingIdx] = merged;
                resultRows.push({ ...merged });
                continue;
              }
            }

            tableRows.push(normalized);
            resultRows.push({ ...normalized });
          }

          recordedWrites.push({
            table,
            method: 'POST',
            userId: uid,
            body: parsedBody.value,
          });

          if (!wantsRepresentation) {
            return emptyResp(201);
          }
          if (wantsSingleObject) {
            return resultRows.length === 1
              ? jsonResp(201, resultRows[0])
              : jsonResp(406, { code: 'PGRST116', message: 'Expected single row' });
          }
          return jsonResp(201, resultRows);
        }

        if (method === 'PATCH') {
          const parsedBody = parseJsonSafe(req.body);
          if (!parsedBody.ok || typeof parsedBody.value !== 'object' || parsedBody.value === null) {
            return jsonResp(400, { code: 'PGRST102', message: 'Invalid JSON patch' });
          }
          const patch = parsedBody.value as Record<string, unknown>;
          if (typeof patch.user_id === 'string' && patch.user_id !== uid) {
            return jsonResp(403, { code: '42501', message: 'RLS violation on PATCH' });
          }
          const filtered = filterRows(ownRows, params);
          if (!filtered.ok) {
            unhandledList.push(`${method} ${pathname}?${filtered.unsupported}`);
            return jsonResp(501, { message: `Unsupported filter: ${filtered.unsupported}` });
          }
          const matchedSet = new Set(filtered.rows);
          const updated: Record<string, unknown>[] = [];
          for (let i = 0; i < tableRows.length; i += 1) {
            if (matchedSet.has(tableRows[i])) {
              tableRows[i] = { ...tableRows[i], ...patch, updated_at: nowIso };
              updated.push({ ...tableRows[i] });
            }
          }
          recordedWrites.push({ table, method: 'PATCH', userId: uid, body: patch });
          if (!wantsRepresentation) return emptyResp(204);
          if (wantsSingleObject) {
            return updated.length === 1
              ? jsonResp(200, updated[0])
              : jsonResp(406, { code: 'PGRST116', message: 'Expected single row' });
          }
          return jsonResp(200, updated);
        }

        if (method === 'DELETE') {
          const filtered = filterRows(ownRows, params);
          if (!filtered.ok) {
            unhandledList.push(`${method} ${pathname}?${filtered.unsupported}`);
            return jsonResp(501, { message: `Unsupported filter: ${filtered.unsupported}` });
          }
          const matchedSet = new Set(filtered.rows);
          const removed: Record<string, unknown>[] = [];
          const kept: Record<string, unknown>[] = [];
          for (const r of tableRows) {
            if (matchedSet.has(r)) removed.push({ ...r });
            else kept.push(r);
          }
          db.set(table, kept);
          recordedWrites.push({ table, method: 'DELETE', userId: uid, body: null });
          if (!wantsRepresentation) return emptyResp(204);
          return wantsSingleObject
            ? removed.length === 1
              ? jsonResp(200, removed[0])
              : jsonResp(406, { code: 'PGRST116', message: 'Expected single row' })
            : jsonResp(200, removed);
        }
      }

      unhandledList.push(`${method} ${pathname}`);
      return jsonResp(501, { message: `Unhandled route: ${method} ${pathname}` });
    },

    writes(table?: string): readonly RecordedWrite[] {
      return table ? recordedWrites.filter((w) => w.table === table) : [...recordedWrites];
    },

    functionCalls(): readonly string[] {
      return [...recordedFunctions];
    },

    authCalls(): readonly string[] {
      return [...recordedAuth];
    },

    unhandled(): readonly string[] {
      return [...unhandledList];
    },

    rows(table: string, userId: string): readonly Record<string, unknown>[] {
      const tableRows = db.get(table) ?? [];
      return tableRows.filter((r) => ownerIdOf(table, r) === userId).map((r) => ({ ...r }));
    },
  };
}
