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
  /**
   * Set to fail the next READ.
   *
   * Separate from `failNext` on purpose: reads and writes are armed by
   * different tests, and letting one queue serve both meant a test arming a
   * write failure would have it consumed by whatever read happened first.
   */
  failNextRead: { error: string; status?: number; code?: string } | null;
  /**
   * Fails every write to ONE table, until cleared.
   *
   * `failNext` cannot express the case this exists for. A sequence that
   * writes to two different tables and must fail at the SECOND one -- the
   * onboarding install writes its claim to `user_onboarding` and only then
   * the habits to `habits` -- cannot be tested by arming `failNext`
   * beforehand, because the claim consumes it and the code never reaches the
   * branch under test. Targeting by table lets the first write really
   * succeed.
   *
   * `onAttempt` fires at the moment the write is refused, which is the only
   * point at which the database holds the state a crash would leave behind:
   * the claim durable, nothing inserted. Tests snapshot the row there rather
   * than hand-writing what they assume the claim looked like.
   */
  failTable: { table: string; error: string; onAttempt?: () => void } | null;
};

export function createMockDb(): MockDb {
  return {
    rows: {}, inserts: [], idSeq: 0,
    failNext: null, failNextRead: null, failTable: null,
  };
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

  /** Consumes an armed read failure, if there is one. */
  const takeReadFailure = () => {
    if (!db.failNextRead) return null;
    const e = db.failNextRead;
    db.failNextRead = null;
    // F06: `status` (0 = the request never completed, 5xx = the server is down) and `code` only when armed
    const error: { message: string; code?: string } = { message: e.error };
    if (e.code !== undefined) error.code = e.code;
    return e.status === undefined ? { data: null, error } : { data: null, error, status: e.status };
  };

  const table = (t: string) => {
    db.rows[t] ??= [];

    /**
     * Both write-failure hooks, in one place, so the four write paths cannot
     * drift apart on which of them they honour.
     *
     * `failTable` is checked first and does NOT consume `failNext`: a test
     * targeting one table must not silently disarm a one-shot failure another
     * part of the same test is relying on.
     */
    const takeWriteFailure = (): { data: null; error: { message: string } } | null => {
      if (db.failTable && db.failTable.table === t) {
        db.failTable.onAttempt?.();
        return { data: null, error: { message: db.failTable.error } };
      }
      if (db.failNext) {
        const e = db.failNext; db.failNext = null;
        return { data: null, error: { message: e.error } };
      }
      return null;
    };

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
            const failed = takeReadFailure();
            if (failed) return failed;
            const r = db.rows[t].find((row) => matches(row, filters) && predicates.every((f) => f(row)));
            return r ? { data: r, error: null } : { data: null, error: { message: 'not found' } };
          },
          maybeSingle: async () => {
            const failed = takeReadFailure();
            if (failed) return failed;
            const r = db.rows[t].find((row) => matches(row, filters) && predicates.every((f) => f(row)));
            return { data: r ?? null, error: null };
          },
          then(onOk: (v: unknown) => unknown) {
            const failed = takeReadFailure();
            if (failed) return Promise.resolve({ ...failed, count: null }).then(onOk);
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
          const failure = takeWriteFailure();
          if (failure) return failure;
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
      upsert(payload: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }) {
        const keys = (opts?.onConflict ?? 'id').split(',').map((k) => k.trim());
        const rowsIn = Array.isArray(payload) ? payload : [payload];
        const commit = () => {
          const failure = takeWriteFailure();
          if (failure) return failure;
          const upserted = rowsIn.map((item) => {
            const existing = db.rows[t].find((row) => keys.every((k) => row[k] === item[k]));
            if (existing) {
              Object.assign(existing, item);
              return existing;
            }
            const row = { id: 'r' + ++db.idSeq, created_at: 'now', ...item } as MockRow;
            db.rows[t].push(row);
            db.inserts.push({ table: t, payload: item });
            return row;
          });
          return { data: Array.isArray(payload) ? upserted : upserted[0], error: null };
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
          const failure = takeWriteFailure();
          if (failure) return failure;
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
          const failure = takeWriteFailure();
          if (failure) return failure;
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
