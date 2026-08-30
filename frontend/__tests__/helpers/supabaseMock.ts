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

const matches = (row: MockRow, filters: Record<string, unknown>) =>
  Object.entries(filters).every(([k, v]) => row[k] === v);

export function makeSupabaseMock(db: MockDb, opts?: { userId?: string | null }) {
  const userId = opts?.userId === undefined ? 'u1' : opts.userId;

  const table = (t: string) => {
    db.rows[t] ??= [];
    return {
      select(_cols?: string, _o?: unknown) {
        const filters: Record<string, unknown> = {};
        const q: Record<string, unknown> = {
          eq(c: string, v: unknown) { filters[c] = v; return q; },
          neq(c: string, v: unknown) { filters['!' + c] = v; return q; },
          is(c: string, v: unknown) { filters[c] = v; return q; },
          in() { return q; },
          gte() { return q; },
          or() { return q; },
          order() { return q; },
          limit() { return q; },
          single: async () => {
            const r = db.rows[t].find((row) => matches(row, positive(filters)));
            return r ? { data: r, error: null } : { data: null, error: { message: 'not found' } };
          },
          maybeSingle: async () => {
            const r = db.rows[t].find((row) => matches(row, positive(filters)));
            return { data: r ?? null, error: null };
          },
          then(onOk: (v: unknown) => unknown) {
            const rows = db.rows[t].filter((row) => matches(row, positive(filters)));
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

      update(patch: Record<string, unknown>) {
        const filters: Record<string, unknown> = {};
        const apply = () => {
          if (db.failNext) {
            const e = db.failNext; db.failNext = null;
            return { data: null, error: { message: e.error } };
          }
          const hits = db.rows[t].filter((row) => matches(row, positive(filters)));
          hits.forEach((row) => Object.assign(row, patch));
          return { data: hits, error: null };
        };
        const u: Record<string, unknown> = {
          eq(c: string, v: unknown) { filters[c] = v; return u; },
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
          const hits = db.rows[t].filter((row) => matches(row, positive(filters)));
          db.rows[t] = db.rows[t].filter((row) => !matches(row, positive(filters)));
          return { data: hits, error: null };
        };
        const d: Record<string, unknown> = {
          eq(c: string, v: unknown) { filters[c] = v; return d; },
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
      getSession: jest.fn(async () => ({ data: { session: userId ? { access_token: 't' } : null } })),
    },
    functions: { invoke: jest.fn(async () => ({ data: null, error: null })) },
    from: table,
  };
}

/** Drops the `!col` negation markers, which the row matcher does not use. */
function positive(filters: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(filters).filter(([k]) => !k.startsWith('!')));
}
