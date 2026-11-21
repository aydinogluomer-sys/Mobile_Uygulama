/**
 * Native half of the expo-sqlite platform seam (see `sqliteDriver.ts`).
 *
 * Metro picks this file on iOS and Android. It is the ONLY module in the app
 * allowed to import expo-sqlite at runtime, so the web bundle never pulls in
 * the wasm worker (`__tests__/repo/sqliteWebBoundary.test.ts`).
 */
import type * as ExpoSqlite from 'expo-sqlite';

export type SqliteModule = typeof ExpoSqlite;
export type SQLiteDatabase = ExpoSqlite.SQLiteDatabase;

let cached: SqliteModule | null = null;

/** The expo-sqlite module where SQLite is available; `null` on web. */
export function loadSqlite(): SqliteModule | null {
  if (!cached) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-sqlite') as SqliteModule;
  }
  return cached;
}
