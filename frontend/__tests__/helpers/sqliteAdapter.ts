import * as path from 'path';
import type { BindParams, Database, SqlJsConfig, SqlJsStatic, SqlValue } from 'sql.js';

export type SqliteRunResult = { changes: number; lastInsertRowId: number };

export interface SqliteDatabaseLike {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, ...params: unknown[]): Promise<SqliteRunResult>;
  getFirstAsync<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | null>;
  getAllAsync<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;
  closeAsync(): Promise<void>;
}

export interface ExpoSqliteFakeModule {
  openDatabaseAsync: jest.Mock<Promise<SqliteDatabaseLike>, [string]>;
  __tables(name: string): string[];
  __resetForTests(): void;
}

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

function loadSqlJs(): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const initSqlJs = require('sql.js') as typeof import('sql.js');
    const sqlJsDir = path.dirname(require.resolve('sql.js'));
    sqlJsPromise = initSqlJs({
      locateFile: (file: string) => path.join(sqlJsDir, file),
    } as Partial<SqlJsConfig> as SqlJsConfig);
  }
  return sqlJsPromise;
}

function toSqlValue(val: unknown): SqlValue {
  if (val === undefined || val === null) return null;
  if (typeof val === 'boolean') return val ? 1 : 0;
  if (typeof val === 'number' || typeof val === 'string' || val instanceof Uint8Array) {
    return val;
  }
  return String(val);
}

function normalizeBindParams(sql: string, rest: unknown[]): BindParams | undefined {
  if (rest.length === 0 || (rest.length === 1 && rest[0] === undefined)) {
    return undefined;
  }
  if (rest.length === 1) {
    const single = rest[0];
    if (Array.isArray(single)) {
      return single.length > 0 ? single.map(toSqlValue) : undefined;
    }
    if (single !== null && typeof single === 'object' && !(single instanceof Uint8Array)) {
      const entries = Object.entries(single as Record<string, unknown>);
      if (entries.length === 0) return undefined;
      const mapped: Record<string, SqlValue> = {};
      for (const [k, v] of entries) {
        const sv = toSqlValue(v);
        if (/^[$:@]/.test(k)) {
          mapped[k] = sv;
        } else if (sql.includes(`:${k}`)) {
          mapped[`:${k}`] = sv;
        } else if (sql.includes(`@${k}`)) {
          mapped[`@${k}`] = sv;
        } else {
          mapped[`$${k}`] = sv;
        }
      }
      return mapped;
    }
  }
  return rest.map(toSqlValue);
}

/** Eşzamanlı fabrika (jest.mock uyumlu); WASM ilk openDatabaseAsync'te tembel yüklenir. */
export function createExpoSqliteModule(): ExpoSqliteFakeModule {
  const databases = new Map<string, Database>();

  const openDatabaseAsync = jest.fn(async (name: string): Promise<SqliteDatabaseLike> => {
    const SQL = await loadSqlJs();
    let db = databases.get(name);
    if (!db) {
      db = new SQL.Database();
      databases.set(name, db);
    }
    const activeDb = db;

    return {
      async execAsync(sql: string): Promise<void> {
        activeDb.exec(sql);
      },

      async runAsync(sql: string, ...rest: unknown[]): Promise<SqliteRunResult> {
        const bind = normalizeBindParams(sql, rest);
        const stmt = activeDb.prepare(sql);
        try {
          if (bind !== undefined) {
            stmt.bind(bind);
          }
          stmt.step();
        } finally {
          stmt.free();
        }
        const changes = activeDb.getRowsModified();
        const rowIdRes = activeDb.exec('SELECT last_insert_rowid()');
        const lastInsertRowId = Number(rowIdRes[0]?.values?.[0]?.[0] ?? 0);
        return { changes, lastInsertRowId };
      },

      async getFirstAsync<T = Record<string, unknown>>(
        sql: string,
        ...rest: unknown[]
      ): Promise<T | null> {
        const bind = normalizeBindParams(sql, rest);
        const stmt = activeDb.prepare(sql);
        try {
          if (bind !== undefined) {
            stmt.bind(bind);
          }
          if (!stmt.step()) return null;
          return stmt.getAsObject() as unknown as T;
        } finally {
          stmt.free();
        }
      },

      async getAllAsync<T = Record<string, unknown>>(
        sql: string,
        ...rest: unknown[]
      ): Promise<T[]> {
        const bind = normalizeBindParams(sql, rest);
        const stmt = activeDb.prepare(sql);
        try {
          if (bind !== undefined) {
            stmt.bind(bind);
          }
          const rows: T[] = [];
          while (stmt.step()) {
            rows.push(stmt.getAsObject() as unknown as T);
          }
          return rows;
        } finally {
          stmt.free();
        }
      },

      async closeAsync(): Promise<void> {
        // Real expo-sqlite closes the handle while preserving the on-disk DB file across reopen.
      },
    };
  });

  return {
    openDatabaseAsync,
    __tables(name: string): string[] {
      const db = databases.get(name);
      if (!db) return [];
      const res = db.exec(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name ASC",
      );
      if (!res[0]) return [];
      return res[0].values.map((row) => String(row[0]));
    },
    __resetForTests(): void {
      for (const db of databases.values()) {
        try {
          db.close();
        } catch {
          // ignore already-closed instance
        }
      }
      databases.clear();
    },
  };
}
