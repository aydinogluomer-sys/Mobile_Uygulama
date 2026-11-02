/**
 * Platform seam for expo-sqlite (F00 web gate, GAP2-12).
 *
 * Metro resolves `sqliteDriver.native.ts` on iOS and Android and THIS file on
 * web. Keeping `expo-sqlite` out of the web module graph is the point: its
 * web build imports a `.wasm` worker that the web bundler cannot resolve, so a
 * single top-level `import * as SQLite from 'expo-sqlite'` broke
 * `expo export --platform web` outright. A lazy `require('expo-sqlite')` would
 * not help either: Metro collects `require` calls when it builds the graph,
 * whatever runtime condition surrounds them.
 *
 * Only TYPE imports of expo-sqlite are allowed in this file; they are erased
 * at compile time. `__tests__/repo/sqliteWebBoundary.test.ts` enforces that,
 * and that no other app module imports expo-sqlite at runtime.
 */
import type * as ExpoSqlite from 'expo-sqlite';

export type SqliteModule = typeof ExpoSqlite;
export type SQLiteDatabase = ExpoSqlite.SQLiteDatabase;

/** The expo-sqlite module where SQLite is available; `null` on web. */
export function loadSqlite(): SqliteModule | null {
  return null;
}
