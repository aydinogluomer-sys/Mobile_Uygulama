/**
 * A hand-rolled PostgREST chain mock that matches the shape the repository
 * layer actually builds.
 *
 * ## Why this exists
 *
 * Store tests each carried their own inline `jest.mock('../../lib/supabase')`
 * modelling exactly the chain that store happened to use. When the stores
 * moved behind `repositories/`, every mutation gained two links —
 * `.eq('user_id', …)` for owner scoping and `.select(...)` so the result can
 * be inspected instead of discarded — and each private mock had to be taught
 * the same two things independently.
 *
 * That is the same duplication that let a CRLF bug survive in four copies of
 * `stripComments`. One model of the chain, in one place.
 *
 * ## What it models
 *
 *   from(t).select(cols).eq(c, v).order(...).limit(n)        -> { data, error }
 *   from(t).insert(row).select(cols).single()                -> { data, error }
 *   from(t).update(p).eq(...).eq(...).select(cols).maybeSingle()
 *   from(t).delete().eq(...).eq(...).select('id')            -> { data: rows }
 *
 * Every builder is thenable, so a chain that is awaited without a trailing
 * `.select()` still resolves — matching PostgREST, where the terminal call is
 * optional.
 */

export type MockRow = Record<string, unknown> & { id: string };

export type MockDb = {
  rows: Record<string, MockRow[]>;
  inserts: { table: string; payload: Record<string, unknown> }[];
  idSeq: number;
  /** Set to fail the next write, to exercise the error path. */
  failNext: { error: string } | null;
};

export function createMockDb(): MockDb {
  return { rows: {}, inserts: [], idSeq: 0, failNext: null };
}

/**
 * Applies both equality and inequality filters.
 *
 * `neq` used to be recorded as `'!' + column` and then thrown away by
 * `positive()`, so every `.neq(...)` in a repository was a no-op in tests.
 * `fetchPage`'s `not` parameter — the thing that excludes archived projects
 * and goals from the list the user sees — was therefore never exercised: a
 * test could delete the exclusion and stay green.
 */
const matches = (row: MockRow, filters: Record<string, unknown>) =>
  Object.entries(filters).every(([k, v]) =>
    k.startsWith('!') ? row[k.slice(1)] !== v : row[k] === v);

/** `%term%` against one column, case-insensitively — PostgREST's `ilike`. */
function ilikeMatch(row: MockRow, col: string, pattern: string): boolean {
  const needle = String(pattern).replace(/%/g, '').toLowerCase();
  if (!needle) return true;
  const value = row[col];
  return typeof value === 'string' && value.toLowerCase().includes(needle);
}

/**
 * PostgREST's `or('a.ilike.%x%,b.ilike.%x%')`.
 *
 * Only the flat `column.operator.value` form is modelled, which is the one the
 * search repositories build. The keyset cursor also uses `or(...)`, but its
 * expression contains an `and(...)` group; that shape returns `true` here —
 * i.e. no filtering — because half-modelling a compound predicate would make
 * pagination tests pass for reasons unrelated to pagination. Those live in
 * `paginationRuntime.test.ts` against a purpose-built stub.
 */
function orMatch(row: MockRow, expression: string): boolean {
  if (expression.includes('and(')) return true;
  const terms = expression.split(',').map((t) => t.trim()).filter(Boolean);
  if (terms.length === 0) return true;
  return terms.some((term) => {
    const [col, op, ...rest] = term.split('.');
    const value = rest.join('.');
    if (op === 'ilike' || op === 'like') return ilikeMatch(row, col, value);
    if (op === 'eq') return String(row[col]) === value;
    return false;
  });
}

