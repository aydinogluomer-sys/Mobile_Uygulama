/**
 * F00 web gate / GAP2-12: expo-sqlite stays out of the web bundle.
 *
 * expo-sqlite's web build imports a `.wasm` worker that Metro cannot resolve
 * for web, so one top-level `import * as SQLite from 'expo-sqlite'` in
 * lib/localReadCache.ts made `npx expo export --platform web` fail with
 * "Unable to resolve module ./wa-sqlite/wa-sqlite.wasm". CI only exports
 * android and ios, so nothing noticed.
 *
 * The fix is a platform seam: `lib/sqliteDriver.native.ts` (Metro picks it on
 * iOS/Android) is the only runtime importer; `lib/sqliteDriver.ts` (web) may
 * import expo-sqlite types only and returns `null`. A lazy `require` would not
 * do: Metro collects `require` calls into the graph whatever condition wraps
 * them, so the source rule below rejects `require('expo-sqlite')` as well.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative, sep } from 'path';
import { stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');
const APP_DIRS = ['app', 'components', 'lib', 'store', 'services', 'repositories', 'hooks'];
const NATIVE_SEAM = 'lib/sqliteDriver.native.ts';
const WEB_SEAM = 'lib/sqliteDriver.ts';

/** Runtime (non type-only) imports or requires of expo-sqlite in a source text. */
const runtimeSqliteImports = (source: string): string[] => {
  const text = stripComments(source);
  const imports = text.match(/^\s*import\s+(?!type\b)[^;]*?from\s+['"]expo-sqlite['"]/gm) ?? [];
  const sideEffect = text.match(/^\s*import\s+['"]expo-sqlite['"]/gm) ?? [];
  const requires = text.match(/\brequire\(\s*['"]expo-sqlite['"]\s*\)/g) ?? [];
  const dynamic = text.match(/\bimport\(\s*['"]expo-sqlite['"]\s*\)/g) ?? [];
  return [...imports, ...sideEffect, ...requires, ...dynamic];
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...sourceFiles(abs));
    else if (/\.(ts|tsx|js|jsx)$/.test(entry)) out.push(abs);
  }
  return out;
}

const rel = (abs: string) => relative(FRONTEND, abs).split(sep).join('/');

describe('expo-sqlite is imported at runtime only by the native seam', () => {
  it('no app module other than lib/sqliteDriver.native.ts imports expo-sqlite at runtime', () => {
    const offenders: string[] = [];
    for (const dir of APP_DIRS) {
      for (const file of sourceFiles(join(FRONTEND, dir))) {
        const path = rel(file);
        if (path === NATIVE_SEAM) continue;
        if (runtimeSqliteImports(readFileSync(file, 'utf8')).length > 0) offenders.push(path);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the native seam does import it (the rule is not vacuous)', () => {
    expect(runtimeSqliteImports(readFileSync(join(FRONTEND, NATIVE_SEAM), 'utf8'))).toHaveLength(1);
  });

  it('the web seam imports expo-sqlite types only', () => {
    const web = readFileSync(join(FRONTEND, WEB_SEAM), 'utf8');
    expect(runtimeSqliteImports(web)).toEqual([]);
    expect(stripComments(web)).toMatch(/import\s+type\s+\*\s+as\s+\w+\s+from\s+['"]expo-sqlite['"]/);
  });
});

describe('the seam behaves per platform', () => {
  it('the web file returns null', () => {
    // An explicit file path bypasses jest-expo's ios platform resolution.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const web = require('../../lib/sqliteDriver.ts') as typeof import('../../lib/sqliteDriver');
    expect(web.loadSqlite()).toBeNull();
  });

  it('the native file (resolved under jest-expo ios) returns the expo-sqlite module', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const native = require('../../lib/sqliteDriver') as typeof import('../../lib/sqliteDriver');
    const sqlite = native.loadSqlite();
    expect(sqlite).not.toBeNull();
    expect(typeof sqlite?.openDatabaseAsync).toBe('function');
  });
});

describe('the source rule catches what it exists for (synthetic text)', () => {
  it('flags namespace, named, default and side-effect imports', () => {
    expect(runtimeSqliteImports("import * as SQLite from 'expo-sqlite';\n")).toHaveLength(1);
    expect(runtimeSqliteImports("import { openDatabaseAsync } from 'expo-sqlite';\n")).toHaveLength(1);
    expect(runtimeSqliteImports("import SQLite from \"expo-sqlite\";\n")).toHaveLength(1);
    expect(runtimeSqliteImports("import 'expo-sqlite';\n")).toHaveLength(1);
  });

  it('flags require and dynamic import, which Metro also pulls into the graph', () => {
    expect(runtimeSqliteImports("const s = require('expo-sqlite');\n")).toHaveLength(1);
    expect(runtimeSqliteImports("const s = await import('expo-sqlite');\n")).toHaveLength(1);
  });

  it('ignores type-only imports and comments', () => {
    expect(runtimeSqliteImports("import type * as ExpoSqlite from 'expo-sqlite';\n")).toEqual([]);
    expect(runtimeSqliteImports("import type { SQLiteDatabase } from 'expo-sqlite';\n")).toEqual([]);
    expect(runtimeSqliteImports("// import * as SQLite from 'expo-sqlite';\n")).toEqual([]);
  });
});
