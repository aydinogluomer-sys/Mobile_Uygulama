import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const FRONTEND_ROOT = join(__dirname, '..', '..');

/**
 * Reads multiple source files relative to `frontend/` and joins them with `\n`.
 * Throws an explicit error if any listed file is missing so guards never pass vacuously.
 */
export function readSources(paths: readonly string[]): string {
  if (paths.length === 0) {
    throw new Error('readSources requires at least one relative path');
  }
  return paths
    .map((rel) => {
      const abs = join(FRONTEND_ROOT, rel);
      if (!existsSync(abs)) {
        throw new Error(`readSources: missing source file "${rel}" (${abs})`);
      }
      return readFileSync(abs, 'utf8').replace(/\r\n?/g, '\n');
    })
    .join('\n');
}

/**
 * Source lines with comment lines (`//`, ` *`, `/*`) dropped — same rule as
 * `todayScheduleScoped.test.ts`.
 */
export function codeLinesOf(src: string): string[] {
  return src.split(/\r?\n/).filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l));
}