export function makeSupabaseMock(db: MockDb, opts?: { userId?: string | null }) {
  const userId = opts?.userId === undefined ? 'u1' : opts.userId;

  const table = (t: string) => {
    db.rows[t] ??= [];
    return {
      select(_cols?: string, _o?: unknown) {
        const filters: Record<string, unknown> = {};
        // Text predicates cannot be expressed as column/value equality, so
        // they are kept as functions and applied alongside `matches`.
        const predicates: ((row: MockRow) => boolean)[] = [];
        const orderBy: { col: string; asc: boolean }[] = [];
        let rowLimit: number | null = null;
        // Ordering and the limit are honoured so that `fetchPage`'s
        // "ask for limit + 1 and infer hasMore" really is what decides
        // `hasMore` — with `limit()` ignored, that inference was untestable
        // and every page claimed to be the last one.
        const applyOrderAndLimit = (rows: MockRow[]): MockRow[] => {
          const sorted = [...rows].sort((a, b) => {
            for (const { col, asc } of orderBy) {
              const av = a[col] as string | number | undefined;
              const bv = b[col] as string | number | undefined;
              if (av === bv) continue;
              const cmp = (av ?? '') < (bv ?? '') ? -1 : 1;
              return asc ? cmp : -cmp;
            }
            return 0;
          });
          return rowLimit == null ? sorted : sorted.slice(0, rowLimit);
        };
        const q: Record<string, unknown> = {
          eq(c: string, v: unknown) { filters[c] = v; return q; },
          neq(c: string, v: unknown) { filters['!' + c] = v; return q; },
          /**
           * PostgREST's `not(column, operator, value)`.
           *
           * Only `eq` is modelled, which is the form the repositories build
           * (`not('status', 'eq', 'archived')` — how every list excludes
           * archived rows). Without it that exclusion was unrunnable in
           * tests: `fetchHabits` threw rather than filtering, so any test
           * reaching it failed for a reason unrelated to what it was
           * checking.
           */
          not(c: string, op: string, v: unknown) {
            if (op === 'eq') filters['!' + c] = v;
            return q;
          },
          is(c: string, v: unknown) { filters[c] = v; return q; },
          in() { return q; },
          gte() { return q; },
          ilike(col: string, pattern: string) { predicates.push((r) => ilikeMatch(r, col, pattern)); return q; },
          // Keyset cursor predicate. Modelling it properly would mean parsing
          // PostgREST's `or(...)` syntax; the pagination tests that need it
          // live in `paginationRuntime.test.ts` against a purpose-built stub.
          or(expression: string) { predicates.push((r) => orMatch(r, expression)); return q; },
          order(col: string, o?: { ascending?: boolean }) {
            orderBy.push({ col, asc: o?.ascending !== false });
            return q;
          },
          limit(n: number) { rowLimit = n; return q; },
          single: async () => {
            const r = db.rows[t].find((row) => matches(row, filters) && predicates.every((f) => f(row)));
            return r ? { data: r, error: null } : { data: null, error: { message: 'not found' } };
          },
          maybeSingle: async () => {
            const r = db.rows[t].find((row) => matches(row, filters) && predicates.every((f) => f(row)));
            return { data: r ?? null, error: null };
          },
          then(onOk: (v: unknown) => unknown) {
            const rows = applyOrderAndLimit(
              db.rows[t].filter((row) => matches(row, filters) && predicates.every((f) => f(row))),
            );
            return Promise.resolve({ data: rows, error: null, count: rows.length }).then(onOk);
          },
        };
        return q;
      },

      insert(payload: Record<string, unknown>) {
        const rowsIn = Array.isArray(payload) ? payload : [payload];
        const commit = () => {
          if (db.failNext) {
            const e = db.failNext; db.failNext = null;
            return { data: null, error: { message: e.error } };
          }
          const created = rowsIn.map((p) => {
            const row = { id: 'r' + ++db.idSeq, created_at: 'now', ...p } as MockRow;
            db.rows[t].push(row);
            db.inserts.push({ table: t, payload: p });
            return row;
          });
          return { data: Array.isArray(payload) ? created : created[0], error: null };
        };
        const builder: Record<string, unknown> = {
          select: () => ({
            single: async () => {
              const r = commit();
              return { data: Array.isArray(r.data) ? r.data[0] : r.data, error: r.error };
            },
            then: (onOk: (v: unknown) => unknown) => Promise.resolve(commit()).then(onOk),
          }),
          then: (onOk: (v: unknown) => unknown) => Promise.resolve(commit()).then(onOk),
        };
        return builder;
      },

      /**
       * `upsert(row, { onConflict: 'a,b' })`.
       *
       * Modelled because `journal_entries` is written this way — one entry per
       * (user_id, date) — and without it the journal contract could only be
       * tested by asserting the method was called, which proves nothing about
       * whether a second write on the same day creates a duplicate row or
       * replaces the first.
       */
      upsert(payload: Record<string, unknown>, opts?: { onConflict?: string }) {
        const keys = (opts?.onConflict ?? 'id').split(',').map((k) => k.trim());
        const commit = () => {
          if (db.failNext) {
            const e = db.failNext; db.failNext = null;
            return { data: null, error: { message: e.error } };
          }
          const existing = db.rows[t].find((row) => keys.every((k) => row[k] === payload[k]));
          if (existing) {
            Object.assign(existing, payload);
            return { data: existing, error: null };
          }
          const row = { id: 'r' + ++db.idSeq, created_at: 'now', ...payload } as MockRow;
          db.rows[t].push(row);
          db.inserts.push({ table: t, payload });
          return { data: row, error: null };
        };
        const b: Record<string, unknown> = {
          select: () => ({
            single: async () => commit(),
            maybeSingle: async () => commit(),
            then: (onOk: (v: unknown) => unknown) => Promise.resolve(commit()).then(onOk),
          }),
          then: (onOk: (v: unknown) => unknown) => Promise.resolve(commit()).then(onOk),
        };
        return b;
      },

      update(patch: Record<string, unknown>) {
        const filters: Record<string, unknown> = {};
        const apply = () => {
          if (db.failNext) {
            const e = db.failNext; db.failNext = null;
            return { data: null, error: { message: e.error } };
          }
          const hits = db.rows[t].filter((row) => matches(row, filters));
          hits.forEach((row) => Object.assign(row, patch));
          return { data: hits, error: null };
        };
        const u: Record<string, unknown> = {
          eq(c: string, v: unknown) { filters[c] = v; return u; },
          neq(c: string, v: unknown) { filters['!' + c] = v; return u; },
          select: () => ({
            maybeSingle: async () => {
              const r = apply();
              return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
            },
            single: async () => {
              const r = apply();
              return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
            },
            then: (onOk: (v: unknown) => unknown) => Promise.resolve(apply()).then(onOk),
          }),
          then: (onOk: (v: unknown) => unknown) =>
            Promise.resolve({ data: null, error: apply().error }).then(onOk),
        };
        return u;
      },

      delete() {
        const filters: Record<string, unknown> = {};
        const run = () => {
          if (db.failNext) {
            const e = db.failNext; db.failNext = null;
            return { data: null, error: { message: e.error } };
          }
          const hits = db.rows[t].filter((row) => matches(row, filters));
          db.rows[t] = db.rows[t].filter((row) => !matches(row, filters));
          return { data: hits, error: null };
        };
        const d: Record<string, unknown> = {
          eq(c: string, v: unknown) { filters[c] = v; return d; },
          neq(c: string, v: unknown) { filters['!' + c] = v; return d; },
          select: () => ({
            then: (onOk: (v: unknown) => unknown) => Promise.resolve(run()).then(onOk),
          }),
          then: (onOk: (v: unknown) => unknown) => Promise.resolve(run()).then(onOk),
        };
        return d;
      },
    };
  };

  return {
    auth: {
      getUser: jest.fn(async () => ({ data: { user: userId ? { id: userId } : null } })),
      // `repositories/shared.currentUserId` reads `session.user.id`, so the
      // session must carry a user. Without it every repository call in a test
      // using this mock failed with 'Oturum bulunamadı.' instead of exercising
      // the query it was written to check.
      getSession: jest.fn(async () => ({
        data: { session: userId ? { user: { id: userId }, access_token: 't' } : null },
        error: null,
      })),
    },
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
    from: table,
  };
}
