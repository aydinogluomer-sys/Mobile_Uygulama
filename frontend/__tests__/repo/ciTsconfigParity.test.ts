import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { readSource, stripComments } from '../helpers/sourceText';

const FRONTEND = join(__dirname, '..', '..');

type TsConfigShape = {
  include?: string[];
  exclude?: string[];
};

function parseJsonc<T>(raw: string): T {
  return JSON.parse(stripComments(raw)) as T;
}

function isGlobPattern(entry: string): boolean {
  return /[*?[\]{}]/.test(entry);
}

export function untrackedExplicitIncludes(
  cfg: TsConfigShape,
  trackedFiles: ReadonlySet<string>,
  gitignoredEntries: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  for (const item of cfg.include ?? []) {
    if (gitignoredEntries.has(item)) {
      problems.push(`${item} is gitignored and must not be listed in include`);
      continue;
    }
    if (!isGlobPattern(item) && !trackedFiles.has(item)) {
      problems.push(`${item} is an explicit include not tracked by git ls-files`);
    }
  }
  return problems;
}

describe('F49 (BLD-19) — tsconfig.ci.json parity with clean CI clones', () => {
  const rawCi = readSource('tsconfig.ci.json');
  const ciCfg = parseJsonc<TsConfigShape>(rawCi);
  const gitignoreLines = new Set(
    readSource('.gitignore')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#')),
  );
  const tracked = new Set(
    execFileSync('git', ['ls-files'], { cwd: FRONTEND, encoding: 'utf8' })
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean),
  );

  it('(+) explicit include entries are git-tracked, expo-env.d.ts is excluded, and types/expo.d.ts supplies expo/types', () => {
    expect(existsSync(join(FRONTEND, 'types/expo.d.ts'))).toBe(true);
    expect(tracked.has('types/expo.d.ts')).toBe(true);
    const expoDts = readSource('types/expo.d.ts');
    expect(expoDts).toContain('/// <reference types="expo/types" />');

    expect(ciCfg.exclude ?? []).toContain('expo-env.d.ts');
    expect(gitignoreLines.has('expo-env.d.ts')).toBe(true);
    expect(untrackedExplicitIncludes(ciCfg, tracked, gitignoreLines)).toEqual([]);
  });

  it('(-) rejects synthetic include containing gitignored expo-env.d.ts or untracked explicit files', () => {
    expect(
      untrackedExplicitIncludes(
        { include: ['**/*.ts', 'expo-env.d.ts'] },
        tracked,
        gitignoreLines,
      ),
    ).toEqual(['expo-env.d.ts is gitignored and must not be listed in include']);

    expect(
      untrackedExplicitIncludes(
        { include: ['**/*.ts', 'ghost-untracked.d.ts'] },
        tracked,
        gitignoreLines,
      ),
    ).toEqual(['ghost-untracked.d.ts is an explicit include not tracked by git ls-files']);
  });
});
